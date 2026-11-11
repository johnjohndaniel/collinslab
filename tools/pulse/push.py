#!/usr/bin/env python3
"""Validate the pulse summaries the models wrote and push them to D1.

Reads <state>/projects/<slug>.json (one per project, from the Haiku workers),
<state>/portfolio.json (from the orchestrator), <state>/facts/*.json (from scan.py) and
<state>/pending_fingerprints.json. For each summary that passes tools/pulse/schema.json:
  - redacts secret-like strings and email addresses,
  - stores a last-good copy in <state>/valid/<slug>.json (read by sync_projects.py),
  - promotes that project's fingerprint so the next run skips it until it changes.
An invalid summary keeps the previous last-good copy and its fingerprint is not promoted,
so the next hourly run retries it. After 3 consecutive failures the fingerprint is promoted
anyway, to stop paying for a worker that keeps failing.

Then upserts one `pulse` row per manuscript (worker judgement merged with the scan's
deterministic counts) and one `portfolio` row, removes manuscript rows missing from two
consecutive pushes, and runs sync_projects.py so the projects page picks up the change.

Usage: push.py [--state DIR] [--dry-run]
"""
import argparse
import datetime as dt
import json
import re
import subprocess
import sys
from pathlib import Path

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))
from cfd1 import d1, database_id, load_env  # noqa: E402
from chats import SECRET  # noqa: E402

HOME = Path.home()
STATE = HOME / '.local' / 'state' / 'collinslab' / 'pulse'
SCHEMA = json.loads((Path(__file__).resolve().parent / 'schema.json').read_text())
EMAIL = re.compile(r'[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}')
NOW = dt.datetime.now(dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
TYPES = {'string': str, 'boolean': bool, 'object': dict, 'array': list, 'null': type(None)}


def validate(value, schema, where='$'):
    """Return (cleaned value, errors). Keywords: type, required, properties, items, enum,
    maxLength, maxItems, minimum. Unknown object keys are dropped. Over-long strings and
    lists are truncated rather than rejected, since a model's verbosity is not a reason to lose a row."""
    errs = []
    types = schema.get('type')
    types = types if isinstance(types, list) else [types] if types else []
    if types:
        ok = any((t == 'number' and isinstance(value, (int, float)) and not isinstance(value, bool))
                 or (t != 'number' and isinstance(value, TYPES[t])) for t in types)
        if not ok:
            return value, [f'{where}: expected {"/".join(types)}, got {type(value).__name__}']
    if 'enum' in schema and value not in schema['enum']:
        errs.append(f'{where}: {value!r} not in {schema["enum"]}')
    if isinstance(value, str):
        value = EMAIL.sub('[email]', SECRET.sub('[redacted]', value))
        if 'maxLength' in schema and len(value) > schema['maxLength']:
            value = value[: schema['maxLength'] - 1].rstrip() + '…'
    if isinstance(value, (int, float)) and not isinstance(value, bool) and 'minimum' in schema and value < schema['minimum']:
        errs.append(f'{where}: {value} below {schema["minimum"]}')
    if isinstance(value, dict):
        props = schema.get('properties', {})
        for k in schema.get('required', []):
            if k not in value:
                errs.append(f'{where}: missing {k}')
        out = {}
        for k, sub in props.items():
            if k in value:
                out[k], e = validate(value[k], sub, f'{where}.{k}')
                errs += e
        value = out
    if isinstance(value, list) and 'items' in schema:
        value = value[: schema.get('maxItems', len(value))]
        cleaned = []
        for i, item in enumerate(value):
            c, e = validate(item, schema['items'], f'{where}[{i}]')
            cleaned.append(c)
            errs += e
        value = cleaned
    return value, errs


def load(path):
    try:
        return json.loads(Path(path).read_text())
    except (OSError, ValueError) as e:
        return e


def manuscript_row(ms_facts, judged, project):
    """Deterministic facts win for counts. The model's judgement supplies stage, statuses and notes."""
    by_heading = {s['heading'].strip().lower(): s for s in ms_facts.get('sections', [])}
    sections = []
    for s in judged.get('sections', []):
        f = by_heading.get(s['heading'].strip().lower())
        sections.append(dict(s, words=f.get('words_total', f['words']) if f else s.get('words')))
    return {
        'slug': ms_facts['slug'], 'project': project['slug'], 'project_title': project.get('title'),
        'title': judged.get('title') or ms_facts['slug'], 'stage': judged.get('stage'), 'summary': judged.get('summary'),
        'target': judged.get('target'), 'sections': sections, 'figures_note': judged.get('figures_note'),
        'citations_note': judged.get('citations_note'), 'next_action': judged.get('next_action'),
        'hours_to_submission': judged.get('hours_to_submission'),
        'words': ms_facts.get('words'), 'figures': ms_facts.get('figures'), 'tables': ms_facts.get('tables'),
        'citations': ms_facts.get('citations'), 'doc_stats': ms_facts.get('doc_stats'), 'markers': ms_facts.get('markers'),
        'main': ms_facts.get('main'), 'root': ms_facts.get('root'), 'artifacts': ms_facts.get('artifacts', []),
        'modified': ms_facts.get('modified'), 'note': ms_facts.get('note'),
        'blocked_on_me': project.get('blocked_on_me', []), 'pulse_at': project.get('pulse_at'), 'synced_at': NOW,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--state', default=str(STATE))
    ap.add_argument('--dry-run', action='store_true')
    ap.add_argument('--sql-out', help='with --dry-run: write the pulse rows as SQL for a local D1 (npm run dev:full)')
    a = ap.parse_args()
    state = Path(a.state)
    (state / 'valid').mkdir(exist_ok=True)
    pending = load(state / 'pending_fingerprints.json')
    pending = pending if isinstance(pending, dict) else {}
    fps = load(state / 'fingerprints.json')
    fps = fps if isinstance(fps, dict) else {}
    fails = load(state / 'failures.json')
    fails = fails if isinstance(fails, dict) else {}
    manifest = load(state / 'manifest.json')
    changed = set(manifest.get('changed', [])) if isinstance(manifest, dict) else set()

    report = []
    for slug in sorted(pending):
        out = state / 'projects' / f'{slug}.json'
        raw = load(out) if out.exists() else None
        if slug not in changed:
            continue
        if raw is None or isinstance(raw, Exception):
            errs = ['no summary written' if raw is None else f'unreadable: {raw}']
        else:
            if not isinstance(raw, dict) or raw.get('slug') != slug:
                errs = ['slug mismatch or not an object']
            else:
                cleaned, errs = validate(raw, SCHEMA['project'])
                if not errs:
                    cleaned['pulse_at'] = dt.datetime.fromtimestamp(out.stat().st_mtime, dt.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ')
                    (state / 'valid' / f'{slug}.json').write_text(json.dumps(cleaned, indent=1))
        if errs:
            fails[slug] = fails.get(slug, 0) + 1
            report.append(f'{slug}: rejected ({fails[slug]}x) {"; ".join(errs[:3])}')
            if fails[slug] >= 3:
                fps[slug] = pending[slug]
        else:
            fails.pop(slug, None)
            fps[slug] = pending[slug]

    # Portfolio: keep the last good one if the new one fails.
    port = load(state / 'portfolio.json')
    port_row = None
    if isinstance(port, dict):
        cleaned, errs = validate(port, SCHEMA['portfolio'])
        if errs:
            report.append(f'portfolio: rejected {"; ".join(errs[:3])}')
        else:
            cleaned['generated'] = NOW
            (state / 'valid' / '_portfolio.json').write_text(json.dumps(cleaned, indent=1))
    last = load(state / 'valid' / '_portfolio.json')
    if isinstance(last, dict):
        port_row = last

    # Manuscript rows from every last-good project summary plus the current facts.
    rows = []
    for vf in sorted((state / 'valid').glob('*.json')):
        if vf.name.startswith('_'):
            continue
        proj = load(vf)
        facts = load(state / 'facts' / vf.name)
        if not isinstance(proj, dict) or not isinstance(facts, dict):
            continue
        proj.setdefault('title', facts.get('title'))
        judged = {m.get('slug'): m for m in proj.get('manuscripts', [])}
        for mf in facts.get('manuscripts', []):
            rows.append(manuscript_row(mf, judged.get(mf['slug'], {}), dict(proj, title=facts.get('title'))))

    misses = load(state / 'misses.json')
    misses = misses if isinstance(misses, dict) else {}
    present = {r['slug'] for r in rows}

    for line in report:
        print(f'{NOW} {line}')
    if a.dry_run:
        print(f'{NOW} dry run: {len(rows)} manuscripts, portfolio={"yes" if port_row else "no"}')
        if a.sql_out:
            q = lambda v: "'" + str(v).replace("'", "''") + "'"
            stmts = ['DELETE FROM pulse;'] + [f"INSERT INTO pulse (slug, kind, project, data, updated_at) VALUES ({q(r['slug'])}, 'manuscript', {q(r['project'])}, {q(json.dumps(r))}, {q(NOW)});" for r in rows]
            if port_row:
                stmts.append(f"INSERT INTO pulse (slug, kind, project, data, updated_at) VALUES ('_portfolio', 'portfolio', NULL, {q(json.dumps(port_row))}, {q(NOW)});")
            Path(a.sql_out).write_text('\n'.join(stmts) + '\n')
        for r in rows:
            print(f"  {r['slug']:28} {r['stage'] or '-':16} {len(r['sections']):2} sections  {r['words']} words")
        return

    env, db = load_env(HOME / '.config' / 'cloudflare.env'), database_id()
    for i in range(0, len(rows), 20):  # 5 values each, D1 allows 100 bound parameters
        batch = rows[i:i + 20]
        d1(env, db, 'INSERT INTO pulse (slug, kind, project, data, updated_at) VALUES '
                    + ', '.join(['(?, ?, ?, ?, ?)'] * len(batch))
                    + ' ON CONFLICT(slug) DO UPDATE SET kind = excluded.kind, project = excluded.project, '
                      'data = excluded.data, updated_at = excluded.updated_at',
           [v for r in batch for v in (r['slug'], 'manuscript', r['project'], json.dumps(r), NOW)])
    if port_row:
        d1(env, db, 'INSERT INTO pulse (slug, kind, project, data, updated_at) VALUES (?, ?, NULL, ?, ?) '
                    'ON CONFLICT(slug) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at',
           ['_portfolio', 'portfolio', json.dumps(port_row), NOW])
    # Remove manuscript rows missing from two consecutive pushes.
    live = d1(env, db, "SELECT slug FROM pulse WHERE kind = 'manuscript'", [])['result'][0]['results']
    gone = []
    for r in live:
        s = r['slug']
        if s in present:
            misses.pop(s, None)
        else:
            misses[s] = misses.get(s, 0) + 1
            if misses[s] >= 2:
                gone.append(s)
                misses.pop(s)
    for s in gone:
        d1(env, db, 'DELETE FROM pulse WHERE slug = ?', [s])

    (state / 'fingerprints.json').write_text(json.dumps(fps, indent=1))
    (state / 'failures.json').write_text(json.dumps(fails, indent=1))
    (state / 'misses.json').write_text(json.dumps(misses, indent=1))
    print(f'{NOW} pushed {len(rows)} manuscripts, portfolio={"yes" if port_row else "no"}, removed {len(gone)}')
    sync = subprocess.run([sys.executable, str(TOOLS / 'sync_projects.py')], capture_output=True, text=True, timeout=600)
    print((sync.stdout or sync.stderr).strip().splitlines()[-1] if (sync.stdout or sync.stderr) else 'sync: no output')


if __name__ == '__main__':
    main()
