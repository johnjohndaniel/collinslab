#!/usr/bin/env python3
"""Change gate and fact extractor for the hourly project pulse.

Builds the list of projects (the private ~/.config/collinslab/projects.json plus every
handoff root in ~/handoff/PROJECTS.md that it does not cover) and the list of
manuscripts (the private ~/.config/collinslab/pulse.json plus Claude's proposals in
<state>/discovered.json). For each it extracts facts without a model: handoff goal,
open decisions and next steps, recent agent activity, momentum counts, manuscript
sections with word counts, figure, table and citation counts, Word comments and
tracked changes. It fingerprints every project and compares with the fingerprints of
the last successful push.

Writes into the state folder (default ~/.local/state/collinslab/pulse):
  facts/<slug>.json        one per project, with its manuscripts inline
  text/<manuscript>.md     plain text of each manuscript, so a model can read a .docx
  manifest.json            every project, which ones changed, unregistered candidates
  pending_fingerprints.json  promoted to fingerprints.json by push.py after a good push

Exit code 0 with "unchanged" on stdout when nothing changed, else prints the changed slugs.
Usage: scan.py [--force] [--only SLUG ...] [--state DIR]
Standard library only.
"""
import argparse
import datetime as dt
import glob
import hashlib
import json
import os
import re
import subprocess
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

TOOLS = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(TOOLS))
import sync_projects as sp  # noqa: E402  (read_registry, read_job, handoff_time, iso)

HOME = Path.home()
HANDOFF = HOME / 'handoff'
CONFIG = HOME / '.config' / 'collinslab'
STATE = HOME / '.local' / 'state' / 'collinslab' / 'pulse'
UTC = dt.timezone.utc
NOW = dt.datetime.now(UTC)
W = '{http://schemas.openxmlformats.org/wordprocessingml/2006/main}'
CLOSED = ('merged', 'graduated', 'abandoned')
MARKER = re.compile(r'\b(TODO|TBD|FIXME|XXX)\b|\[(?:cite|citation needed|ref|REF)\]|\?\?\?|\{(?:tab|fig):[^}]*\}')


def x(p):
    return Path(os.path.expanduser(p))


def words(text):
    return len(re.findall(r"[A-Za-z0-9][A-Za-z0-9'’\-]*", text))


# ---------- manuscripts -------------------------------------------------------------

def expand(root, patterns, ignore):
    out = []
    for pat in patterns or []:
        full = x(pat) if pat.startswith('~') or pat.startswith('/') else root / pat
        for f in glob.glob(str(full)):
            if os.path.isfile(f) and not any(i in f for i in ignore):
                out.append(Path(f))
    return sorted(set(out))


def docx_sections(path):
    """Paragraph-level parse of a .docx: headings by style, word counts, comments, tracked changes."""
    with zipfile.ZipFile(path) as z:
        root = ET.fromstring(z.read('word/document.xml'))
        comments = 0
        if 'word/comments.xml' in z.namelist():
            comments = len(ET.fromstring(z.read('word/comments.xml')).findall(f'{W}comment'))
    body = root.find(f'{W}body')
    sections, lines, tables = [], [], 0
    cur = {'heading': '(front matter)', 'level': 1, 'words': 0}
    ins = len(root.findall(f'.//{W}ins'))
    dels = len(root.findall(f'.//{W}del'))
    for el in body:
        if el.tag == f'{W}tbl':
            tables += 1
            lines.append('[table]')
            continue
        if el.tag != f'{W}p':
            continue
        style = el.find(f'{W}pPr/{W}pStyle')
        sval = style.get(f'{W}val') if style is not None else ''
        text = ''.join(t.text or '' for t in el.iter(f'{W}t')).strip()
        if not text:
            continue
        m = re.match(r'(?i)heading\s*(\d)|^(title)$', sval or '')
        if m:
            level = int(m.group(1)) if m.group(1) else 0
            if level == 0:
                lines.append(f'# {text}')
                continue
            if cur['words'] or cur['heading'] != '(front matter)':
                sections.append(cur)
            cur = {'heading': text, 'level': level, 'words': 0}
            lines.append(f"{'#' * (level + 1)} {text}")
        else:
            cur['words'] += words(text)
            lines.append(text)
    sections.append(cur)
    return sections, '\n\n'.join(lines), {'tables_in_doc': tables, 'comments': comments, 'tracked_insertions': ins, 'tracked_deletions': dels}


def md_sections(text):
    sections, cur = [], {'heading': '(front matter)', 'level': 1, 'words': 0}
    fence = False
    for line in text.splitlines():
        if line.strip().startswith('```'):
            fence = not fence
            continue
        m = None if fence else re.match(r'^(#{1,6})\s+(.*)', line)
        if m:
            level = len(m.group(1))
            if level == 1 and not sections and cur['words'] == 0:
                continue  # document title
            if cur['words'] or cur['heading'] != '(front matter)':
                sections.append(cur)
            cur = {'heading': m.group(2).strip(), 'level': level - 1 or 1, 'words': 0}
        else:
            cur['words'] += words(line)
    sections.append(cur)
    return sections


def tsv_rows(path):
    try:
        with open(path, errors='replace') as f:
            n = sum(1 for line in f if line.strip())
        return max(n - 1, 0) if path.suffix in ('.tsv', '.csv') else None
    except OSError:
        return None


def bib_entries(path):
    try:
        return len(re.findall(r'^@\w+\{', path.read_text(errors='replace'), re.M))
    except OSError:
        return None


def stat_sig(files):
    return [(str(f), f.stat().st_size, int(f.stat().st_mtime)) for f in files if f.exists()]


def manuscript_facts(m, ignore, state):
    root = x(m['root'])
    main = expand(root, m.get('main'), ignore)
    main = max(main, key=lambda f: f.stat().st_mtime) if main else None
    text_files = expand(root, m.get('text'), ignore)
    figures = expand(root, m.get('figures'), ignore)
    tables = expand(root, m.get('tables'), ignore)
    citations = expand(root, m.get('citations'), ignore)
    notes = expand(root, m.get('notes'), ignore)
    out = {'slug': m['slug'], 'project': m.get('project'), 'root': str(root).replace(str(HOME), '~', 1),
           'note': m.get('note'), 'artifacts': m.get('artifacts', []), 'main': None, 'sections': [],
           'words': 0, 'doc_stats': {}, 'markers': 0}
    text = ''
    try:
        if main and main.suffix == '.docx':
            secs, text, stats = docx_sections(main)
            out['sections'], out['doc_stats'] = secs, stats
        elif main:
            text = main.read_text(errors='replace')
            out['sections'] = md_sections(text)
    except (OSError, zipfile.BadZipFile, ET.ParseError) as e:
        out['error'] = f'could not parse main file: {e.__class__.__name__}'
    if main and len(text_files) > 1 and main.suffix != '.docx':
        # several section files (e.g. 01_introduction.md, 02_methods.md): one section per file
        out['sections'] = []
        text = ''
        for f in text_files:
            t = f.read_text(errors='replace')
            text += f'\n\n# {f.stem}\n\n' + t
            out['sections'].append({'heading': f.stem, 'level': 1, 'words': words(t)})
    secs = out['sections']
    for i, sec in enumerate(secs):  # roll subsection words up into each heading's total
        total = sec['words']
        for nxt in secs[i + 1:]:
            if nxt['level'] <= sec['level']:
                break
            total += nxt['words']
        sec['words_total'] = total
    out['words'] = sum(s['words'] for s in secs)
    out['markers'] = len(MARKER.findall(text))
    if main:
        out['main'] = {'path': str(main).replace(str(HOME), '~', 1), 'format': main.suffix.lstrip('.'),
                       'modified': sp.iso(dt.datetime.fromtimestamp(main.stat().st_mtime, UTC))}
    if text:
        tdir = state / 'text'
        tdir.mkdir(parents=True, exist_ok=True)
        (tdir / f"{m['slug']}.md").write_text(text)
        out['text_path'] = str(tdir / f"{m['slug']}.md")
    svg = sum(1 for f in figures if f.suffix == '.svg')
    png = sum(1 for f in figures if f.suffix in ('.png', '.jpg', '.jpeg'))
    pdf = sum(1 for f in figures if f.suffix == '.pdf')
    out['figures'] = {'svg': svg, 'png': png, 'pdf': pdf, 'distinct': len({f.stem for f in figures})}
    out['tables'] = {'files': len(tables), 'xlsx': sum(1 for f in tables if f.suffix == '.xlsx')}
    cit = {}
    for f in citations:
        n = bib_entries(f) if f.suffix == '.bib' else tsv_rows(f)
        cit[f.name] = n
    out['citations'] = cit
    out['read'] = [str(f) for f in notes + citations if f.suffix in ('.md', '.tsv', '.txt')]
    every = ([main] if main else []) + text_files + figures + tables + citations + notes
    out['modified'] = sp.iso(max((dt.datetime.fromtimestamp(f.stat().st_mtime, UTC) for f in every), default=None)) if every else None
    out['_sig'] = stat_sig(every)
    return out


# ---------- projects ----------------------------------------------------------------

def newest_handoff(slug):
    d = HANDOFF / slug
    stamps = sorted(p.name for p in d.glob('20*') if p.is_dir()) if d.is_dir() else []
    return (d / stamps[-1]) if stamps else None


def handoff_facts(slug, registry):
    h = newest_handoff(slug)
    r = registry.get(slug, {})
    out = {'slug': slug, 'latest': r.get('latest') or (h.name if h else None), 'branch_status': r.get('status'),
           'goal': sp.clean(r.get('goal', ''), 400)}
    if not h:
        return out
    state = h / 'extracted' / 'STATE.json'
    summary = h / 'extracted' / 'SESSION_SUMMARY.md'
    try:
        s = json.loads(state.read_text())
        out['goal'] = s.get('goal') or out['goal']
        out['open_decisions'] = s.get('open_decisions') or []
        out['next_steps'] = s.get('next_steps') or []
        out['artifacts'] = [a.get('url') for a in s.get('artifacts') or [] if isinstance(a, dict) and a.get('url')]
        out['repos'] = [r2.get('path') for r2 in s.get('repos') or [] if isinstance(r2, dict) and r2.get('path')]
    except (OSError, ValueError):
        pass
    if summary.exists():
        out['summary_path'] = str(summary)
    return out


def repo_head(path):
    try:
        return subprocess.run(['git', '-C', os.path.expanduser(path), 'rev-parse', 'HEAD'], capture_output=True,
                              text=True, timeout=10).stdout.strip() or None
    except (OSError, subprocess.SubprocessError):
        return None


def momentum(days_seen):
    today = dt.datetime.now().date()
    ages = [(today - d).days for d in days_seen]
    return {'active_days_7': len({a for a in ages if 0 <= a < 7}), 'active_days_30': len({a for a in ages if 0 <= a < 30})}


def project_units(projects, registry):
    covered = {}
    units = []
    for p in projects:
        if p.get('pulse_board'):
            continue  # the manuscripts board entry, not a research project
        hs = list(p.get('handoffs', []))
        if p['slug'] in registry and p['slug'] not in hs:
            hs.append(p['slug'])
        for h in hs:
            covered[h] = p['slug']
        units.append({'slug': p['slug'], 'title': p.get('title') or p['slug'], 'handoffs': hs, 'jobs': p.get('jobs', []),
                      'transcripts': p.get('transcripts', []), 'configured': True, 'status': p.get('status')})
    roots = {}
    for slug, r in registry.items():
        if slug in covered:
            continue
        root = slug.split('--')[0]
        if root in covered:
            continue  # branch of a configured project the config does not list explicitly
        roots.setdefault(root, []).append(slug)
    for root, hs in sorted(roots.items()):
        open_or_root = [h for h in hs if h == root or (registry[h].get('status') or '-') not in CLOSED]
        units.append({'slug': root, 'title': root.replace('-', ' ').capitalize(), 'handoffs': sorted(open_or_root),
                      'jobs': [], 'transcripts': [root], 'configured': False, 'status': None})
    return units


def project_facts(u, registry, mss):
    hand = [handoff_facts(h, registry) for h in u['handoffs']]
    jobs = [j for j in (sp.read_job(j) for j in u['jobs']) if j]
    events = sorted((e for j in jobs for e in j['timeline']), key=lambda e: e['at'])
    seen = [e['at'].astimezone().date() for e in events]
    sessions = 0
    for pat in u['transcripts']:
        for folder in sp.TRANSCRIPTS.glob(f'*{pat}*'):
            for f in folder.glob('*.jsonl'):
                t = dt.datetime.fromtimestamp(f.stat().st_mtime, UTC)
                seen.append(t.astimezone().date())
                if NOW - t < dt.timedelta(days=30):
                    sessions += 1
    for h in hand:
        t = sp.handoff_time(h.get('latest'))
        if t:
            seen.append(t.astimezone().date())
    for m in mss:
        if m.get('modified'):
            seen.append(sp.parse_time(m['modified']).astimezone().date())
    last = max(seen) if seen else None
    mom = momentum(seen)
    mom['sessions_30'] = sessions
    mom['last_active_day'] = last.isoformat() if last else None
    mom['days_since_active'] = (dt.datetime.now().date() - last).days if last else None
    recent = []
    for e in events[-12:]:
        if e['state'] in ('done', 'blocked', 'failed', 'working') and not (recent and recent[-1]['text'] == e['text']):
            recent.append({'at': sp.iso(e['at']), 'state': e['state'], 'text': e['text']})
    heads = {r: repo_head(r) for h in hand for r in h.get('repos', [])}
    facts = {'slug': u['slug'], 'title': u['title'], 'configured': u['configured'], 'fixed_status': u['status'],
             'handoffs': hand, 'recent_activity': recent[-8:],
             'jobs': [{'name': j['name'], 'state': j['state'], 'at': sp.iso(j['updated'])} for j in jobs],
             'momentum': mom, 'manuscripts': [{k: v for k, v in m.items() if k != '_sig'} for m in mss]}
    # Fingerprint: meaningful change only (new handoff, new agent-written job line, job state,
    # manuscript file edits, repo commits). Raw transcript churn is deliberately excluded.
    sig = {'h': [(h['slug'], h.get('latest')) for h in hand], 'e': sp.iso(events[-1]['at']) if events else None,
           'j': [(j['id'], j['state']) for j in jobs], 'r': heads, 'm': [m['_sig'] for m in mss]}
    fp = hashlib.sha256(json.dumps(sig, sort_keys=True, default=str).encode()).hexdigest()[:16]
    return facts, fp


# ---------- discovery ---------------------------------------------------------------

def unregistered(cfg, mss_roots, ignore):
    found = []
    for pat in cfg.get('discovery_roots', []):
        for d in glob.glob(os.path.expanduser(pat)):
            p = Path(d)
            if any(i in d for i in ignore) or not p.exists():
                continue
            if any(p.resolve().is_relative_to(r) or Path(r).is_relative_to(p.resolve()) for r in mss_roots):
                continue
            files = [f for f in (p.iterdir() if p.is_dir() else [p]) if f.suffix in ('.md', '.docx', '.tex', '.qmd')]
            if files:
                newest = max(files, key=lambda f: f.stat().st_mtime)
                found.append({'path': str(p).replace(str(HOME), '~', 1), 'files': len(files),
                              'newest': newest.name, 'modified': sp.iso(dt.datetime.fromtimestamp(newest.stat().st_mtime, UTC))})
    return found


def main():
    ap = argparse.ArgumentParser(description=__doc__.split('\n')[0])
    ap.add_argument('--state', default=str(STATE))
    ap.add_argument('--force', action='store_true', help='mark every project changed')
    ap.add_argument('--only', nargs='*', help='mark only these project slugs changed')
    a = ap.parse_args()
    state = Path(a.state)
    (state / 'facts').mkdir(parents=True, exist_ok=True)

    cfg = json.loads((CONFIG / 'pulse.json').read_text())
    ignore = cfg.get('ignore', [])
    entries = {m['slug']: m for m in cfg['manuscripts']}
    disc = state / 'discovered.json'
    if disc.exists():
        try:
            for m in json.loads(disc.read_text()).get('manuscripts', []):
                if {'slug', 'project', 'root'} <= m.keys():
                    entries.setdefault(m['slug'], dict(m, proposed=True))
        except ValueError:
            print('discovered.json unreadable; ignored', file=sys.stderr)
    registry = sp.read_registry()
    projects = json.loads((CONFIG / 'projects.json').read_text())['projects']
    units = project_units(projects, registry)
    known = {u['slug'] for u in units}
    for m in entries.values():
        if m.get('project') not in known:
            units.append({'slug': m['project'], 'title': m['project'].replace('-', ' ').capitalize(), 'handoffs': [],
                          'jobs': [], 'transcripts': [], 'configured': False, 'status': None})
            known.add(m['project'])

    mss = [manuscript_facts(m, ignore, state) for m in entries.values()]
    old = {}
    if (state / 'fingerprints.json').exists():
        old = json.loads((state / 'fingerprints.json').read_text())
    fps, changed, rows = {}, [], []
    for u in units:
        mine = [m for m in mss if m['project'] == u['slug']]
        facts, fp = project_facts(u, registry, mine)
        (state / 'facts' / f"{u['slug']}.json").write_text(json.dumps(facts, indent=1, default=str))
        fps[u['slug']] = fp
        is_changed = a.force or (u['slug'] in (a.only or [])) or (a.only is None and old.get(u['slug']) != fp)
        if is_changed:
            changed.append(u['slug'])
        rows.append({'slug': u['slug'], 'changed': is_changed, 'manuscripts': [m['slug'] for m in mine],
                     'facts': str(state / 'facts' / f"{u['slug']}.json"),
                     'summary': str(state / 'projects' / f"{u['slug']}.json")})
    roots = [str(x(m['root'])) for m in entries.values()]
    manifest = {'generated': sp.iso(NOW), 'projects': rows, 'changed': changed,
                'unregistered': unregistered(cfg, roots, ignore)}
    (state / 'manifest.json').write_text(json.dumps(manifest, indent=1))
    (state / 'pending_fingerprints.json').write_text(json.dumps(fps, indent=1))
    print(' '.join(changed) if changed else 'unchanged')


if __name__ == '__main__':
    main()
