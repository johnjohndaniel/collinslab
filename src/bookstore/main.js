// collinslab books: a small, curated bookstore you browse with a trackpad.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildRoom } from './room.js';
import { ShelfBooks, HandBook, bookDims, hash, loadCover, drawSpine } from './books.js';
import { Displays } from './displays.js';
import { Curator, MOODS } from './curation.js';
import { Navigator } from './nav.js';
import { CoffeeCup } from './player.js';
import { Sound } from './audio.js';

// Set this to your Bookshop.org affiliate ID once you have one; links then credit you.
const BOOKSHOP_AFFILIATE = '';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LITE = params.has('lite');
const DEBUG = params.has('debug');
const mark = (m) => { if (DEBUG) console.log(`[bookstore] ${m} @ ${Math.round(performance.now())} ms`); };
const ease = { inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2), out: (t) => 1 - (1 - t) ** 3, in: (t) => t * t * t };
const el = (tag, props = {}, ...kids) => { const n = Object.assign(document.createElement(tag), props); n.append(...kids.filter((k) => k != null && k !== false)); return n; };
const ORDER = ['front', 'newTable', 'bay0', 'bay1', 'bay2', 'bay3', 'till'];

// ---------------------------------------------------------------------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(LITE ? 0.5 : Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(56, 1, 0.02, 60);
camera.rotation.order = 'YXZ';

const manager = new THREE.LoadingManager();
manager.onProgress = (_, done, total) => { $('bar').style.width = `${Math.round((done / total) * 100)}%`; };

const sound = new Sound();
let room, displays, curator, nav, cup, composer, bokeh, gtao, bloom;
const stations = new Map();
const S = { mode: 'welcome', mesh: null, hb: null, anim: null, rot: new THREE.Vector2(), rotVel: new THREE.Vector2(), open: 0, openTarget: 0, zoom: 0, heldSince: 0, pagesRead: 0 };

async function init() {
  mark('init');
  const [classics, modern, r] = await Promise.all([
    fetch('/bookstore/catalog.json').then((x) => x.json()),
    fetch('/bookstore/modern.json').then((x) => (x.ok ? x.json() : { books: [] })).catch(() => ({ books: [] })),
    buildRoom(renderer, manager),
  ]);
  room = r;
  mark(`loaded: ${classics.books.length} classics, ${modern.books.length} recent`);
  // the glass-fronted antiquarian shelves: atmosphere only
  const atmos = new ShelfBooks({ books: [], sections: [] }, room.runs, { seed: 7 });
  room.scene.add(atmos.mesh);
  displays = new Displays(room.scene, room);
  curator = new Curator(classics, modern);
  nav = new Navigator(camera, room.colliders);
  nav.onStep = (a) => sound.step(a * 0.8);
  nav.onArrive = arrived;
  cup = new CoffeeCup();
  const reading = new THREE.SpotLight('#fff0dc', 0, 2.5, 0.6, 0.8, 1.5);
  reading.position.set(0.15, 0.35, 0.25); camera.add(reading); reading.target.position.set(0, -0.05, -0.45); camera.add(reading.target);
  S.reading = reading;
  room.scene.add(camera);

  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(room.scene, camera));
  gtao = new GTAOPass(room.scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1 });
  gtao.blendIntensity = 0.85; gtao.enabled = !LITE;
  composer.addPass(gtao);
  const cupPass = new RenderPass(cup.scene, camera); cupPass.clear = false; cupPass.clearDepth = true;
  composer.addPass(cupPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.55, 1.6); bloom.enabled = !LITE;
  composer.addPass(bloom);
  bokeh = new BokehPass(room.scene, camera, { focus: 0.45, aperture: 0.0, maxblur: 0.012 }); bokeh.enabled = false;
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(0.95, 0.35, length(vUv - 0.5)); c.rgb *= mix(0.74, 1.0, v);
        c.rgb += (rand(vUv * 913.0 + time) - 0.5) * 0.024; gl_FragColor = c; }`,
  }));
  resize();
  const door = { key: 'door', label: 'Entrance', stand: new THREE.Vector3(0, 0, 8.6), lookAt: new THREE.Vector3(0, 1.3, 0) };
  stations.set('door', door);
  stations.set('till', { key: 'till', label: 'Your pile', stand: new THREE.Vector3(2.85, 0, 3.75), lookAt: new THREE.Vector3(4.42, 1.0, 3.72) });
  nav.goTo(door, true);
  arrange();
  showWelcome();
  $('loading').hidden = true;
  mark('ready');
  renderer.setAnimationLoop(frame);
}

function resize() {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  composer?.setSize(innerWidth, innerHeight);
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Curation & stations
function arrange() {
  const arr = curator.arrange();
  displays.build(arr);
  for (const st of displays.stations) stations.set(st.key, st);
  [...arr.front, ...arr.newTable, ...arr.bays.flatMap((b) => b.books), ...curator.kept].forEach((b) => loadCover(b));
  buildPile();
  renderNav();
}

function renderNav() {
  const items = ORDER.filter((k) => stations.has(k)).map((k) => {
    const st = stations.get(k);
    const label = k === 'till' ? `Your pile${curator.kept.length ? ` (${curator.kept.length})` : ''}` : st.label;
    const b = el('button', { className: 'nav-item', textContent: label, type: 'button' });
    b.classList.toggle('here', nav.station?.key === k);
    b.addEventListener('click', () => go(k));
    return b;
  });
  $('nav').replaceChildren(...items);
}

function go(key) {
  if (S.mode === 'hold') putBack();
  if (S.mode !== 'browse') return;
  const st = stations.get(key); if (!st || st === nav.station) return;
  sound.start();
  nav.goTo(st);
  $('pile-panel').hidden = true;
  renderNav();
}

function arrived(st) {
  renderNav();
  $('pile-panel').hidden = st.key !== 'till';
  if (st.key === 'till') renderPilePanel();
}

function stepStation(dir) {
  const order = ORDER.filter((k) => stations.has(k));
  const i = order.indexOf(nav.station?.key);
  go(order[(i + dir + order.length) % order.length] ?? order[0]);
}

// ---------------------------------------------------------------------------
// Welcome: choose what to browse today
function showWelcome() {
  if (S.mode === 'hold' || S.mode === 'pull' || S.mode === 'return' || S.mode === 'keep') return;
  S.mode = 'welcome';
  $('pile-panel').hidden = true;
  const chosen = new Set(curator.prefs.sections), moods = new Set(curator.prefs.moods);
  const refresh = () => {
    $('welcome-go').disabled = chosen.size === 0;
    $('welcome-count').textContent = chosen.size ? `${chosen.size} of 3 chosen` : 'Choose up to three';
  };
  const chip = (key, label, set, max) => {
    const b = el('button', { className: 'chip', type: 'button', textContent: label });
    b.setAttribute('aria-pressed', String(set.has(key)));
    b.addEventListener('click', () => {
      if (set.has(key)) set.delete(key); else if (!max || set.size < max) set.add(key);
      b.setAttribute('aria-pressed', String(set.has(key)));
      refresh();
    });
    return b;
  };
  $('welcome-sections').replaceChildren(...curator.sections.map((s) => chip(s.key, s.label, chosen, 3)));
  $('welcome-moods').replaceChildren(...MOODS.map((m) => chip(m.key, m.label, moods)));
  $('welcome-title').textContent = curator.hasChosen ? 'Welcome back.' : 'Good to see you.';
  refresh();
  const start = () => {
    sound.start();
    curator.choose([...chosen], [...moods]);
    $('welcome').hidden = true; $('hud').classList.add('active');
    S.mode = 'browse';
    arrange();
    nav.goTo(stations.get('front'));
  };
  $('welcome-go').onclick = start;
  $('welcome-surprise').onclick = () => {
    chosen.clear();
    curator.sections.map((s) => s.key).sort(() => Math.random() - 0.5).slice(0, 3).forEach((k) => chosen.add(k));
    start();
  };
  $('welcome').hidden = false; $('hud').classList.remove('active');
}

// ---------------------------------------------------------------------------
// Input: trackpad first. Two-finger scroll looks (or turns a held book); horizontal
// swipes turn pages; pinch brings the book closer; click picks up / goes / puts down.
const ray = new THREE.Raycaster();
const ndc = new THREE.Vector2();
let drag = null, swipeAcc = 0, swipeTimer;
const setNdc = (e) => { ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(ndc, camera); };

canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, lx: e.clientX, ly: e.clientY, moved: false, id: e.pointerId }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (drag && drag.id === e.pointerId) {
    const mx = e.clientX - drag.lx, my = e.clientY - drag.ly; drag.lx = e.clientX; drag.ly = e.clientY;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (drag.moved) {
      if (S.mode === 'hold') { S.rotVel.x += mx * 0.008; S.rotVel.y += my * 0.008; }
      else if (S.mode === 'browse') nav.nudge(mx * 0.004, my * 0.004);
    }
    return;
  }
  hoverAt(e);
});
canvas.addEventListener('pointerup', (e) => {
  const wasDrag = drag?.moved; drag = null;
  if (!wasDrag) clickAt(e);
});
canvas.addEventListener('pointerleave', () => { if (displays) displays.hover = null; $('tip').hidden = true; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  if (e.ctrlKey) { // pinch
    if (S.mode === 'hold') S.zoom = Math.max(0, Math.min(1, S.zoom - e.deltaY * 0.01));
    return;
  }
  if (S.mode === 'hold') {
    if (S.open > 0.95 && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      swipeAcc += e.deltaX;
      clearTimeout(swipeTimer); swipeTimer = setTimeout(() => { swipeAcc = 0; }, 250);
      if (Math.abs(swipeAcc) > 70) { turn(swipeAcc > 0 ? 1 : -1); swipeAcc = -Math.sign(swipeAcc) * 400; } // one page per swipe
    } else if (S.open < 0.05) { S.rotVel.x += e.deltaX * 0.004; S.rotVel.y += e.deltaY * 0.004; }
    return;
  }
  if (S.mode === 'browse') nav.nudge(e.deltaX * 0.0025, e.deltaY * 0.0025);
}, { passive: false });
canvas.addEventListener('contextmenu', (e) => { e.preventDefault(); if (S.mode === 'hold') putBack(); });

addEventListener('keydown', (e) => {
  if (e.target.closest?.('input, textarea')) return;
  if (e.code === 'KeyM') toast(sound.toggle() ? 'Sound off' : 'Sound on');
  if (S.mode === 'browse') {
    if (e.code === 'ArrowRight') stepStation(1);
    if (e.code === 'ArrowLeft') stepStation(-1);
    return;
  }
  if (S.mode !== 'hold') return;
  if (e.code === 'Space') { e.preventDefault(); toggleOpen(); }
  else if (e.code === 'Escape' || e.code === 'Backspace') putBack();
  else if (e.code === 'KeyK') keep();
  else if (e.code === 'ArrowRight') turn(1);
  else if (e.code === 'ArrowLeft') turn(-1);
});

function nearestStation(mesh) {
  let best = null, d = Infinity;
  for (const st of stations.values()) { if (st.key === 'door' || st.key === 'till') continue; const dd = st.lookAt.distanceTo(mesh.position); if (dd < d) { d = dd; best = st.key; } }
  return best;
}

function hoverAt(e) {
  const tip = $('tip');
  if (S.mode !== 'browse' || nav.moving) { tip.hidden = true; canvas.style.cursor = 'default'; if (displays) displays.hover = null; return; }
  setNdc(e);
  const hit = displays.pick(ray);
  displays.hover = hit?.book && hit.distance < 3.2 ? hit.book : null;
  if (hit?.book && hit.distance < 3.2) {
    const b = hit.book.userData.book;
    tip.replaceChildren(el('strong', { textContent: b.title }), el('span', { textContent: `${b.author} · ${b.year < 0 ? `${-b.year} BCE` : b.year}` }));
  } else if (hit && (hit.station || hit.book)) {
    const key = hit.station || nearestStation(hit.book);
    if (key === nav.station?.key) { tip.hidden = true; canvas.style.cursor = 'default'; return; }
    tip.replaceChildren(el('span', { textContent: `Walk over to ${stations.get(key)?.label}` }));
  } else { tip.hidden = true; canvas.style.cursor = 'default'; return; }
  canvas.style.cursor = 'pointer';
  tip.style.left = `${e.clientX}px`; tip.style.top = `${e.clientY}px`; tip.hidden = false;
}

function clickAt(e) {
  setNdc(e);
  if (S.mode === 'hold') {
    // clicking the open book turns pages; clicking elsewhere sets it down
    const hits = S.hb ? ray.intersectObject(S.hb.pivot, true) : [];
    if (!hits.length) { putBack(); return; }
    if (S.open > 0.95) turn(e.clientX > innerWidth * 0.45 ? 1 : -1);
    return;
  }
  if (S.mode !== 'browse' || nav.moving) return;
  const hit = displays.pick(ray);
  if (!hit) return;
  if (hit.book && hit.distance < 3.2) pickUp(hit.book);
  else go(hit.station || nearestStation(hit.book));
}

// ---------------------------------------------------------------------------
// Book choreography
const tmpM = new THREE.Matrix4();
function homePose(mesh) {
  // HandBook's pivot sits at the centre of the closed book; display meshes have their origin at the spine
  const { home } = mesh.userData;
  const m = new THREE.Matrix4().compose(home.p, home.q, new THREE.Vector3(1, 1, 1)).multiply(tmpM.makeTranslation(mesh.userData.dims.w / 2, 0, 0));
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q };
}
function handPose() {
  camera.updateMatrixWorld();
  const z = -0.43 + 0.12 * ease.inOut(S.zoom);
  const p = new THREE.Vector3(-0.07, -0.02, z).applyMatrix4(camera.matrixWorld);
  const q = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.05, 0, 0)));
  return { p, q };
}

function pickUp(mesh) {
  const book = mesh.userData.book;
  S.mesh = mesh;
  S.hb = new HandBook(book, mesh.userData.dims);
  S.hb.showSpread(0);
  room.scene.add(S.hb.pivot);
  mesh.visible = false; displays.hover = null;
  S.rot.set(0, 0); S.rotVel.set(0, 0); S.open = 0; S.openTarget = 0; S.zoom = 0; S.hb.setOpenness(0);
  S.heldSince = performance.now(); S.pagesRead = 0;
  S.anim = { t: 0, from: homePose(mesh), normal: mesh.userData.out.clone().normalize() };
  S.mode = 'pull'; cup.target = 1;
  curator.signal(book, 'pick');
  sound.slide();
  $('tip').hidden = true; canvas.style.cursor = 'default';
  showInfo(book);
}

function putBack() {
  if (!S.hb || S.mode !== 'hold') return;
  const held = (performance.now() - S.heldSince) / 1000;
  if (held < 2.5 && !S.pagesRead) curator.signal(S.hb.book, 'putback-quick');
  else if (held > 8) curator.signal(S.hb.book, 'linger');
  S.hb.showSpread(0);
  S.anim = { t: 0, start: { p: S.hb.pivot.position.clone(), q: S.hb.pivot.quaternion.clone() } };
  S.mode = 'return';
  hideInfo();
  sound.slide();
}

function keep() {
  if (!S.hb || S.mode !== 'hold') return;
  const book = S.hb.book;
  curator.keep(book);
  S.anim = { t: 0, start: { p: S.hb.pivot.position.clone(), q: S.hb.pivot.quaternion.clone() } };
  S.mode = 'keep';
  hideInfo();
  sound.thump();
  toast(`“${book.title}” is waiting on your pile at the till`);
}

function toggleOpen() {
  if (!S.hb?.canOpen || S.hb.flipT !== null) return;
  S.hb.showSpread(0);
  S.openTarget = S.openTarget ? 0 : 1;
  if (S.openTarget) S.rot.set(0, 0);
  sound.cover();
  updateInfoButtons();
}

function turn(dir) {
  if (!S.hb || S.open < 0.95) return;
  if (S.hb.beginFlip(dir)) { sound.page(); if (dir > 0) { S.pagesRead++; curator.signal(S.hb.book, 'read', 0.5); } }
}

function finishHold(returned) {
  room.scene.remove(S.hb.pivot);
  S.hb.dispose(); S.hb = null;
  if (returned && S.mesh) S.mesh.visible = true;
  if (!returned) { buildPile(); renderNav(); }
  S.mesh = null;
  S.mode = 'browse'; cup.target = 0;
}

function updateBook(dt) {
  const hb = S.hb; if (!hb) return;
  const pv = hb.pivot, a = S.anim;
  S.open += (S.openTarget - S.open) * Math.min(1, dt * 5.5);
  if (Math.abs(S.open - S.openTarget) < 0.002) S.open = S.openTarget;
  hb.setOpenness(ease.inOut(S.open));
  hb.updateFlip(dt);

  if (S.mode === 'pull') {
    a.t += dt;
    const { p: sp, q: sq } = a.from;
    const out = sp.clone().addScaledVector(a.normal, 0.14);
    const d1 = 0.32, d2 = 0.7;
    if (a.t < d1) {
      pv.position.lerpVectors(sp, out, ease.out(a.t / d1)); pv.quaternion.copy(sq);
    } else {
      const e = ease.inOut(Math.min(1, (a.t - d1) / d2));
      const { p: hp, q: hq } = handPose();
      const mid = out.clone().lerp(hp, 0.5).add(new THREE.Vector3(0, 0.1, 0));
      pv.position.copy(out.clone().multiplyScalar((1 - e) ** 2).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(hp, e * e));
      pv.quaternion.copy(sq).slerp(hq, e);
      if (e >= 1) S.mode = 'hold';
    }
  } else if (S.mode === 'hold') {
    S.rot.add(S.rotVel); S.rotVel.multiplyScalar(Math.exp(-dt * 10));
    if (S.openTarget > 0) S.rot.multiplyScalar(1 - Math.min(1, dt * 6));
    S.rot.y = Math.max(-1.2, Math.min(1.2, S.rot.y));
    const { p, q } = handPose();
    const breathe = Math.sin(performance.now() / 1000 * 1.1) * 0.0015;
    pv.position.lerp(p.add(new THREE.Vector3(-0.035 * ease.inOut(S.open), breathe, 0).applyQuaternion(camera.quaternion)), Math.min(1, dt * 10));
    const user = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.rot.y, S.rot.x, 0, 'YXZ'));
    pv.quaternion.slerp(q.multiply(user), Math.min(1, dt * 12));
  } else if (S.mode === 'return') {
    a.t += dt;
    const { p: sp, q: sq } = homePose(S.mesh);
    const out = sp.clone().addScaledVector(S.mesh.userData.out.clone().normalize(), 0.14);
    S.openTarget = 0;
    const d1 = 0.6, d2 = 0.3;
    if (a.t < d1) {
      const e = ease.inOut(a.t / d1);
      const mid = a.start.p.clone().lerp(out, 0.5).add(new THREE.Vector3(0, 0.08, 0));
      pv.position.copy(a.start.p.clone().multiplyScalar((1 - e) ** 2).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(out, e * e));
      pv.quaternion.copy(a.start.q).slerp(sq, e);
    } else {
      const e = ease.inOut(Math.min(1, (a.t - d1) / d2));
      pv.position.lerpVectors(out, sp, e); pv.quaternion.copy(sq);
      if (e >= 1) { sound.thump(); finishHold(true); }
    }
  } else if (S.mode === 'keep') {
    a.t += dt;
    const e = ease.inOut(Math.min(1, a.t / 0.6));
    pv.position.lerpVectors(a.start.p, new THREE.Vector3(0.3, -0.35, -0.6).applyMatrix4(camera.matrixWorld), e);
    pv.scale.setScalar(1 - 0.6 * e);
    if (e >= 1) finishHold(false);
  }
  const near = S.mode === 'hold' || S.mode === 'pull';
  bokeh.uniforms.focus.value = camera.position.distanceTo(pv.position);
  const ap = bokeh.uniforms.aperture.value;
  bokeh.uniforms.aperture.value = ap + ((near ? 0.03 : 0) - ap) * Math.min(1, dt * 4);
  S.reading.intensity += ((near ? 0.35 : 0) - S.reading.intensity) * Math.min(1, dt * 4);
}

// ---------------------------------------------------------------------------
// The card beside a book you're holding
function buyLink(b) {
  if (b.isbn13) return BOOKSHOP_AFFILIATE ? `https://bookshop.org/a/${BOOKSHOP_AFFILIATE}/${b.isbn13}` : `https://bookshop.org/search?keywords=${b.isbn13}`;
  return `https://bookshop.org/search?keywords=${encodeURIComponent(`${b.title} ${b.author}`)}`;
}

function showInfo(b) {
  const yr = b.year < 0 ? `${-b.year} BCE` : b.year;
  const links = el('div', { className: 'links' },
    el('a', { href: buyLink(b), target: '_blank', rel: 'noopener', textContent: 'Buy from Bookshop.org ↗' }),
    b.gutenberg ? el('a', { href: `https://www.gutenberg.org/ebooks/${b.gutenberg}`, target: '_blank', rel: 'noopener', textContent: 'Read free at Project Gutenberg ↗' }) : null,
    !b.preview && b.google_id ? el('a', { href: `https://books.google.com/books?id=${b.google_id}`, target: '_blank', rel: 'noopener', textContent: 'See it on Google Books ↗' }) : null);
  $('info').replaceChildren(
    el('p', { className: 'eyebrow', textContent: curator.labels[b.section] || '' }),
    el('h2', { textContent: b.title }),
    el('p', { className: 'byline', textContent: `${b.author} · ${yr}` }),
    b.tagline ? el('p', { className: 'tagline', textContent: b.tagline }) : null,
    el('div', { className: 'actions', id: 'info-actions' }),
    links,
    el('p', { className: 'gesture' }));
  updateInfoButtons();
  $('info').hidden = false;
  requestAnimationFrame(() => $('info').classList.add('shown'));
}
function updateInfoButtons() {
  const b = S.hb?.book; if (!b) return;
  const btn = (label, fn, cls = '') => { const x = el('button', { type: 'button', className: cls, textContent: label }); x.addEventListener('click', fn); return x; };
  const open = S.openTarget > 0;
  $('info-actions').replaceChildren(...[
    S.hb.canOpen ? btn(open ? 'Close it' : 'Open and read', toggleOpen, 'primary') : null,
    open ? el('span', { className: 'pager' }, btn('‹', () => turn(-1)), btn('›', () => turn(1))) : null,
    !S.hb.canOpen && b.preview && b.google_id ? btn('Look inside', () => lookInside(b), 'primary') : null,
    !open ? btn('Turn it over', () => { S.rotVel.x += Math.PI / 14; }) : null,
    btn('Keep for later', keep),
    btn('Put it back', putBack, 'quiet'),
  ].filter(Boolean));
  $('info').querySelector('.gesture').textContent = open
    ? 'Swipe sideways or click a page to turn it. Pinch to bring it closer.'
    : 'Drag or two-finger scroll to turn it over. Click anywhere else to put it back.';
}
function hideInfo() { $('info').classList.remove('shown'); setTimeout(() => { if (!$('info').classList.contains('shown')) $('info').hidden = true; }, 300); }

// Google Books embedded preview for recent books (publisher-approved pages only).
let gbReady = null;
function lookInside(b) {
  $('preview').hidden = false;
  $('preview-title').textContent = b.title;
  const host = $('preview-viewer'); host.replaceChildren(el('p', { textContent: 'Opening the preview…' }));
  gbReady ||= new Promise((resolve, reject) => {
    const s = el('script', { src: 'https://www.google.com/books/jsapi.js', async: true });
    s.onload = () => { google.books.load(); google.books.setOnLoadCallback(resolve); };
    s.onerror = reject; document.head.append(s);
  });
  gbReady.then(() => {
    host.replaceChildren();
    new google.books.DefaultViewer(host).load(b.google_id, () => host.replaceChildren(el('p', { textContent: 'No preview is available for this edition.' })));
  }).catch(() => host.replaceChildren(el('p', { textContent: 'The preview could not be loaded.' })));
}
$('preview-close').addEventListener('click', () => { $('preview').hidden = true; });
$('change').addEventListener('click', () => showWelcome());

// ---------------------------------------------------------------------------
// Your pile: a real stack on the café counter, and a list beside it at the till
let pileGroup = null;
function buildPile() {
  if (pileGroup) {
    pileGroup.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.forEach((m) => { m.map?.dispose(); m.dispose(); }); } });
    room.scene.remove(pileGroup);
  }
  pileGroup = new THREE.Group();
  let y = 1.05;
  curator.kept.forEach((b, i) => {
    const d = bookDims(b, () => (hash(b.id + i) % 1000) / 1000);
    const c = Object.assign(document.createElement('canvas'), { width: 64, height: 384 });
    drawSpine(c.getContext('2d'), b, 64, 384);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const edge = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.95 });
    const cover = new THREE.MeshStandardMaterial({ color: b.palette?.bg || '#5a3a2a', roughness: 0.7 });
    const spine = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 });
    // lying flat on the counter; the spine faces the till station so the titles read
    const m = new THREE.Mesh(new THREE.BoxGeometry(d.t, d.h, d.w).rotateZ(Math.PI / 2), [cover, cover, edge, edge, edge, spine]);
    m.position.set(4.42, y + d.t / 2, 3.72); m.rotation.y = -Math.PI / 2 + ((hash(b.id) % 100) - 50) / 600;
    m.castShadow = true; m.receiveShadow = true;
    pileGroup.add(m); y += d.t + 0.001;
  });
  room.scene.add(pileGroup);
}
function renderPilePanel() {
  const kept = curator.kept;
  $('pile-list').replaceChildren(...kept.map((b) => {
    const back = el('button', { type: 'button', textContent: 'Return to the shelves' });
    back.addEventListener('click', () => { curator.unkeep(b.id); arrange(); renderPilePanel(); });
    return el('li', {},
      el('div', {}, el('strong', { textContent: b.title }), el('span', { className: 'muted', textContent: ` · ${b.author}` })),
      el('div', { className: 'row' }, el('a', { href: buyLink(b), target: '_blank', rel: 'noopener', textContent: 'Buy ↗' }), back));
  }));
  $('pile-empty').hidden = kept.length > 0;
}

// ---------------------------------------------------------------------------
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600); }

const clock = new THREE.Timer();
let slowFrames = 0, quality = 'high';
function frame(now) {
  clock.update(now);
  const dt = Math.min(clock.getDelta(), DEBUG ? 0.5 : 0.05), t = clock.getElapsed();
  const walk = nav.update(S.mode === 'welcome' ? 0 : dt);
  camera.updateMatrixWorld();
  displays.update(dt);
  updateBook(dt);
  bokeh.enabled = !LITE && bokeh.uniforms.aperture.value > 0.001;
  cup.update(dt, camera, walk, t);
  composer.passes.at(-1).uniforms.time.value = t % 100;
  composer.render(dt);
  if (!frame.n) { frame.n = 1; mark('first frame'); }
  slowFrames = dt > 0.034 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
  if (!DEBUG && quality === 'high' && slowFrames > 90) { quality = 'low'; gtao.enabled = false; renderer.setPixelRatio(1); resize(); }
}

if (DEBUG) {
  window.__bs = {
    S, stations, camera, get nav() { return nav; }, get displays() { return displays; }, get curator() { return curator; },
    choose: (secs) => { curator.choose(secs); $('welcome').hidden = true; $('hud').classList.add('active'); S.mode = 'browse'; arrange(); },
    go, pickUp, putBack, keep, toggleOpen, turn, rotate: (x, y) => S.rot.set(x, y),
    state: () => ({ mode: S.mode, station: nav?.station?.key, moving: nav?.moving, open: S.open, spread: S.hb?.spread, kept: curator?.kept.length }),
  };
}
init().catch((e) => { $('loading-msg').textContent = `Could not open the store: ${e.message}`; console.error(e); });
