import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeBubbles, bubbleItems, ringLook, siteUrl, DEFAULT_BUBBLES, PLACE_IDS } from '../src/renderer/orb-bubbles.js';

const PLACES = PLACE_IDS.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1), say: [] }));
const WINDOWS = Array.from({ length: 12 }, (_, i) => ({ hwnd: String(i), title: `Window ${i}`, process: 'app' }));

test('by default: every place, then the open windows (at most eight)', () => {
  const items = bubbleItems(undefined, PLACES, WINDOWS);
  assert.deepEqual(items.filter((i) => i.kind === 'tool').map((i) => i.id), PLACE_IDS);
  assert.equal(items.filter((i) => i.kind === 'window').length, 8);
});

test('places on or off, in your order; your own bubbles after them; windows can be left out', () => {
  const saved = {
    places: [{ id: 'settings', on: true }, { id: 'apps', on: false }, { id: 'chats', on: true }],
    custom: [
      { id: 'x', kind: 'site', label: 'News', target: 'example.com', color: '#FF8800' },
      { id: 'y', kind: 'folder', label: 'Work', target: 'C:\\Work' },
      { id: 'z', kind: 'nope', label: 'Bad', target: 'x' }, // unknown kind: dropped
    ],
    windows: false,
  };
  const items = bubbleItems(saved, PLACES, WINDOWS);
  assert.deepEqual(items.map((i) => i.id), ['settings', 'chats', 'files', 'library', 'people', 'c:x', 'c:y']);
  assert.deepEqual(items.find((i) => i.id === 'c:x'), { id: 'c:x', kind: 'tool', label: 'News', say: ['News'], color: '#ff8800', custom: { id: 'x', kind: 'site', label: 'News', target: 'example.com', color: '#ff8800' } });
});

test('a place this system lacks is skipped; a place from a newer Scorpion appears on', () => {
  const linux = PLACES.filter((p) => p.id !== 'apps' && p.id !== 'files');
  assert.ok(!bubbleItems(undefined, linux).some((i) => i.id === 'apps'));
  const older = normalizeBubbles({ places: [{ id: 'chats', on: false }] });
  assert.equal(older.places.length, PLACE_IDS.length);
  assert.deepEqual(older.places[0], { id: 'chats', on: false });
});

test('size and speed, within what Settings offers', () => {
  assert.deepEqual(ringLook(undefined), { size: 1, speed: 1 });
  assert.deepEqual(ringLook({ size: 'large', speed: 'still' }), { size: 1.35, speed: 0 });
  assert.deepEqual(ringLook({ size: 'huge', speed: 'warp' }), { size: 1, speed: 1 });
  assert.equal(normalizeBubbles({ maxWindows: 99 }).maxWindows, 20);
  assert.deepEqual(normalizeBubbles(null), { ...DEFAULT_BUBBLES, places: DEFAULT_BUBBLES.places });
});

test('website addresses', () => {
  assert.equal(siteUrl('example.com'), 'https://example.com/');
  assert.equal(siteUrl('http://news.example.org/today'), 'http://news.example.org/today');
  assert.equal(siteUrl('not a site'), null);
  assert.equal(siteUrl('javascript:alert(1)'), null);
  assert.equal(siteUrl('localhost'), null);
});
