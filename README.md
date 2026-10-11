# Hotel Expert · CRM & Operación

CRM alineado con [Figma](https://www.figma.com/design/Qs3uCDg51cxgPDhVQqajBF/Hotel-Expert?node-id=3-108): venta directa con Sara IA, muestras opcionales, cotizaciones, pedidos y seguimiento. La interfaz está implementada con React y TypeScript; la lógica de negocio y las API del servidor usan TypeScript sobre Node.js. Puede trabajar como demostración local o conectado a Supabase con cuentas, espacios de trabajo y permisos reales.

## Ejecutar

Requiere Node.js 20.19 o superior.

```sh
npm install
npm run dev
```

Abrir `http://127.0.0.1:5173`. `npm install` instala React, React DOM, Vite y el plugin de React.

Ejecutar los comandos dentro de la carpeta que contiene `package.json`
(`SHE_2` en esta instalación).
Abrir `index.html` con `file://` bloquea los módulos del navegador. Vite sirve
la aplicación por HTTP, resuelve sus dependencias y ejecuta las rutas de `api/`.
Para Laragon, servir `dist/` después de compilar; Apache por sí solo no ejecuta
las funciones Node de WhatsApp. Usar Vite localmente o Vercel para las API.

```sh
npm run check
npm test
npm run build
```

El build de Vite queda en `dist/` y puede desplegarse en Vercel. Las rutas usan hash y funcionan sin reglas especiales del servidor.

## Supabase

1. Crear un proyecto y aplicar **todas** las migraciones de `supabase/migrations/` en orden por nombre, mediante `supabase db push` con el proyecto vinculado o desde el editor SQL.
2. Copiar `.env.example` a `.env.local`.
3. Configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con la URL y la clave publicable del proyecto.

La aplicación usa únicamente la clave publicable en el navegador. Las tablas tienen Row Level Security, permisos explícitos y aislamiento por espacio de trabajo. Al crear la primera cuenta también se crean su perfil, su espacio y la membresía de Dirección.

Los espacios conectados empiezan con los datos del servidor; no se importan
automáticamente los datos ficticios de la demostración. La migración
`20261009000000_pack_order_transaction.sql` es necesaria para que Producción
registre empaque, aviso y auditoría en una transacción. Configurar también las
URL de redirección de Auth para el dominio de despliegue; la configuración local
incluye los puertos 5173 y 4173.

## Qué funciona

Clientes editables, búsqueda global, pipeline con dos rutas, muestras sin duplicados, catálogo de aromas aprobados, cotización con límites de descuento, aceptación y creación de pedido, autorización y etapas operativas, citas sin solapamientos, tareas de recompra, métricas derivadas de datos, registro de eventos y exportación JSON.

Sin variables de Supabase, los datos se guardan en el navegador y el selector de perfil simula Dirección, Administración, Ventas y Producción. Con Supabase configurado, el acceso usa correo y contraseña y los cambios se sincronizan según el perfil asignado.

Sara todavía simula respuestas y no hay comunicaciones externas, cobros, facturación fiscal ni inventario real conectados. Consultar [alcance y pendientes de integración](docs/IMPLEMENTACION.md).

## Puente de WhatsApp

`POST /api/whatsapp-relay` recibe una copia del evento que ya procesa
`https://www.hotelexpert.mx/whatsapp-webhook.php` y la reenvía al webhook de
n8n. El archivo PHP existente debe conservar su respuesta y enviar la copia con
el encabezado `x-she-relay-secret`.

Configurar en Vercel, como secretos de producción:

- `N8N_WHATSAPP_WEBHOOK_URL`
- `WHATSAPP_RELAY_SECRET`

`GET /api/whatsapp-relay` es una comprobación de estado y no revela la
configuración.

También existe `GET/POST /api/meta-whatsapp-webhook` para recibir eventos
directamente de Meta. Añadir `META_WHATSAPP_VERIFY_TOKEN` para el challenge de
verificación y `META_WHATSAPP_APP_SECRET` para validar `x-hub-signature-256`
con el cuerpo original. El verify token y el app secret son valores diferentes.
Los eventos sin firma válida se rechazan antes de contactar n8n.

Para probar las API locales, poner las variables del servidor en `.env.local`
y reiniciar `npm run dev`. También funcionan con `npm run preview` después de
compilar. No poner el prefijo `VITE_` en secretos del servidor.

Ambos endpoints aceptan eventos de WhatsApp con `object` igual a
`whatsapp_business_account` y `entry` no vacío con identificadores. Devuelven
400 para JSON/eventos inválidos, 401 para autenticación inválida, 413 cuando el
cuerpo supera 1 MiB, 503 si falta configuración y 502 si n8n rechaza el evento
o no responde en ocho segundos. Solo devuelven 202 después de la aceptación
de n8n; los reintentos y la deduplicación por identificador de mensaje deben
gestionarse en el flujo receptor.

El repositorio inicial contenía solo el andamiaje de Figma. La documentación original de su API se conserva bajo `docs/`.
