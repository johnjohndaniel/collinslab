"""Index every Claude Code chat (session transcript) and sort it into a category.

Sources: live transcripts in ~/.claude/projects/<folder>/<session>.jsonl (subagent
side-chats excluded) plus sessions from other hosts in the nightly archive
(~/handoff/_sessions/<host>--<id>.tar.zst). Parsed results are cached in
~/.cache/collinslab/chats.json keyed by file size + mtime, because some
transcripts are hundreds of MB.

Categories come from ordered keyword rules over the chat's title, first prompt,
working folder and linked project, with per-chat overrides from the private
file ~/.config/collinslab/chats.json ({"overrides": {"<session id>": "<category>"}}).
"""
import json
import re
import subprocess
from pathlib import Path

HOME = Path.home()
TRANSCRIPTS = HOME / '.claude' / 'projects'
ARCHIVE = HOME / 'handoff' / '_sessions'
JOBS = HOME / '.claude' / 'jobs'
CACHE = HOME / '.cache' / 'collinslab' / 'chats.json'
PRIVATE = HOME / '.config' / 'collinslab' / 'chats.json'

# Ordered: the first matching rule wins. Patterns are matched case-insensitively
# against "title | first prompt | folder | project".
CATEGORIES = [
    ('website', 'This website', r'collinslab|three\.?js|threejs'),
    ('protein', 'Proteins, enzymes & design', r'protein (design|engineering)|metalloprotein|ligandmpnn|enzyme|variants?\b|carbonic anhydrase|formate dehydrogenase|cog3383'),
    ('copper', 'Copper biology', r'copper|\bcu\b|cupredoxin|azurin|tailings|kennecott|csor|\bcop[abcdz]\b|cusa|mctb|karst|metal.binding'),
    ('treesapp', 'TreeSAPP & phylogenetics', r'treesapp|placement|phylogen|egg?nog|novelty|clade|depthfit|embedding|refpkg|gtdb|lolalign|foldseek|\bitol\b|tree of life'),
    ('microbial', 'Microbial ecology & ocean science', r'crispr|spacer|oden|amplicon|chl ?a|cruise|mcra|methanogen|census|nioz|biodeg|logan|metagenom|16s|ocean|sediment'),
    ('infrastructure', 'Agents, tools & setup', r'handoff|pickup skill|dashboard|discord|slack|hallam.?hive|kept seat|awm|agentic workspace|personal.?(brain|data)|data management|tmux|iterm|alias|mcp|plugin|claude code|federation|deploy'),
    ('ideas', 'Ideas & opportunities', r'business|startup|commercial|grant|budget|supplier|home.?lab|biolab|career|proposal'),
]
OTHER = ('other', 'Everything else')
# Display order (research first); CATEGORIES above is in matching order.
CATEGORY_ORDER = ['copper', 'treesapp', 'protein', 'microbial', 'infrastructure', 'ideas', 'website', 'other']
CATEGORY_LABELS = dict([(k, label) for k, label, _ in CATEGORIES] + [OTHER])

SECRET = re.compile(r'(cfat_|cfut_|ghp_|gho_|sk-[a-z0-9]|xox[bp]-|AKIA)[A-Za-z0-9_\-]{8,}|(?i:(password|token|secret)\s*[=:]\s*\S{6,})')


def _clean_prompt(text):
    if not isinstance(text, str):
        return None
    m = re.search(r'<command-name>(.*?)</command-name>.*?<command-args>(.*?)</command-args>', text, re.S)
    if m:
        text = f'{m.group(1).strip()} {m.group(2).strip()}'.strip()
    elif text.lstrip().startswith(('<', '[Request interrupted')):
        return None  # system reminders, local-command output, task notifications, interrupt markers
    text = SECRET.sub('[redacted]', re.sub(r'\s+', ' ', text)).strip()
    return text or None


def _prompt_of(entry):
    if entry.get('type') != 'user' or entry.get('isMeta') or entry.get('isSidechain'):
        return None
    content = (entry.get('message') or {}).get('content')
    if isinstance(content, list):
        texts = [c.get('text') for c in content if isinstance(c, dict) and c.get('type') == 'text']
        if not texts or any(isinstance(c, dict) and c.get('type') == 'tool_result' for c in content):
            return None
        content = ' '.join(t for t in texts if t)
    return _clean_prompt(content)


def parse_lines(lines):
    out = {'title': None, 'agent_name': None, 'first_prompt': None, 'prompts': 0, 'start': None, 'end': None, 'cwd': None, 'branch': None}
    for line in lines:
        try:
            e = json.loads(line)
        except ValueError:
            continue
        t = e.get('timestamp')
        if t:
            out['start'] = out['start'] or t
            out['end'] = t
        if not out['cwd'] and e.get('cwd'):
            out['cwd'], out['branch'] = e['cwd'], e.get('gitBranch')
        typ = e.get('type')
        if typ == 'ai-title' and e.get('aiTitle'):
            out['title'] = e['aiTitle']
        elif typ == 'agent-name' and e.get('agentName'):
            out['agent_name'] = e['agentName']
        elif typ == 'user':
            p = _prompt_of(e)
            if p:
                out['prompts'] += 1
                out['first_prompt'] = out['first_prompt'] or p[:400]
    return out


def _sources():
    """Yield (session_id, host, folder, path or archive, size, mtime)."""
    seen = set()
    for f in TRANSCRIPTS.glob('*/*.jsonl'):
        st = f.stat()
        seen.add(f.stem)
        yield f.stem, 'shaula', f.parent.name, str(f), st.st_size, st.st_mtime
    idx = ARCHIVE / '_index.json'
    if idx.exists():
        sessions = json.loads(idx.read_text()).get('sessions', [])
        for s in (sessions.values() if isinstance(sessions, dict) else sessions):
            if s['id'] in seen or not (ARCHIVE / s['archive']).exists():
                continue
            host = 'shaula' if s.get('host') == 'local' else s.get('host', '?')
            yield s['id'], host, s.get('cwd_dir', ''), str(ARCHIVE / s['archive']), s.get('size', 0), s.get('mtime', 0)


def _read(path, sid):
    if path.endswith('.tar.zst'):
        p = subprocess.run(['tar', '--zstd', '-xOf', path, f'{sid}.jsonl'], capture_output=True, check=False)
        return p.stdout.decode('utf-8', 'replace').splitlines()
    with open(path, encoding='utf-8', errors='replace') as fh:
        return list(fh)


def _job_names():
    names = {}
    for f in JOBS.glob('*/state.json'):
        try:
            d = json.loads(f.read_text())
        except ValueError:
            continue
        if d.get('sessionId'):
            names[d['sessionId']] = d.get('name')
    return names


def categorize(chat, project_category, overrides):
    if chat['id'] in overrides:
        return overrides[chat['id']]
    if project_category:
        return project_category
    hay = ' | '.join(filter(None, [chat.get('title'), chat.get('job_name'), chat.get('first_prompt')])).lower()
    for key, _, pattern in CATEGORIES:
        if re.search(pattern, hay, re.I):
            return key
    return OTHER[0]


def collect(project_for_session):
    """project_for_session(session_id, folder) -> (slug, title, category) or (None, None, None)."""
    cache = json.loads(CACHE.read_text()) if CACHE.exists() else {}
    private = json.loads(PRIVATE.read_text()) if PRIVATE.exists() else {}
    overrides, hidden = private.get('overrides', {}), set(private.get('hidden', []))
    jobs = _job_names()
    chats, fresh = [], {}
    for sid, host, folder, path, size, mtime in _sources():
        key = f'{sid}:{size}:{int(mtime)}'
        meta = cache.get(key) or parse_lines(_read(path, sid))
        fresh[key] = meta
        if sid in hidden or not meta['start'] or meta['prompts'] == 0:
            continue
        slug, ptitle, pcat = project_for_session(sid, folder)
        chat = {'id': sid, 'host': host, 'folder': folder, **meta, 'job_name': jobs.get(sid), 'project': slug, 'project_title': ptitle}
        chat['title'] = chat['title'] or chat['job_name'] or (chat['first_prompt'] or '')[:80]
        chat['category'] = categorize(chat, pcat, overrides)
        chats.append(chat)
    CACHE.parent.mkdir(parents=True, exist_ok=True)
    CACHE.write_text(json.dumps(fresh))
    chats.sort(key=lambda c: c['start'], reverse=True)
    return chats
