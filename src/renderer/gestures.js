// Hand gestures for Interact, after ULTRON Orb UI's hand tracker
// (lib/handTracker.ts, MIT; see ORB-LICENSE.txt). Pinch thumb and index on one
// hand and move it to spin the orb; pinch with both hands and spread or close
// them to zoom. MediaPipe's hand landmarker runs here on WebAssembly that
// ships with Scorpion; its model is downloaded once into the model library.

// Landmark indices of MediaPipe's hand model.
const WRIST = 0;
const THUMB_TIP = 4;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
// Bones between landmarks, for the preview overlay.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

// Pinch hysteresis: thumb-to-index distance relative to hand size, so a pinch
// doesn't flicker on and off at the threshold.
export const PINCH_ON = 0.32;
export const PINCH_OFF = 0.45;
// Radians of spin per screen width of hand movement.
const ROTATE_SPEED = 5;
// How quickly the smoothed grab point follows the hand (0..1, higher = snappier).
const SMOOTHING = 0.4;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

export function createGestures() {
  return { hands: new Map(), mode: 'idle', spinGrab: null, zoomDist: null };
}

// One video frame: the landmarks of each hand and its "Left"/"Right" label.
// Returns { hands, mode, rotate: [dTheta, dPhi] or null, zoom: factor or null }.
export function stepGestures(g, landmarks, labels) {
  const pinched = [];
  const seen = new Set();
  landmarks.forEach((lm, i) => {
    // Hand state is kept per label so it survives hands swapping order;
    // two hands given the same label still get one each.
    const key = seen.has(labels[i]) ? `${labels[i]}#${i}` : labels[i];
    seen.add(key);
    const size = dist(lm[WRIST], lm[MIDDLE_MCP]);
    if (size < 1e-6) return;
    const ratio = dist(lm[THUMB_TIP], lm[INDEX_TIP]) / size;
    // Mirrored, so moving your hand right moves it right on screen.
    const raw = { x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2, y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2 };
    let hand = g.hands.get(key);
    if (!hand) g.hands.set(key, (hand = { pinching: false, grab: raw }));
    if (hand.pinching && ratio > PINCH_OFF) hand.pinching = false;
    else if (!hand.pinching && ratio < PINCH_ON) hand.pinching = true;
    hand.grab = { x: hand.grab.x + (raw.x - hand.grab.x) * SMOOTHING, y: hand.grab.y + (raw.y - hand.grab.y) * SMOOTHING };
    if (hand.pinching) pinched.push(hand.grab);
  });
  for (const key of g.hands.keys()) if (!seen.has(key)) g.hands.delete(key);

  const mode = pinched.length >= 2 ? 'zoom' : pinched.length === 1 ? 'spin' : 'idle';
  // A new gesture starts from where the hands are now, without a jump.
  if (mode !== g.mode) {
    g.mode = mode;
    g.spinGrab = null;
    g.zoomDist = null;
  }
  let rotate = null;
  let zoom = null;
  if (mode === 'spin') {
    const grab = pinched[0];
    if (g.spinGrab) {
      const dx = grab.x - g.spinGrab.x;
      const dy = grab.y - g.spinGrab.y;
      if (Math.abs(dx) > 1e-4 || Math.abs(dy) > 1e-4) rotate = [dx * ROTATE_SPEED, dy * ROTATE_SPEED];
    }
    g.spinGrab = grab;
  } else if (mode === 'zoom') {
    const d = dist(pinched[0], pinched[1]);
    // Spreading the hands brings the orb closer (factor below 1).
    if (g.zoomDist && d > 1e-4) zoom = Math.min(1.18, Math.max(0.85, g.zoomDist / d));
    g.zoomDist = d;
  }
  return { hands: landmarks.length, mode, rotate, zoom };
}

// Camera errors in words a person can act on.
export function cameraError(err) {
  const name = err?.name || '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return 'CAMERA ACCESS DENIED. Allow camera access for desktop apps in your system\'s privacy settings, then press G.';
  if (name === 'NotFoundError' || name === 'OverconstrainedError' || name === 'DevicesNotFoundError') return 'NO CAMERA FOUND. Connect a webcam, then press G.';
  if (name === 'NotReadableError' || name === 'AbortError') return 'CAMERA BUSY. Another app is using it; close that app, then press G.';
  return `CAMERA ERROR: ${err?.message || err}`;
}

// The tracker: load() the hand model, then startCamera(). onFrame gets each
// stepGestures() result.
export class HandTracker {
  constructor(video, overlay, { onFrame, color = '#f0a830' }) {
    this.video = video;
    this.overlay = overlay;
    this.onFrame = onFrame;
    this.color = color;
    this.landmarker = null;
    this.loading = null;
    this.stream = null;
    this.running = false;
    this.gestures = createGestures();
  }

  load(modelUrl) {
    this.loading ??= this.createLandmarker(modelUrl).catch((err) => { this.loading = null; throw err; });
    return this.loading;
  }

  async createLandmarker(modelUrl) {
    const { FilesetResolver, HandLandmarker } = await import('/vendor/mediapipe/vision_bundle.mjs');
    const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
    const options = (delegate) => ({
      baseOptions: { modelAssetPath: modelUrl, delegate },
      runningMode: 'VIDEO',
      numHands: 2,
      minHandDetectionConfidence: 0.6,
      minHandPresenceConfidence: 0.6,
      minTrackingConfidence: 0.6,
    });
    try {
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('GPU'));
    } catch {
      // Some graphics drivers refuse the GPU path; the CPU one always works.
      this.landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    }
  }

  async startCamera() {
    this.stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480, facingMode: 'user' }, audio: false });
    this.video.srcObject = this.stream;
    await this.video.play();
    this.running = true;
    this.video.requestVideoFrameCallback(this.frame);
  }

  frame = () => {
    if (!this.running) return;
    try {
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      const labels = result.handedness.map((h) => h[0]?.categoryName ?? '?');
      this.onFrame(stepGestures(this.gestures, result.landmarks, labels));
      this.draw(result.landmarks);
    } finally {
      if (this.running) this.video.requestVideoFrameCallback(this.frame);
    }
  };

  // Skeletons on the mirrored preview; the thumb-index line lights up while pinched.
  draw(hands) {
    const ctx = this.overlay.getContext('2d');
    const { width: w, height: h } = this.overlay;
    ctx.clearRect(0, 0, w, h);
    ctx.strokeStyle = ctx.fillStyle = this.color;
    for (const lm of hands) {
      const p = (i) => [(1 - lm[i].x) * w, lm[i].y * h];
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const [a, b] of BONES) { ctx.moveTo(...p(a)); ctx.lineTo(...p(b)); }
      ctx.stroke();
      for (let i = 0; i < lm.length; i++) { ctx.beginPath(); ctx.arc(...p(i), 1.6, 0, Math.PI * 2); ctx.fill(); }
      const size = dist(lm[WRIST], lm[MIDDLE_MCP]);
      const pinched = size > 1e-6 && dist(lm[THUMB_TIP], lm[INDEX_TIP]) / size < PINCH_ON;
      ctx.globalAlpha = pinched ? 1 : 0.7;
      ctx.lineWidth = pinched ? 2.5 : 1.2;
      ctx.beginPath();
      ctx.moveTo(...p(THUMB_TIP));
      ctx.lineTo(...p(INDEX_TIP));
      ctx.stroke();
      for (const i of [THUMB_TIP, INDEX_TIP]) { ctx.beginPath(); ctx.arc(...p(i), pinched ? 5 : 3, 0, Math.PI * 2); ctx.fill(); }
    }
    ctx.globalAlpha = 1;
  }

  // Turns the camera off; the model stays loaded for next time.
  stopCamera() {
    this.running = false;
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    this.gestures = createGestures();
    this.overlay.getContext('2d').clearRect(0, 0, this.overlay.width, this.overlay.height);
  }
}
