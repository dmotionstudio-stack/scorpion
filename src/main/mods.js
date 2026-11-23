// Mods: changes to Scorpion that live in the data folder, outside the (sealed) program, so Scorpion can change itself without its source.
//
//   <data>/mods/<name>/
//       main.mjs      runs inside Scorpion at start-up (export default function (api) { ... })
//       renderer.js   runs in the screens at start-up (a function body: it gets `scorpion` and `mod`)
//       style.css     added to the screens
//       mod.json      { "description": "..." }   (optional)
//
// Safety, because a mod can break the start-up that would let you fix it:
//   - Every applied version is kept (.history), so a mod can be rolled back one version at a time.
//   - Each start is marked unhealthy until it has run for a while (markHealthy). Two unhealthy starts in a row and the next start is SAFE
//     MODE: no mod loads, the mods are put back as they were at the last healthy start (.good), and a mod that did not exist then is
//     moved aside (.quarantine), never deleted. The person is told what was reverted.
//   - A mod that throws while loading is turned off by itself, with the reason kept.
//   - A change is checked for syntax before it is applied.
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';

const MAX_FILE = 512 * 1024;
const KEEP_VERSIONS = 10;
const FAILED_STARTS_FOR_SAFE_MODE = 2;
const PARTS = { main: 'main.mjs', renderer: 'renderer.js', css: 'style.css' };

// Names are folder names: lowercase words joined by dashes.
export function modSlug(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
}

// The syntax of a mod's files: a clear message for the model that wrote them, or null.
export function checkSyntax(dir, { runNode = (file) => execFileSync(process.execPath, ['--check', file], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'pipe', timeout: 15000 }) } = {}) {
  const main = path.join(dir, PARTS.main);
  if (fs.existsSync(main)) {
    try { runNode(main); } catch (err) { return `${PARTS.main}: ${String(err.stderr || err.message).split('\n').filter((l) => /Error|error/.test(l)).slice(0, 2).join(' ').slice(0, 300) || 'a syntax error'}`; }
  }
  const renderer = path.join(dir, PARTS.renderer);
  if (fs.existsSync(renderer)) {
    try { new vm.Script(`(function(scorpion, mod) {\n${fs.readFileSync(renderer, 'utf8')}\n})`, { filename: PARTS.renderer }); } catch (err) { return `${PARTS.renderer}: ${err.message}`; }
  }
  return null;
}

const copyDir = (from, to) => { fs.rmSync(to, { recursive: true, force: true }); fs.mkdirSync(path.dirname(to), { recursive: true }); fs.cpSync(from, to, { recursive: true }); };
const dirsOf = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith('.')).map((e) => e.name) : []);
const sameTree = (a, b) => {
  const walk = (d, rel = '') => (fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name), `${rel}${e.name}/`) : [`${rel}${e.name}`])).sort() : []);
  const fa = walk(a);
  const fb = walk(b);
  return fa.length === fb.length && fa.every((f, i) => f === fb[i] && fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))));
};

export function createMods(dir, { now = () => Date.now(), check = checkSyntax } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  const stateFile = path.join(dir, 'state.json');
  const good = path.join(dir, '.good');
  const applied = path.join(dir, '.applied');
  const history = path.join(dir, '.history');
  const quarantine = path.join(dir, '.quarantine');
  let safe = false;

  const read = () => { try { return JSON.parse(fs.readFileSync(stateFile, 'utf8')); } catch { return {}; } };
  const write = (st) => fs.writeFileSync(stateFile, JSON.stringify(st, null, 1));
  const stamp = () => new Date(now()).toISOString().replace(/[:.]/g, '-');
  const versions = (name) => (fs.existsSync(path.join(history, name)) ? fs.readdirSync(path.join(history, name)).sort() : []);
  const describe = (name) => { try { return String(JSON.parse(fs.readFileSync(path.join(dir, name, 'mod.json'), 'utf8')).description || ''); } catch { return ''; } };
  const has = (name, part) => fs.existsSync(path.join(dir, name, PARTS[part]));

  // At start-up: is this a safe-mode start? (Call once, before loading anything.)
  function boot({ forceSafe = false } = {}) {
    const st = read();
    const failed = st.boot?.pending ? (st.boot.failed || 0) + 1 : 0;
    let recovered = [];
    safe = forceSafe || failed >= FAILED_STARTS_FOR_SAFE_MODE;
    if (safe) {
      recovered = recover();
      st.boot = { pending: false, failed: 0 };
      if (!forceSafe) st.notice = { at: now(), reason: `Scorpion did not start properly ${failed} times in a row, so it started with mods off.`, recovered };
    } else {
      st.boot = { pending: true, failed };
    }
    write(st);
    return { safe, recovered };
  }

  // Safe mode: the mods as they were at the last healthy start; anything newer is moved aside, not deleted.
  function recover() {
    const out = [];
    for (const name of dirsOf(dir)) {
      const was = path.join(good, name);
      if (fs.existsSync(was)) {
        if (!sameTree(was, path.join(dir, name))) { copyDir(was, path.join(dir, name)); out.push(`${name} (put back as it was)`); }
      } else {
        const to = path.join(quarantine, stamp(), name);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.renameSync(path.join(dir, name), to);
        out.push(`${name} (moved aside)`);
      }
    }
    return out;
  }

  // The start went well for long enough: remember the mods as they are now (the safe state to come back to).
  function markHealthy() {
    const st = read();
    st.boot = { pending: false, failed: 0 };
    write(st);
    if (safe) return; // no mod ran this time: nothing new to trust
    fs.rmSync(good, { recursive: true, force: true });
    for (const name of dirsOf(dir)) copyDir(path.join(dir, name), path.join(good, name));
  }

  function list() {
    const st = read();
    return dirsOf(dir).map((name) => ({
      name, description: describe(name), enabled: !(st.disabled || []).includes(name), error: st.errors?.[name] || null,
      parts: { main: has(name, 'main'), renderer: has(name, 'renderer'), css: has(name, 'css') }, versions: versions(name).length,
    }));
  }

  // What the screens load (nothing in safe mode).
  function payload() {
    if (safe) return [];
    const st = read();
    const fileOf = (name, part) => { const f = path.join(dir, name, PARTS[part]); return fs.existsSync(f) && fs.statSync(f).size <= MAX_FILE ? fs.readFileSync(f, 'utf8') : ''; };
    return dirsOf(dir).filter((n) => !(st.disabled || []).includes(n)).map((name) => ({ name, js: fileOf(name, 'renderer'), css: fileOf(name, 'css') })).filter((m) => m.js || m.css);
  }
  // A mod's renderer.js as a script the screens load from Scorpion's own address (the page's security policy allows no inline scripts and no eval).
  // It runs as a function body with `scorpion` and `mod`; if it throws, the mod turns itself off.
  function script(rawName) {
    if (safe) return null;
    const name = modSlug(rawName);
    const file = path.join(dir, name, PARTS.renderer);
    if ((read().disabled || []).includes(name) || !fs.existsSync(file) || fs.statSync(file).size > MAX_FILE) return null;
    return `(function () { var mod = { name: ${JSON.stringify(name)} };\ntry { (function (scorpion, mod) {\n${fs.readFileSync(file, 'utf8')}\n})(window.scorpion, mod); }\ncatch (err) { console.error('[mod ' + mod.name + ']', err); window.scorpion.modsError({ name: mod.name, message: String((err && err.message) || err) }); } })();\n`;
  }
  function mainEntries() {
    if (safe) return [];
    const st = read();
    return dirsOf(dir).filter((n) => !(st.disabled || []).includes(n) && has(n, 'main')).map((name) => ({ name, file: path.join(dir, name, PARTS.main) }));
  }

  // The agent says it finished editing a mod: check it, keep the version before, and turn it on.
  function apply(rawName) {
    const name = modSlug(rawName);
    if (!name || !fs.existsSync(path.join(dir, name))) throw new Error(`There is no mod folder "${rawName}" in ${dir}. Create ${dir}${path.sep}<name>${path.sep} with main.mjs, renderer.js or style.css first.`);
    if (!Object.keys(PARTS).some((p) => has(name, p))) throw new Error(`The mod "${name}" has none of ${Object.values(PARTS).join(', ')}.`);
    for (const part of Object.values(PARTS)) {
      const f = path.join(dir, name, part);
      if (fs.existsSync(f) && fs.statSync(f).size > MAX_FILE) throw new Error(`${part} is bigger than ${MAX_FILE / 1024} KB.`);
    }
    const problem = check(path.join(dir, name));
    if (problem) throw new Error(`Not applied, a syntax error: ${problem}. Fix it and call mod_apply again.`);
    if (fs.existsSync(path.join(applied, name)) && !sameTree(path.join(applied, name), path.join(dir, name))) {
      copyDir(path.join(applied, name), path.join(history, name, stamp()));
      for (const old of versions(name).slice(0, -KEEP_VERSIONS)) fs.rmSync(path.join(history, name, old), { recursive: true, force: true });
    }
    copyDir(path.join(dir, name), path.join(applied, name));
    const st = read();
    st.disabled = (st.disabled || []).filter((n) => n !== name);
    if (st.errors) delete st.errors[name];
    write(st);
    return { name, needsRestart: has(name, 'main'), reload: has(name, 'renderer') || has(name, 'css'), versions: versions(name).length };
  }

  // Back to the version before the last apply.
  function rollback(rawName) {
    const name = modSlug(rawName);
    const v = versions(name);
    if (!v.length) throw new Error(`The mod "${name}" has no earlier version. Turn it off with mod_enable instead.`);
    const from = path.join(history, name, v.at(-1));
    copyDir(from, path.join(dir, name));
    copyDir(from, path.join(applied, name));
    fs.rmSync(from, { recursive: true, force: true });
    const st = read();
    st.disabled = (st.disabled || []).filter((n) => n !== name);
    if (st.errors) delete st.errors[name];
    write(st);
    return { name, needsRestart: has(name, 'main'), reload: has(name, 'renderer') || has(name, 'css'), versions: versions(name).length };
  }

  function setEnabled(rawName, enabled) {
    const name = modSlug(rawName);
    if (!fs.existsSync(path.join(dir, name))) throw new Error(`There is no mod "${rawName}".`);
    const st = read();
    const off = new Set(st.disabled || []);
    if (enabled) { off.delete(name); if (st.errors) delete st.errors[name]; } else off.add(name);
    st.disabled = [...off];
    write(st);
    return { name, enabled: Boolean(enabled), needsRestart: has(name, 'main'), reload: has(name, 'renderer') || has(name, 'css') };
  }

  // A mod that throws while loading is turned off by itself, so it cannot break every start.
  function recordError(rawName, message) {
    const name = modSlug(rawName);
    const st = read();
    st.errors = { ...(st.errors || {}), [name]: String(message || 'failed').slice(0, 400) };
    st.disabled = [...new Set([...(st.disabled || []), name])];
    write(st);
  }

  const notice = () => read().notice || null;
  const dismissNotice = () => { const st = read(); delete st.notice; write(st); };

  return { dir, boot, markHealthy, list, payload, script, mainEntries, apply, rollback, setEnabled, recordError, notice, dismissNotice, get safe() { return safe; } };
}
