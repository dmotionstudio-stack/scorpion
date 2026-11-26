// Voice focus: Scorpion listens for a human voice and ignores the rest of the room (fans, keyboards, traffic, hum). The
// microphone's own noise suppression is always on; this adds a check on what a sound is made of, so that a turn of listening only
// begins on a voice, and goes on only while there is one. Only when asked ("what's that noise?") does it listen to the room itself
// and describe it (describeSound). Everything stays on the computer, and what is heard is never kept.

const RATE = 16000;

// In-place radix-2 FFT (re, im: Float32Array/Array of a power-of-two length).
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = i + k + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi;
        re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

// What a frame of sound is made of: the shares of its energy in the low rumble, the speech band, and how flat (noise-like) or
// peaky (tonal, like a voice or a note) its spectrum is.
export function frameFeatures(data, rate = RATE) {
  let n = 1;
  while (n * 2 <= data.length) n *= 2;
  const re = new Float32Array(n), im = new Float32Array(n);
  let rms = 0;
  for (let i = 0; i < n; i++) { const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)); re[i] = data[i] * w; rms += data[i] * data[i]; }
  rms = Math.sqrt(rms / n);
  fft(re, im);
  const hz = rate / n;
  let total = 0, low = 0, band = 0, logSum = 0, arith = 0, bins = 0;
  for (let k = 1; k < n / 2; k++) {
    const f = k * hz;
    const p = re[k] * re[k] + im[k] * im[k];
    total += p;
    if (f < 120) low += p;
    if (f >= 300 && f <= 3400) band += p;
    if (f >= 120 && f <= 4000) { logSum += Math.log(p + 1e-12); arith += p; bins++; }
  }
  const flatness = bins && arith > 0 ? Math.exp(logSum / bins) / (arith / bins) : 1;
  return { rms, lowShare: total ? low / total : 0, bandShare: total ? band / total : 0, flatness };
}

// Is this frame a human voice? Speech sits mostly in the 300 to 3400 Hz band, is not rumble, and is peaky (voiced sounds are a
// stack of harmonics); fans, hiss, clicks and rain are flat or low. (The consonants of speech, hissy and short, are carried by
// the voiced sounds around them: the recorder only needs a voice to start and to go on.)
export function isVoiceFrame(data, rate = RATE) {
  const f = frameFeatures(data, rate);
  return f.bandShare > 0.55 && f.lowShare < 0.3 && f.flatness < 0.15;
}

// Said when someone asks what the room sounds like: a short, honest description of 4 or 5 seconds of it (not a recording).
// pcm: Float32Array at 16 kHz, from a microphone with no noise suppression.
export function describeSound(pcm, rate = RATE) {
  const size = 2048;
  const frames = [];
  for (let at = 0; at + size <= pcm.length; at += size) frames.push(frameFeatures(pcm.subarray(at, at + size), rate));
  if (frames.length < 4) return 'I could not listen long enough to tell.';
  const rms = frames.map((f) => f.rms);
  const mean = rms.reduce((a, b) => a + b, 0) / rms.length;
  if (mean < 0.004) return "It's very quiet. I don't hear anything in particular.";
  const sorted = [...rms].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] || 1e-6;
  const peak = sorted[sorted.length - 1];
  const burst = peak / Math.max(median, 1e-6); // how much louder the loudest moment is than the usual
  const active = frames.filter((f) => f.rms > Math.max(0.004, median * 0.6));
  const share = (test) => (active.length ? active.filter(test).length / active.length : 0);
  const voiced = share((f) => f.bandShare > 0.55 && f.lowShare < 0.3 && f.flatness < 0.15);
  const rumble = share((f) => f.lowShare > 0.4);
  const flat = share((f) => f.flatness > 0.35);
  const level = mean > 0.08 ? 'loud ' : mean > 0.02 ? '' : 'quiet ';
  if (voiced > 0.45) return `I hear ${level}voices, people talking.`;
  if (burst > 6 && flat > 0.4) return `I hear ${level}short clicks or taps, like typing or knocking.`;
  if (rumble > 0.5) return `I hear a ${level}steady low hum, like a fan, an air conditioner or a refrigerator.`;
  if (flat > 0.6) return `I hear a ${level}steady hiss, like running water, wind or a fan.`;
  if (flat < 0.25) return `I hear a ${level}tonal sound, like music or a beep.`;
  return `I hear ${level}sounds I can't tell apart.`;
}

// Listens to the room as it is, with every filter off, for a few seconds (only ever on request) and describes it.
export async function listenToRoom(ms = 4500) {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  const ctx = new AudioContext({ sampleRate: RATE });
  const source = ctx.createMediaStreamSource(stream);
  const node = ctx.createScriptProcessor(2048, 1, 1);
  const chunks = [];
  node.onaudioprocess = (e) => chunks.push(new Float32Array(e.inputBuffer.getChannelData(0)));
  source.connect(node);
  node.connect(ctx.destination);
  await new Promise((resolve) => setTimeout(resolve, ms));
  node.onaudioprocess = null;
  for (const t of stream.getTracks()) t.stop();
  ctx.close().catch(() => {});
  const pcm = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let at = 0;
  for (const c of chunks) { pcm.set(c, at); at += c.length; }
  return describeSound(pcm);
}
