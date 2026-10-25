import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startShellApi, shellEvent, stopShellApi, infoFile } from '../src/main/shell-api.js';
import { SHELL_CALLS, SHELL_EVENTS } from '../src/shared/shell-channels.js';

test('the shell API answers only with its key, only the shell\'s own calls, only its own files', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'shell-api-'));
  process.env.XDG_RUNTIME_DIR = dir;
  const pages = path.join(dir, 'pages');
  fs.mkdirSync(pages);
  fs.writeFileSync(path.join(pages, 'edge.html'), '<p>rail</p>');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'no');
  const calls = [];
  const info = await startShellApi({
    handlers: { 'shell:tray': (arg) => { calls.push(arg); return { battery: 80 }; }, 'chat:send': () => 'never', 'shell:windows': () => { throw new Error('busy'); } },
    roots: [pages],
  });
  try {
    const saved = JSON.parse(fs.readFileSync(infoFile(), 'utf8'));
    assert.equal(saved.port, info.port);
    assert.equal(saved.key, info.key);
    const base = `http://127.0.0.1:${info.port}/${info.key}`;
    const post = (ch, body, b = base) => fetch(`${b}/ipc/${ch}`, { method: 'POST', body: JSON.stringify(body) });

    assert.deepEqual(await (await post('shell:tray', { a: 1 })).json(), { ok: true, value: { battery: 80 } });
    assert.deepEqual(calls, [{ a: 1 }]);
    assert.deepEqual(await (await post('shell:windows', null)).json(), { ok: false, error: 'busy' });
    assert.equal((await post('chat:send', {})).status, 404, 'not a shell call');
    assert.equal((await post('shell:tray', {}, `http://127.0.0.1:${info.port}/wrongkey`)).status, 404, 'wrong key');
    assert.equal(await (await fetch(`${base}/edge.html`)).text(), '<p>rail</p>');
    assert.equal((await fetch(`${base}/../secret.txt`)).status, 404);
    assert.equal((await fetch(`${base}/%2e%2e/secret.txt`)).status, 404, 'no way out of the pages folder');

    // Events: only the shell's own reach the pages.
    const res = await fetch(`${base}/events`);
    const reader = res.body.getReader();
    await reader.read(); // the hello
    shellEvent('chat:event', { secret: true });
    shellEvent('shell:notify', { id: 7, summary: 'Hi' });
    const { value } = await reader.read();
    const text = new TextDecoder().decode(value);
    assert.match(text, /event: shell:notify\ndata: \{"id":7,"summary":"Hi"\}/);
    assert.doesNotMatch(text, /secret/);
    await reader.cancel();
  } finally {
    stopShellApi();
  }
  assert.equal(fs.existsSync(infoFile()), false, 'the key file goes away with it');
});

test('the shell host\'s bridge offers exactly the shell\'s calls and events', () => {
  const src = fs.readFileSync(new URL('../src/renderer/shell-bridge.js', import.meta.url), 'utf8');
  const block = (name) => Object.fromEntries([...src.match(new RegExp(`const ${name} = \\{([\\s\\S]*?)\\};`))[1].matchAll(/(\w+): '([^']+)'/g)].map((m) => [m[1], m[2]]));
  assert.deepEqual(block('CALLS'), SHELL_CALLS);
  assert.deepEqual(block('EVENTS'), SHELL_EVENTS);
  // And Electron's preload offers the same names to the same pages.
  const preload = fs.readFileSync(new URL('../src/preload.cjs', import.meta.url), 'utf8');
  for (const [name, ch] of Object.entries(SHELL_CALLS)) {
    if (name === 'notifications' || name === 'notificationAct') continue; // Scorpion OS only
    assert.match(preload, new RegExp(`${name}: invoke\\('${ch}'\\)`), `preload: ${name}`);
  }
});
