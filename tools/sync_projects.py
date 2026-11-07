#!/usr/bin/env python3
"""Push live project overviews to the collinslab D1 database.

Reads a private project list (default ~/.config/collinslab/projects.json, kept out of
this public repo), gathers live state from Claude Code background jobs
(~/.claude/jobs/*/state.json + timeline.jsonl), the handoff registry
(~/handoff/PROJECTS.md) and session transcript folders (~/.claude/projects/*),
and upserts one JSON row per project into the `projects` table.

Usage:
  sync_projects.py             # sync to Cloudflare D1
  sync_projects.py --dry-run   # print the rows instead
  sync_projects.py --out f.json

Credentials come from ~/.config/cloudflare.env (CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID).
Standard library only, so it runs from cron without a virtualenv.
"""
import argparse
import datetime as dt
import glob
import json
import os
import re
import sys
import time
import urllib.request
from pathlib import Path

HOME = Path.home()
JOBS = HOME / '.claude' / 'jobs'
TRANSCRIPTS = HOME / '.claude' / 'projects'
REGISTRY = HOME / 'handoff' / 'PROJECTS.md'
REPO = Path(__file__).resolve().parent.parent
UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
DAYS = 14  # length of the daily activity strip


def parse_time(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace('Z', '+00:00')).astimezone(UTC)
    except ValueError:
        return None


def handoff_time(stamp):
    """Handoff stamps are local times: 2026-11-07_0107 or 2026-10-14."""
    m = re.match(r'(\d{4}-\d{2}-\d{2})(?:_(\d{2})(\d{2}))?', stamp or '')
    if not m:
        return None
    local = dt.datetime.strptime(m.group(1), '%Y-%m-%d').replace(hour=int(m.group(2) or 12), minute=int(m.group(3) or 0))
    return local.astimezone(UTC)


def clean(text, limit=420):
    text = re.sub(r'\*\*|__|`', '', text or '')
    text = re.sub(r'\s+', ' ', text).strip()
    return text if len(text) <= limit else text[: limit - 1].rsplit(' ', 1)[0] + '…'


def iso(t):
    return t.strftime('%Y-%m-%dT%H:%M:%SZ') if t else None


def read_registry():
    rows = {}
    if not REGISTRY.exists():
        return rows
    for line in REGISTRY.read_text().splitlines():
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) >= 8 and cells[0] and cells[0] not in ('Project', '---'):
            rows[cells[0]] = {'latest': cells[4], 'goal': cells[5], 'status': cells[6]}
    return rows


def read_job(jid):
    d = JOBS / jid
    try:
        state = json.loads((d / 'state.json').read_text())
    except (OSError, ValueError):
        return None
    timeline = []
    try:
        for line in (d / 'timeline.jsonl').read_text().splitlines():
            try:
                e = json.loads(line)
            except ValueError:
                continue
            t = parse_time(e.get('at'))
            # Entries the agent wrote carry a message body in `text`; entries that echo the
            # user's own message (or are mid-turn narration) have an empty body, so skip them.
            if t and e.get('detail') and e.get('text'):
                timeline.append({'at': t, 'state': e.get('state'), 'text': clean(e['detail'])})
    except OSError:
        pass
    return {'id': jid, 'name': state.get('name') or jid, 'state': state.get('state'),
            'updated': parse_time(state.get('updatedAt')), 'timeline': timeline}


def transcript_times(patterns):
    times = []
    for pat in patterns:
        for folder in TRANSCRIPTS.glob(f'*{pat}*'):
            for f in folder.glob('*.jsonl'):
                times.append(dt.datetime.fromtimestamp(f.stat().st_mtime, UTC))
    return times


def build(cfg, registry):
    jobs = [j for j in (read_job(j) for j in cfg.get('jobs', [])) if j]
    events = sorted((dict(e, job=j['name']) for j in jobs for e in j['timeline']), key=lambda e: e['at'])
    t_times = transcript_times(cfg.get('transcripts', []))
    handoffs = []
    for slug in cfg.get('handoffs', []):
        r = registry.get(slug)
        if r:
            handoffs.append({'slug': slug, 'at': handoff_time(r['latest']), 'goal': clean(r['goal'], 300),
                             'status': r['status'] if r['status'] not in ('-', '') else None})

    candidates = [e['at'] for e in events] + [j['updated'] for j in jobs if j['updated']] + t_times + [h['at'] for h in handoffs if h['at']]
    last = max(candidates) if candidates else None
    running = any(j['state'] == 'working' and j['updated'] and NOW - j['updated'] < dt.timedelta(hours=6) for j in jobs)
    age = (NOW - last) if last else None
    status = ('running' if running else 'recent' if age and age < dt.timedelta(days=3)
              else 'idle' if age and age < dt.timedelta(days=DAYS) else 'dormant')

    now = events[-1] if events else None
    finished = []
    for e in events:  # keep finished turns, collapsing repeats of the same line
        if e['state'] in ('done', 'blocked', 'failed', 'working') and not (finished and finished[-1]['text'] == e['text']):
            finished.append(e)
    activity = [{'at': iso(e['at']), 'kind': e['state'], 'text': e['text'], 'job': e['job']} for e in finished[-8:]]
    activity += [{'at': iso(h['at']), 'kind': 'handoff', 'text': f"Handoff saved: {h['slug']}", 'job': 'handoff'} for h in handoffs if h['at']]
    activity.sort(key=lambda a: a['at'], reverse=True)

    today = dt.datetime.now().date()
    daily = [0] * DAYS
    for t in [e['at'] for e in events] + t_times:
        i = (today - t.astimezone().date()).days
        if 0 <= i < DAYS:
            daily[DAYS - 1 - i] += 1

    return {
        'slug': cfg['slug'], 'title': cfg['title'], 'tagline': cfg['tagline'], 'about': cfg['about'],
        'kind': cfg['kind'], 'hue': cfg.get('hue', 0.08), 'facts': cfg.get('facts', []), 'where': cfg.get('where', []),
        'status': status, 'last_active': iso(last),
        'now': {'at': iso(now['at']), 'state': now['state'], 'text': now['text'], 'job': now['job']} if now else None,
        'activity': activity[:8], 'daily': daily,
        'jobs': [{'name': j['name'], 'state': j['state'], 'at': iso(j['updated'])} for j in jobs],
        'handoffs': [{'slug': h['slug'], 'at': iso(h['at']), 'goal': h['goal'], 'status': h['status']} for h in handoffs],
        'synced_at': iso(NOW),
    }


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
    with urllib.request.urlopen(req, timeout=30) as r:
        out = json.load(r)
    if not out.get('success'):
        raise RuntimeError(out.get('errors'))
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--config', default=str(HOME / '.config' / 'collinslab' / 'projects.json'))
    ap.add_argument('--env', default=str(HOME / '.config' / 'cloudflare.env'))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--out')
    a = ap.parse_args()

    registry = read_registry()
    projects = json.loads(Path(a.config).read_text())['projects']
    rows = [build(p, registry) for p in projects]

    if a.out:
        Path(a.out).write_text(json.dumps(rows, indent=1))
    if a.dry_run:
        for r in rows:
            print(f"{r['slug']:24} {r['status']:8} last={r['last_active']} now={(r['now'] or {}).get('text', '')[:70]!r}")
        return

    env, db = load_env(a.env), database_id()
    for i, r in enumerate(rows):
        d1(env, db, 'INSERT INTO projects (slug, sort, data, updated_at) VALUES (?, ?, ?, ?) '
                    'ON CONFLICT(slug) DO UPDATE SET sort = excluded.sort, data = excluded.data, updated_at = excluded.updated_at',
           [r['slug'], i, json.dumps(r), r['synced_at']])
    slugs = [r['slug'] for r in rows]
    d1(env, db, f"DELETE FROM projects WHERE slug NOT IN ({', '.join('?' * len(slugs))})", slugs)
    print(f"{iso(NOW)} synced {len(rows)} projects")


if __name__ == '__main__':
    main()
