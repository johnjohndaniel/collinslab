// collinslab books: walk into a bookstore, take books off the shelf, look them over, flip through.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildRoom } from './room.js';
import { ShelfBooks, HandBook } from './books.js';
import { Player, CoffeeCup } from './player.js';
import { Sound } from './audio.js';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const LITE = params.has('lite'); // test mode for machines without a GPU
const mark = (m) => { if (params.has('debug')) console.log(`[bookstore] ${m} @ ${Math.round(performance.now())} ms`); };
globalThis.__bsMark = mark;
const ease = { inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2), out: (t) => 1 - (1 - t) ** 3, in: (t) => t * t * t };
const HELD_KEY = 'collinslab.books.held';

// ---------------------------------------------------------------------------
const canvas = $('view');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(LITE ? 0.5 : Math.min(devicePixelRatio, 1.5));
renderer.shadowMap.enabled = !LITE;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
const camera = new THREE.PerspectiveCamera(58, 1, 0.02, 60);
camera.rotation.order = 'YXZ';

const manager = new THREE.LoadingManager();
manager.onProgress = (_, done, total) => { $('bar').style.width = `${Math.round((done / total) * 100)}%`; };

const sound = new Sound();
let room, shelf, player, cup, composer, bokeh, gtao, bloom;
let catalog;

// The book in hand and its animation state.
const S = { mode: 'intro', item: -1, hb: null, anim: null, rot: new THREE.Vector2(), rotVel: new THREE.Vector2(), open: 0, openTarget: 0, held: [] };

async function init() {
  mark('init');
  [catalog, room] = await Promise.all([
    fetch('/bookstore/catalog.json').then((r) => { if (!r.ok) throw new Error('catalogue missing'); return r.json(); }),
    buildRoom(renderer, manager),
  ]);
  mark('room + catalogue loaded');
  const seed = Number(localStorage.getItem('collinslab.books.seed')) || (() => { const s = Math.floor(Math.random() * 1e9); localStorage.setItem('collinslab.books.seed', s); return s; })();
  shelf = new ShelfBooks(catalog, room.runs, { seed });
  room.scene.add(shelf.mesh);
  mark(`shelves filled: ${shelf.items.length} books`);
  player = new Player(camera, room.colliders, room.spawn);
  player.onStep = (a) => sound.step(a);
  cup = new CoffeeCup();
  // a reading light that follows your head, so a book in hand is always legible
  const reading = new THREE.SpotLight('#fff0dc', 0, 2.5, 0.6, 0.8, 1.5);
  reading.position.set(0.15, 0.35, 0.25); camera.add(reading); reading.target.position.set(0, -0.05, -0.45); camera.add(reading.target);
  S.reading = reading;
  room.scene.add(camera);

  // Post-processing
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(room.scene, camera));
  gtao = new GTAOPass(room.scene, camera, innerWidth, innerHeight);
  gtao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1, scale: 1 });
  gtao.blendIntensity = 0.85;
  composer.addPass(gtao);
  if (LITE) gtao.enabled = false;
  const cupPass = new RenderPass(cup.scene, camera); cupPass.clear = false; cupPass.clearDepth = true;
  composer.addPass(cupPass);
  bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.3, 0.55, 1.6);
  composer.addPass(bloom);
  bokeh = new BokehPass(room.scene, camera, { focus: 0.45, aperture: 0.0, maxblur: 0.012 });
  bokeh.enabled = false;
  composer.addPass(bokeh);
  composer.addPass(new OutputPass());
  composer.addPass(new ShaderPass({
    uniforms: { tDiffuse: { value: null }, time: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float time; varying vec2 vUv;
      float rand(vec2 c){ return fract(sin(dot(c, vec2(12.9898,78.233))) * 43758.5453); }
      void main(){ vec4 c = texture2D(tDiffuse, vUv);
        float v = smoothstep(0.95, 0.35, length(vUv - 0.5)); c.rgb *= mix(0.72, 1.0, v);
        c.rgb += (rand(vUv * 913.0 + time) - 0.5) * 0.028; gl_FragColor = c; }`,
  }));
  resize();
  restoreHeld();
  mark('ready');
  $('loading').hidden = true;
  $('intro').hidden = false;
  renderer.setAnimationLoop(frame);
}

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
  composer?.setSize(w, h);
}
addEventListener('resize', resize);

// ---------------------------------------------------------------------------
// Input
const enter = () => { canvas.requestPointerLock?.(); sound.start(); };
$('enter').addEventListener('click', enter);
$('resume').addEventListener('click', enter);
document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  $('intro').hidden = true;
  $('pause').hidden = locked || S.mode === 'intro';
  if (locked && S.mode === 'intro') S.mode = 'walk';
  if (!locked && S.mode !== 'intro') renderHeldList();
  $('hud').classList.toggle('active', locked);
});
document.addEventListener('mousemove', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (S.mode === 'hold') { S.rotVel.x += e.movementX * 0.006; S.rotVel.y += e.movementY * 0.006; }
  else if (S.mode === 'walk') player.look(e.movementX, e.movementY);
});
canvas.addEventListener('mousedown', (e) => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0 && S.mode === 'walk' && shelf.hover >= 0 && shelf.items[shelf.hover].bookIndex != null) pickUp(shelf.hover);
  if (e.button === 2 && S.mode === 'hold') putBack();
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
addEventListener('wheel', (e) => { if (S.mode === 'hold' && S.open > 0.99) turn(e.deltaY > 0 ? 1 : -1); }, { passive: true });
addEventListener('keydown', (e) => {
  if (e.code === 'KeyM') toast(sound.toggle() ? 'Sound off' : 'Sound on');
  if (S.mode !== 'hold') return;
  if (e.code === 'Space') { e.preventDefault(); toggleOpen(); }
  else if (e.code === 'KeyR' || e.code === 'Backspace') putBack();
  else if (e.code === 'KeyH') keep();
  else if (['ArrowRight', 'KeyD'].includes(e.code)) turn(1);
  else if (['ArrowLeft', 'KeyA'].includes(e.code)) turn(-1);
});

// ---------------------------------------------------------------------------
// Book choreography
const tmpM = new THREE.Matrix4();
function shelfPose(item) {
  // pivot centre = spine centre moved half a cover-width into the shelf
  const m = item.matrix.clone().multiply(tmpM.makeTranslation(item.dims.w / 2, 0, 0));
  const p = new THREE.Vector3(), q = new THREE.Quaternion(), s = new THREE.Vector3();
  m.decompose(p, q, s);
  return { p, q };
}
function handPose() {
  camera.updateMatrixWorld();
  const p = new THREE.Vector3(0, -0.025, -0.43).applyMatrix4(camera.matrixWorld);
  const q = camera.quaternion.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(-0.06, 0, 0)));
  return { p, q };
}

function pickUp(i) {
  const item = shelf.items[i], book = catalog.books[item.bookIndex];
  S.item = i;
  S.hb = new HandBook(book, item.dims);
  S.hb.showSpread(0);
  room.scene.add(S.hb.pivot);
  shelf.setHidden(i, true);
  shelf.hover = -1;
  S.rot.set(0, 0); S.rotVel.set(0, 0); S.open = 0; S.openTarget = 0; S.hb.setOpenness(0);
  const from = shelfPose(item);
  // Turn the book so the spine faces you, as it did on the shelf: rotate the pivot pose
  // (book +z = front cover) so its spine (-x) points out of the shelf.
  S.anim = { kind: 'pull', t: 0, from, normal: item.normal.clone(), dur1: 0.34, dur2: 0.62 };
  S.mode = 'pull'; player.enabled = false; cup.target = 1;
  sound.slide();
  setHint('hold');
  $('label').hidden = true;
}

function putBack() {
  if (!S.hb || S.mode !== 'hold') return;
  S.hb.showSpread(0);
  S.anim = { kind: 'return', t: 0, start: { p: S.hb.pivot.position.clone(), q: S.hb.pivot.quaternion.clone() }, closeFrom: S.open };
  S.mode = 'return';
  sound.slide();
}

function keep() {
  if (!S.hb || S.mode !== 'hold') return;
  const book = S.hb.book;
  S.held.push({ id: book.id, title: book.title, author: book.author, item: S.item });
  saveHeld();
  S.anim = { kind: 'keep', t: 0, start: { p: S.hb.pivot.position.clone(), q: S.hb.pivot.quaternion.clone(), s: 1 } };
  S.mode = 'keep';
  sound.thump();
  toast(`Kept “${book.title}” · ${S.held.length} on your pile`);
}

function toggleOpen() {
  if (!S.hb || S.hb.flipT !== null) return;
  if (S.openTarget === 0) { S.openTarget = 1; S.hb.showSpread(0); sound.cover(); }
  else { S.hb.showSpread(0); S.openTarget = 0; sound.cover(); }
}

function turn(dir) {
  if (!S.hb || S.open < 0.99) return;
  if (S.hb.beginFlip(dir)) sound.page();
}

function finishHold() {
  room.scene.remove(S.hb.pivot);
  S.hb.dispose(); S.hb = null; S.item = -1;
  S.mode = 'walk'; player.enabled = true; cup.target = 0;
  setHint('walk');
}

function updateBook(dt) {
  const hb = S.hb; if (!hb) return;
  const pv = hb.pivot, a = S.anim;
  // opening / closing
  S.open += (S.openTarget - S.open) * Math.min(1, dt * 5.5);
  if (Math.abs(S.open - S.openTarget) < 0.002) S.open = S.openTarget;
  hb.setOpenness(ease.inOut(S.open));
  hb.updateFlip(dt);

  if (S.mode === 'pull') {
    a.t += dt;
    const { p: sp, q: sq } = a.from;
    const out = sp.clone().addScaledVector(a.normal, 0.14);
    const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3().crossVectors(a.normal, new THREE.Vector3(0, 1, 0)).normalize(), 0.12);
    if (a.t < a.dur1) {
      const e = ease.out(a.t / a.dur1);
      pv.position.lerpVectors(sp, out, e);
      pv.quaternion.copy(sq).premultiply(new THREE.Quaternion().slerp(tilt, Math.sin(e * Math.PI) * 0.8));
    } else {
      const e = ease.inOut(Math.min(1, (a.t - a.dur1) / a.dur2));
      const { p: hp, q: hq } = handPose();
      const mid = out.clone().lerp(hp, 0.5).add(new THREE.Vector3(0, 0.12, 0));
      // quadratic Bézier arc from the shelf to your hands
      pv.position.copy(out.clone().multiplyScalar((1 - e) ** 2).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(hp, e * e));
      pv.quaternion.copy(sq).slerp(hq, e);
      if (e >= 1) { S.mode = 'hold'; }
    }
  } else if (S.mode === 'hold') {
    S.rot.add(S.rotVel); S.rotVel.multiplyScalar(Math.exp(-dt * 10));
    if (S.openTarget > 0) S.rot.multiplyScalar(1 - Math.min(1, dt * 6)); // face the spread when reading
    S.rot.y = Math.max(-1.2, Math.min(1.2, S.rot.y));
    const { p, q } = handPose();
    const breathe = Math.sin(performance.now() / 1000 * 1.1) * 0.0015;
    const open = ease.inOut(S.open);
    pv.position.lerp(p.add(new THREE.Vector3(0, breathe - 0.01 * open, 0).applyQuaternion(camera.quaternion)), Math.min(1, dt * 12));
    const user = new THREE.Quaternion().setFromEuler(new THREE.Euler(S.rot.y, S.rot.x, 0, 'YXZ'));
    pv.quaternion.slerp(q.multiply(user), Math.min(1, dt * 14));
    // move closer to read when open
    pv.position.add(new THREE.Vector3(0, 0, 0.02 * open).applyQuaternion(camera.quaternion));
  } else if (S.mode === 'return') {
    a.t += dt;
    const item = shelf.items[S.item], { p: sp, q: sq } = shelfPose(item);
    const out = sp.clone().addScaledVector(item.normal, 0.14);
    S.openTarget = 0;
    const d1 = 0.55, d2 = 0.32;
    if (a.t < d1) {
      const e = ease.inOut(a.t / d1);
      const mid = a.start.p.clone().lerp(out, 0.5).add(new THREE.Vector3(0, 0.08, 0));
      pv.position.copy(a.start.p.clone().multiplyScalar((1 - e) ** 2).addScaledVector(mid, 2 * (1 - e) * e).addScaledVector(out, e * e));
      pv.quaternion.copy(a.start.q).slerp(sq, e);
    } else {
      const e = ease.inOut(Math.min(1, (a.t - d1) / d2));
      pv.position.lerpVectors(out, sp, e); pv.quaternion.copy(sq);
      if (e >= 1) { shelf.setHidden(S.item, false); sound.thump(); finishHold(); }
    }
  } else if (S.mode === 'keep') {
    a.t += dt;
    const e = ease.in(Math.min(1, a.t / 0.5));
    const target = new THREE.Vector3(-0.32, -0.32, -0.5).applyMatrix4(camera.matrixWorld);
    pv.position.lerpVectors(a.start.p, target, e);
    pv.scale.setScalar(1 - 0.7 * e);
    pv.rotateZ(dt * 2);
    if (e >= 1) { pv.scale.setScalar(1); bumpPile(); finishHold(); }
  }
  // depth of field + reading light follow the book
  const near = S.mode === 'hold' || S.mode === 'pull';
  const dist = camera.position.distanceTo(pv.position);
  bokeh.uniforms.focus.value = dist;
  const ap = bokeh.uniforms.aperture.value;
  bokeh.uniforms.aperture.value = ap + ((near ? 0.03 : 0) - ap) * Math.min(1, dt * 4);
  S.reading.intensity += ((near ? 0.35 : 0) - S.reading.intensity) * Math.min(1, dt * 4);
}

// ---------------------------------------------------------------------------
// Kept books
function saveHeld() { localStorage.setItem(HELD_KEY, JSON.stringify(S.held.map(({ id, title, author }) => ({ id, title, author })))); }
function restoreHeld() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(HELD_KEY) || '[]'); } catch { saved = []; }
  for (const h of saved) {
    const bi = catalog.books.findIndex((b) => b.id === h.id);
    const item = shelf.items.findIndex((it) => it.bookIndex === bi && !it.hidden);
    if (item >= 0) { shelf.setHidden(item, true); S.held.push({ ...h, item }); }
  }
  bumpPile(false);
}
function bumpPile(animate = true) {
  $('pile-count').textContent = S.held.length;
  $('pile').hidden = S.held.length === 0;
  if (animate) { $('pile').classList.remove('bump'); void $('pile').offsetWidth; $('pile').classList.add('bump'); }
}
function renderHeldList() {
  const ul = $('held-list');
  ul.replaceChildren(...S.held.map((h, i) => {
    const li = document.createElement('li');
    const name = document.createElement('span'); name.innerHTML = '<strong></strong><em></em>';
    name.querySelector('strong').textContent = h.title; name.querySelector('em').textContent = ` · ${h.author}`;
    const btn = document.createElement('button'); btn.textContent = 'Put back on its shelf'; btn.className = 'btn ghost';
    btn.addEventListener('click', () => { if (h.item >= 0) shelf.setHidden(h.item, false); S.held.splice(i, 1); saveHeld(); bumpPile(false); renderHeldList(); });
    li.append(name, btn); return li;
  }));
  $('held-empty').hidden = S.held.length > 0;
}

// ---------------------------------------------------------------------------
// HUD
function setHint(mode) {
  $('hint').innerHTML = mode === 'hold'
    ? '<b>Move mouse</b> turn it over · <b>Space</b> open / close · <b>← →</b> or <b>wheel</b> turn pages · <b>H</b> keep it · <b>R</b> or <b>right-click</b> put it back'
    : '<b>W A S D</b> walk · <b>Shift</b> stroll faster · <b>mouse</b> look · <b>click</b> a book to take it off the shelf · <b>M</b> sound · <b>Esc</b> menu';
}
let toastTimer;
function toast(msg) { const t = $('toast'); t.textContent = msg; t.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2200); }

const ray = new THREE.Raycaster();
function updateHover() {
  if (S.mode !== 'walk') { shelf.hover = -1; return; }
  ray.setFromCamera(new THREE.Vector2(0, 0), camera);
  const i = shelf.pick(ray.ray);
  shelf.hover = i;
  const label = $('label');
  if (i < 0) { label.hidden = true; $('crosshair').classList.remove('on'); return; }
  const it = shelf.items[i];
  $('crosshair').classList.toggle('on', it.bookIndex != null);
  if (it.bookIndex == null) { label.hidden = false; label.innerHTML = '<em>An old, unmarked volume</em>'; return; }
  const b = catalog.books[it.bookIndex];
  label.hidden = false;
  label.innerHTML = '';
  const t = document.createElement('strong'); t.textContent = b.title;
  const a = document.createElement('span'); a.textContent = b.author;
  label.append(t, a);
}

// ---------------------------------------------------------------------------
const clock = new THREE.Timer();
let slowFrames = 0, quality = 'high';
function frame(now) {
  clock.update(now);
  const dt = Math.min(clock.getDelta(), params.has('debug') ? 0.5 : 0.05), t = clock.getElapsed();
  const walk = player.update(S.mode === 'intro' ? 0 : dt);
  camera.updateMatrixWorld();
  updateHover();
  shelf.update(dt);
  updateBook(dt);
  bokeh.enabled = !LITE && bokeh.uniforms.aperture.value > 0.001;
  if (LITE) bloom.enabled = false;
  cup.update(dt, camera, walk, t);
  composer.passes.at(-1).uniforms.time.value = t % 100;
  composer.render(dt);
  if (!frame.n) { frame.n = 1; mark('first frame rendered'); }
  // drop the expensive passes if the machine is struggling
  slowFrames = dt > 0.034 ? slowFrames + 1 : Math.max(0, slowFrames - 1);
  if (quality === 'high' && slowFrames > 90) { quality = 'low'; gtao.enabled = false; renderer.setPixelRatio(1); resize(); toast('Lowered quality for smoother movement'); }
}

setHint('walk');
// Test hook (only with ?debug): lets automated checks walk and act without pointer lock.
if (new URLSearchParams(location.search).has('debug')) {
  window.__bs = {
    S, get player() { return player; }, get shelf() { return shelf; }, camera, pickUp, toggleOpen, turn, keep, putBack,
    walk() { S.mode = 'walk'; $('intro').hidden = true; $('hud').classList.add('active'); },
    place(x, z, yaw, pitch = 0) { Object.assign(player.pos, { x, z }); player.yaw = yaw; player.pitch = pitch; },
    rotate(x, y) { S.rot.set(x, y); },
    state: () => ({ mode: S.mode, hover: shelf?.hover, open: S.open, spread: S.hb?.spread, flipping: S.hb?.flipT != null }),
  };
}
init().catch((e) => { $('loading-msg').textContent = `Could not open the store: ${e.message}`; console.error(e); });
