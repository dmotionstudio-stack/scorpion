import { test } from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import * as store from '../src/main/store.js';
import * as agents from '../src/main/agents.js';
import { isProtectedPath, fileSystemRoots } from '../src/main/tools.js';
import { buildFunctions, buildSystemPrompt } from '../src/main/agent.js';
import { isPrivateAddress, htmlToText } from '../src/main/web.js';

store.initStore(fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-access-')));

test('system folders are protected; personal folders are not', () => {
  if (process.platform === 'win32') {
    assert.ok(isProtectedPath('C:\\Windows\\System32\\drivers\\etc\\hosts'));
    assert.ok(isProtectedPath(path.join(process.env.ProgramFiles, 'App', 'x.exe')));
    assert.ok(!isProtectedPath(path.join(os.homedir(), 'Documents', 'notes.txt')));
    assert.ok(!isProtectedPath('C:\\WindowsNotes\\a.txt'));
  } else {
    assert.ok(isProtectedPath('/usr/bin/ls'));
    assert.ok(!isProtectedPath(path.join(os.homedir(), 'notes.txt')));
  }
  assert.ok(fileSystemRoots().length >= 1);
});

test('full access works anywhere without asking, but never changes system files', async () => {
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-full-'));
  fs.writeFileSync(path.join(outside, 'a.txt'), 'hello full access');
  let asked = 0;
  const settings = { ...store.getSettings(), fileAccess: 'full', workspace: os.homedir(), mode: 'build', autoApprove: true };
  const fns = buildFunctions({
    settings, agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true,
    requestFolderAccess: async () => { asked++; return null; }, allowedFolders: fileSystemRoots(), streamedText: () => 'x\n```\nnew\n```\n',
  });
  assert.match(await fns.read_file.handler({ path: path.join(outside, 'a.txt'), startLine: 1 }), /hello full access/);
  const sys = process.platform === 'win32' ? path.join(process.env.SystemRoot || 'C:\\Windows', 'scorpion-test.txt') : '/usr/scorpion-test.txt';
  assert.match(await fns.write_file.handler({ path: sys }), /protected system folder/);
  assert.ok(!fs.existsSync(sys));
  assert.equal(asked, 0);
  assert.match(buildSystemPrompt(settings, { docNames: [] }), /FULL FILE ACCESS/);
});

test('spoken turns and other languages change the instructions', () => {
  const p = buildSystemPrompt({ ...store.getSettings(), mode: 'chat', voiceLanguage: 'fr' }, { docNames: [], spoken: true });
  assert.match(p, /Always reply in French/);
  assert.match(p, /SPOKEN CONVERSATION/);
  assert.doesNotMatch(buildSystemPrompt({ ...store.getSettings(), mode: 'chat' }, { docNames: [] }), /SPOKEN|LANGUAGE:/);
});

test('online tools exist only in Online mode, in every mode', () => {
  const base = { agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true };
  const names = (s) => Object.keys(buildFunctions({ ...base, settings: { ...store.getSettings(), ...s } }));
  assert.ok(!names({ mode: 'chat' }).includes('web_search'));
  assert.ok(names({ mode: 'chat', online: true }).includes('web_search'));
  assert.ok(names({ mode: 'build', online: true, workspace: os.tmpdir() }).includes('read_webpage'));
  assert.match(buildSystemPrompt({ ...store.getSettings(), mode: 'chat', online: true }, { docNames: [] }), /ONLINE/);
});

test('web: local network addresses are refused and pages become plain text', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '192.168.1.1', '172.20.3.4', '169.254.1.1', '::1', 'fd00::1', '::ffff:192.168.0.1']) assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
  const html = '<html><head><title>Hi &amp; bye</title><style>x{}</style></head><body><nav>menu</nav><main><h1>Scorpions</h1><p>They glow&nbsp;under UV.</p><script>evil()</script></main></body></html>';
  const { title, text } = htmlToText(html);
  assert.equal(title, 'Hi & bye');
  assert.match(text, /Scorpions\nThey glow under UV\./);
  assert.doesNotMatch(text, /evil|menu/);
});
