#!/usr/bin/env python3
"""Pull the live brain feed (meta, dashboard, graph) from R2 into fixtures/brain-feed/v1/ for development and tests.

Read-only: GET requests only, signed with the read-only key in ~/.config/cloudflare.env
(BRAIN_FEED_R2_ACCOUNT_ID, BRAIN_FEED_R2_ACCESS_KEY_ID, BRAIN_FEED_R2_SECRET_ACCESS_KEY).
The fixture folder is gitignored. Standard library only (S3 SigV4 by hand).
Usage: fetch_fixture.py [--env FILE]
"""
import argparse
import datetime as dt
import hashlib
import hmac
import json
import urllib.request
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent.parent
OUT = REPO / 'fixtures' / 'brain-feed' / 'v1'
BUCKET = 'brain-feed'


def load_env(path):
    env = {}
    for line in Path(path).expanduser().read_text().splitlines():
        line = line.strip()
        if line.startswith('export '):
            line = line[7:]
        if '=' in line and not line.startswith('#'):
            k, v = line.split('=', 1)
            env[k.strip()] = v.strip().strip('"\'')
    return env


def get(env, key):
    host = f"{env['BRAIN_FEED_R2_ACCOUNT_ID']}.r2.cloudflarestorage.com"
    now = dt.datetime.now(dt.timezone.utc)
    amz, day = now.strftime('%Y%m%dT%H%M%SZ'), now.strftime('%Y%m%d')
    path = f'/{BUCKET}/{key}'
    payload = hashlib.sha256(b'').hexdigest()
    canonical = f'GET\n{path}\n\nhost:{host}\nx-amz-content-sha256:{payload}\nx-amz-date:{amz}\n\nhost;x-amz-content-sha256;x-amz-date\n{payload}'
    scope = f'{day}/auto/s3/aws4_request'
    to_sign = f'AWS4-HMAC-SHA256\n{amz}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}'
    k = ('AWS4' + env['BRAIN_FEED_R2_SECRET_ACCESS_KEY']).encode()
    for part in (day, 'auto', 's3', 'aws4_request'):
        k = hmac.new(k, part.encode(), hashlib.sha256).digest()
    sig = hmac.new(k, to_sign.encode(), hashlib.sha256).hexdigest()
    auth = f"AWS4-HMAC-SHA256 Credential={env['BRAIN_FEED_R2_ACCESS_KEY_ID']}/{scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature={sig}"
    req = urllib.request.Request(f'https://{host}{path}', headers={'x-amz-date': amz, 'x-amz-content-sha256': payload, 'Authorization': auth})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read()


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--env', default='~/.config/cloudflare.env')
    env = load_env(ap.parse_args().env)
    OUT.mkdir(parents=True, exist_ok=True)
    meta = json.loads(get(env, 'v1/meta.json'))
    (OUT / 'meta.json').write_text(json.dumps(meta, indent=1))
    for name in ('dashboard.json', 'graph.json'):
        body = get(env, f'v1/{name}')
        want = meta['files'][name]['sha256']
        got = hashlib.sha256(body).hexdigest()
        (OUT / name).write_bytes(body)
        print(f"{name}: {len(body):,} bytes, sha256 {'matches meta' if got == want else 'DIFFERS from meta (file changed between reads)'}")
    print(f"meta generated {meta['generated']}, overall {meta['overall']}, schema {meta['schema']}")


if __name__ == '__main__':
    main()
