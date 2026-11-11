// One manuscript: stage, readiness, the section table with what each section still needs,
// figure and citation readiness, decisions waiting on John, and where the files live.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildScene } from '../projects/scenes.js';
import { el, ago, getJSON } from '../projects/common.js';
import { readiness, sectionBar, stagePill, legend, hours, citationCount, SECTION } from './common.js';

const slug = location.pathname.split('/').filter(Boolean)[1];
const info = document.getElementById('info');
const canvas = document.getElementById('stage');
let started = false;

function startScene(m) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const { scene, camera, tick } = buildScene({ slug: m.slug, kind: 'manuscript', hue: 0.07, facts: [] }, env);
  const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(canvas);
  resize();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const timer = new THREE.Timer();
  let t = 0;
  renderer.setAnimationLoop((now) => { timer.update(now); if (!reduce) t += Math.min(timer.getDelta(), 0.05); tick(t); renderer.render(scene, camera); });
}

const stat = (label, value) => el('div', { className: 'stat' }, el('div', { className: 'v', textContent: value }), el('div', { className: 'k small muted', textContent: label }));

function render(m) {
  document.title = `${m.title} · Collins Lab`;
  document.getElementById('synced').textContent = m.pulse_at ? `judged ${ago(m.pulse_at)}` : '';
  const r = readiness(m);
  const ds = m.doc_stats || {};
  const cites = Object.entries(m.citations || {});
  info.replaceChildren(...[
    el('div', { className: 'meta' }, stagePill(m.stage), m.target ? el('span', { className: 'small muted', textContent: `target: ${m.target}` }) : null,
      el('span', { className: 'small muted', textContent: `files changed ${ago(m.modified)}` })),
    el('h1', { textContent: m.title }),
    el('a', { className: 'crumb', href: `/projects/${m.project}/`, textContent: `Project: ${m.project_title || m.project} →` }),
    m.summary ? el('p', { className: 'about', textContent: m.summary }) : null,
    el('div', { className: 'ready-row big' }, el('span', { className: 'ready', textContent: r == null ? '—' : `${r}%` }), sectionBar(m, { big: true })),
    el('div', { className: 'legend small' }, ...legend()),
    el('div', { className: 'stats' },
      stat('words', (m.words || 0).toLocaleString()),
      stat('figures', `${m.figures?.distinct ?? 0}`),
      stat('svg / png', `${m.figures?.svg ?? 0} / ${m.figures?.png ?? 0}`),
      stat('tables', `${m.tables?.files ?? 0}`),
      stat('citations', citationCount(m) == null ? '—' : String(citationCount(m))),
      stat('to submit (est.)', hours(m.hours_to_submission))),
    m.next_action ? el('div', { className: 'now-box' }, el('div', { className: 'label', textContent: 'Next writing action' }), el('p', { textContent: m.next_action })) : null,
    (m.blocked_on_me || []).length ? el('h3', { textContent: 'Waiting on you (whole project)' }) : null,
    (m.blocked_on_me || []).length ? el('ul', { className: 'blocked' }, ...m.blocked_on_me.map((b) => el('li', { textContent: b.item + (b.since ? ` (since ${b.since})` : '') }))) : null,
    el('h3', { textContent: 'Sections' }),
    el('table', { className: 'sections' },
      el('thead', {}, el('tr', {}, ...['Section', 'Status', 'Words', 'What it needs'].map((h) => el('th', { textContent: h })))),
      el('tbody', {}, ...(m.sections || []).map((s) => el('tr', {},
        el('td', { textContent: s.heading }),
        el('td', {}, el('span', { className: `chip st-${s.status}`, textContent: SECTION[s.status]?.label || s.status })),
        el('td', { className: 'num', textContent: s.words ? s.words.toLocaleString() : '—' }),
        el('td', { className: 'small', textContent: s.note || '' }))))),
    el('h3', { textContent: 'Figures and citations' }),
    m.figures_note ? el('p', { textContent: `Figures: ${m.figures_note}` }) : null,
    m.citations_note ? el('p', { textContent: `Citations: ${m.citations_note}` }) : null,
    cites.length ? el('dl', { className: 'facts' }, ...cites.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v == null ? 'present' : `${v} rows` })])) : null,
    (ds.comments || ds.tracked_insertions || ds.tracked_deletions || m.markers)
      ? el('p', { className: 'small muted', textContent: `Open in the file: ${ds.comments || 0} Word comments · ${(ds.tracked_insertions || 0) + (ds.tracked_deletions || 0)} tracked changes · ${m.markers || 0} TODO or placeholder markers` }) : null,
    el('h3', { textContent: 'Where it lives' }),
    el('ul', { className: 'where' },
      m.main ? el('li', {}, el('code', { textContent: m.main.path }), el('span', { className: 'small muted', textContent: ` · ${m.main.format} · saved ${ago(m.main.modified)}` })) : null,
      el('li', {}, el('code', { textContent: m.root })),
      ...(m.artifacts || []).map((u) => el('li', {}, el('a', { href: u, target: '_blank', rel: 'noopener', textContent: 'Published draft (claude.ai, private) ↗' })))),
    m.note ? el('p', { className: 'small muted', textContent: m.note }) : null,
    el('p', { className: 'small muted disclaimer', textContent: 'Statuses, notes and hour figures are estimates by the hourly Claude pulse from the files and handoffs. Counts come straight from the files.' }),
  ].filter(Boolean));
  if (!started) { started = true; startScene(m); }
}

async function load() {
  try { render(await getJSON(`/api/pulse/${encodeURIComponent(slug)}`)); }
  catch (e) { if (!started) info.replaceChildren(el('p', { className: 'error', textContent: e.message }), el('a', { href: '/manuscripts/', textContent: 'All manuscripts' })); }
}
load();
setInterval(load, 120_000);
