// Generates resources/icon.png (1024x1024): a gradient rounded square with a "K".
// Dependency-free PNG encoder so the build needs nothing extra.
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';

const N = 1024;
const px = Buffer.alloc(N * N * 4);
const segs = [ // K strokes in unit coords
  [0.34, 0.24, 0.34, 0.76],
  [0.36, 0.53, 0.68, 0.24],
  [0.45, 0.45, 0.70, 0.76],
];
const distSeg = (x, y, [x1, y1, x2, y2]) => {
  const dx = x2 - x1, dy = y2 - y1;
  const t = Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
};
const lerp = (a, b, t) => Math.round(a + (b - a) * t);

for (let j = 0; j < N; j++) {
  for (let i = 0; i < N; i++) {
    const x = (i + 0.5) / N, y = (j + 0.5) / N;
    // rounded-square mask (macOS-style margin), antialiased
    const m = 0.06, r = 0.2;
    const qx = Math.max(Math.abs(x - 0.5) - (0.5 - m - r), 0), qy = Math.max(Math.abs(y - 0.5) - (0.5 - m - r), 0);
    const d = Math.hypot(qx, qy) - r;
    const alpha = Math.max(0, Math.min(1, -d * N));
    const t = (x + y) / 2;
    let R = lerp(0x3f, 0x2a, t), G = lerp(0xbf, 0x7b, t), B = lerp(0x9f, 0xd6, t);
    const k = Math.min(...segs.map((s) => distSeg(x, y, s))) - 0.055;
    const ink = Math.max(0, Math.min(1, -k * N));
    R = lerp(R, 255, ink); G = lerp(G, 255, ink); B = lerp(B, 255, ink);
    const o = (j * N + i) * 4;
    px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = Math.round(alpha * 255);
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
