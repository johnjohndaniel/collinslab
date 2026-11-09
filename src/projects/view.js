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
