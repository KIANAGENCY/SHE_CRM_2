# CRM con HTTPS en el VPS

El contenedor Node.js 24 sirve el frontend y las API TypeScript. Traefik conecta
`crm.hotelexpert.mx` con el servicio en la red interna `n8n-proxy` y gestiona el
certificado Let's Encrypt. El contenedor no publica el puerto 3000 en el host.

La interfaz muestra el formulario de acceso del CRM. El servidor valida usuario
y contraseña con scrypt, guarda sesiones revocables en SQLite y usa cookies
HttpOnly, Secure y SameSite=Strict. Traefik agrega una cabecera privada para
identificar al proxy; la API SARA exige además una sesión válida.
`SARA_PUBLIC_ORIGIN` exige HTTPS, el dominio exacto y origen válido al guardar.
Los webhooks WhatsApp mantienen su validación de token/firma, con su propio
router; no requieren la contraseña del navegador.

Los secretos se guardan fuera de la versión del proyecto, en
`/opt/she-crm/shared/secrets/deployment.env`, con permisos 600:

- `CRM_DATA_DIRECTORY`: carpeta persistente con los datos y configuración SARA.
- `CRM_LOGIN_USER`: usuario autorizado de Dirección.
- `CRM_LOGIN_PASSWORD_HASH`: hash scrypt `salt:hash`, nunca la contraseña en texto plano.
- `SARA_PROXY_SECRET`: secreto aleatorio de al menos 32 caracteres.
- `CRM_RELEASE`: identificador de la versión.
- Variables de WhatsApp de `.env.example`, cuando se configuren esos webhooks.

Desde la versión del proyecto:

```sh
docker compose --env-file /opt/she-crm/shared/secrets/deployment.env -f deployment/compose.yaml -p she-crm up -d --build
```

Restaurar el respaldo de SARA requiere su llave privada. Recupera los archivos
en un destino nuevo con `npm run sara:restore -- --key-file RUTA`, y coloca los
archivos de `.local` en la carpeta persistente antes de iniciar el servicio.
La conexión a n8n se presenta como pendiente mientras falte
`sara-connection.json`; el CRM no carga clientes ficticios.

El cierre de sesión revoca el token en el servidor y limpia el estado del CRM
en el navegador. Las sesiones expiran a los siete días; el acceso limita los
intentos de contraseña a 30 por dirección del proxy cada 15 minutos. El modo
local mantiene su acceso original mientras no se configure una cuenta.
