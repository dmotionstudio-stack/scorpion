// Decodes videos and music for the media library. Chromium already plays
// these formats, so the window does the decoding and hands the main process
// a few frames (videos) or 16 kHz mono sample windows (music).

const FRAME_MAX = 336;

export async function decodeVideo(url, { frames = 6 } = {}) {
  const video = document.createElement('video');
  video.muted = true;
  video.preload = 'auto';
  video.src = url;
  try {
    await new Promise((resolve, reject) => {
      video.onloadedmetadata = resolve;
      video.onerror = () => reject(new Error('This video format can\'t be played'));
      setTimeout(() => reject(new Error('The video took too long to open')), 30000);
    });
    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const scale = Math.min(1, FRAME_MAX / Math.max(video.videoWidth, video.videoHeight));
    const w = Math.max(1, Math.round(video.videoWidth * scale)), h = Math.max(1, Math.round(video.videoHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    const out = [];
    for (let i = 0; i < frames; i++) {
      const t = duration ? duration * ((i + 0.5) / frames) : 0;
      await new Promise((resolve) => {
        const done = () => { video.removeEventListener('seeked', done); resolve(); };
        video.addEventListener('seeked', done);
        video.currentTime = t;
        setTimeout(done, 5000);
      });
      ctx.drawImage(video, 0, 0, w, h);
      out.push({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h, channels: 4 });
    }
    return { frames: out, duration };
  } finally {
    video.removeAttribute('src');
    video.load();
  }
}

// Up to three 10-second windows (at 25%, 50% and 75% of the song).
export async function decodeMusic(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read the file (${res.status})`);
  const buf = await res.arrayBuffer();
  const ctx = new OfflineAudioContext(1, 1, 16000);
  const audio = await ctx.decodeAudioData(buf); // resampled to 16 kHz
  const n = audio.length;
  const mono = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels;
  }
  const win = 16000 * 10;
  const windows = n <= win ? [mono] : [0.25, 0.5, 0.75].map((p) => {
    const start = Math.min(n - win, Math.max(0, Math.floor(n * p - win / 2)));
    return mono.slice(start, start + win);
  });
  return { windows, duration: audio.duration };
}

// A whole voice message as 16 kHz mono (for Whisper), up to five minutes.
export async function decodeSpeech(url) {
  const { windows, duration } = await decodeAll(url, 16000 * 300);
  return { pcm: windows[0], duration };
}

async function decodeAll(url, max) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not read the file (${res.status})`);
  const audio = await new OfflineAudioContext(1, 1, 16000).decodeAudioData(await res.arrayBuffer());
  const n = Math.min(audio.length, max);
  const mono = new Float32Array(n);
  for (let c = 0; c < audio.numberOfChannels; c++) {
    const d = audio.getChannelData(c);
    for (let i = 0; i < n; i++) mono[i] += d[i] / audio.numberOfChannels;
  }
  return { windows: [mono], duration: audio.duration };
}

// Answers the main process's decode requests.
export function serveDecodes(api) {
  api.onLibraryDecode(async ({ id, kind, url }) => {
    try {
      const res = kind === 'video' ? await decodeVideo(url) : kind === 'speech' ? await decodeSpeech(url) : await decodeMusic(url);
      await api.libraryDecoded({ id, ...res });
    } catch (err) {
      await api.libraryDecoded({ id, error: String(err?.message || err) });
    }
  });
}
