# Hotel Expert · CRM & Operación

CRM alineado con [Figma](https://www.figma.com/design/Qs3uCDg51cxgPDhVQqajBF/Hotel-Expert?node-id=3-108): venta directa con Sara IA, muestras opcionales, cotizaciones, pedidos y seguimiento. Todo el código fuente usa TypeScript: interfaz React, funciones de Supabase, backend Node.js y scripts de base de datos y restauración. Incluye PostgreSQL local, con cuentas, espacios de trabajo y permisos reales.

## Captura local desde SARA IA en n8n

La instalación local puede importar los contactos y todos los campos comerciales registrados por SARA, además del historial de mensajes capturado antes de ejecutar el modelo de IA. Los datos de demostración ya no se cargan en la aplicación.

Este modo requiere Node.js 24, `VITE_BACKEND=n8n` en `.env.local` y la configuración privada del exportador en `.local/sara-connection.json`. Ejecutar `npm ci` y `npm run dev`, y abrir `http://127.0.0.1:5173`. La base SQLite, los datos reales y las credenciales quedan fuera de Git. Consultar [conexión, configuración y límites](docs/SARA_N8N.md).

GitHub incluye estos archivos privados dentro del respaldo cifrado `migration/sara-crm.enc`. Después de clonar una copia nueva e instalar con `npm ci`, recupera la configuración y los datos con `npm run sara:restore -- --key-file RUTA_A_TU_LLAVE_PRIVADA`. Consulta [restauración para VPS](migration/README.md). La llave se conserva fuera del repositorio.

La sincronización consulta n8n cada cinco minutos mientras el CRM está abierto y visible. El botón **Actualizar desde SARA** fuerza una consulta. Las solicitudes de pedido y los comprobantes conservan su estado original; no generan automáticamente ventas ni pagos validados. Las ediciones del equipo se guardan localmente. Este modo no se publica como frontend estático ni sustituye el acceso multiusuario de PostgreSQL/Supabase.

## PostgreSQL local con API propia

El backend local usa PostgreSQL y sesiones seguras en Node.js. Requiere Node.js 20.19+ y PostgreSQL 18 instalado (incluidos `initdb` y `pg_ctl`).

```sh
npm ci
npm run db:local
npm run db:migrate
npm run build
npm start
```

Abre `http://127.0.0.1:3000` y crea la primera cuenta de Dirección. La base local escucha solo en `127.0.0.1:55432`; `db:local` genera credenciales en `.env.local`, que no se sube al repositorio. El registro queda cerrado después de crear la primera cuenta. Dirección administra el equipo desde el CRM. Consulta [POSTGRESQL.md](docs/POSTGRESQL.md) para configurar otra instancia, respaldos y detalles de la API.

Para desarrollo con Vite, configura `VITE_BACKEND=local` y las variables generadas en `.env.local`, luego ejecuta `npm run dev`. El modo local requiere que Node sirva `/api/crm`; desplegarlo en Vercel no inicia PostgreSQL local.

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

`npm run check` comprueba los tipos y rechaza archivos fuente `.js`, `.jsx`, `.mjs` o `.cjs`. La compilación ejecuta esta comprobación para evitar implementaciones duplicadas. El JavaScript generado en `dist/` es necesario para el navegador. Los comandos del servidor y de mantenimiento ejecutan TypeScript con `tsx`; en el VPS instala también las dependencias de desarrollo mediante `npm ci` (sin `--omit=dev`).

## Supabase

1. Crear un proyecto y aplicar **todas** las migraciones de `supabase/migrations/` en orden por nombre, mediante `supabase db push` con el proyecto vinculado o desde el editor SQL.
2. Copiar `.env.example` a `.env.local`.
3. Configurar `VITE_SUPABASE_URL` y `VITE_SUPABASE_PUBLISHABLE_KEY` con la URL y la clave publicable del proyecto.

En Vercel, deja `VITE_BACKEND` vacío y configura únicamente esas dos variables de cliente para usar Supabase. Nunca configures credenciales de PostgreSQL en variables `VITE_*` ni publiques claves de servicio en el navegador.

La aplicación usa únicamente la clave publicable en el navegador. Las tablas tienen Row Level Security, permisos explícitos y aislamiento por espacio de trabajo. Al crear la primera cuenta también se crean su perfil, su espacio y la membresía de Dirección.

Los espacios conectados empiezan con los datos del servidor; no se importan
automáticamente los datos ficticios de la demostración. La migración
`20261009000000_pack_order_transaction.sql` es necesaria para que Producción
registre empaque, aviso y auditoría en una transacción. Configurar también las
URL de redirección de Auth para el dominio de despliegue; la configuración local
incluye los puertos 5173 y 4173.

## Qué funciona

Clientes editables, búsqueda global, pipeline con dos rutas, muestras sin duplicados, catálogo de aromas aprobados, cotización con límites de descuento, aceptación y creación de pedido, autorización y etapas operativas, citas sin solapamientos, tareas de recompra, métricas derivadas de datos, registro de eventos y exportación JSON.

Con el modo n8n configurado, los datos se guardan en SQLite y se muestran los expedientes completos de SARA. Sin backend configurado, el CRM inicia vacío y guarda los cambios en el navegador. Con Supabase configurado, el acceso usa correo y contraseña y los cambios se sincronizan según el perfil asignado.

La pantalla de Atención muestra los resúmenes y mensajes recibidos desde SARA; ya no genera respuestas simuladas. La disponibilidad del modelo y de los canales depende de n8n. No hay cobros, facturación fiscal ni inventario físico conectados. Consultar [la conexión actual](docs/SARA_N8N.md) y [el alcance previo](docs/IMPLEMENTACION.md).

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
