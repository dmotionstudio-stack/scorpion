import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MAX_APPS, GAP, HEADER, gridFor, defaultWeights, ensureWeights, arrange, resizeWeights, sideOfRect, insertApp, removeApp, moveItem, swapItems, cellAt } from '../src/shared/tiles.js';

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
