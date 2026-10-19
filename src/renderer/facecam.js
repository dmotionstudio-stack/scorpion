// Camera frames for face features (Interact, enrolling, face lock). Frames go
// to the main process, where YuNet + SFace find and recognize faces; this file
// only grabs pictures and keeps track of who is who between frames (like
// SeetaFace2's FaceTracker). Nothing leaves the computer.

const W = 320;
const H = 240;

function overlap(a, b) {
  const x1 = Math.max(a[0], b[0]), y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]), y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a[2] * a[3] + b[2] * b[3] - inter || 1);
}

// Gives each face a stable id across frames and keeps its name for a moment
// when one frame fails to recognize it (blink, turned head).
export class FaceTracker {
  constructor() { this.tracks = []; this.nextId = 1; }

  update(faces, now = performance.now()) {
    const used = new Set();
    for (const f of faces) {
      let best = null, bestScore = 0.25;
      for (const t of this.tracks) {
        if (used.has(t)) continue;
        const s = overlap(t.box, f.box);
        if (s > bestScore) { best = t; bestScore = s; }
      }
      if (!best) { best = { id: this.nextId++, person: null, personSeen: 0 }; this.tracks.push(best); }
      used.add(best);
      // Smooth the box so overlays and the orb's gaze don't jitter.
      best.box = best.box ? best.box.map((v, i) => v * 0.4 + f.box[i] * 0.6) : f.box;
      best.seen = now;
      best.quality = f.quality;
      if (f.person) { best.person = f.person; best.personSeen = now; }
      else if (now - best.personSeen > 2500) best.person = null;
    }
    this.tracks = this.tracks.filter((t) => now - t.seen < 1200);
    return this.tracks;
  }
}

export class FaceCam {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = W;
    this.canvas.height = H;
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    this.tracker = new FaceTracker();
    this.running = false;
  }

  get size() { return { width: W, height: H }; }

  async start({ video, reason, analyze, onUpdate, fps = 5 }) {
    if (this.running) return;
    if (!(await window.scorpion.useCamera({ reason, on: true }))) throw Object.assign(new Error('Camera access denied'), { name: 'NotAllowedError' });
    this.reason = reason;
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    } catch (err) {
      window.scorpion.useCamera({ reason, on: false });
      throw err;
    }
    this.video = video || document.createElement('video');
    this.video.muted = true;
    this.video.playsInline = true;
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.tracker = new FaceTracker();
    const loop = async () => {
      if (!this.running) return;
      const t0 = performance.now();
      try {
        const frame = this.grab(W, H);
        if (frame) {
          const res = await analyze(frame);
          const faces = Array.isArray(res) ? res : res?.faces || [];
          onUpdate?.(this.tracker.update(faces), res);
        }
      } catch (err) { onUpdate?.([], { error: err }); }
      if (this.running) this.timer = setTimeout(loop, Math.max(0, 1000 / fps - (performance.now() - t0)));
    };
    loop();
  }

  // The current picture as RGBA pixels, scaled to width × height.
  grab(width = W, height = H) {
    if (!this.video || this.video.readyState < 2) return null;
    if (this.canvas.width !== width) { this.canvas.width = width; this.canvas.height = height; }
    this.ctx.drawImage(this.video, 0, 0, width, height);
    const { data } = this.ctx.getImageData(0, 0, width, height);
    return { data, width, height };
  }

  // A few full-size pictures a moment apart, for enrolling a person.
  async shots(count = 5, gapMs = 450) {
    const out = [];
    for (let i = 0; i < count; i++) {
      await new Promise((r) => setTimeout(r, gapMs));
      const f = this.grab(640, 480);
      if (f) out.push({ data: f.data, width: f.width, height: f.height });
    }
    return out;
  }

  stop() {
    this.running = false;
    clearTimeout(this.timer);
    for (const t of this.stream?.getTracks() || []) t.stop();
    if (this.video) this.video.srcObject = null;
    this.stream = null;
    if (this.reason) window.scorpion.useCamera({ reason: this.reason, on: false });
    this.reason = null;
  }
}

// Draws tracked faces (box + name) over a preview of the frame size.
export function drawFaces(canvas, tracks, { width = W, height = H, color = '#f0a830', mirror = true } = {}) {
  const ctx = canvas.getContext('2d');
  const sx = canvas.width / width, sy = canvas.height / height;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.lineWidth = 2;
  ctx.font = '11px Consolas, monospace';
  for (const t of tracks) {
    let [x, y, w, h] = t.box;
    if (mirror) x = width - x - w;
    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.strokeRect(x * sx, y * sy, w * sx, h * sy);
    const label = t.person ? t.person.name : 'UNKNOWN';
    ctx.fillText(label.toUpperCase(), x * sx, Math.max(10, y * sy - 4));
  }
}
