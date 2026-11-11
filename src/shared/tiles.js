// The orb's screen as tiles: every app that opens inside Interact gets a tile, the orb
// keeps a tile of its own (always there), and the tiles share the stage like Windows Snap.
// Where an app opens decides where the orb goes: an app that opened on the left of the
// screen takes the left, one that opened on the right takes the right, and the orb stays
// between them. Pure functions (no page, no window), so they are tested on their own.
//   items:   the tile ids in order, 'orb' among them (the app windows' numbers as text)
//   weights: { cols: [..], rows: [..] } how wide and tall the columns and rows are, relative
//   stage:   { x, y, w, h } where the tiles may go

export const MAX_APPS = 6; // more than this stay ordinary windows
export const GAP = 12; // between tiles: where the dividers are
export const HEADER = 34; // each tile's title bar (drawn by the page; the app's window starts below it)
const MIN_FRACTION = 0.14; // no column or row gets narrower than this share

// Up to three tiles in one row; more in two rows.
export function gridFor(count) {
  const rows = count <= 3 ? 1 : 2;
  return { rows, cols: Math.max(1, Math.ceil(count / rows)) };
}

// The orb's column starts narrower than the apps' columns, and Scorpion's own page (Home, chat, Settings) wider.
export function defaultWeights(items) {
  const { rows, cols } = gridFor(items.length);
  const orbCol = items.indexOf('orb') % cols;
  const pageCol = items.indexOf('scorpion') % cols;
  const weight = (c) => (items.length > 1 && items.includes('orb') && c === orbCol ? 0.62 : items.includes('scorpion') && c === pageCol ? 1.5 : 1);
  return { n: items.length, cols: Array.from({ length: cols }, (_, c) => weight(c)), rows: Array(rows).fill(1) };
}
// The user's sizes are kept while the number of tiles stays the same.
export const ensureWeights = (weights, items) => (weights && weights.n === items.length ? weights : defaultWeights(items));

const share = (list, total) => { const sum = list.reduce((a, b) => a + b, 0) || 1; return list.map((w) => (w / sum) * total); };

// Where each tile goes: { grid, cells: [{ id, rect, header, body }], dividers: [{ axis, index, rect }] }.
export function arrange(items, stage, weights, { gap = GAP, header = HEADER } = {}) {
  const n = items.length;
  const grid = gridFor(n);
  const w = ensureWeights(weights, items);
  const colPx = share(w.cols, stage.w - gap * (grid.cols - 1));
  const rowPx = share(w.rows, stage.h - gap * (grid.rows - 1));
  const colX = []; // the left edge of each column
  let x = stage.x;
  for (const px of colPx) { colX.push(x); x += px + gap; }
  const rowY = [];
  let y = stage.y;
  for (const px of rowPx) { rowY.push(y); y += px + gap; }
  const cells = items.map((id, i) => {
    const row = Math.floor(i / grid.cols);
    const col = i % grid.cols;
    // The last tile of a short last row takes the room of the empty cells after it.
    const last = i === n - 1;
    const right = last ? colX[grid.cols - 1] + colPx[grid.cols - 1] : colX[col] + colPx[col];
    const rect = { x: Math.round(colX[col]), y: Math.round(rowY[row]), w: Math.round(right - colX[col]), h: Math.round(rowPx[row]) };
    return { id, rect, header: { x: rect.x, y: rect.y, w: rect.w, h: header }, body: { x: rect.x, y: rect.y + header, w: rect.w, h: Math.max(0, rect.h - header) }, row, col };
  });
  const dividers = [];
  for (let c = 0; c < grid.cols - 1; c++) dividers.push({ axis: 'col', index: c, rect: { x: Math.round(colX[c] + colPx[c]), y: Math.round(stage.y), w: gap, h: Math.round(stage.h) } });
  for (let r = 0; r < grid.rows - 1; r++) dividers.push({ axis: 'row', index: r, rect: { x: Math.round(stage.x), y: Math.round(rowY[r] + rowPx[r]), w: Math.round(stage.w), h: gap } });
  return { grid, cells, dividers, weights: w };
}

// Dragging a divider by deltaPx: the two columns (or rows) beside it trade room; the rest stay. minPx: the
// least room a column or row keeps (an app window has a smallest size of its own, and spills out of a tile below it).
export function resizeWeights(weights, axis, index, deltaPx, totalPx, minPx = 0) {
  const list = [...(axis === 'col' ? weights.cols : weights.rows)];
  if (index < 0 || index >= list.length - 1 || !totalPx) return weights;
  const sum = list.reduce((a, b) => a + b, 0);
  const move = (deltaPx / totalPx) * sum;
  const pair = list[index] + list[index + 1];
  const min = Math.min(pair / 2, Math.max(MIN_FRACTION, minPx / totalPx) * sum);
  const a = Math.max(min, Math.min(pair - min, list[index] + move));
  list[index] = a;
  list[index + 1] = pair - a;
  return axis === 'col' ? { ...weights, cols: list } : { ...weights, rows: list };
}

// Which side of the screen a window was on when it opened (its centre against the screen's middle).
export const sideOfRect = (rect, screenWidth) => ((rect.left + rect.right) / 2 < screenWidth / 2 ? 'left' : 'right');

// A new app joins on the side it opened on, so the orb ends up between the apps, or beside them on the other side.
export function insertApp(items, id, side) {
  if (items.includes(id)) return items;
  return side === 'left' ? [id, ...items] : [...items, id];
}
export const removeApp = (items, id) => (id === 'orb' ? items : items.filter((x) => x !== id));
// One place earlier or later (the orb can move too), or up/down a row when the tiles are in two rows.
export function moveItem(items, id, delta) {
  const i = items.indexOf(id);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= items.length) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
export function swapItems(items, a, b) {
  const i = items.indexOf(a);
  const j = items.indexOf(b);
  if (i < 0 || j < 0 || i === j) return items;
  const next = [...items];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}
// The tile under a point (for dropping a title bar onto another tile), or null.
export const cellAt = (cells, x, y) => cells.find((c) => x >= c.rect.x && x < c.rect.x + c.rect.w && y >= c.rect.y && y < c.rect.y + c.rect.h) || null;
