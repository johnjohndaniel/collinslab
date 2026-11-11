// All manuscripts: one card per draft with stage, readiness and a section status bar,
// sorted by stage (closest to submission first) then by most recent change.
import { el, ago, getJSON } from '../projects/common.js';
import { readiness, sectionBar, stagePill, legend, hours, citationCount, STAGES } from './common.js';

function stat(label, value) {
  return el('div', { className: 'stat' }, el('div', { className: 'v', textContent: value }), el('div', { className: 'k small muted', textContent: label }));
}

function card(m) {
  const r = readiness(m);
  const blocked = (m.blocked_on_me || []).length;
  return el('a', { className: 'ms-card', href: `/manuscripts/${m.slug}/` },
    el('div', { className: 'meta' }, stagePill(m.stage), el('span', { className: 'muted small', textContent: `changed ${ago(m.modified)}` }),
      blocked ? el('span', { className: 'flag small', textContent: `${blocked} waiting on you` }) : null),
    el('h3', { textContent: m.title }),
    el('div', { className: 'small muted', textContent: m.project_title || m.project }),
    el('div', { className: 'ready-row' }, el('span', { className: 'ready', textContent: r == null ? '—' : `${r}%` }), sectionBar(m)),
    el('div', { className: 'stats' },
      stat('words', (m.words || 0).toLocaleString()),
      stat('figures', String(m.figures?.distinct ?? 0)),
      stat('citations', citationCount(m) == null ? '—' : String(citationCount(m))),
      stat('to submit (est.)', hours(m.hours_to_submission))),
    m.next_action ? el('p', { className: 'next small', textContent: `Next: ${m.next_action}` }) : null);
}

async function load() {
  const { manuscripts, updated_at } = await getJSON('/api/pulse');
  const rank = (m) => { const i = STAGES.indexOf(m.stage); return i < 0 ? STAGES.length : i; };
  manuscripts.sort((a, b) => rank(a) - rank(b) || (b.modified || '').localeCompare(a.modified || ''));
  document.getElementById('list').replaceChildren(...(manuscripts.length ? manuscripts.map(card)
    : [el('p', { className: 'muted', textContent: 'No manuscripts yet. The hourly pulse fills this page.' })]));
  const words = manuscripts.reduce((a, m) => a + (m.words || 0), 0);
  const n = (s) => manuscripts.filter((m) => m.stage === s).length;
  document.getElementById('summary').textContent =
    `${manuscripts.length} manuscripts · ${n('full draft')} full drafts · ${n('submission-ready')} submission-ready · ${words.toLocaleString()} words in total`;
  document.getElementById('synced').textContent = updated_at ? `pulse ${ago(updated_at)}` : '';
}

document.getElementById('legend').replaceChildren(...legend());
load().catch((e) => { document.getElementById('summary').textContent = e.message; });
setInterval(() => load().catch(() => {}), 120_000);
