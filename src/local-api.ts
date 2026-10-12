type CrmContext = {
  user: { id: string; email: string };
  workspace: { id: string; name: string };
  role: "owner" | "admin" | "sales" | "production";
  roleLabel: string;
};
type Row = Record<string, unknown> & { id?: string; workspace_id?: string };
type Snapshot = { revision: number; rows: Record<string, Row[]> };
type Change = {
  table: string;
  id: string;
  operation: "insert" | "update" | "delete";
  values?: Record<string, unknown>;
};

const listeners = new Set<(event: string) => void>();
const snapshots = new WeakMap<object, Snapshot>();

async function request(path: string, body?: unknown): Promise<any> {
  const response = await fetch(`/api/crm${path}`, {
    credentials: "same-origin",
    headers: body ? { "Content-Type": "application/json" } : {},
    method: body ? "POST" : "GET",
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await response.json();
  if (!response.ok) {
    throw Object.assign(new Error(result.error || "No fue posible conectar con el servidor."), {
      status: response.status,
    });
  }
  return result;
}

export function subscribe(callback: (event: string) => void) {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export async function login(email: string, password: string) {
  const result = await request("/auth/login", { email, password });
  for (const callback of listeners) callback("SIGNED_IN");
  return result;
}

export async function signup(values: Record<string, unknown>) {
  const result = await request("/auth/signup", values);
  for (const callback of listeners) callback("SIGNED_IN");
  return result;
}

export async function logout() {
  await request("/auth/logout", {});
  for (const callback of listeners) callback("SIGNED_OUT");
}

export async function context(): Promise<CrmContext | null> {
  return (await request("/session")).context;
}

export async function load(
  ctx: CrmContext,
  toRows: (state: any, workspaceId: string) => Record<string, Row[]>,
  fromRows: (rows: Record<string, Row[]>, roleLabel: string) => any,
) {
  const result = await request(`/state?workspace=${encodeURIComponent(ctx.workspace.id)}`);
  const state = fromRows(result.rows, ctx.roleLabel);
  snapshots.set(ctx, {
    revision: Number(result.revision),
    rows: toRows(state, ctx.workspace.id),
  });
  return state;
}

export async function push(
  state: any,
  ctx: CrmContext,
  toRows: (state: any, workspaceId: string) => Record<string, Row[]>,
) {
  const baseline = snapshots.get(ctx);
  if (!baseline) throw new Error("Carga los datos antes de guardar.");
  if (ctx.role === "production") return;
  const rows = toRows(state, ctx.workspace.id);
  const changes: Change[] = [];

  for (const [table, collection] of Object.entries(rows)) {
    if (["audit_log", "notifications"].includes(table)) continue;
    const previous = new Map(
      (baseline.rows[table] || []).map((row) => [row.id || row.workspace_id, row]),
    );
    if (["appointments", "tasks"].includes(table)) {
      const currentIds = new Set(collection.map((row) => row.id));
      for (const id of previous.keys()) {
        if (id && !currentIds.has(id)) changes.push({ table, id, operation: "delete" });
      }
    }
    for (const row of collection) {
      const id = row.id || row.workspace_id;
      if (!id) continue;
      const old = previous.get(id);
      const values = Object.fromEntries(Object.entries(row).filter(([key, value]) =>
        !["id", "workspace_id"].includes(key) &&
        (!old || JSON.stringify(old[key]) !== JSON.stringify(value)),
      ));
      if (Object.keys(values).length) {
        changes.push({ table, id, operation: old ? "update" : "insert", values });
      }
    }
  }
  if (!changes.length) return;
  const result = await request("/sync", {
    workspace: ctx.workspace.id,
    revision: baseline.revision,
    changes,
  });
  snapshots.set(ctx, { revision: Number(result.revision), rows });
}

export async function remove(table: string, id: string, ctx: CrmContext) {
  const baseline = snapshots.get(ctx);
  if (!baseline) throw new Error("Carga los datos antes de guardar.");
  const result = await request("/sync", {
    workspace: ctx.workspace.id,
    revision: baseline.revision,
    changes: [{ table, id, operation: "delete" }],
  });
  baseline.revision = Number(result.revision);
  baseline.rows[table] = baseline.rows[table].filter((row) => row.id !== id);
}

export async function pack(order: { id: string }, ctx: CrmContext) {
  const baseline = snapshots.get(ctx);
  if (!baseline) throw new Error("Carga los datos antes de guardar.");
  const result = await request("/pack", {
    workspace: ctx.workspace.id,
    revision: baseline.revision,
    orderId: order.id,
  });
  baseline.revision = Number(result.revision);
}

export async function manageMember(values: Record<string, unknown>, ctx: CrmContext) {
  const baseline = snapshots.get(ctx);
  if (!baseline) throw new Error("Carga los datos antes de guardar.");
  const result = await request("/members", {
    ...values,
    workspace: ctx.workspace.id,
    revision: baseline.revision,
  });
  baseline.revision = Number(result.revision);
}
