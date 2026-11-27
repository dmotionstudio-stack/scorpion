// Moves audio between the microphone, the speakers and the main process,
// where Whisper (listening) and Kokoro (speaking) run. Nothing here leaves the
// computer.

import { isVoiceFrame } from './voice-focus.js';

const RATE = 16000; // what Whisper expects

// Speculative listening: at the first short pause the speech so far is already transcribed, while the recorder waits to see if
// the turn is over. If it is, the transcript is ready (or nearly) when the turn ends; if you carry on, it is thrown away.
// The speech is the same when only quiet was added since the snapshot (no more than ~0.9 s of it).
export const canReuse = (snapshotSamples, finalSamples, rate = RATE) => Boolean(snapshotSamples) && finalSamples >= snapshotSamples && finalSamples - snapshotSamples <= rate * 0.9;

// How long a pause has to be to end your turn. Scorpion waits for you to finish: a person pauses to think, so the quiet that ends a
// turn is a second and a half or more, longer the longer you have been speaking, longer again when what was said so far trails
// off ("and", "because", a comma) and a little shorter after a finished sentence. text: what was heard so far (or null).
const TRAILS_OFF = /(?:^|\s)(?:and|but|so|because|or|then|if|when|while|that|which|who|to|of|for|with|the|a|an|my|your|like|um|uh|er|erm|well|also|plus|than|as|at|in|on|about|into|is|are|was|were|i|we|you|it|they|what|how|why)$/i;
export function endPause(speechMs, text = null) {
  let ms = speechMs < 2500 ? 1400 : speechMs < 8000 ? 1700 : 2100;
  if (typeof text === 'string' && text.trim()) {
    const t = text.trim();
    if (/(?:[,;:\u2013\u2014-]|\.\.\.|\u2026)$/.test(t) || (!/[.!?]$/.test(t) && TRAILS_OFF.test(t))) ms += 1200;
    else if (/[.!?]$/.test(t)) ms -= 300;
  }
  return ms;
}

// Records the microphone at 16 kHz. With `vad` on, it waits for speech, then
// stops by itself after a pause and hands the audio to onEnd; with keepOpen
// too, it hands each piece over and carries on listening (Type what I say).
export class Recorder {
  get active() { return Boolean(this.ctx); }

  // endMs: how long a pause ends your turn (a short turn, under ~3 s, gets endShortMs: quick commands and questions).
  // onPause(pcm): called once per pause (after specMs of quiet) with the speech so far, a copy; the recording goes on.
  // voiceFocus: only a human voice starts a turn and keeps it going (fans, keyboards, hiss and hum do not); see voice-focus.js.
  // pauseMs: a fixed time of quiet that ends the turn (2.5 s: Settings → Voice and hands); 0: it decides, as follows.
  // patient (the default): the turn ends after endPause() of quiet, which waits for you to finish; hint() gives what was heard so
  // far (the speculative transcript) so a sentence that trails off is given more time. Without it, endMs/endShortMs as before.
  // onEnd(pcm, { specOk }): specOk is true when nothing but quiet followed the last onPause snapshot (so its transcript stands).
  async start({ vad = true, onEnd, onLevel, keepOpen = false, endMs = 800, endShortMs = endMs, onPause = null, specMs = 320, voiceFocus = true, patient = true, hint = null, pauseMs = 0 } = {}) {
    if (this.ctx) return;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    // A microphone muted in the system (or with the laptop's mic key) opens
    // fine but only ever sends silence, so say so instead of listening forever.
    const track = this.stream.getAudioTracks()[0];
    if (track?.muted) await new Promise((resolve) => { track.addEventListener('unmute', resolve, { once: true }); setTimeout(resolve, 700); });
    if (track?.muted) {
      for (const t of this.stream.getTracks()) t.stop();
      throw Object.assign(new Error('The microphone is muted'), { name: 'MicMuted' });
    }
    this.ctx = new AudioContext({ sampleRate: RATE });
    let source = this.ctx.createMediaStreamSource(this.stream);
    if (voiceFocus) {
      // Speech lives between about 90 Hz and 6 kHz: the rumble below and the hiss above are cut before anything listens.
      const high = this.ctx.createBiquadFilter();
      high.type = 'highpass'; high.frequency.value = 90; high.Q.value = 0.7;
      const low = this.ctx.createBiquadFilter();
      low.type = 'lowpass'; low.frequency.value = 6000; low.Q.value = 0.7;
      source.connect(high); high.connect(low);
      source = low;
    }
    const node = this.ctx.createScriptProcessor(2048, 1, 1); // 128 ms steps: the end of speech is noticed sooner
    this.chunks = [];
    let heard = false;
    let quietMs = 0;
    let spokenMs = 0;
    let noise = 0.01;
    let voicedRun = 0; // frames in a row that were a voice, before the turn starts
    let sinceVoiceMs = 1e9; // how long since a voice was last heard, while it goes on
    let paused = false; // onPause already called for this pause
    let specOk = false; // the speech since the last snapshot is only quiet
    node.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.sqrt(sum / data.length);
      onLevel?.(level);
      const ms = (data.length / RATE) * 1000;
      if (!vad) { this.chunks.push(data); return; }
      const loudNow = level > Math.max(0.02, noise * 3);
      const voiced = !voiceFocus || (loudNow && isVoiceFrame(data, RATE));
      sinceVoiceMs = voiced && loudNow ? 0 : sinceVoiceMs + ms;
      // With voice focus, a noise that is loud (a clap, a fan starting) is not a turn, and does not hold one open either.
      const loud = loudNow && (!voiceFocus || sinceVoiceMs < 500);
      if (!heard) {
        // Learn the room's background level and keep a little audio from just
        // before speech starts, so the first word isn't cut off.
        noise = noise * 0.95 + level * 0.05;
        this.chunks.push(data);
        if (this.chunks.length > (voiceFocus ? 5 : 3)) this.chunks.shift();
        voicedRun = voiced && loudNow ? voicedRun + 1 : loudNow ? Math.max(0, voicedRun - 1) : 0;
        heard = voiceFocus ? voicedRun >= 2 : loud; // two frames (a quarter of a second) of voice start a turn
        return;
      }
      this.chunks.push(data);
      spokenMs += ms;
      quietMs = loud ? 0 : quietMs + ms;
      if (loud) { if (paused) specOk = false; paused = false; }
      else if (onPause && !paused && quietMs >= specMs && spokenMs - quietMs > 500) { paused = true; specOk = true; onPause(this.snapshot()); }
      // A pause ends your turn: quick, like a person waiting for you to finish (a little shorter after a short sentence).
      const wait = pauseMs > 0 ? pauseMs : patient ? endPause(spokenMs - quietMs, hint?.() ?? null) : spokenMs < 3000 ? endShortMs : endMs;
      if (quietMs > wait || spokenMs > 90000) {
        const meta = { specOk: paused && specOk };
        if (!keepOpen) { onEnd?.(this.stop(), meta); return; }
        const pcm = this.take();
        heard = false;
        quietMs = 0;
        spokenMs = 0;
        paused = false;
        specOk = false;
        onEnd?.(pcm, meta);
      }
    };
    source.connect(node);
    node.connect(this.ctx.destination);
    this.node = node;
  }

  // Stops recording and returns the audio (Float32Array, 16 kHz mono).
  stop() {
    if (!this.ctx) return new Float32Array(0);
    this.node.onaudioprocess = null;
    for (const t of this.stream.getTracks()) t.stop();
    this.ctx.close().catch(() => {});
    this.ctx = null;
    return this.take();
  }

  // A copy of the audio recorded so far (the recording goes on).
  snapshot() {
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(length);
    let at = 0;
    for (const c of this.chunks) { pcm.set(c, at); at += c.length; }
    return pcm;
  }

  // The audio recorded so far, and a fresh start for what comes next.
  take() {
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(length);
    let at = 0;
    for (const c of this.chunks) { pcm.set(c, at); at += c.length; }
    this.chunks = [];
    return pcm;
  }
}

// How much of the silence at a clip's start and end is kept. Kokoro pads every clip with roughly 0.3 s before and 0.45 s after
// the words; played one after another that is a pause of almost a second between sentences.
export const KEEP_LEAD_MS = 25;
export const KEEP_TAIL_MS = 60;
const FADE_MS = 4;
const QUIET = 0.01; // below this a sample counts as silence

// A clip without the silence Kokoro puts round the words (a short fade at each end keeps the cut from clicking).
export function trimClip(audio, sampleRate, { lead = KEEP_LEAD_MS, tail = KEEP_TAIL_MS } = {}) {
  let a = 0;
  let b = audio.length - 1;
  while (a < audio.length && Math.abs(audio[a]) < QUIET) a++;
  while (b > a && Math.abs(audio[b]) < QUIET) b--;
  if (a >= audio.length) return audio; // all quiet: left as it was
  const from = Math.max(0, a - Math.round((lead / 1000) * sampleRate));
  const to = Math.min(audio.length, b + 1 + Math.round((tail / 1000) * sampleRate));
  const out = Float32Array.from(audio.subarray(from, to));
  const fade = Math.min(Math.round((FADE_MS / 1000) * sampleRate), out.length >> 1);
  for (let i = 0; i < fade; i++) { const g = i / fade; out[i] *= g; out[out.length - 1 - i] *= g; }
  return out;
}

// Speaks text as it streams in: whole sentences are synthesized one after another as soon as they arrive (not when the sentence
// before has finished playing), and each clip is placed on the audio clock right behind the one before it, so the voice
// carries on without a gap as long as the next clip is ready in time.
export class Speaker {
  constructor(synthesize, { makeContext = () => new AudioContext() } = {}) {
    this.synthesize = synthesize; // text => Promise<{ sampleRate, audio }>
    this.makeContext = makeContext;
    this.buffer = '';
    this.queue = []; // { promise } for each piece, in order, already being synthesized
    this.playing = false;
    this.generation = 0;
    this.onIdle = null;
    this.onChange = null; // speaking started or stopped
    this.spokeYet = false; // first piece of a reply is cut early so speech starts sooner
    this.sources = new Set(); // clips scheduled and not yet finished
    this.endAt = 0; // where the audio clock ends the last scheduled clip
    this.chain = Promise.resolve(); // synthesis goes one piece at a time (the voice model uses every core for each)
    this.pumping = false;
    this.wake = null; // resolves the pump's wait for a new piece or the end of playback
  }

  get busy() { return this.playing || this.queue.length > 0; }

  feed(delta) {
    this.buffer += delta;
    let cut;
    while ((cut = nextCut(this.buffer, !this.spokeYet)) > 0) {
      this.spokeYet = true;
      this.enqueue(this.buffer.slice(0, cut));
      this.buffer = this.buffer.slice(cut);
    }
  }

  // The reply is complete: speak whatever is left.
  flush() {
    const rest = this.buffer;
    this.buffer = '';
    if (rest.trim()) this.enqueue(rest);
    else if (!this.busy) this.onIdle?.();
  }

  say(text) {
    this.stop();
    this.feed(text);
    this.flush();
  }

  enqueue(text) {
    const gen = this.generation;
    const run = this.chain.then(() => (gen === this.generation ? this.synthesize(text) : null));
    this.chain = run.catch(() => {});
    this.queue.push({ promise: run.catch(() => null) });
    this.wake?.();
    this.pump();
  }

  // Takes the pieces in order as each is synthesized and puts them on the audio clock.
  async pump() {
    if (this.pumping) return;
    this.pumping = true;
    if (!this.playing) { this.playing = true; this.onChange?.(); }
    const gen = this.generation;
    for (;;) {
      while (this.queue.length && gen === this.generation) {
        const clip = await this.queue.shift().promise;
        if (gen !== this.generation) break;
        if (clip?.system) { await this.drain(gen); if (gen === this.generation) await this.playSystem(clip); }
        else if (clip?.audio?.length) this.schedule(clip);
      }
      if (gen !== this.generation) return; // stop() was called: it has reset everything, and a newer pump may be running
      if (!this.sources.size) break; // nothing queued and nothing still playing: the reply has been spoken
      // Still playing: wait for the next piece (it goes on the clock behind the last one) or for the last clip to end.
      await new Promise((resolve) => { this.wake = resolve; });
      this.wake = null;
    }
    this.pumping = false;
    this.playing = false;
    this.endAt = 0;
    this.onChange?.();
    this.onIdle?.();
  }

  context() {
    if (!this.ctx) {
      this.ctx = this.makeContext();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      this.analyser.connect(this.ctx.destination);
    }
    return this.ctx;
  }

  // Starts a clip right when the one before it ends (or at once when nothing is playing).
  schedule({ sampleRate, audio }) {
    const ctx = this.context();
    const pcm = trimClip(audio instanceof Float32Array ? audio : new Float32Array(audio), sampleRate);
    const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
    buffer.copyToChannel(pcm, 0);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.analyser);
    const at = Math.max(ctx.currentTime + 0.01, this.endAt);
    this.endAt = at + buffer.duration;
    this.sources.add(source);
    source.onended = () => { this.sources.delete(source); this.wake?.(); };
    source.start(at);
  }

  // Waits until everything scheduled has been played (or stop() was called).
  async drain(gen) {
    while (this.sources.size && gen === this.generation) await new Promise((r) => setTimeout(r, 20));
  }

  // Languages without a downloaded voice use the computer's own voice for
  // that language, if it has one (Windows and macOS language packs).
  playSystem({ text, lang }) {
    return new Promise((resolve) => {
      const synth = window.speechSynthesis;
      const voice = synth?.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang));
      if (!voice) { this.onNoVoice?.(lang); resolve(); return; }
      const u = new SpeechSynthesisUtterance(text);
      u.voice = voice;
      u.lang = voice.lang;
      u.onend = u.onerror = () => resolve();
      this.utterance = u;
      synth.speak(u);
    });
  }

  // How loud the current speech is right now, 0..1 (drives the orb).
  level() {
    if (!this.playing || !this.analyser) return 0;
    const buf = (this.levelBuf ??= new Float32Array(this.analyser.fftSize));
    this.analyser.getFloatTimeDomainData(buf);
    let sum = 0;
    for (const v of buf) sum += v * v;
    return Math.min(1, Math.sqrt(sum / buf.length) * 4);
  }

  stop() {
    this.generation++;
    this.queue = [];
    this.buffer = '';
    this.playing = false;
    this.pumping = false;
    this.wake?.();
    this.chain = Promise.resolve(); // a new reply doesn't wait behind a piece still being synthesized for the old one
    for (const s of this.sources) { s.onended = null; try { s.stop(); } catch { /* not started */ } }
    this.sources.clear();
    this.endAt = 0;
    if (this.utterance) { window.speechSynthesis?.cancel(); this.utterance = null; }
    this.spokeYet = false;
    this.onChange?.();
  }
}

// Where the next speakable piece ends: after a sentence of at least ~30
// characters or a paragraph break. Code blocks are held until they close.
// The first piece of a reply may also end at a comma, so speech starts sooner.
export function nextCut(text, first = false) {
  const fences = text.split('```').length - 1;
  if (fences % 2) return -1;
  if (fences) return text.lastIndexOf('```') + 3;
  const re = first ? /[.!?…,;:]["')\]*_]*\s+|\n\s*\n/g : /[.!?…]["')\]*_]*\s+|\n\s*\n/g;
  const min = first ? 18 : 30;
  let m;
  while ((m = re.exec(text))) {
    const end = m.index + m[0].length;
    if (end >= min || m[0].includes('\n')) return end;
  }
  return -1;
}
