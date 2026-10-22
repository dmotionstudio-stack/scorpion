// Hand gestures for Interact, after ULTRON Orb UI's hand tracker
// (lib/handTracker.ts, MIT; see ORB-LICENSE.txt), extended into a full set for
// running the orb and the apps inside it. MediaPipe's hand landmarker runs here
// on WebAssembly that ships with Scorpion; its model is downloaded once into
// the model library.
//
//   Point (index finger up)          move the pointer
//   Pinch thumb + index, quickly     click / select
//   Pinch thumb + middle, quickly    right-click
//   Pinch, hold and move             drag (in an app) or spin the orb
//   Bunched fingers, then open wide  "zoom in": open what you point at
//   Two fingers up, move up/down     scroll
//   Pinch with both hands, spread    zoom in or out
//   Open hand, sweep left/right      previous / next app
//   Open hand, sweep up              home (the orb)
//   Open hand, sweep down            the Apps screen
//   Open hand, push toward screen    back
//   Thumb up / thumb down (hold)     yes / no to a question
//   Three fingers up (hold)          Files
//   Thumb + little finger out        talk / stop talking
//   Open palm held still             stop (Scorpion stops speaking)
//   Fist held                        pause / resume the hand controls
//   Point at a shortcut and hold     open it (on the orb)

// Landmark indices of MediaPipe's hand model.
const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_TIP = 12;
const PINKY_MCP = 17;
// tip and middle joint of index, middle, ring and pinky
const FINGERS = { index: [8, 6], middle: [12, 10], ring: [16, 14], pinky: [20, 18] };
// Bones between landmarks, for the preview overlay.
const BONES = [[0, 1], [1, 2], [2, 3], [3, 4], [0, 5], [5, 6], [6, 7], [7, 8], [5, 9], [9, 10], [10, 11], [11, 12],
  [9, 13], [13, 14], [14, 15], [15, 16], [13, 17], [17, 18], [18, 19], [19, 20], [0, 17]];

// Pinch hysteresis: thumb-to-fingertip distance relative to hand size, so a
// pinch doesn't flicker on and off at the threshold.
export const PINCH_ON = 0.32;
export const PINCH_OFF = 0.45;
// Radians of spin per screen width of hand movement.
const ROTATE_SPEED = 5;
// How quickly the smoothed points follow the hand (0..1, higher = snappier).
const SMOOTHING = 0.4;

const TAP_MS = 450; // a pinch released within this is a tap, not a drag
const TAP_MOVE = 0.06;
const DRAG_AFTER_MS = 180; // a held pinch drags (or spins) after this
const SWIPE_MS = 350;
const SWIPE_DX = 0.28; // of the camera's width
const SWIPE_DY = 0.24; // of its height
const PUSH_MS = 400;
const PUSH_GROWTH = 1.4; // the hand looks this much bigger: pushed toward the camera
const BLOOM_MS = 500; // bunched fingers opening wide within this
const THUMB_HOLD_MS = 600;
const BLOOM_FIST_MS = 800; // a longer fist is a hold, not the start of a bloom
const FIST_HOLD_MS = 1500;
const SIGN_HOLD_MS = 400;
const PALM_HOLD_MS = 1000;
const STILL_MOVE = 0.03;
const SCROLL_SPEED = 12; // notches per hand-height of movement
const COOLDOWN_MS = 900;

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// Which fingers are stretched out, and the hand's pose:
// 'point' (index only), 'two' (index and middle), 'three' (index, middle,
// ring), 'open' (all four), 'fist' (none), 'thumbUp' / 'thumbDown' (fist with
// the thumb out), 'shaka' (thumb and little finger out), or 'other'.
export function handPose(lm) {
  const size = dist(lm[WRIST], lm[MIDDLE_MCP]);
  const out = {};
  for (const [name, [tip, pip]] of Object.entries(FINGERS)) out[name] = dist(lm[tip], lm[WRIST]) > dist(lm[pip], lm[WRIST]) * 1.08;
  out.thumb = size > 1e-6 && dist(lm[THUMB_TIP], lm[MIDDLE_MCP]) > size * 0.85 && dist(lm[THUMB_TIP], lm[WRIST]) > dist(lm[THUMB_IP], lm[WRIST]);
  const n = ['index', 'middle', 'ring', 'pinky'].filter((f) => out[f]).length;
  let pose = 'other';
  if (n === 4) pose = 'open';
  else if (n === 0 && out.thumb && lm[THUMB_TIP].y < lm[INDEX_MCP].y - size * 0.4) pose = 'thumbUp';
  else if (n === 0 && out.thumb && lm[THUMB_TIP].y > lm[PINKY_MCP].y + size * 0.4) pose = 'thumbDown';
  else if (n === 0) pose = 'fist';
  else if (out.index && out.middle && !out.ring && !out.pinky) pose = 'two';
  else if (out.index && out.middle && out.ring && !out.pinky) pose = 'three';
  else if (out.pinky && out.thumb && !out.index && !out.middle && !out.ring) pose = 'shaka';
  else if (out.index && !out.middle && !out.ring && !out.pinky) pose = 'point';
  return { fingers: out, pose, size };
}

export function createGestures() {
  return { hands: new Map(), mode: 'idle', spinGrab: null, zoomDist: null, spinSince: 0, lastSwipe: -Infinity, lastPush: -Infinity, lastBloom: -Infinity };
}

// One video frame: the landmarks of each hand and its "Left"/"Right" label.
// Returns what happened this frame (positions are 0..1 across the mirrored
// camera view):
//   hands, mode ('idle'|'spin'|'zoom'), pose (of a single hand)
//   rotate: [dTheta, dPhi] | null    zoom: factor | null (below 1: closer)
//   pointer: {x, y} | null           tap / rightTap / bloom: {x, y} | null
//   drag: { phase: 'start'|'move'|'end', x, y } | null
//   scroll: lines (up positive) | null
//   swipe: 'left'|'right'|'up'|'down'|null   push: boolean   thumb: 'up'|'down'|null
//   sign: 'three'|'shaka'|null (held briefly)   hold: 'palm'|'fist'|null (held still)
export function stepGestures(g, landmarks, labels, now = performance.now()) {
  const pinched = [];
  const seen = new Set();
  const r = { pointer: null, tap: null, rightTap: null, bloom: null, drag: null, scroll: null, swipe: null, push: false, thumb: null, sign: null, hold: null, pose: null };
  landmarks.forEach((lm, i) => {
    // Hand state is kept per label so it survives hands swapping order;
    // two hands given the same label still get one each.
    const key = seen.has(labels[i]) ? `${labels[i]}#${i}` : labels[i];
    seen.add(key);
    const { pose, size } = handPose(lm);
    if (size < 1e-6) return;
    const single = landmarks.length === 1;
    if (single) r.pose = pose;
    const ratio = dist(lm[THUMB_TIP], lm[INDEX_TIP]) / size;
    const mRatio = dist(lm[THUMB_TIP], lm[MIDDLE_TIP]) / size;
    // Mirrored, so moving your hand right moves it right on screen.
    const raw = { x: 1 - (lm[THUMB_TIP].x + lm[INDEX_TIP].x) / 2, y: (lm[THUMB_TIP].y + lm[INDEX_TIP].y) / 2 };
    const tip = { x: 1 - lm[INDEX_TIP].x, y: lm[INDEX_TIP].y };
    const palm = { x: 1 - (lm[WRIST].x + lm[MIDDLE_MCP].x) / 2, y: (lm[WRIST].y + lm[MIDDLE_MCP].y) / 2 };
    let hand = g.hands.get(key);
    if (!hand) g.hands.set(key, (hand = { pinching: false, mPinching: false, grab: raw, point: tip, hist: [], dragging: false }));
    const was = hand.pinching;
    if (hand.pinching && ratio > PINCH_OFF) hand.pinching = false;
    else if (!hand.pinching && ratio < PINCH_ON) hand.pinching = true;
    hand.grab = { x: hand.grab.x + (raw.x - hand.grab.x) * SMOOTHING, y: hand.grab.y + (raw.y - hand.grab.y) * SMOOTHING };
    if (hand.pinching) pinched.push(hand.grab);
    // Pointing: the index fingertip, steadied; it only follows a pointing
    // finger and holds still during a pinch, so a tap picks what the finger
    // was on before the pinch pulled it toward the thumb.
    if (!hand.pinching && pose === 'point') hand.point = { x: hand.point.x + (tip.x - hand.point.x) * SMOOTHING, y: hand.point.y + (tip.y - hand.point.y) * SMOOTHING };
    if (single && !hand.pinching && pose === 'point') r.pointer = hand.point;

    // Pinch: a quick one is a tap; held and moved (or held long), a drag.
    if (!was && hand.pinching) hand.pinchAt = { t: now, grab: hand.grab, point: hand.point };
    if (single && hand.pinching && hand.pinchAt) {
      const moved = dist(hand.grab, hand.pinchAt.grab);
      const held = now - hand.pinchAt.t;
      const at = { x: hand.pinchAt.point.x + hand.grab.x - hand.pinchAt.grab.x, y: hand.pinchAt.point.y + hand.grab.y - hand.pinchAt.grab.y };
      if (!hand.dragging && held >= DRAG_AFTER_MS && (moved >= TAP_MOVE || held >= TAP_MS)) { hand.dragging = true; r.drag = { phase: 'start', ...hand.pinchAt.point }; }
      else if (hand.dragging) r.drag = { phase: 'move', ...at };
    }
    if (was && !hand.pinching && hand.pinchAt) {
      if (hand.dragging) r.drag = { phase: 'end', x: hand.pinchAt.point.x + hand.grab.x - hand.pinchAt.grab.x, y: hand.pinchAt.point.y + hand.grab.y - hand.pinchAt.grab.y };
      else if (now - hand.pinchAt.t < TAP_MS && dist(hand.grab, hand.pinchAt.grab) < TAP_MOVE) r.tap = hand.pinchAt.point;
    }
    if (!hand.pinching) { hand.pinchAt = null; hand.dragging = false; }

    // Thumb and middle finger: a quick pinch is a right-click.
    const mWas = hand.mPinching;
    if (hand.mPinching && mRatio > PINCH_OFF) hand.mPinching = false;
    else if (!hand.mPinching && !hand.pinching && mRatio < PINCH_ON) hand.mPinching = true;
    if (!mWas && hand.mPinching) hand.mPinchAt = now;
    if (single && mWas && !hand.mPinching && !hand.pinching && now - (hand.mPinchAt || 0) < TAP_MS) r.rightTap = hand.point;

    // Two fingers up and moving: scroll.
    if (single && pose === 'two') {
      if (hand.scrollY != null) {
        const dy = (hand.scrollY - palm.y) * SCROLL_SPEED / size * 0.2;
        if (Math.abs(dy) > 0.004) r.scroll = dy;
      }
      hand.scrollY = palm.y;
    } else hand.scrollY = null;

    // A fist: brief, then opened wide, is a "zoom in" (bloom) on what you
    // point at; held, it pauses or resumes the hand controls.
    if (pose === 'fist') {
      if (hand.fistStart == null) hand.fistStart = now;
      hand.fistAt = now;
      if (single && !hand.fistHeld && now - hand.fistStart >= FIST_HOLD_MS) { r.hold = 'fist'; hand.fistHeld = true; }
    } else if (hand.fistStart != null) {
      hand.fistRun = { start: hand.fistStart, end: hand.fistAt, held: hand.fistHeld };
      hand.fistStart = null;
      hand.fistHeld = false;
    }
    const run = hand.fistRun;
    if (single && pose === 'open' && run && !run.held && now - run.end < BLOOM_MS && run.end - run.start < BLOOM_FIST_MS && now - g.lastBloom > COOLDOWN_MS) {
      r.bloom = hand.point;
      g.lastBloom = now;
      hand.fistRun = null;
      hand.hist = [];
    }

    // A thumb held up or down: yes or no.
    const thumbPose = pose === 'thumbUp' ? 'up' : pose === 'thumbDown' ? 'down' : null;
    if (thumbPose !== hand.thumbPose) { hand.thumbPose = thumbPose; hand.thumbSince = now; hand.thumbFired = false; }
    if (single && thumbPose && !hand.thumbFired && now - hand.thumbSince >= THUMB_HOLD_MS) { r.thumb = thumbPose; hand.thumbFired = true; }

    // Signs held a moment: three fingers up, or thumb and little finger out.
    const sign = pose === 'three' || pose === 'shaka' ? pose : null;
    if (sign !== hand.sign) { hand.sign = sign; hand.signSince = now; hand.signFired = false; }
    if (single && sign && !hand.signFired && now - hand.signSince >= SIGN_HOLD_MS) { r.sign = sign; hand.signFired = true; }

    // An open palm held still: "stop".
    if (single && pose === 'open' && !hand.pinching) {
      if (!hand.still || dist(palm, hand.still.at) > STILL_MOVE) hand.still = { at: palm, since: now, fired: false };
      else if (!hand.still.fired && now - hand.still.since >= PALM_HOLD_MS) { r.hold = 'palm'; hand.still.fired = true; }
    } else hand.still = null;

    // The open hand's recent positions and sizes: sweeps and pushes.
    hand.hist = pose === 'open' && !hand.pinching ? [...hand.hist.filter((h) => now - h.t <= Math.max(SWIPE_MS, PUSH_MS)), { t: now, ...palm, size }] : [];
    if (single && pose === 'open' && !r.bloom) {
      const old = hand.hist.find((h) => now - h.t <= SWIPE_MS);
      if (old && now - g.lastSwipe > COOLDOWN_MS) {
        const dx = palm.x - old.x;
        const dy = palm.y - old.y;
        if (Math.abs(dx) > SWIPE_DX && Math.abs(dy) < SWIPE_DX / 2) r.swipe = dx > 0 ? 'right' : 'left';
        else if (Math.abs(dy) > SWIPE_DY && Math.abs(dx) < SWIPE_DY / 2) r.swipe = dy < 0 ? 'up' : 'down';
        if (r.swipe) { g.lastSwipe = now; hand.hist = []; }
      }
      const first = hand.hist.find((h) => now - h.t <= PUSH_MS);
      if (!r.swipe && first && now - g.lastPush > COOLDOWN_MS && size > first.size * PUSH_GROWTH && dist(palm, first) < SWIPE_DX / 2) {
        r.push = true;
        g.lastPush = now;
        hand.hist = [];
      }
    }
  });
  for (const key of g.hands.keys()) if (!seen.has(key)) g.hands.delete(key);

  const mode = pinched.length >= 2 ? 'zoom' : pinched.length === 1 ? 'spin' : 'idle';
  // A new gesture starts from where the hands are now, without a jump.
  if (mode !== g.mode) {
    g.mode = mode;
    g.spinGrab = null;
    g.zoomDist = null;
    g.spinSince = now;
  }
  let rotate = null;
  let zoom = null;
  if (mode === 'spin') {
    const grab = pinched[0];
    if (g.spinGrab && now - g.spinSince >= DRAG_AFTER_MS) {
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
  return { hands: landmarks.length, mode, rotate, zoom, ...r };
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

  // Always-on tracking stays light: with no hand in view for a couple of
  // seconds, only every third camera frame is looked at, until one appears.
  empty = 0;
  tick = 0;
  frame = () => {
    if (!this.running) return;
    try {
      this.tick = (this.tick + 1) % 3;
      if (this.empty > 60 && this.tick) return;
      const result = this.landmarker.detectForVideo(this.video, performance.now());
      this.empty = result.landmarks.length ? 0 : this.empty + 1;
      const labels = result.handedness.map((h) => h[0]?.categoryName ?? '?');
      this.onFrame(stepGestures(this.gestures, result.landmarks, labels), result.landmarks);
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
