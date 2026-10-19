// The Interact screen's holographic orb. Adapted from ULTRON Orb UI by Sagar
// Tamang (MIT, see ORB-LICENSE.txt): layered wireframe shells, a spiral core,
// drifting code text, orbiting debris, dust and scan rings, with bloom and a
// chromatic-aberration pass.
//
// Scorpion's changes: the colours come from the active theme, the orb reacts
// to the conversation (standby / listening / thinking / speaking, and the live
// voice level), all text shares one texture, a lighter "low" quality exists for
// weak graphics, and rendering pauses completely while the screen is hidden so
// the local AI model keeps the GPU.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

const HOME = new THREE.Vector3(0, 0.5, 5.5);
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 40;

// How each conversation state looks. Values ease toward these targets.
const STATES = {
  standby: { spin: 1, core: 0.08, bloom: 1.25, text: 1, scan: 0.2, fade: 1 },
  listening: { spin: 0.6, core: 0.25, bloom: 1.5, text: 0.6, scan: 0.45, fade: 0 },
  thinking: { spin: 3.2, core: 0.2, bloom: 1.45, text: 4, scan: 0.35, fade: 0.3 },
  speaking: { spin: 1.4, core: 0.35, bloom: 1.7, text: 1.5, scan: 0.25, fade: 0 },
};

const SNIPPETS = [
  'SCORPION', 'offline', 'llama.cpp', 'whisper', 'kokoro', 'no cloud', 'local',
  'sys.init()', '0xFF3A', '>> SCAN', 'ACK', 'SYNC OK', 'exec()', 'hash256', 'core.0',
  '01101001', '10110100', '>>> RDY', 'HEAP 4K', 'mutex.lk', 'IRQ 0x7', 'DMA xfer',
  'kernel.d', 'pipe |>', 'fork()', 'AES-256', 'latency', '200 OK', 'fn main',
  'async {}', 'spawn()', 'tokens/s', 'ctx 8192', 'gguf', 'vulkan', 'metal', 'q4_k_m',
  'remember()', 'plan.step', 'agent.run', 'tool_call', 'stream()', 'venom.sys',
];

// Theme accent → the orb's palette (bright, mid, dim, faint, hot).
export function paletteFrom(accent) {
  const base = new THREE.Color(accent || '#f0a830');
  const hsl = {};
  base.getHSL(hsl);
  const at = (l, s = hsl.s) => new THREE.Color().setHSL(hsl.h, Math.min(1, s), l);
  return {
    bright: at(0.6, hsl.s * 1.05), mid: at(0.45), dim: at(0.28), faint: at(0.17), hot: at(0.72, hsl.s * 0.9),
    // Colour grade toward the accent (the reference used a fixed amber 1.15/0.85/0.55).
    tint: (() => { const m = Math.max(base.r, base.g, base.b, 0.001); return new THREE.Vector3(1.15 * base.r / m, Math.max(0.55, 1.1 * base.g / m), Math.max(0.45, 0.9 * base.b / m)); })(),
  };
}

export function createOrb(container, { accent, quality = 'high' } = {}) {
  const low = quality === 'low';
  let pal = paletteFrom(accent);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, container.clientWidth / container.clientHeight, 0.1, 500);
  camera.position.copy(HOME);

  const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
  renderer.setSize(container.clientWidth, container.clientHeight);
  renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio, 1.5));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.72;
  container.appendChild(renderer.domElement);

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth, container.clientHeight), 1.6, 0.4, 0.2);
  composer.addPass(bloom);
  const chromatic = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uIntensity: { value: 0.003 }, uTint: { value: pal.tint } },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `
      uniform sampler2D tDiffuse; uniform float uTime; uniform float uIntensity; uniform vec3 uTint; varying vec2 vUv;
      void main() {
        vec2 dir = vUv - vec2(0.5);
        float offset = uIntensity * length(dir);
        float flicker = 1.0 + 0.02 * sin(uTime * 30.0) * sin(uTime * 7.3);
        vec4 cr = texture2D(tDiffuse, vUv + dir * offset);
        vec4 cg = texture2D(tDiffuse, vUv);
        vec4 cb = texture2D(tDiffuse, vUv - dir * offset * 0.5);
        gl_FragColor = vec4(cr.r, cg.g * 1.05, cb.b * 0.6, 1.0) * flicker;
        gl_FragColor.rgb = mix(gl_FragColor.rgb, gl_FragColor.rgb * uTint, 0.45);
      }`,
  });
  composer.addPass(chromatic);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.04;
  controls.minDistance = MIN_DISTANCE;
  controls.maxDistance = MAX_DISTANCE;
  controls.zoomSpeed = 1.4;
  controls.enablePan = false;

  const orb = new THREE.Group();
  scene.add(orb);

  // Materials are grouped by palette role so a theme change can recolour them.
  const roles = { bright: [], mid: [], dim: [], faint: [], hot: [] };
  const lineMat = (role, opacity = 1) => {
    const m = new THREE.LineBasicMaterial({ color: pal[role], transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    roles[role].push(m);
    return m;
  };
  const sphere = (r, lat, lon) => new THREE.Vector3(r * Math.cos(lat) * Math.cos(lon), r * Math.sin(lat), r * Math.cos(lat) * Math.sin(lon));
  const line = (pts, mat) => new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
  const latRing = (r, lat, segs = 120) => Array.from({ length: segs + 1 }, (_, i) => sphere(r, lat, (i / segs) * Math.PI * 2));
  const meridian = (r, lon, segs = 120) => Array.from({ length: segs + 1 }, (_, i) => sphere(r, (i / segs) * Math.PI - Math.PI / 2, lon));

  // Layer 1: outer shell
  const outer = new THREE.Group();
  const R1 = 2.0;
  for (let i = -15; i <= 15; i += low ? 2 : 1) {
    const major = i % 3 === 0;
    outer.add(line(latRing(R1, (i / 15) * (Math.PI / 2) * 0.95), lineMat(major ? 'mid' : 'faint', major ? 0.5 : 0.12)));
  }
  for (let i = 0; i < 24; i += low ? 2 : 1) {
    const major = i % 6 === 0;
    outer.add(line(meridian(R1, (i / 24) * Math.PI * 2), lineMat(major ? 'mid' : 'faint', major ? 0.6 : 0.1)));
  }
  const bands = low ? 8 : 18;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < bands; j++) {
      const t = (j / (bands - 1)) * 2 - 1;
      outer.add(line(meridian(R1, (i / 4) * Math.PI * 2 + (t * 0.25) / 2, 200), lineMat(Math.abs(t) < 0.3 ? 'bright' : 'mid', 0.6 * (1 - Math.abs(t) * 0.7))));
    }
  }
  const eq = low ? 10 : 20;
  for (let j = 0; j < eq; j++) {
    const t = (j / (eq - 1)) * 2 - 1;
    outer.add(line(latRing(R1, (t * 0.35) / 2, 200), lineMat(Math.abs(t) < 0.3 ? 'bright' : 'mid', 0.6 * (1 - Math.abs(t) * 0.65))));
  }
  for (let i = 0; i < 15; i++) {
    const hex = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.CircleGeometry(0.03 + Math.random() * 0.02, 6)), lineMat('mid', 0.5));
    const phi = Math.acos(2 * Math.random() - 1);
    const theta = Math.random() * Math.PI * 2;
    hex.position.setFromSphericalCoords(R1 + 0.02, phi, theta);
    hex.lookAt(0, 0, 0);
    outer.add(hex);
  }
  orb.add(outer);

  // Layer 2: grid panels on the surface (they flicker)
  const panels = new THREE.Group();
  for (let i = 0; i < (low ? 14 : 30); i++) {
    const g = new THREE.Group();
    const lat0 = (Math.random() - 0.5) * Math.PI * 0.8;
    const lon0 = Math.random() * Math.PI * 2;
    const size = 0.15 + Math.random() * 0.25;
    const div = 3 + Math.floor(Math.random() * 3);
    const mat = lineMat('dim', 0.25);
    for (let a = 0; a <= div; a++) {
      const lat = lat0 - size / 2 + (a / div) * size;
      g.add(line(Array.from({ length: div * 4 + 1 }, (_, b) => sphere(R1 + 0.01, lat, lon0 - size / 2 + (b / (div * 4)) * size)), mat));
      const lon = lon0 - size / 2 + (a / div) * size;
      g.add(line(Array.from({ length: div * 4 + 1 }, (_, b) => sphere(R1 + 0.01, lat0 - size / 2 + (b / (div * 4)) * size, lon)), mat));
    }
    panels.add(g);
  }
  orb.add(panels);

  // Layer 3: secondary shell of partial arcs
  const shell2 = new THREE.Group();
  const R2 = 2.12;
  for (let i = 0; i < 16; i++) {
    const lat = (Math.random() - 0.5) * Math.PI * 0.85;
    const start = Math.random() * Math.PI * 2;
    const len = 0.3 + Math.random() * 1.2;
    shell2.add(line(Array.from({ length: 61 }, (_, j) => sphere(R2, lat, start + (j / 60) * len)), lineMat('mid', 0.2 + Math.random() * 0.3)));
  }
  for (let i = 0; i < 12; i++) {
    const lon = Math.random() * Math.PI * 2;
    const start = (Math.random() - 0.5) * Math.PI * 0.8;
    const len = 0.3 + Math.random() * 0.8;
    shell2.add(line(Array.from({ length: 41 }, (_, j) => sphere(R2, start + (j / 40) * len, lon)), lineMat('dim', 0.15 + Math.random() * 0.2)));
  }
  orb.add(shell2);

  // Layer 4: inner spiral core
  const inner = new THREE.Group();
  const R3 = 0.9;
  for (let s = 0; s < 8; s++) {
    const turns = 3 + Math.random() * 2;
    const phase = (s / 8) * Math.PI * 2;
    inner.add(line(Array.from({ length: 301 }, (_, i) => sphere(R3, (i / 300) * Math.PI - Math.PI / 2, (i / 300) * turns * Math.PI * 2 + phase)), lineMat('bright', 0.3 + Math.random() * 0.2)));
  }
  for (let i = -6; i <= 6; i++) inner.add(line(latRing(R3, (i / 6) * (Math.PI / 2) * 0.9, 80), lineMat('dim', 0.2)));
  for (let i = 0; i < 12; i++) inner.add(line(meridian(R3, (i / 12) * Math.PI * 2, 80), lineMat('dim', 0.15)));
  orb.add(inner);

  // Layer 5: hot centre
  const icoMat = lineMat('hot', 0.9);
  const ico = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(0.25, 1)), icoMat);
  orb.add(ico);
  const meshMat = (role, opacity) => {
    const m = new THREE.MeshBasicMaterial({ color: pal[role], transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false });
    roles[role].push(m);
    return m;
  };
  const coreMat = meshMat('hot', 0.15);
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 16), coreMat);
  const glowMat = meshMat('mid', 0.04);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.5, 16, 16), glowMat);
  orb.add(core, glow);

  // Code text: one atlas texture, one row per snippet, shared by every sprite.
  const ROW = 32;
  const atlasCanvas = document.createElement('canvas');
  atlasCanvas.width = 256;
  atlasCanvas.height = ROW * SNIPPETS.length;
  const atlas = new THREE.CanvasTexture(atlasCanvas);
  atlas.minFilter = THREE.LinearFilter;
  const drawAtlas = () => {
    const ctx = atlasCanvas.getContext('2d');
    ctx.clearRect(0, 0, atlasCanvas.width, atlasCanvas.height);
    ctx.font = 'bold 14px Consolas, "Courier New", monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = `#${pal.hot.getHexString()}`;
    SNIPPETS.forEach((s, i) => ctx.fillText(s, 128, i * ROW + ROW / 2));
    atlas.needsUpdate = true;
  };
  drawAtlas();
  const textMats = SNIPPETS.map((_, i) => {
    const tex = atlas.clone();
    tex.repeat.set(1, 1 / SNIPPETS.length);
    tex.offset.set(0, 1 - (i + 1) / SNIPPETS.length);
    return new THREE.SpriteMaterial({ map: tex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.6 });
  });
  const scatter = (count, sizeFn, rFn, speed) => {
    const group = new THREE.Group();
    for (let i = 0; i < count; i++) {
      const sp = new THREE.Sprite(textMats[Math.floor(Math.random() * SNIPPETS.length)]);
      const size = sizeFn();
      sp.scale.set(size * 5, size * 0.7, 1);
      const u = { phi: Math.acos(2 * Math.random() - 1), theta: Math.random() * Math.PI * 2, r: rFn(), speed: (speed[0] + Math.random() * speed[1]) * (Math.random() > 0.5 ? 1 : -1) };
      sp.userData = u;
      sp.position.setFromSphericalCoords(u.r, u.phi, u.theta);
      group.add(sp);
    }
    return group;
  };
  const textOuter = scatter(low ? 350 : 900, () => 0.04 + Math.random() * 0.04, () => R1 + 0.03 + Math.random() * 0.08, [0.0002, 0.0008]);
  const textInner = scatter(low ? 40 : 100, () => 0.03 + Math.random() * 0.03, () => R3 + 0.02, [0.0005, 0.001]);
  const textAmbient = scatter(low ? 120 : 300, () => 0.03, () => R3 + 0.2 + Math.random() * (R1 - R3 - 0.3), [0.0003, 0.0006]);
  orb.add(textOuter, textInner, textAmbient);

  // Orbiting debris
  const debrisGeos = [
    new THREE.IcosahedronGeometry(0.012, 0), new THREE.IcosahedronGeometry(0.02, 0), new THREE.IcosahedronGeometry(0.03, 1),
    new THREE.IcosahedronGeometry(0.008, 0), new THREE.TetrahedronGeometry(0.015, 0), new THREE.OctahedronGeometry(0.018, 0),
  ];
  const debrisMats = [meshMat('bright', 0.8), meshMat('mid', 0.6), meshMat('mid', 0.35)];
  const debris = [];
  for (let i = 0; i < (low ? 100 : 220); i++) {
    const d = new THREE.Mesh(debrisGeos[i % debrisGeos.length], debrisMats[i % debrisMats.length]);
    d.userData = { r: 1.2 + Math.random() * 4, speed: (0.08 + Math.random() * 0.6) * (Math.random() > 0.5 ? 1 : -1), tiltX: (Math.random() - 0.5) * Math.PI * 0.9, tiltZ: (Math.random() - 0.5) * Math.PI * 0.5, phase: Math.random() * Math.PI * 2 };
    debris.push(d);
    orb.add(d);
  }

  // Dust
  const dustCount = low ? 800 : 2000;
  const dustPos = new Float32Array(dustCount * 3);
  for (let i = 0; i < dustCount; i++) {
    const v = new THREE.Vector3().setFromSphericalCoords(0.5 + Math.pow(Math.random(), 0.6) * 7, Math.acos(2 * Math.random() - 1), Math.random() * Math.PI * 2);
    dustPos.set([v.x, v.y, v.z], i * 3);
  }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.Float32BufferAttribute(dustPos, 3));
  const dot = document.createElement('canvas');
  dot.width = dot.height = 64;
  const dctx = dot.getContext('2d');
  const grad = dctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.15)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  dctx.fillStyle = grad;
  dctx.fillRect(0, 0, 64, 64);
  const dustMat = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(dot), size: 0.04, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, color: pal.bright });
  roles.bright.push(dustMat);
  const dust = new THREE.Points(dustGeo, dustMat);
  orb.add(dust);

  // Scan rings
  const scanRing = (r, thick) => {
    const m = new THREE.Mesh(new THREE.RingGeometry(r - thick, r + thick, 120), meshMat('bright', 0));
    m.material.side = THREE.DoubleSide;
    m.rotation.x = Math.PI / 2;
    orb.add(m);
    return m;
  };
  const scan1 = scanRing(R1, 0.01);
  const scan2 = scanRing(R1 * 0.7, 0.008);

  // ——— state ———
  const now = { ...STATES.standby };
  let target = STATES.standby;
  let level = 0; // live voice level 0..1
  let levelTarget = 0;
  let surgeT = 0;

  const offset = new THREE.Vector3();
  const sph = new THREE.Spherical();
  function rotateBy(dTheta, dPhi) {
    offset.copy(camera.position).sub(controls.target);
    sph.setFromVector3(offset);
    sph.theta -= dTheta;
    sph.phi = THREE.MathUtils.clamp(sph.phi - dPhi, 0.05, Math.PI - 0.05);
    sph.makeSafe();
    offset.setFromSpherical(sph);
    camera.position.copy(controls.target).add(offset);
    camera.lookAt(controls.target);
  }
  function zoomBy(f) {
    offset.copy(camera.position).sub(controls.target);
    offset.setLength(THREE.MathUtils.clamp(offset.length() * f, MIN_DISTANCE, MAX_DISTANCE));
    camera.position.copy(controls.target).add(offset);
  }
  function resetView() {
    camera.position.copy(HOME);
    controls.target.set(0, 0, 0);
    camera.lookAt(controls.target);
    controls.update();
  }

  const clock = new THREE.Clock();
  let raf = 0;
  let running = false;
  let flicker = 0;
  let lastFrame = 0;
  let fpsCap = 60;

  function frame(ms) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (ms - lastFrame < 1000 / fpsCap - 2) return;
    lastFrame = ms;
    const dt = Math.min(clock.getDelta(), 0.1);
    const t = clock.elapsedTime;
    const ease = 1 - Math.pow(0.02, dt);
    for (const k of Object.keys(now)) now[k] += (target[k] - now[k]) * ease;
    level += (levelTarget - level) * (1 - Math.pow(0.0005, dt));
    const s = now.spin * dt * 60;

    outer.rotation.y += 0.0015 * s;
    outer.rotation.x = Math.sin(t * 0.08) * 0.05;
    panels.rotation.y += 0.0018 * s;
    panels.rotation.x = Math.sin(t * 0.08 + 0.5) * 0.04;
    shell2.rotation.y -= 0.001 * s;
    shell2.rotation.z = Math.sin(t * 0.12) * 0.03;
    inner.rotation.y -= 0.005 * s;
    inner.rotation.z += 0.002 * s;
    inner.rotation.x = Math.cos(t * 0.1) * 0.08;
    ico.rotation.x += 0.008 * s;
    ico.rotation.y += 0.012 * s;

    // Core: the reference's slow surges, plus the live voice level.
    surgeT += dt;
    const w3 = Math.pow(Math.max(0, Math.sin(surgeT * 0.4)), 5);
    const w4 = Math.pow(Math.max(0, Math.sin(surgeT * 0.7 + 2)), 8);
    const fadeOut = Math.pow(Math.max(0, Math.sin(surgeT * 0.25)), 3) * now.fade;
    const surge = ((w3 * 1.5 + w4 * 2) * 0.5) * (1 - fadeOut) + level * 2.5;
    core.scale.setScalar(1 + surge + Math.sin(t * 5) * 0.05);
    coreMat.opacity = Math.max(0, Math.min(0.6, (now.core + Math.sin(t * 1.2) * 0.04 + surge * 0.18) * (1 - fadeOut * 0.95)));
    glow.scale.setScalar(1 + surge * 0.8);
    glowMat.opacity = Math.min(0.25, 0.03 + surge * 0.08 + now.core * 0.1);
    ico.scale.setScalar(1 + surge * 0.6);
    icoMat.opacity = Math.min(1, 0.5 + surge * 0.4);

    for (const d of debris) {
      const u = d.userData;
      const a = t * u.speed + u.phase;
      d.position.set(u.r * Math.cos(a) * Math.cos(u.tiltX), u.r * Math.sin(u.tiltX) * Math.sin(a * 0.8) + Math.sin(a * 0.3 + u.tiltZ) * 0.2, u.r * Math.sin(a) * Math.cos(u.tiltZ));
      d.rotation.x += 0.015;
      d.rotation.z += 0.01;
    }
    for (const [group, mult] of [[textOuter, 1], [textInner, 2], [textAmbient, 1.2]]) {
      for (const sp of group.children) {
        const u = sp.userData;
        u.theta += u.speed * mult * now.text * dt * 60;
        sp.position.setFromSphericalCoords(u.r, u.phi, u.theta);
      }
    }

    const y1 = Math.sin(t * 0.4 * Math.max(1, now.spin * 0.6)) * R1;
    const k1 = Math.sqrt(Math.max(0, R1 * R1 - y1 * y1)) / R1;
    scan1.position.y = y1;
    scan1.scale.set(k1, k1, 1);
    scan1.material.opacity = now.scan * k1;
    const y2 = Math.sin(t * 0.6 + 2) * R3;
    const k2 = Math.sqrt(Math.max(0, R3 * R3 - y2 * y2)) / R3;
    scan2.position.y = y2;
    scan2.scale.set(k2, k2, 1);
    scan2.material.opacity = now.scan * 0.75 * k2 + level * 0.4;

    dust.rotation.y += 0.0002 * s;
    flicker += dt;
    if (flicker > 0.1) {
      flicker = 0;
      const p = target === STATES.thinking ? 0.85 : 0.95;
      for (const panel of panels.children) if (Math.random() > p) panel.visible = !panel.visible;
    }
    bloom.strength = now.bloom + Math.sin(t * 0.8) * 0.2 + level * 0.6;
    chromatic.uniforms.uTime.value = t;
    controls.update();
    composer.render();
  }

  function resize() {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    composer.setSize(w, h);
  }
  const ro = new ResizeObserver(resize);
  ro.observe(container);

  return {
    // 'standby' | 'listening' | 'thinking' | 'speaking'
    setState(name) { target = STATES[name] || STATES.standby; },
    // 0..1, how loud the voice is right now (mic or Scorpion speaking)
    setLevel(v) { levelTarget = Math.max(0, Math.min(1, v)); },
    setAccent(color) {
      pal = paletteFrom(color);
      for (const [role, mats] of Object.entries(roles)) for (const m of mats) m.color.copy(pal[role]);
      chromatic.uniforms.uTint.value = pal.tint;
      drawAtlas();
      for (const m of textMats) m.map.needsUpdate = true;
    },
    // Fewer frames while the AI model is busy on the same GPU.
    setFrameCap(fps) { fpsCap = fps; },
    rotateBy,
    zoomBy,
    zoomIn: () => zoomBy(0.65),
    zoomOut: () => zoomBy(1.55),
    resetView,
    start() {
      if (running) return;
      running = true;
      clock.getDelta();
      resize();
      raf = requestAnimationFrame(frame);
    },
    stop() { running = false; cancelAnimationFrame(raf); },
    dispose() {
      this.stop();
      ro.disconnect();
      controls.dispose();
      scene.traverse((o) => {
        o.geometry?.dispose();
        for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
      });
      atlas.dispose();
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
