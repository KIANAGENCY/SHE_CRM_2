# Backend local PostgreSQL + Node.js

Implementado y verificado el 12 de octubre de 2026. El modo local no necesita
Supabase ni servicios de autenticación externos. Reutiliza el esquema relacional
y las políticas existentes; `database/bootstrap.sql` proporciona usuarios,
sesiones y la identidad de cada transacción en PostgreSQL local.

Revisión posterior y correcciones de seguridad: [SEGURIDAD.md](SEGURIDAD.md).
La instancia del CRM ya usa PostgreSQL 18.6 con binarios exclusivos seleccionados
por `PG_BIN` en `.env.local`. Los modos conectados ya no persisten datos en
`localStorage`; los cambios pendientes deben exportarse antes de recargar.

## Arranque en esta instalación

Ejecutar desde `C:\laragon\www\SHE-CRM-main\SHE-CRM-main`:

```powershell
npm ci
npm run db:local
npm run db:migrate
npm run build
npm start
```

Abrir <http://127.0.0.1:3000>. Seleccionar **Crear la cuenta principal** y definir
correo, nombre, espacio y contraseña de al menos 12 caracteres. El espacio
comienza vacío; no se importan registros de demostración. El registro público
se cierra automáticamente después de esa primera cuenta.

Dirección agrega integrantes desde **Equipo y permisos**. Allí puede crear
cuentas con contraseña inicial o actualizar el perfil de una cuenta existente.
El cambio de perfil no modifica su contraseña. Catálogo permite agregar
productos y aromas para empezar a cotizar.

Para desarrollo: `npm run dev` sirve la interfaz y la misma API en el puerto
5173. Para detener la base: `npm run db:stop`; para consultar su estado:
`npm run db:status`. La instancia debe arrancarse después de reiniciar Windows;
no se instaló como servicio del sistema.

## Configuración

`db:local` utiliza PostgreSQL 18 instalado en Windows y crea una instancia
exclusiva en `127.0.0.1:55432`, base `she_crm`, datos en `.local/postgres`.
No modifica la instancia del puerto 5432. Para otra instalación, definir
`PG_BIN` con la carpeta que contiene `initdb`, `pg_ctl`, `pg_dump` y `pg_restore`.
También se pueden usar los binarios disponibles en PATH fuera de Windows.

Las credenciales aleatorias se generan en `.env.local`, excluido del control
de versiones junto con `.local/`. No deben copiarse al frontend.

| Variable | Función |
| --- | --- |
| `VITE_BACKEND=local` | Selecciona la API propia al compilar el frontend |
| `DATABASE_URL` | Conexión del servidor como `she_api` |
| `DATABASE_ADMIN_URL` | Migraciones, pruebas y respaldos administrativos |
| `ALLOW_REGISTRATION=false` | Solo permite crear la primera cuenta pública |
| `COOKIE_SECURE=false` | HTTP local; usar `true` detrás de HTTPS |
| `APP_ORIGIN` | Vacío para localhost; origen exacto para un dominio con HTTPS |
| `HOST`, `PORT` | Escucha Node; por defecto `127.0.0.1:3000` |

Para una base propia, crear una base dedicada en PostgreSQL 15 o superior y
configurar ambas URL antes de ejecutar `db:migrate`. El administrador requiere
permiso para crear roles y extensiones (`pgcrypto`, `btree_gist`). La URL de
ejecución debe usar `she_api`; nunca el superusuario. El instalador local
administra únicamente su instancia del puerto 55432.

## Persistencia y permisos

Las tablas incluyen usuarios, sesiones, perfiles, espacios, integrantes,
ajustes, clientes, productos, aromas, oportunidades, cotizaciones, pedidos,
muestras, citas, tareas, conversaciones, avisos y auditoría.

- Cada registro comercial lleva `workspace_id`. Las claves foráneas compuestas
  impiden referencias entre espacios. PostgreSQL aplica Row Level Security.
- `she_api` no es superusuario ni hereda los permisos comerciales. Cada
  transacción establece el rol `authenticated` y la identidad de la sesión,
  y los restaura al terminar antes de devolver la conexión al pool.
- Dirección administra el equipo. Dirección y Administración gestionan
  catálogo, descuentos y operación; Ventas gestiona los registros comerciales
  y crea pedidos por autorizar. Producción solamente registra el empaque.
- Las contraseñas usan scrypt con sal aleatoria. La base guarda únicamente
  hashes de los tokens de sesión. Cookies HttpOnly, SameSite=Strict, expiración
  de siete días y revocación al cerrar sesión. Los intentos de acceso se limitan
  en la base por dirección de conexión a 30 cada 15 minutos.
- Los POST exigen origen autorizado y JSON; los cuerpos tienen límite de 1 MiB.
  Las consultas parametrizan los valores y usan listas cerradas de tablas y
  columnas. Los errores no exponen consultas, contraseñas ni cadenas de conexión.

## Transacciones y reglas de negocio

`GET /state` obtiene una instantánea consistente con REPEATABLE READ.
`POST /sync` recibe solo cambios, bloquea la revisión del espacio y confirma
todos los registros y la auditoría en una transacción. Si falla cualquier
registro, se revierte todo. Una revisión antigua recibe HTTP 409; el navegador
conserva los cambios locales y solicita exportar y recargar, sin sobrescribir
automáticamente el servidor. Este control es por espacio, por lo que también
puede rechazar ediciones simultáneas de registros distintos.

PostgreSQL valida precios del catálogo al crear o modificar partidas,
cantidades enteras, sumas, descuentos, compatibilidad de aromas y aceptación
de cotizaciones. Impide cambiar el contenido de una cotización ligada a un
pedido. Los pedidos avanzan una etapa a la vez y exigen guía para el despacho.
Las muestras requieren autorización y no pueden duplicar una solicitud activa.
Una restricción de exclusión impide citas superpuestas para el mismo vendedor.

La API genera la auditoría y los avisos de pedido. El navegador no puede
escribir entradas arbitrarias en esas tablas mediante `/sync`. Empaque usa una
función transaccional e idempotente: repetirlo no duplica el aviso.

## API

Todas las rutas comienzan con `/api/crm`. Excepto registro, acceso y salud,
requieren la cookie de sesión. Los POST requieren `Origin` y
`Content-Type: application/json`.

| Método y ruta | Uso |
| --- | --- |
| `GET /health` | Comprueba la conexión a PostgreSQL |
| `POST /auth/signup` | `{email,password,fullName,workspaceName}` |
| `POST /auth/login` | `{email,password}` |
| `POST /auth/logout` | Revoca la sesión |
| `GET /session` | Usuario, espacio y perfil actuales |
| `GET /state?workspace=UUID` | Filas y revisión del espacio autorizado |
| `POST /sync` | `{workspace,revision,changes}` |
| `POST /pack` | `{workspace,revision,orderId}` para Producción |
| `GET /members?workspace=UUID` | Identificadores y perfiles del equipo |
| `POST /members` | `{workspace,revision,email,role,fullName,password}`; últimos dos para cuenta nueva |

Cada cambio de `/sync` tiene `{table,id,operation,values}`. `operation` admite
`insert`, `update` y `delete`; `values` incluye solo campos editables, nunca
`workspace_id` ni `id`. La eliminación se limita a citas y tareas, como en la
interfaz actual. `crm_settings` admite solamente `update`, usando como `id` el
UUID del espacio. La respuesta devuelve la nueva revisión, incluso para
operaciones de equipo y empaque.

## Migraciones, pruebas y respaldo

`db:migrate` aplica las migraciones heredadas y las de `database/migrations`
en orden, dentro de una transacción protegida por bloqueo asesor. Registra
checksum y rechaza modificaciones de migraciones ya aplicadas. Las siguientes
modificaciones de esquema deben agregarse como archivos nuevos.

```powershell
npm run check
npm test
npm run test:db
npm run db:backup
```

Validación realizada: sintaxis de 21 archivos, build de producción, 29 pruebas
generales y 11 escenarios de integración en PostgreSQL real. La suite de
integración crea una base `she_crm_test_*`, aplica migraciones dos veces,
comprueba permisos, sesiones, CSRF, transacciones, conflictos, cotizaciones,
agenda, muestras y empaque, y elimina únicamente esa base de prueba al terminar.

`db:backup` genera un archivo de `pg_dump` en formato custom en `.local/backups`.
Se verificó un respaldo inicial restaurándolo en una base temporal: recuperó
las siete migraciones y los permisos. La base temporal se eliminó después.
Incluye cuentas y datos; almacenar una copia fuera de esta máquina con acceso
restringido. Para restaurar, usar `pg_restore --exit-on-error --single-transaction`
en una base nueva, con los roles `anon`, `authenticated` y `she_api` previamente
creados. Los roles y sus contraseñas son configuración del clúster y no están
incluidos en un dump de una sola base. Conservar `.env.local` por separado y
verificar el acceso en la base restaurada antes de usarla.

## Límites del alcance actual

La aplicación está preparada para operación local. Exposición a internet
requiere HTTPS y configurar origen/cookie; no se ha desplegado externamente.
La carga inicial obtiene el estado completo, adecuada para el volumen actual;
volúmenes grandes requerirán consultas paginadas desde la interfaz. No se
implementaron recuperación de contraseña por correo, MFA ni revocación de
todos los dispositivos desde la interfaz.

Los avisos se guardan en PostgreSQL, pero su entrega por WhatsApp o correo
requiere integrar un trabajador o n8n. Los webhooks existentes siguen disponibles
con sus secretos independientes. Sara continúa siendo un simulador. No hay
facturación fiscal, pagos ni inventario físico conectado. El modo Supabase
anterior sigue disponible si se quita `VITE_BACKEND=local`, con sus propias
migraciones y configuración.
