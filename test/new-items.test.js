import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { NEW_KINDS, uniqueName, createItem } from '../src/main/new-items.js';

test('names count up instead of overwriting', () => {
  const taken = new Set(['New folder', 'New folder (2)']);
  assert.equal(uniqueName('/d', 'New folder', '', (p) => taken.has(path.basename(p))), 'New folder (3)');
  assert.equal(uniqueName('/d', 'New Note', '.md', () => false), 'New Note.md');
});

test('a folder and each kind of document are made, empty or with a starting text, and never over something there', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-new-'));
  try {
    const f = createItem(dir, 'folder');
    assert.equal(path.basename(f), 'New folder');
    assert.ok(fs.statSync(f).isDirectory());
    assert.equal(path.basename(createItem(dir, 'folder')), 'New folder (2)');
    const made = NEW_KINDS.filter((k) => !k.dir).map((k) => createItem(dir, k.id));
    assert.deepEqual(made.map((p) => path.extname(p)), ['.txt', '.rtf', '.md', '.csv', '.html']);
    assert.equal(fs.readFileSync(made[0], 'utf8'), '');
    assert.match(fs.readFileSync(made[1], 'utf8'), /^\{\\rtf1/);
    assert.match(fs.readFileSync(made[4], 'utf8'), /<!doctype html>/);
    // Twice: the second one has its own name; the first is untouched.
    fs.writeFileSync(made[0], 'my words');
    const again = createItem(dir, 'text');
    assert.equal(path.basename(again), 'New Text Document (2).txt');
    assert.equal(fs.readFileSync(made[0], 'utf8'), 'my words');
    assert.throws(() => createItem(dir, 'exe'), /Unknown kind/);
    assert.throws(() => createItem(path.join(dir, 'gone'), 'folder'), /isn't there any more/);
    assert.throws(() => createItem('', 'folder'), /isn't there any more/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
