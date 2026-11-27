import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeMacYml, parseMacYml } from '../scripts/merge-mac-yml.mjs';

const arm = `version: 0.1.64
files:
  - url: Scorpion-0.1.64-arm64-mac.zip
    sha512: AAA
    size: 100
  - url: Scorpion-0.1.64-arm64.dmg
    sha512: BBB
    size: 110
path: Scorpion-0.1.64-arm64-mac.zip
sha512: AAA
releaseDate: '2026-01-01T00:00:00.000Z'
`;
const x64 = `version: 0.1.64
files:
  - url: Scorpion-0.1.64-mac.zip
    sha512: CCC
    size: 200
  - url: Scorpion-0.1.64.dmg
    sha512: DDD
    size: 210
path: Scorpion-0.1.64-mac.zip
sha512: CCC
releaseDate: '2026-01-01T00:05:00.000Z'
`;

test('the two Mac update files become one that lists both architectures', () => {
  const merged = mergeMacYml([arm, x64]);
  const p = parseMacYml(merged);
  assert.equal(p.version, '0.1.64');
  assert.deepEqual(p.files.map((f) => f[0]), [
    'url: Scorpion-0.1.64-arm64-mac.zip', 'url: Scorpion-0.1.64-arm64.dmg', 'url: Scorpion-0.1.64-mac.zip', 'url: Scorpion-0.1.64.dmg',
  ]);
  assert.deepEqual(p.files[2], ['url: Scorpion-0.1.64-mac.zip', 'sha512: CCC', 'size: 200']);
  assert.match(merged, /^path: Scorpion-0.1.64-mac\.zip$/m);
  assert.equal(mergeMacYml([arm]).includes('arm64-mac.zip'), true);
});

test('files for different versions are not merged', () => {
  assert.throws(() => mergeMacYml([arm, x64.replace('0.1.64', '0.1.63')]), /different versions/);
});
