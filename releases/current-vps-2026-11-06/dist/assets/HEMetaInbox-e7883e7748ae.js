import { n as e, s as t } from "./index-BJtJ20xs-inbox-pf20261106-meta-71d485e6495d-ed-e7883e7748ae.js";
var { useState: n, useEffect: r, useMemo: i, useRef: a, useCallback: o } = t();
//#endregion
//#region src/meta-inbox-api.ts
function s(e) {
	return e.sendEnabled === !1 ? "Esta cuenta aún no está habilitada para enviar. Puedes preparar tu respuesta como borrador." : e.windowOpen === !1 ? e.thread.last_inbound_at ? "La ventana de 24 horas terminó. Puedes escribir un borrador; para enviarlo, el cliente debe volver a escribir por este canal." : "No hay un mensaje reciente recibido de Meta para este chat. Puedes escribir un borrador; el envío requiere que llegue un mensaje del cliente por este canal." : e.humanStatus === "pending" ? "Tu borrador está disponible. Espera la confirmación de la pausa de SARA para enviarlo." : e.humanStatus === "releasing" ? "Se está devolviendo el chat a SARA. Puedes seguir preparando tu borrador." : e.humanStatus === "error" ? "No se confirmó la pausa de SARA. Pulsa Tomar conversación para volver a intentarlo antes de enviar." : e.humanStatus && e.humanStatus !== "human" ? "Escribe tu respuesta y pulsa Tomar conversación. El envío se habilitará al confirmar la pausa de SARA." : e.canReply ? "Puedes enviar tu respuesta. Dirección atiende este chat y la ventana de respuesta está abierta." : "Puedes escribir un borrador. El envío está pendiente de confirmar la recepción reciente y la atención de Dirección.";
}
async function c(e, t, n) {
	let r = await fetch(`/api/meta-inbox/${e}`, {
		method: t === void 0 ? "GET" : "POST",
		credentials: "same-origin",
		cache: "no-store",
		signal: n,
		headers: t === void 0 ? {} : { "Content-Type": "application/json" },
		body: t === void 0 ? void 0 : JSON.stringify(t)
	}), i = await r.json().catch(() => ({ error: "La bandeja devolvió una respuesta inválida." }));
	if (!r.ok) throw Object.assign(Error(i.error || "No se pudo cargar la bandeja."), { status: r.status });
	return i;
}
function l(e, t) {
	let n = new Map(e.map((e) => [e.id, e]));
	for (let e of t) n.set(e.id, e);
	return [...n.values()].sort((e, t) => e.occurred_at.localeCompare(t.occurred_at) || e.id.localeCompare(t.id));
}
var u = {
	whatsapp: "WhatsApp",
	messenger: "Messenger",
	instagram: "Instagram"
}, d = {
	received: "Recibido",
	queued: "En cola",
	sending: "Enviando",
	accepted: "Aceptado por Meta",
	delivered: "Entregado",
	read: "Leído",
	failed: "Envío fallido",
	unknown: "Resultado sin confirmar: revisa el canal antes de reenviar",
	historical: "Historial importado"
};
function f(e) {
	let t = new Map((e.clients || []).map((e) => [e.id, e])), n = /* @__PURE__ */ new Map(), r = [];
	for (let i of e.conversations || []) {
		let e = t.get(i.clientId);
		if (!e) continue;
		let a = String(e.channel || e.sara?.canal_origen || "").toLowerCase(), o = a === "whatsapp" ? "whatsapp" : [
			"facebook",
			"messenger",
			"facebook messenger"
		].includes(a) ? "messenger" : a === "instagram" ? "instagram" : null;
		if (!o) continue;
		let s = String(e.sara?.whatsapp_id || "").split(":"), c = (i.messages || []).map((e, t) => ({
			id: `legacy-message-${i.id}-${t}`,
			direction: e.by === "Cliente" ? "inbound" : "outbound",
			actor: e.by === "Cliente" ? "client" : e.by === "Sara IA" ? "sara" : e.by === "Asesor" ? "human" : "channel",
			body: String(e.text || ""),
			status: e.deliveryStatus || "historical",
			occurred_at: e.at || "",
			attachments: Array.isArray(e.attachments) ? e.attachments : []
		})), l = {
			id: `legacy:${i.id}`,
			client_id: e.id,
			name: e.name || e.contact || "Contacto",
			channel: o,
			account_id: s.length === 3 ? s[1] : "",
			preview: c.at(-1)?.body || i.summary || "",
			last_inbound_at: null,
			updated_at: c.at(-1)?.occurred_at || e.sara?.ultima_interaccion || e.created || "",
			canReply: !1,
			summary: i.summary || ""
		};
		r.push(l), n.set(l.id, {
			thread: l,
			messages: c,
			sendEnabled: !1,
			canReply: !1,
			nextOffset: null
		});
	}
	return r.sort((e, t) => t.updated_at.localeCompare(e.updated_at)), {
		threads: r,
		histories: n
	};
}
var { jsx: p, jsxs: m, Fragment: h } = e(), g = (e) => {
	let t = new Date(e);
	return Number.isNaN(t.getTime()) ? "Fecha no disponible" : new Intl.DateTimeFormat("es-MX", {
		dateStyle: "medium",
		timeStyle: "short",
		timeZone: "America/Mazatlan"
	}).format(t);
};
function _({ state: e, onContact: t, drafts: _, setDrafts: y }) {
	let [ee, b] = n([]), [x, S] = n(""), [C, w] = n("all"), [T, te] = n(""), [E, D] = n(null), [O, k] = n(""), [A, j] = n(""), [M, N] = n(!0), [P, F] = n(!1), [I, L] = n(null), [R, z] = n(!1), [B, V] = n(!1), H = i(() => f(e), [e.clients, e.conversations]), U = a(!0), W = a(0), G = a(null), K = a(_), q = a(!1);
	K.current = _;
	let J = o(async (e) => {
		let t;
		try {
			t = await c("threads", void 0, e);
		} catch (t) {
			if ((t.status === 404 || t.status === 503) && !e?.aborted) {
				V(!0), k(""), N(!1);
				return;
			}
			throw t;
		}
		U.current && !e?.aborted && (b((e) => {
			let n = new Map(t.threads.map((e) => [e.id, e]));
			return [...t.threads, ...e.filter((e) => !n.has(e.id))];
		}), L((e) => e === null ? t.nextOffset : e), V(!1), S((e) => e && !e.startsWith("legacy:") ? e : t.threads[0]?.id || ""), k(""), N(!1));
	}, []);
	r(() => {
		U.current = !0;
		let e = new AbortController(), t = async () => {
			if (!(document.hidden || B)) try {
				await J(e.signal);
			} catch (t) {
				!e.signal.aborted && U.current && (k(t.message), N(!1));
			}
		};
		t();
		let n = setInterval(t, 1e4);
		return () => {
			U.current = !1, e.abort(), clearInterval(n);
		};
	}, [J, B]), r(() => {
		B && (b(H.threads), L(null), S((e) => H.histories.has(e) ? e : H.threads[0]?.id || ""));
	}, [B, H]), r(() => {
		let e = (e) => {
			Object.values(K.current).some((e) => e.text.trim()) && e.preventDefault();
		};
		return window.addEventListener("beforeunload", e), () => window.removeEventListener("beforeunload", e);
	}, []), r(() => {
		if (!x) return;
		if (B) {
			D(H.histories.get(x) || null);
			return;
		}
		let e = ++W.current, t = new AbortController();
		D(null);
		let n = async () => {
			if (!document.hidden) try {
				let n = await c(`threads/${x}`, void 0, t.signal);
				!t.signal.aborted && W.current === e && D((e) => e?.thread.id === x ? {
					...n,
					messages: l(e.messages, n.messages),
					nextOffset: e.nextOffset
				} : n);
			} catch (n) {
				!t.signal.aborted && W.current === e && k(n.message);
			}
		};
		n();
		let r = setInterval(n, 5e3);
		return () => {
			t.abort(), clearInterval(r);
		};
	}, [
		x,
		B,
		H
	]);
	let Y = async () => {
		if (!(I === null || R)) {
			z(!0);
			try {
				let e = await c(`threads?offset=${I}`);
				U.current && (b((t) => [...new Map([...t, ...e.threads].map((e) => [e.id, e])).values()]), L(e.nextOffset));
			} catch (e) {
				k(e.message);
			} finally {
				z(!1);
			}
		}
	}, X = async () => {
		if (!E || E.nextOffset === null || R) return;
		let e = x;
		z(!0);
		try {
			let t = await c(`threads/${e}?offset=${E.nextOffset}`);
			D((n) => n?.thread.id === e ? {
				...n,
				messages: l(t.messages, n.messages),
				nextOffset: t.nextOffset
			} : n);
		} catch (e) {
			k(e.message);
		} finally {
			z(!1);
		}
	}, Z = _[x]?.text || "", ne = async () => {
		if (B || q.current || !Z.trim() || !E?.canReply) return;
		let e = x, t = _[e] || {
			text: Z,
			requestId: crypto.randomUUID()
		};
		q.current = !0, F(!0), k(""), j(""), y((n) => ({
			...n,
			[e]: t
		}));
		try {
			let n = await c(`threads/${e}/messages`, {
				text: t.text,
				requestId: t.requestId
			});
			y((t) => ({
				...t,
				[e]: {
					text: "",
					requestId: crypto.randomUUID()
				}
			})), j(`${d[n.status] || n.status}. La aceptación de Meta y la entrega se mostrarán en el historial.`);
			let r = await c(`threads/${e}`);
			D((t) => t?.thread.id === e ? {
				...r,
				messages: l(t.messages, r.messages)
			} : t);
		} catch (e) {
			k(`${e.message} Si la solicitud perdió la conexión, conserva este borrador y consulta el historial antes de repetirla.`), requestAnimationFrame(() => G.current?.focus());
		} finally {
			q.current = !1, F(!1);
		}
	}, re = async () => {
		if (!P) {
			F(!0), k("");
			try {
				let e = await c("import-history", {});
				j(`${e.imported} mensajes incorporados. ${e.skippedConversations} conversaciones sin cuenta o identidad inequívoca se conservan en el historial anterior.`), await J();
			} catch (e) {
				k(e.message);
			} finally {
				F(!1);
			}
		}
	}, ie = async (e) => {
		if (!(P || B)) {
			F(!0), k("");
			try {
				await c(`threads/${x}/control`, { human: e });
				let t = await c(`threads/${x}`);
				D(t), j(e ? "Pausando a SARA para que Dirección atienda este chat. La confirmación puede tardar hasta un minuto." : "Devolviendo la conversación. Se conservará cualquier pausa anterior de SARA.");
			} catch (e) {
				k(e.message);
			} finally {
				F(!1);
			}
		}
	}, Q = ee.filter((e) => (C === "all" || e.channel === C) && `${e.name} ${e.preview || ""}`.toLocaleLowerCase("es").includes(T.toLocaleLowerCase("es"))), $ = E?.thread;
	return /* @__PURE__ */ m("div", {
		className: "meta-inbox",
		children: [
			/* @__PURE__ */ p("header", {
				className: "commercial-head",
				children: /* @__PURE__ */ m("div", { children: [/* @__PURE__ */ p("h1", { children: "Conversaciones" }), /* @__PURE__ */ p("p", { children: B ? "Consulta el historial de WhatsApp, Messenger e Instagram registrado por SARA." : "Atiende a tus clientes de WhatsApp, Messenger e Instagram desde Hotel Expert." })] })
			}),
			O && /* @__PURE__ */ p("p", {
				className: "meta-error",
				role: "alert",
				tabIndex: -1,
				ref: G,
				children: O
			}),
			/* @__PURE__ */ p("p", {
				role: "status",
				className: "meta-notice",
				children: A || (M ? "Cargando conversaciones…" : B ? "Conexión de Meta pendiente de activación. El historial sigue disponible; el envío desde el CRM aún está deshabilitado." : "Los estados reflejan la información recibida de Meta.")
			}),
			/* @__PURE__ */ m("div", {
				className: "meta-layout",
				children: [/* @__PURE__ */ m("aside", {
					className: "meta-contacts",
					"aria-label": "Conversaciones por canal",
					children: [
						/* @__PURE__ */ p("label", {
							htmlFor: "inbox-search",
							children: "Buscar en conversaciones cargadas"
						}),
						/* @__PURE__ */ p("input", {
							id: "inbox-search",
							name: "inboxSearch",
							type: "search",
							autoComplete: "off",
							value: T,
							onChange: (e) => te(e.target.value),
							placeholder: "Nombre o mensaje…"
						}),
						/* @__PURE__ */ p("label", {
							htmlFor: "inbox-channel",
							children: "Canal"
						}),
						/* @__PURE__ */ m("select", {
							id: "inbox-channel",
							name: "inboxChannel",
							value: C,
							onChange: (e) => w(e.target.value),
							children: [/* @__PURE__ */ p("option", {
								value: "all",
								children: "Todos los canales"
							}), Object.entries(u).map(([e, t]) => /* @__PURE__ */ p("option", {
								value: e,
								children: t
							}, e))]
						}),
						/* @__PURE__ */ p("ul", {
							className: "meta-thread-list",
							children: Q.map((e) => /* @__PURE__ */ p("li", { children: /* @__PURE__ */ m("button", {
								className: x === e.id ? "is-selected" : "",
								"aria-current": x === e.id ? "true" : void 0,
								onClick: () => {
									S(e.id), k(""), j("");
								},
								children: [
									/* @__PURE__ */ p("span", {
										className: `meta-channel ${e.channel}`,
										children: u[e.channel]
									}),
									/* @__PURE__ */ p("strong", { children: e.name }),
									/* @__PURE__ */ p("span", {
										className: "meta-preview",
										children: e.preview || "Sin texto registrado"
									}),
									/* @__PURE__ */ p("time", {
										dateTime: e.updated_at,
										children: g(e.updated_at)
									})
								]
							}) }, e.id))
						}),
						!M && !Q.length && /* @__PURE__ */ p("p", { children: "No hay conversaciones en este filtro. Los nuevos mensajes aparecerán después de activar la conexión y recibir un mensaje real." }),
						I !== null && /* @__PURE__ */ p("button", {
							disabled: R,
							onClick: Y,
							children: R ? "Cargando…" : "Cargar más conversaciones"
						})
					]
				}), /* @__PURE__ */ p("section", {
					className: "meta-conversation",
					"aria-label": "Historial y respuesta",
					"aria-busy": P,
					children: $ ? /* @__PURE__ */ m(h, { children: [
						/* @__PURE__ */ m("header", {
							className: "meta-thread-head",
							children: [/* @__PURE__ */ m("div", { children: [
								/* @__PURE__ */ p("span", {
									className: `meta-channel ${$.channel}`,
									children: u[$.channel]
								}),
								/* @__PURE__ */ p("h2", { children: $.name }),
								$.account_id && /* @__PURE__ */ m("small", { children: ["Cuenta ", $.account_id] })
							] }), /* @__PURE__ */ p("button", {
								onClick: () => t($.client_id),
								children: "Ver contacto"
							})]
						}),
						/* @__PURE__ */ m("div", {
							className: "meta-history",
							role: "region",
							"aria-label": "Mensajes de la conversación",
							tabIndex: 0,
							children: [
								E.nextOffset !== null && /* @__PURE__ */ p("button", {
									disabled: R,
									onClick: X,
									children: R ? "Cargando…" : "Cargar mensajes anteriores"
								}),
								$.summary && /* @__PURE__ */ m("section", { children: [/* @__PURE__ */ p("h3", { children: "Resumen de SARA" }), /* @__PURE__ */ p("p", { children: $.summary })] }),
								E.messages.map((e) => /* @__PURE__ */ p(v, {
									message: e,
									historical: B
								}, e.id)),
								!E.messages.length && /* @__PURE__ */ p("p", { children: "No hay mensajes guardados en esta conversación." })
							]
						}),
						!B && E.sendEnabled && /* @__PURE__ */ m("div", {
							className: "meta-compose",
							children: [/* @__PURE__ */ p("p", {
								role: "status",
								children: E.humanStatus === "human" ? "Dirección atiende este chat. SARA está en pausa." : E.humanStatus === "pending" ? "Esperando que termine la respuesta en curso de SARA y se confirme la pausa…" : E.humanStatus === "releasing" ? "Devolviendo el control a SARA…" : E.humanStatus === "error" ? "No se pudo confirmar el control. Vuelve a intentarlo." : "Toma la conversación antes de responder para pausar a SARA."
							}), /* @__PURE__ */ p("button", {
								onClick: () => ie(E.humanStatus !== "human"),
								disabled: P || E.humanStatus === "pending" || E.humanStatus === "releasing",
								children: E.humanStatus === "human" ? "Devolver a SARA" : "Tomar conversación"
							})]
						}),
						/* @__PURE__ */ m("form", {
							className: "meta-compose",
							onSubmit: (e) => {
								e.preventDefault(), ne();
							},
							children: [
								/* @__PURE__ */ p("p", {
									id: "inbox-window",
									role: "status",
									children: s(E)
								}),
								/* @__PURE__ */ m("label", {
									htmlFor: "inbox-reply",
									children: ["Respuesta por ", u[$.channel]]
								}),
								/* @__PURE__ */ p("textarea", {
									id: "inbox-reply",
									name: "reply",
									autoComplete: "off",
									"aria-describedby": "inbox-window inbox-count inbox-draft",
									value: Z,
									maxLength: 1e3,
									rows: 3,
									disabled: P,
									onChange: (e) => y((t) => ({
										...t,
										[x]: {
											text: e.target.value,
											requestId: crypto.randomUUID()
										}
									}))
								}),
								/* @__PURE__ */ p("small", {
									id: "inbox-draft",
									children: "El borrador se conserva mientras esta bandeja siga abierta."
								}),
								/* @__PURE__ */ m("div", {
									className: "meta-compose-actions",
									children: [/* @__PURE__ */ m("small", {
										id: "inbox-count",
										children: [Z.length, "/1000 caracteres"]
									}), /* @__PURE__ */ p("button", {
										className: "primary",
										"aria-describedby": "inbox-window",
										title: E.canReply ? void 0 : s(E),
										disabled: P || !E.canReply || !Z.trim(),
										children: P ? "Guardando respuesta…" : "Enviar respuesta"
									})]
								})
							]
						})
					] }) : /* @__PURE__ */ m("div", {
						className: "meta-empty",
						children: [/* @__PURE__ */ p("h2", { children: x ? "Cargando conversación…" : "Selecciona una conversación" }), /* @__PURE__ */ p("p", { children: "El canal de origen y su contacto se conservan en cada conversación." })]
					})
				})]
			}),
			/* @__PURE__ */ m("details", {
				className: "meta-legacy",
				children: [
					/* @__PURE__ */ m("summary", { children: [
						"Historial anterior de SARA (",
						e.conversations?.length || 0,
						" conversaciones)"
					] }),
					/* @__PURE__ */ p("p", { children: "Este historial conserva los registros existentes. Incorporarlo a la bandeja requiere una identidad del canal y una única cuenta configurada." }),
					/* @__PURE__ */ p("button", {
						onClick: re,
						disabled: P || B,
						children: "Incorporar historial a la bandeja"
					}),
					(e.conversations || []).map((t) => /* @__PURE__ */ m("details", { children: [
						/* @__PURE__ */ m("summary", { children: [
							e.clients.find((e) => e.id === t.clientId)?.name || "Contacto",
							" · ",
							t.messages?.length || 0,
							" mensajes"
						] }),
						t.summary && /* @__PURE__ */ p("p", { children: t.summary }),
						(t.messages || []).map((e, t) => /* @__PURE__ */ m("article", { children: [
							/* @__PURE__ */ p("strong", { children: e.by }),
							e.at && /* @__PURE__ */ m("time", {
								dateTime: e.at,
								children: [" ", g(e.at)]
							}),
							/* @__PURE__ */ p("p", { children: e.text }),
							e.attachments?.length > 0 && /* @__PURE__ */ m("p", { children: [e.attachments.length, " adjunto(s) registrados en origen"] })
						] }, t))
					] }, t.id))
				]
			})
		]
	});
}
function v({ message: e, historical: t = !1 }) {
	return /* @__PURE__ */ m("article", {
		className: `meta-message ${e.direction}`,
		children: [
			/* @__PURE__ */ m("header", { children: [/* @__PURE__ */ p("strong", { children: e.direction === "inbound" ? "Cliente" : e.actor === "human" ? "Dirección" : e.actor === "sara" ? "SARA" : "Cuenta del canal" }), /* @__PURE__ */ p("time", {
				dateTime: e.occurred_at,
				children: g(e.occurred_at)
			})] }),
			/* @__PURE__ */ p("p", { children: e.body || (e.attachments.length ? "Adjunto" : "Mensaje sin texto disponible") }),
			e.attachments.map((n, r) => t ? /* @__PURE__ */ m("small", { children: ["Adjunto registrado: ", n.name || n.type || "archivo"] }, r) : /* @__PURE__ */ m("a", {
				className: "meta-attachment",
				href: `/api/meta-inbox/attachments/${e.id}/${r}`,
				target: "_blank",
				rel: "noreferrer",
				children: [
					"Descargar ",
					n.name || n.type || "adjunto",
					/* @__PURE__ */ p("span", {
						className: "sr-only",
						children: " en una pestaña nueva"
					})
				]
			}, r)),
			/* @__PURE__ */ p("small", { children: d[e.status] || "Estado no disponible" }),
			e.error_code && e.status === "failed" && /* @__PURE__ */ m("p", {
				className: "meta-delivery-error",
				children: ["Meta rechazó el envío. Revisa la cuenta y la ventana de respuesta. Código: ", e.error_code]
			})
		]
	});
}
//#endregion
export { _ as MetaInbox };
