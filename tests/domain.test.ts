import test from "node:test";
import assert from "node:assert/strict";
import { seed } from "../src/data.ts";
import {
  totals,
  requestSample,
  directRoute,
  createOrder,
  advanceOrder,
  advanceSample,
  book,
  responseFor,
  dormantClients,
} from "../src/domain.ts";
test("cotización calcula descuento con límite y rechaza cantidades inválidas", () => {
  assert.deepEqual(
    totals(
      [
        { price: 850, quantity: 4 },
        { price: 350, quantity: 4 },
      ],
      10,
      10,
    ),
    { subtotal: 4800, discount: 10, total: 4320 },
  );
  for (const quantity of [0, -1, 1.5, NaN])
    assert.throws(() => totals([{ price: 850, quantity }]));
  assert.throws(() => totals([{ price: 850, quantity: 1 }], 11, 10));
});
test("muestra es opcional y no duplica oportunidad o solicitud", () => {
  const s = seed(),
    length = s.opportunities.length;
  const a = requestSample(s, "op2"),
    b = requestSample(s, "op2");
  assert.equal(a.id, b.id);
  assert.equal(s.opportunities.length, length);
  directRoute(s, "op2");
  assert.equal(s.opportunities.find((o) => o.id === "op2").route, "direct");
  assert.ok(s.samples.find((x) => x.id === a.id));
});
test("venta directa crea un único pedido confirmado sin muestra", () => {
  const s = seed();
  s.quotes.push({
    id: "q1",
    clientId: "c2",
    total: 100,
    status: "Aceptada",
    channel: "WhatsApp",
  });
  assert.throws(() => createOrder(s, "q1", false));
  const a = createOrder(s, "q1", true),
    b = createOrder(s, "q1", true);
  assert.equal(a.id, b.id);
  assert.equal(a.status, "Por autorizar");
  assert.equal(s.notifications.length, 1);
  assert.equal(s.samples.filter((x) => x.clientId === "c2").length, 0);
});
test("borrador no se convierte en pedido aunque se confirme", () => {
  const s = seed();
  s.quotes.push({ id: "q1", clientId: "c2", total: 100, status: "Borrador" });
  assert.throws(() => createOrder(s, "q1", true));
});
test("producción requiere autorización y despacho requiere guía administrativa", () => {
  const s = seed();
  s.role = "Ventas";
  assert.throws(() => advanceOrder(s, "HE-1048"));
  s.role = "Administración";
  advanceOrder(s, "HE-1048");
  s.role = "Producción";
  advanceOrder(s, "HE-1048");
  assert.throws(() => advanceOrder(s, "HE-1048", "guia"));
  s.role = "Administración";
  assert.throws(() => advanceOrder(s, "HE-1048", ""));
  advanceOrder(s, "HE-1048", "ABC123");
  advanceOrder(s, "HE-1048");
  assert.equal(s.orders.find((o) => o.id === "HE-1048").status, "Entregado");
  assert.equal(s.notifications.length, 4);
  assert.throws(() => advanceOrder(s, "HE-1048"));
  assert.equal(s.notifications.length, 4);
});
test("muestra exige evaluación y no convierte automáticamente en venta", () => {
  const s = seed(),
    count = s.orders.length;
  assert.throws(() => advanceSample(s, "M-0084"));
  advanceSample(s, "M-0084", "", "Aprobada por el cliente");
  assert.equal(s.samples[0].status, "Evaluada");
  assert.equal(s.orders.length, count);
});
test("agenda bloquea solapamiento para el mismo vendedor y permite horarios contiguos", () => {
  const s = seed(),
    start = new Date(Date.now() + 86400000).toISOString();
  book(s, { clientId: "c1", owner: "Eli", start, duration: 30 });
  assert.throws(() =>
    book(s, { clientId: "c2", owner: "Eli", start, duration: 30 }),
  );
  book(s, { clientId: "c2", owner: "Vendedor 2", start, duration: 30 });
  book(s, {
    clientId: "c2",
    owner: "Eli",
    start: new Date(new Date(start).getTime() + 30 * 60000).toISOString(),
    duration: 30,
  });
  assert.equal(s.appointments.length, 3);
});
test("Sara se pausa en atención humana y no inventa aromas", () => {
  const s = seed();
  assert.equal(responseFor("Hola", s, true), null);
  assert.ok(responseFor("Quiero un vendedor", s).handoff);
  assert.match(responseFor("Qué aromas tienen", s).text, /pendiente/);
  assert.match(responseFor("Necesito muestra", s).text, /opcional/);
});
test("recompra incluye solo clientes con más de 30 días sin comprar", () => {
  const s = seed();
  assert.deepEqual(
    dormantClients(s).map((c) => c.id),
    ["c2", "c3"],
  );
});
