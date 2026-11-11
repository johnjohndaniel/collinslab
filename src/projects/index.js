// All-projects page: cards for every project, each with its own live 3D model.
// One WebGL renderer draws every model into its card's rectangle (scissor test),
// so the page stays well under the browser's limit on WebGL contexts.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildScene } from './scenes.js';
import { el, ago, pill, getJSON, syncedLabel, STATUS } from './common.js';

const canvas = document.getElementById('stage');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const BG = new THREE.Color('#10171a');

let views = []; // { el, scene, camera, tick, hover, t }

function card(p) {
  const view = el('div', { className: 'view' });
  const a = el('a', { className: `project-card status-${p.status}`, href: `/projects/${p.slug}/` },
    view,
    el('div', { className: 'body' },
      el('div', { className: 'meta' }, pill(p.status), el('span', { className: 'muted small', textContent: ago(p.last_active) })),
      el('h3', { textContent: p.title }),
      el('p', { className: 'tagline', textContent: p.tagline }),
      p.now ? el('p', { className: 'now small', textContent: p.now.text }) : null,
      badges(p)));
  const built = buildScene(p, env);
  const v = { el: view, ...built, hover: false, t: Math.random() * 20 };
  a.addEventListener('pointerenter', () => { v.hover = true; });
  a.addEventListener('pointerleave', () => { v.hover = false; });
  views.push(v);
  return a;
}

// Pulse KPIs (judged hourly by Claude; momentum counted by the scan).
const waiting = (p) => (p.pulse?.blocked_on_me || []).length;
const unattended = (p) => !!p.pulse?.unattended?.can_run;
const active7 = (p) => p.momentum?.active_days_7 ?? 0;
const active30 = (p) => p.momentum?.active_days_30 ?? 0;
const milestoneH = (p) => p.pulse?.next_milestone?.hours_estimate ?? null;
const live = (p) => !['dormant', 'paused'].includes(p.status) && !['dormant', 'paused', 'done'].includes(p.pulse?.stage);

function badges(p) {
  if (!p.pulse && !p.momentum) return null;
  const b = [];
  if (waiting(p)) b.push(el('span', { className: 'badge warn', title: 'Decisions or actions only you can take', textContent: `${waiting(p)} waiting on you` }));
  if (unattended(p)) b.push(el('span', { className: 'badge go', title: p.pulse.unattended.what, textContent: 'runs unattended' }));
  if (p.momentum) b.push(el('span', { className: 'badge', title: 'Active days in the last 7 and 30 days', textContent: `${active7(p)}/7 · ${active30(p)}/30 days` }));
  if (milestoneH(p) != null) b.push(el('span', { className: 'badge', title: p.pulse.next_milestone.name, textContent: `milestone ~${milestoneH(p)} h` }));
  return el('div', { className: 'badges' }, ...b);
}

function kpi(value, label, detail) {
  return el('div', { className: 'kpi' }, el('div', { className: 'v', textContent: value }), el('div', { className: 'k', textContent: label }),
    detail ? el('div', { className: 'd small muted', textContent: detail }) : null);
}

function renderKpis(projects) {
  const lv = projects.filter(live);
  const blockedItems = lv.reduce((a, p) => a + waiting(p), 0);
  const blockedProjects = lv.filter(waiting).length;
  const near = lv.filter((p) => milestoneH(p) != null).sort((a, b) => milestoneH(a) - milestoneH(b)).slice(0, 3);
  document.getElementById('kpis').replaceChildren(
    kpi(String(blockedItems), 'waiting on you', `across ${blockedProjects} project${blockedProjects === 1 ? '' : 's'}`),
    kpi(String(lv.filter(unattended).length), 'can run unattended', 'next step needs no hands-on time'),
    kpi(`${projects.filter((p) => active7(p) > 0).length} / ${projects.filter((p) => active30(p) > 0).length}`, 'active this week / month', 'projects with any progress'),
    el('div', { className: 'kpi wide' }, el('div', { className: 'k', textContent: 'nearest milestones (est. hands-on hours)' }),
      ...near.map((p) => el('a', { className: 'mile small', href: `/projects/${p.slug}/` },
        el('b', { textContent: `~${milestoneH(p)} h ` }), `${p.title}: ${p.pulse.next_milestone.name}`))));
}

function renderToday(portfolio, projects) {
  const box = document.getElementById('today');
  if (!portfolio) { box.replaceChildren(); return; }
  const title = (slug) => projects.find((p) => p.slug === slug)?.title || slug;
  box.replaceChildren(
    el('div', { className: 'today-head' }, el('h2', { textContent: 'Today' }), el('span', { className: 'small muted', textContent: portfolio.generated ? `pulse ${ago(portfolio.generated)}` : '' })),
    portfolio.headline ? el('p', { className: 'today-headline', textContent: portfolio.headline }) : null,
    el('ol', { className: 'focus' }, ...(portfolio.today || []).map((t) => el('li', {},
      el('div', {}, el('a', { href: `/projects/${t.project}/`, textContent: title(t.project) }), el('span', { className: `size size-${t.size}`, textContent: t.hours_estimate != null ? `~${t.hours_estimate} h` : t.size })),
      el('div', { className: 'problem', textContent: t.problem }),
      el('div', { className: 'why small muted', textContent: t.why })))),
    (portfolio.concurrent || []).length ? el('details', { className: 'concurrent' },
      el('summary', { className: 'small', textContent: `Can run alongside · ${portfolio.concurrent.length}` }),
      el('ul', {}, ...portfolio.concurrent.map((c) => el('li', { className: 'small' }, el('b', { textContent: `${title(c.project)}: ` }), c.what)))) : null,
    (portfolio.attention || []).length ? el('details', { className: 'concurrent' },
      el('summary', { className: 'small', textContent: `Needs attention · ${portfolio.attention.length}` }),
      el('ul', {}, ...portfolio.attention.map((c) => el('li', { className: 'small' }, el('b', { textContent: `${title(c.project)}: ` }), c.note)))) : null);
}

const SORTS = {
  status: { label: 'By status' },
  waiting: { label: 'Waiting on me', pick: (ps) => ps.filter(waiting).sort((a, b) => waiting(b) - waiting(a)) },
  unattended: { label: 'Runs unattended', pick: (ps) => ps.filter(unattended) },
  momentum: { label: 'Momentum', pick: (ps) => [...ps].sort((a, b) => active7(b) - active7(a) || active30(b) - active30(a)) },
  milestone: { label: 'Nearest milestone', pick: (ps) => ps.filter((p) => live(p) && milestoneH(p) != null).sort((a, b) => milestoneH(a) - milestoneH(b)) },
};
let sortBy = new URLSearchParams(location.search).get('sort') || 'status';
let cache = [];

function renderSorter() {
  document.getElementById('sorter').replaceChildren(...Object.entries(SORTS).map(([k, v]) => {
    const b = el('button', { className: `chip-btn${k === sortBy ? ' on' : ''}`, type: 'button', textContent: v.label, role: 'tab' });
    b.setAttribute('aria-selected', String(k === sortBy));
    b.addEventListener('click', () => { sortBy = k; history.replaceState(null, '', k === 'status' ? location.pathname : `?sort=${k}`); renderSorter(); renderCards(cache); });
    return b;
  }));
}

function renderCards(projects) {
  views = [];
  const sections = document.getElementById('sections');
  if (sortBy !== 'status' && SORTS[sortBy]) {
    const ps = SORTS[sortBy].pick(projects);
    sections.replaceChildren(el('section', { className: 'group' }, el('h2', { textContent: `${SORTS[sortBy].label} · ${ps.length}` }), el('div', { className: 'grid' }, ...ps.map(card))));
    return;
  }
  const groups = ['running', 'recent', 'idle', 'paused', 'dormant'].map((s) => [s, projects.filter((p) => p.status === s)]).filter(([, ps]) => ps.length);
  sections.replaceChildren(...groups.map(([s, ps]) =>
    el('section', { className: 'group' }, el('h2', { textContent: `${STATUS[s].label} · ${ps.length}` }), el('div', { className: 'grid' }, ...ps.map(card)))));
}

async function load() {
  const [projects, pulse] = await Promise.all([getJSON('/api/projects'), getJSON('/api/pulse').catch(() => null)]);
  cache = projects;
  renderKpis(projects);
  renderToday(pulse?.portfolio, projects);
  renderSorter();
  renderCards(projects);
  const n = (s) => projects.filter((p) => p.status === s).length;
  document.getElementById('summary').textContent = `${projects.length} projects · ${n('running')} running now · ${n('recent')} active this week`;
  document.getElementById('synced').textContent = syncedLabel(projects);
}

const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const dt = Math.min(timer.getDelta(), 0.05);
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) renderer.setSize(w, h, false);
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.setScissorTest(true);
  for (const v of views) {
    const r = v.el.getBoundingClientRect();
    if (r.bottom < 0 || r.top > h || r.right < 0 || r.left > w || r.width < 2) continue;
    v.t += dt * (v.hover ? 2.5 : 1);
    v.tick(v.t);
    v.camera.aspect = r.width / r.height;
    v.camera.updateProjectionMatrix();
    const y = h - r.bottom;
    renderer.setViewport(r.left, y, r.width, r.height);
    renderer.setScissor(r.left, y, r.width, r.height);
    renderer.setClearColor(BG, 1);
    renderer.clear();
    renderer.render(v.scene, v.camera);
  }
});

load().catch((e) => { document.getElementById('summary').textContent = e.message; });
setInterval(() => load().catch(() => {}), 60_000);
