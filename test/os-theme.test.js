import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { themeColors, osThemeFiles } from '../scripts/make-os-theme.mjs';

test('Scorpion OS\'s frames, lock screen and sign-in screen match the theme', () => {
  const css = fs.readFileSync(new URL('../src/renderer/themes.css', import.meta.url), 'utf8');
  const colors = themeColors(css, 'classic');
  assert.match(colors.accent, /^#[0-9a-f]{6}$/i);
  for (const [rel, text] of Object.entries(osThemeFiles(colors, 'classic'))) {
    const now = fs.readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
    assert.equal(now, text, `${rel} is out of date: run node scripts/make-os-theme.mjs`);
  }
  // Every theme can make them (all its colours are plain #rrggbb).
  for (const name of [...css.matchAll(/data-theme="(\w+)"/g)].map((m) => m[1])) assert.ok(osThemeFiles(themeColors(css, name), name));
});
