// Scorpion OS's desktop background (wallpaper.html): the picture chosen in
// Scorpion (Settings → Windows and taskbar, or right-click here), shown
// again whenever it changes; the theme's colours otherwise.
const api = window.scorpion;
let shown = null;
async function show(settings) {
  const s = settings || (await api.state().catch(() => null))?.settings;
  if (s?.theme) document.documentElement.dataset.theme = s.theme;
  if (s && s.background === shown) return;
  shown = s?.background ?? null;
  const url = await api.desktopBackground().catch(() => null);
  document.documentElement.style.setProperty('--wall', url ? `url("${url}")` : 'none');
}
document.addEventListener('contextmenu', (e) => { e.preventDefault(); api.shellMenu({ kind: 'desktop' }); });
api.onSettingsChanged?.((s) => show(s));
// Scorpion may not answer yet when the host loads this page: asked again until it does.
const start = () => show().catch(() => setTimeout(start, 2000));
start();
