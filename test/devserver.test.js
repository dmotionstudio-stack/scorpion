import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { findAddress, isLocalUrl, localUrlFrom, createLog, killTree, createDevServers } from '../src/main/devserver.js';

test('the address a server prints is found, in the ways servers print it', () => {
  assert.equal(findAddress('  VITE v5  ready\n  ➜  Local:   http://localhost:5173/\n'), 'http://localhost:5173/');
  assert.equal(findAddress('\u001b[32mServer listening on http://127.0.0.1:8000/app\u001b[0m'), 'http://localhost:8000/app');
  assert.equal(findAddress('Serving HTTP on :: port 8000 (http://[::]:8000/) ...'), 'http://localhost:8000/');
  assert.equal(findAddress('Network: http://0.0.0.0:3000'), 'http://localhost:3000/');
  assert.equal(findAddress('ready - started server on port 3001'), 'http://localhost:3001/');
  assert.equal(findAddress('Listening on port: 4000'), 'http://localhost:4000/');
  assert.equal(findAddress('compiled successfully'), null);
  assert.equal(findAddress('see https://example.com:443/docs'), null, 'another computer is not a local server');
});

test('the preview shows this computer only', () => {
  for (const ok of ['http://localhost:3000/', 'https://127.0.0.1:8443/x', 'http://[::1]:5000/']) assert.ok(isLocalUrl(ok), ok);
  for (const bad of ['https://example.com/', 'http://192.168.1.5:3000/', 'file:///C:/x.html', 'javascript:alert(1)', 'http://localhost.evil.com/', 'nonsense']) assert.ok(!isLocalUrl(bad), bad);
  assert.equal(localUrlFrom('3000'), 'http://localhost:3000/');
  assert.equal(localUrlFrom('localhost:3000/app'), 'http://localhost:3000/app');
  assert.equal(localUrlFrom('http://127.0.0.1:80'), 'http://127.0.0.1/');
  assert.equal(localUrlFrom('example.com'), null);
  assert.equal(localUrlFrom(''), null);
});

test('the log keeps the last lines and a line still being written', () => {
  const log = createLog(3);
  log.push('a\nb\r\nc\n');
  log.push('d\ne\nf\n');
  assert.equal(log.text(10), 'd\ne\nf');
  log.push('g');
  assert.equal(log.text(2), 'f\ng');
  log.push('h\n'); // the line being written is finished: "gh"
  assert.equal(log.text(2), 'f\ngh');
  log.clear();
  assert.equal(log.text(), '');
});

test('stopping reaches the whole tree: taskkill on Windows, the process group elsewhere', () => {
  const ran = [];
  killTree(42, { platform: 'win32', run: (f, a) => ran.push([f, ...a]) });
  assert.deepEqual(ran[0], ['taskkill', '/PID', '42', '/T', '/F']);
  const killed = [];
  killTree(42, { platform: 'linux', kill: (pid, sig) => killed.push([pid, sig]) });
  assert.deepEqual(killed, [[-42, 'SIGTERM']]);
  killTree(0, { platform: 'win32', run: () => assert.fail('no process') });
});

function fakeSpawn(record) {
  return (file, args, opts) => {
    const child = new EventEmitter();
    child.pid = 99;
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    record.push({ file, args, opts, child });
    return child;
  };
}

test('a server starts in the workspace, its address is found once, and it stops', () => {
  const started = [];
  const events = [];
  const s = createDevServers({ spawn: fakeSpawn(started), platform: 'win32', onAddress: (id, url) => events.push(['address', id, url]), onExit: (id, code) => events.push(['exit', id, code]), onData: () => {} });
  assert.throws(() => s.start({ command: '  ' }), /Give the command/);
  const info = s.start({ name: 'web', command: 'npm run dev', cwd: 'C:\\work\\site' });
  assert.equal(info.running, true);
  assert.equal(started[0].file, 'powershell.exe');
  assert.equal(started[0].args.at(-1), 'npm run dev');
  assert.equal(started[0].opts.cwd, 'C:\\work\\site');
  assert.equal(started[0].opts.env.BROWSER, 'none');
  assert.throws(() => s.start({ name: 'web', command: 'npm run dev' }), /already running/);
  started[0].child.stdout.emit('data', Buffer.from('starting…\n'));
  started[0].child.stdout.emit('data', Buffer.from('  Local: http://localhost:5173/\n'));
  started[0].child.stdout.emit('data', Buffer.from('  Local: http://localhost:9999/\n'));
  assert.deepEqual(events, [['address', 'web', 'http://localhost:5173/']]);
  assert.equal(s.list()[0].url, 'http://localhost:5173/');
  assert.match(s.logs('web').output, /starting/);
  s.stop('web');
  started[0].child.emit('exit', 1);
  assert.deepEqual(events.at(-1), ['exit', 'web', 1]);
  assert.equal(s.list()[0].running, false);
  assert.match(s.logs().output, /stopped, exit code 1/);
  // A stopped name can be used again.
  assert.equal(s.start({ name: 'web', command: 'npm run dev' }).running, true);
  assert.equal(s.running(), 1);
  s.stopAll();
});

test('which server is meant: the only one, or one that is named', () => {
  const started = [];
  const s = createDevServers({ spawn: fakeSpawn(started), platform: 'linux' });
  assert.throws(() => s.logs(), /No server has been started/);
  s.start({ name: 'a', command: 'x' });
  s.start({ name: 'b', command: 'y' });
  assert.throws(() => s.stop(), /Several servers are running \(a, b\)/);
  assert.throws(() => s.stop('zzz'), /No server called "zzz"/);
  assert.equal(s.logs('b').id, 'b');
  started[0].child.emit('error', new Error('ENOENT'));
  assert.match(s.logs('a').output, /could not start: ENOENT/);
  assert.equal(s.logs().id, 'b', 'only b is still running');
});
