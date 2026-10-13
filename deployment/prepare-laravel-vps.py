#!/usr/bin/env python3
"""Prepare private Laravel/PostgreSQL configuration without printing credentials."""
import base64
import json
import os
from pathlib import Path
import secrets
import shutil
import sys

os.umask(0o077)
root = Path('/opt/she-crm/shared/laravel')
private = root / 'secrets'
private.mkdir(parents=True, exist_ok=True)
storage = root / 'storage'
for name in ['app', 'app/private', 'framework', 'framework/cache', 'framework/cache/data', 'framework/sessions', 'framework/views', 'logs']:
    folder = storage / name
    folder.mkdir(parents=True, exist_ok=True)
    os.chown(folder, 33, 33)
    os.chmod(folder, 0o750)
os.chown(storage, 33, 33)
os.chmod(storage, 0o750)

runtime = private / 'laravel-runtime.env'
if not runtime.exists():
    admin_password = secrets.token_hex(32)
    api_password = secrets.token_hex(32)
    app_key = base64.b64encode(secrets.token_bytes(32)).decode()
    (private / 'postgres.env').write_text(f'POSTGRES_DB=she_crm\nPOSTGRES_USER=postgres\nPOSTGRES_PASSWORD={admin_password}\n')
    (private / 'laravel-admin.env').write_text(f'DATABASE_ADMIN_URL=postgresql://postgres:{admin_password}@postgres:5432/she_crm\n')
    runtime.write_text('\n'.join([
        'APP_NAME="SHE CRM"', 'APP_ENV=production', f'APP_KEY=base64:{app_key}',
        'APP_DEBUG=false', 'APP_URL=https://crm.hotelexpert.mx', 'APP_ORIGIN=https://crm.hotelexpert.mx',
        'LOG_CHANNEL=stderr', 'LOG_LEVEL=warning', 'SESSION_DRIVER=file', 'CACHE_STORE=file', 'QUEUE_CONNECTION=sync',
        f'DATABASE_URL=postgresql://she_api:{api_password}@postgres:5432/she_crm',
        'ALLOW_REGISTRATION=false', 'COOKIE_SECURE=true', 'CRM_LOGIN_USER=direccion',
        'CRM_OWNER_EMAIL=direccion@hotelexpert.mx', 'FRONTEND_DIRECTORY=/var/www/she/frontend',
        'SARA_CONNECTION_FILE=/run/secrets/sara-connection.json',
    ])+'\n')
connection = private / 'sara-connection.json'
if not connection.exists():
    source = Path('/opt/she-crm/shared/sara/sara-connection.json')
    if source.exists():
        shutil.copyfile(source, connection)
    else:
        connection.write_text('{}\n')
os.chown(connection, 0, 33)
os.chmod(connection, 0o640)
release = sys.argv[1]
if not release.startswith('laravel-') or not release.replace('-', '').isalnum():
    raise SystemExit('Invalid release identifier')
(root / 'compose.env').write_text(f'LARAVEL_RELEASE={release}\nLARAVEL_SECRETS_DIRECTORY={private}\nLARAVEL_STORAGE_DIRECTORY={storage}\nLARAVEL_PUBLIC=false\n')
print('Laravel private configuration prepared. Public routing is disabled until validation.')
