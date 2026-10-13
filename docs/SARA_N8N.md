# CRM local conectado a SARA IA

Configurar `VITE_BACKEND=n8n` en `.env.local` y ejecutar `npm run dev`.
La aplicación escucha en `http://127.0.0.1:5173`. Requiere Node.js 24 para el almacenamiento SQLite incorporado.

El servidor consulta el workflow **SARA IA — Sincronización CRM local** (`UMW0FWPOD5kNzX5W`), creado en el proyecto personal ANLUX AGENCY. La configuración privada se guarda en `.local/sara-connection.json`; contiene la URL y el token, nunca variables `VITE_*`. La tabla fuente es `hotel_expert_crm` (`3KbSf6TVLlYZEV16`). La autenticación del exportador valida el SHA-256 del token antes de leer datos; respuestas y ejecuciones del exportador no guardan las credenciales en registros.

## Persistencia y captura

Los campos completos de cada contacto se conservan en `.local/sara-crm.sqlite`, junto con las ediciones locales del equipo. El frontend muestra todos los campos actuales y los adicionales que aparezcan en n8n. Solo los campos editados localmente se superponen al contacto, de modo que los demás continúen recibiendo actualizaciones de SARA.

La sincronización importa la instantánea completa sin limitarse a 100 contactos. Mientras el CRM está abierto y visible, consulta su servidor cada minuto; este consulta n8n como máximo cada cinco minutos. **Actualizar desde SARA** fuerza una consulta. El cierre de la pantalla detiene la consulta automática, pero la captura de mensajes en n8n continúa. La importación es idempotente y no borra datos locales cuando falla la conexión.

WhatsApp (`nn9pJ7avh8XyFuIJ`) y Messenger/Instagram (`ep2x61FAuh6VIK1t`) guardan los mensajes en `sara_crm_message_history` (`sIrvYd7EQQpy3kMC`) antes del modelo. Después de una generación correcta guardan la respuesta generada. No se confunde esa generación con confirmación de entrega del canal. Un error de guardado del historial continúa el flujo original y queda en la ejecución; no bloquea la respuesta al cliente. Los borradores comerciales previos se conservan separados de las versiones publicadas.

Un contacto nuevo recibido antes de que el modelo lo analice aparece con datos básicos y **Pendiente de análisis de SARA**. Las solicitudes de cotización, muestra y pedido conservan sus estados reales; una solicitud o comprobante no genera automáticamente una venta, pago validado o pedido en producción. Solo se proyectan citas con ID de Calendar, estado confirmado y fecha válida. El historial anterior disponible es el resumen comercial; el historial de mensajes completo comienza a partir de esta conexión.

El catálogo contiene los siete precios y diez aromas documentados por el titular el 12/10/2026. No incluye existencias, SKU, cobertura no documentada ni compatibilidad de fragancias inventados. Los precios son referencias en MXN más IVA. La compatibilidad para una cotización formal requiere confirmación comercial.

## Límites

Esta instalación es de acceso local en una sola computadora; no sustituye la autenticación multiusuario del backend PostgreSQL/Supabase. La API rechaza acceso no local y orígenes externos, y Vite bloquea `.local`, `.env`, `.git` y logs. No publicar el servidor de desarrollo ni abrir su puerto a Internet.

La conexión captura de n8n hacia el CRM. Las ediciones del equipo se guardan localmente; no se envían automáticamente a SARA, ni se envían chats, se validan pagos o se pausa el agente desde esta integración.

Los modelos de SARA siguen pendientes por los créditos agotados del Gateway; Gemini permanece pendiente por la restricción del proyecto de Google. Eso impide análisis y respuesta de IA, pero no la captura previa del mensaje.

Verificación: prueba real de WhatsApp con Elizabeth, ejecución 439; los nodos de captura y guardado del mensaje terminaron correctamente antes del error de créditos en SARA. Se comprobaron el rechazo del exportador sin token, la protección de los archivos privados y del origen, persistencia, campos futuros, conflictos de revisión, deduplicación y continuidad de identidad al analizar un nuevo contacto. Pasaron 32 pruebas, la comprobación de sintaxis/TypeScript y la compilación.

## Respaldo

Usar **Exportar datos** para una copia legible del CRM. Para respaldar SQLite en caliente, usar su API de respaldo; no copiar solo el archivo principal mientras existan archivos WAL activos. Guardar la configuración de conexión por separado y mantenerla fuera de Git y del frontend.
