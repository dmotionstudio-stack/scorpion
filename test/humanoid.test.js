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

test('it bows to say goodbye and sways its head to say hello, then comes back upright', () => {
  const bow = [0.2, 0.8, 1.2, 2.0].map((t) => headGesture('bow', t));
  assert.ok(bow[1].pitch > 0.3 && bow[2].pitch > 0.3, 'it holds the bow');
  assert.ok(bow[0].pitch < bow[1].pitch && bow[3].pitch < bow[1].pitch, 'down, then up');
  assert.equal(headGesture('bow', 3).pitch, 0);
  const wave = [0.2, 0.4, 0.6, 0.9].map((t) => headGesture('wave', t));
  assert.ok(wave.some((g) => Math.abs(g.roll) > 0.08), 'the head tilts side to side');
  assert.equal(headGesture('wave', 3).roll, 0);
});

test('the orb makes a soft sound when it starts listening and when it finishes thinking, and otherwise stays quiet', async () => {
  const { soundFor } = await import('../src/renderer/orb-sounds.js');
  assert.equal(soundFor('standby', 'listening'), 'listen');
  assert.equal(soundFor('thinking', 'speaking'), 'done');
  assert.equal(soundFor('thinking', 'standby'), 'done');
  assert.equal(soundFor('speaking', 'standby'), null);
  assert.equal(soundFor('listening', 'thinking'), null);
  assert.equal(soundFor('standby', 'standby'), null);
});

test('the glass skin is a closed grid of triangles on the body', async () => {
  const { buildGlass } = await import('../src/renderer/humanoid.js');
  const g = buildGlass(0.6);
  assert.equal(g.position.length / 3, g.glow.length);
  assert.ok(g.index.length > 3000 && g.index.length % 3 === 0);
  assert.ok(Math.max(...g.index) < g.glow.length, 'every triangle uses real points');
});

test('"transform into the humanoid" and "show me the orb" switch the form, and questions about humanoids do not', async () => {
  const { parseLook } = await import('../src/renderer/orb-commands.js');
  for (const s of ['transform into the humanoid', 'Transform into a humanoid.', 'show me your humanoid', 'Scorpion, turn into the humanoid', 'become the humanoid']) {
    assert.equal(parseLook(s)?.look, 'humanoid', s);
  }
  for (const s of ['transform into the orb', 'Show me the orb', 'show me your orb', 'turn back into the orb', 'go back to the orb', 'switch to the sphere']) {
    assert.equal(parseLook(s)?.look, 'classic', s);
  }
  for (const s of ['what is a humanoid', 'tell me about the orb', 'open the orbit app', 'humanoid robots are cool', 'show me the weather']) {
    assert.equal(parseLook(s), null, s);
  }
  assert.equal(parseLook('transform into the humanoid', { lang: 'fr' }), null, 'English only, like the other commands');
});

test('Scorpion turns its own switches on and off by what it is told', async () => {
  const { parseSwitch } = await import('../src/renderer/orb-commands.js');
  const cases = {
    'turn off hand gestures': ['gestures', false], 'Scorpion, enable hand gestures': ['gestures', true], 'start hand tracking': ['gestures', true],
    'turn on face tracking': ['face', true], 'switch face tracking on': ['face', true], 'stop face tracking': ['face', false],
    'turn off talk mode': ['talk', false], 'please turn on the microphone': ['talk', true],
    'turn off text': ['text', false], 'turn on the typing box': ['text', true],
    'turn the wake word off': ['wake', false], 'set the wake word on': ['wake', true],
    'turn off spoken replies': ['voice', false], 'enable read aloud': ['voice', true],
    'turn on soft sounds': ['sounds', true], 'disable the background lines': ['lines', false],
  };
  for (const [say, [key, on]] of Object.entries(cases)) assert.deepEqual(parseSwitch(say), { key, on }, say);
  for (const say of ['stop talking', 'what is face tracking', 'turn off the lights', 'turn on dark mode', 'tell me about hand gestures', 'open the wake word app please now']) {
    assert.equal(parseSwitch(say), null, say);
  }
  assert.equal(parseSwitch('turn off hand gestures', { lang: 'de' }), null, 'English only');
});
