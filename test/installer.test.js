import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';

// Scorpion OS's installer (Calamares) settings, in the shapes its modules
// read. A wrong shape only fails on some computers (fstab's ssd entry is read
// only when the system disk is an SSD), so the VM never shows it.
const require = createRequire(import.meta.url);
const yaml = require('js-yaml');
const conf = (name) => yaml.load(fs.readFileSync(new URL(`../os/rootfs/etc/calamares/modules/${name}.conf`, import.meta.url), 'utf8'));

test("fstab's /tmp choices are tables of tmpfs and options", () => {
  const { tmpOptions } = conf('fstab');
  assert.ok(tmpOptions.default, 'default is required');
  for (const [kind, entry] of Object.entries(tmpOptions)) {
    assert.ok(['default', 'ssd'].includes(kind), kind);
    assert.equal(typeof entry, 'object', `${kind} must be a table, not ${JSON.stringify(entry)}`);
    assert.equal(typeof entry.tmpfs, 'boolean', `${kind}.tmpfs`);
    assert.equal(typeof (entry.options ?? ''), 'string', `${kind}.options`);
  }
});

test("mount's options name a file system and list options", () => {
  const { mountOptions } = conf('mount');
  assert.ok(mountOptions.some((m) => m.filesystem === 'default'));
  for (const m of mountOptions) assert.ok(typeof m.filesystem === 'string' && Array.isArray(m.options), JSON.stringify(m));
});
