// The floating orb's page (main/float-orb.js calls showFloat). Click: call Scorpion.
// Drag: move it. Right-click: its menu.
window.showFloat = ({ state, text, theme, side } = {}) => {
  if (theme) document.documentElement.dataset.theme = theme;
  const wrap = document.getElementById('wrap');
  if (state) wrap.dataset.state = state;
  if (side) wrap.dataset.side = side;
  if (text !== undefined) document.getElementById('bubble').textContent = text;
};
window.addEventListener('DOMContentLoaded', () => {
  const orb = document.getElementById('orb');
  let d = null;
  orb.addEventListener('pointerdown', (e) => { if (e.button !== 0) return; d = { x: e.screenX, y: e.screenY, moved: false }; orb.setPointerCapture(e.pointerId); });
  orb.addEventListener('pointermove', (e) => {
    if (!d) return;
    if (!d.moved && Math.hypot(e.screenX - d.x, e.screenY - d.y) < 5) return;
    if (!d.moved) { d.moved = true; orb.classList.add('dragging'); window.scorpionFloat.drag('start', d.x, d.y); }
    window.scorpionFloat.drag('move', e.screenX, e.screenY);
  });
  orb.addEventListener('pointerup', (e) => {
    const was = d;
    d = null;
    orb.classList.remove('dragging');
    if (!was) return;
    if (was.moved) window.scorpionFloat.drag('end', e.screenX, e.screenY); else window.scorpionFloat.click();
  });
  window.addEventListener('contextmenu', (e) => { e.preventDefault(); window.scorpionFloat.menu(); });
});
