#!/usr/bin/env python3
"""Fill the LOCAL D1 (wrangler's .wrangler/ state, used by `npm run dev:full`) with the current
projects and pulse rows, so the pages can be checked before a deploy. Never touches the remote database.

Usage: seed_local.py [--state DIR]   then `npm run dev:full`.
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
REPO = TOOLS.parent
TMP = REPO / '.wrangler' / 'seed'


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--state', default=str(Path.home() / '.local' / 'state' / 'collinslab' / 'pulse'))
    a = ap.parse_args()
    TMP.mkdir(parents=True, exist_ok=True)
    subprocess.run([sys.executable, str(TOOLS / 'sync_projects.py'), '--dry-run', '--out', str(TMP / 'sync.json')], check=True, stdout=subprocess.DEVNULL)
    subprocess.run([sys.executable, str(TOOLS / 'pulse' / 'push.py'), '--state', a.state, '--dry-run', '--sql-out', str(TMP / 'pulse.sql')], check=True, stdout=subprocess.DEVNULL)
    q = lambda v: "'" + str(v).replace("'", "''") + "'"
    rows = json.loads((TMP / 'sync.json').read_text())['projects']
    sql = ['DELETE FROM projects;'] + [f"INSERT INTO projects (slug, sort, data, updated_at) VALUES ({q(r['slug'])}, {i}, {q(json.dumps(r))}, {q(r['synced_at'])});" for i, r in enumerate(rows)]
    (TMP / 'projects.sql').write_text('\n'.join(sql) + '\n')
    for f in ('projects.sql', 'pulse.sql'):
        subprocess.run(['npx', 'wrangler', 'd1', 'execute', 'collinslab', '--local', '--file', str(TMP / f)], cwd=REPO, check=True, stdout=subprocess.DEVNULL)
    print(f'seeded local D1: {len(rows)} projects, pulse from {a.state}')


if __name__ == '__main__':
    main()
