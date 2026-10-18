// Generates resources/icon.png (1024x1024): a yellow kunai on a black tile.
// Dependency-free: shapes are signed-distance functions, antialiased per pixel,
// encoded with a tiny PNG writer.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const N = 1024;
const px = Buffer.alloc(N * N * 4);
const clamp = (x) => Math.max(0, Math.min(1, x));
const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);

const YELLOW = [245, 197, 24];
const YELLOW_DARK = [196, 144, 0];
const WRAP = [28, 26, 20];
const BG_TOP = [30, 28, 24];
const BG_BOTTOM = [10, 10, 9];

// Kunai in local coordinates: u runs along the blade (up), v across it.
// Rotated 45° so the tip points to the top-right.
const ANGLE = -Math.PI / 4;
const CX = 0.5, CY = 0.53, SCALE = 1.0;

function toLocal(x, y) {
  const dx = (x - CX) / SCALE, dy = (y - CY) / SCALE;
  // rotate by -ANGLE; screen y grows downward, so u = up = -y
  const rx = dx * Math.cos(-ANGLE) - dy * Math.sin(-ANGLE);
  const ry = dx * Math.sin(-ANGLE) + dy * Math.cos(-ANGLE);
  return { u: -ry, v: rx };
}

// Signed distance approximations (negative inside).
function blade(u, v) {
  const u0 = 0.06, u1 = 0.43; // base → tip
  const t = (u - u0) / (u1 - u0);
  if (t < 0 || t > 1) return 1;
  const peak = 0.28;
  const half = 0.115 * (t < peak ? 0.55 + 0.45 * (t / peak) : (1 - t) / (1 - peak));
  return Math.abs(v) - half;
}
function handle(u, v) {
  if (u < -0.27 || u > 0.07) return 1;
  return Math.abs(v) - 0.036;
}
function ring(u, v) {
  const d = Math.hypot(u + 0.335, v);
  return Math.max(d - 0.075, 0.042 - d);
}

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N, y = (j + 0.5) / N;
    // rounded tile mask
    const m = 0.06, r = 0.2;
    const qx = Math.max(Math.abs(x - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - m - r), 0);
    const alpha = clamp(-(Math.hypot(qx, qy) - r) * N);

    let c = mix(BG_TOP, BG_BOTTOM, y);
    // faint warm glow behind the blade
    const glow = Math.exp(-((x - 0.62) ** 2 + (y - 0.4) ** 2) / 0.05) * 0.22;
    c = mix(c, [120, 70, 10], glow);

    const { u, v } = toLocal(x, y);
    const aa = 1.2 / N;
    const b = blade(u, v), h = handle(u, v), rg = ring(u, v);
    const inBlade = clamp(0.5 - b / aa);
    const inHandle = clamp(0.5 - h / aa);
    const inRing = clamp(0.5 - rg / aa);

    // blade: darker on one side of the centre ridge for a bevelled look
    if (inBlade > 0) c = mix(c, v > 0 ? YELLOW : YELLOW_DARK, inBlade);
    if (inHandle > 0) {
      // cord wrap: dark bands across a yellow core
      const band = (Math.sin((u + 0.27) * 110) > 0.2) ? WRAP : YELLOW_DARK;
      c = mix(c, band, inHandle);
    }
    if (inRing > 0) c = mix(c, YELLOW, inRing);

    const o = (j * N + i) * 4;
    px[o] = Math.round(c[0]); px[o + 1] = Math.round(c[1]); px[o + 2] = Math.round(c[2]); px[o + 3] = Math.round(alpha * 255);
  }
}

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(N, 0); ihdr.writeUInt32BE(N, 4); ihdr[8] = 8; ihdr[9] = 6;
const raw = Buffer.alloc(N * (N * 4 + 1));
for (let j = 0; j < N; j++) px.copy(raw, j * (N * 4 + 1) + 1, j * N * 4, (j + 1) * N * 4);
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const out = path.resolve(import.meta.dirname, '..', 'resources', 'icon.png');
fs.writeFileSync(out, png);
console.log(`wrote ${out}`);
