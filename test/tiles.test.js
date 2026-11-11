import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_APPS, GAP, HEADER, gridFor, defaultWeights, ensureWeights, arrange, resizeWeights, sideOfRect, insertApp, removeApp, moveItem, swapItems, cellAt, fitAxis, effectiveMode, modeOf, MODES } from '../src/shared/tiles.js';

const stage = { x: 24, y: 108, w: 1872, h: 700 };
const overlaps = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

test('one row up to three tiles, two rows after that', () => {
  assert.deepEqual(gridFor(1), { rows: 1, cols: 1 });
  assert.deepEqual(gridFor(3), { rows: 1, cols: 3 });
  assert.deepEqual(gridFor(4), { rows: 2, cols: 2 });
  assert.deepEqual(gridFor(5), { rows: 2, cols: 3 });
  assert.deepEqual(gridFor(MAX_APPS + 1), { rows: 2, cols: 4 });
});

test('the orb alone has the whole stage; with one app they share it and the orb column is the narrower', () => {
  const alone = arrange(['orb'], stage);
  assert.deepEqual(alone.cells[0].rect, { x: 24, y: 108, w: 1872, h: 700 });
  const two = arrange(['app1', 'orb'], stage);
  const [app, orb] = two.cells;
  assert.ok(app.rect.w > orb.rect.w, 'the app has more room than the orb');
  assert.equal(app.rect.w + GAP + orb.rect.w, stage.w);
  assert.equal(two.dividers.length, 1);
  assert.equal(two.dividers[0].axis, 'col');
});

test('tiles never overlap and stay inside the stage, whatever the count', () => {
  for (let n = 1; n <= MAX_APPS + 1; n++) {
    const items = ['orb', ...Array.from({ length: n - 1 }, (_, i) => `a${i}`)];
    const { cells } = arrange(items, stage);
    assert.equal(cells.length, n);
    for (const c of cells) {
      assert.ok(c.rect.x >= stage.x && c.rect.y >= stage.y && c.rect.x + c.rect.w <= stage.x + stage.w + 1 && c.rect.y + c.rect.h <= stage.y + stage.h + 1, `inside ${n}/${c.id}`);
      assert.equal(c.body.y, c.rect.y + HEADER);
      assert.equal(c.body.h, c.rect.h - HEADER);
    }
    for (let i = 0; i < cells.length; i++) for (let j = i + 1; j < cells.length; j++) assert.ok(!overlaps(cells[i].rect, cells[j].rect), `no overlap ${n}: ${cells[i].id} ${cells[j].id}`);
  }
});

test('a short last row: its last tile takes the room of the empty cells', () => {
  const { cells, grid } = arrange(['a', 'b', 'c', 'd', 'orb'], stage); // 3 columns, 5 tiles
  assert.equal(grid.cols, 3);
  const d = cells[3];
  const orb = cells[4];
  assert.equal(orb.rect.x + orb.rect.w, stage.x + stage.w, 'it reaches the right edge');
  assert.ok(orb.rect.w > d.rect.w);
});

test('an app that opened on the left goes left, one on the right goes right: the orb moves between them', () => {
  let items = ['orb'];
  items = insertApp(items, 'A', sideOfRect({ left: 100, right: 700 }, 1920));
  assert.deepEqual(items, ['A', 'orb']);
  items = insertApp(items, 'B', sideOfRect({ left: 1300, right: 1900 }, 1920));
  assert.deepEqual(items, ['A', 'orb', 'B'], 'the orb is now in the middle');
  items = insertApp(items, 'C', 'left');
  assert.deepEqual(items, ['C', 'A', 'orb', 'B']);
  assert.deepEqual(insertApp(items, 'C', 'right'), items, 'an app already there is not added twice');
  assert.deepEqual(removeApp(items, 'A'), ['C', 'orb', 'B']);
  assert.deepEqual(removeApp(items, 'orb'), items, 'the orb is never removed');
});

test('tiles move one place, and swap; the orb can move too', () => {
  assert.deepEqual(moveItem(['A', 'orb', 'B'], 'orb', 1), ['A', 'B', 'orb']);
  assert.deepEqual(moveItem(['A', 'orb', 'B'], 'A', -1), ['A', 'orb', 'B'], 'not past the start');
  assert.deepEqual(moveItem(['A', 'orb', 'B'], 'B', 1), ['A', 'orb', 'B'], 'not past the end');
  assert.deepEqual(swapItems(['A', 'orb', 'B'], 'A', 'B'), ['B', 'orb', 'A']);
  assert.deepEqual(swapItems(['A', 'orb'], 'A', 'A'), ['A', 'orb']);
});

test('dragging a divider trades room between its two neighbours and keeps a minimum', () => {
  const items = ['A', 'orb', 'B'];
  const w0 = ensureWeights(null, items);
  const before = arrange(items, stage, w0);
  const w1 = resizeWeights(w0, 'col', 0, 200, stage.w);
  const after = arrange(items, stage, w1);
  assert.ok(after.cells[0].rect.w > before.cells[0].rect.w + 150, 'A grew');
  assert.ok(after.cells[1].rect.w < before.cells[1].rect.w - 150, 'the orb shrank');
  assert.ok(Math.abs(after.cells[2].rect.w - before.cells[2].rect.w) <= 1, 'B did not change');
  const squeezed = arrange(items, stage, resizeWeights(w0, 'col', 0, 99999, stage.w));
  assert.ok(squeezed.cells[1].rect.w >= stage.w * 0.1, 'never squeezed to nothing');
  assert.equal(resizeWeights(w0, 'col', 7, 50, stage.w), w0, 'a divider that is not there changes nothing');
  // an app window has a smallest size: a tile is never dragged below it
  const total = stage.w - GAP * 2;
  const small = arrange(items, stage, resizeWeights(w0, 'col', 0, -99999, total, 300));
  assert.ok(small.cells[0].rect.w >= 299, `A keeps its 300 px (${small.cells[0].rect.w})`);
  const big = arrange(items, stage, resizeWeights(w0, 'col', 0, 99999, total, 300));
  assert.ok(big.cells[1].rect.w >= 299, 'and so does the orb');
});

test('the sizes are kept while the tiles stay the same in number, and start again when they change', () => {
  const items = ['A', 'orb'];
  const set = resizeWeights(defaultWeights(items), 'col', 0, 100, stage.w);
  assert.equal(ensureWeights(set, ['B', 'orb']), set);
  assert.notEqual(ensureWeights(set, ['A', 'B', 'orb']), set);
  assert.equal(ensureWeights(set, ['A', 'B', 'orb']).cols.length, 3);
});

test('the tile under a point is found (for dropping a title bar on another tile)', () => {
  const { cells } = arrange(['A', 'orb', 'B'], stage);
  assert.equal(cellAt(cells, cells[2].rect.x + 5, cells[2].rect.y + 5).id, 'B');
  assert.equal(cellAt(cells, 0, 0), null);
});

test('the tiles can be laid out side by side, one above the other (resized from the top and bottom) or in a grid', () => {
  assert.deepEqual(MODES, ['auto', 'columns', 'rows', 'grid']);
  assert.equal(modeOf('nonsense'), 'auto');
  assert.deepEqual(gridFor(4, 'columns'), { rows: 1, cols: 4 });
  assert.deepEqual(gridFor(4, 'rows'), { rows: 4, cols: 1 });
  assert.deepEqual(gridFor(3, 'grid'), { rows: 2, cols: 2 });
  assert.deepEqual(gridFor(1, 'grid'), { rows: 1, cols: 1 });
  const items = ['A', 'orb', 'B'];
  const stacked = arrange(items, stage, null, { mode: 'rows' });
  assert.equal(stacked.cells.length, 3);
  assert.ok(stacked.cells.every((c) => c.rect.w === stage.w), 'each tile has the full width');
  assert.equal(stacked.dividers.length, 2);
  assert.ok(stacked.dividers.every((d) => d.axis === 'row'), 'the dividers are between rows: dragged up and down');
  for (let i = 0; i < 3; i++) for (let j = i + 1; j < 3; j++) assert.ok(!overlaps(stacked.cells[i].rect, stacked.cells[j].rect));
  const taller = arrange(items, stage, resizeWeights(stacked.weights, 'row', 0, 60, stage.h - GAP * 2), { mode: 'rows' });
  assert.ok(taller.cells[0].rect.h > stacked.cells[0].rect.h + 50, 'the first tile grew taller');
  assert.ok(taller.cells[1].rect.h < stacked.cells[1].rect.h - 50, 'its neighbour gave the room');
  assert.notEqual(arrange(items, stage, stacked.weights, { mode: 'columns' }).weights.mode, 'rows', 'a new layout starts from its own sizes');
});

test('an app window has a smallest size: its tile is never smaller, the others give room', () => {
  const items = ['A', 'orb', 'B'];
  const base = arrange(items, stage, null);
  const wide = arrange(items, stage, null, { mins: { A: { w: 900, h: 300 } } });
  assert.ok(wide.cells[0].rect.w >= 899, `A keeps its width (${wide.cells[0].rect.w})`);
  assert.ok(wide.cells[0].rect.w > base.cells[0].rect.w);
  assert.equal(wide.cells.reduce((a, c) => a + c.rect.w, 0) + GAP * 2, stage.w, 'and the stage is still filled');
  const tall = arrange(['A', 'orb'], stage, null, { mode: 'rows', mins: { A: { w: 100, h: 500 } } });
  assert.ok(tall.cells[0].body.h >= 499, 'A keeps its height when stacked');
  // not everything fits: the sizes stay as chosen, nothing is forced
  const impossible = arrange(['A', 'B', 'orb'], stage, null, { mins: { A: { w: 1500, h: 100 }, B: { w: 1500, h: 100 } } });
  assert.equal(impossible.cells.length, 3);
  assert.deepEqual(fitAxis([1, 1], [900, 900], 1000), [500, 500], 'cannot fit: left as they are');
  assert.deepEqual(fitAxis([1, 1, 1], [0, 0, 0], 900), [300, 300, 300]);
  assert.ok(Math.abs(fitAxis([1, 1], [700, 100], 1000)[0] - 700) < 1, 'the one that needs room takes it');
});

test('automatic: two rows once there are four tiles, unless the apps are too tall for it and one row holds them', () => {
  const items = ['A', 'B', 'C', 'orb'];
  assert.equal(effectiveMode(items, stage, 'auto', {}), 'auto');
  assert.equal(effectiveMode(items, stage, 'auto', { A: { w: 300, h: 520 } }), 'columns', 'a window that is 520 tall leaves too little for a second row');
  assert.equal(effectiveMode(items, stage, 'auto', { A: { w: 300, h: 520 }, B: { w: 1800, h: 100 } }), 'auto', 'neither fits: the usual');
  assert.equal(effectiveMode(items, stage, 'grid', { A: { w: 300, h: 520 } }), 'grid', 'a layout the person chose stays');
  assert.equal(effectiveMode(['A', 'orb'], stage, 'auto', { A: { w: 300, h: 9000 } }), 'auto', 'under four tiles it is one row anyway');
  assert.equal(arrange(items, stage, null, { mins: { A: { w: 300, h: 520 } } }).grid.rows, 1);
});

test('dragging a divider when the minimums cannot both be kept still moves it', () => {
  const w = defaultWeights(['A', 'B']);
  const moved = resizeWeights(w, 'col', 0, 200, 1000, () => 900);
  assert.ok(moved.cols[0] > w.cols[0], 'it moved even though both wanted 900 of 1000');
});
