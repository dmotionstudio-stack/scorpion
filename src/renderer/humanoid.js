// The orb's screen as a holographic humanoid (Settings → General → Orb look), in real 3D: one continuous body of glowing
// contour lines, from the crown of a smooth faceless head down through the neck into rounded shoulders, so the head and the
// body are one surface. The head bends and turns on the neck (the lines near the neck follow it gradually, so nothing ever
// separates), a warm light glows in the face, warm veins run down the neck to a knot of light on the chest, dust rises off the
// crown, dotted rings pulse out behind it, and a constellation of stars joined by glowing veins, with light running along
// them, fills the whole screen. The lines take the theme's colour; the warm light is that colour's opposite.
//
// It is alive: the head turns toward the pointer or your pointing hand and toward your face (the camera), leans in and tilts
// while listening, bobs with its voice while speaking, nods when you pick something or a command goes well and shakes its head
// at an alert; the lines ripple, the rings pulse, the dust and the constellation stir while thinking, the camera sways a
// little (drag to look around, scroll to come closer), and the face's light and the veins brighten with the voice. It offers
// the same calls as the 3D orb (orb.js), so voice, hand gestures, apps inside the orb and Scorpion's own shortcuts work
// unchanged; the orb's shortcut rings are not part of it.
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';

const TARGET = new THREE.Vector3(0, 0.45, 0); // what the camera looks at (its height follows the zoom: the figure always sits on the bottom edge)
const HALF_FOV_TAN = Math.tan((40 / 2) * Math.PI / 180);
const HEAD_CENTRE_Y = 1.25;
const NECK_PIVOT = new THREE.Vector3(0, 0.35, -0.04); // where the head bends, at the base of the neck
const Y_TOP = 1.97;
const Y_BOTTOM = -1.4;

// How each conversation state looks. Values ease toward these targets.
const STATES = {
  standby: { listen: 0, swirl: 0, face: 0.45, glow: 0.85, lean: 0, tilt: 0, rings: 0.3, veins: 0.5, wave: 0.5, pulses: 0.5 },
  listening: { listen: 1, swirl: 0.15, face: 0.8, glow: 1.1, lean: 0.17, tilt: 0.24, rings: 1, veins: 0.7, wave: 1, pulses: 1 },
  thinking: { listen: 0, swirl: 1, face: 0.6, glow: 1.05, lean: -0.03, tilt: -0.06, rings: 0.6, veins: 0.9, wave: 1.6, pulses: 2 },
  speaking: { listen: 0, swirl: 0.2, face: 0.9, glow: 1.1, lean: 0.04, tilt: 0, rings: 0.8, veins: 1, wave: 1.2, pulses: 1.3 },
  acting: { listen: 0, swirl: 0.6, face: 0.7, glow: 1, lean: 0, tilt: 0, rings: 0.5, veins: 0.9, wave: 1.2, pulses: 1.6 },
  waiting: { listen: 0, swirl: 0.05, face: 0.55, glow: 0.9, lean: 0.06, tilt: 0.08, rings: 0.5, veins: 0.6, wave: 0.7, pulses: 0.7 },
};

// ---------- colour ----------
export function hexToHsl(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ''));
  const n = m ? parseInt(m[1], 16) : 0xf0a830;
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: h / 6, s, l };
}
// The theme's colour and its opposite: the lines, and the warm light inside.
export function humanoidPalette(accent) {
  const { h, s } = hexToHsl(accent);
  const sat = Math.max(0.6, s);
  const mk = (hue, l) => ({ h: ((hue % 1) + 1) % 1, s: Math.min(1, sat), l });
  return { line: mk(h, 0.52), rim: mk(h, 0.68), dim: mk(h, 0.34), warm: mk(h + 0.5, 0.56), hot: mk(h + 0.5, 0.72) };
}
const toColor = (c) => new THREE.Color().setHSL(c.h, c.s, c.l);

// ---------- helpers ----------
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const gauss = (x, w) => Math.exp(-(x * x) / (w * w));
// A smooth curve through points [x, y] (cubic, tangents from the neighbours).
function spline(pts) {
  const n = pts.length;
  const tan = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)]; const b = pts[Math.min(n - 1, i + 1)]; return (b[1] - a[1]) / ((b[0] - a[0]) || 1); });
  return (x) => {
    if (x <= pts[0][0]) return pts[0][1];
    if (x >= pts[n - 1][0]) return pts[n - 1][1];
    let i = 0;
    while (x > pts[i + 1][0]) i++;
    const h = pts[i + 1][0] - pts[i][0];
    const t = (x - pts[i][0]) / h, t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * pts[i][1] + (t3 - 2 * t2 + t) * h * tan[i] + (-2 * t3 + 3 * t2) * pts[i + 1][1] + (t3 - t2) * h * tan[i + 1];
  };
}

// ---------- the body: one continuous surface ----------
// Its half-width (across) and half-depth (front to back) at a height, from the shoulders up through the neck and the head to
// the crown. One smooth curve each, so the neck flows out of the jaw above and into the shoulders below.
export const profileHalfWidth = spline([[-1.4, 1.85], [-1.0, 1.9], [-0.65, 1.85], [-0.4, 1.6], [-0.22, 1.2], [-0.1, 0.78], [0.02, 0.46], [0.16, 0.32], [0.34, 0.27], [0.52, 0.28], [0.7, 0.35], [0.9, 0.43], [1.1, 0.48], [1.3, 0.5], [1.5, 0.48], [1.7, 0.4], [1.85, 0.26], [1.94, 0.1], [1.97, 0]]);
export const profileDepth = spline([[-1.4, 0.55], [-0.7, 0.56], [-0.3, 0.5], [-0.1, 0.4], [0.05, 0.3], [0.2, 0.25], [0.34, 0.23], [0.52, 0.25], [0.72, 0.35], [0.9, 0.44], [1.1, 0.48], [1.3, 0.5], [1.5, 0.48], [1.7, 0.4], [1.85, 0.26], [1.94, 0.1], [1.97, 0]]);
// How much of the head's movement a height takes: none at the shoulders, all of it at the jaw, the neck in between.
export const skinWeight = (y) => smooth(0.25, 0.8, y);

// A point on the surface at a height y and an angle phi round it (0 = to the right, π/2 = toward you), with its normal.
export function surface(y, phi) {
  const W = profileHalfWidth(y), D = profileDepth(y);
  const dy = 0.01;
  const dW = (profileHalfWidth(y + dy) - profileHalfWidth(y - dy)) / (2 * dy);
  const dD = (profileDepth(y + dy) - profileDepth(y - dy)) / (2 * dy);
  const c = Math.cos(phi), s = Math.sin(phi);
  let nx = D * c, ny = -dD * W * s * s - dW * D * c * c, nz = W * s;
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len; ny /= len; nz /= len;
  return { x: W * c, y, z: D * s, nx, ny, nz };
}
// The warm light inside the face: strongest low on the face, toward you.
const faceLight = (x, y, nz) => gauss((y - 0.98) / 0.46, 1) * gauss(x / 0.3, 1) * smooth(0.1, 0.55, nz);

// Head moves: a nod (yes, done) or a shake (no, an alert), as angles over time t (seconds since it started).
export function headGesture(kind, t) {
  if (t < 0 || t > 1.1) return { pitch: 0, yaw: 0 };
  const fade = 1 - t / 1.1;
  if (kind === 'nod') return { pitch: Math.sin(t * Math.PI * 3.6) * 0.14 * fade, yaw: 0 };
  if (kind === 'shake') return { pitch: 0, yaw: Math.sin(t * Math.PI * 5) * 0.2 * fade };
  return { pitch: 0, yaw: 0 };
}

// What the figure is made of, as flat arrays for the graphics card. Lines: pairs of vertices (segments); dots: points.
// kind: 0 ring line, 1 meridian line, 2 vein, 3 knot of light, 4 dust and bubbles, 5 background rings, 6 face glow.
export function buildBody(q = 1) {
  const rand = rng(7);
  const lines = { pos: [], nrm: [], seed: [], warm: [], glow: [], kind: [] };
  const dots = { pos: [], nrm: [], seed: [], warm: [], glow: [], kind: [] };
  const put = (set, x, y, z, nx, ny, nz, seed, warm, glow, kind) => { set.pos.push(x, y, z); set.nrm.push(nx, ny, nz); set.seed.push(seed); set.warm.push(warm); set.glow.push(glow); set.kind.push(kind); };

  // Rings round the body, one above the other, from the shoulders to the crown (the front bright, the back faint).
  const dy = 0.034 / Math.sqrt(q);
  for (let y = Y_BOTTOM; y <= Y_TOP - 0.004; y += dy) {
    const segs = Math.max(56, Math.round(150 * q));
    const fade = smooth(Y_BOTTOM, -0.85, y);
    const base = (y > 0.5 ? 0.42 : 0.26) * (0.3 + 0.7 * fade);
    for (let i = 0; i < segs; i++) {
      const sd = rand();
      for (const j of [i, i + 1]) {
        const p = surface(y, (j / segs) * Math.PI * 2);
        put(lines, p.x, p.y, p.z, p.nx, p.ny, p.nz, sd, faceLight(p.x, p.y, p.nz), base, 0);
      }
    }
  }
  // Faint lines running from the crown down over the head, neck and shoulders, so the body reads as a surface.
  const M = Math.round(26 * Math.max(0.6, q));
  for (let m = 0; m < M; m++) {
    const phi = (m / M) * Math.PI * 2;
    for (let y = Y_BOTTOM; y < Y_TOP - 0.06; y += 0.05) {
      const sd = rand();
      for (const yy of [y, y + 0.05]) {
        const p = surface(Math.min(yy, Y_TOP - 0.005), phi);
        put(lines, p.x, p.y, p.z, p.nx, p.ny, p.nz, sd, 0, 0.1 * (0.3 + 0.7 * smooth(Y_BOTTOM, -0.85, yy)), 1);
      }
    }
  }
  // The veins: lightning-like warm branches from under the jaw, down the neck to the knot of light on the chest.
  const frontZ = (x, y) => profileDepth(y) * Math.sqrt(Math.max(0, 1 - (x / profileHalfWidth(y)) ** 2)) + 0.012;
  const grow = (x, y, dir, len, depth) => {
    let px = x, py = y;
    for (let i = 0; i < len; i++) {
      const nx = px + dir * 0.004 - px * 0.03 + (rand() - 0.5) * 0.04;
      const ny = py - 0.028 - rand() * 0.02;
      if (ny < -0.62) break;
      const sd = rand();
      put(lines, px, py, frontZ(px, py), 0, 0, 1, sd, 1, 1, 2);
      put(lines, nx, ny, frontZ(nx, ny), 0, 0, 1, sd, 1, 1, depth);
      if (depth < 1 && rand() < 0.1) grow(nx, ny, (rand() - 0.5) * 3, Math.round(len * 0.35), depth + 1);
      px = nx; py = ny;
    }
  };
  for (const x of [-0.085, -0.03, 0.035, 0.09]) grow(x, 0.62, -Math.sign(x) * 0.5, 48, 2);
  // The knot of light low on the neck's flare.
  for (let i = 0; i < 260 * q; i++) {
    const a = rand() * Math.PI * 2, r = Math.sqrt(rand()) * 0.12;
    const x = Math.cos(a) * r, y = -0.62 + Math.sin(a) * r * 0.8;
    put(dots, x, y, frontZ(x, y) + rand() * 0.03, 0, 0, 1, rand(), 0, 0.9, 3);
  }
  // Dust rising off the crown, and a few larger bubbles drifting round the head.
  for (let i = 0; i < 1500 * q; i++) {
    const a = rand() * Math.PI * 2, h = rand() ** 1.5;
    const spread = (0.36 + h * 0.5 + rand() * 0.15) * Math.sqrt(rand());
    put(dots, Math.cos(a) * spread, Y_TOP + 0.02 + h * 0.75, Math.sin(a) * spread * 0.7, 0, 0, 1, rand(), 0, 0.6, 4);
  }
  for (let i = 0; i < 160 * q; i++) {
    const y = 0.7 + rand() * 1.5;
    const a = rand() * Math.PI * 2;
    const r = profileHalfWidth(y) + 0.05 + rand() * rand() * 0.8;
    put(dots, Math.cos(a) * r, y, Math.sin(a) * r * 0.9, 0, 0, 1, rand(), 0, 2.2, 4);
  }
  // Soft sprites for the glow inside the face.
  for (let i = 0; i < 46; i++) {
    const x = (rand() - 0.5) * 0.5, y = 0.98 + (rand() - 0.5) * 0.7;
    put(dots, x, y, frontZ(x, y) - 0.04, 0, 0, 1, rand(), 1, 1, 6);
  }
  // Dotted rings of light behind the head.
  for (let k = 0; k < 15; k++) {
    const r = 1.2 + k * 0.34;
    const n = Math.round(130 * r * q);
    for (let i = 0; i < n; i++) {
      if (rand() < 0.06) continue;
      const a = (i / n) * Math.PI * 2;
      put(dots, Math.cos(a) * r, HEAD_CENTRE_Y + Math.sin(a) * r, -1.0, 0, 0, 1, rand(), 0, 0.95 - k * 0.03, 5);
    }
  }
  const pack = (s) => ({ count: s.seed.length, position: new Float32Array(s.pos), normal: new Float32Array(s.nrm), seed: new Float32Array(s.seed), warm: new Float32Array(s.warm), glow: new Float32Array(s.glow), kind: new Float32Array(s.kind) });
  return { lines: pack(lines), dots: pack(dots) };
}

// The constellation: stars scattered through the depth behind the figure, each joined to its nearest neighbours by a vein.
export function buildConstellation(q = 1) {
  const rand = rng(23);
  const n = Math.round(2600 * q);
  const stars = [];
  for (let i = 0; i < n; i++) {
    const z = -(2.6 + rand() * 6.5);
    stars.push({ x: (rand() * 2 - 1) * (6 + -z * 0.95), y: 1.7 + (rand() * 2 - 1) * (3.6 + -z * 0.55), z, seed: rand() });
  }
  const seen = new Set();
  const links = [];
  for (let i = 0; i < n; i++) {
    const near = stars.map((s, j) => ({ j, d: j === i ? 1e9 : Math.hypot(s.x - stars[i].x, s.y - stars[i].y, (s.z - stars[i].z) * 1.4) })).sort((a, b) => a.d - b.d).slice(0, 3);
    for (const { j, d } of near) {
      if (d > 0.9) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      links.push([i, j, rand()]);
    }
  }
  return { stars, links };
}

// ---------- the shaders ----------
const BODY_VERTEX = `
  uniform float uTime, uLevel, uSwirl, uSize, uFace, uRings, uGlow, uVeins, uListen;
  uniform vec3 uRot, uPivot, uLine, uRim, uDim, uWarm, uHot;
  attribute vec3 aNormal;
  attribute float aSeed, aWarm, aGlow, aKind;
  varying vec3 vCol;
  varying float vAlpha;
  mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a) { float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a) { float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
  void main() {
    vec3 p = position;
    float t = uTime;
    float w = aKind > 4.5 && aKind < 5.5 ? 0.0 : smoothstep(0.25, 0.8, p.y);
    float rise = fract(aSeed * 7.0 + t * 0.05 * (1.0 + uSwirl * 2.5));
    if (aKind < 1.5) {
      // The lines ripple like liquid (more while thinking, and across the face with the voice), and the body breathes.
      p.y += sin(p.x * 9.0 + t * 1.5 + p.z * 4.0) * 0.004 * (1.0 + uSwirl * 3.0);
      p.y += sin(p.x * 14.0 + t * 1.2) * 0.012 * aWarm;
      p.y += sin(p.x * 22.0 - t * 6.0) * 0.012 * uLevel * aWarm;
      p.y += sin(p.x * 30.0 + t * 9.0) * 0.006 * uListen * (0.3 + uLevel * 2.0) * smoothstep(0.3, 1.0, p.y);
      p *= 1.0 + 0.005 * sin(t * 1.2);
    } else if (aKind > 3.5 && aKind < 4.5) {
      p.y += rise * 0.4;
      p.x += sin(t * 0.7 + aSeed * 50.0) * 0.02;
    }
    // The head bends on the neck: the nearer the head, the more of the turn a point takes, so the neck bends smoothly.
    mat3 R = rotY(uRot.y * w) * rotX(uRot.x * w) * rotZ(uRot.z * w);
    p = uPivot + R * (p - uPivot);
    vec3 n = R * aNormal;
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    vec3 nv = normalize(normalMatrix * n);
    float fres = 1.0 - abs(dot(nv, normalize(-mv.xyz)));
    float front = smoothstep(-0.35, 0.45, nv.z);
    float warm = clamp(aWarm * (0.6 + uFace * 1.0 + uLevel * 1.2), 0.0, 1.0);
    vec3 col = uLine;
    float glow = aGlow;
    vAlpha = 0.85;
    gl_PointSize = 1.0;
    if (aKind < 0.5) {
      // A ring of the body: the front bright, the back faint, a bright rim where the surface turns away.
      glow = aGlow * (0.3 + 0.7 * front) + pow(fres, 2.4) * aGlow * 3.4;
      col = mix(uLine, uRim, clamp(pow(fres, 2.0), 0.0, 1.0));
      col = mix(col, uWarm, warm);
      glow *= 1.0 + warm * (0.9 + uLevel);
    } else if (aKind < 1.5) {
      glow = aGlow * (0.4 + 0.6 * front) + pow(fres, 2.0) * aGlow * 2.0;
    } else if (aKind < 2.5) {
      float flick = 0.8 + 0.2 * sin(t * 9.0 + aSeed * 40.0 + sin(t * 3.1) * 2.0);
      col = uHot;
      glow = (0.18 + uVeins * 0.34 + uLevel * 0.5) * flick * 1.6;
    } else if (aKind < 3.5) {
      col = mix(uRim, uHot, 0.4 + 0.3 * sin(t * 2.0 + aSeed * 30.0));
      glow = aGlow * (0.8 + 0.2 * sin(t * 3.0 + aSeed * 50.0));
      gl_PointSize = uSize * (0.6 + aSeed) * (9.0 / -mv.z);
      vAlpha = 0.9;
    } else if (aKind < 4.5) {
      col = uRim;
      float big = aGlow > 1.0 ? 1.0 : 0.0;
      glow = (aGlow > 1.0 ? 0.55 * (0.4 + 0.6 * sin(t * 0.8 + aSeed * 50.0) * sin(t * 0.8 + aSeed * 50.0)) : aGlow * (1.0 - rise));
      gl_PointSize = uSize * (big > 0.5 ? 2.2 : 0.7 + aSeed * 1.0) * (9.0 / -mv.z);
      vAlpha = 0.8;
    } else if (aKind < 5.5) {
      // The dotted rings: a wave goes out from the head along them.
      float r = length(position.xy - vec2(0.0, 1.25));
      float front = mix(mod(t * 0.7, 4.8) + 0.9, 5.7 - mod(t * 1.5, 4.8), uListen);
      float wave = exp(-pow(r - front, 2.0) * mix(3.0, 5.0, uListen));
      float wave2 = uListen * exp(-pow(r - (5.7 - mod(t * 1.5 + 2.4, 4.8)), 2.0) * 5.0);
      wave = max(wave, wave2);
      col = mix(uDim, uRim, wave * uRings);
      glow = aGlow * (0.5 + uRings * 1.5 * wave + uListen * uLevel * 1.4);
      gl_PointSize = uSize * 1.7 * (9.0 / -mv.z);
      vAlpha = 0.9;
    } else {
      // The glow inside the face: big soft sprites.
      col = uWarm;
      glow = 0.05 * (0.5 + uFace + uLevel * 1.5) * (1.0 - 0.55 * uListen);
      gl_PointSize = 60.0 * (0.6 + aSeed * 0.8) * (9.0 / -mv.z);
      vAlpha = 1.0;
    }
    vCol = col * glow * uGlow;
  }`;
const LINE_FRAGMENT = 'varying vec3 vCol; varying float vAlpha; void main() { gl_FragColor = vec4(vCol, vAlpha); }';
const POINT_FRAGMENT = `
  varying vec3 vCol; varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vCol, smoothstep(0.5, 0.0, d) * vAlpha);
  }`;

const STAR_FRAGMENT = `
  varying vec3 vCol;
  void main() {
    float d = length(gl_PointCoord - 0.5);
    if (d > 0.5) discard;
    gl_FragColor = vec4(vCol, smoothstep(0.5, 0.0, d));
  }`;
const LINK_FRAGMENT = 'varying vec3 vCol; void main() { gl_FragColor = vec4(vCol, 0.9); }';
const STAR_VERTEX = `
  uniform float uTime, uSize, uStir;
  uniform vec3 uRim;
  attribute float aSeed;
  varying vec3 vCol;
  void main() {
    vec3 p = position;
    float t = uTime;
    p += vec3(sin(t * 0.1 + aSeed * 30.0), cos(t * 0.12 + aSeed * 20.0), sin(t * 0.08 + aSeed * 11.0)) * (0.1 + uStir * 0.12);
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = uSize * (0.5 + aSeed * 1.1) * (11.0 / -mv.z);
    float twinkle = 0.5 + 0.5 * sin(t * (1.0 + aSeed * 2.0) + aSeed * 60.0);
    vCol = uRim * (0.4 + 0.9 * twinkle);
  }`;
const LINK_VERTEX = `
  uniform float uTime, uStir, uPulses;
  uniform vec3 uDim, uHot;
  attribute float aSeed, aAlong, aPhase;
  varying vec3 vCol;
  void main() {
    vec3 p = position;
    float t = uTime;
    p += vec3(sin(t * 0.1 + aSeed * 30.0), cos(t * 0.12 + aSeed * 20.0), sin(t * 0.08 + aSeed * 11.0)) * (0.1 + uStir * 0.12);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    // A pulse of light runs along the vein, now and then.
    float pos = fract(t * (0.12 + 0.06 * uPulses) + aPhase);
    float pulse = exp(-pow((pos - aAlong) * 6.0, 2.0)) * smoothstep(0.35, 0.0, abs(fract(aPhase * 7.0 + t * 0.05) - 0.5) - 0.1);
    vCol = mix(uDim * 0.9, uHot, clamp(pulse * uPulses, 0.0, 1.0)) * (0.7 + 2.4 * pulse * uPulses);
  }`;

export function createHumanoid(container, { accent, quality = 'high' } = {}) {
  const low = quality === 'low';
  const q = low ? 0.45 : 1;
  let pal = humanoidPalette(accent);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, (container.clientWidth || 1) / (container.clientHeight || 1), 0.1, 200);
  const renderer = new THREE.WebGLRenderer({ antialias: !low, powerPreference: low ? 'low-power' : 'high-performance' });
  const FULL_RATIO = low ? 1 : Math.min(window.devicePixelRatio, 1.5);
  renderer.setPixelRatio(FULL_RATIO);
  renderer.setSize(container.clientWidth || 1, container.clientHeight || 1);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  container.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = 'none';

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(container.clientWidth || 1, container.clientHeight || 1), 0.85, 0.55, 0.3);
  composer.addPass(bloom);

  // ---- the figure ----
  const bodyU = {
    uTime: { value: 0 }, uLevel: { value: 0 }, uSwirl: { value: 0 }, uSize: { value: low ? 1.7 : 1.35 }, uFace: { value: 0.5 }, uRings: { value: 0.3 }, uGlow: { value: 1 }, uVeins: { value: 0.5 }, uListen: { value: 0 },
    uRot: { value: new THREE.Vector3() }, uPivot: { value: NECK_PIVOT.clone() },
    uLine: { value: toColor(pal.line) }, uRim: { value: toColor(pal.rim) }, uDim: { value: toColor(pal.dim) }, uWarm: { value: toColor(pal.warm) }, uHot: { value: toColor(pal.hot) },
  };
  const makeMat = (vertexShader, fragmentShader, uniforms) => new THREE.ShaderMaterial({ uniforms, vertexShader, fragmentShader, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
  const geometry = (d, attrs) => {
    const g = new THREE.BufferGeometry();
    for (const [name, arr, n] of attrs) g.setAttribute(name, new THREE.BufferAttribute(arr, n));
    return g;
  };
  const body = buildBody(q);
  const bodyAttrs = (b) => [['position', b.position, 3], ['aNormal', b.normal, 3], ['aSeed', b.seed, 1], ['aWarm', b.warm, 1], ['aGlow', b.glow, 1], ['aKind', b.kind, 1]];
  const figure = new THREE.Group();
  scene.add(figure);
  const bodyLines = new THREE.LineSegments(geometry(body.lines, bodyAttrs(body.lines)), makeMat(BODY_VERTEX, LINE_FRAGMENT, bodyU));
  const bodyDots = new THREE.Points(geometry(body.dots, bodyAttrs(body.dots)), makeMat(BODY_VERTEX, POINT_FRAGMENT, bodyU));
  for (const o of [bodyLines, bodyDots]) { o.frustumCulled = false; figure.add(o); }

  // ---- the constellation ----
  const con = buildConstellation(q);
  const starU = { uTime: bodyU.uTime, uSize: { value: low ? 3.0 : 2.6 }, uStir: { value: 0 }, uRim: bodyU.uRim };
  const stars = new THREE.Points(geometry(null, [
    ['position', new Float32Array(con.stars.flatMap((s) => [s.x, s.y, s.z])), 3],
    ['aSeed', new Float32Array(con.stars.map((s) => s.seed)), 1],
  ]), makeMat(STAR_VERTEX, STAR_FRAGMENT, starU));
  const linkU = { uTime: bodyU.uTime, uStir: starU.uStir, uPulses: { value: 0.5 }, uDim: bodyU.uDim, uHot: bodyU.uHot };
  const linkPos = [], linkSeed = [], linkAlong = [], linkPhase = [];
  for (const [i, j, ph] of con.links) {
    for (const [s, along] of [[con.stars[i], 0], [con.stars[j], 1]]) { linkPos.push(s.x, s.y, s.z); linkSeed.push(s.seed); linkAlong.push(along); linkPhase.push(ph); }
  }
  const links = new THREE.LineSegments(geometry(null, [
    ['position', new Float32Array(linkPos), 3], ['aSeed', new Float32Array(linkSeed), 1], ['aAlong', new Float32Array(linkAlong), 1], ['aPhase', new Float32Array(linkPhase), 1],
  ]), makeMat(LINK_VERTEX, LINK_FRAGMENT, linkU));
  const sky = new THREE.Group();
  sky.add(stars, links);
  for (const o of [stars, links]) o.frustumCulled = false;
  scene.add(sky);

  // A ring that spreads out behind the head for a pulse (alerts, confirmations).
  const pulseMat = new THREE.MeshBasicMaterial({ color: toColor(pal.rim), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide });
  const pulseRing = new THREE.Mesh(new THREE.RingGeometry(0.98, 1, 128), pulseMat);
  pulseRing.position.set(0, HEAD_CENTRE_Y, -0.95);
  figure.add(pulseRing);
  const listenRings = [0, 1, 2].map(() => {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.985, 1, 128), new THREE.MeshBasicMaterial({ color: toColor(pal.warm), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide }));
    m.position.set(0, HEAD_CENTRE_Y, -0.9);
    figure.add(m);
    return m;
  });

  // ---- living ----
  let target = STATES.standby;
  let stateName = 'standby';
  const now = { ...STATES.standby };
  let level = 0, levelTarget = 0;
  const gaze = [0, 0]; // your face, from the camera
  let hand = null; // the pointer or your pointing hand: { x, y, at }
  const look = { yaw: 0, pitch: 0 };
  let gesture = { kind: null, at: -10 };
  let pulseT = -1, pulsesLeft = 0;
  let running = false, raf = 0, fpsCap = 60, last = 0;
  let viewTarget = null;
  const view = { cx: 0.5, cy: 0.5, k: 1 };
  const cam = { yaw: 0, pitch: 0.06, dist: 6.3 };
  const camGoal = { yaw: 0, pitch: 0.06, dist: 6.3 };
  const clock = new THREE.Clock();
  const act = (kind) => { gesture = { kind, at: clock.elapsedTime }; };

  let listenK = 0;
  const mixC = (target, a, b, k) => target.copy(toColor(a)).lerp(toColor(b), k);
  function recolour() {
    // listening turns the figure to the opposite colour (the theme colour moves inside)
    mixC(bodyU.uLine.value, pal.line, { ...pal.warm, s: 1, l: 0.46 }, listenK);
    mixC(bodyU.uRim.value, pal.rim, { ...pal.warm, s: 1, l: 0.58 }, listenK);
    mixC(bodyU.uDim.value, pal.dim, { ...pal.warm, s: 1, l: 0.34 }, listenK);
    mixC(bodyU.uWarm.value, pal.warm, { ...pal.line, s: 1, l: 0.46 }, listenK);
    mixC(bodyU.uHot.value, pal.hot, { ...pal.line, s: 1, l: 0.6 }, listenK);
  }
  function applyView() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    if (Math.abs(view.k - 1) < 0.002 && Math.abs(view.cx - 0.5) < 0.002 && Math.abs(view.cy - 0.5) < 0.002) camera.clearViewOffset();
    else camera.setViewOffset(w / view.k, h / view.k, w / (2 * view.k) - view.cx * w, h / (2 * view.k) - view.cy * h, w, h);
    camera.updateProjectionMatrix();
  }
  function resize() {
    const w = container.clientWidth || 1;
    const h = container.clientHeight || 1;
    renderer.setSize(w, h);
    composer.setSize(w, h);
    camera.aspect = w / h;
    applyView();
  }
  const ro = new ResizeObserver(() => resize());
  ro.observe(container);

  // Drag to look around the figure, scroll to come closer or go back.
  let drag = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, yaw: camGoal.yaw, pitch: camGoal.pitch }; el.setPointerCapture?.(e.pointerId); });
  el.addEventListener('pointermove', (e) => {
    if (!drag) return;
    camGoal.yaw = Math.max(-1.2, Math.min(1.2, drag.yaw - (e.clientX - drag.x) * 0.006));
    camGoal.pitch = Math.max(-0.45, Math.min(0.6, drag.pitch + (e.clientY - drag.y) * 0.004));
  });
  const endDrag = () => { drag = null; };
  el.addEventListener('pointerup', endDrag);
  el.addEventListener('pointercancel', endDrag);
  el.addEventListener('dblclick', () => { camGoal.yaw = 0; camGoal.pitch = 0.06; camGoal.dist = 6.3; });
  el.addEventListener('wheel', (e) => { e.preventDefault(); camGoal.dist = Math.max(4, Math.min(14, camGoal.dist * (e.deltaY > 0 ? 1.08 : 0.92))); }, { passive: false });

  function frame(time) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    if (time - last < 1000 / fpsCap - 2) return;
    last = time;
    const dt = Math.min(0.05, clock.getDelta());
    const t = clock.elapsedTime;
    const ease = (a, b, k) => a + (b - a) * Math.min(1, dt * k);
    for (const k of Object.keys(now)) now[k] = ease(now[k], target[k], 2.5);
    level = ease(level, levelTarget, 12);
    for (const k of ['yaw', 'pitch', 'dist']) cam[k] = ease(cam[k], camGoal[k], 4);

    // Where the head looks: at the pointer or your hand while one is there (for 2.5 s after it stops), else at your face.
    const handNow = hand && t - hand.at < 2.5 ? hand : null;
    const goal = handNow ? { yaw: handNow.x * 0.6, pitch: -handNow.y * 0.35 } : { yaw: gaze[0] * 0.45, pitch: -gaze[1] * 0.25 };
    look.yaw = ease(look.yaw, goal.yaw, handNow ? 5 : 2.5);
    look.pitch = ease(look.pitch, goal.pitch, handNow ? 5 : 2.5);
    const gest = headGesture(gesture.kind, t - gesture.at);
    const bob = stateName === 'speaking' ? Math.sin(t * 7) * 0.03 * level : 0;
    const yaw = look.yaw + gest.yaw + Math.sin(t * 0.37) * 0.03;
    const pitch = look.pitch + now.lean * 0.6 + gest.pitch + bob + Math.sin(t * 0.29) * 0.015;
    const roll = now.tilt * (0.6 + 0.4 * Math.sin(t * 0.5)) * 0.5 - yaw * 0.08;
    bodyU.uRot.value.set(pitch, yaw, roll);
    bodyU.uTime.value = t;
    bodyU.uLevel.value = level;
    bodyU.uSwirl.value = now.swirl;
    bodyU.uListen.value = now.listen;
    if (Math.abs(now.listen - listenK) > 0.004) { listenK = now.listen; recolour(); }
    bodyU.uFace.value = now.face;
    bodyU.uRings.value = now.rings + level * 0.4;
    bodyU.uGlow.value = (now.glow + level * 0.3) * (1 - 0.45 * now.listen);
    bodyU.uVeins.value = now.veins;
    starU.uStir.value = now.swirl;
    linkU.uPulses.value = now.pulses + level;

    // The shoulders follow a little; the camera sways, and the stars turn slowly behind.
    figure.rotation.y = ease(figure.rotation.y, look.yaw * 0.15 + Math.sin(t * 0.21) * 0.025, 2);
    figure.position.y = Math.sin(t * 1.2) * 0.01;
    sky.rotation.y = Math.sin(t * 0.04) * 0.12;
    sky.rotation.z = Math.sin(t * 0.03) * 0.03;
    const cy = cam.yaw + Math.sin(t * 0.15) * 0.05 + look.yaw * 0.08;
    const cp = cam.pitch + Math.sin(t * 0.12) * 0.015;
    TARGET.y = Y_BOTTOM + HALF_FOV_TAN * cam.dist * 0.97; // the bottom of the body on the bottom edge of the screen, whatever the screen
    camera.position.set(TARGET.x + Math.sin(cy) * Math.cos(cp) * cam.dist, TARGET.y + Math.sin(cp) * cam.dist, TARGET.z + Math.cos(cy) * Math.cos(cp) * cam.dist);
    camera.lookAt(TARGET);

    if (pulseT >= 0) {
      pulseT += dt;
      const p = pulseT / 1.2;
      pulseRing.scale.setScalar(0.5 + p * 4.5);
      pulseMat.opacity = Math.max(0, 0.9 * (1 - p));
      if (p >= 1) { pulsesLeft -= 1; pulseT = pulsesLeft > 0 ? 0 : -1; if (pulseT < 0) pulseMat.opacity = 0; }
    }
    for (let i = 0; i < listenRings.length; i++) {
      const ph = (t * 0.55 + i / listenRings.length) % 1; // 0 far out, 1 at the head
      listenRings[i].scale.setScalar(0.75 + (1 - ph) * (2.6 + level * 1.4));
      listenRings[i].material.opacity = now.listen * Math.sin(ph * Math.PI) * (0.22 + level * 0.35);
      listenRings[i].material.color.copy(bodyU.uLine.value).multiplyScalar(0.8);
    }
    if (viewTarget) { view.cx = ease(view.cx, viewTarget.cx, 4); view.cy = ease(view.cy, viewTarget.cy, 4); view.k = ease(view.k, viewTarget.k, 4); }
    else { view.cx = ease(view.cx, 0.5, 4); view.cy = ease(view.cy, 0.5, 4); view.k = ease(view.k, 1, 4); }
    applyView();
    bloom.strength = (0.8 + level * 0.35 + (now.glow - 0.85) * 0.3) * (1 - 0.45 * now.listen);
    composer.render();
  }

  const api = {
    setState(name) {
      const next = STATES[name] ? name : 'standby';
      if (next === 'acting' && stateName !== 'acting') act('nod'); // a command is starting: "on it"
      stateName = next;
      target = STATES[next];
    },
    setGaze(x, y) { gaze[0] = Math.max(-1, Math.min(1, x || 0)); gaze[1] = Math.max(-1, Math.min(1, y || 0)); },
    setLevel(v) { levelTarget = Math.max(0, Math.min(1, v)); },
    setAccent(color) { pal = humanoidPalette(color); recolour(); },
    setSatellites() {},
    setRingLook() {},
    spinRings() {},
    // The pointer or a pointing hand (x, y: -1..1 across the view, y up): the head turns to it. Nothing to pick here.
    pointAt(x, y) { if (x == null) hand = null; else hand = { x: Math.max(-1, Math.min(1, x)), y: Math.max(-1, Math.min(1, y)), at: clock.elapsedTime }; return null; },
    // A click or a tap with the hand: it nods.
    pick(x, y) { if (x != null) { hand = { x, y, at: clock.elapsedTime }; act('nod'); } return null; },
    setTile(tile) {
      if (!tile) { viewTarget = null; return; }
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      viewTarget = { cx: Math.max(0, Math.min(1, tile.cx / w)), cy: Math.max(0, Math.min(1, tile.cy / h)), k: Math.max(0.22, Math.min(1, Math.min(tile.w / w, tile.h / h) * 1.15)) };
    },
    // The two-hand "zoom into" gesture: closer (amount: 0..1), or back.
    zoomToward(id, amount = 0) { camGoal.dist = 6.3 - Math.min(1, Math.max(0, amount)) * 4; },
    // 'info' | 'ok' | 'alert': a ring spreads out, and it nods (ok) or shakes its head (alert).
    pulse(kind = 'info') {
      pulseMat.color.copy(kind === 'alert' ? new THREE.Color('#ff4d4d') : kind === 'ok' ? new THREE.Color('#3fd48a') : toColor(pal.rim));
      pulsesLeft = kind === 'alert' ? 3 : 1;
      pulseT = 0;
      if (kind === 'ok') act('nod');
      if (kind === 'alert') act('shake');
    },
    setFrameCap(fps) { fpsCap = Math.max(10, Number(fps) || 60); },
    setMaxDetail(share = 1) { renderer.setPixelRatio(Math.min(FULL_RATIO, Math.max(0.5, FULL_RATIO * share))); resize(); },
    rotateBy(dx = 0, dy = 0) { camGoal.yaw = Math.max(-1.2, Math.min(1.2, camGoal.yaw - dx)); camGoal.pitch = Math.max(-0.45, Math.min(0.6, camGoal.pitch + dy)); },
    zoomBy(f) { camGoal.dist = Math.max(4, Math.min(14, camGoal.dist * f)); },
    zoomIn() { camGoal.dist = Math.max(4, camGoal.dist * 0.8); },
    zoomOut() { camGoal.dist = Math.min(14, camGoal.dist * 1.25); },
    resetView() { camGoal.yaw = 0; camGoal.pitch = 0.06; camGoal.dist = 6.3; },
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
      scene.traverse((o) => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) m.dispose(); });
      composer.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
  renderer.domElement.__orb = api; // for the screenshot tests
  return api;
}
