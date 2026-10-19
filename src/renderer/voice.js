// Moves audio between the microphone, the speakers and the main process,
// where Whisper (listening) and Kokoro (speaking) run. Nothing here leaves the
// computer.

const RATE = 16000; // what Whisper expects

// Records the microphone at 16 kHz. With `vad` on, it waits for speech, then
// stops by itself after a pause and hands the audio to onEnd.
export class Recorder {
  get active() { return Boolean(this.ctx); }

  async start({ vad = true, onEnd, onLevel } = {}) {
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
    const source = this.ctx.createMediaStreamSource(this.stream);
    const node = this.ctx.createScriptProcessor(4096, 1, 1);
    this.chunks = [];
    let heard = false;
    let quietMs = 0;
    let spokenMs = 0;
    let noise = 0.01;
    node.onaudioprocess = (e) => {
      const data = new Float32Array(e.inputBuffer.getChannelData(0));
      let sum = 0;
      for (const v of data) sum += v * v;
      const level = Math.sqrt(sum / data.length);
      onLevel?.(level);
      const ms = (data.length / RATE) * 1000;
      if (!vad) { this.chunks.push(data); return; }
      const loud = level > Math.max(0.02, noise * 3);
      if (!heard) {
        // Learn the room's background level and keep a little audio from just
        // before speech starts, so the first word isn't cut off.
        noise = noise * 0.95 + level * 0.05;
        this.chunks.push(data);
        if (this.chunks.length > 3) this.chunks.shift();
        heard = loud;
        return;
      }
      this.chunks.push(data);
      spokenMs += ms;
      quietMs = loud ? 0 : quietMs + ms;
      // ~0.8 s of quiet ends your turn: quick, like a person waiting for you to finish.
      if (quietMs > 800 || spokenMs > 30000) onEnd?.(this.stop());
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
    const length = this.chunks.reduce((n, c) => n + c.length, 0);
    const pcm = new Float32Array(length);
    let at = 0;
    for (const c of this.chunks) { pcm.set(c, at); at += c.length; }
    this.chunks = [];
    return pcm;
  }
}

// Speaks text as it streams in: whole sentences are synthesized and played in
// order, and the next sentence is synthesized while the current one plays.
export class Speaker {
  constructor(synthesize) {
    this.synthesize = synthesize; // text => Promise<{ sampleRate, audio }>
    this.buffer = '';
    this.queue = [];
    this.playing = false;
    this.generation = 0;
    this.onIdle = null;
    this.onChange = null; // speaking started or stopped
    this.spokeYet = false; // first piece of a reply is cut early so speech starts sooner
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
    this.queue.push(text);
    this.pump();
  }

  async pump() {
    if (this.playing) return;
    this.playing = true;
    this.onChange?.();
    const gen = this.generation;
    const next = () => (this.queue.length ? this.synthesize(this.queue.shift()).catch(() => null) : null);
    let pending = next();
    while (pending && gen === this.generation) {
      const clip = await pending;
      pending = next(); // synthesize the next sentence while this one plays
      if (clip?.system && gen === this.generation) await this.playSystem(clip);
      else if (clip?.audio?.length && gen === this.generation) await this.play(clip);
      pending ??= next();
    }
    if (gen !== this.generation) return;
    this.playing = false;
    this.onChange?.();
    this.onIdle?.();
  }

  play({ sampleRate, audio }) {
    return new Promise((resolve) => {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.analyser = this.ctx.createAnalyser();
        this.analyser.fftSize = 1024;
        this.analyser.connect(this.ctx.destination);
      }
      const buffer = this.ctx.createBuffer(1, audio.length, sampleRate);
      buffer.copyToChannel(audio instanceof Float32Array ? audio : new Float32Array(audio), 0);
      const source = this.ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(this.analyser);
      source.onended = () => resolve();
      this.source = source;
      source.start();
    });
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
    try { this.source?.stop(); } catch { /* not playing */ }
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
