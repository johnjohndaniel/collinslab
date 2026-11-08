// The bookstore building: shell, light, shelving, café, furniture.
// Returns the scene pieces plus `runs` (every shelf run books can fill) and
// `colliders` (axis-aligned boxes in x/z the player can't walk through).
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const A = '/bookstore/assets';

// Room: x in [-W/2, W/2], z in [-D/2, D/2]; the entrance wall is at z = +D/2.
export const ROOM = { W: 14, D: 20, H: 3.6 };

// Box whose UVs are in world units (so textures tile at a constant scale).
export function box(w, h, d, scale = 1) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
    const k = f * 4 + i;
    uv.setXY(k, uv.getX(k) * dims[f][0] / scale, uv.getY(k) * dims[f][1] / scale);
  }
  return g;
}

function pbr(loader, name, { repeat = 1, color, roughness = 1, normalScale = 1, envMapIntensity = 1 } = {}) {
  const load = (suffix, srgb) => {
    const t = loader.load(`${A}/textures/${name}_${suffix}_1k.jpg`);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(repeat, repeat);
    t.anisotropy = 8;
    if (srgb) t.colorSpace = THREE.SRGBColorSpace;
    return t;
  };
  const mat = new THREE.MeshStandardMaterial({
    map: load('diffuse', true), normalMap: load('nor_gl'), roughnessMap: load('rough'),
    normalScale: new THREE.Vector2(normalScale, normalScale), roughness, envMapIntensity,
  });
  if (color) mat.color.copy(color);
  return mat;
}

export function canvasTexture(w, h, draw) {
  const c = Object.assign(document.createElement('canvas'), { width: w, height: h });
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

export function shadowy(obj, cast = true, receive = true) {
  obj.traverse((o) => { if (o.isMesh) { o.castShadow = cast; o.receiveShadow = receive; } });
  return obj;
}

// A hanging section sign: dark green board, brass lettering.
function sectionSign(label) {
  const tex = canvasTexture(1024, 192, (g, w, h) => {
    g.fillStyle = '#1f3a32'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9a45c'; g.lineWidth = 6; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#e8cf8f'; g.font = '600 78px Georgia, "Times New Roman", serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(label, w / 2, h / 2 + 4);
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.6, metalness: 0.1 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.3, 0.03), [mat, mat, mat, mat, mat, mat]);
  const g = new THREE.Group();
  g.add(board);
  const rodMat = new THREE.MeshStandardMaterial({ color: '#2b2b2b', metalness: 0.8, roughness: 0.4 });
  for (const x of [-0.65, 0.65]) {
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.6, 6), rodMat);
    rod.position.set(x, 0.45, 0); g.add(rod);
  }
  return g;
}

/**
 * A run of shelving. `side` sets which way the books face:
 * books are placed in runs along `dir`, spines facing `normal`.
 */
function shelfUnit({ length, height = 2.25, depth = 0.34, levels = 6, doubleSided = false, wood }) {
  const g = new THREE.Group();
  const t = 0.028; // board thickness
  const totalDepth = doubleSided ? depth * 2 + 0.02 : depth;
  const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, wood); m.position.set(x, y, z); g.add(m); return m; };
  // uprights every ~0.9 m
  const bays = Math.max(1, Math.round(length / 0.9));
  for (let i = 0; i <= bays; i++) add(box(t, height, totalDepth, 0.8), -length / 2 + (i * length) / bays, height / 2, 0);
  // plinth, top, back panel
  add(box(length, 0.1, totalDepth - 0.02, 0.8), 0, 0.05, 0);
  add(box(length + 0.06, 0.04, totalDepth + 0.04, 0.8), 0, height + 0.02, 0);
  add(box(length, height, 0.015, 0.8), 0, height / 2, doubleSided ? 0 : -depth / 2 + 0.008);
  // shelves
  const ys = [];
  const usable = height - 0.12;
  for (let l = 0; l < levels; l++) {
    const y = 0.1 + (l * usable) / levels;
    add(box(length, t, totalDepth - 0.02, 0.8), 0, y, 0);
    ys.push(y + t / 2);
  }
  shadowy(g);
  // Shelf runs in unit-local space: front edge position, run direction, outward normal.
  const runs = [];
  const sides = doubleSided ? [1, -1] : [1];
  for (const s of sides) {
    const frontZ = doubleSided ? s * (depth + 0.01) : depth / 2;
    for (let l = 0; l < levels; l++) {
      for (let b = 0; b < bays; b++) {
        const x0 = -length / 2 + (b * length) / bays + t / 2 + 0.005, x1 = -length / 2 + ((b + 1) * length) / bays - t / 2 - 0.005;
        runs.push({
          start: new THREE.Vector3(s > 0 ? x0 : x1, ys[l], frontZ),
          dir: new THREE.Vector3(s > 0 ? 1 : -1, 0, 0),
          normal: new THREE.Vector3(0, 0, s),
          length: x1 - x0,
          clearance: (l < levels - 1 ? usable / levels : height - ys[l]) - 0.02,
          depth, level: l, side: s,
        });
      }
    }
  }
  return { group: g, runs, footprint: [length + 0.06, totalDepth + 0.04] };
}

async function loadModel(loader, name) {
  const gltf = await loader.loadAsync(`${A}/models/${name}/${name}.gltf`);
  return shadowy(gltf.scene);
}

// Put a model's lowest point on y = 0 at (x, z).
function placeOnFloor(obj, x, z, rotY = 0) {
  obj.rotation.y = rotY;
  obj.updateMatrixWorld(true);
  const b = new THREE.Box3().setFromObject(obj);
  obj.position.set(x, -b.min.y, z);
  return obj;
}

export async function buildRoom(renderer, manager) {
  const scene = new THREE.Scene();
  const tex = new THREE.TextureLoader(manager);
  const gltf = new GLTFLoader(manager);
  const { W, D, H } = ROOM;
  const colliders = [];
  const collide = (cx, cz, sx, sz) => colliders.push({ minX: cx - sx / 2, maxX: cx + sx / 2, minZ: cz - sz / 2, maxZ: cz + sz / 2 });

  // --- Image-based light from a warm interior HDRI ---
  const hdr = await new HDRLoader(manager).loadAsync(`${A}/hdri/fireplace_1k.hdr`);
  hdr.mapping = THREE.EquirectangularReflectionMapping;
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromEquirectangular(hdr).texture;
  scene.environmentIntensity = 0.35;
  hdr.dispose();
  scene.background = new THREE.Color('#1a1512');
  scene.fog = new THREE.Fog('#2a211b', 14, 34);

  // --- Materials ---
  const floorMat = pbr(tex, 'wood_floor', { repeat: 1, envMapIntensity: 0.6 });
  const wallMat = pbr(tex, 'beige_wall_001', { repeat: 1, color: new THREE.Color('#f1e6d6'), normalScale: 0.6 });
  const woodMat = pbr(tex, 'dark_wood', { repeat: 1, color: new THREE.Color('#9a7a5e'), envMapIntensity: 0.7 });
  const counterTop = pbr(tex, 'fine_grained_wood', { repeat: 1, envMapIntensity: 0.9 });
  const ceilingMat = new THREE.MeshStandardMaterial({ color: '#e9e2d6', roughness: 0.95 });
  const blackMetal = new THREE.MeshStandardMaterial({ color: '#1d1d1f', metalness: 0.7, roughness: 0.35 });
  const steel = new THREE.MeshStandardMaterial({ color: '#c9ccd0', metalness: 1, roughness: 0.22 });

  // --- Shell ---
  const floor = new THREE.Mesh(box(W, 0.1, D, 2.2), floorMat);
  floor.position.y = -0.05; floor.receiveShadow = true; scene.add(floor);
  const ceiling = new THREE.Mesh(box(W, 0.1, D, 3), ceilingMat);
  ceiling.position.y = H + 0.05; scene.add(ceiling);
  const wall = (w, h, x, y, z, ry = 0) => {
    const m = new THREE.Mesh(box(w, h, 0.2, 2.5), wallMat);
    m.position.set(x, y, z); m.rotation.y = ry; m.receiveShadow = true; m.castShadow = true; scene.add(m); return m;
  };
  wall(W, H, 0, H / 2, -D / 2 - 0.1);                       // back
  wall(D, H, -W / 2 - 0.1, H / 2, 0, Math.PI / 2);          // left
  wall(D, H, W / 2 + 0.1, H / 2, 0, Math.PI / 2);           // right
  // Front wall with two tall windows and a glass door in the middle.
  const fz = D / 2 + 0.1;
  const openings = [[-4.2, 3.2], [0, 1.6], [4.2, 3.2]]; // centre x, width
  const sill = 0.55, top = 2.9;
  let cursor = -W / 2;
  for (const [cx, w] of openings) {
    const left = cx - w / 2;
    if (left > cursor) wall(left - cursor, H, (cursor + left) / 2, H / 2, fz);
    const isDoor = w < 2;
    wall(w, H - top, cx, (H + top) / 2, fz);                       // header
    if (!isDoor) wall(w, sill, cx, sill / 2, fz);                  // sill wall
    cursor = cx + w / 2;
  }
  wall(W / 2 - cursor, H, (cursor + W / 2) / 2, H / 2, fz);
  // Glass + mullions; the "outside" is a bright, slightly warm glow.
  const outside = new THREE.MeshBasicMaterial({ color: new THREE.Color('#fff4df').multiplyScalar(2.2), toneMapped: true });
  for (const [cx, w] of openings) {
    const isDoor = w < 2, y0 = isDoor ? 0 : sill, hgt = top - y0;
    const pane = new THREE.Mesh(new THREE.PlaneGeometry(w, hgt), outside);
    pane.position.set(cx, y0 + hgt / 2, fz + 0.12); pane.rotation.y = Math.PI; scene.add(pane);
    const n = isDoor ? 1 : 3;
    for (let i = 0; i <= n; i++) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(0.05, hgt, 0.08), blackMetal);
      m.position.set(cx - w / 2 + (i * w) / n, y0 + hgt / 2, fz); m.castShadow = true; scene.add(m);
    }
    for (const yy of isDoor ? [y0 + hgt * 0.45] : [y0 + hgt * 0.66]) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.05, 0.08), blackMetal);
      m.position.set(cx, yy, fz); m.castShadow = true; scene.add(m);
    }
  }
  // skirting + crown trim
  for (const [w, x, z, ry] of [[W, 0, -D / 2 + 0.01, 0], [D, -W / 2 + 0.01, 0, Math.PI / 2], [D, W / 2 - 0.01, 0, Math.PI / 2]]) {
    const sk = new THREE.Mesh(box(w, 0.12, 0.03, 0.8), woodMat); sk.position.set(x, 0.06, z); sk.rotation.y = ry; scene.add(sk);
    const cr = new THREE.Mesh(box(w, 0.08, 0.05, 0.8), woodMat); cr.position.set(x, H - 0.04, z); cr.rotation.y = ry; scene.add(cr);
  }
  // ceiling beams
  for (let z = -D / 2 + 2; z < D / 2; z += 4) {
    const b = new THREE.Mesh(box(W, 0.22, 0.24, 0.8), woodMat); b.position.set(0, H - 0.11, z); b.castShadow = true; scene.add(b);
  }
  collide(0, -D / 2 - 0.1, W, 0.2); collide(-W / 2 - 0.1, 0, 0.2, D); collide(W / 2 + 0.1, 0, 0.2, D); collide(0, D / 2 + 0.1, W, 0.2);

  // --- Lighting ---
  scene.add(new THREE.HemisphereLight('#fff1dd', '#3a2a1e', 0.35));
  const sun = new THREE.DirectionalLight('#ffe7c2', 3.2);
  sun.position.set(-3.5, 7, D / 2 + 9); sun.target.position.set(1.2, 0, 2);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -9, right: 9, top: 11, bottom: -11, near: 1, far: 30 });
  sun.shadow.mapSize.set(2048, 2048); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03; sun.shadow.radius = 4;
  scene.add(sun, sun.target);

  // --- Atmosphere shelving: the shop's own antiquarian collection, behind glass ---
  // (decorative, not for browsing; the curated displays live in displays.js)
  const runs = [];
  const glassMat = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.92, roughness: 0.04, thickness: 0.01, ior: 1.45, envMapIntensity: 1.2 });
  const addUnit = (unit, x, z, ry) => {
    unit.group.position.set(x, 0, z); unit.group.rotation.y = ry; scene.add(unit.group);
    unit.group.updateMatrixWorld(true);
    const m = unit.group.matrixWorld, rot = new THREE.Matrix3().setFromMatrix4(m);
    for (const r of unit.runs) runs.push({ ...r, section: null, start: r.start.clone().applyMatrix4(m), dir: r.dir.clone().applyMatrix3(rot).normalize(), normal: r.normal.clone().applyMatrix3(rot).normalize() });
    const [fx, fz] = unit.footprint, c = Math.abs(Math.cos(ry)), s = Math.abs(Math.sin(ry));
    collide(x, z, fx * c + fz * s, fx * s + fz * c);
    // glass doors in front
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(fx - 0.06, 2.1), glassMat);
    glass.position.set(0, 1.12, unit.footprint[1] / 2 + 0.005); unit.group.add(glass);
    const frameMat = woodMat;
    for (const gx of [-(fx - 0.06) / 2, 0, (fx - 0.06) / 2]) { const f = new THREE.Mesh(box(0.035, 2.1, 0.03, 0.8), frameMat); f.position.set(gx, 1.12, unit.footprint[1] / 2 + 0.01); unit.group.add(f); }
  };
  addUnit(shelfUnit({ length: 3.6, wood: woodMat }), -W / 2 + 0.2, 2.4, Math.PI / 2);
  addUnit(shelfUnit({ length: 2.2, wood: woodMat }), 0, -D / 2 + 0.2, 0);

  // --- Café counter (front right) ---
  const cafe = new THREE.Group();
  const cx = 4.6, cz = 5.2, cw = 3.6, cd = 0.7;
  const body = new THREE.Mesh(box(cw, 1.0, cd, 0.8), woodMat); body.position.set(0, 0.5, 0); cafe.add(body);
  const topSlab = new THREE.Mesh(box(cw + 0.1, 0.05, cd + 0.12, 1.2), counterTop); topSlab.position.set(0, 1.025, 0); cafe.add(topSlab);
  // espresso machine
  const em = new THREE.Group();
  const emBody = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.42, 0.45), new THREE.MeshStandardMaterial({ color: '#7d1f1a', metalness: 0.6, roughness: 0.25 }));
  emBody.position.y = 0.21; em.add(emBody);
  const emTop = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.03, 0.47), steel); emTop.position.y = 0.435; em.add(emTop);
  for (const x of [-0.17, 0.17]) {
    const group = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.03, 0.06, 20), steel); group.position.set(x, 0.12, 0.25); em.add(group);
    const handle = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 0.16), blackMetal); handle.position.set(x, 0.1, 0.34); em.add(handle);
  }
  for (let i = 0; i < 5; i++) {
    const cup = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.028, 0.06, 16), new THREE.MeshStandardMaterial({ color: '#f4f1ea', roughness: 0.3 }));
    cup.position.set(-0.28 + i * 0.14, 0.48, -0.1); em.add(cup);
  }
  em.position.set(-0.8, 1.05, -0.05); em.rotation.y = Math.PI; cafe.add(em);
  // grinder + pastry case
  const grinder = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 0.35, 20), blackMetal); grinder.position.set(-0.1, 1.23, -0.1); cafe.add(grinder);
  const hopper = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.18, 20, 1, true), new THREE.MeshPhysicalMaterial({ color: '#3b2a1f', transmission: 0.6, roughness: 0.1, thickness: 0.02 }));
  hopper.position.set(-0.1, 1.5, -0.1); hopper.rotation.x = Math.PI; cafe.add(hopper);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.35, 0.5), new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 0.9, roughness: 0.05, thickness: 0.01, ior: 1.4 }));
  glass.position.set(0.9, 1.23, 0); cafe.add(glass);
  const pastryMat = new THREE.MeshStandardMaterial({ color: '#c98a3e', roughness: 0.7 });
  for (let i = 0; i < 6; i++) {
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8).scale(1.4, 0.6, 1), pastryMat);
    p.position.set(0.6 + (i % 3) * 0.28, 1.09, -0.1 + Math.floor(i / 3) * 0.22); cafe.add(p);
  }
  // chalk menu board on the wall behind
  const menu = canvasTexture(1024, 768, (g, w, h) => {
    g.fillStyle = '#1e2421'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#8b6a43'; g.lineWidth = 26; g.strokeRect(0, 0, w, h);
    g.fillStyle = '#f2efe6'; g.textAlign = 'center';
    g.font = 'italic 64px Georgia, serif'; g.fillText('the reading room café', w / 2, 120);
    g.font = '40px Georgia, serif'; g.textAlign = 'left';
    const items = [['Espresso', '3'], ['Flat white', '4.5'], ['Oat latte', '5'], ['Pour-over', '5'], ['Chai', '4.5'], ['Croissant', '3.5']];
    items.forEach(([n, p], i) => { g.fillText(n, 120, 230 + i * 78); g.textAlign = 'right'; g.fillText(p, w - 120, 230 + i * 78); g.textAlign = 'left'; });
  });
  const board = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.2), new THREE.MeshStandardMaterial({ map: menu, roughness: 0.9 }));
  board.position.set(W / 2 - 0.02 - cx, 2.0, 0); board.rotation.y = -Math.PI / 2; cafe.add(board);
  shadowy(cafe);
  cafe.position.set(cx, 0, cz); cafe.rotation.y = -Math.PI / 2; scene.add(cafe);
  collide(cx, cz, cd + 0.12, cw + 0.1);
  collide(W / 2 - 0.4, cz, 0.8, cw + 1); // behind-counter space is staff only

  // --- Furniture & lamps (glTF) ---
  const [lamp, plant, lounge, table, stool, clock] = await Promise.all(
    ['hanging_industrial_lamp', 'potted_plant_04', 'mid_century_lounge_chair', 'round_wooden_table_01', 'bar_chair_round_01', 'vintage_grandfather_clock_01'].map((n) => loadModel(gltf, n)));

  const lights = [];
  // over the two tables, the four display bays, the reading nook and the café
  const lampSpots = [[0, 4.0], [0, -3.0], [-3.3, -8.2], [3.3, -8.2], [-5.5, -3.5], [5.5, -3.5], [-4.2, 7.0], [3.6, 5.2]];
  for (const [x, z] of lampSpots) {
    const l = lamp.clone();
    l.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(l);
    l.position.set(x, H - b.max.y - 0.4, z);
    // the glTF lamp has no cable long enough for this ceiling: add one
    const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.42, 6), blackMetal);
    cable.position.set(x, H - 0.2, z);
    scene.add(l, cable);
    const bulbY = H - (b.max.y - b.min.y) - 0.4 + 0.06;
    const light = new THREE.PointLight('#ffc88a', 6.5, 0, 2);
    light.position.set(x, bulbY, z);
    scene.add(light); lights.push(light);
    const glow = new THREE.Mesh(new THREE.SphereGeometry(0.035, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffd9a8').multiplyScalar(4) }));
    glow.position.copy(light.position); scene.add(glow);
  }

  // Reading nook by the left window.
  scene.add(placeOnFloor(lounge, -5.0, 7.6, Math.PI * 0.85)); collide(-5.0, 7.6, 0.9, 0.9);
  scene.add(placeOnFloor(table, -3.7, 7.4)); collide(-3.7, 7.4, 0.8, 0.8);
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 2.4), new THREE.MeshStandardMaterial({
    map: canvasTexture(512, 360, (g, w, h) => {
      g.fillStyle = '#7a2e24'; g.fillRect(0, 0, w, h);
      g.strokeStyle = '#d9b77a'; g.lineWidth = 10; g.strokeRect(20, 20, w - 40, h - 40);
      g.strokeStyle = '#2e3e5c'; g.lineWidth = 6; g.strokeRect(44, 44, w - 88, h - 88);
      for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#d9b77a' : '#2e3e5c'; g.beginPath(); g.ellipse(w / 2, h / 2, 140 - i * 15, 90 - i * 10, 0, 0, Math.PI * 2); g.fill(); }
    }), roughness: 1 }));
  rug.rotation.x = -Math.PI / 2; rug.position.set(-4.4, 0.004, 7.3); rug.receiveShadow = true; scene.add(rug);
  // Stools at the café counter.
  for (const dz of [-1.1, 0, 1.1]) { const s = stool.clone(); scene.add(placeOnFloor(s, cx - 0.85, cz + dz, Math.random() * 6)); }
  collide(cx - 0.85, cz, 0.5, 2.8);
  // Plants by the door and the café; the clock on the left wall.
  for (const [x, z] of [[-1.6, 9.1], [1.6, 9.1], [6.2, 8.9], [-6.3, -9.2], [6.3, -9.2]]) { const p = plant.clone(); scene.add(placeOnFloor(p, x, z, Math.random() * 6)); collide(x, z, 0.6, 0.6); }
  scene.add(placeOnFloor(clock, -W / 2 + 0.35, 5.4, Math.PI / 2)); collide(-W / 2 + 0.35, 5.4, 0.6, 0.7);

  return { scene, runs, colliders, lights, sun, materials: { woodMat, counterTop, blackMetal, steel }, spawn: new THREE.Vector3(0, 0, 8.6) };
}
