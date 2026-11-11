import { test } from 'node:test';
import assert from 'node:assert/strict';
import { layoutPanels, widthFromDrag, heightFromDrag, MIN_CHAT, MIN_CHAT_H } from '../src/renderer/panel-resize.js';

const wide = { w: 1400, h: 700 };

test('with no panel open, nothing is laid out', () => {
  assert.deepEqual(layoutPanels(wide, { dock: false, plan: false }), { stacked: false, dock: 0, plan: 0 });
});

test('the conversation always keeps its room beside the panels', () => {
  for (const w of [700, 800, 900, 1100, 1400, 2200]) {
    for (const open of [{ dock: true, plan: false }, { dock: false, plan: true }, { dock: true, plan: true }]) {
      const L = layoutPanels({ w, h: 700 }, open);
      if (L.stacked) { assert.ok(L.dock + L.plan <= 700 - MIN_CHAT_H + 1, `stacked under the chat at ${w}`); continue; }
      assert.ok(w - L.dock - L.plan >= MIN_CHAT - 1, `the chat keeps ${MIN_CHAT}px at ${w} (${JSON.stringify(L)})`);
    }
  }
});

test('both panels open at the usual window size: the Preview gives way, the chat stays readable', () => {
  const L = layoutPanels({ w: 1100, h: 700 }, { dock: true, plan: true });
  assert.equal(L.stacked, false);
  assert.ok(1100 - L.dock - L.plan >= MIN_CHAT - 1);
  assert.ok(L.dock >= 260 && L.plan >= 200);
});

test('a panel dragged to a size keeps it, within what the chat can spare', () => {
  assert.equal(layoutPanels(wide, { dock: true, plan: false }, { dockW: 500 }).dock, 500);
  assert.equal(layoutPanels(wide, { dock: true, plan: false }, { dockW: 5000 }).dock, wide.w - MIN_CHAT, 'never so wide that the chat is squeezed out');
  assert.equal(layoutPanels(wide, { dock: true, plan: false }, { dockW: 50 }).dock, 260, 'never so narrow that it is useless');
  assert.equal(layoutPanels(wide, { dock: false, plan: true }, { planW: 320 }).plan, 320);
});

test('too narrow for panels beside the chat: they go under it, and the conversation keeps its height', () => {
  const L = layoutPanels({ w: 700, h: 800 }, { dock: true, plan: true });
  assert.equal(L.stacked, true);
  assert.ok(L.dock + L.plan <= 800 - MIN_CHAT_H);
  assert.ok(L.dock >= 120 && L.plan >= 90);
  const tall = layoutPanels({ w: 600, h: 800 }, { dock: true, plan: false }, { dockH: 300 });
  assert.equal(tall.dock, 300);
  const low = layoutPanels({ w: 600, h: 500 }, { dock: true, plan: false }, { dockH: 450 });
  assert.equal(low.dock, 500 - MIN_CHAT_H, 'the conversation keeps its height');
});

test('dragging a panel edge: left or up makes it bigger', () => {
  assert.equal(widthFromDrag(400, 900, 800), 500);
  assert.equal(widthFromDrag(400, 900, 1000), 300);
  assert.equal(heightFromDrag(300, 600, 500), 400);
});
