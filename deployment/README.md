# CRM con HTTPS en el VPS

La instalación principal usa ahora Laravel, PHP-FPM, Nginx y PostgreSQL.
Consulta [preparación local, API y VPS](../docs/LARAVEL.md) y utiliza
`laravel-compose.yaml`. El despliegue Node descrito a continuación se conserva
para recuperar la versión anterior.

Este Compose despliega el servicio Node.js 24 con las API TypeScript. Nginx
recibe las solicitudes de Traefik y las envía al CRM en una red `backend`
privada. Solo Nginx comparte la red `n8n-proxy`. Traefik gestiona el certificado
Let's Encrypt y publica 80/443. El CRM y Nginx no publican puertos en el host.
El despliegue Laravel usa sus propios archivos de Compose y Dockerfile.

Traefik usa el proveedor de archivos, sin acceso al socket ni a la API de
Docker. Sus rutas están en
`/opt/she-crm/shared/secrets/traefik-dynamic.yaml`, con permisos 600. El CRM
apunta a `http://she-crm-nginx-1:8080` y n8n a `http://n8n-https-n8n-1:5678`.
Las etiquetas de este Compose conservan la descripción de las rutas para
compatibilidad, pero el proveedor de archivos es la configuración activa.
Si cambias dominios, nombres de contenedores o el secreto del proxy, actualiza
también ese archivo y valida las dos aplicaciones por HTTPS.

Nginx y el CRM corren sin privilegios, sin capacidades adicionales y con el
sistema de archivos de solo lectura. La carpeta `.local` es persistente y
escribible; `/tmp` usa memoria temporal. Los recursos y registros tienen límites.
La imagen de Nginx está fijada por digest. `nginx.conf` confía en la subred
actual del proxy, `172.18.0.0/16`; actualízala si cambia esa red.

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
intentos de contraseña a 30 por IP autenticada del cliente cada 15 minutos.
Nginx reemplaza `X-SHE-Client-IP` y limita el acceso a una petición por segundo,
con una ráfaga de cinco. La API acepta esa IP únicamente con el secreto válido
del proxy; el modo local usa la dirección de la conexión. El modo
local mantiene su acceso original mientras no se configure una cuenta.

## Firewall, acceso y recuperación

UFW permite únicamente 22, 80 y 443/TCP, en IPv4 e IPv6. SSH usa llaves,
limita intentos y tiene Fail2ban; root conserva acceso solo con llave.
`she-docker-firewall.service` limita también el tráfico reenviado por Docker,
y vuelve a aplicar las reglas cuando arranca Docker.

`she-crm-backup.timer` genera diariamente un respaldo de las bases SQLite,
configuración y despliegue. Usa snapshots consistentes, verifica las bases
extraídas del archivo, calcula SHA-256 y conserva los últimos 14 respaldos
en `/var/backups/she-crm`, accesibles solo a root. El respaldo de n8n sigue
en `/var/backups/she-n8n`. Ambos están en el mismo VPS: falta una copia externa
para recuperación ante la pérdida completa del servidor.

La versión anterior del CRM y los respaldos de configuración permanecen en
`/opt/she-crm/releases` y `/var/backups/she-security`. Para volver a una versión,
comprueba primero su Compose y las rutas actuales de Traefik. Si restauras la
versión anterior sin Nginx, también cambia el destino del proxy al contenedor
CRM anterior; las etiquetas de Docker ya no actualizan las rutas activas.
