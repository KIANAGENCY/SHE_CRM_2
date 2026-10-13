#!/usr/bin/env python3
"""Restore the latest backup into a unique disposable PostgreSQL database."""
import os
from pathlib import Path
import secrets
import subprocess
import tarfile

os.umask(0o077)
folder=Path('/opt/she-crm/backups/laravel')
archive=sorted(folder.glob('she-laravel-*.tar.gz'))[-1]
name='she_restore_test_'+secrets.token_hex(6)
base=['docker','exec','she-laravel-postgres-1']
created=False
def run(args, data=None):
    result=subprocess.run(args,input=data,stdout=subprocess.PIPE,stderr=subprocess.PIPE)
    if result.returncode:
        (folder/'restore-diagnostics.log').write_bytes(result.stdout+result.stderr)
        raise RuntimeError('Restore verification failed; private diagnostic log retained.')
    return result.stdout
try:
    run(base+['createdb','-U','postgres',name]);created=True
    with tarfile.open(archive) as backup:
        data=backup.extractfile('database/database.dump').read()
    run(['docker','exec','-i','she-laravel-postgres-1','pg_restore','-U','postgres','-d',name,'--exit-on-error','--single-transaction'],data)
    count=int(run(base+['psql','-U','postgres','-d',name,'-tAc','select count(*) from auth.users']).strip())
    tables=int(run(base+['psql','-U','postgres','-d',name,'-tAc',"select count(*) from information_schema.tables where table_schema='public'"]).strip())
    assert count>=1 and tables>=15
    print(f'Backup restored successfully into a temporary database: {count} users, {tables} public tables.')
finally:
    if created and name.startswith('she_restore_test_') and len(name)==29:
        run(base+['dropdb','-U','postgres',name])
