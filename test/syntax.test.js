// Every source file must at least parse, including the Electron-only ones
// (main.js, preload, renderer) that the other unit tests can't import.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const files = ['src/main', 'src/shared', 'src/renderer', 'scripts']
  .flatMap((dir) => fs.readdirSync(path.join(root, dir)).filter((f) => /\.(m?js|cjs)$/.test(f)).map((f) => path.join(dir, f)))
  .concat('src/preload.cjs');

for (const file of files) {
  test(`parses: ${file}`, () => {
    const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
  });
}
