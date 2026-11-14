#!/usr/bin/env python3
"""Push live project overviews to the collinslab D1 database.

Reads a private project list (default ~/.config/collinslab/projects.json, kept out of
this public repo), gathers live state from Claude Code background jobs
(~/.claude/jobs/*/state.json + timeline.jsonl), the handoff registry
(~/handoff/PROJECTS.md) and session transcript folders (~/.claude/projects/*),
and upserts one JSON row per project into the `projects` table.

Also indexes every Claude chat (see tools/chats.py) into the `chats` table.

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
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import chats as chatlib  # noqa: E402
from cfd1 import d1, database_id, load_env  # noqa: E402,F401

HOME = Path.home()
JOBS = HOME / '.claude' / 'jobs'
TRANSCRIPTS = HOME / '.claude' / 'projects'
REGISTRY = HOME / 'handoff' / 'PROJECTS.md'
REPO = Path(__file__).resolve().parent.parent
UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
DAYS = 14  # length of the daily activity strip
PULSE = HOME / '.local' / 'state' / 'collinslab' / 'pulse'  # written by tools/pulse/
AUTO_KINDS = ['specimen', 'tree', 'packages', 'bars', 'surface', 'molecule', 'map', 'dna', 'galaxy', 'embedding', 'helix', 'globe']


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
    status = cfg.get('status') or ('running' if running else 'recent' if age and age < dt.timedelta(days=3)
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
        'kind': cfg['kind'], 'hue': cfg.get('hue', 0.08), 'facts': cfg.get('facts', []), 'where': cfg.get('where', []), 'link': cfg.get('link'),
        'status': status, 'last_active': iso(last),
        'now': {'at': iso(now['at']), 'state': now['state'], 'text': now['text'], 'job': now['job']} if now else None,
        'activity': activity[:8], 'daily': daily,
        'jobs': [{'name': j['name'], 'state': j['state'], 'at': iso(j['updated'])} for j in jobs],
        'handoffs': [{'slug': h['slug'], 'at': iso(h['at']), 'goal': h['goal'], 'status': h['status']} for h in handoffs],
        'synced_at': iso(NOW),
    }


def _load(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError):
        return None


def auto_projects(configured):
    """Projects the pulse scan found that the private project list does not have (hand-set entries win)."""
    out = []
    for f in sorted((PULSE / 'facts').glob('*.json')):
        facts = _load(f)
        if not facts or facts.get('configured') or facts['slug'] in configured:
            continue
        goal = next((h.get('goal') for h in facts.get('handoffs', []) if h.get('goal')), '') or ''
        seed = sum(map(ord, facts['slug']))
        out.append({'slug': facts['slug'], 'title': facts['title'], 'tagline': clean(goal, 160), 'about': clean(goal, 600),
                    'kind': 'manuscript' if facts.get('manuscripts') else AUTO_KINDS[seed % len(AUTO_KINDS)],
                    'hue': round((seed * 0.137) % 1, 3), 'handoffs': [h['slug'] for h in facts.get('handoffs', [])],
                    'transcripts': [facts['slug']], 'jobs': [], 'auto': True})
    return out


def attach_pulse(row):
    """Merge the last validated pulse summary and the scan's momentum into a project row."""
    summary = _load(PULSE / 'valid' / f"{row['slug']}.json")
    facts = _load(PULSE / 'facts' / f"{row['slug']}.json")
    if facts:
        row['momentum'] = facts.get('momentum')
    if summary:
        p = {k: summary.get(k) for k in ('stage', 'headline', 'current_work', 'next_milestone', 'blocked_on_me',
                                         'unattended', 'open_problems', 'value_note', 'pulse_at')}
        p['manuscripts'] = [{'slug': m.get('slug'), 'title': m.get('title'), 'stage': m.get('stage'),
                             'hours_to_submission': m.get('hours_to_submission')} for m in summary.get('manuscripts', [])]
        port = _load(PULSE / 'valid' / '_portfolio.json') or {}
        rank = next((r for r in port.get('ranking', []) if r.get('project') == row['slug']), None)
        if rank:
            p['rank'] = {'value': rank['value'], 'effort': rank['effort'], 'note': rank['note']}
        row['pulse'] = p
    return row


def pulse_board(cfg):
    """The 'Ongoing manuscripts' entry: status follows the pulse cron, facts come from the last summaries."""
    import subprocess
    try:
        on = 'tools/pulse/run.sh' in subprocess.run(['crontab', '-l'], capture_output=True, text=True, timeout=10).stdout
    except (OSError, subprocess.SubprocessError):
        on = False
    stages = Counter()
    latest = None
    for vf in (PULSE / 'valid').glob('*.json'):
        if vf.name.startswith('_'):
            continue
        summary = _load(vf) or {}
        for m in summary.get('manuscripts', []):
            stages[m.get('stage') or 'unjudged'] += 1
        latest = max(filter(None, [latest, summary.get('pulse_at')]), default=None)
    facts = [['Manuscripts', str(sum(stages.values()))]] + [[k.capitalize(), str(v)] for k, v in sorted(stages.items())]
    facts.append(['Hourly pulse', 'on' if on else 'off (ask to turn it back on)'])
    if latest:
        facts.append(['Last judged', latest[:16].replace('T', ' ') + ' UTC'])
    return dict(cfg, status='recent' if on else 'paused', facts=facts)


def humanize(title):
    """Job-style slugs ("tmux-mouse-mode-copy") read better as words ("Tmux mouse mode copy")."""
    t = (title or '').strip()
    if t and ' ' not in t and '-' in t:
        t = t.replace('--', ' / ').replace('-', ' ').replace('…', '…')
        t = t[0].upper() + t[1:]
    return t or 'Untitled chat'


def chat_row(c):
    """The public-facing shape of one chat (paths shortened, nothing large)."""
    home = str(HOME)
    cwd = (c.get('cwd') or '').replace(home, '~', 1) or None
    return {
        'id': c['id'], 'title': humanize(c['title']), 'first_prompt': c.get('first_prompt'), 'prompts': c['prompts'],
        'start': c['start'], 'end': c['end'], 'host': c['host'], 'cwd': cwd, 'branch': c.get('branch'),
        'job_name': c.get('job_name'), 'project': c.get('project'), 'project_title': c.get('project_title'),
        # A project may carry a category the keyword rules do not know (e.g. "business"):
        # show it under its own name, sorted after the known ones, instead of failing the sync.
        'category': c['category'], 'category_label': chatlib.CATEGORY_LABELS.get(c['category'], c['category'].replace('-', ' ').capitalize()),
        'category_rank': chatlib.CATEGORY_ORDER.index(c['category']) if c['category'] in chatlib.CATEGORY_ORDER else len(chatlib.CATEGORY_ORDER),
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--config', default=str(HOME / '.config' / 'collinslab' / 'projects.json'))
    ap.add_argument('--env', default=str(HOME / '.config' / 'cloudflare.env'))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--out')
    a = ap.parse_args()

    registry = read_registry()
    projects = json.loads(Path(a.config).read_text())['projects']
    projects = projects + auto_projects({p['slug'] for p in projects})
    for p in projects:  # a handoff with the project's own slug belongs to it even if the list omits it
        if p['slug'] in registry and p['slug'] not in p.setdefault('handoffs', []):
            p['handoffs'] = p['handoffs'] + [p['slug']]
    projects = [pulse_board(p) if p.get('pulse_board') else p for p in projects]
    rows = [attach_pulse(build(p, registry)) for p in projects]

    def project_for(sid, folder):
        for p in projects:
            if any(sid.startswith(j) for j in p.get('jobs', [])) or any(t in folder for t in p.get('transcripts', [])):
                return p['slug'], p['title'], p.get('category')
        return None, None, None

    chat_rows = [chat_row(c) for c in chatlib.collect(project_for)]

    if a.out:
        Path(a.out).write_text(json.dumps({'projects': rows, 'chats': chat_rows}, indent=1))
    if a.dry_run:
        for r in rows:
            print(f"{r['slug']:24} {r['status']:8} last={r['last_active']} now={(r['now'] or {}).get('text', '')[:70]!r}")
        print(f"{len(chat_rows)} chats:", ', '.join(f"{k} {v}" for k, v in sorted(Counter(c['category'] for c in chat_rows).items())))
        return

    env, db = load_env(a.env), database_id()
    for i, r in enumerate(rows):
        d1(env, db, 'INSERT INTO projects (slug, sort, data, updated_at) VALUES (?, ?, ?, ?) '
                    'ON CONFLICT(slug) DO UPDATE SET sort = excluded.sort, data = excluded.data, updated_at = excluded.updated_at',
           [r['slug'], i, json.dumps(r), r['synced_at']])
    slugs = [r['slug'] for r in rows]
    d1(env, db, f"DELETE FROM projects WHERE slug NOT IN ({', '.join('?' * len(slugs))})", slugs)
    stamp = iso(NOW)
    for i in range(0, len(chat_rows), 20):  # 5 values per chat; D1 allows at most 100 bound parameters per query
        batch = chat_rows[i:i + 20]
        d1(env, db, 'INSERT INTO chats (id, start, category, data, synced_at) VALUES '
                    + ', '.join(['(?, ?, ?, ?, ?)'] * len(batch))
                    + ' ON CONFLICT(id) DO UPDATE SET start = excluded.start, category = excluded.category, '
                      'data = excluded.data, synced_at = excluded.synced_at',
           [v for c in batch for v in (c['id'], c['start'], c['category'], json.dumps(c), stamp)])
    if chat_rows:
        d1(env, db, 'DELETE FROM chats WHERE synced_at != ?', [stamp])
    print(f"{stamp} synced {len(rows)} projects, {len(chat_rows)} chats")


if __name__ == '__main__':
    main()
