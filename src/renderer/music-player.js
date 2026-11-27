// Scorpion's own music player, the window's half: an audio element, the queue and a small player on the screen (in the orb too).
// The main process finds the songs for a request ("play some jazz": music.js) and sends them here; this plays them. Next, previous,
// shuffle and repeat are decided here, and the player says what it is doing back (music:report) so "what's playing?" can answer.
// While Scorpion listens or speaks the music goes quiet, and comes back after.

// The order songs play in. Shuffle plays every song once, in a mixed order that starts with the one chosen; repeat 'all' goes round
// again, 'one' stays on a song, 'off' stops after the last.
export class Queue {
  constructor(tracks = [], { shuffle = false, random = Math.random } = {}) {
    this.tracks = tracks.slice();
    this.random = random;
    this.shuffled = Boolean(shuffle);
    this.order = this.tracks.map((_, i) => i);
    this.at = 0; // a position in order
    if (this.shuffled) this.mix(0);
  }
  mix(first) {
    const rest = this.order.filter((i) => i !== first);
    for (let i = rest.length - 1; i > 0; i--) { const j = Math.floor(this.random() * (i + 1)); [rest[i], rest[j]] = [rest[j], rest[i]]; }
    this.order = [first, ...rest];
    this.at = 0;
  }
  get index() { return this.order[this.at] ?? 0; }
  get current() { return this.tracks[this.index] || null; }
  get size() { return this.tracks.length; }
  // The song after this one, or null at the end (repeat 'off'). 'one' stays.
  next(repeat = 'off') {
    if (!this.size) return null;
    if (repeat === 'one') return this.current;
    if (this.at + 1 < this.size) { this.at++; return this.current; }
    if (repeat === 'all') { if (this.shuffled) this.mix(this.index); else this.at = 0; return this.current; }
    return null;
  }
  previous() {
    if (!this.size) return null;
    this.at = this.at > 0 ? this.at - 1 : this.size - 1;
    return this.current;
  }
  setShuffle(on) {
    if (Boolean(on) === this.shuffled) return;
    const now = this.index;
    this.shuffled = Boolean(on);
    if (on) this.mix(now);
    else { this.order = this.tracks.map((_, i) => i); this.at = now; }
  }
}

// ctx: { $, api }
export function initMusicPlayer({ api }) {
  const audio = new Audio();
  audio.preload = 'auto';
  let queue = null;
  let repeat = 'off';
  let base = 1; // the volume the person chose
  let ducked = false;
  let failures = 0;
  try { const v = Number(localStorage.getItem('musicVolume')); if (v > 0 && v <= 1) base = v; } catch { /* default */ }

  const bar = document.createElement('div');
  bar.className = 'music-bar hidden';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Music player');
  bar.innerHTML = '<span class="music-note" aria-hidden="true">♪</span><span class="music-title" id="music-title" title="Drag to move"></span>'
    + '<button type="button" class="music-btn" data-m="previous" title="Previous song" aria-label="Previous song">⏮</button>'
    + '<button type="button" class="music-btn" data-m="toggle" id="music-toggle" title="Pause" aria-label="Pause">⏸</button>'
    + '<button type="button" class="music-btn" data-m="next" title="Next song" aria-label="Next song">⏭</button>'
    + '<input type="range" class="music-vol" id="music-vol" min="0" max="100" step="1" title="Music volume" aria-label="Music volume">'
    + '<button type="button" class="music-btn" data-m="stop" title="Stop the music" aria-label="Stop the music">✕</button>';
  document.body.appendChild(bar);
  const title = bar.querySelector('#music-title');
  const toggle = bar.querySelector('#music-toggle');
  const vol = bar.querySelector('#music-vol');

  const applyVolume = () => { audio.volume = Math.max(0, Math.min(1, ducked ? base * 0.25 : base)); vol.value = String(Math.round(base * 100)); };
  applyVolume();

  const state = () => ({
    playing: Boolean(queue && !audio.paused && !audio.ended), title: queue?.current?.title || '', path: queue?.current?.path || '',
    index: queue?.at ?? 0, total: queue?.size || 0, volume: base, shuffle: Boolean(queue?.shuffled), repeat,
    position: Math.round(audio.currentTime || 0), duration: Number.isFinite(audio.duration) ? Math.round(audio.duration) : 0,
  });
  let reportTimer = 0;
  const render = () => {
    const s = state();
    bar.classList.toggle('hidden', !queue || !s.title);
    title.textContent = s.title ? `${s.title}${s.total > 1 ? `  (${s.index + 1}/${s.total})` : ''}` : '';
    toggle.textContent = s.playing ? '⏸' : '▶';
    toggle.title = toggle.ariaLabel = s.playing ? 'Pause' : 'Play';
    if ('mediaSession' in navigator && s.title) {
      try { navigator.mediaSession.metadata = new MediaMetadata({ title: s.title, artist: 'Scorpion' }); navigator.mediaSession.playbackState = s.playing ? 'playing' : 'paused'; } catch { /* not offered */ }
    }
    clearTimeout(reportTimer);
    reportTimer = setTimeout(() => api.musicReport?.(queue ? state() : null).catch?.(() => {}), 80);
  };

  async function load(track) {
    if (!track) { stop(); return; }
    const url = await api.musicUrl(track.path).catch(() => null);
    if (!url) { failures++; if (failures < 5) return skip(); stop(); return; }
    audio.src = url;
    try { await audio.play(); failures = 0; } catch { failures++; if (failures < 5) return skip(); stop(); return; }
    render();
  }
  const skip = () => load(queue?.next(repeat === 'one' ? 'all' : repeat));
  function stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    queue = null;
    failures = 0;
    render();
  }

  audio.addEventListener('ended', () => { load(queue?.next(repeat)).then(() => { if (!queue) render(); }); });
  audio.addEventListener('play', render);
  audio.addEventListener('pause', render);
  audio.addEventListener('error', () => { if (queue && audio.src) { failures++; if (failures < 5) skip(); else stop(); } });

  const run = (cmd = {}) => {
    switch (cmd.action) {
      case 'play':
        failures = 0;
        queue = new Queue(cmd.tracks || [], { shuffle: Boolean(cmd.shuffle) });
        if (queue.size) load(queue.current); else stop();
        break;
      case 'pause': audio.pause(); break;
      case 'resume': if (queue) audio.play().catch(() => {}); break;
      case 'next': if (queue) load(queue.next(repeat === 'one' ? 'all' : repeat) || queue.current); break;
      case 'previous': if (queue) { if (audio.currentTime > 4) audio.currentTime = 0; else load(queue.previous()); } break;
      case 'stop': stop(); break;
      case 'volume': base = Math.max(0, Math.min(1, Number(cmd.amount))); try { localStorage.setItem('musicVolume', String(base)); } catch { /* not kept */ } applyVolume(); render(); break;
      case 'shuffle': if (queue) queue.setShuffle(!/off/i.test(cmd.value || 'on')); render(); break;
      case 'repeat': repeat = /one/i.test(cmd.value) ? 'one' : /all|on/i.test(cmd.value || 'all') ? 'all' : 'off'; render(); break;
      default: break;
    }
  };
  api.onMusicCmd?.(run);

  bar.addEventListener('click', (e) => {
    const m = e.target.closest('[data-m]')?.dataset.m;
    if (!m) return;
    if (m === 'toggle') run({ action: audio.paused ? 'resume' : 'pause' });
    else run({ action: m });
  });
  vol.addEventListener('input', () => run({ action: 'volume', amount: Number(vol.value) / 100 }));

  if ('mediaSession' in navigator) {
    for (const [name, action] of [['play', 'resume'], ['pause', 'pause'], ['nexttrack', 'next'], ['previoustrack', 'previous'], ['stop', 'stop']]) {
      try { navigator.mediaSession.setActionHandler(name, () => run({ action })); } catch { /* not offered */ }
    }
  }

  // Drag the player by its title; where it was left is kept.
  const place = (x, y) => { bar.style.left = `${Math.max(0, Math.min(innerWidth - 120, x))}px`; bar.style.top = `${Math.max(0, Math.min(innerHeight - 40, y))}px`; bar.style.right = 'auto'; };
  try { const p = JSON.parse(localStorage.getItem('musicBarAt') || 'null'); if (p) place(p.x, p.y); } catch { /* default place */ }
  title.addEventListener('pointerdown', (e) => {
    const r = bar.getBoundingClientRect();
    const dx = e.clientX - r.left; const dy = e.clientY - r.top;
    title.setPointerCapture(e.pointerId);
    const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
    const up = () => {
      title.removeEventListener('pointermove', move); title.removeEventListener('pointerup', up);
      const b = bar.getBoundingClientRect();
      try { localStorage.setItem('musicBarAt', JSON.stringify({ x: Math.round(b.left), y: Math.round(b.top) })); } catch { /* not kept */ }
    };
    title.addEventListener('pointermove', move); title.addEventListener('pointerup', up);
  });

  return {
    run,
    state,
    // Quiet while Scorpion listens or speaks.
    duck(on) { if (ducked !== Boolean(on)) { ducked = Boolean(on); applyVolume(); } },
  };
}
