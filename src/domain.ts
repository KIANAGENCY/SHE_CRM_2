import { orderStages, sampleStages } from "./data.ts";
export const uid = (prefix) =>
  `${prefix}-${globalThis.crypto.randomUUID().slice(0, 8)}`;
export function audit(state, action) {
  state.audit.unshift({
    id: uid("evt"),
    at: new Date().toISOString(),
    actor: state.role,
    action,
  });
}
export function money(value) {
  return new Intl.NumberFormat("es-MX", {
    style: "currency",
    currency: "MXN",
    maximumFractionDigits: 2,
  }).format(value);
}
export function totals(lines, discount = 0, limit = 0) {
  if (
    !lines.length ||
    lines.some(
      (l) =>
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0 ||
        !Number.isInteger(l.quantity) ||
        !Number.isFinite(l.price) ||
        l.price < 0,
    )
  )
    throw new Error(
      "Revisa productos, precios y cantidades enteras mayores que cero.",
    );
  if (
    !Number.isFinite(discount) ||
    discount < 0 ||
    discount > 100 ||
    discount > limit
  )
    throw new Error(
      `El descuento autorizado es de hasta ${limit}%. Solicita revisión de dirección.`,
    );
  const subtotal =
    Math.round(lines.reduce((sum, l) => sum + l.price * l.quantity, 0) * 100) /
    100;
  return {
    subtotal,
    discount,
    total: Math.round(subtotal * (1 - discount / 100) * 100) / 100,
  };
}
export function requestSample(state, opportunityId) {
  const op = state.opportunities.find((o) => o.id === opportunityId);
  if (!op) throw new Error("Selecciona una oportunidad.");
  const existing = state.samples.find(
    (s) => s.opportunityId === op.id && s.status !== "Evaluada",
  );
  op.route = "sample";
  op.next = "Dar seguimiento a muestra";
  if (existing) return existing;
  const sample = {
    id: uid("M"),
    opportunityId: op.id,
    clientId: op.clientId,
    status: "Solicitada",
    aroma: "Por confirmar",
    tracking: "",
    result: "",
  };
  state.samples.push(sample);
  audit(state, `Muestra opcional solicitada: ${sample.id}`);
  return sample;
}
export function directRoute(state, id) {
  const op = state.opportunities.find((o) => o.id === id);
  if (!op) throw new Error("Oportunidad no encontrada.");
  op.route = "direct";
  op.next = "Preparar cotización sin esperar muestra";
  audit(state, `Venta directa: ${id}`);
}
export function createOrder(state, quoteId, confirmed) {
  const q = state.quotes.find((q) => q.id === quoteId);
  if (!q) throw new Error("Cotización no encontrada.");
  const existing = state.orders.find((o) => o.quoteId === quoteId);
  if (existing) return existing;
  if (!confirmed)
    throw new Error(
      "Confirma la aceptación del cliente antes de crear el pedido.",
    );
  if (q.status !== "Aceptada")
    throw new Error("La cotización debe estar aceptada.");
  const order: any = {
    id: uid("HE"),
    clientId: q.clientId,
    quoteId,
    total: q.total,
    status: "Por autorizar",
    confirmed: true,
    created: new Date().toISOString().slice(0, 10),
    due: "",
    tracking: "",
    channel: q.channel,
    invoiceAmount: 0,
  };
  state.orders.push(order);
  const op = state.opportunities.find(
    (o) =>
      o.clientId === q.clientId &&
      !state.orders.some((order) => order.opportunityId === o.id),
  );
  if (op) {
    op.stage = 3;
    op.next = "Revisión administrativa";
    order.opportunityId = op.id;
  }
  notify(state, order, "Pedido confirmado");
  audit(state, `Pedido confirmado: ${order.id}`);
  return order;
}
function notify(state, order, event) {
  const key = `${order.id}:${event}`;
  if (!state.notifications.some((n) => n.key === key))
    state.notifications.unshift({
      id: uid("aviso"),
      key,
      orderId: order.id,
      event,
      status: "Pendiente de integración",
      at: new Date().toISOString(),
    });
}
export function advanceOrder(state, id, tracking = "") {
  const order = state.orders.find((o) => o.id === id);
  if (!order) throw new Error("Pedido no encontrado.");
  const index = orderStages.indexOf(order.status);
  if (index < 0 || index === orderStages.length - 1)
    throw new Error("No hay otra etapa disponible.");
  if (
    order.status === "Por autorizar" &&
    !["Dirección", "Administración"].includes(state.role)
  )
    throw new Error("Administración debe autorizar antes de producción.");
  if (
    order.status === "En producción" &&
    !["Dirección", "Administración", "Producción"].includes(state.role)
  )
    throw new Error(
      "Solo producción o administración pueden registrar el empaque.",
    );
  if (order.status === "Empacado") {
    if (!["Dirección", "Administración"].includes(state.role))
      throw new Error("Administración captura la guía de envío.");
    if (!tracking.trim())
      throw new Error("Captura la guía antes de despachar.");
    order.tracking = tracking.trim();
  }
  if (
    order.status === "En tránsito" &&
    !["Dirección", "Administración"].includes(state.role)
  )
    throw new Error("Administración confirma la entrega.");
  order.status = orderStages[index + 1];
  if (order.status === "Entregado") {
    order.delivered = new Date().toISOString().slice(0, 10);
    state.clients.find((c) => c.id === order.clientId).lastOrder =
      order.delivered;
  }
  notify(state, order, order.status);
  audit(state, `${order.id}: ${order.status}`);
  return order;
}
export function advanceSample(state, id, tracking = "", result = "") {
  const s = state.samples.find((s) => s.id === id);
  if (!s) throw new Error("Muestra no encontrada.");
  if (
    s.status === "Solicitada" &&
    !["Dirección", "Administración"].includes(state.role)
  )
    throw new Error("Administración autoriza la muestra.");
  if (s.status === "En preparación") {
    if (!["Dirección", "Administración"].includes(state.role))
      throw new Error("Administración registra el envío.");
    if (!tracking.trim()) throw new Error("Captura la guía de la muestra.");
    s.tracking = tracking.trim();
  }
  if (s.status === "En evaluación") {
    if (!result.trim()) throw new Error("Registra el resultado de la prueba.");
    s.result = result.trim();
  }
  const i = sampleStages.indexOf(s.status);
  if (i < 0 || i === sampleStages.length - 1)
    throw new Error("Muestra ya evaluada.");
  s.status = sampleStages[i + 1];
  audit(state, `${id}: ${s.status}`);
}
export function book(state, appointment) {
  const start = new Date(appointment.start).getTime(),
    duration = Number(appointment.duration);
  if (
    !appointment.owner ||
    !appointment.clientId ||
    !Number.isFinite(start) ||
    start <= Date.now() ||
    !Number.isFinite(duration) ||
    duration <= 0
  )
    throw new Error(
      "Selecciona vendedor, cliente, fecha futura y duración válida.",
    );
  const end = start + duration * 60000;
  if (
    state.appointments.some(
      (a) =>
        a.owner === appointment.owner &&
        start < new Date(a.start).getTime() + a.duration * 60000 &&
        end > new Date(a.start).getTime(),
    )
  )
    throw new Error("El vendedor ya tiene una cita en ese horario.");
  state.appointments.push({ ...appointment, duration, id: uid("cita") });
  audit(state, "Cita agendada sin conflicto");
}
export function dormantClients(state, now = new Date()) {
  return state.clients.filter(
    (c) => c.lastOrder && (now.getTime() - new Date(c.lastOrder).getTime()) / 86400000 > 30,
  );
}
export function responseFor(message, state, human = false) {
  if (human) return null;
  const s = message.toLowerCase();
  if (/persona|humano|vendedor|descuento|queja/.test(s))
    return {
      handoff: true,
      text: "Transferiré la atención al vendedor con el resumen de la conversación. Sara queda en pausa.",
    };
  if (/aroma|elah|cobertura|env[ií]o|rep[uú]blica/.test(s))
    return {
      text: "Necesito consultar la ficha comercial aprobada para confirmar aromas, Sistema ELAH, cobertura y plazos. El catálogo real aún está pendiente de cargar. Puedo solicitar apoyo de ventas.",
    };
  if (/muestra/.test(s))
    return {
      text: "La muestra es opcional. Puedes cotizar y comprar directamente; si prefieres probar, registra una solicitud vinculada a la oportunidad.",
    };
  if (/precio|costo|cotiza/.test(s))
    return {
      text: `Precios de demostración: ${state.products.map((p) => `${p.name} ${p.size}: ${money(p.price)}`).join("; ")}. Confirma cantidades y aroma antes de preparar la propuesta.`,
    };
  return {
    text: "¿Qué áreas del hotel deseas atender, qué cantidades necesitas y para cuándo? Podemos seguir por venta directa o solicitar una muestra opcional.",
  };
}
