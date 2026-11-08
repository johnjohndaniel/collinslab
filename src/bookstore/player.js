// First-person walker: mouse look, WASD, head bob, collisions, and a coffee in hand.
import * as THREE from 'three';

const EYE = 1.62, RADIUS = 0.32;

export class Player {
  constructor(camera, colliders, spawn) {
    this.camera = camera;
    this.colliders = colliders;
    this.pos = spawn.clone();
    this.vel = new THREE.Vector3();
    this.yaw = 0; this.pitch = -0.04;
    this.lookVel = new THREE.Vector2();
    this.keys = new Set();
    this.walkPhase = 0; this.bob = 0; this.roll = 0;
    this.enabled = true;
    this.onStep = null;
    this.lastStepSign = 1;
    addEventListener('keydown', (e) => this.keys.add(e.code));
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
  }

  look(dx, dy) {
    this.lookVel.x += dx * 0.0022;
    this.lookVel.y += dy * 0.0022;
  }

  #blocked(x, z) {
    for (const c of this.colliders) {
      if (x > c.minX - RADIUS && x < c.maxX + RADIUS && z > c.minZ - RADIUS && z < c.maxZ + RADIUS) return true;
    }
    return false;
  }

  update(dt) {
    // Smoothed look: apply most of the accumulated mouse motion each frame.
    const k = 1 - Math.exp(-dt * 28);
    this.yaw -= this.lookVel.x * k; this.pitch -= this.lookVel.y * k;
    this.lookVel.multiplyScalar(1 - k);
    this.pitch = Math.max(-1.35, Math.min(1.25, this.pitch));

    const input = new THREE.Vector2(
      (this.keys.has('KeyD') || this.keys.has('ArrowRight') ? 1 : 0) - (this.keys.has('KeyA') || this.keys.has('ArrowLeft') ? 1 : 0),
      (this.keys.has('KeyW') || this.keys.has('ArrowUp') ? 1 : 0) - (this.keys.has('KeyS') || this.keys.has('ArrowDown') ? 1 : 0));
    if (!this.enabled) input.set(0, 0);
    if (input.lengthSq() > 1) input.normalize();
    const speed = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight') ? 2.6 : 1.45;
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    const target = fwd.multiplyScalar(input.y * speed).addScaledVector(right, input.x * speed);
    // Ease in/out like a person, not a camera dolly.
    const accel = target.lengthSq() > 0 ? 7 : 9;
    this.vel.lerp(target, 1 - Math.exp(-dt * accel));

    const nx = this.pos.x + this.vel.x * dt, nz = this.pos.z + this.vel.z * dt;
    if (!this.#blocked(nx, this.pos.z)) this.pos.x = nx; else this.vel.x *= 0.2;
    if (!this.#blocked(this.pos.x, nz)) this.pos.z = nz; else this.vel.z *= 0.2;

    // Head bob tied to distance walked; footsteps at each down-beat.
    const v = Math.hypot(this.vel.x, this.vel.z);
    this.walkPhase += v * dt * 5.6;
    const amt = Math.min(1, v / 1.45);
    this.bob += (amt - this.bob) * Math.min(1, dt * 6);
    const s = Math.sin(this.walkPhase);
    const sign = Math.sign(Math.sin(this.walkPhase * 0.5 + Math.PI / 2) || 1);
    if (amt > 0.3 && sign !== this.lastStepSign) { this.lastStepSign = sign; this.onStep?.(amt); }
    const strafe = this.vel.dot(right) / 2.6;
    this.roll += (-strafe * 0.05 - this.roll) * Math.min(1, dt * 5);

    this.camera.position.set(
      this.pos.x + Math.cos(this.yaw) * Math.cos(this.walkPhase * 0.5) * 0.018 * this.bob,
      EYE + Math.abs(s) * 0.032 * this.bob - 0.012 * this.bob,
      this.pos.z - Math.sin(this.yaw) * Math.cos(this.walkPhase * 0.5) * 0.018 * this.bob);
    this.camera.rotation.set(this.pitch + Math.abs(s) * 0.006 * this.bob, this.yaw, this.roll + Math.sin(this.walkPhase * 0.5) * 0.004 * this.bob, 'YXZ');
    return { speed: v, phase: this.walkPhase, bob: this.bob };
  }
}

/** A takeaway coffee held in the right hand, with steam. Lives in its own overlay scene. */
export class CoffeeCup {
  constructor() {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.HemisphereLight('#fff1dd', '#3a2a1e', 1.4));
    const key = new THREE.DirectionalLight('#ffd9a8', 1.6); key.position.set(-1, 2, 1); this.scene.add(key);
    this.group = new THREE.Group();
    const prof = [[0.0, 0], [0.026, 0], [0.028, 0.002], [0.036, 0.11], [0.037, 0.112]].map(([x, y]) => new THREE.Vector2(x, y));
    const paper = new THREE.MeshStandardMaterial({ color: '#f2ede4', roughness: 0.8, side: THREE.DoubleSide });
    const cup = new THREE.Mesh(new THREE.LatheGeometry(prof, 40), paper);
    const c = Object.assign(document.createElement('canvas'), { width: 512, height: 96 });
    const g = c.getContext('2d');
    g.fillStyle = '#a0723f'; g.fillRect(0, 0, 512, 96);
    g.fillStyle = '#5a3a1c'; g.font = 'italic 34px Georgia, serif'; g.textAlign = 'center'; g.fillText('the reading room', 128, 60); g.fillText('the reading room', 384, 60);
    const sleeveTex = new THREE.CanvasTexture(c); sleeveTex.colorSpace = THREE.SRGBColorSpace;
    sleeveTex.wrapS = THREE.RepeatWrapping; sleeveTex.repeat.x = -1; // the cylinder's UVs run right-to-left seen from outside
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.0355, 0.0325, 0.045, 40, 1, true), new THREE.MeshStandardMaterial({ map: sleeveTex, roughness: 0.9, side: THREE.DoubleSide }));
    sleeve.position.y = 0.055;
    const lidProf = [[0, 0.02], [0.03, 0.02], [0.034, 0.012], [0.039, 0.008], [0.039, 0.0], [0.036, 0.0]].map(([x, y]) => new THREE.Vector2(x, y));
    const lid = new THREE.Mesh(new THREE.LatheGeometry(lidProf, 40), new THREE.MeshStandardMaterial({ color: '#f7f5f1', roughness: 0.35, side: THREE.DoubleSide }));
    lid.position.y = 0.11;
    // lid disc so you can't see into the cup
    const top = new THREE.Mesh(new THREE.CircleGeometry(0.03, 32), new THREE.MeshStandardMaterial({ color: '#efece6', roughness: 0.4 }));
    top.rotation.x = -Math.PI / 2; top.position.y = 0.13;
    const sip = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.002, 0.006), new THREE.MeshStandardMaterial({ color: '#2a2622' }));
    sip.position.set(0, 0.1315, 0.02);
    this.group.add(cup, sleeve, lid, top, sip);
    // Steam: soft sprites drifting up and fading.
    const sc = Object.assign(document.createElement('canvas'), { width: 64, height: 64 });
    const sg = sc.getContext('2d'), grad = sg.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,0.55)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    sg.fillStyle = grad; sg.fillRect(0, 0, 64, 64);
    const steamTex = new THREE.CanvasTexture(sc);
    this.steam = Array.from({ length: 14 }, (_, i) => {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, depthWrite: false, opacity: 0 }));
      sp.userData.t = i / 14; this.group.add(sp); return sp;
    });
    this.scene.add(this.group);
    this.lowered = 0;     // 0 = in view, 1 = put away (while holding a book)
    this.target = 0;
  }

  update(dt, camera, walk, time) {
    this.lowered += (this.target - this.lowered) * Math.min(1, dt * 5);
    const bobX = Math.cos(walk.phase * 0.5) * 0.008 * walk.bob, bobY = Math.abs(Math.sin(walk.phase)) * 0.01 * walk.bob;
    const idle = Math.sin(time * 1.3) * 0.003;
    // position in camera space, then to world
    const local = new THREE.Vector3(0.2 + bobX, -0.2 + bobY + idle - this.lowered * 0.35, -0.42);
    this.group.position.copy(local.applyMatrix4(camera.matrixWorld));
    this.group.quaternion.copy(camera.quaternion);
    this.group.rotateX(0.12 - this.lowered * 0.5); this.group.rotateZ(-0.05 + bobX);
    for (const sp of this.steam) {
      sp.userData.t = (sp.userData.t + dt * 0.28) % 1;
      const t = sp.userData.t, seed = sp.id * 1.7;
      sp.position.set(Math.sin(t * 6 + seed) * 0.01 * (1 + t * 3), 0.13 + t * 0.16, Math.cos(t * 5 + seed) * 0.008);
      sp.scale.setScalar(0.02 + t * 0.07);
      sp.material.opacity = Math.sin(Math.PI * t) * 0.32 * (1 - this.lowered);
    }
  }
}
