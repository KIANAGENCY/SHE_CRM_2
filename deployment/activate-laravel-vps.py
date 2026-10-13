#!/usr/bin/env python3
"""Activate Laravel in the VPS's existing Traefik file provider, preserving n8n."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import subprocess
import yaml

os.umask(0o077)
health=json.loads(subprocess.check_output(['curl','-fsS','http://127.0.0.1:8082/api/crm/health']))
assert health.get('backend')=='laravel' and health.get('database')=='postgresql'
path=Path('/opt/she-crm/shared/secrets/traefik-dynamic.yaml')
original=path.read_bytes()
document=yaml.safe_load(original)
http=document.setdefault('http',{})
http.setdefault('services',{})['she-laravel']={'loadBalancer':{'servers':[{'url':'http://she-laravel-nginx-1:8080'}]}}
http.setdefault('middlewares',{})['she-laravel-headers']={'headers':{'stsSeconds':31536000,'contentTypeNosniff':True,'frameDeny':True,'referrerPolicy':'same-origin'}}
http.setdefault('routers',{})['she-laravel']={
    'rule':'Host(`crm.hotelexpert.mx`)', 'priority':1000,
    'entryPoints':['websecure'], 'tls':{'certResolver':'le'},
    'service':'she-laravel', 'middlewares':['she-laravel-headers'],
}
encoded=yaml.safe_dump(document,sort_keys=False)
assert yaml.safe_load(encoded)==document
stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
Path('/opt/she-crm/backups/traefik-before-laravel-'+stamp+'.yaml').write_bytes(original)
# Keep the inode because Traefik binds this individual file into its container.
with path.open('w') as target:
    target.write(encoded);target.flush();os.fsync(target.fileno())
print('Laravel HTTPS route activated; existing n8n routers and middleware preserved.')
