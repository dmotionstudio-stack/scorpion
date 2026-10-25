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
