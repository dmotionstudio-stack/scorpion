import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const wf = fs.readFileSync(path.join(root, '.github', 'workflows', 'release.yml'), 'utf8');

test('the release signs the Windows installer when an account is set up, checks it, and still builds unsigned without one', () => {
  // the names the instructions (docs/signing-windows.md) tell the owner to create
  for (const name of ['AZURE_TENANT_ID', 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_SIGNING_ENDPOINT', 'AZURE_SIGNING_ACCOUNT', 'AZURE_SIGNING_PROFILE', 'SIGNING_PUBLISHER_NAME', 'WIN_CSC_LINK', 'WIN_CSC_KEY_PASSWORD']) {
    assert.ok(wf.includes(name), `${name} is read by the workflow`);
    assert.ok(fs.readFileSync(path.join(root, 'docs', 'signing-windows.md'), 'utf8').includes(name), `${name} is explained`);
  }
  assert.match(wf, /azureSignOptions\.endpoint/);
  assert.match(wf, /Get-AuthenticodeSignature/);
  assert.match(wf, /-ne 'Valid'/, 'a bad signature stops the release');
  assert.match(wf, /WINDOWS_SIGNING == 'true'/, 'the check only runs when signing is set up');
  assert.match(wf, /NOT signed/, 'unsigned builds say so in the run');
  // the build step still runs with no signing account at all
  assert.match(wf, /npx electron-builder \$\{\{ matrix\.target \}\} --publish never \$extra/);
});
