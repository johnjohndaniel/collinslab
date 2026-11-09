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
      p.now ? el('p', { className: 'now small', textContent: p.now.text }) : null));
  const built = buildScene(p, env);
  const v = { el: view, ...built, hover: false, t: Math.random() * 20 };
  a.addEventListener('pointerenter', () => { v.hover = true; });
  a.addEventListener('pointerleave', () => { v.hover = false; });
  views.push(v);
  return a;
}

async function load() {
  const projects = await getJSON('/api/projects');
  views = [];
  const groups = ['running', 'recent', 'idle', 'paused', 'dormant'].map((s) => [s, projects.filter((p) => p.status === s)]).filter(([, ps]) => ps.length);
  document.getElementById('sections').replaceChildren(...groups.map(([s, ps]) =>
    el('section', { className: 'group' }, el('h2', { textContent: `${STATUS[s].label} · ${ps.length}` }), el('div', { className: 'grid' }, ...ps.map(card)))));
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
