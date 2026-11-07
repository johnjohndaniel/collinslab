// Copper specimen: a noise-displaced metallic blob that weathers into patina,
// bulges toward the pointer, and ripples where you click.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const NOISE = /* glsl */ `
// 3D simplex noise, Ashima Arts / Stefan Gustavson (MIT).
vec3 mod289(vec3 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 mod289(vec4 x){return x-floor(x*(1.0/289.0))*289.0;}
vec4 permute(vec4 x){return mod289(((x*34.0)+10.0)*x);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod289(i);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=0.142857142857; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z); vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.5-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 105.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`;

const VERT_HEAD = /* glsl */ `
uniform float uTime, uAmp, uFreq, uPull, uPulse, uPulseAge;
uniform vec3 uPointer, uPulseOrigin;
varying float vPatina;
${NOISE}
float disp(vec3 p){
  vec3 d = normalize(p);
  float n = snoise(p*uFreq + vec3(0.0, uTime*0.15, 0.0));
  n += 0.5*snoise(p*uFreq*2.1 - vec3(uTime*0.1));
  float pull = exp(-pow(distance(d, uPointer)*2.2, 2.0)) * uPull;
  float r = distance(d, uPulseOrigin);
  float ripple = uPulse * sin(r*14.0 - uPulseAge*9.0) * exp(-r*2.5) * smoothstep(0.0, 0.3, uPulseAge*9.0 - r*14.0 + 0.3);
  return n*uAmp + pull*0.28 + ripple*0.12;
}
vec3 displaced(vec3 p){ vec3 d = normalize(p); return d*(1.0 + disp(d)); }
`;

const VERT_NORMAL = /* glsl */ `
vec3 sphereDir = normalize(position);
vec3 tangentA = normalize(cross(sphereDir, abs(sphereDir.y) < 0.99 ? vec3(0.0,1.0,0.0) : vec3(1.0,0.0,0.0)));
vec3 tangentB = normalize(cross(sphereDir, tangentA));
float eps = 0.002;
vec3 dispPos = displaced(sphereDir);
vec3 dispA = displaced(sphereDir + tangentA*eps);
vec3 dispB = displaced(sphereDir + tangentB*eps);
vec3 objectNormal = normalize(cross(dispA - dispPos, dispB - dispPos));
vPatina = snoise(sphereDir*1.7 + 7.3)*0.5 + 0.5 + 0.15*snoise(sphereDir*6.0);
#ifdef USE_TANGENT
  vec3 objectTangent = vec3(tangent.xyz);
#endif
`;

const FRAG_HEAD = /* glsl */ `
uniform float uPatina;
uniform vec3 uPatinaColor;
varying float vPatina;
float patinaMask(){ float t = 1.0 - uPatina; return smoothstep(t - 0.08, t + 0.08, vPatina); }
`;

export function createSpecimen(canvas, { interactive = true, autoRotate = true, zoom = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f10);
  scene.fog = new THREE.FogExp2(0x0b0f10, 0.06);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
  camera.position.set(0, 0.4, 5.2);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.enablePan = false;
  controls.enableZoom = zoom;
  controls.minDistance = 2.6;
  controls.maxDistance = 9;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 0.6;

  const key = new THREE.DirectionalLight(0xffe2c4, 2.2);
  key.position.set(3, 4, 2);
  const rim = new THREE.DirectionalLight(0x6fd6c8, 1.4);
  rim.position.set(-4, -1, -3);
  scene.add(key, rim);

  const params = {
    amplitude: 0.22, frequency: 1.3, speed: 1.0, patina: 0.25,
    copper: '#c46f3c', patinaColor: '#3fa796', roughness: 0.28, spores: true,
  };

  const uniforms = {
    uTime: { value: 0 }, uAmp: { value: params.amplitude }, uFreq: { value: params.frequency },
    uPull: { value: 0 }, uPointer: { value: new THREE.Vector3(0, 0, 1) },
    uPulse: { value: 0 }, uPulseAge: { value: 10 }, uPulseOrigin: { value: new THREE.Vector3(0, 0, 1) },
    uPatina: { value: params.patina }, uPatinaColor: { value: new THREE.Color(params.patinaColor) },
  };

  const material = new THREE.MeshPhysicalMaterial({
    color: params.copper, metalness: 1, roughness: params.roughness,
    clearcoat: 0.4, clearcoatRoughness: 0.2,
  });
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', VERT_NORMAL)
      .replace('#include <begin_vertex>', 'vec3 transformed = dispPos;');
    shader.fragmentShader = FRAG_HEAD + shader.fragmentShader
      .replace('#include <color_fragment>', '#include <color_fragment>\n float pm = patinaMask(); diffuseColor.rgb = mix(diffuseColor.rgb, uPatinaColor, pm);')
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\n roughnessFactor = mix(roughnessFactor, 0.9, pm);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\n metalnessFactor = mix(metalnessFactor, 0.05, pm);');
  };

  const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 96), material);
  scene.add(blob);

  // Drifting "spores" around the specimen.
  const SPORES = 900;
  const sporePos = new Float32Array(SPORES * 3);
  const sporeSeed = new Float32Array(SPORES);
  for (let i = 0; i < SPORES; i++) {
    const r = 1.8 + Math.random() * 4.5, th = Math.random() * Math.PI * 2, ph = Math.acos(2 * Math.random() - 1);
    sporePos.set([r * Math.sin(ph) * Math.cos(th), r * Math.cos(ph), r * Math.sin(ph) * Math.sin(th)], i * 3);
    sporeSeed[i] = Math.random();
  }
  const sporeGeo = new THREE.BufferGeometry();
  sporeGeo.setAttribute('position', new THREE.BufferAttribute(sporePos, 3));
  const spores = new THREE.Points(sporeGeo, new THREE.PointsMaterial({
    size: 0.025, color: 0x9fe3d6, transparent: true, opacity: 0.7, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  scene.add(spores);

  // Pointer interaction: intersect the undisplaced unit sphere in blob-local space.
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const unitSphere = new THREE.Sphere(new THREE.Vector3(), 1.05);
  const inv = new THREE.Matrix4();
  const hit = new THREE.Vector3();
  let hovering = false;
  const pickLocal = (e) => {
    const rect = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, camera);
    const ray = raycaster.ray.clone().applyMatrix4(inv.copy(blob.matrixWorld).invert());
    return ray.intersectSphere(unitSphere, hit) ? hit.clone().normalize() : null;
  };
  if (interactive) {
    canvas.addEventListener('pointermove', (e) => {
      const p = pickLocal(e);
      hovering = !!p;
      if (p) uniforms.uPointer.value.lerp(p, 0.35).normalize();
    });
    canvas.addEventListener('pointerleave', () => { hovering = false; });
    let downAt = null;
    canvas.addEventListener('pointerdown', (e) => { downAt = [e.clientX, e.clientY]; });
    canvas.addEventListener('pointerup', (e) => {
      if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 6) return; // a drag, not a click
      const p = pickLocal(e);
      if (p) { uniforms.uPulseOrigin.value.copy(p); uniforms.uPulse.value = 1; uniforms.uPulseAge.value = 0; }
    });
  }

  const resize = () => {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe(canvas);
  resize();

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduceMotion) controls.autoRotate = false;

  const timer = new THREE.Timer();
  let t = 0;
  renderer.setAnimationLoop((now) => {
    timer.update(now);
    const dt = Math.min(timer.getDelta(), 0.05);
    t += dt * params.speed * (reduceMotion ? 0.2 : 1);
    uniforms.uTime.value = t;
    uniforms.uAmp.value = params.amplitude;
    uniforms.uFreq.value = params.frequency;
    uniforms.uPatina.value = params.patina;
    uniforms.uPull.value += ((hovering ? 1 : 0) - uniforms.uPull.value) * Math.min(1, dt * 4);
    uniforms.uPulseAge.value += dt;
    uniforms.uPulse.value *= Math.exp(-dt * 1.2);
    spores.visible = params.spores;
    spores.rotation.y += dt * 0.02 * params.speed;
    spores.rotation.x = Math.sin(t * 0.05) * 0.1;
    blob.rotation.y += dt * 0.05 * params.speed;
    controls.update();
    renderer.render(scene, camera);
  });

  const apply = () => {
    material.color.set(params.copper);
    material.roughness = params.roughness;
    uniforms.uPatinaColor.value.set(params.patinaColor);
  };

  return { renderer, scene, camera, controls, params, apply };
}
