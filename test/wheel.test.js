import { test } from 'node:test';
import assert from 'node:assert/strict';
import { INTENTS, angleOf, segmentAt, flick, centreOf, ago, kindOf, titleOf, ringSlots, sectorPath } from '../src/renderer/wheel-core.js';

test('the wheel picks the intent in the direction of a flick or click', () => {
  assert.equal(INTENTS.length, 6);
  assert.equal(Math.round(angleOf(0, -10)), 0);
  assert.equal(Math.round(angleOf(10, 0)), 90);
  assert.equal(Math.round(angleOf(0, 10)), 180);
  assert.equal(Math.round(angleOf(-10, 0)), 270);
  assert.equal(segmentAt(5, -10), 'browse'); // up and a little right
  assert.equal(segmentAt(10, 0), 'talk'); // right
  assert.equal(segmentAt(5, 10), 'create'); // down-right
  assert.equal(segmentAt(-5, 10), 'files'); // down-left
  assert.equal(segmentAt(-10, 0), 'focus'); // left
  assert.equal(segmentAt(-5, -10), 'write'); // up-left
  assert.equal(segmentAt(3, 3, 20), null); // inside the centre button
  assert.equal(flick(10, 10), null); // too short to be a flick
  assert.equal(flick(80, -20), 'talk');
  assert.equal(centreOf('browse'), 30);
  assert.equal(centreOf('write'), 330);
});

test('recent windows say what they are and when they were used', () => {
  const now = 1_000_000_000;
  assert.equal(ago(now - 10_000, now), 'just now');
  assert.equal(ago(now - 120_000, now), '2m ago');
  assert.equal(ago(now - 3_600_000, now), '1h ago');
  assert.equal(ago(now - 3 * 86_400_000, now), '3d ago');
  assert.equal(kindOf({ exe: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe' }), 'Browser');
  assert.equal(kindOf({ exe: 'C:\\Users\\x\\AppData\\Roaming\\Spotify\\Spotify.exe' }), 'Music');
  assert.equal(kindOf({ exe: 'C:\\x\\ms-teams.exe' }), 'Chat');
  assert.equal(kindOf({ exe: 'C:\\x\\WINWORD.EXE' }), 'Document');
  assert.equal(kindOf({ exe: 'C:\\x\\unknownapp.exe' }), 'Unknownapp');
  assert.equal(kindOf({}), 'App');
  assert.equal(titleOf({ title: 'Project Notes - Google Docs - Google Chrome' }), 'Project Notes');
  assert.equal(titleOf({ title: 'Calculator' }), 'Calculator');
});

test('the outer ring spreads cards along the right-hand arc', () => {
  assert.deepEqual(ringSlots(0), []);
  const four = ringSlots(4);
  assert.equal(four.length, 4);
  assert.ok(four[0].angle < 0 && four[3].angle > 120, 'from just left of the top round to the lower right');
  assert.ok(four.every((s, i) => i === 0 || s.angle > four[i - 1].angle));
  assert.ok(ringSlots(6).every((s) => s.angle >= -60 && s.angle <= 190));
  assert.match(sectorPath(0, 60, 70, 230, 6), /^M .* A 230 230 0 0 1 .* L .* A 70 70 0 0 0 .* Z$/);
});

test("Stage's strip shows the other recent windows, newest first, at most five", async () => {
  const { stageWindows, STAGE_MAX } = await import('../src/renderer/stage-core.js');
  const list = [
    { hwnd: '1', active: true }, { hwnd: '2' }, { hwnd: '3', self: true }, { hwnd: '4' }, { hwnd: '5' }, { hwnd: '6' }, { hwnd: '7' }, { hwnd: '8' }, {},
  ];
  assert.deepEqual(stageWindows(list).map((w) => w.hwnd), ['2', '4', '5', '6', '7']);
  assert.equal(STAGE_MAX, 5);
  assert.deepEqual(stageWindows(), []);
});

test('the recent windows sit as rounded tiles along the outer ring', async () => {
  const { tileSlots, tilePath, glowOf } = await import('../src/renderer/wheel-core.js');
  assert.deepEqual(tileSlots(0), []);
  assert.deepEqual(tileSlots(4).map((s) => s.angle), [11, 45, 79, 113]);
  assert.deepEqual(tileSlots(1)[0], { angle: 62, span: 32, tilt: -7 });
  assert.equal(tileSlots(6).length, 6);
  const d = tilePath(0, 60, 86, 232, 10, 16);
  assert.match(d, /^M [-\d.]+ [-\d.]+ A 232 232 0 0 1 /);
  assert.equal((d.match(/ Q /g) || []).length, 4); // four rounded corners
  assert.ok(!/NaN/.test(d));
  assert.equal(glowOf('Music'), '#2fd47a');
  assert.equal(glowOf('Spreadsheet'), null);
});
