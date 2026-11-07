// Little animated three.js models, one "kind" per project. Each builder returns
// { scene, camera, tick(t) } so a page can render many of them with one renderer.
import * as THREE from 'three';

const TAU = Math.PI * 2;
const col = (h, s = 0.65, l = 0.55) => new THREE.Color().setHSL(((h % 1) + 1) % 1, s, l);
const COPPER = new THREE.Color('#c87a48');
const PATINA = new THREE.Color('#4fb3a0');
const smooth = (x) => x * x * (3 - 2 * x);
const clamp01 = (x) => Math.min(1, Math.max(0, x));

function rng(seed) { // mulberry32
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const hashSeed = (s) => [...String(s)].reduce((h, c) => Math.imul(h ^ c.charCodeAt(0), 16777619), 2166136261);

function base(hue, env, camPos = [0, 0.6, 6.2]) {
  const scene = new THREE.Scene();
  if (env) { scene.environment = env; scene.environmentIntensity = 0.45; }
  scene.add(new THREE.HemisphereLight(0xdfe8ff, 0x1a1410, 0.55));
  const key = new THREE.DirectionalLight(0xfff0e0, 1.7);
  key.position.set(3, 4, 5);
  const rim = new THREE.DirectionalLight(col(hue, 0.7, 0.6), 1.6);
  rim.position.set(-4, -2, -3);
  scene.add(key, rim);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(...camPos);
  camera.lookAt(0, 0, 0);
  const group = new THREE.Group();
  scene.add(group);
  return { scene, camera, group };
}

const metal = (color, roughness = 0.3) => new THREE.MeshStandardMaterial({ color, metalness: 0.9, roughness, envMapIntensity: 2.2 });
const matte = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, metalness: 0.1, roughness: 0.6, ...extra });
// Unlit, so per-instance colours show at full brightness (emissive would override them).
const bright = () => new THREE.MeshBasicMaterial({ color: 0xffffff });
const glow = (color, intensity = 1.2) => new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: intensity, roughness: 0.4 });

function instanced(geo, mat, n) {
  const m = new THREE.InstancedMesh(geo, mat, n);
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  for (let i = 0; i < n; i++) m.setColorAt(i, new THREE.Color(1, 1, 1));
  return m;
}

const dummy = new THREE.Object3D();
function place(mesh, i, x, y, z, s = 1, sy = s, sz = s, rx = 0, ry = 0, rz = 0) {
  dummy.position.set(x, y, z);
  dummy.scale.set(s, sy, sz);
  dummy.rotation.set(rx, ry, rz);
  dummy.updateMatrix();
  mesh.setMatrixAt(i, dummy.matrix);
}

// ---------------------------------------------------------------------------
const KINDS = {
  // A living copper blob with patina moons (this website).
  specimen({ hue, env }) {
    const { scene, camera, group } = base(hue, env);
    const geo = new THREE.IcosahedronGeometry(1.3, 6);
    const p = geo.attributes.position, orig = p.array.slice();
    const blob = new THREE.Mesh(geo, metal(COPPER, 0.28));
    const moons = Array.from({ length: 5 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.12 + 0.04 * (i % 3), 20, 16), matte(PATINA, { roughness: 0.8 }));
      group.add(m);
      return m;
    });
    group.add(blob);
    return { scene, camera, tick(t) {
      for (let i = 0; i < p.count; i++) {
        const x = orig[i * 3], y = orig[i * 3 + 1], z = orig[i * 3 + 2];
        const n = Math.sin(2.6 * x + t) + Math.sin(2.9 * y + 1.3 * t) + Math.sin(2.4 * z + 0.7 * t);
        const r = 1 + 0.06 * n;
        p.setXYZ(i, x * r, y * r, z * r);
      }
      p.needsUpdate = true;
      geo.computeVertexNormals();
      blob.rotation.y = t * 0.2;
      moons.forEach((m, i) => {
        const a = t * (0.5 + i * 0.12) + i * 1.3, r = 1.9 + 0.15 * i;
        m.position.set(Math.cos(a) * r, Math.sin(a * 0.7 + i) * 0.6, Math.sin(a) * r);
      });
    } };
  },

  // A manuscript flipping its own pages under a copper nugget.
  manuscript({ hue, env }) {
    const { scene, camera, group } = base(hue, env, [0, 3.2, 4.6]);
    const canvas = Object.assign(document.createElement('canvas'), { width: 128, height: 96 });
    const g = canvas.getContext('2d');
    g.fillStyle = '#efe9df'; g.fillRect(0, 0, 128, 96);
    g.fillStyle = '#9b948a';
    for (let y = 10; y < 90; y += 8) g.fillRect(10, y, 40 + ((y * 37) % 60), 3);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pageGeo = new THREE.BoxGeometry(1.6, 0.012, 1.15).translate(0.8, 0, 0);
    const pageMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 });
    const N = 16;
    const pages = Array.from({ length: N }, () => {
      const pivot = new THREE.Group();
      pivot.add(new THREE.Mesh(pageGeo, pageMat));
      group.add(pivot);
      return pivot;
    });
    const nugget = new THREE.Mesh(new THREE.DodecahedronGeometry(0.38, 0), metal(COPPER, 0.35));
    group.add(nugget);
    const spine = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.2, 1.2), matte(col(hue, 0.5, 0.35)));
    group.add(spine);
    group.position.y = -0.4;
    return { scene, camera, tick(t) {
      const phase = (t * 0.9) % (N + 4);
      pages.forEach((pv, i) => {
        const f = smooth(clamp01(phase - i));
        const right = 0.06 + i * 0.006, left = Math.PI - 0.06 - (N - i) * 0.006;
        pv.rotation.z = right + (left - right) * f;
        pv.position.y = 0.002 * i;
      });
      nugget.position.set(0, 1.2 + 0.12 * Math.sin(t * 1.5), 0);
      nugget.rotation.set(t * 0.4, t * 0.7, 0);
      group.rotation.y = Math.sin(t * 0.2) * 0.4;
    } };
  },

  // A branching tree with reads flying in and landing on leaves.
  tree({ hue, env, seed }) {
    const { scene, camera, group } = base(hue, env, [0, 0.4, 6.8]);
    const r = rng(seed);
    const pts = [], leaves = [];
    const grow = (o, dir, depth, len) => {
      const end = o.clone().addScaledVector(dir, len);
      pts.push(o, end);
      if (depth === 0) { leaves.push(end); return; }
      const kids = depth > 3 ? 2 : 2 + (r() < 0.4 ? 1 : 0);
      for (let k = 0; k < kids; k++) {
        const d = dir.clone().applyAxisAngle(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize(), 0.45 + r() * 0.5);
        grow(end, d.normalize(), depth - 1, len * (0.68 + r() * 0.15));
      }
    };
    grow(new THREE.Vector3(0, -2.2, 0), new THREE.Vector3(0, 1, 0), 6, 1.0);
    const lines = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts),
      new THREE.LineBasicMaterial({ color: col(hue, 0.35, 0.7), transparent: true, opacity: 0.75 }));
    const leafMesh = instanced(new THREE.SphereGeometry(0.06, 10, 8), bright(), leaves.length);
    leaves.forEach((l, i) => place(leafMesh, i, l.x, l.y, l.z));
    const hits = new Float32Array(leaves.length).fill(-9);
    const R = 36;
    const reads = instanced(new THREE.SphereGeometry(0.045, 8, 6), glow(COPPER, 2), R);
    const rd = Array.from({ length: R }, () => {
      const a = r() * TAU, b = Math.acos(2 * r() - 1);
      return { from: new THREE.Vector3(Math.sin(b) * Math.cos(a), Math.cos(b), Math.sin(b) * Math.sin(a)).multiplyScalar(4.5),
        leaf: Math.floor(r() * leaves.length), off: r(), speed: 0.12 + r() * 0.1, last: -1 };
    });
    group.add(lines, leafMesh, reads);
    const v = new THREE.Vector3(), c = new THREE.Color();
    return { scene, camera, tick(t) {
      rd.forEach((d, i) => {
        const cyc = t * d.speed + d.off, p = cyc % 1, n = Math.floor(cyc);
        if (n !== d.last) { if (d.last >= 0) hits[d.leaf] = t; d.last = n; d.leaf = (d.leaf * 7 + 13 + i) % leaves.length; }
        v.lerpVectors(d.from, leaves[d.leaf], smooth(p));
        place(reads, i, v.x, v.y, v.z, p > 0.97 ? 0 : 1);
      });
      reads.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < leaves.length; i++) {
        const h = Math.exp(-(t - hits[i]) * 2);
        leafMesh.setColorAt(i, c.copy(PATINA).lerp(COPPER, h).multiplyScalar(0.75 + 0.6 * h));
      }
      leafMesh.instanceColor.needsUpdate = true;
      group.rotation.y = t * 0.15;
    } };
  },

  // A grid of reference packages: most built and glowing, a few still dark.
  packages({ hue, env, facts }) {
    const { scene, camera, group } = base(hue, env, [0, 5.6, 6.8]);
    const total = Number(findFact(facts, /packages/i)) || 71, usable = Number(findFact(facts, /usable/i)) || 63;
    const cols = Math.ceil(Math.sqrt(total * 1.15)), rows = Math.ceil(total / cols);
    const mesh = instanced(new THREE.BoxGeometry(0.42, 0.42, 0.42), new THREE.MeshStandardMaterial({ metalness: 0.25, roughness: 0.5, envMapIntensity: 0.3 }), total);
    const lit = COPPER.clone(), dark = new THREE.Color('#2c3436');
    const r = rng(7), order = [...Array(total).keys()].sort(() => r() - 0.5);
    const isLit = new Set(order.slice(0, usable));
    for (let i = 0; i < total; i++) mesh.setColorAt(i, isLit.has(i) ? lit : dark);
    group.add(mesh);
    return { scene, camera, tick(t) {
      const building = Math.floor(t * 1.4) % total;
      for (let i = 0; i < total; i++) {
        const x = (i % cols - (cols - 1) / 2) * 0.58, z = (Math.floor(i / cols) - (rows - 1) / 2) * 0.58;
        const y = 0.16 * Math.sin(t * 2 + x * 0.9 + z * 0.7);
        const s = i === building ? 1 + 0.35 * Math.sin((t * 1.4 % 1) * Math.PI) : 1;
        place(mesh, i, x, y, z, s, s, s, 0, t * 0.3 * (isLit.has(i) ? 1 : 0), 0);
      }
      mesh.instanceMatrix.needsUpdate = true;
      group.rotation.y = Math.sin(t * 0.25) * 0.5;
    } };
  },

  // Pipeline modules: stacked rings with data flowing up through them.
  modules({ hue, env }) {
    const { scene, camera, group } = base(hue, env, [0, 1.2, 6.4]);
    const rings = Array.from({ length: 5 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1.0 + 0.18 * Math.sin(i * 1.7), 0.09, 16, 80), metal(col(hue + i * 0.05, 0.6, 0.5), 0.35));
      m.position.y = -1.6 + i * 0.8;
      group.add(m);
      return m;
    });
    const N = 140;
    const flow = instanced(new THREE.SphereGeometry(0.04, 8, 6), glow(COPPER, 2), N);
    group.add(flow);
    const core = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 4, 12), glow(col(hue, 0.5, 0.6), 0.6));
    group.add(core);
    return { scene, camera, tick(t) {
      rings.forEach((m, i) => { m.rotation.x = Math.PI / 2 + Math.sin(t * 0.6 + i) * 0.25; m.rotation.y = t * (0.3 + i * 0.15) * (i % 2 ? -1 : 1); });
      for (let i = 0; i < N; i++) {
        const p = (t * 0.18 + i / N) % 1, a = i * 2.399 + t * 0.8, r = 0.25 + 0.55 * Math.abs(Math.sin(p * Math.PI * 5));
        place(flow, i, Math.cos(a) * r, -2 + p * 4, Math.sin(a) * r, 1 - Math.abs(p - 0.5));
      }
      flow.instanceMatrix.needsUpdate = true;
      group.rotation.y = t * 0.1;
    } };
  },

  // A city of sequencing runs; a scan line sweeps across looking for copper.
  bars({ hue, env, facts, seed }) {
    const { scene, camera, group } = base(hue, env, [3.6, 3.6, 4.6]);
    const n = Math.min(900, Number(String(findFact(facts, /runs/i) || '816').replace(/,/g, '')) || 816);
    const side = Math.ceil(Math.sqrt(n)), r = rng(seed);
    const mesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0.3 }), n);
    const hs = [], xs = [], zs = [], hot = [];
    for (let i = 0; i < n; i++) {
      const x = (i % side - side / 2) * 0.14, z = (Math.floor(i / side) - side / 2) * 0.14;
      const h = 0.05 + Math.exp((r() + r() + r() - 1.5) * 1.6) * 0.25;
      hs.push(h); xs.push(x); zs.push(z); hot.push(r() < 0.05);
      place(mesh, i, x, h / 2 - 0.8, z, 0.11, h, 0.11);
    }
    group.add(mesh);
    const c = new THREE.Color(), cool = col(hue + 0.45, 0.35, 0.35);
    return { scene, camera, tick(t) {
      const scan = ((t * 0.35) % 1) * side * 0.14 * 1.3 - side * 0.14 * 0.65;
      for (let i = 0; i < n; i++) {
        const near = Math.exp(-((xs[i] - scan) ** 2) * 40);
        c.copy(hot[i] ? COPPER : cool).multiplyScalar(0.7 + (hot[i] ? 1.6 : 0.8) * near);
        mesh.setColorAt(i, c);
      }
      mesh.instanceColor.needsUpdate = true;
      group.rotation.y = Math.sin(t * 0.2) * 0.3;
    } };
  },

  // A response surface over two axes (pH x copper) that keeps re-fitting itself.
  surface({ hue, env }) {
    const { scene, camera, group } = base(hue, env, [4.8, 4.2, 6.2]);
    const geo = new THREE.PlaneGeometry(4, 4, 64, 64).rotateX(-Math.PI / 2);
    const p = geo.attributes.position;
    geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(p.count * 3), 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.8, metalness: 0.0, envMapIntensity: 0.15 }));
    const axis = (len, rx, rz, pos) => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, len, 6), matte(0x8a9496)); a.rotation.set(rx, 0, rz); a.position.set(...pos); group.add(a); };
    axis(4, 0, Math.PI / 2, [0, -0.6, 2]); axis(4, Math.PI / 2, 0, [-2, -0.6, 0]); axis(2.2, 0, 0, [-2, 0.5, 2]);
    group.add(mesh);
    const lo = col(hue + 0.52, 0.55, 0.32), hi = COPPER.clone(), top = new THREE.Color('#f2b27a'), c = new THREE.Color();
    group.position.y = -0.3;
    return { scene, camera, tick(t) {
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), z = p.getZ(i);
        const ridge = Math.exp(-((x - 0.9 * Math.sin(t * 0.3)) ** 2 + (z + 0.6) ** 2) * 0.6);
        const y = 0.9 * ridge * (1 + 0.25 * Math.sin(t)) + 0.18 * Math.sin(1.4 * x + t * 0.8) * Math.cos(1.2 * z - t * 0.5) - 0.5;
        p.setY(i, y);
        const k = clamp01((y + 0.7) / 1.6);
        c.copy(lo).lerp(hi, smooth(clamp01(k * 1.3))).lerp(top, clamp01(k * 3 - 2));
        geo.attributes.color.setXYZ(i, c.r, c.g, c.b);
      }
      p.needsUpdate = true; geo.attributes.color.needsUpdate = true;
      geo.computeVertexNormals();
      group.rotation.y = t * 0.12;
    } };
  },

  // A metal active site turning formate into CO2 bubbles.
  molecule({ hue, env }) {
    const { scene, camera, group } = base(hue, env, [0, 0.8, 5.4]);
    const atom = (r, color, m = matte) => new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m(color));
    const stick = (a, b) => {
      const d = b.clone().sub(a), m = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, d.length(), 8), matte(0xb8c0c2));
      m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
      return m;
    };
    const site = new THREE.Group();
    const metalAtom = atom(0.42, col(hue, 0.25, 0.7), (c) => metal(c, 0.25));
    site.add(metalAtom);
    [[1, 1, 1], [-1, -1, 1], [-1, 1, -1], [1, -1, -1]].forEach((v) => {
      const pos = new THREE.Vector3(...v).normalize().multiplyScalar(1.0);
      site.add(atom(0.22, 0xe8c547), stick(new THREE.Vector3(), pos));
      site.children.at(-2).position.copy(pos);
    });
    group.add(site);
    const mol = () => {
      const g = new THREE.Group(), C = atom(0.14, 0x3a3f41), O1 = atom(0.13, 0xd8533f), O2 = atom(0.13, 0xd8533f), H = atom(0.08, 0xf2f2f2);
      O1.position.set(0.24, 0.1, 0); O2.position.set(-0.24, 0.1, 0); H.position.set(0, -0.2, 0);
      g.add(C, O1, O2, H);
      g.userData = { H, O1, O2 };
      group.add(g);
      return g;
    };
    const mols = Array.from({ length: 5 }, mol);
    return { scene, camera, tick(t) {
      mols.forEach((g, i) => {
        const p = (t * 0.12 + i / mols.length) % 1, a = i * 1.26 + t * 0.6;
        const { H, O1, O2 } = g.userData;
        if (p < 0.55) { // spiral in
          const r = 2.6 - 1.2 * smooth(p / 0.55);
          g.position.set(Math.cos(a) * r, Math.sin(a * 0.8) * 0.8, Math.sin(a) * r);
          H.visible = true; O1.position.set(0.24, 0.1, 0); O2.position.set(-0.24, 0.1, 0);
        } else { // released as linear CO2 and floats away
          const q = (p - 0.55) / 0.45;
          H.visible = false; O1.position.set(0.28, 0, 0); O2.position.set(-0.28, 0, 0);
          g.position.set(Math.cos(a) * (1.4 + q), 0.8 + q * 2.4, Math.sin(a) * (1.4 + q));
        }
        g.scale.setScalar(p > 0.92 ? (1 - p) / 0.08 : 1);
        g.rotation.set(t + i, t * 0.7, 0);
      });
      site.rotation.y = t * 0.3;
      metalAtom.scale.setScalar(1 + 0.04 * Math.sin(t * 3));
    } };
  },

  // Low-poly terrain with sample pins; copper sites pulse.
  map({ hue, env, seed }) {
    const { scene, camera, group } = base(hue, env, [0, 4.2, 4.6]);
    const r = rng(seed), geo = new THREE.PlaneGeometry(5.4, 3.8, 70, 50).rotateX(-Math.PI / 2), p = geo.attributes.position;
    const height = (x, z) => 0.35 * Math.sin(x * 1.3 + 1) * Math.cos(z * 1.7) + 0.2 * Math.sin(x * 3.1 + z * 2.3) + 0.12 * Math.cos(z * 4.2 - x);
    const colors = new Float32Array(p.count * 3), c = new THREE.Color();
    for (let i = 0; i < p.count; i++) {
      const y = height(p.getX(i), p.getZ(i)); p.setY(i, y);
      c.set(y < -0.12 ? '#2b5a6b' : y < 0.15 ? '#3f6b4a' : y < 0.35 ? '#6b5a43' : '#d9d4c7');
      colors.set([c.r, c.g, c.b], i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    group.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 })));
    const water = new THREE.Mesh(new THREE.PlaneGeometry(5.4, 3.8).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a6f8f', transparent: true, opacity: 0.45, roughness: 0.2 }));
    water.position.y = -0.12;
    group.add(water);
    const pins = Array.from({ length: 30 }, (_, i) => {
      const x = (r() - 0.5) * 4.8, z = (r() - 0.5) * 3.2, cu = i < 7;
      const pin = new THREE.Group();
      const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, cu ? 0.7 : 0.4, 6), matte(0xdddddd));
      stem.position.y = (cu ? 0.7 : 0.4) / 2;
      const head = new THREE.Mesh(new THREE.SphereGeometry(cu ? 0.09 : 0.06, 14, 10), cu ? glow(COPPER, 1.2) : glow(PATINA, 0.5));
      head.position.y = cu ? 0.7 : 0.4;
      pin.add(stem, head);
      pin.position.set(x, Math.max(height(x, z), -0.12), z);
      pin.userData = { head, cu, off: r() * TAU };
      group.add(pin);
      return pin;
    });
    return { scene, camera, tick(t) {
      pins.forEach((pin) => {
        const { head, cu, off } = pin.userData;
        head.material.emissiveIntensity = cu ? 1 + 1.5 * (0.5 + 0.5 * Math.sin(t * 3 + off)) : 0.5;
        pin.scale.y = 1 + 0.08 * Math.sin(t * 2 + off);
      });
      group.rotation.y = Math.sin(t * 0.2) * 0.35;
    } };
  },

  // A double helix with a highlighted gene sliding along it.
  dna({ hue, env }) {
    const { scene, camera, group } = base(hue, env, [0, 0, 6.2]);
    const N = 44, beads = instanced(new THREE.SphereGeometry(0.11, 14, 10), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.2 }), N * 2);
    const rungs = instanced(new THREE.CylinderGeometry(0.035, 0.035, 1, 8), new THREE.MeshStandardMaterial({ roughness: 0.5 }), N);
    const a = col(hue, 0.6, 0.55), b = col(hue + 0.12, 0.6, 0.55), hl = COPPER.clone().multiplyScalar(1.8), dim = new THREE.Color('#5d6668');
    for (let i = 0; i < N; i++) {
      const y = (i - N / 2) * 0.11, ang = i * 0.42;
      const x1 = Math.cos(ang) * 0.75, z1 = Math.sin(ang) * 0.75;
      place(beads, i * 2, x1, y, z1); place(beads, i * 2 + 1, -x1, y, -z1);
      beads.setColorAt(i * 2, a); beads.setColorAt(i * 2 + 1, b);
      dummy.position.set(0, y, 0); dummy.scale.set(1, 1.5, 1); dummy.rotation.set(0, -ang, Math.PI / 2); dummy.updateMatrix();
      rungs.setMatrixAt(i, dummy.matrix);
    }
    group.add(beads, rungs);
    group.rotation.z = 0.35;
    const c = new THREE.Color();
    return { scene, camera, tick(t) {
      const center = ((t * 4) % (N + 16)) - 8;
      for (let i = 0; i < N; i++) {
        const w = Math.exp(-((i - center) ** 2) / 18);
        rungs.setColorAt(i, c.copy(dim).lerp(hl, w));
      }
      rungs.instanceColor.needsUpdate = true;
      group.rotation.y = t * 0.5;
    } };
  },

  // A spiral galaxy of gene trees, coloured by how much signal each carries.
  galaxy({ hue, seed }) {
    const { scene, camera, group } = base(hue, null, [0, 3.2, 5.2]);
    const r = rng(seed), N = 18000, pos = new Float32Array(N * 3), colors = new Float32Array(N * 3);
    const inner = COPPER.clone(), outer = col(hue, 0.7, 0.55), c = new THREE.Color();
    for (let i = 0; i < N; i++) {
      const rad = Math.pow(r(), 1.6) * 3, arm = (i % 4) / 4 * TAU, spin = rad * 1.3;
      const spread = () => Math.pow(r(), 3) * (r() < 0.5 ? 1 : -1) * 0.35 * (0.3 + rad / 3);
      pos.set([Math.cos(arm + spin) * rad + spread(), spread() * 0.6, Math.sin(arm + spin) * rad + spread()], i * 3);
      c.copy(inner).lerp(outer, rad / 3).multiplyScalar(0.5 + r() * 0.9);
      colors.set([c.r, c.g, c.b], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    group.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.03, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })));
    const coreGlow = new THREE.Mesh(new THREE.SphereGeometry(0.18, 20, 16), glow(COPPER, 2.5));
    group.add(coreGlow);
    group.rotation.x = 0.25;
    return { scene, camera, tick(t) { group.rotation.y = t * 0.12; coreGlow.scale.setScalar(1 + 0.15 * Math.sin(t * 2)); } };
  },

  // Two point clouds on the same twisted ribbon, drifting in and out of agreement.
  embedding({ hue, seed }) {
    const { scene, camera, group } = base(hue, null, [0, 0.6, 6]);
    const r = rng(seed), N = 1400, K = 90;
    const ribbon = (u, v) => new THREE.Vector3((1.6 + v * 0.5) * Math.cos(u), (u - Math.PI * 1.5) * 0.35, (1.6 + v * 0.5) * Math.sin(u)).applyAxisAngle(new THREE.Vector3(1, 0, 0), 0.3);
    const A = [], noise = [];
    for (let i = 0; i < N; i++) { A.push(ribbon(r() * Math.PI * 3, r() * 2 - 1)); noise.push(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).multiplyScalar(1.6)); }
    const cloud = (color) => {
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
      const p = new THREE.Points(g, new THREE.PointsMaterial({ size: 0.045, color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
      group.add(p); return g;
    };
    const ga = cloud(col(hue, 0.7, 0.6)), gb = cloud(COPPER);
    A.forEach((v, i) => ga.attributes.position.setXYZ(i, v.x, v.y, v.z));
    const lineGeo = new THREE.BufferGeometry(); lineGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(K * 6), 3));
    const lineMat = new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 });
    group.add(new THREE.LineSegments(lineGeo, lineMat));
    const v = new THREE.Vector3();
    return { scene, camera, tick(t) {
      const agree = 0.5 + 0.5 * Math.sin(t * 0.5);
      const pb = gb.attributes.position, pl = lineGeo.attributes.position;
      for (let i = 0; i < N; i++) {
        v.copy(A[i]).addScaledVector(noise[i], 1 - agree);
        pb.setXYZ(i, v.x, v.y + (1 - agree) * 0.6, v.z);
        if (i < K) { pl.setXYZ(i * 2, A[i].x, A[i].y, A[i].z); pl.setXYZ(i * 2 + 1, v.x, v.y + (1 - agree) * 0.6, v.z); }
      }
      pb.needsUpdate = true; pl.needsUpdate = true;
      lineMat.opacity = 0.1 + 0.4 * agree;
      group.rotation.y = t * 0.15;
    } };
  },

  // A four-helix bundle that pulls apart and fills the gap with new copper sites.
  helix({ hue, env }) {
    const { scene, camera, group } = base(hue, env, [0, 0.3, 7.2]);
    const tube = (cx, cz, y0, y1, phase) => {
      const pts = [];
      for (let i = 0; i <= 80; i++) { const f = i / 80, y = y0 + (y1 - y0) * f, a = phase + y * 9; pts.push(new THREE.Vector3(cx + Math.cos(a) * 0.17, y, cz + Math.sin(a) * 0.17)); }
      return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 160, 0.07, 8, false);
    };
    const corners = [[0.5, 0.5], [-0.5, 0.5], [-0.5, -0.5], [0.5, -0.5]];
    const hmat = new THREE.MeshStandardMaterial({ color: col(hue + 0.5, 0.45, 0.55), roughness: 0.45, metalness: 0.1 });
    const newMat = new THREE.MeshStandardMaterial({ color: col(hue + 0.55, 0.7, 0.62), roughness: 0.4, transparent: true, opacity: 0 });
    const top = new THREE.Group(), bottom = new THREE.Group(), middle = new THREE.Group();
    corners.forEach(([x, z], i) => {
      top.add(new THREE.Mesh(tube(x, z, 0, 1.6, i), hmat));
      bottom.add(new THREE.Mesh(tube(x, z, -1.6, 0, i), hmat));
      middle.add(new THREE.Mesh(tube(x, z, -0.55, 0.55, i + 1), newMat));
    });
    const ion = new THREE.SphereGeometry(0.075, 12, 10), ionMat = glow(COPPER, 1.6);
    const addIons = (g, y0, y1, n) => { for (let i = 0; i < n; i++) { const m = new THREE.Mesh(ion, ionMat); const a = i * 1.9; m.position.set(Math.cos(a) * 0.16, y0 + (y1 - y0) * (i + 0.5) / n, Math.sin(a) * 0.16); g.add(m); } };
    addIons(top, 0.1, 1.5, 10); addIons(bottom, -1.5, -0.1, 10); addIons(middle, -0.5, 0.5, 8);
    group.add(top, bottom, middle);
    return { scene, camera, tick(t) {
      const open = smooth(clamp01(0.5 - 0.5 * Math.cos(t * 0.6)) );
      top.position.y = 0.6 * open; bottom.position.y = -0.6 * open;
      middle.scale.set(1, Math.max(0.001, open), 1);
      newMat.opacity = open;
      middle.children.forEach((m) => { if (m.geometry === ion) m.visible = open > 0.3; });
      group.rotation.y = t * 0.35;
      group.rotation.z = 0.25;
    } };
  },

  // A small network with signals firing along its links.
  brain({ hue, env, seed }) {
    const { scene, camera, group } = base(hue, env, [0, 0.4, 5.6]);
    const r = rng(seed), N = 80, nodes = [];
    for (let i = 0; i < N; i++) {
      const side = i % 2 ? 1 : -1, u = r() * TAU, v = Math.acos(2 * r() - 1);
      nodes.push(new THREE.Vector3(Math.sin(v) * Math.cos(u) * 1.0 + side * 0.55, Math.cos(v) * 1.1, Math.sin(v) * Math.sin(u) * 1.5));
    }
    const edges = [];
    nodes.forEach((a, i) => nodes.map((b, j) => [j, a.distanceTo(b)]).filter(([j]) => j !== i).sort((x, y) => x[1] - y[1]).slice(0, 3).forEach(([j]) => edges.push([i, j])));
    const lineGeo = new THREE.BufferGeometry().setFromPoints(edges.flatMap(([i, j]) => [nodes[i], nodes[j]]));
    group.add(new THREE.LineSegments(lineGeo, new THREE.LineBasicMaterial({ color: col(hue, 0.4, 0.6), transparent: true, opacity: 0.35 })));
    const nodeMesh = instanced(new THREE.SphereGeometry(0.06, 10, 8), bright(), N);
    nodes.forEach((p, i) => place(nodeMesh, i, p.x, p.y, p.z));
    const P = 28, pulses = instanced(new THREE.SphereGeometry(0.045, 8, 6), glow(COPPER, 2.5), P);
    const pul = Array.from({ length: P }, () => ({ e: Math.floor(r() * edges.length), p: r(), sp: 0.5 + r() }));
    const fired = new Float32Array(N).fill(-9);
    group.add(nodeMesh, pulses);
    const v = new THREE.Vector3(), c = new THREE.Color(), base0 = col(hue, 0.55, 0.6);
    let last = 0;
    return { scene, camera, tick(t) {
      const dt = Math.min(0.05, Math.max(0, t - last)); last = t;
      pul.forEach((q, k) => {
        q.p += dt * q.sp;
        if (q.p >= 1) { const end = edges[q.e][1]; fired[end] = t; const next = edges.map((e, idx) => [e, idx]).filter(([e]) => e[0] === end); q.e = next.length ? next[Math.floor(r() * next.length)][1] : Math.floor(r() * edges.length); q.p = 0; }
        const [i, j] = edges[q.e];
        v.lerpVectors(nodes[i], nodes[j], q.p);
        place(pulses, k, v.x, v.y, v.z);
      });
      pulses.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < N; i++) nodeMesh.setColorAt(i, c.copy(base0).lerp(COPPER, Math.exp(-(t - fired[i]) * 3)).multiplyScalar(1 + 0.5 * Math.exp(-(t - fired[i]) * 3)));
      nodeMesh.instanceColor.needsUpdate = true;
      group.rotation.y = t * 0.2;
    } };
  },

  // A polymer chain that microbes break apart, which then reassembles.
  decay({ hue, env, seed }) {
    const { scene, camera, group } = base(hue, env, [0, 0.6, 6]);
    const r = rng(seed), N = 40, home = [], dir = [], frag = [];
    const breaks = new Set([6, 13, 19, 26, 33]);
    let f = 0;
    for (let i = 0; i < N; i++) {
      if (breaks.has(i)) f++;
      frag.push(f);
      const u = i / (N - 1) * Math.PI * 2.2;
      home.push(new THREE.Vector3((i / (N - 1) - 0.5) * 4.2, Math.sin(u) * 0.5, Math.cos(u * 0.7) * 0.4));
    }
    for (let k = 0; k <= f; k++) dir.push(new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize());
    const beads = instanced(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshStandardMaterial({ color: col(hue, 0.55, 0.6), roughness: 0.35, metalness: 0.2 }), N);
    const bonds = instanced(new THREE.CylinderGeometry(0.04, 0.04, 1, 6), matte(0xc9c2b8), N - 1);
    const microbes = Array.from({ length: 5 }, (_, i) => {
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(0.08, 0.22, 6, 10), matte(i % 2 ? PATINA : col(hue + 0.3, 0.5, 0.55)));
      group.add(m); return m;
    });
    group.add(beads, bonds);
    const pts = home.map((h) => h.clone()), up = new THREE.Vector3(0, 1, 0), d = new THREE.Vector3();
    return { scene, camera, tick(t) {
      const cyc = (t / 9) % 1;
      const apart = cyc < 0.3 ? 0 : cyc < 0.65 ? smooth((cyc - 0.3) / 0.35) : cyc < 0.8 ? 1 : 1 - smooth((cyc - 0.8) / 0.2);
      for (let i = 0; i < N; i++) {
        pts[i].copy(home[i]).addScaledVector(dir[frag[i]], apart * 1.1);
        pts[i].y += 0.08 * Math.sin(t * 2 + i * 0.5);
        place(beads, i, pts[i].x, pts[i].y, pts[i].z, 1 - 0.35 * apart);
      }
      for (let i = 0; i < N - 1; i++) {
        d.subVectors(pts[i + 1], pts[i]);
        const broken = frag[i] !== frag[i + 1] && apart > 0.05;
        dummy.position.copy(pts[i]).addScaledVector(d, 0.5);
        dummy.quaternion.setFromUnitVectors(up, d.clone().normalize());
        dummy.scale.set(1, broken ? 0 : d.length(), 1);
        dummy.updateMatrix(); bonds.setMatrixAt(i, dummy.matrix);
      }
      beads.instanceMatrix.needsUpdate = true; bonds.instanceMatrix.needsUpdate = true;
      microbes.forEach((m, i) => {
        const a = t * (0.4 + i * 0.07) + i * 1.3;
        m.position.set(Math.cos(a) * (1.4 + 0.3 * i) , Math.sin(a * 1.3) * 0.9, Math.sin(a) * 1.2);
        m.rotation.set(a, a * 0.5, 0);
      });
      group.rotation.y = Math.sin(t * 0.2) * 0.4;
    } };
  },

  // A globe with spacers lofting into the air and landing far away.
  globe({ hue, env, seed }) {
    const { scene, camera, group } = base(hue, env, [0, 0.8, 5.6]);
    const R = 1.45, r = rng(seed);
    group.add(new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), new THREE.MeshStandardMaterial({ color: '#1d3a4f', roughness: 0.7, metalness: 0.1 })));
    const grid = [];
    for (let lat = -60; lat <= 60; lat += 30) for (let i = 0; i < 64; i++) {
      const a = (i / 64) * TAU, b = ((i + 1) / 64) * TAU, la = (lat * Math.PI) / 180;
      grid.push(new THREE.Vector3(Math.cos(la) * Math.cos(a), Math.sin(la), Math.cos(la) * Math.sin(a)).multiplyScalar(R * 1.002),
        new THREE.Vector3(Math.cos(la) * Math.cos(b), Math.sin(la), Math.cos(la) * Math.sin(b)).multiplyScalar(R * 1.002));
    }
    for (let k = 0; k < 8; k++) for (let i = 0; i < 48; i++) {
      const lon = (k / 8) * Math.PI, a = (i / 48) * TAU, b = ((i + 1) / 48) * TAU;
      grid.push(new THREE.Vector3(Math.cos(a) * Math.cos(lon), Math.sin(a), Math.cos(a) * Math.sin(lon)).multiplyScalar(R * 1.002),
        new THREE.Vector3(Math.cos(b) * Math.cos(lon), Math.sin(b), Math.cos(b) * Math.sin(lon)).multiplyScalar(R * 1.002));
    }
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(grid), new THREE.LineBasicMaterial({ color: col(hue, 0.4, 0.6), transparent: true, opacity: 0.25 })));
    const sp = () => new THREE.Vector3(r() - 0.5, r() - 0.5, r() - 0.5).normalize();
    const N = 90, flights = Array.from({ length: N }, () => ({ a: sp(), b: sp(), off: r(), sp: 0.08 + r() * 0.08 }));
    const dots = instanced(new THREE.SphereGeometry(0.035, 8, 6), glow(COPPER, 2.2), N);
    group.add(dots);
    const q = new THREE.Vector3();
    return { scene, camera, tick(t) {
      flights.forEach((f, i) => {
        const p = (t * f.sp + f.off) % 1;
        q.copy(f.a).lerp(f.b, p).normalize().multiplyScalar(R * (1.02 + 0.55 * Math.sin(Math.PI * p)));
        place(dots, i, q.x, q.y, q.z, 0.6 + 0.6 * Math.sin(Math.PI * p));
      });
      dots.instanceMatrix.needsUpdate = true;
      group.rotation.y = t * 0.15;
    } };
  },
};

function findFact(facts = [], re) {
  const f = facts.find(([label]) => re.test(label));
  return f ? String(f[1]).replace(/[^\d.,]/g, '').replace(/,/g, '') : null;
}

export const KIND_NAMES = Object.keys(KINDS);

export function buildScene(project, env) {
  const make = KINDS[project.kind] || KINDS.specimen;
  return make({ hue: project.hue ?? 0.08, env, facts: project.facts || [], seed: hashSeed(project.slug) });
}
