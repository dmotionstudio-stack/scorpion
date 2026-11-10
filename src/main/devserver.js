// Local servers and the terminal for Build: Scorpion (or the person) starts
// a command in the workspace (npm run dev, python -m http.server…), its output
// is kept and shown, and the address it prints is found so the preview can open
// it. Plain functions with the process starter passed in, tested in
// test/devserver.test.js. Nothing here starts by itself.
import { spawn as nodeSpawn, execFile } from 'node:child_process';

// The address a server prints: "Local: http://localhost:5173/", "listening on http://127.0.0.1:8000",
// "Serving HTTP on :: port 8000", "ready on port 3000".
export function findAddress(text) {
  const t = String(text || '').replace(/\u001b\[[0-9;]*[A-Za-z]/g, '');
  const full = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1?\]|\[::\]):(\d{2,5})(\/[^\s'")\]]*)?/i.exec(t);
  if (full) return `http://localhost:${full[1]}${full[2] && full[2] !== '/' ? full[2] : '/'}`;
  const port = /(?:listening|serving|running|ready|started|available)[^\n]{0,60}?\bport\s*[:=]?\s*(\d{2,5})\b/i.exec(t) || /\bon port (\d{2,5})\b/i.exec(t);
  return port ? `http://localhost:${port[1]}/` : null;
}

// A page the preview may show: this computer only, over http(s).
export function isLocalUrl(raw) {
  try {
    const u = new URL(String(raw));
    return /^https?:$/.test(u.protocol) && ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  } catch { return false; }
}
// What to type into the address bar: "3000", "localhost:3000/app" or a full address, as a local address (null: not one).
export function localUrlFrom(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^\d{2,5}$/.test(s)) return `http://localhost:${s}/`;
  const withScheme = /^[a-z]+:\/\//i.test(s) ? s : `http://${s}`;
  return isLocalUrl(withScheme) ? new URL(withScheme).href : null;
}

// The last lines of output, as text, capped.
export function createLog(maxLines = 400) {
  const lines = [];
  let partial = '';
  return {
    push(chunk) {
      const parts = (partial + String(chunk).replace(/\r\n/g, '\n')).split('\n');
      partial = parts.pop();
      for (const l of parts) lines.push(l);
      while (lines.length > maxLines) lines.shift();
    },
    text(last = 80) { return [...lines, ...(partial ? [partial] : [])].slice(-last).join('\n'); },
    clear() { lines.length = 0; partial = ''; },
  };
}

// Kill a process and what it started (npm starts node starts the server).
export function killTree(pid, { platform = process.platform, run = execFile, kill = process.kill.bind(process) } = {}) {
  if (!pid) return;
  if (platform === 'win32') { run('taskkill', ['/PID', String(pid), '/T', '/F'], () => {}); return; }
  try { kill(-pid, 'SIGTERM'); } catch { try { kill(pid, 'SIGTERM'); } catch { /* gone */ } }
}

// deps: { spawn, onData(id, text), onExit(id, code), onAddress(id, url) } (for tests)
export function createDevServers({ spawn = nodeSpawn, onData = () => {}, onExit = () => {}, onAddress = () => {}, platform = process.platform } = {}) {
  const servers = new Map(); // id -> { id, name, command, cwd, child, log, url, running, startedAt }
  const shellFor = () => (platform === 'win32' ? { file: 'powershell.exe', args: (c) => ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', c] } : { file: '/bin/sh', args: (c) => ['-c', c] });

  function start({ name, command, cwd }) {
    const cmd = String(command || '').trim();
    if (!cmd) throw new Error('Give the command that starts the server.');
    const id = String(name || cmd.split(/\s+/).slice(0, 3).join(' ')).trim().slice(0, 40) || 'server';
    if (servers.get(id)?.running) throw new Error(`"${id}" is already running. Stop it first, or give this one another name.`);
    const sh = shellFor();
    const child = spawn(sh.file, sh.args(cmd), { cwd, windowsHide: true, detached: platform !== 'win32', env: { ...process.env, FORCE_COLOR: '0', BROWSER: 'none', PORT: process.env.PORT } });
    const entry = { id, name: id, command: cmd, cwd, child, log: createLog(), url: null, running: true, startedAt: Date.now(), exitCode: null };
    servers.set(id, entry);
    const take = (d) => {
      const text = String(d);
      entry.log.push(text);
      onData(id, text);
      if (!entry.url) { const url = findAddress(entry.log.text(40)); if (url) { entry.url = url; onAddress(id, url); } }
    };
    child.stdout?.on('data', take);
    child.stderr?.on('data', take);
    child.on('error', (err) => { entry.running = false; entry.exitCode = -1; take(`\n[could not start: ${err.message}]\n`); onExit(id, -1); });
    child.on('exit', (code) => { entry.running = false; entry.exitCode = code; take(`\n[stopped, exit code ${code}]\n`); onExit(id, code); });
    return summary(entry);
  }
  const summary = (e) => ({ id: e.id, name: e.name, command: e.command, cwd: e.cwd, url: e.url, running: e.running, exitCode: e.exitCode, startedAt: e.startedAt });
  const find = (name) => {
    if (name) { const e = servers.get(String(name)); if (!e) throw new Error(`No server called "${name}".`); return e; }
    const live = [...servers.values()].filter((s) => s.running);
    if (live.length === 1) return live[0];
    if (!live.length && servers.size) return [...servers.values()].at(-1);
    if (!servers.size) throw new Error('No server has been started.');
    throw new Error(`Several servers are running (${live.map((s) => s.id).join(', ')}): say which.`);
  };
  return {
    start,
    stop(name) { const e = find(name); if (e.running) killTree(e.child.pid, { platform }); return summary(e); },
    // A line typed to a running process (a prompt asking y/n, a REPL).
    write(name, text) {
      const e = find(name);
      if (!e.running || !e.child.stdin) throw new Error(`"${e.id}" is not running.`);
      e.child.stdin.write(text.endsWith('\n') ? text : `${text}\n`);
      e.log.push(`> ${text.replace(/\n$/, '')}\n`);
    },
    logs(name, last = 60) { const e = find(name); return { ...summary(e), output: e.log.text(last) }; },
    list: () => [...servers.values()].map(summary),
    // Everything that is running (when Scorpion closes, or a chat's workspace changes).
    stopAll() { for (const e of servers.values()) if (e.running) killTree(e.child.pid, { platform }); },
    running: () => [...servers.values()].filter((s) => s.running).length,
  };
}
