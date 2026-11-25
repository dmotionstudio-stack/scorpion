import { test } from 'node:test';
import assert from 'node:assert/strict';
import { headGesture, humanoidPalette, hexToHsl, profileHalfWidth, profileDepth, skinWeight, surface, buildBody, buildConstellation } from '../src/renderer/humanoid.js';

test('one continuous body: the head runs into a narrower neck, which flares into the shoulders', () => {
  assert.equal(profileHalfWidth(1.97), 0, 'nothing above the crown');
  const head = Math.max(...Array.from({ length: 40 }, (_, i) => profileHalfWidth(1 + i * 0.024)));
  assert.ok(head > 0.4 && head < 0.6, 'the head is about a metre wide in figure units');
  assert.ok(profileHalfWidth(0.34) < head * 0.65, 'the neck is narrower than the head');
  assert.ok(profileHalfWidth(-0.4) > profileHalfWidth(0.1) && profileHalfWidth(0.1) > profileHalfWidth(0.34), 'the shoulders flare');
  // no jumps: the outline moves smoothly from the bottom to the crown
  let prev = profileHalfWidth(-1.4);
  for (let y = -1.39; y <= 1.97; y += 0.01) { const w = profileHalfWidth(y); assert.ok(Math.abs(w - prev) < 0.06, `smooth at ${y.toFixed(2)}`); prev = w; }
  assert.ok(profileDepth(0.5) > 0.1 && profileDepth(1.97) === 0);
});

test('the head bends on the neck: the skin follows the head fully, the shoulders not at all', () => {
  assert.equal(skinWeight(-0.5), 0);
  assert.equal(skinWeight(1.2), 1);
  assert.ok(skinWeight(0.5) > 0 && skinWeight(0.5) < 1);
});

test('surface points lie on the profile with unit normals', () => {
  for (const y of [-0.5, 0.5, 1.2]) for (const phi of [0, 1, 2, 3]) {
    const p = surface(y, phi);
    assert.ok(Math.abs(Math.hypot(p.nx, p.ny, p.nz) - 1) < 1e-6);
    assert.ok(Math.abs(p.x) <= profileHalfWidth(y) + 1e-9 && Math.abs(p.z) <= profileDepth(y) + 1e-9);
  }
});

test('what the figure and its stars are made of is the same every time', () => {
  const a = buildBody(0.5), b = buildBody(0.5);
  assert.deepEqual(Array.from(a.lines.position.slice(0, 30)), Array.from(b.lines.position.slice(0, 30)));
  assert.ok(a.lines.count > 5000 && a.dots.count > 500);
  assert.equal(a.lines.count % 2, 0, 'lines come in pairs of vertices');
  const c = buildConstellation(0.3), d = buildConstellation(0.3);
  assert.deepEqual(c.links.slice(0, 5), d.links.slice(0, 5));
  assert.ok(c.stars.length > 300 && c.links.length > 100);
  assert.ok(c.links.every(([i, j]) => i !== j && i < c.stars.length && j < c.stars.length));
  assert.ok(c.stars.every((s) => s.z < -2), 'the stars are all behind the figure');
});

test('it nods yes and shakes its head no, then stops', () => {
  const nod = [0.1, 0.2, 0.3].map((t) => headGesture('nod', t));
  assert.ok(nod.some((g) => Math.abs(g.pitch) > 0.05) && nod.every((g) => g.yaw === 0));
  const shake = [0.1, 0.2, 0.3].map((t) => headGesture('shake', t));
  assert.ok(shake.some((g) => Math.abs(g.yaw) > 0.05) && shake.every((g) => g.pitch === 0));
  assert.deepEqual(headGesture('nod', 2), { pitch: 0, yaw: 0 });
});

test('its colours come from the theme: the lines in the theme colour, the light inside in the opposite one', () => {
  const blue = humanoidPalette('#2a7fff');
  assert.ok(Math.abs(blue.line.h - 0.6) < 0.05, 'blue lines');
  assert.ok(Math.abs(blue.warm.h - 0.1) < 0.05, 'orange light');
  assert.ok(Math.abs(hexToHsl('#ff0000').h) < 0.01 && Math.abs(hexToHsl('#00ff00').h - 1 / 3) < 0.01);
  assert.ok(humanoidPalette('not a colour').line.s > 0, 'a bad colour falls back to the default');
});
