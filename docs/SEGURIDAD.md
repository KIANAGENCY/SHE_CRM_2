# Revisión de seguridad — 12 de octubre de 2026

Alcance: código de la aplicación, API Node, dependencias npm, instancia
PostgreSQL del CRM (55432), controles de sesión y archivos servidos. No es una
certificación de ausencia de vulnerabilidades ni un análisis completo del
sistema operativo o de otros proyectos de esta máquina.

## Hallazgos corregidos

1. **XSS almacenado en identificadores.** La conversación interpolaba el ID
   del cliente en `data-id` y el formulario de aromas interpolaba el ID del
   producto en `value` sin escapar. Un registro malicioso podía introducir
   elementos y manejadores ejecutables. Ambos atributos ahora escapan HTML;
   la API limita IDs nuevos a letras, números, guion y guion bajo. Las pruebas
   renderizan los formularios reales con un payload de inyección.
2. **Consumo de recursos antes de autorización.** El endpoint de integrantes
   derivaba contraseñas antes de comprobar Dirección. Ahora valida el perfil
   antes de la operación costosa y vuelve a validarlo dentro de la transacción.
   El proceso admite hasta dos derivaciones scrypt simultáneas y devuelve 429
   al superar ese límite. La limitación de acceso por dirección continúa en
   PostgreSQL y no confía en cabeceras `X-Forwarded-For` del cliente.
3. **Datos persistentes después del acceso.** El estado autenticado se copiaba
   en `localStorage`, disponible posteriormente en ese navegador. Ahora los
   modos conectados conservan el estado en memoria, retiran la copia anterior
   al cargar la cuenta y limpian estado y diálogo al salir. El modo demo conserva
   almacenamiento local. Los cambios no confirmados requieren exportación antes
   de cerrar o recargar; ya no se guardan automáticamente como datos autenticados.
4. **Protección del servidor HTTP.** Se añadió CSP con hashes para scripts
   inline conocidos, prohibición de manejadores inline, objetos y framing,
   restricciones de formularios y conexiones, y Permissions-Policy. Las rutas
   estáticas comprueban la ubicación real del archivo para impedir que un enlace
   dentro de `dist` exponga un archivo externo.
5. **PostgreSQL 18.4 sin correcciones recientes.** Se descargaron los binarios
   oficiales de EDB para 18.6 y se actualizaron exclusivamente los del CRM en
   `.local/runtime-18.6/pgsql`. Se creó respaldo previo y se verificó mediante
   SQL que el servidor activo es 18.6. `PG_BIN` en `.env.local` selecciona esos
   binarios para arranque y respaldos. La instalación compartida del puerto
   5432 queda fuera de esta actualización.

La actualización de PostgreSQL corrige vulnerabilidades publicadas por el
fabricante, entre ellas errores de memoria y controles de seguridad de filas.
Consultar el [aviso de PostgreSQL 18.6](https://www.postgresql.org/about/news/postgresql-186-1711-1615-1519-1424-and-19-beta-3-released-3365/).
El escape de atributos sigue las recomendaciones de
[OWASP para XSS](https://cheatsheetseries.owasp.org/cheatsheets/Cross_Site_Scripting_Prevention_Cheat_Sheet.html).

## Comprobaciones

- `npm audit --json`: cero vulnerabilidades conocidas reportadas para las
  dependencias instaladas; esta consulta no inspecciona toda la instalación del PC.
- 32 pruebas generales aprobadas, incluidas tres regresiones de seguridad.
- Pruebas de integración en PostgreSQL real: aislamiento, roles sin superusuario
  ni bypass de RLS, CSRF, inyección SQL y de identificadores, transacciones,
  cierre/expiración de sesión, rechazo de permisos y límite de fuerza bruta.
- `npm run check` y build de producción aprobados.
- Instancia del CRM limitada a `127.0.0.1`; servidor confirmado en 18.6.
- Aplicación reiniciada con las correcciones; pantalla de acceso visible y
  sin errores ni advertencias de consola registrados al recargar.

## Límites y condiciones de despliegue

El servicio permanece local por HTTP. Antes de publicarlo: HTTPS, origen exacto
en `APP_ORIGIN` y `COOKIE_SECURE=true`, protección de credenciales y respaldos,
y revisión de la configuración del proxy. Los administradores de PostgreSQL y
del sistema operativo pueden acceder a los datos por diseño.

No se auditó toda la instalación compartida de PostgreSQL del puerto 5432,
otros servicios, ni las credenciales o configuración reales de Meta/n8n/Supabase.
La auditoría cubre el código y las rutas probadas, sin prometer protección
contra toda vulnerabilidad desconocida o nueva.

## Auditoría y correcciones del VPS

Esta sección registra la revisión del despliegue Node anterior. Después se
activó Laravel con PostgreSQL en `crm.hotelexpert.mx`; los contenedores Node
anteriores quedaron detenidos. La API actual, las comprobaciones de acceso,
los respaldos PostgreSQL y su restauración se documentan en [LARAVEL.md](LARAVEL.md).
Se conservan las observaciones siguientes como evidencia histórica; sus
límites de Nginx y autenticación corresponden a esa versión Node.

VPS revisado: `2.25.245.152`, Ubuntu 26.04.1 LTS. Dominios comprobados:
`https://crm.hotelexpert.mx` y `https://n8n.hotelexpert.mx`.
Versión del CRM desplegada: `6983541-security-20261013T065420Z`.
El identificador de versión usa la fecha UTC registrada por el servidor.

| Hallazgo | Corrección y comprobación |
| --- | --- |
| Firewall inactivo | UFW activo al arranque; entrada permitida solo a 22, 80 y 443/TCP, para IPv4 e IPv6; salida permitida. |
| Puertos Docker podrían eludir UFW | Cadena propia en `DOCKER-USER` para ambas familias; solo admite HTTP/HTTPS desde `eth0`. Servicio systemd persistente ligado a Docker. |
| Contraseñas permitidas en SSH, incluido root | Contraseñas e interacción de teclado deshabilitadas; root únicamente con llave, tres intentos máximos y Fail2ban. Se verificó una conexión nueva antes de cancelar la recuperación automática. |
| OpenSSH tenía actualizaciones pendientes | Paquetes actualizados a `1:10.2p1-2ubuntu3.7`; sin paquetes pendientes en la consulta final. |
| Kernel actualizado aún sin activar | Reinicio completado; kernel `7.0.0-38-generic`, frente al anterior `7.0.0-34-generic`; sin aviso de reinicio pendiente. |
| Traefik dependía de un proxy con acceso al socket Docker | Eliminado ese contenedor y su red; proveedor de archivos con rutas explícitas y configuración privada. Traefik no monta el socket. |
| Límite de contraseña agrupaba a todos detrás del proxy | Nginx reemplaza la IP del cliente; la API acepta esa IP solo con secreto de proxy válido y dirección IP válida. Regresión para IP falsa, secreto incorrecto y cabecera malformada. |
| Faltaba Nginx y aislamiento adicional del CRM | Nginx 1.30.5 activo entre Traefik y CRM; servicio Node aislado de la red compartida. Ambos sin privilegios, sin capacidades, con raíz de solo lectura y límites de recursos/registros. |
| Credencial del CRM apareció durante la inspección | Contraseña reemplazada y sesiones anteriores revocadas. Nueva credencial en el archivo local de acceso con ACL limitada al usuario y SYSTEM; no se incluye en este informe. |
| Faltaba respaldo periódico del CRM en el VPS | Timer diario con snapshots SQLite consistentes, verificación de las bases extraídas, checksum SHA-256 y retención de 14 respaldos; primera ejecución aprobada. |

Traefik conserva Let's Encrypt y la red pública `n8n-proxy`. Ahora usa
`/opt/she-crm/shared/secrets/traefik-dynamic.yaml`, con permisos 600.
Las etiquetas de Docker ya no cambian las rutas activas. Nginx resuelve el
nombre del CRM mediante el DNS interno de Docker para tolerar cambios de IP
al recrear el contenedor. n8n y Traefik también quedaron con
`no-new-privileges`; se retiraron las capacidades predeterminadas, conservando
solo `NET_BIND_SERVICE` en Traefik. Se exige TLS 1.2 como mínimo.

### Evidencia de verificación

- 38 pruebas aprobadas en la imagen construida en el VPS; revisión TypeScript
  y compilación de producción aprobadas. npm audit dentro del contenedor
  desplegado reportó cero vulnerabilidades conocidas en sus dependencias.
- Conexiones externas IPv4: 22/80/443 accesibles; 2375/3000/5432/5678/8080
  inaccesibles. Un contenedor temporal respondió localmente en 18080, pero
  su puerto publicado fue bloqueado desde fuera; se observó el contador DROP
  y se retiró el contenedor después de la prueba.
- `nginx -t` aprobado; CRM y n8n respondieron por HTTPS con certificado válido.
  Cabeceras CSP, HSTS, protección de framing y `nosniff` comprobadas en el CRM.
- Pruebas HTTP reales: datos sin sesión rechazados, origen ajeno rechazado,
  acceso correcto con la nueva contraseña, cookie Secure/HttpOnly/SameSite,
  consulta del CRM autenticada y rechazo del token después de salir.
  Las cabeceras falsas de IP y secreto fueron reemplazadas por los proxies.
- Ráfaga de 16 peticiones de acceso sin credenciales: seis respuestas 400 y
  diez 429, confirmando el límite de Nginx sin generar intentos de contraseña.
- Después del reinicio: SSH con llave, UFW, reglas Docker, Fail2ban, ambos
  servicios web y timers de respaldo activos; contenedores del CRM saludables.

### Recuperación y límites del alcance

Configuraciones anteriores: `/var/backups/she-security`. Datos del CRM:
`/var/backups/she-crm`. Respaldos de n8n: `/var/backups/she-n8n`.
La versión anterior continúa en `/opt/she-crm/releases/6983541`.
Consultar `deployment/README.md` antes de restaurar: el proveedor de archivos
de Traefik exige ajustar también el destino si se vuelve al CRM sin Nginx.

Los respaldos están en el mismo VPS; sigue pendiente una copia externa para
recuperarse de la pérdida del servidor. Se verificó la integridad de las bases
extraídas del respaldo, sin ejecutar una recuperación completa en otro VPS.
Las reglas IPv6 se verificaron en el servidor; la prueba de conexión externa
se realizó por IPv4. El firewall del proveedor no se modificó.

Durante la revisión apareció otro despliegue Laravel en preparación. Su
Nginx publica solo `127.0.0.1:8082`; PHP y PostgreSQL no publican puertos al
host. Su código y migración no forman parte de esta revisión del CRM Node.
Tampoco se comprobaron credenciales reales de Meta/Supabase ni todos los
workflows o paquetes internos de n8n. La revisión no es una certificación de
ausencia de vulnerabilidades ni un pentest exhaustivo.

Referencias técnicas: [firewall de Docker](https://docs.docker.com/engine/network/packet-filtering-firewalls/),
[OpenSSH en Ubuntu](https://ubuntu.com/server/docs/openssh-server/) y
[resolución de upstreams en Nginx](https://nginx.org/en/docs/http/ngx_http_upstream_module.html).
