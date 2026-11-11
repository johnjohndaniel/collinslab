// One project's page: a big interactive model plus the live overview.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { buildScene } from './scenes.js';
import { el, ago, pill, getJSON } from './common.js';

const slug = location.pathname.split('/').filter(Boolean)[1];
const info = document.getElementById('info');
const canvas = document.getElementById('stage');
let started = false;

function startScene(p) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const env = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
  const { scene, camera, tick } = buildScene(p, env);
  scene.background = new THREE.Color('#10171a');
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.minDistance = 2.5;
  controls.maxDistance = 14;
  const resize = () => { renderer.setSize(canvas.clientWidth, canvas.clientHeight, false); camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix(); };
  new ResizeObserver(resize).observe(canvas);
  resize();
  const timer = new THREE.Timer();
  let t = 0;
  renderer.setAnimationLoop((now) => { timer.update(now); t += Math.min(timer.getDelta(), 0.05); tick(t); controls.update(); renderer.render(scene, camera); });
}

const fmt = (iso) => (iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');

// The hourly pulse: Claude's judgement of stage, blockers and next milestone, plus scan momentum.
function pulseBlock(p) {
  const q = p.pulse;
  if (!q && !p.momentum) return [];
  const m = p.momentum || {};
  const out = [el('h3', { textContent: `Pulse${q?.pulse_at ? ` · judged ${ago(q.pulse_at)}` : ''}` })];
  if (q) {
    out.push(el('div', { className: 'pulse-box' },
      el('div', { className: 'meta' }, el('span', { className: `pill stage-pill`, textContent: q.stage }),
        q.rank ? el('span', { className: 'small muted', textContent: `value ${q.rank.value} · effort ${q.rank.effort}` }) : null),
      el('p', { className: 'headline', textContent: q.headline }),
      q.current_work ? el('p', { className: 'small', textContent: q.current_work }) : null,
      q.next_milestone ? el('p', { className: 'small' }, el('b', { textContent: 'Next milestone: ' }), q.next_milestone.name,
        el('span', { className: 'muted', textContent: q.next_milestone.hours_estimate != null ? ` · ~${q.next_milestone.hours_estimate} h of your time (est., ${q.next_milestone.confidence} confidence)` : '' })) : null,
      q.unattended ? el('p', { className: 'small' }, el('b', { textContent: q.unattended.can_run ? 'Runs unattended: ' : 'Needs your hands: ' }), q.unattended.what) : null));
    if ((q.blocked_on_me || []).length) {
      out.push(el('h3', { textContent: `Waiting on you · ${q.blocked_on_me.length}` }),
        el('ul', { className: 'blocked' }, ...q.blocked_on_me.map((b) => el('li', { textContent: b.item + (b.since ? ` (since ${b.since})` : '') }))));
    }
    if ((q.open_problems || []).length) {
      out.push(el('h3', { textContent: 'Open problems' }),
        el('ul', { className: 'problems' }, ...q.open_problems.map((o) => el('li', {},
          el('span', { className: `size size-${o.size}`, textContent: o.size }), el('span', { className: 'small muted', textContent: ` ${o.kind} · ` }), o.problem))));
    }
    if ((q.manuscripts || []).length) {
      out.push(el('h3', { textContent: 'Manuscripts' }), el('ul', { className: 'where' }, ...q.manuscripts.map((ms) => el('li', {},
        el('a', { href: `/manuscripts/${ms.slug}/`, textContent: ms.title || ms.slug }),
        el('span', { className: 'small muted', textContent: ` · ${ms.stage || ''}${ms.hours_to_submission != null ? ` · ~${ms.hours_to_submission} h to submission (est.)` : ''}` })))));
    }
    if (q.value_note) out.push(el('p', { className: 'small muted', textContent: `Why it matters: ${q.value_note}` }));
  }
  if (p.momentum) {
    out.push(el('p', { className: 'small muted', textContent: `Momentum: active ${m.active_days_7 ?? 0} of the last 7 days and ${m.active_days_30 ?? 0} of the last 30${m.days_since_active != null ? ` · last progress ${m.days_since_active === 0 ? 'today' : `${m.days_since_active} days ago`}` : ''}` }));
  }
  return out;
}

function render(p) {
  document.title = `${p.title} · Collins Lab`;
  document.getElementById('synced').textContent = p.synced_at ? `synced ${ago(p.synced_at)}` : '';
  const max = Math.max(1, ...p.daily);
  const days = p.daily.map((n, i) => {
    const d = new Date(); d.setDate(d.getDate() - (p.daily.length - 1 - i));
    return el('div', { className: 'day', title: `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}: ${n} update${n === 1 ? '' : 's'}` },
      el('span', { style: `height:${Math.max(n ? 8 : 2, (n / max) * 100)}%` }));
  });
  info.replaceChildren(...[
    el('div', { className: 'meta' }, pill(p.status), el('span', { className: 'muted small', textContent: `last active ${ago(p.last_active)}` })),
    el('h1', { textContent: p.title }),
    el('p', { className: 'tagline', textContent: p.tagline }),
    p.link ? el('a', { className: 'btn open-link', href: p.link, textContent: p.link_label || 'Open it ↗' }) : null,
    p.now ? el('div', { className: 'now-box' }, el('div', { className: 'label', textContent: `Latest · ${p.now.job} · ${fmt(p.now.at)}` }), el('p', { textContent: p.now.text })) : null,
    ...pulseBlock(p),
    el('p', { className: 'about', textContent: p.about }),
    p.facts.length ? el('dl', { className: 'facts' }, ...p.facts.flatMap(([k, v]) => [el('dt', { textContent: k }), el('dd', { textContent: v })])) : null,
    el('h3', { textContent: 'Activity, last 14 days' }),
    el('div', { className: 'days' }, ...days),
    p.activity.length ? el('h3', { textContent: 'Recent updates' }) : null,
    p.activity.length ? el('ol', { className: 'timeline' }, ...p.activity.map((a) =>
      el('li', { className: `ev ev-${a.kind}` }, el('div', { className: 'when small muted', textContent: `${fmt(a.at)} · ${a.job}` }), el('div', { textContent: a.text })))) : null,
    p.handoffs.length ? el('h3', { textContent: 'Handoffs' }) : null,
    ...p.handoffs.map((h) => el('div', { className: 'handoff' }, el('div', { className: 'small muted', textContent: `${h.slug} · ${fmt(h.at)}${h.status ? ' · ' + h.status : ''}` }), el('p', { textContent: h.goal }))),
    p.jobs.length ? el('h3', { textContent: 'Claude sessions' }) : null,
    p.jobs.length ? el('ul', { className: 'jobs' }, ...p.jobs.map((j) => el('li', {}, el('code', { textContent: j.name }), el('span', { className: `small muted`, textContent: ` ${j.state} · ${ago(j.at)}` })))) : null,
    p.where.length ? el('h3', { textContent: 'Where it lives' }) : null,
    p.where.length ? el('ul', { className: 'where' }, ...p.where.map((w) => el('li', {}, el('code', { textContent: w })))) : null,
  ].filter(Boolean));
  if (!started) { started = true; startScene(p); }
}

async function load() {
  try { render(await getJSON(`/api/projects/${encodeURIComponent(slug)}`)); }
  catch (e) { if (!started) info.replaceChildren(el('p', { className: 'error', textContent: e.message }), el('a', { href: '/projects/', textContent: 'All projects' })); }
}
load();
setInterval(load, 60_000);
