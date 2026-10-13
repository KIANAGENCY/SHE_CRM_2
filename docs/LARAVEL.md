# SHE_2: React, Laravel y PostgreSQL

El backend principal está en `backend/`: Laravel 13 (PHP 8.3 o superior), API
compatible con React y PostgreSQL. El servidor usa el rol restringido `she_api`;
las migraciones usan una conexión administrativa separada. Las políticas de
PostgreSQL conservan el aislamiento por espacio, los permisos y las reglas de
cotizaciones, pedidos, muestras y agenda.

## Entorno local de esta computadora

Se preparó una base independiente `she_crm_laravel` en PostgreSQL 18,
`127.0.0.1:55432`. Las credenciales están en `backend/.env` y `.env.local`,
excluidos de Git y con permisos privados. El proyecto anterior conserva su base.

```powershell
npm ci
composer --working-dir=backend install
npm run laravel:setup
npm start
```

En otra terminal: `npm run dev`. Abrir `http://127.0.0.1:5173`.
Laravel escucha en `127.0.0.1:8000`; Vite reenvía `/api` a Laravel con
`VITE_API_BACKEND=laravel`. `VITE_BACKEND=local` muestra el acceso con correo y
la creación de la primera cuenta; `VITE_BACKEND=n8n` muestra SARA y su acceso.
Ambos modos pueden usar Laravel y PostgreSQL. Para servir la compilación
directamente desde Laravel, establecer `APP_ORIGIN=http://127.0.0.1:8000` en
`backend/.env` y ejecutar `npm run build` y `npm start`.

Para otra instalación: configurar las URL en `backend/.env` a una base nueva,
generar la llave con `php backend/artisan key:generate` y aplicar
`npm run laravel:migrate`. `laravel:setup` facilita el entorno existente,
reutilizando el servidor local y creando la base separada sin modificar datos
ni contraseñas de la instalación anterior.

## API y seguridad

`/api/crm` mantiene salud, registro, login, logout, sesión, estado, sincronización,
equipo y empaque. `/api/sara` mantiene sesión, login, logout, estado, actualización
y guardado. SARA persiste contactos, mensajes y ediciones en JSONB de PostgreSQL,
con políticas por espacio. La identidad del contacto permanece estable antes y
después del análisis de IA, y los campos futuros del exportador se conservan.

Contraseñas Argon2id; cookies HttpOnly, SameSite=Strict y Secure en HTTPS; tokens
de sesión guardados como SHA-256, expiración y revocación. Registro cerrado
después de la primera cuenta. Los POST del navegador requieren el origen exacto
y JSON; el límite es 1 MiB. Las revisiones detectan ediciones simultáneas y el
guardado es transaccional. Webhooks de Meta y relay usan sus firmas/tokens,
conservan los bytes originales y no requieren sesión de navegador.

Las cuentas antiguas con hashes scrypt deben aprovisionarse con una contraseña
conocida o restablecerse; Laravel no interpreta esos hashes. La cuenta del VPS
se trasladó usando el archivo privado existente, sin imprimir su contraseña.
No conectar el nuevo backend a una base histórica sin preparar esa migración.

El código Node anterior permanece disponible mediante `npm run start:node`;
sus API se usan solo con `VITE_API_BACKEND=node`. La producción Laravel no
ejecuta Node ni utiliza SQLite para guardar datos del CRM.

## VPS

`deployment/laravel-compose.yaml` define PHP 8.4-FPM, Nginx y PostgreSQL 18.
PostgreSQL y PHP no publican puertos; el acceso de comprobación de Nginx está
en `127.0.0.1:8082`. Traefik y la red `n8n-proxy` proporcionan HTTPS.

Configuración privada: `/opt/she-crm/shared/laravel/secrets/`; almacenamiento
de Laravel: `/opt/she-crm/shared/laravel/storage/`; datos de PostgreSQL: volumen
`she-laravel_postgres_data`. PHP no recibe credenciales administrativas. El
servicio temporal `migrator` aplica `she:migrate` y aprovisiona/importa datos
por stdin. El código activo se identifica con `/opt/she-crm/current-laravel`.

```sh
docker compose --env-file /opt/she-crm/shared/laravel/compose.env -f deployment/laravel-compose.yaml up -d --wait postgres
docker compose --env-file /opt/she-crm/shared/laravel/compose.env -f deployment/laravel-compose.yaml run --rm migrator she:migrate
docker compose --env-file /opt/she-crm/shared/laravel/compose.env -f deployment/laravel-compose.yaml up -d php nginx
```

`LARAVEL_PUBLIC=true` activa el dominio `crm.hotelexpert.mx` con prioridad sobre
el router anterior cuando Traefik usa el proveedor Docker. En este VPS Traefik
usa un archivo dinámico; `python3 deployment/activate-laravel-vps.py` agrega la
ruta y el servicio de Laravel en `/opt/she-crm/shared/secrets/traefik-dynamic.yaml`,
conservando n8n. Es necesario ejecutar ese paso tras validar el servicio. Para
deshacer el cambio de ruta, retirar `http.routers.she-laravel` del archivo.
El respaldo anterior se
conserva; activar una versión nueva no elimina volúmenes ni versiones previas.

El respaldo diario, a las 03:30 de America/Mazatlan, conserva 14 copias privadas
en `/opt/she-crm/backups/laravel`: `pg_dump` custom, roles, configuración y
checksum SHA-256. Se verifica la estructura del dump y se prueba la restauración
en una base temporal durante la preparación inicial. Respaldar antes de cambios
de esquema; el rollback de código no revierte migraciones de datos.

La configuración del exportador SARA debe quedar en el archivo privado
`sara-connection.json`; mientras falte, la interfaz informa que está pendiente
y conserva los registros ya importados. Crear el administrador de n8n y sus
workflows sigue siendo independiente del acceso al CRM.

## Validación

`npm run build`, `npm test` y `npm run test:laravel`. Las pruebas Laravel crean
una base PostgreSQL temporal de nombre aleatorio, aplican migraciones dos veces
y eliminan únicamente esa base al terminar. Prueban sesiones, aislamiento,
rollback, revisiones, reglas comerciales, permisos, empaque idempotente,
persistencia SARA, captura previa al modelo y firmas del webhook.
