"""Cloudflare D1 over the HTTP API, standard library only. Shared by sync_projects.py and pulse/push.py.

Credentials come from ~/.config/cloudflare.env (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
The database id is read from wrangler.toml.
"""
import json
import re
import sys
import urllib.error
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent


def load_env(path):
    env = {}
    for line in Path(path).read_text().splitlines():
        if '=' in line and not line.lstrip().startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip()
    return env


def database_id():
    m = re.search(r'database_id\s*=\s*"([0-9a-f-]{36})"', (REPO / 'wrangler.toml').read_text())
    if not m:
        sys.exit('database_id not found in wrangler.toml')
    return m.group(1)


def d1(env, db, sql, params):
    url = f"https://api.cloudflare.com/client/v4/accounts/{env['CLOUDFLARE_ACCOUNT_ID']}/d1/database/{db}/query"
    req = urllib.request.Request(url, data=json.dumps({'sql': sql, 'params': params}).encode(), method='POST',
                                 headers={'Authorization': f"Bearer {env['CLOUDFLARE_API_TOKEN']}", 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            out = json.load(r)
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'D1 {e.code}: {e.read().decode(errors="replace")[:500]}') from None
    if not out.get('success'):
        raise RuntimeError(out.get('errors'))
    return out
