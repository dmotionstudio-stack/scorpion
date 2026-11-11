// The orb's screen as tiles: every app that opens inside Interact gets a tile, the orb keeps a tile of its own
// (always there), and the tiles share the stage like Windows Snap. Where an app opens decides where the orb goes:
// an app that opened on the left of the screen takes the left, one on the right takes the right, and the orb stays
// between them. Pure functions (no page, no window), so they are tested on their own.
//   items:   the tile ids in order, 'orb' among them (the app windows' numbers as text)
//   weights: { cols: [..], rows: [..] } how wide and tall the columns and rows are, relative
//   stage:   { x, y, w, h } where the tiles may go
//   mode:    how they are laid out: 'auto' (a row, then two), 'columns' (side by side), 'rows' (one above the
//            other: resized from the top and the bottom) or 'grid' (two rows)
//   mins:    { id: { w, h } } the least room an app needs (its window has a smallest size of its own)

export const MAX_APPS = 6; // more than this stay ordinary windows
export const GAP = 12; // between tiles: where the dividers are
export const HEADER = 34; // each tile's title bar (drawn by the page; the app's window starts below it)
export const MODES = ['auto', 'columns', 'rows', 'grid'];
const MIN_FRACTION = 0.14; // no column or row gets narrower than this share

export const modeOf = (mode) => (MODES.includes(mode) ? mode : 'auto');

// Up to three tiles in one row; more in two rows ('auto'), or the way chosen.
export function gridFor(count, mode = 'auto') {
  const n = Math.max(1, count);
  const m = modeOf(mode);
  if (m === 'columns') return { rows: 1, cols: n };
  if (m === 'rows') return { rows: n, cols: 1 };
  const rows = m === 'grid' ? (n <= 1 ? 1 : 2) : n <= 3 ? 1 : 2;
  return { rows, cols: Math.max(1, Math.ceil(n / rows)) };
}

// The orb's column starts narrower than the apps' columns, and Scorpion's own page (Home, chat, Settings) wider.
export function defaultWeights(items, mode = 'auto') {
  const { rows, cols } = gridFor(items.length, mode);
  const weightOf = (id) => (items.length > 1 && id === 'orb' ? 0.62 : id === 'scorpion' ? 1.5 : 1);
  const axis = (count, groupOf) => Array.from({ length: count }, (_, k) => {
    const ids = items.filter((_, i) => groupOf(i) === k);
    return ids.includes('orb') ? weightOf('orb') : ids.includes('scorpion') ? weightOf('scorpion') : 1;
  });
  return {
    n: items.length,
    mode: modeOf(mode),
    cols: axis(cols, (i) => i % cols),
    rows: cols === 1 && rows > 1 ? axis(rows, (i) => i) : Array(rows).fill(1), // stacked, the orb's row is the shorter
  };
}
// The user's sizes are kept while the number of tiles and the layout stay the same.
export const ensureWeights = (weights, items, mode = 'auto') => (weights && weights.n === items.length && weights.mode === modeOf(mode) ? weights : defaultWeights(items, mode));

const share = (list, total) => { const sum = list.reduce((a, b) => a + b, 0) || 1; return list.map((w) => (w / sum) * total); };

// Automatic: two rows once there are four tiles, unless the apps' windows cannot be that short, and one row can hold them.
export function effectiveMode(items, stage, mode, mins = {}, { gap = GAP, header = HEADER } = {}) {
  const m = modeOf(mode);
  if (m !== 'auto' || items.length < 4) return m;
  const fits = (grid) => {
    const colMin = Array(grid.cols).fill(0);
    const rowMin = Array(grid.rows).fill(0);
    items.forEach((id, i) => { // every tile needs some room, whether or not its window says how much
      const k = mins[id] || {};
      colMin[i % grid.cols] = Math.max(colMin[i % grid.cols], k.w || 160);
      rowMin[Math.floor(i / grid.cols)] = Math.max(rowMin[Math.floor(i / grid.cols)], (k.h || 120) + header);
    });
    return colMin.reduce((a, b) => a + b, 0) + gap * (grid.cols - 1) <= stage.w + 0.5 && rowMin.reduce((a, b) => a + b, 0) + gap * (grid.rows - 1) <= stage.h + 0.5;
  };
  if (fits(gridFor(items.length, 'auto'))) return 'auto';
  return fits(gridFor(items.length, 'columns')) ? 'columns' : 'auto';
}

// Make every column (or row) at least as big as the least it needs, taking from the ones with room to spare.
// Returns sizes in px (usable as weights). If they cannot all have their least, the sizes stay as they are.
export function fitAxis(list, mins, total) {
  const sum = list.reduce((a, b) => a + b, 0) || 1;
  let px = list.map((w) => (w / sum) * total);
  const need = mins.reduce((a, b) => a + b, 0);
  if (!need) return px;
  if (need > total) return px; // they cannot all fit: the sizes are the person's to choose (a window that is too big is cut off at its tile)
  for (let guard = 0; guard < 8; guard++) {
    const short = px.map((p, i) => Math.max(0, mins[i] - p));
    const deficit = short.reduce((a, b) => a + b, 0);
    if (deficit < 0.5) break;
    const slack = px.map((p, i) => Math.max(0, p - mins[i]));
    const slackSum = slack.reduce((a, b) => a + b, 0) || 1;
    px = px.map((p, i) => (short[i] > 0 ? mins[i] : p - (deficit * slack[i]) / slackSum));
  }
  return px;
}

// Where each tile goes: { grid, cells: [{ id, rect, header, body }], dividers: [{ axis, index, rect }], weights, colMin, rowMin }.
export function arrange(items, stage, weights, { gap = GAP, header = HEADER, mode: asked = 'auto', mins = {} } = {}) {
  const n = items.length;
  const mode = effectiveMode(items, stage, asked, mins, { gap, header });
  const grid = gridFor(n, mode);
  let w = ensureWeights(weights, items, mode);
  const colTotal = stage.w - gap * (grid.cols - 1);
  const rowTotal = stage.h - gap * (grid.rows - 1);
  const colMin = Array(grid.cols).fill(0);
  const rowMin = Array(grid.rows).fill(0);
  items.forEach((id, i) => {
    const m = mins[id];
    if (!m) return;
    colMin[i % grid.cols] = Math.max(colMin[i % grid.cols], m.w || 0);
    rowMin[Math.floor(i / grid.cols)] = Math.max(rowMin[Math.floor(i / grid.cols)], (m.h || 0) + header);
  });
  if (colMin.some(Boolean)) w = { ...w, cols: fitAxis(w.cols, colMin, colTotal) };
  if (rowMin.some((m) => m > header)) w = { ...w, rows: fitAxis(w.rows, rowMin, rowTotal) };
  const colPx = share(w.cols, colTotal);
  const rowPx = share(w.rows, rowTotal);
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
  return { grid, cells, dividers, weights: w, colMin, rowMin, mode };
}

// Dragging a divider by deltaPx: the two columns (or rows) beside it trade room; the rest stay. minPx: the least
// room a column or row keeps, one number or a function of the index (an app window has a smallest size of its own,
// and spills out of a tile below it).
export function resizeWeights(weights, axis, index, deltaPx, totalPx, minPx = 0) {
  const list = [...(axis === 'col' ? weights.cols : weights.rows)];
  if (index < 0 || index >= list.length - 1 || !totalPx) return weights;
  const sum = list.reduce((a, b) => a + b, 0);
  const move = (deltaPx / totalPx) * sum;
  const pair = list[index] + list[index + 1];
  const minOf = (i) => (typeof minPx === 'function' ? minPx(i) : minPx) || 0;
  let mnA = Math.max(MIN_FRACTION, minOf(index) / totalPx) * sum;
  let mnB = Math.max(MIN_FRACTION, minOf(index + 1) / totalPx) * sum;
  if (mnA + mnB > pair) { mnA = Math.min(mnA, MIN_FRACTION * sum); mnB = Math.min(mnB, MIN_FRACTION * sum); } // no room for both minimums: only the floor holds
  const a = Math.max(mnA, Math.min(pair - mnB, list[index] + move));
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
// One place earlier or later (the orb can move too).
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
