// Skills: folders with a SKILL.md that teach the agent how to do a kind of
// job. The same format OpenClaw and Claude use: YAML front matter with a name
// and a description, then Markdown instructions. Only the names and one-line
// descriptions go in the system prompt; the agent reads a skill's full text
// with use_skill when a task matches, so many skills cost little context.
//
// Bundled skills ship with Scorpion (read-only); the user's own skills live in
// the data folder and win over a bundled one with the same name. Every change
// to a user skill keeps the previous version, so it can be undone.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './store.js';

let bundledDir = null;
let userDir = null;
const stateFile = () => path.join(userDir, 'skills.json');
const MAX_BODY = 12000;
const MAX_IN_PROMPT = 30;
const MAX_IMPORT_BYTES = 5 * 1024 * 1024;
const KEEP_VERSIONS = 10;

export function initSkills(appDir, dataDir) {
  bundledDir = appDir;
  userDir = path.join(dataDir, 'skills');
  fs.mkdirSync(userDir, { recursive: true });
}

export const skillsFolder = () => userDir;

// Names are folder names: lowercase words joined by dashes.
export function slug(name) {
  return String(name || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
}

// The small YAML subset skills use: "key: value", quoted values, and folded
// (>) or literal (|) blocks. Anything else (metadata maps etc.) is ignored.
export function parseSkill(text) {
  const src = String(text).replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  const meta = {};
  if (m) {
    const lines = m[1].split('\n');
    for (let i = 0; i < lines.length; i++) {
      const kv = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
      if (!kv) continue;
      let value = kv[2].trim();
      if (value === '>' || value === '|' || value === '>-' || value === '|-') {
        const block = [];
        while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === '')) block.push(lines[++i].trim());
        value = value.startsWith('>') ? block.filter(Boolean).join(' ') : block.join('\n').trim();
      } else if (/^(["']).*\1$/.test(value)) {
        value = value.slice(1, -1).replace(/\\"/g, '"');
      }
      meta[kv[1].toLowerCase()] = value;
    }
  }
  return { name: meta.name || '', description: meta.description || '', body: (m ? src.slice(m[0].length) : src).trim() };
}

export function formatSkill({ name, description, body }) {
  const oneLine = String(description || '').replace(/\s+/g, ' ').trim();
  return `---\nname: ${slug(name)}\ndescription: ${JSON.stringify(oneLine)}\n---\n\n${String(body || '').trim()}\n`;
}

const disabled = () => new Set(userDir ? readJson(stateFile(), {}).disabled || [] : []);

function readDir(dir, source) {
  if (!dir || !fs.existsSync(dir)) return [];
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory() || e.name.startsWith('.')) continue;
    const file = path.join(dir, e.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    try {
      const s = parseSkill(fs.readFileSync(file, 'utf8'));
      out.push({ name: e.name, title: s.name || e.name, description: s.description, source, dir: path.join(dir, e.name) });
    } catch { /* unreadable: skipped */ }
  }
  return out;
}

export function listSkills() {
  const off = disabled();
  const byName = new Map();
  for (const s of readDir(bundledDir, 'bundled')) byName.set(s.name, s);
  for (const s of readDir(userDir, 'user')) byName.set(s.name, { ...s, overrides: byName.has(s.name) });
  return [...byName.values()]
    .map((s) => ({ ...s, enabled: !off.has(s.name), versions: s.source === 'user' ? versions(s.name).length : 0 }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function hasSkills() {
  return listSkills().some((s) => s.enabled);
}

function find(name) {
  const key = slug(name);
  return listSkills().find((s) => s.name === key || slug(s.title) === key) || null;
}

// The whole skill for the agent: its instructions and the files beside it.
export function getSkill(name) {
  const s = find(name);
  if (!s) return null;
  const parsed = parseSkill(fs.readFileSync(path.join(s.dir, 'SKILL.md'), 'utf8'));
  const files = [];
  const walk = (d, rel = '') => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name.startsWith('.') || files.length >= 40) continue;
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(path.join(d, e.name), r);
      else if (r !== 'SKILL.md') files.push(r);
    }
  };
  walk(s.dir);
  return { ...s, description: parsed.description || s.description, body: parsed.body.slice(0, MAX_BODY), truncated: parsed.body.length > MAX_BODY, files };
}

export function skillsPromptBlock() {
  const list = listSkills().filter((s) => s.enabled).slice(0, MAX_IN_PROMPT);
  if (!list.length) return '';
  return `SKILLS: step-by-step guides for certain jobs. When a task matches one, call use_skill with its name first and follow it.\n${list
    .map((s) => `- ${s.name}: ${String(s.description).replace(/\s+/g, ' ').slice(0, 160)}`).join('\n')}`;
}

// ---------- changes (user skills only) ----------
const historyDir = (name) => path.join(userDir, name, '.history');
function versions(name) {
  const d = historyDir(name);
  return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.endsWith('.md')).sort() : [];
}

export function saveSkill({ name, description, body, previousName = null }) {
  const key = slug(name);
  if (!key) throw new Error('Give the skill a name');
  if (!String(description || '').trim()) throw new Error('Describe when to use the skill');
  if (!String(body || '').trim()) throw new Error('Write the skill\'s instructions');
  const dir = path.join(userDir, key);
  // Renaming a user skill moves its folder (and history) along.
  const old = previousName && slug(previousName) !== key ? path.join(userDir, slug(previousName)) : null;
  if (old && fs.existsSync(old) && !fs.existsSync(dir)) fs.renameSync(old, dir);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'SKILL.md');
  if (fs.existsSync(file)) {
    fs.mkdirSync(historyDir(key), { recursive: true });
    fs.copyFileSync(file, path.join(historyDir(key), `${Date.now()}.md`));
    for (const f of versions(key).slice(0, -KEEP_VERSIONS)) fs.rmSync(path.join(historyDir(key), f));
  }
  fs.writeFileSync(file, formatSkill({ name: key, description, body }));
  return find(key);
}

// Puts back the version before the last change.
export function undoSkill(name) {
  const key = slug(name);
  const list = versions(key);
  if (!list.length) throw new Error('Nothing to undo');
  const last = path.join(historyDir(key), list.at(-1));
  fs.copyFileSync(last, path.join(userDir, key, 'SKILL.md'));
  fs.rmSync(last);
  return find(key);
}

export function deleteSkill(name) {
  const key = slug(name);
  const dir = path.join(userDir, key);
  if (!fs.existsSync(path.join(dir, 'SKILL.md'))) throw new Error('Only your own skills can be deleted (turn a bundled one off instead)');
  fs.rmSync(dir, { recursive: true, force: true });
}

export function setSkillEnabled(name, on) {
  const off = disabled();
  if (on) off.delete(slug(name)); else off.add(slug(name));
  writeJson(stateFile(), { ...readJson(stateFile(), {}), disabled: [...off] });
}

// Copies skills in from a folder: either one skill (it has a SKILL.md) or a
// folder of skills (its subfolders do). Returns the names imported.
export function importSkills(folder) {
  const one = fs.existsSync(path.join(folder, 'SKILL.md'));
  const sources = one ? [folder] : fs.readdirSync(folder, { withFileTypes: true })
    .filter((e) => e.isDirectory() && fs.existsSync(path.join(folder, e.name, 'SKILL.md'))).map((e) => path.join(folder, e.name));
  if (!sources.length) throw new Error('No SKILL.md found in that folder or its subfolders');
  const names = [];
  for (const src of sources) {
    const parsed = parseSkill(fs.readFileSync(path.join(src, 'SKILL.md'), 'utf8'));
    const key = slug(parsed.name || path.basename(src));
    if (!key) continue;
    let bytes = 0;
    const dest = path.join(userDir, key);
    if (fs.existsSync(path.join(dest, 'SKILL.md'))) { // replacing one: keep the old text for undo
      fs.mkdirSync(historyDir(key), { recursive: true });
      fs.copyFileSync(path.join(dest, 'SKILL.md'), path.join(historyDir(key), `${Date.now()}.md`));
    }
    fs.cpSync(src, dest, {
      recursive: true,
      filter: (p) => {
        const base = path.basename(p);
        if (['node_modules', '.git', '__pycache__'].includes(base)) return false;
        try { const st = fs.statSync(p); if (st.isFile()) bytes += st.size; } catch { return false; }
        return bytes <= MAX_IMPORT_BYTES;
      },
    });
    names.push(key);
  }
  return names;
}
