// MediaPipe's hand landmarker on a thread of its own (a classic worker:
// MediaPipe's loader uses importScripts; the bundle comes with import()) (gestures.js sends it
// camera frames). On the page's thread it held everything else up: with the
// orb open, each frame waited for the orb's drawing to finish on the graphics
// chip, hand frames halved and the orb dropped to 30 frames a second.
//
// Messages in:  { load: { modelUrl, delegate: 'GPU'|'CPU' } }
//               { frame: VideoFrame, t }   (the frame is closed here)
// Messages out: { loaded: delegate } | { error }
//               { t, landmarks, labels, ms }   (ms: how long the model took)
let landmarker = null;

async function load({ modelUrl, delegate }) {
  const { FilesetResolver, HandLandmarker } = await import('/vendor/mediapipe/vision_bundle.mjs');
  const fileset = await FilesetResolver.forVisionTasks('/vendor/mediapipe/wasm');
  const options = (d) => ({
    baseOptions: { modelAssetPath: modelUrl, delegate: d },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    // Lower: a hand already found keeps being followed frame to frame
    // rather than searched for again, which is slower.
    minTrackingConfidence: 0.5,
  });
  try {
    landmarker = await HandLandmarker.createFromOptions(fileset, options(delegate));
    return delegate;
  } catch (err) {
    if (delegate === 'CPU') throw err;
    // Some graphics drivers refuse the GPU path; the CPU one always works.
    landmarker = await HandLandmarker.createFromOptions(fileset, options('CPU'));
    return 'CPU';
  }
}

self.onmessage = async ({ data }) => {
  if (data.load) {
    try { self.postMessage({ loaded: await load(data.load) }); } catch (err) { self.postMessage({ error: String(err?.message || err) }); }
    return;
  }
  if (data.frame) {
    const started = performance.now();
    try {
      const r = landmarker.detectForVideo(data.frame, data.t);
      self.postMessage({ t: data.t, landmarks: r.landmarks, labels: r.handedness.map((h) => h[0]?.categoryName ?? '?'), ms: performance.now() - started });
    } catch (err) {
      self.postMessage({ t: data.t, landmarks: [], labels: [], error: String(err?.message || err) });
    } finally {
      data.frame.close();
    }
  }
};
