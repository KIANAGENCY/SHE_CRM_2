#!/usr/bin/env python3
"""Verify real HTTP behavior without disclosing the private CRM password."""
import json
from pathlib import Path
import re
import sys
from urllib.request import Request, urlopen
from urllib.error import HTTPError

base = sys.argv[1] if len(sys.argv)>1 else 'http://127.0.0.1:8082'
origin = 'https://crm.hotelexpert.mx'
access = Path('/opt/she-crm/shared/secrets/crm-access.txt').read_text()
fields = dict(line.split(':',1) for line in access.splitlines() if ':' in line)
password = fields['Contraseña'].strip()
def call(path, data=None, token='', request_origin=origin):
    headers = {'Origin':request_origin}
    if token: headers['Cookie']='she_session='+token
    if data is not None: headers['Content-Type']='application/json'
    request = Request(base+path, data=json.dumps(data).encode() if data is not None else None, headers=headers)
    try:
        with urlopen(request, timeout=30) as result:
            return result.status, result.headers, result.read()
    except HTTPError as error:
        return error.code, error.headers, error.read()

status, _, body = call('/api/crm/health')
assert status==200 and json.loads(body)['backend']=='laravel'
assert call('/api/sara/state')[0]==401
assert call('/api/crm/state')[0]==401
status, headers, _ = call('/api/sara/auth/login',{'username':'direccion','password':password})
assert status==200
cookie = headers.get('Set-Cookie','')
assert 'httponly' in cookie.lower() and 'secure' in cookie.lower() and 'samesite=strict' in cookie.lower()
token = cookie.split(';')[0].split('=',1)[1]
status, _, body = call('/api/sara/session',token=token)
assert status==200 and json.loads(body)['context']['role']=='owner'
assert call('/api/sara/state',token=token)[0]==200
assert call('/api/crm/state',token=token)[0]==200
assert call('/api/sara/sync',{},token, 'https://attacker.example')[0]==403
assert call('/api/sara/auth/logout',{},token)[0]==200
assert call('/api/sara/state',token=token)[0]==401
assert call('/.env')[0] in (403,404)
assert call('/backend/.env')[0] in (403,404)
status, _, page = call('/')
assert status==200
assets = re.findall(rb'(?:src|href)="(/assets/[^"]+)"',page)
assert assets and all(call(path.decode())[0]==200 for path in assets)
print('Verified: Laravel/PostgreSQL health, existing login, Secure cookie, sessions, authorization, CSRF, logout, private files, frontend and assets.')
