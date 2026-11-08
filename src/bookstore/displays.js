// Curated displays: four bays and two tables, each holding a handful of chosen books.
import * as THREE from 'three';
import { box, canvasTexture, shadowy, ROOM } from './room.js';
import { drawCover, drawSpine, bookDims, hash, loadCover } from './books.js';

const rng = (seed) => () => ((seed = (seed + 0x6d2b79f5) >>> 0), (((seed ^ (seed >>> 15)) * (seed | 1)) >>> 0) / 4294967296);
const UP = new THREE.Vector3(0, 1, 0);
const TABLE_TOP = 0.78;

// Where each display stands, and where you stand to look at it.
const { W, D } = ROOM;
export const LAYOUT = {
  front: { pos: [0, 4.0], ry: 0, stand: [0, 5.75], label: 'Chosen for you' },
  newTable: { pos: [0, -3.0], ry: 0, stand: [0, -1.2], label: 'New & notable' },
  bays: [
    { pos: [-3.3, -D / 2 + 0.25], ry: 0, stand: [-3.3, -D / 2 + 2.05] },
    { pos: [3.3, -D / 2 + 0.25], ry: 0, stand: [3.3, -D / 2 + 2.05] },
    { pos: [-W / 2 + 0.25, -3.5], ry: Math.PI / 2, stand: [-W / 2 + 2.05, -3.5] },
    { pos: [W / 2 - 0.25, -3.5], ry: -Math.PI / 2, stand: [W / 2 - 2.05, -3.5] },
  ],
};

function plaque(label) {
  const tex = canvasTexture(1024, 160, (g, w, h) => {
    g.fillStyle = '#2a1d14'; g.fillRect(0, 0, w, h);
    const grad = g.createLinearGradient(0, 0, 0, h); grad.addColorStop(0, '#e9cd8a'); grad.addColorStop(1, '#b08a46');
    g.fillStyle = grad; g.font = '500 70px Georgia, "Palatino Linotype", serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(label, w / 2, h / 2 + 3);
  });
  const m = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.45, metalness: 0.35 });
  return new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.18, 0.025), [m, m, m, m, m, m]);
}

function tentCard(text) {
  const tex = canvasTexture(512, 256, (g, w, h) => {
    g.fillStyle = '#f5efe2'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#c9b48a'; g.lineWidth = 4; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#3a2e22'; g.font = 'italic 64px "Snell Roundhand", "Brush Script MT", Georgia, serif';
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, w / 2, h / 2);
  });
  const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, side: THREE.DoubleSide });
  const g = new THREE.Group();
  const a = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.13), mat); a.position.set(0, 0.06, 0.02); a.rotation.x = -0.32;
  const b = new THREE.Mesh(new THREE.PlaneGeometry(0.26, 0.13), new THREE.MeshStandardMaterial({ color: '#f5efe2', roughness: 0.9, side: THREE.DoubleSide }));
  b.position.set(0, 0.06, -0.02); b.rotation.x = 0.32;
  g.add(a, b);
  return g;
}

export class Displays {
  constructor(scene, room) {
    this.scene = scene;
    this.mats = room.materials;
    this.colliders = room.colliders;
    this.root = new THREE.Group(); scene.add(this.root);
    this.dynamic = new THREE.Group(); scene.add(this.dynamic); // books & labels, rebuilt per arrangement
    this.books = []; this.hitboxes = []; this.stations = [];
    this.hover = null;
    this.#buildFurniture();
  }

  // --- static furniture -------------------------------------------------------
  #table(key) {
    const L = LAYOUT[key], g = new THREE.Group();
    const top = new THREE.Mesh(box(2.1, 0.05, 1.05, 1.2), this.mats.counterTop); top.position.y = TABLE_TOP - 0.025; g.add(top);
    const apron = new THREE.Mesh(box(1.9, 0.09, 0.9, 0.8), this.mats.woodMat); apron.position.y = TABLE_TOP - 0.1; g.add(apron);
    for (const [x, z] of [[-0.95, -0.42], [0.95, -0.42], [-0.95, 0.42], [0.95, 0.42]]) {
      const leg = new THREE.Mesh(box(0.07, TABLE_TOP - 0.05, 0.07, 0.8), this.mats.woodMat); leg.position.set(x, (TABLE_TOP - 0.05) / 2, z); g.add(leg);
    }
    g.position.set(L.pos[0], 0, L.pos[1]); g.rotation.y = L.ry;
    this.root.add(shadowy(g));
    this.colliders.push({ minX: L.pos[0] - 1.1, maxX: L.pos[0] + 1.1, minZ: L.pos[1] - 0.55, maxZ: L.pos[1] + 0.55 });
    return g;
  }

  #bay(i) {
    const L = LAYOUT.bays[i], g = new THREE.Group(), wood = this.mats.woodMat;
    const Wd = 1.9, Dp = 0.36, H = 2.15, t = 0.03;
    const add = (geo, x, y, z) => { const m = new THREE.Mesh(geo, wood); m.position.set(x, y, z); g.add(m); return m; };
    add(box(t, H, Dp, 0.8), -Wd / 2, H / 2, 0); add(box(t, H, Dp, 0.8), Wd / 2, H / 2, 0);
    add(box(Wd, H, 0.02, 0.8), 0, H / 2, -Dp / 2 + 0.01);
    add(box(Wd + 0.06, 0.04, Dp + 0.04, 0.8), 0, H + 0.02, 0);
    // closed cabinet base with two doors
    add(box(Wd - t, 0.48, Dp - 0.02, 0.8), 0, 0.24, 0);
    for (const x of [-Wd / 4, Wd / 4]) {
      const door = add(box(Wd / 2 - 0.05, 0.4, 0.015, 0.8), x, 0.25, Dp / 2);
      const knob = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), this.mats.steel); knob.position.set(x + (x < 0 ? 0.36 : -0.36), 0.3, Dp / 2 + 0.015); g.add(knob);
      void door;
    }
    for (const y of [0.5, 0.98, 1.42, 1.84]) add(box(Wd - t, 0.025, Dp - 0.02, 0.8), 0, y - 0.0125, 0);
    for (const y of [0.98, 1.84]) add(box(Wd - t, 0.035, 0.015, 0.8), 0, y + 0.017, Dp / 2 - 0.035); // lip for face-out books
    g.position.set(L.pos[0], 0, L.pos[1]); g.rotation.y = L.ry;
    this.root.add(shadowy(g));
    const c = Math.abs(Math.cos(L.ry)), s = Math.abs(Math.sin(L.ry));
    const fx = (Wd + 0.1) * c + (Dp + 0.1) * s, fz = (Wd + 0.1) * s + (Dp + 0.1) * c;
    this.colliders.push({ minX: L.pos[0] - fx / 2, maxX: L.pos[0] + fx / 2, minZ: L.pos[1] - fz / 2, maxZ: L.pos[1] + fz / 2 });
    return g;
  }

  #buildFurniture() {
    this.frames = { front: this.#table('front'), newTable: this.#table('newTable'), bays: LAYOUT.bays.map((_, i) => this.#bay(i)) };
  }

  // --- books ---------------------------------------------------------------------
  #bookMesh(book, dims) {
    const { w, h, t } = dims;
    const cw = 256, ch = Math.round((256 * h) / w);
    const coverTex = canvasTexture(cw, ch, (g) => drawCover(g, book, cw, ch));
    const spineTex = canvasTexture(64, 384, (g) => drawSpine(g, book, 64, 384));
    const edge = this.edgeMat || (this.edgeMat = new THREE.MeshStandardMaterial({ color: '#efe6d2', roughness: 0.95 }));
    const coverMat = new THREE.MeshStandardMaterial({ map: coverTex, roughness: 0.6, envMapIntensity: 0.6 });
    const spineMat = new THREE.MeshStandardMaterial({ map: spineTex, roughness: 0.65 });
    const backMat = new THREE.MeshStandardMaterial({ color: '#3a332b', roughness: 0.8 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t).translate(w / 2, 0, 0), [edge, spineMat, edge, edge, coverMat, backMat]);
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.userData = { book, dims, coverTex, spineTex, offset: 0 };
    // Real covers arrive asynchronously: redraw the cover, spine and back colour when they do.
    if (book.cover_id && !book.coverImage) {
      loadCover(book).then((img) => {
        if (!img || !mesh.parent) return;
        drawCover(coverTex.image.getContext('2d'), book, cw, ch); coverTex.needsUpdate = true;
        drawSpine(spineTex.image.getContext('2d'), book, 64, 384); spineTex.needsUpdate = true;
        backMat.color.set(book.palette?.bg || '#3a332b');
      });
    }
    return mesh;
  }

  #place(mesh, basis, origin, out) {
    mesh.matrixAutoUpdate = true;
    const m = new THREE.Matrix4().makeBasis(...basis).setPosition(origin);
    m.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.userData.home = { p: mesh.position.clone(), q: mesh.quaternion.clone() };
    mesh.userData.out = out.clone();
    mesh.userData.normal = out.clone().setY(0).normalize();
    if (mesh.userData.normal.lengthSq() < 0.5) mesh.userData.normal.set(0, 0, 1).applyQuaternion(mesh.quaternion).setY(0).normalize();
    this.dynamic.add(mesh); this.books.push(mesh);
  }

  /** A book standing face-out, leaning back by `lean` radians. Frame: x along the shelf, z out. */
  #faceOut(book, frame, x, y, zBottom, lean, salt) {
    const dims = bookDims(book, rng(hash(book.id + salt)));
    const mesh = this.#bookMesh(book, dims);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -lean);
    const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0).applyQuaternion(q), Z = new THREE.Vector3(0, 0, 1).applyQuaternion(q);
    const centre = new THREE.Vector3(x, y, zBottom - dims.t / 2).addScaledVector(Y, dims.h / 2);
    const origin = centre.clone().addScaledVector(X, -dims.w / 2);
    const fw = frame.matrixWorld, rot = new THREE.Matrix3().setFromMatrix4(fw);
    this.#place(mesh, [X.applyMatrix3(rot), Y.applyMatrix3(rot), Z.applyMatrix3(rot)], origin.applyMatrix4(fw),
      new THREE.Vector3(0, 0.012, 0.04).applyMatrix3(rot));
  }

  /** A book shelved spine-out. x0 = where its thickness starts along the shelf. */
  #spineOut(book, frame, x0, y, zFront, salt) {
    const dims = bookDims(book, rng(hash(book.id + salt)));
    dims.h = Math.min(dims.h, 0.4);
    const mesh = this.#bookMesh(book, dims);
    const X = new THREE.Vector3(0, 0, -1), Y = UP.clone(), Z = new THREE.Vector3().crossVectors(X, Y);
    const origin = new THREE.Vector3(x0 + dims.t / 2, y + dims.h / 2, zFront);
    const fw = frame.matrixWorld, rot = new THREE.Matrix3().setFromMatrix4(fw);
    this.#place(mesh, [X.applyMatrix3(rot), Y.applyMatrix3(rot), Z.applyMatrix3(rot)], origin.applyMatrix4(fw), new THREE.Vector3(0, 0, 0.035).applyMatrix3(rot));
    return dims.t;
  }

  /** A book lying cover-up on a table. */
  #flat(book, frame, x, z, yBottom, yaw, salt) {
    const dims = bookDims(book, rng(hash(book.id + salt)));
    const mesh = this.#bookMesh(book, dims);
    const X = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw)), Z = UP.clone(), Y = new THREE.Vector3().crossVectors(Z, X);
    const centre = new THREE.Vector3(x, yBottom + dims.t / 2, z);
    const origin = centre.clone().addScaledVector(X, -dims.w / 2);
    const fw = frame.matrixWorld, rot = new THREE.Matrix3().setFromMatrix4(fw);
    this.#place(mesh, [X.applyMatrix3(rot), Y.applyMatrix3(rot), Z.applyMatrix3(rot)], origin.applyMatrix4(fw), new THREE.Vector3(0, 0.03, 0.02).applyMatrix3(rot));
    return dims.t;
  }

  #easel(frame, x, z) {
    const mat = this.mats.blackMetal, g = new THREE.Group();
    const rod = (len, px, py, pz, rx) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, len, 6), mat); m.position.set(px, py, pz); m.rotation.x = rx; g.add(m); };
    rod(0.2, -0.04, TABLE_TOP + 0.09, z - 0.03, -0.28); rod(0.2, 0.04, TABLE_TOP + 0.09, z - 0.03, -0.28);
    rod(0.12, 0, TABLE_TOP + 0.05, z - 0.09, 0.6);
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.006, 0.02), mat); lip.position.set(0, TABLE_TOP + 0.006, z + 0.02); g.add(lip);
    g.position.x = x; frame.add(g); this.decor.push(g);
  }

  /** Clear and lay out a new arrangement from the curator. */
  build(arr) {
    for (const m of this.books) { m.material.forEach((mt) => { mt.map?.dispose?.(); if (mt !== this.edgeMat) mt.dispose(); }); m.geometry.dispose(); }
    for (const d of this.decor || []) d.parent?.remove(d);
    this.dynamic.clear(); this.books = []; this.decor = []; this.hitboxes = []; this.stations = [];
    this.root.updateMatrixWorld(true);

    const table = (key, books, label) => {
      const f = this.frames[key];
      // three on easels across the back, two short stacks in front
      [-0.6, 0, 0.6].forEach((x, i) => { if (books[i]) { this.#easel(f, x, -0.2); this.#faceOut(books[i], f, x, TABLE_TOP + 0.012, -0.17, 0.3, key); } });
      const rest = books.slice(3);
      [[-0.55, 0.2, 0], [0.55, 0.2, 3]].forEach(([x, z, start]) => {
        let y = TABLE_TOP;
        for (let k = start; k < start + 3 && rest[k]; k++) y += this.#flat(rest[k], f, x + (k % 2 ? 0.02 : -0.015), z, y, (hash(rest[k].id) % 100 - 50) / 350, key) + 0.001;
      });
      const card = tentCard(label.toLowerCase()); card.position.set(0, TABLE_TOP, 0.32); f.add(card); this.decor.push(card);
      const L = LAYOUT[key];
      this.#station(key, label, L.stand, new THREE.Vector3(L.pos[0], TABLE_TOP + 0.05, L.pos[1]), f, [2.2, 0.6, 1.1], TABLE_TOP + 0.2);
    };
    table('front', arr.front, LAYOUT.front.label);
    table('newTable', arr.newTable, LAYOUT.newTable.label);

    arr.bays.forEach((bay, i) => {
      const f = this.frames.bays[i], L = LAYOUT.bays[i], books = bay.books, Dp = 0.36;
      const sign = plaque(bay.label); sign.position.set(0, 2.27, 0.02); f.add(sign); this.decor.push(sign);
      // face-out rows, centred however many books there are
      const n = books.length, mid = Math.min(4, n), top = Math.min(3, n - mid);
      const row = (count, spacing) => Array.from({ length: count }, (_, i) => (i - (count - 1) / 2) * spacing);
      let k = 0;
      row(top, 0.55).forEach((x) => this.#faceOut(books[k++], f, x, 1.84 + 0.035, Dp / 2 - 0.05, 0.16, 'top'));
      row(mid, 0.46).forEach((x) => this.#faceOut(books[k++], f, x, 0.98 + 0.035, Dp / 2 - 0.05, 0.16, 'mid'));
      for (const y of [1.42, 0.5]) {
        const left = books.length - k;
        let x = -0.88;
        if (left >= 3) for (let c = 0; c < 7 && books[k]; c++) x += this.#spineOut(books[k++], f, x, y, Dp / 2 - 0.012, `s${y}`) + 0.002;
        else x = -0.5; // too few for a run of spines: leave the shelf to a plant and a bookend
        // a bookend and a small plant finish the row
        if (left >= 3) { const end = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.12), this.mats.blackMetal); end.position.set(x + 0.01, y + 0.08, Dp / 2 - 0.08); f.add(end); this.decor.push(end); }
        if (x < 0.55) {
          const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.045, 0.11, 18), new THREE.MeshStandardMaterial({ color: '#b5654a', roughness: 0.8 }));
          pot.position.set(0.72, y + 0.055, 0); f.add(pot); this.decor.push(pot);
          const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 1), new THREE.MeshStandardMaterial({ color: '#4d6b3a', roughness: 0.9, flatShading: true }));
          leaves.position.set(0.72, y + 0.17, 0); leaves.scale.set(1, 0.8, 1); f.add(leaves); this.decor.push(leaves);
        }
      }
      const centre = new THREE.Vector3(0, 1.25, 0).applyMatrix4(f.matrixWorld);
      this.#station(`bay${i}`, bay.label, L.stand, centre, f, [2.0, 2.3, 0.6], 1.15);
    });
  }

  #station(key, label, stand, lookAt, frame, size, y) {
    this.stations.push({ key, label, stand: new THREE.Vector3(stand[0], 0, stand[1]), lookAt });
    const hb = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshBasicMaterial({ visible: false }));
    hb.position.set(0, y, 0); hb.userData.station = key; frame.add(hb); this.hitboxes.push(hb); this.decor.push(hb);
  }

  // --- interaction ------------------------------------------------------------------
  /** What's under this ray: { book: mesh } or { station: key } or null. */
  pick(raycaster) {
    const visible = this.books.filter((m) => m.visible);
    const hitBook = raycaster.intersectObjects(visible, false)[0];
    if (hitBook && hitBook.distance < 4.5) return { book: hitBook.object, distance: hitBook.distance };
    const hitStation = raycaster.intersectObjects(this.hitboxes, false)[0];
    if (hitStation) return { station: hitStation.object.userData.station, distance: hitStation.distance };
    return null;
  }

  /** Ease the hovered book a little out towards you. */
  update(dt) {
    for (const m of this.books) {
      const target = m === this.hover && m.visible ? 1 : 0, u = m.userData;
      if (Math.abs(u.offset - target) < 1e-3) continue;
      u.offset += (target - u.offset) * Math.min(1, dt * 12);
      m.position.copy(u.home.p).addScaledVector(u.out, u.offset);
    }
  }
}
