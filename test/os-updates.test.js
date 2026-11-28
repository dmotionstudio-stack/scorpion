import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'js-yaml';

// Scorpion OS gets new versions of Scorpion from its apt repository on GitHub Pages. Every release has to reach it, and each package has to be
// newer than the one before, whichever workflow built it.
const root = path.resolve(import.meta.dirname, '..');
const load = (n) => yaml.load(fs.readFileSync(path.join(root, '.github/workflows', n), 'utf8'));

test('a release publishes the update repository by itself, from main (which the github-pages environment allows), without building the ISO', () => {
  const w = load('linux-update.yml');
  assert.deepEqual(w.on.push.branches, ['main']);
  assert.ok(w.on.push.paths.includes('package.json')); // every release bumps the version there
  assert.ok(!w.on.push.tags, 'a tag is refused unless the environment has a tag rule');
  assert.deepEqual(Object.keys(w.jobs), ['linux-app', 'apt-repo']);
  const repo = w.jobs['apt-repo'];
  assert.equal(repo.needs, 'linux-app');
  assert.equal(repo.environment.name, 'github-pages');
  assert.equal(repo.permissions.pages, 'write');
  assert.ok(repo.steps.some((s) => String(s.uses).startsWith('actions/deploy-pages')));
  assert.ok(repo.steps.some((s) => /make-repo\.sh/.test(s.run || '')));
  assert.ok(repo.steps.some((s) => s.env?.APT_SIGNING_KEY));
});

test('every package is stamped with its build time, so the newest always wins (two workflows build them)', () => {
  for (const n of ['linux-update.yml', 'scorpion-os.yml']) {
    const stamp = load(n).jobs['linux-app'].steps.find((s) => /Stamp/.test(s.name || ''));
    assert.match(stamp.run, /date -u \+%Y%m%d%H%M%S/, n);
    assert.ok(!/run_number/.test(stamp.run), `${n}: a run number would restart at 1 in each workflow`);
  }
  // Debian compares the numbers in a version: a later time is always the larger number.
  const v = (t) => Number(t);
  assert.ok(v('20261128120000') > v('20261127101500'));
  assert.ok(v('20261128120000') > 3); // and any old run-number version
});
