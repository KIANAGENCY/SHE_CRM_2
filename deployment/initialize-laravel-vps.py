#!/usr/bin/env python3
"""Migrate the current CRM owner and SARA snapshot over private stdin channels."""
import json
import os
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import tarfile
from datetime import datetime, timezone

os.umask(0o077)
release = sys.argv[1]
root = Path('/opt/she-crm')
directory = root / 'releases' / release
if not release.startswith('laravel-') or directory.resolve().parent != (root / 'releases').resolve():
    raise SystemExit('Invalid release')
compose = ['docker', 'compose', '--env-file', str(root / 'shared/laravel/compose.env'), '-f', str(directory / 'deployment/laravel-compose.yaml')]
def run(args, data=None):
    result = subprocess.run(args, input=data, capture_output=True, check=False)
    if result.returncode:
        (root / 'backups/laravel-initialize.log').write_bytes(result.stdout + result.stderr)
        raise RuntimeError('Initialization failed; diagnostic log retained privately on the VPS.')
    return result.stdout

users = int(run(['docker','exec','she-laravel-postgres-1','psql','-U','postgres','-d','she_crm','-tAc','select count(*) from auth.users']).strip())
if users == 0:
    access = (root / 'shared/secrets/crm-access.txt').read_text()
    fields = dict(line.split(':',1) for line in access.splitlines() if ':' in line)
    password = fields.get('Contraseña','').strip()
    if not password:
        raise RuntimeError('Existing private CRM password is missing.')
    data = json.dumps({'email':'direccion@hotelexpert.mx','password':password,'fullName':'Dirección','workspaceName':'Hotel Expert'}).encode()
    run(compose + ['run','--rm','-T','migrator','she:provision-admin'], data)
    print('Existing CRM password preserved for the Laravel owner account.')

snapshots = int(run(['docker','exec','she-laravel-postgres-1','psql','-U','postgres','-d','she_crm','-tAc','select count(*) from public.sara_snapshots']).strip())
if snapshots == 0:
    source = root / 'shared/sara/sara-crm.sqlite'
    with tempfile.TemporaryDirectory(dir=root / 'backups') as temporary:
        snapshot = Path(temporary) / 'sara-crm.sqlite'
        with sqlite3.connect(f'file:{source}?mode=ro', uri=True) as live, sqlite3.connect(snapshot) as target:
            live.backup(target)
        with sqlite3.connect(snapshot) as db:
            if db.execute('pragma quick_check').fetchone()[0] != 'ok':
                raise RuntimeError('SQLite snapshot is invalid.')
            meta = dict(db.execute('select key,value from meta'))
            payload = {'rows':[json.loads(row[0]) for row in db.execute('select payload from leads')],
                       'messages':[json.loads(row[0]) for row in db.execute('select payload from messages')],
                       'columns':json.loads(meta.get('columns','[]')), 'lastSync':meta.get('lastSync'),
                       'error':meta.get('error',''), 'revision':int(meta.get('revision','0')),
                       'discountLimit':float(meta.get('discountLimit','0')), 'overrides':{}}
            for collection, identifier, value, deleted in db.execute('select collection,id,payload,deleted from local_records'):
                payload['overrides'].setdefault(collection,{})[identifier] = {'value':json.loads(value) if value else None,'deleted':bool(deleted)}
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
        backup = root / 'backups' / f'pre-laravel-{stamp}.tar.gz'
        with tarfile.open(backup, 'w:gz') as archive:
            archive.add(snapshot, arcname='sara/sara-crm.sqlite')
            archive.add(root / 'shared/secrets', arcname='secrets')
            archive.add(root / 'current/deployment', arcname='legacy-deployment')
        run(compose + ['run','--rm','-T','migrator','she:import-sara'], json.dumps(payload).encode())
        print(f'SARA migrated to PostgreSQL: {len(payload["rows"])} contacts, {len(payload["messages"])} messages. Private backup retained.')
print('Laravel initialization completed.')
