// Getting around without WASD: glide between stations; scroll or drag to look around.
import * as THREE from 'three';

const EYE = 1.62, SPEED = 1.35, CLEAR = 0.55;
const smooth = (t) => t * t * (3 - 2 * t);

function yawPitchTo(from, to) {
  const d = to.clone().sub(from);
  return { yaw: Math.atan2(-d.x, -d.z), pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)) };
}
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

export class Navigator {
  constructor(camera, colliders) {
    this.camera = camera;
    this.colliders = colliders;
    this.pos = new THREE.Vector3(0, 0, 8.6);
    this.base = { yaw: 0, pitch: -0.05 };   // the station's natural view
    this.look = { yaw: 0, pitch: 0 };       // the visitor's offset from it
    this.lookVel = { yaw: 0, pitch: 0 };
    this.trip = null;
    this.phase = 0; this.bob = 0;
    this.onStep = null; this.onArrive = null;
    this.station = null;
  }

  /** Accumulate a look gesture (radians). */
  nudge(dyaw, dpitch) {
    if (this.trip) return;
    this.lookVel.yaw += dyaw; this.lookVel.pitch += dpitch;
  }

  #blockedSeg(a, b) {
    for (const c of this.colliders) {
      // sample the segment; colliders are few and paths are short
      for (let i = 1; i < 20; i++) {
        const t = i / 20, x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
        if (x > c.minX - CLEAR && x < c.maxX + CLEAR && z > c.minZ - CLEAR && z < c.maxZ + CLEAR) return c;
      }
    }
    return null;
  }

  #route(from, to) {
    const pts = [from.clone()];
    let cur = from.clone();
    for (let guard = 0; guard < 4; guard++) {
      const c = this.#blockedSeg(cur, to);
      if (!c) break;
      // go round the obstacle's nearest corner that clears it
      const corners = [[c.minX - CLEAR - 0.1, c.minZ - CLEAR - 0.1], [c.maxX + CLEAR + 0.1, c.minZ - CLEAR - 0.1], [c.minX - CLEAR - 0.1, c.maxZ + CLEAR + 0.1], [c.maxX + CLEAR + 0.1, c.maxZ + CLEAR + 0.1]]
        .map(([x, z]) => new THREE.Vector3(x, 0, z))
        .filter((p) => !this.#blockedSeg(cur, p))
        .sort((p, q) => (cur.distanceTo(p) + p.distanceTo(to)) - (cur.distanceTo(q) + q.distanceTo(to)));
      if (!corners.length) break;
      pts.push(corners[0]); cur = corners[0];
    }
    pts.push(to.clone());
    return pts;
  }

  /** Walk to a station {stand, lookAt}. */
  goTo(station, instant = false) {
    this.station = station;
    const view = yawPitchTo(new THREE.Vector3(station.stand.x, EYE, station.stand.z), station.lookAt);
    if (instant) {
      this.pos.copy(station.stand); this.base = view; this.look = { yaw: 0, pitch: 0 }; this.onArrive?.(station); return;
    }
    const pts = this.#route(this.pos, station.stand);
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.3);
    const len = curve.getLength();
    if (len < 0.05) { this.trip = { curve: null, t: 0, dur: 0.6, from: this.#currentView(), to: view, station }; return; }
    this.trip = { curve, len, t: 0, dur: Math.min(5.5, Math.max(1.1, len / SPEED)), from: this.#currentView(), to: view, station };
  }

  #currentView() { return { yaw: this.base.yaw + this.look.yaw, pitch: this.base.pitch + this.look.pitch }; }

  get moving() { return !!this.trip; }

  update(dt) {
    let speed = 0;
    if (this.trip) {
      const tr = this.trip;
      tr.t = Math.min(1, tr.t + dt / tr.dur);
      const e = tr.t < 0.5 ? 2 * tr.t * tr.t : 1 - (-2 * tr.t + 2) ** 2 / 2; // ease in-out
      let heading = tr.to.yaw;
      if (tr.curve) {
        const p = tr.curve.getPointAt(e);
        speed = this.pos.distanceTo(p) / Math.max(dt, 1e-4);
        this.pos.copy(p);
        const tan = tr.curve.getTangentAt(Math.min(0.999, e));
        heading = Math.atan2(-tan.x, -tan.z);
      }
      // look where you're walking, then settle on the display as you arrive
      const settle = smooth(Math.min(1, Math.max(0, (e - 0.45) / 0.55)));
      const start = smooth(Math.min(1, e / 0.25));
      const walkYaw = tr.from.yaw + wrap(heading - tr.from.yaw) * start;
      const yaw = walkYaw + wrap(tr.to.yaw - walkYaw) * settle;
      const pitch = tr.from.pitch + (-0.04 - tr.from.pitch) * start * (1 - settle) + (tr.to.pitch - tr.from.pitch) * settle;
      this.base = { yaw, pitch: tr.curve ? pitch : tr.from.pitch + (tr.to.pitch - tr.from.pitch) * e };
      this.look = { yaw: 0, pitch: 0 }; this.lookVel = { yaw: 0, pitch: 0 };
      if (tr.t >= 1) { this.base = tr.to; this.trip = null; this.onArrive?.(tr.station); }
    } else {
      const k = 1 - Math.exp(-dt * 16);
      this.look.yaw += this.lookVel.yaw * k; this.look.pitch += this.lookVel.pitch * k;
      this.lookVel.yaw *= 1 - k; this.lookVel.pitch *= 1 - k;
      // you can look around freely, but not lose the room
      this.look.yaw = Math.max(-1.6, Math.min(1.6, this.look.yaw));
      const pitch = this.base.pitch + this.look.pitch;
      this.look.pitch += Math.max(-1.0, Math.min(0.6, pitch)) - pitch;
    }
    // head bob and footsteps while walking
    const amt = Math.min(1, speed / SPEED);
    this.bob += (amt - this.bob) * Math.min(1, dt * 6);
    const before = Math.floor(this.phase / Math.PI);
    this.phase += speed * dt * 5.6;
    if (amt > 0.3 && Math.floor(this.phase / Math.PI) !== before) this.onStep?.(amt);
    const s = Math.sin(this.phase);
    const yaw = this.base.yaw + this.look.yaw, pitch = this.base.pitch + this.look.pitch;
    this.camera.position.set(
      this.pos.x + Math.cos(yaw) * Math.cos(this.phase * 0.5) * 0.014 * this.bob,
      EYE + Math.abs(s) * 0.026 * this.bob - 0.01 * this.bob,
      this.pos.z - Math.sin(yaw) * Math.cos(this.phase * 0.5) * 0.014 * this.bob);
    this.camera.rotation.set(pitch + Math.abs(s) * 0.004 * this.bob, yaw, Math.sin(this.phase * 0.5) * 0.004 * this.bob, 'YXZ');
    return { speed, phase: this.phase, bob: this.bob };
  }
}
