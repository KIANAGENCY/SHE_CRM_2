# Revisión y correcciones de backend

Fecha: 9 de octubre de 2026.

## Diagnóstico

- El error de la captura ocurre al cargar los módulos de `index.html` desde
  `file://`. El proyecto requiere Vite por HTTP, incluso en modo local.
- Vite no ejecutaba las funciones de `api/`; las peticiones locales recibían
  contenido estático en lugar de las respuestas del backend.
- El webhook directo de Meta no autenticaba los POST. Tampoco había manejo
  uniforme de JSON inválido, límites de entrada o configuración incorrecta.
- La sincronización enviaba el estado completo en cada guardado y podía
  sobrescribir campos sin cambios locales. La carga no paginaba las tablas.
- `initialized = false` provocaba una importación automática de la demostración
  sobre un espacio conectado, incluso si ya contenía datos o el usuario carecía
  de permisos para importar catálogo y ajustes.
- Producción actualizaba una fila completa y sus avisos/auditoría no se
  sincronizaban. El cambio a empaque ahora se realiza mediante `pack_order`.
- Las instrucciones solo pedían la primera migración, omitiendo columnas y
  permisos necesarios. La configuración local apuntaba al puerto de Auth
  incorrecto y referenciaba un archivo de seed inexistente.

## Validación

- `npm test`: 28 pruebas aprobadas, incluidas validación de firmas, errores de
  entrada, fallos de n8n, sincronización por campos y paginación de 1001 clientes.
- Prueba HTTP de Vite: HTML y módulos servidos, dependencias transformadas,
  API desconocida con 404, challenge correcto y ambas API entregando el cuerpo
  original a un receptor HTTP local. Se comprueba también el 413 por HTTP.
- `npm run check` y `npm run build`: aprobados.
- Arranque en el navegador integrado por HTTP: dashboard visible y consola
  sin errores ni advertencias registrados durante la comprobación.
- Todas las migraciones se aplicaron a PostgreSQL 18 en una instancia temporal
  local con roles y funciones Auth de prueba. `tests/pack-order.sql` comprueba
  empaque, aviso, auditoría, reintento idempotente, etapa incorrecta, pedido
  inexistente, restricción de campos y aislamiento por espacio de trabajo.
  Los datos de prueba se revierten al terminar.

## Activación y límites

Aplicar la nueva migración al proyecto Supabase real antes de desplegar el
frontend y configurar las variables de `.env.example`. Esta revisión no
modificó servicios externos ni comprobó credenciales de Supabase, Meta o n8n.
Las pruebas del relay usaron receptores locales o respuestas simuladas.

La sincronización comercial sigue consistiendo en varias escrituras, sin una
transacción global. Los cambios simultáneos al mismo campo usan la última
escritura; los campos sin modificaciones locales ya no se reenvían. La
paginación tampoco proporciona una instantánea transaccional de todas las
tablas. El webhook no guarda una cola ni deduplica mensajes; n8n debe gestionar
los reintentos por identificador de evento. El empaque de Producción sí es
transaccional e idempotente.
