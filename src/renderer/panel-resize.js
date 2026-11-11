// The chat's side panels (Preview and Terminal, and the Plan): each can be dragged wider or narrower by the edge it
// shares with the chat, and the conversation always keeps room to be read and continued in. When the chat is too narrow
// for panels beside it (a small window, or a tile of the orb), they go under the conversation instead, and the edge to
// drag is the one above them. The sizes are kept on this computer. layoutPanels is a plain function (tested on its own).

export const MIN_CHAT = 360; // the least width the conversation keeps beside the panels
export const MIN_CHAT_H = 170; // and the least height above panels that are under it
const MIN = { dock: 260, plan: 200 };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// size: { w, h } of the chat's body. open: { dock, plan }. want: the sizes the person dragged to (px, or null).
// Returns { stacked, dock, plan } in px (the width beside, or the height under, as stacked says).
export function layoutPanels(size, open, want = {}) {
  const side = Boolean(open.dock) + Boolean(open.plan);
  if (!side) return { stacked: false, dock: 0, plan: 0 };
  const needed = (open.dock ? MIN.dock : 0) + (open.plan ? MIN.plan : 0);
  if (size.w - MIN_CHAT < needed) {
    // Under the conversation: it keeps MIN_CHAT_H, the panels share the rest.
    const room = Math.max(120, size.h - MIN_CHAT_H);
    let dock = open.dock ? clamp(want.dockH ?? size.h * 0.42, 120, room) : 0;
    let plan = open.plan ? clamp(want.planH ?? size.h * 0.3, 90, room) : 0;
    if (dock + plan > room) {
      const over = dock + plan - room;
      const fromDock = Math.min(over, Math.max(0, dock - 120));
      dock -= fromDock;
      plan -= over - fromDock;
    }
    return { stacked: true, dock: Math.round(dock), plan: Math.round(Math.max(open.plan ? 90 : 0, plan)) };
  }
  const avail = size.w - MIN_CHAT;
  let dock = open.dock ? clamp(want.dockW ?? size.w * 0.46, MIN.dock, avail - (open.plan ? MIN.plan : 0)) : 0;
  let plan = open.plan ? clamp(want.planW ?? 280, MIN.plan, avail - (open.dock ? MIN.dock : 0)) : 0;
  if (dock + plan > avail) { // too much asked: the Preview gives way first, then the Plan
    const over = dock + plan - avail;
    const fromDock = Math.min(over, Math.max(0, dock - MIN.dock));
    dock -= fromDock;
    plan -= over - fromDock;
  }
  return { stacked: false, dock: Math.round(dock), plan: Math.round(plan) };
}

// A size dragged to: the panel's edge follows the pointer.
export const widthFromDrag = (startW, startX, x) => Math.round(startW + (startX - x));
export const heightFromDrag = (startH, startY, y) => Math.round(startH + (startY - y));

export function initPanelResize({ $ }) {
  const body = document.querySelector('.chat-body');
  if (!body) return { relayout() {} };
  const panels = { dock: $('#dock-panel'), plan: $('#plan-panel') };
  const keep = (k, v) => { try { if (v == null) localStorage.removeItem(`panel.${k}`); else localStorage.setItem(`panel.${k}`, String(Math.round(v))); } catch { /* not kept */ } };
  const kept = (k) => { try { const v = Number(localStorage.getItem(`panel.${k}`)); return Number.isFinite(v) && v > 0 ? v : null; } catch { return null; } };
  const want = { dockW: kept('dockW'), planW: kept('planW'), dockH: kept('dockH'), planH: kept('planH') };

  function relayout() {
    const open = { dock: !panels.dock.classList.contains('hidden'), plan: !panels.plan.classList.contains('hidden') };
    const size = { w: body.clientWidth, h: body.clientHeight };
    if (!size.w) return;
    const L = layoutPanels(size, open, want);
    body.classList.toggle('stacked', L.stacked);
    const set = (name, v) => (v ? body.style.setProperty(name, `${v}px`) : body.style.removeProperty(name));
    set('--dock-w', L.stacked ? 0 : L.dock);
    set('--plan-w', L.stacked ? 0 : L.plan);
    set('--dock-h', L.stacked ? L.dock : 0);
    set('--plan-h', L.stacked ? L.plan : 0);
  }
  for (const [name, el] of Object.entries(panels)) {
    const grip = document.createElement('div');
    grip.className = 'panel-grip';
    grip.title = 'Drag to resize';
    grip.setAttribute('aria-hidden', 'true');
    el.prepend(grip);
    let drag = null;
    grip.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const r = el.getBoundingClientRect();
      drag = { stacked: body.classList.contains('stacked'), x: e.clientX, y: e.clientY, w: r.width, h: r.height };
      grip.setPointerCapture(e.pointerId);
      grip.classList.add('on');
      e.preventDefault();
    });
    grip.addEventListener('pointermove', (e) => {
      if (!drag) return;
      if (drag.stacked) want[`${name}H`] = heightFromDrag(drag.h, drag.y, e.clientY);
      else want[`${name}W`] = widthFromDrag(drag.w, drag.x, e.clientX);
      relayout();
    });
    const end = () => {
      if (!drag) return;
      const key = `${name}${drag.stacked ? 'H' : 'W'}`;
      keep(key, want[key]);
      drag = null;
      grip.classList.remove('on');
    };
    grip.addEventListener('pointerup', end);
    grip.addEventListener('pointercancel', end);
    grip.addEventListener('dblclick', () => { want[`${name}W`] = null; want[`${name}H`] = null; for (const k of ['W', 'H']) keep(`${name}${k}`, null); relayout(); }); // back to the usual size
    new MutationObserver(relayout).observe(el, { attributes: true, attributeFilter: ['class'] });
  }
  new ResizeObserver(relayout).observe(body);
  relayout();
  return { relayout };
}
