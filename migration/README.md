# Respaldo portátil para VPS

`sara-crm.enc` contiene una instantánea consistente de la base SQLite, la configuración de conexión a n8n y `.env.local`, cifradas juntas con AES-256-GCM. El archivo puede viajar con el repositorio sin publicar los datos ni el token en texto plano.

La llave privada de 32 bytes se entrega al titular por separado. No se guarda en GitHub. El respaldo no se puede restaurar sin esa llave. Conserva ambos archivos para la migración.

## Restaurar en un VPS nuevo

Instalar Node.js 24 y Git. Copiar la llave al VPS por SSH/SFTP, en una carpeta privada fuera del repositorio. Restringir sus permisos con `chmod 600 /ruta/privada/CRM-SARA-LLAVE-PRIVADA.key`.

```sh
git clone https://github.com/KIANAGENCY/SHE_CRM_2.git
cd SHE_CRM_2
npm ci
node scripts/sara-migration.mjs restore migration/sara-crm.enc --key-file /ruta/privada/CRM-SARA-LLAVE-PRIVADA.key
npm run build
npm start
```

La restauración no sobrescribe una base o configuración existentes. Debe ejecutarse antes de iniciar la aplicación. Recupera los registros locales y el acceso al exportador de SARA; los datos posteriores al corte se consultan nuevamente desde n8n.

El servidor escucha en `127.0.0.1:3000`. La instalación actual conserva su acceso local y se puede usar en el VPS por un túnel SSH:

```sh
ssh -L 3000:127.0.0.1:3000 usuario@IP_DEL_VPS
```

Abrir `http://127.0.0.1:3000` en la computadora que mantiene el túnel. Para acceso público por dominio, primero debe configurarse autenticación y HTTPS; esta copia no habilita acceso anónimo a los expedientes.

## Generar un corte nuevo

```sh
node scripts/sara-migration.mjs backup migration/sara-crm-NUEVO.enc --key-file /ruta/privada/llave-NUEVA.key
```

La API de respaldo de SQLite permite obtener un corte consistente con el CRM activo. Cada respaldo usa una llave y un nonce nuevos. El script verifica la autenticación y la recuperación de los bytes antes de escribir el resultado.
