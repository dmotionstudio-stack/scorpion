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

test('Unrestricted mode: downloads and risky actions run without asking and are logged; without it they ask', async () => {
  const run = async (settingsPatch) => {
    const asked = [];
    const logged = [];
    const downloaded = [];
    const fns = buildFunctions({
      settings: { ...store.getSettings(), mode: 'build', workspace: os.tmpdir(), ...settingsPatch },
      agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, streamedText: () => '',
      requestApproval: async (info) => { asked.push(info.name); return false; }, // the person says no to everything that asks
      onUnrestricted: (e) => logged.push(e.name),
      services: { downloadFile: async ({ url }) => { downloaded.push(url); return `saved ${url}`; } },
      extraTools: { dangerous: { access: 'system', changes: true, noWorkspace: true, approve: () => 'always', description: 'x', params: { type: 'object', properties: {} }, async run() { return 'ran'; } } },
    });
    const a = await fns.download_file.handler({ url: 'https://example.com/tool.zip' });
    const b = await fns.dangerous.handler({});
    return { asked, logged, downloaded, a, b };
  };
  // Online but not unrestricted: both ask, and a "no" stops them.
  const normal = await run({ online: true, autoApprove: false });
  assert.deepEqual(normal.asked, ['download_file', 'dangerous']);
  assert.deepEqual(normal.downloaded, []);
  assert.deepEqual(normal.logged, []);
  // Auto-approve alone still asks for the 'always' ones.
  assert.deepEqual((await run({ online: true, autoApprove: true })).asked, ['dangerous']);
  // Unrestricted: nothing asks, both run, both are in the log.
  const free = await run({ online: true, autoApprove: true, unrestricted: true });
  assert.deepEqual(free.asked, []);
  assert.deepEqual(free.downloaded, ['https://example.com/tool.zip']);
  assert.deepEqual(free.logged, ['download_file', 'dangerous']);
  assert.equal(free.b, 'ran');
  // The downloads are only offered online, and the prompt says what the mode is.
  const names = Object.keys(buildFunctions({ agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, requestApproval: async () => true, settings: { ...store.getSettings(), mode: 'build', workspace: os.tmpdir() } }));
  for (const n of ['download_file', 'download_model', 'add_agent']) assert.ok(!names.includes(n), `${n} is online only`);
  assert.match(buildSystemPrompt({ ...store.getSettings(), mode: 'build', unrestricted: true, online: true, workspace: os.tmpdir() }, { docNames: [] }), /UNRESTRICTED MODE/);
  assert.doesNotMatch(buildSystemPrompt({ ...store.getSettings(), mode: 'build', online: true, workspace: os.tmpdir() }, { docNames: [] }), /UNRESTRICTED MODE/);
});

test('a trusted folder: edits and commands inside it run without asking, anywhere else they ask, and "always" still asks', async () => {
  const { isTrusted } = await import('../src/main/agent.js');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-trust-'));
  const inside = path.join(root, 'site');
  fs.mkdirSync(inside);
  const other = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-other-'));
  assert.ok(isTrusted({ workspace: root, trustedFolders: [root] }));
  assert.ok(isTrusted({ workspace: inside, trustedFolders: [root] }), 'a folder inside a trusted one');
  assert.ok(!isTrusted({ workspace: root + '-sibling', trustedFolders: [root] }), 'a folder that only starts with the same letters');
  assert.ok(!isTrusted({ workspace: other, trustedFolders: [root] }));
  assert.ok(!isTrusted({ workspace: root, trustedFolders: [] }));
  assert.ok(!isTrusted({ trustedFolders: [root] }));
  if (process.platform === 'win32') assert.ok(isTrusted({ workspace: root.toUpperCase(), trustedFolders: [root] }), 'Windows ignores case');

  const run = async (workspace, trustedFolders) => {
    const asked = [];
    const started = [];
    const fns = buildFunctions({
      settings: { ...store.getSettings(), mode: 'build', workspace, trustedFolders, autoApprove: false },
      agent: agents.getAgent('scorpion'), rag: { hasDocuments: () => false }, emit() {}, streamedText: () => 'x\n```\nhi\n```\n',
      requestApproval: async (info) => { asked.push(info.name); return false; },
      services: { startServer: async ({ command, cwd }) => { started.push([command, path.basename(cwd)]); return 'started'; } },
      extraTools: { dangerous: { access: 'system', changes: true, noWorkspace: true, approve: () => 'always', description: 'x', params: { type: 'object', properties: {} }, async run() { return 'ran'; } } },
    });
    const server = await fns.start_server.handler({ command: 'npm run dev', subdir: '.' });
    const file = await fns.write_file.handler({ path: 'index.html' });
    const risky = await fns.dangerous.handler({});
    return { asked, started, server, file, risky };
  };
  const trusted = await run(inside, [root]);
  assert.deepEqual(trusted.asked, ['dangerous'], 'only the always-ask action asks');
  assert.deepEqual(trusted.started, [['npm run dev', 'site']]);
  assert.ok(fs.existsSync(path.join(inside, 'index.html')));
  const untrusted = await run(other, [root]);
  assert.deepEqual(untrusted.asked, ['start_server', 'write_file', 'dangerous']);
  assert.deepEqual(untrusted.started, []);
  assert.ok(!fs.existsSync(path.join(other, 'index.html')));
  for (const d of [root, other]) fs.rmSync(d, { recursive: true, force: true });
});
