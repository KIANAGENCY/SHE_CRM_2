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
