// Every Claude chat, grouped by category, with a 3D "constellation" overview.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { el, ago, getJSON } from './projects/common.js';

const COLORS = {
  copper: '#d0814e', treesapp: '#72c27a', protein: '#b585e0', microbial: '#4fb6d6',
  infrastructure: '#93a4b3', ideas: '#e3bd52', website: '#e5728f', other: '#7c8486',
};
const colorOf = (k) => COLORS[k] || COLORS.other;

const state = { chats: [], filter: 'all', q: '' };
const fmtDay = (iso) => new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });
const durationLabel = (a, b) => {
  const h = (new Date(b) - new Date(a)) / 3.6e6;
  return h < 1 ? `${Math.max(1, Math.round(h * 60))} min` : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`;
};

// ---- 3D constellation -------------------------------------------------------
const canvas = document.getElementById('sky');
const tip = document.getElementById('tip');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
const scene = new THREE.Scene();
scene.background = new THREE.Color('#0d1315');
scene.fog = new THREE.FogExp2('#0d1315', 0.035);
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
camera.position.set(0, 9.5, 19);
const controls = new OrbitControls(camera, canvas);
controls.enableDamping = true; controls.enablePan = false; controls.enableZoom = false;
controls.autoRotate = !matchMedia('(prefers-reduced-motion: reduce)').matches; controls.autoRotateSpeed = 0.5;
scene.add(new THREE.HemisphereLight(0xffffff, 0x223033, 1.6));
const key = new THREE.DirectionalLight(0xffffff, 1.2); key.position.set(4, 8, 6); scene.add(key);
const dust = new THREE.Points(
  new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(Array.from({ length: 1500 }, () => (Math.random() - 0.5) * 60), 3)),
  new THREE.PointsMaterial({ size: 0.05, color: 0x5d7a80, transparent: true, opacity: 0.6 }));
scene.add(dust);

let stars = null, starChats = [], labels = [];
const unit = new THREE.SphereGeometry(1, 20, 14);
const dummy = new THREE.Object3D();

// A text label that always faces the camera.
function textSprite(text, color) {
  const c = document.createElement('canvas'), g = c.getContext('2d'), font = '600 44px system-ui, sans-serif';
  g.font = font; c.width = Math.ceil(g.measureText(text).width) + 40; c.height = 64;
  g.font = font; g.fillStyle = color; g.textBaseline = 'middle'; g.fillText(text, 20, 34);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sprite.scale.set(c.width / 64 * 0.55, 0.55, 1);
  return sprite;
}

function buildSky(chats) {
  if (stars) { scene.remove(stars); stars.dispose(); }
  labels.forEach((l) => scene.remove(l)); labels = [];
  const cats = [...new Set(chats.map((c) => c.category))].sort((a, b) => rankOf(a) - rankOf(b));
  const centers = new Map(cats.map((k, i) => {
    const a = (i / cats.length) * Math.PI * 2;
    return [k, new THREE.Vector3(Math.cos(a) * 8, Math.sin(i * 1.7) * 1.0, Math.sin(a) * 8)];
  }));
  stars = new THREE.InstancedMesh(unit, new THREE.MeshLambertMaterial({ color: 0xffffff }), chats.length);
  starChats = chats;
  const seen = new Map();
  chats.forEach((c, i) => {
    const k = seen.get(c.category) || 0; seen.set(c.category, k + 1);
    const center = centers.get(c.category);
    const r = 0.6 + Math.sqrt(k) * 0.55, a = k * 2.399, h = ((k * 0.618) % 1 - 0.5) * 2.2;
    const s = 0.16 + Math.sqrt(c.prompts) * 0.075;
    dummy.position.set(center.x + Math.cos(a) * r, center.y + h, center.z + Math.sin(a) * r);
    dummy.scale.setScalar(s); dummy.updateMatrix();
    stars.setMatrixAt(i, dummy.matrix);
    stars.setColorAt(i, new THREE.Color(colorOf(c.category)));
  });
  scene.add(stars);
  for (const [k, ctr] of centers) {
    const label = textSprite(chats.find((c) => c.category === k).category_label, colorOf(k));
    label.position.copy(ctr).add(new THREE.Vector3(0, 2.0, 0)); scene.add(label); labels.push(label);
  }
  applyFilterToSky();
}

function applyFilterToSky() {
  if (!stars) return;
  const c = new THREE.Color();
  starChats.forEach((chat, i) => {
    c.set(colorOf(chat.category));
    if (!matches(chat)) c.multiplyScalar(0.12);
    stars.setColorAt(i, c);
  });
  stars.instanceColor.needsUpdate = true;
}

const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let hovered = -1;
function pick(e) {
  const r = canvas.getBoundingClientRect();
  ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
  ray.setFromCamera(ndc, camera);
  const hit = stars && ray.intersectObject(stars)[0];
  return hit ? hit.instanceId : -1;
}
canvas.addEventListener('pointermove', (e) => {
  hovered = pick(e);
  const r = canvas.getBoundingClientRect();
  if (hovered < 0) { tip.hidden = true; canvas.style.cursor = 'grab'; return; }
  const c = starChats[hovered];
  tip.replaceChildren(el('strong', { textContent: c.title }), el('span', { className: 'small muted', textContent: `${c.category_label} · ${fmtDay(c.start)} · ${c.prompts} message${c.prompts === 1 ? '' : 's'}` }));
  tip.style.left = `${e.clientX - r.left}px`; tip.style.top = `${e.clientY - r.top}px`; tip.hidden = false;
  canvas.style.cursor = 'pointer';
});
canvas.addEventListener('pointerleave', () => { tip.hidden = true; hovered = -1; });
let downAt = null;
canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
canvas.addEventListener('pointerup', (e) => {
  if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 5) return;
  const i = pick(e);
  if (i < 0) return;
  const c = starChats[i];
  if (!matches(c)) { state.filter = 'all'; state.q = ''; document.getElementById('q').value = ''; renderList(); applyFilterToSky(); }
  const row = document.getElementById(`chat-${c.id}`);
  row?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  row?.classList.add('flash'); setTimeout(() => row?.classList.remove('flash'), 1600);
});

new ResizeObserver(() => {
  renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
  camera.aspect = canvas.clientWidth / canvas.clientHeight; camera.updateProjectionMatrix();
}).observe(canvas);
const timer = new THREE.Timer();
renderer.setAnimationLoop((now) => {
  timer.update(now);
  const t = timer.getElapsed();
  if (stars) stars.rotation.y = Math.sin(t * 0.05) * 0.05;
  dust.rotation.y = t * 0.01;
  controls.update();
  renderer.render(scene, camera);
});

// ---- List ----------------------------------------------------------------------
const rankOf = (k) => state.chats.find((c) => c.category === k)?.category_rank ?? 99;
const matches = (c) => (state.filter === 'all' || c.category === state.filter)
  && (!state.q || `${c.title} ${c.first_prompt || ''} ${c.project_title || ''} ${c.job_name || ''}`.toLowerCase().includes(state.q));

function chatRow(c) {
  const prompt = el('p', { className: 'chat-prompt', textContent: c.first_prompt || '(no message text)', title: 'Click to expand' });
  prompt.addEventListener('click', () => prompt.classList.toggle('open'));
  const copy = el('button', { className: 'copy', type: 'button', textContent: 'Copy resume command', title: `claude --resume ${c.id}` });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(`claude --resume ${c.id}`); copy.textContent = 'Copied'; }
    catch { copy.textContent = c.id; }
    setTimeout(() => { copy.textContent = 'Copy resume command'; }, 1500);
  });
  return el('li', { className: 'chat', id: `chat-${c.id}`, style: `--c:${colorOf(c.category)}` },
    el('div', { className: 'chat-head' }, el('h3', { className: 'chat-title', textContent: c.title }), copy),
    el('div', { className: 'chat-meta' },
      el('span', { textContent: `${fmtDay(c.start)} · ${durationLabel(c.start, c.end)}` }),
      el('span', { textContent: `${c.prompts} message${c.prompts === 1 ? '' : 's'} from you` }),
      el('span', { textContent: c.host }),
      c.project ? el('a', { href: `/projects/${c.project}/`, textContent: `↗ ${c.project_title}` }) : null,
      c.cwd && c.cwd !== '~' ? el('code', { textContent: c.cwd }) : null),
    prompt);
}

function renderChips() {
  const counts = new Map();
  state.chats.forEach((c) => counts.set(c.category, (counts.get(c.category) || 0) + 1));
  const cats = [...counts.keys()].sort((a, b) => rankOf(a) - rankOf(b));
  const chip = (key, label, n, color) => {
    const b = el('button', { className: 'chip', type: 'button' },
      color ? el('span', { className: 'dot', style: `background:${color}` }) : null, label, el('span', { className: 'n', textContent: n }));
    b.setAttribute('aria-pressed', String(state.filter === key));
    b.addEventListener('click', () => { state.filter = key; renderChips(); renderList(); applyFilterToSky(); });
    return b;
  };
  const labelOf = (k) => state.chats.find((c) => c.category === k).category_label;
  document.getElementById('chips').replaceChildren(chip('all', 'All', state.chats.length), ...cats.map((k) => chip(k, labelOf(k), counts.get(k), colorOf(k))));
}

function renderList() {
  const shown = state.chats.filter(matches);
  const groups = new Map();
  shown.forEach((c) => { if (!groups.has(c.category)) groups.set(c.category, []); groups.get(c.category).push(c); });
  const ordered = [...groups.entries()].sort((a, b) => rankOf(a[0]) - rankOf(b[0]));
  document.getElementById('groups').replaceChildren(...(ordered.length ? ordered.map(([k, cs]) =>
    el('section', { className: 'cat-group' },
      el('h2', {}, el('span', { className: 'dot', style: `background:${colorOf(k)}` }), cs[0].category_label, el('span', { className: 'n', textContent: `· ${cs.length}` })),
      el('ol', { className: 'chat-list' }, ...cs.map(chatRow)))) : [el('p', { className: 'empty', textContent: 'No chats match.' })]));
}

let qTimer;
document.getElementById('q').addEventListener('input', (e) => {
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { state.q = e.target.value.trim().toLowerCase(); renderList(); applyFilterToSky(); }, 120);
});

async function load() {
  const data = await getJSON('/api/chats');
  state.chats = data.chats;
  document.getElementById('synced').textContent = data.synced_at ? `synced ${ago(data.synced_at)}` : '';
  const first = state.chats.at(-1)?.start;
  const msgs = state.chats.reduce((n, c) => n + c.prompts, 0);
  document.getElementById('summary').textContent =
    `${state.chats.length} chats · ${msgs} messages from you${first ? ` · since ${fmtDay(first)}` : ''} · drag to turn, click a star to jump to it`;
  renderChips(); renderList(); buildSky(state.chats);
}
load().catch((e) => { document.getElementById('summary').textContent = e.message; });
