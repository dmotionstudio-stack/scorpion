// The on-screen volume and brightness (osd.html, shown by the native shell host).
const api = window.scorpion;
const ICONS = {
  volume: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7"/><path d="M19 6a9 9 0 0 1 0 12"/>',
  muted: '<path d="M4 9h4l5-4v14l-5-4H4z"/><path d="m17 9 5 5m0-5-5 5"/>',
  brightness: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
};
let hide = null;
// { kind: 'volume' | 'brightness', level: 0-100, muted }: shown for a moment.
api.onOsd(({ kind, level, muted }) => {
  document.getElementById('icon').innerHTML = kind === 'volume' && muted ? ICONS.muted : ICONS[kind] || ICONS.volume;
  document.getElementById('fill').style.width = `${Math.max(0, Math.min(100, level))}%`;
  document.getElementById('num').textContent = muted ? 'Muted' : `${Math.round(level)}%`;
  document.getElementById('osd').classList.toggle('muted', Boolean(muted));
  api.host({ type: 'size', panel: 'osd', visible: true });
  clearTimeout(hide);
  hide = setTimeout(() => api.host({ type: 'size', panel: 'osd', visible: false }), 1500);
});
api.state().then((st) => { if (st?.settings?.theme) document.documentElement.dataset.theme = st.settings.theme; }).catch(() => {});
