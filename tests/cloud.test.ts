import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/data.ts";
import { fromRows, toRows, loadCloudState, pushCloudState, updateProductionOrder } from "../src/cloud.ts";

test("la conversión de Supabase conserva los datos esenciales del CRM", () => {
  const original = seed();
  const workspaceId = "11111111-1111-1111-1111-111111111111";
  const restored = fromRows(toRows(original, workspaceId), "Dirección");

  assert.equal(restored.initialized, false);
  assert.equal(restored.role, "Dirección");
  assert.equal(restored.clients.length, original.clients.length);
  assert.deepEqual(restored.clients[0], original.clients[0]);
  assert.deepEqual(restored.opportunities[0], original.opportunities[0]);
  assert.deepEqual(restored.products[0], original.products[0]);
  assert.deepEqual(restored.orders[0], {
    ...original.orders[0],
    quoteId: null,
    delivered: null,
  });
  assert.deepEqual(restored.samples[0], original.samples[0]);
  assert.deepEqual(restored.conversations[0], original.conversations[0]);
});

function fakeClient(rows) {
  const calls = [];
  return {
    calls,
    from(table) {
      const query = {
        operation: "select", filters: {},
        select() { return this; },
        eq(key, value) { this.filters[key] = value; return this; },
        order(key) { assert.equal(key, "id"); return this; },
        range(start, end) { this.slice = [start, end + 1]; return this; },
        limit(value) { this.slice = [0, value]; return this; },
        single() { return this; },
        update(values) { this.operation = "update"; this.values = values; return this; },
        upsert(values) { this.operation = "upsert"; this.values = values; return this; },
        then(resolve) {
          if (this.operation !== "select") {
            calls.push({ table, operation: this.operation, values: this.values, filters: this.filters });
            return Promise.resolve({ data: { id: this.filters.id }, error: null }).then(resolve);
          }
          const matching = (rows[table] || []).filter((row) =>
            row.workspace_id === this.filters.workspace_id);
          return Promise.resolve({ data: matching.slice(...this.slice), error: null }).then(resolve);
        },
      };
      return query;
    },
  };
}

test("la carga pagina más de mil clientes sin perder registros", async () => {
  const context = { workspace: { id: "workspace" }, roleLabel: "Dirección" };
  const rows = { clients: Array.from({ length: 1001 }, (_, index) => ({
    workspace_id: "workspace", id: `c${index}`, name: `Cliente ${index}`,
  })) };
  const state = await loadCloudState(context, fakeClient(rows));
  assert.equal(state.clients.length, 1001);
});

test("guardar sin cambios no escribe; editar un campo no reenvía otros registros o campos", async () => {
  const context = { workspace: { id: "workspace" }, role: "owner", roleLabel: "Dirección" };
  const backend = fakeClient(toRows(seed(), "workspace"));
  const state = await loadCloudState(context, backend);
  await pushCloudState(state, context, backend);
  assert.equal(backend.calls.length, 0);
  state.clients[0].phone = "5551234567";
  await pushCloudState(state, context, backend);
  assert.deepEqual(backend.calls, [{ table: "clients", operation: "update",
    filters: { workspace_id: "workspace", id: state.clients[0].id },
    values: { phone: "5551234567" } }]);
  await pushCloudState(state, context, backend);
  assert.equal(backend.calls.length, 1);
});

test("Ventas no intenta actualizar pedidos existentes, catálogo o ajustes", async () => {
  const context = { workspace: { id: "workspace" }, role: "sales", roleLabel: "Ventas" };
  const backend = fakeClient(toRows(seed(), "workspace"));
  const state = await loadCloudState(context, backend);
  state.clients[0].name = "Cliente actualizado";
  await pushCloudState(state, context, backend);
  assert.deepEqual(backend.calls.map((call) => call.table), ["clients"]);
});

test("si falla una escritura, el siguiente guardado vuelve a intentarla", async () => {
  const context = { workspace: { id: "workspace" }, role: "owner", roleLabel: "Dirección" };
  const backend = fakeClient(toRows(seed(), "workspace"));
  const state = await loadCloudState(context, backend);
  state.clients[0].name = "Cambio pendiente";
  const failed = { from() { return {
    update() { return this; }, eq() { return this; }, select() { return this; },
    single() { return { data: null, error: new Error("RLS denied") }; },
  }; } };
  await assert.rejects(pushCloudState(state, context, failed), /RLS denied/);
  await pushCloudState(state, context, backend);
  assert.equal(backend.calls[0].values.name, "Cambio pendiente");
});

test("Producción usa la transacción de empaque y propaga el error del servidor", async () => {
  const context = { workspace: { id: "workspace" }, role: "production" };
  const calls = [];
  const client = { async rpc(name, args) { calls.push({ name, args }); return { data: null }; } };
  await updateProductionOrder({ id: "HE-1", status: "Empacado" }, context, client);
  assert.deepEqual(calls, [{ name: "pack_order", args: { target_workspace: "workspace", target_order: "HE-1" } }]);
  await assert.rejects(updateProductionOrder({ id: "HE-1", status: "Entregado" }, context, client), /solo puede/);
  await assert.rejects(updateProductionOrder({ id: "HE-1", status: "Empacado" }, context,
    { rpc: async () => ({ error: new Error("Pedido no encontrado") }) }), /Pedido no encontrado/);
});

test("las filas siempre quedan aisladas por espacio de trabajo", () => {
  const workspaceId = "22222222-2222-2222-2222-222222222222";
  const rows = toRows(seed(), workspaceId);

  for (const collection of Object.values(rows)) {
    assert.ok(collection.every((row) => row.workspace_id === workspaceId));
  }
});
