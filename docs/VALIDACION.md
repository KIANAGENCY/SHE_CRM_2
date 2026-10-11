# Validación del CRM

La revisión del backend del 9 de octubre de 2026 está documentada en
[BACKEND.md](BACKEND.md), con 28 pruebas automatizadas y validación de
migraciones en PostgreSQL temporal. El registro siguiente conserva las
comprobaciones del prototipo del 5 de octubre.

Fecha: 5 de octubre de 2026.

## Verificación realizada

- Sintaxis de los módulos JavaScript: correcta.
- Build estático: generado correctamente.
- Nueve pruebas de reglas comerciales: aprobadas (`npm test`).
- Las 18 vistas de la aplicación cargan sin errores JavaScript en Microsoft Edge.
- Recorrido de muestra opcional y regreso a venta directa: aprobado.
- Edición de cliente, registro de aroma de prueba aprobado, cotización, aceptación, pedido y autorización: aprobado.
- Transferencia de Sara a vendedor y pausa del simulador: aprobado.
- Creación de cita y rechazo de una cita duplicada: aprobado.
- Persistencia de datos después de recargar la página: aprobada.
- Vista de 390 px, menú móvil y pipeline con desplazamiento interno: aprobados, sin desbordamiento horizontal de la página.
- Revisión visual de Figma: dashboard, pipeline, atención, expediente, catálogo, cotizador, muestras, reportes y vista móvil.

La prueba de navegador utilizó datos sintéticos en un contexto aislado y no modificó los datos iniciales del código. El catálogo de aromas sigue vacío al iniciar una instalación nueva.

La herramienta agent-browser no pudo conectarse a su servicio de control. La comprobación completa se realizó con Playwright y Edge como alternativa. Las fuentes remotas se bloquearon durante esa prueba para verificar que la aplicación funcionara sin depender de Google Fonts.

## Límites

Estas comprobaciones validan el prototipo local. No validan servicios de mensajería, modelo de IA, autenticación, calendarios externos, facturación ni producción reales: esos servicios no están configurados. Las acciones por perfil son reglas de demostración en el navegador.
