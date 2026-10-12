import { createClient } from "@supabase/supabase-js";
import * as local from "./local-api.ts";

const environment = (import.meta.env || {}) as Record<string, string | undefined>;
const supabaseUrl = environment.VITE_SUPABASE_URL?.trim();
const publishableKey = environment.VITE_SUPABASE_PUBLISHABLE_KEY?.trim();

export const localBackend = environment.VITE_BACKEND === "local";
export const cloudEnabled = localBackend || Boolean(supabaseUrl && publishableKey);
export const supabase = !localBackend && cloudEnabled
  ? createClient(supabaseUrl, publishableKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    })
  : null;

const roleLabels = {
  owner: "Dirección",
  admin: "Administración",
  sales: "Ventas",
  production: "Producción",
};

const clean = (value, fallback = "") => value ?? fallback;
const number = (value, fallback = 0) =>
  value === null || value === undefined ? fallback : Number(value);

function assert(result) {
  if (result.error) throw result.error;
  return result.data;
}

export async function signIn(email, password) {
  if (localBackend) return local.login(email, password);
  return assert(await supabase.auth.signInWithPassword({ email, password }));
}

export async function signUp({ email, password, fullName, workspaceName }) {
  if (localBackend) return local.signup({ email, password, fullName, workspaceName });
  return assert(
    await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: {
          full_name: fullName,
          workspace_name: workspaceName,
        },
      },
    }),
  );
}

export async function signOut() {
  if (localBackend) return local.logout();
  return assert(await supabase.auth.signOut());
}

export function onAuthStateChange(callback) {
  if (localBackend) return local.subscribe(callback);
  if (!supabase) return () => {};
  const { data } = supabase.auth.onAuthStateChange(callback);
  return () => data.subscription.unsubscribe();
}

export async function getCloudContext() {
  if (localBackend) return local.context();
  if (!supabase) return null;
  const { data, error } = await supabase.auth.getUser();
  if (error && error.name !== "AuthSessionMissingError") throw error;
  const user = data?.user;
  if (!user) return null;

  const membership = assert(
    await supabase
      .from("workspace_members")
      .select("workspace_id, role, workspaces(id, name)")
      .eq("user_id", user.id)
      .limit(1)
      .maybeSingle(),
  );
  if (!membership) {
    throw new Error(
      "La cuenta existe, pero todavía no tiene acceso a un espacio de trabajo.",
    );
  }
  const workspace = Array.isArray(membership.workspaces)
    ? membership.workspaces[0]
    : membership.workspaces;
  return {
    user,
    workspace: workspace || {
      id: membership.workspace_id,
      name: "Hotel Expert",
    },
    role: membership.role,
    roleLabel: roleLabels[membership.role] || "Ventas",
  };
}

export function toRows(state, workspaceId) {
  const scoped = (row) => ({ workspace_id: workspaceId, ...row });
  return {
    crm_settings: [
      {
        workspace_id: workspaceId,
        discount_limit: state.discountLimit,
        initialized: Boolean(state.initialized),
      },
    ],
    clients: state.clients.map((item) =>
      scoped({
        id: item.id,
        name: item.name,
        legal_name: clean(item.legal),
        rfc: clean(item.rfc),
        address: clean(item.address),
        contact: clean(item.contact),
        position: clean(item.position),
        phone: clean(item.phone),
        email: clean(item.email),
        owner_name: clean(item.owner),
        last_order: item.lastOrder || null,
        created_on: item.created,
        aroma: clean(item.aroma),
        notes: clean(item.notes),
        channel: clean(item.channel),
      }),
    ),
    opportunities: state.opportunities.map((item) =>
      scoped({
        id: item.id,
        client_id: item.clientId,
        stage: item.stage,
        route: item.route,
        amount: item.amount,
        next_action: clean(item.next),
        owner_name: clean(item.owner),
        created_on: item.created,
      }),
    ),
    products: state.products.map((item) =>
      scoped({
        id: item.id,
        name: item.name,
        size: clean(item.size),
        price: item.price,
        sku: item.sku,
      }),
    ),
    aromas: state.aromas.map((item) =>
      scoped({
        id: item.id,
        name: item.name,
        family: clean(item.family),
        notes: clean(item.notes),
        intensity: clean(item.intensity),
        areas: clean(item.areas),
        product_ids: item.products || [],
        approved: Boolean(item.approved),
      }),
    ),
    quotes: state.quotes.map((item) =>
      scoped({
        id: item.id,
        client_id: item.clientId,
        lines: item.lines || [],
        subtotal: item.subtotal,
        discount: item.discount,
        total: item.total,
        valid_until: item.validUntil,
        payment: clean(item.payment),
        shipping: item.shipping ?? null,
        delivery: clean(item.delivery),
        channel: clean(item.channel),
        status: item.status,
        version: item.version || 1,
        acceptance_reference: item.acceptanceReference || null,
        accepted_at: item.acceptedAt || null,
        created_at: item.created,
      }),
    ),
    orders: state.orders.map((item) =>
      scoped({
        id: item.id,
        client_id: item.clientId,
        opportunity_id: item.opportunityId || null,
        quote_id: item.quoteId || null,
        total: item.total,
        status: item.status,
        confirmed: Boolean(item.confirmed),
        created_on: item.created,
        due_on: item.due || null,
        tracking: clean(item.tracking),
        channel: clean(item.channel),
        invoice_amount: item.invoiceAmount || 0,
        delivered_on: item.delivered || null,
      }),
    ),
    samples: state.samples.map((item) =>
      scoped({
        id: item.id,
        opportunity_id: item.opportunityId,
        client_id: item.clientId,
        status: item.status,
        aroma: clean(item.aroma, "Por confirmar"),
        result: clean(item.result),
        tracking: clean(item.tracking),
      }),
    ),
    appointments: state.appointments.map((item) =>
      scoped({
        id: item.id,
        client_id: item.clientId,
        owner_name: item.owner,
        start_at: new Date(item.start).toISOString(),
        duration: item.duration,
        type: item.type,
      }),
    ),
    tasks: state.tasks.map((item) =>
      scoped({ id: item.id, client_id: item.clientId, title: item.title }),
    ),
    notifications: state.notifications.map((item) =>
      scoped({
        id: item.id,
        event_key: item.key,
        order_id: item.orderId,
        event: item.event,
        status: item.status,
        created_at: item.at,
      }),
    ),
    conversations: state.conversations.map((item) =>
      scoped({
        id: item.id,
        client_id: item.clientId,
        human: Boolean(item.human),
        messages: item.messages || [],
      }),
    ),
    audit_log: state.audit.map((item) =>
      scoped({
        id: item.id,
        occurred_at: item.at,
        actor: clean(item.actor),
        action: item.action,
      }),
    ),
  };
}

export function fromRows(rows, roleLabel = "Ventas") {
  const settings = rows.crm_settings?.[0];
  return {
    version: 1,
    initialized: Boolean(settings?.initialized),
    role: roleLabel,
    discountLimit: number(settings?.discount_limit),
    clients: (rows.clients || []).map((item) => ({
      id: item.id,
      name: item.name,
      legal: clean(item.legal_name),
      rfc: clean(item.rfc),
      address: clean(item.address),
      contact: clean(item.contact),
      position: clean(item.position),
      phone: clean(item.phone),
      email: clean(item.email),
      owner: clean(item.owner_name),
      lastOrder: item.last_order,
      created: item.created_on,
      aroma: clean(item.aroma),
      notes: clean(item.notes),
      channel: clean(item.channel),
    })),
    opportunities: (rows.opportunities || []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      stage: number(item.stage),
      route: item.route,
      amount: number(item.amount),
      next: clean(item.next_action),
      owner: clean(item.owner_name),
      created: item.created_on,
    })),
    products: (rows.products || []).map((item) => ({
      id: item.id,
      name: item.name,
      size: clean(item.size),
      price: number(item.price),
      sku: item.sku,
    })),
    aromas: (rows.aromas || []).map((item) => ({
      id: item.id,
      name: item.name,
      family: clean(item.family),
      notes: clean(item.notes),
      intensity: clean(item.intensity),
      areas: clean(item.areas),
      products: item.product_ids || [],
      approved: Boolean(item.approved),
    })),
    quotes: (rows.quotes || []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      lines: item.lines || [],
      subtotal: number(item.subtotal),
      discount: number(item.discount),
      total: number(item.total),
      validUntil: item.valid_until,
      payment: clean(item.payment),
      shipping: item.shipping === null ? null : number(item.shipping),
      delivery: clean(item.delivery),
      channel: clean(item.channel),
      status: item.status,
      version: number(item.version, 1),
      acceptanceReference: item.acceptance_reference,
      acceptedAt: item.accepted_at,
      created: item.created_at,
    })),
    orders: (rows.orders || []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      opportunityId: item.opportunity_id,
      quoteId: item.quote_id,
      total: number(item.total),
      status: item.status,
      confirmed: Boolean(item.confirmed),
      created: item.created_on,
      due: item.due_on,
      tracking: clean(item.tracking),
      channel: clean(item.channel),
      invoiceAmount: number(item.invoice_amount),
      delivered: item.delivered_on,
    })),
    samples: (rows.samples || []).map((item) => ({
      id: item.id,
      opportunityId: item.opportunity_id,
      clientId: item.client_id,
      status: item.status,
      aroma: clean(item.aroma, "Por confirmar"),
      result: clean(item.result),
      tracking: clean(item.tracking),
    })),
    appointments: (rows.appointments || []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      owner: item.owner_name,
      start: item.start_at,
      duration: number(item.duration),
      type: item.type,
    })),
    tasks: (rows.tasks || []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      title: item.title,
    })),
    notifications: (rows.notifications || []).map((item) => ({
      id: item.id,
      key: item.event_key,
      orderId: item.order_id,
      event: item.event,
      status: item.status,
      at: item.created_at,
    })),
    audit: (rows.audit_log || []).map((item) => ({
      id: item.id,
      at: item.occurred_at,
      actor: clean(item.actor),
      action: item.action,
    })),
    conversations: (rows.conversations || []).map((item) => ({
      id: item.id,
      clientId: item.client_id,
      human: Boolean(item.human),
      messages: item.messages || [],
    })),
  };
}

const tables = [
  "clients",
  "products",
  "aromas",
  "opportunities",
  "quotes",
  "orders",
  "samples",
  "appointments",
  "tasks",
  "notifications",
  "conversations",
  "audit_log",
  "crm_settings",
];

const syncedRows = new WeakMap();

function rowMap(rows: any) {
  return Object.fromEntries(Object.entries(rows as Record<string, any[]>).map(([table, collection]) => [
    table, new Map(collection.map((row) => [row.id || row.workspace_id, row])),
  ]));
}

export async function loadCloudState(context, client = supabase) {
  if (localBackend) return local.load(context, toRows, fromRows);
  const results = await Promise.all(
    tables.map(async (table) => {
      if (table === "crm_settings") {
        return [table, assert(await client.from(table).select("*")
          .eq("workspace_id", context.workspace.id).limit(1))];
      }
      const rows = [];
      // Stay below PostgREST's configured 1000-row response limit.
      const pageSize = 500;
      for (let offset = 0; ; offset += pageSize) {
        const page = assert(await client.from(table).select("*")
          .eq("workspace_id", context.workspace.id).order("id")
          .range(offset, offset + pageSize - 1));
        rows.push(...page);
        if (page.length < pageSize) break;
      }
      return [table, rows];
    }),
  );
  const state = fromRows(Object.fromEntries(results), context.roleLabel);
  syncedRows.set(context, rowMap(toRows(state, context.workspace.id)));
  return state;
}

const upsertOptions = (table) => ({
  onConflict: table === "crm_settings" ? "workspace_id" : "workspace_id,id",
});

export async function pushCloudState(state, context, client = supabase) {
  if (localBackend) return local.push(state, context, toRows);
  const rows = toRows(state, context.workspace.id);
  const baseline = syncedRows.get(context) || rowMap(
    Object.fromEntries(tables.map((table) => [table, []])),
  );
  syncedRows.set(context, baseline);
  const allowed =
    context.role === "sales"
      ? [
          "clients",
          "opportunities",
          "quotes",
          "orders",
          "samples",
          "appointments",
          "tasks",
          "notifications",
          "conversations",
          "audit_log",
        ]
      : context.role === "production"
        ? []
        : tables;

  for (const table of allowed) {
    if (!rows[table]?.length) continue;
    if (table === "crm_settings") {
      const [settings] = rows.crm_settings;
      if (JSON.stringify(baseline[table].get(settings.workspace_id)) === JSON.stringify(settings)) continue;
      assert(
        await client
          .from("crm_settings")
          .update({
            discount_limit: settings.discount_limit,
            initialized: settings.initialized,
          })
          .eq("workspace_id", context.workspace.id)
          .select("workspace_id").single(),
      );
      baseline[table].set(settings.workspace_id, settings);
      continue;
    }
    const appendOnly =
      table === "audit_log" ||
      (context.role === "sales" && ["orders", "notifications"].includes(table));
    const inserted = [];
    for (const row of rows[table]) {
      const previous = baseline[table].get(row.id);
      if (!previous) {
        inserted.push(row);
        continue;
      }
      if (appendOnly) continue;
      const changes = Object.fromEntries(Object.entries(row).filter(
        ([key, value]) => JSON.stringify(value) !== JSON.stringify(previous[key]),
      ));
      if (!Object.keys(changes).length) continue;
      assert(await client.from(table).update(changes)
        .eq("workspace_id", context.workspace.id).eq("id", row.id)
        .select("id").single());
      baseline[table].set(row.id, row);
    }
    if (inserted.length) {
      assert(await client.from(table).upsert(inserted, {
        ...upsertOptions(table), ignoreDuplicates: appendOnly,
      }));
      for (const row of inserted) baseline[table].set(row.id, row);
    }
  }
}

export async function updateProductionOrder(order, context, client = supabase) {
  if (localBackend) return local.pack(order, context);
  if (context.role !== "production") return;
  if (order.status !== "Empacado") throw new Error("Producción solo puede registrar el empaque.");
  // The RPC commits the stage, notification and audit entry in one transaction.
  return assert(await client.rpc("pack_order", {
    target_workspace: context.workspace.id, target_order: order.id,
  }));
}

export async function deleteCloudRecord(table, id, context) {
  if (localBackend) return local.remove(table, id, context);
  if (!context || context.role === "production") return;
  assert(
    await supabase
      .from(table)
      .delete()
      .eq("workspace_id", context.workspace.id)
      .eq("id", id),
  );
  syncedRows.get(context)?.[table]?.delete(id);
}
