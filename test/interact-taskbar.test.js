import { test } from 'node:test';
import assert from 'node:assert/strict';
import { edgeOf, sizeKey, fitSize, thicknessOf, nearestEdge, EDGES } from '../src/renderer/interact-taskbar.js';
import { arrange, defaultWeights } from '../src/shared/tiles.js';

test('the taskbar is on the edge chosen, else the rail on the right or the bar along the bottom', () => {
  assert.equal(edgeOf({}), 'right'); // the rail by default
  assert.equal(edgeOf({ layout: 'orbit' }), 'right');
  assert.equal(edgeOf({ layout: 'bar' }), 'bottom');
  for (const e of EDGES) assert.equal(edgeOf({ layout: 'bar', edge: e }), e);
  assert.equal(edgeOf({ edge: 'nowhere' }), 'right', 'an unknown edge is ignored');
});

test('its thickness is the same as the taskbar window: per kind and direction, kept within limits', () => {
  assert.equal(sizeKey({ layout: 'bar' }, 'bottom'), 'bar-across');
  assert.equal(sizeKey({ layout: 'bar' }, 'left'), 'bar-side');
  assert.equal(sizeKey({}, 'right'), 'rail-side');
  assert.equal(sizeKey({ layout: 'orbit' }, 'top'), 'rail-across');
  assert.equal(thicknessOf({ layout: 'bar' }), 48);
  assert.equal(thicknessOf({}), 76);
  assert.equal(thicknessOf({ layout: 'bar', edge: 'left' }), 60);
  assert.equal(thicknessOf({ layout: 'bar', sizes: { 'bar-across': 70 } }), 70, 'a size the person dragged to');
  assert.equal(thicknessOf({ layout: 'bar', sizes: { 'bar-across': 999 } }), 96, 'never thicker than the limit');
  assert.equal(thicknessOf({ layout: 'bar', sizes: { 'bar-across': 2 } }), 32, 'never thinner than the limit');
  assert.equal(thicknessOf({ layout: 'bar', sizes: { 'bar-across': 70 } }, { key: 'bar-across', px: 55 }), 55, 'while it is being dragged');
  assert.equal(fitSize('rail-side', 10), 56);
});

test('dropping the taskbar near an edge of the screen puts it on that edge', () => {
  const screen = { left: 0, top: 0, right: 1440, bottom: 900 };
  assert.equal(nearestEdge(screen, 700, 880), 'bottom');
  assert.equal(nearestEdge(screen, 700, 12), 'top');
  assert.equal(nearestEdge(screen, 20, 450), 'left');
  assert.equal(nearestEdge(screen, 1430, 450), 'right');
  assert.equal(nearestEdge(screen, 720, 450), 'bottom', 'exactly in the middle: the bottom');
});

test('the room the taskbar takes leaves the tiles a smaller stage, and the Scorpion page gets the wider tile', () => {
  const full = { x: 24, y: 108, w: 1392, h: 560 };
  const withBarRight = { ...full, w: full.w - 76 };
  const a = arrange(['scorpion', 'orb'], full);
  const b = arrange(['scorpion', 'orb'], withBarRight);
  assert.ok(b.cells[0].rect.w < a.cells[0].rect.w, 'the stage shrinks with the bar');
  assert.ok(a.cells[0].rect.w > a.cells[1].rect.w * 2, 'the page is wider than the orb');
  assert.ok(defaultWeights(['scorpion', 'orb', 'a1']).cols[0] > 1);
});
