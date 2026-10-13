#!/usr/bin/env python3
"""Consistent PostgreSQL backup, private configuration, SHA-256, 14-copy retention."""
from datetime import datetime, timezone
import fcntl
import hashlib
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile

os.umask(0o077)
destination = Path('/opt/she-crm/backups/laravel')
destination.mkdir(parents=True, exist_ok=True)
os.chmod(destination, 0o700)
with (destination / '.lock').open('a') as lock:
    fcntl.flock(lock, fcntl.LOCK_EX)
    with tempfile.TemporaryDirectory(dir=destination) as temporary:
        folder = Path(temporary)
        dump = folder / 'database.dump'
        with dump.open('wb') as output:
            subprocess.run(['docker','exec','she-laravel-postgres-1','pg_dump','-U','postgres','-d','she_crm','--format=custom'], stdout=output, check=True)
        if dump.read_bytes()[:5] != b'PGDMP':
            raise RuntimeError('Invalid PostgreSQL backup')
        with dump.open('rb') as source:
            subprocess.run(['docker','exec','-i','she-laravel-postgres-1','pg_restore','--list'], stdin=source, stdout=subprocess.DEVNULL, check=True)
        roles = folder / 'roles.sql'
        with roles.open('wb') as output:
            subprocess.run(['docker','exec','she-laravel-postgres-1','pg_dumpall','-U','postgres','--globals-only'], stdout=output, check=True)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        name = 'she-laravel-' + stamp + '.tar.gz'
        archive_path = folder / name
        with tarfile.open(archive_path, 'w:gz') as archive:
            archive.add(dump, arcname='database/database.dump')
            archive.add(roles, arcname='database/roles.sql')
            archive.add('/opt/she-crm/shared/laravel/secrets', arcname='secrets')
            archive.add('/opt/she-crm/shared/laravel/compose.env', arcname='compose.env')
            archive.add('/opt/she-crm/shared/secrets/traefik-dynamic.yaml', arcname='deployment/traefik-dynamic.yaml')
            source = Path('/opt/she-crm/current-laravel')
            if source.exists():
                archive.add(source / 'deployment/laravel-compose.yaml', arcname='deployment/laravel-compose.yaml')
                archive.add(source / 'backend/composer.lock', arcname='deployment/composer.lock')
        checksum = hashlib.file_digest(archive_path.open('rb'),'sha256').hexdigest()
        os.replace(archive_path, destination / name)
        (destination / (name+'.sha256')).write_text(checksum+'  '+name+'\n')
        for old in sorted(destination.glob('she-laravel-*.tar.gz'),reverse=True)[14:]:
            if old.resolve().parent != destination.resolve():
                raise RuntimeError('Unsafe retention path')
            old.unlink()
            old.with_name(old.name+'.sha256').unlink(missing_ok=True)
        print('Verified PostgreSQL archive: '+name)
