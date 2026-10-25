// Agent tools. Every tool is tagged with an access level:
//   read  — runs freely
//   write — changes files; needs approval unless auto-approve is on
//   exec  — runs a shell command; needs approval unless auto-approve is on
// All file paths are resolved inside the workspace folder and escapes are refused.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, spawnSync } from 'node:child_process';
import { evaluate } from './calc.js';
import { extractText } from './rag.js';
import { webSearch, readWebpage, UNTRUSTED } from './web.js';
import { analyzeFile, analyzeImage, decodeFile, groupPhotos, listImages, cosine, SAME_PERSON } from './faces.js';
import { describeFaces, insightsStatus } from './face-insights.js';
import { searchLibrary, itemInfo, tagFile } from './library.js';
import { getSkill, listSkills, saveSkill } from './skills.js';
import win from './system.js';

// Python is optional; find whichever launcher this computer has, once.
let pythonCmd;
function findPython() {
  if (pythonCmd !== undefined) return pythonCmd;
  const candidates = process.platform === 'win32' ? [['py', ['-3']], ['python', []], ['python3', []]] : [['python3', []], ['python', []]];
  pythonCmd = null;
  for (const [cmd, pre] of candidates) {
    const r = spawnSync(cmd, [...pre, '--version'], { encoding: 'utf8', windowsHide: true, timeout: 5000 });
    // The Windows Store "python" stub exits non-zero, so require a real version.
    if (r.status === 0 && /Python 3/.test(`${r.stdout}${r.stderr}`)) { pythonCmd = [cmd, pre]; break; }
  }
  return pythonCmd;
}

function parseCsv(text, delimiter) {
  const rows = [];
  let row = [], field = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (ch === '"') quoted = false; else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c !== ''));
}

async function readSheetRows(file, sheetName) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.csv' || ext === '.tsv') {
    const text = fs.readFileSync(file, 'utf8').replace(/^﻿/, '');
    return { sheets: [path.basename(file)], rows: parseCsv(text, ext === '.tsv' ? '\t' : ',') };
  }
  if (ext !== '.xlsx') throw new Error('Supported spreadsheet types: .xlsx, .csv, .tsv');
  const ExcelJS = (await import('exceljs')).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(file);
  const sheets = wb.worksheets.map((w) => w.name);
  const ws = (sheetName && wb.getWorksheet(sheetName)) || wb.worksheets[0];
  if (!ws) throw new Error('The workbook has no sheets');
  const rows = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    rows.push(r.values.slice(1).map((v) => {
      if (v == null) return '';
      if (v instanceof Date) return v.toISOString().slice(0, 10);
      if (typeof v === 'object') return String(v.result ?? v.text ?? v.richText?.map((t) => t.text).join('') ?? '');
      return String(v);
    }));
  });
  return { sheets, sheet: ws.name, rows };
}

function summarizeTable(rows) {
  if (!rows.length) return 'The sheet is empty.';
  const [header, ...data] = rows;
  const width = Math.max(...rows.map((r) => r.length));
  const cols = Array.from({ length: width }, (_, i) => header[i] || `col${i + 1}`);
  const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ').slice(0, 60);
  const show = data.slice(0, 30);
  const table = [`| ${cols.map(esc).join(' | ')} |`, `|${cols.map(() => '---').join('|')}|`,
    ...show.map((r) => `| ${cols.map((_, i) => esc(r[i])).join(' | ')} |`)].join('\n');
  const stats = cols.map((c, i) => {
    const nums = data.map((r) => Number(String(r[i] ?? '').replace(/[$,%\s]/g, ''))).filter((n, j) => data[j][i] !== '' && Number.isFinite(n));
    if (nums.length < Math.max(1, data.length * 0.6)) return null;
    const sum = nums.reduce((a, b) => a + b, 0);
    return `- ${c}: count ${nums.length}, sum ${+sum.toFixed(4)}, mean ${+(sum / nums.length).toFixed(4)}, min ${Math.min(...nums)}, max ${Math.max(...nums)}`;
  }).filter(Boolean);
  return `${data.length} data rows × ${cols.length} columns. Columns: ${cols.join(', ')}\n\n${table}${data.length > show.length ? `\n…${data.length - show.length} more rows` : ''}${stats.length ? `\n\nNumeric columns:\n${stats.join('\n')}` : ''}`;
}

const MAX_READ_CHARS = 24_000;
const MAX_OUTPUT_CHARS = 16_000;
const COMMAND_TIMEOUT_MS = 120_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'release', '.venv', '__pycache__', '.next']);

// Thrown when a path needs a folder the user hasn't allowed yet. `folder` is
// the folder to ask about, or null when there's no workspace to resolve a
// relative path against. The agent asks the user and retries.
export class FolderAccessNeeded extends Error {
  constructor(message, folder) {
    super(message);
    this.folder = folder;
  }
}

// Every drive (Windows) or "/" elsewhere: what "Full access" allows.
export function fileSystemRoots() {
  if (process.platform !== 'win32') return ['/'];
  const roots = [];
  for (let c = 65; c <= 90; c++) { const d = `${String.fromCharCode(c)}:\\`; if (fs.existsSync(d)) roots.push(d); }
  return roots;
}

// Operating-system folders the agent may read but never change, whatever the
// access setting: a confused model must not be able to break the computer.
const PROTECTED = process.platform === 'win32'
  ? [process.env.SystemRoot || 'C:\\Windows', process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramData].filter(Boolean)
  : ['/System', '/usr', '/bin', '/sbin', '/etc', '/private/etc', '/Library', '/boot', '/proc', '/sys', '/dev'];
export function isProtectedPath(p) {
  const norm = (x) => (process.platform === 'win32' ? path.resolve(x).toLowerCase() : path.resolve(x));
  const target = norm(p);
  return PROTECTED.some((dir) => { const d = norm(dir); return target === d || target.startsWith(d + path.sep); });
}

// Resolves a tool path inside the workspace or a folder the user allowed
// (`allowed`). Relative paths are relative to the workspace.
export function resolveInside(root, p, allowed = []) {
  const target = p || '.';
  if (!root && !path.isAbsolute(target)) throw new FolderAccessNeeded('No workspace folder is set. Ask the user to choose one in Settings.', null);
  const abs = root ? path.resolve(fs.realpathSync(root), target) : path.resolve(target);
  // Follow symlinks for the deepest existing ancestor so links can't escape.
  let probe = abs;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const existing = fs.realpathSync(probe);
  const real = path.join(existing, path.relative(probe, abs));
  for (const dir of [root, ...allowed]) {
    let base;
    try { base = dir && fs.realpathSync(dir); } catch { continue; }
    if (!base) continue;
    const rel = path.relative(base, real);
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) return real;
  }
  // Ask about the folder itself, or the existing folder that would hold it.
  const folder = probe !== abs || fs.statSync(existing).isDirectory() ? existing : path.dirname(existing);
  throw new FolderAccessNeeded(`Path "${p}" is outside the workspace`, folder);
}

function clip(text, max) {
  return text.length > max ? `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]` : text;
}

function isProbablyBinary(buf) {
  return buf.subarray(0, 8000).includes(0);
}

function walk(dir, depth, out, root, limit = 400) {
  if (out.length >= limit) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  entries.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
  for (const e of entries) {
    if (out.length >= limit) return;
    if (e.isDirectory() && SKIP_DIRS.has(e.name)) continue;
    const full = path.join(dir, e.name);
    out.push(path.relative(root, full).replaceAll('\\', '/') + (e.isDirectory() ? '/' : ''));
    if (e.isDirectory() && depth > 1) walk(full, depth - 1, out, root, limit);
  }
}

export function runCommand(command, cwd, signal) {
  const isWin = process.platform === 'win32';
  return isWin
    ? runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd }, signal)
    : runProcess(process.env.SHELL || '/bin/bash', ['-lc', command], { cwd }, signal);
}

export function runProcess(file, args, options, signal) {
  return new Promise((resolve) => {
    const child = spawn(file, args, { windowsHide: true, ...options });
    let output = '';
    const add = (d) => { output += d.toString(); if (output.length > MAX_OUTPUT_CHARS * 2) output = output.slice(-MAX_OUTPUT_CHARS * 2); };
    child.stdout.on('data', add);
    child.stderr.on('data', add);
    const kill = () => child.kill();
    const timer = setTimeout(() => { output += '\n[timed out after 120s]'; kill(); }, COMMAND_TIMEOUT_MS);
    signal?.addEventListener('abort', kill, { once: true });
    child.on('error', (err) => { clearTimeout(timer); resolve({ exitCode: -1, output: String(err) }); });
    child.on('close', (code) => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', kill);
      resolve({ exitCode: code, output: clip(output.trim(), MAX_OUTPUT_CHARS) || '(no output)' });
    });
  });
}

/**
 * Tool definitions. `params` is a JSON schema (node-llama-cpp treats every
 * property as required, so "optional" values use "" or 0 as their default).
 * `run(args, ctx)` returns a string or JSON-able value for the model.
 */
export const TOOLS = {
  list_files: {
    access: 'read',
    description: 'List files and folders. Use path "." for the workspace root, or a full path for a folder elsewhere. depth 1-4.',
    params: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer' } } },
    run({ path: p, depth }, { workspace, allowed }) {
      const dir = resolveInside(workspace, p, allowed);
      const out = [];
      walk(dir, Math.min(Math.max(depth || 2, 1), 4), out, dir);
      return out.length ? out.join('\n') : '(empty folder)';
    },
  },

  read_file: {
    access: 'read',
    description: 'Read a text file (relative to the workspace, or a full path). startLine is 1-based (use 1 for the start).',
    params: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer' } } },
    run({ path: p, startLine }, { workspace, allowed }) {
      const file = resolveInside(workspace, p, allowed);
      const buf = fs.readFileSync(file);
      if (isProbablyBinary(buf)) return 'This is a binary file and cannot be shown as text.';
      const lines = buf.toString('utf8').split(/\r?\n/);
      const start = Math.max((startLine || 1) - 1, 0);
      const numbered = lines.slice(start).map((l, i) => `${start + i + 1}| ${l}`).join('\n');
      return clip(numbered, MAX_READ_CHARS);
    },
  },

  search_files: {
    access: 'read',
    description: 'Search file contents in the workspace for text (case-insensitive). Use path "." to search everything.',
    params: { type: 'object', properties: { query: { type: 'string' }, path: { type: 'string' } } },
    run({ query, path: p }, { workspace, allowed }) {
      const dir = resolveInside(workspace, p, allowed);
      const needle = String(query).toLowerCase();
      const files = [];
      walk(dir, 12, files, dir, 5000);
      const hits = [];
      for (const rel of files) {
        if (rel.endsWith('/') || hits.length >= 60) continue;
        const full = path.join(dir, rel);
        let buf;
        try { if (fs.statSync(full).size > 2_000_000) continue; buf = fs.readFileSync(full); } catch { continue; }
        if (isProbablyBinary(buf)) continue;
        buf.toString('utf8').split(/\r?\n/).forEach((line, i) => {
          if (hits.length < 60 && line.toLowerCase().includes(needle)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 200)}`);
        });
      }
      return hits.length ? hits.join('\n') : 'No matches.';
    },
  },

  // Long multi-line text inside a JSON argument makes small local models
  // degenerate, so the file body comes from a fenced code block the model writes
  // in its reply just before calling the tool (the "whole file" edit format).
  write_file: {
    access: 'write',
    description: 'Create or overwrite a file. First write the full content in a ``` code block in your reply, then call this with the path; the newest code block is saved.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    prepare(args, { lastCodeBlock, lastCodeLang }) {
      const content = lastCodeBlock?.();
      if (content == null) {
        // Some models (Qwen3.5) call first and write the block after; the
        // agent then waits for the block and saves it when the reply ends.
        const err = new Error(`Nothing saved yet: there is no new \`\`\` code block since your last file write. Next, write the complete content of ${args.path} inside a new \`\`\` fenced code block as normal reply text (not inside a tool call), then call write_file again with path "${args.path}".`);
        err.waitForBlock = true;
        throw err;
      }
      const lang = lastCodeLang?.() || '';
      const ext = path.extname(args.path).toLowerCase();
      const CODE_EXT = ['.js', '.mjs', '.cjs', '.ts', '.py', '.html', '.css', '.java', '.c', '.cpp', '.cs', '.go', '.rs', '.rb', '.php', '.sh', '.ps1'];
      if (lang === 'json' && CODE_EXT.includes(ext)) {
        throw new Error(`Nothing saved: the last code block is JSON, but ${args.path} is a ${ext} file. Write the ${ext} file's own code in a new code block first.`);
      }
      // Catch the common mix-up of saving code into a data file (e.g. a program
      // into todos.json) before it overwrites anything.
      if (/\.json$/i.test(args.path) && content.trim()) {
        try { JSON.parse(content); } catch {
          throw new Error(`Nothing saved: the last code block is not valid JSON, so it can't go in ${args.path}. If it is program code, save it to the right file (e.g. a .js/.mjs file) instead; if it is meant to be JSON, write a code block with valid JSON first.`);
        }
      }
      return { ...args, content };
    },
    run({ path: p, content }, { workspace, allowed }) {
      const file = resolveInside(workspace, p, allowed);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const existed = fs.existsSync(file);
      fs.writeFileSync(file, content ?? '');
      return `${existed ? 'Overwrote' : 'Created'} ${p} (${Buffer.byteLength(content ?? '')} bytes)`;
    },
  },

  edit_file: {
    access: 'write',
    description: 'Replace one exact, unique snippet of text in a workspace file. "find" must match exactly once.',
    params: { type: 'object', properties: { path: { type: 'string' }, find: { type: 'string' }, replace: { type: 'string' } } },
    run({ path: p, find, replace }, { workspace, allowed }) {
      const file = resolveInside(workspace, p, allowed);
      if (!fs.existsSync(file)) throw new Error(`${p} does not exist. Use write_file to create a new file.`);
      const text = fs.readFileSync(file, 'utf8');
      const count = find ? text.split(find).length - 1 : 0;
      if (count === 0) throw new Error('The "find" text was not found. Read the file first and copy the text exactly.');
      if (count > 1) throw new Error(`The "find" text matches ${count} places. Include more surrounding lines so it is unique.`);
      fs.writeFileSync(file, text.replace(find, () => replace ?? ''));
      return `Edited ${p}`;
    },
  },

  run_command: {
    access: 'exec',
    description: `Run a shell command (${process.platform === 'win32' ? 'PowerShell' : 'bash'}) in the workspace and return its output. Times out after 120 seconds. Use subdir "." for the workspace root.`,
    params: { type: 'object', properties: { command: { type: 'string' }, subdir: { type: 'string' } } },
    async run({ command, subdir }, { workspace, allowed, signal }) {
      const cwd = resolveInside(workspace, subdir, allowed);
      const { exitCode, output } = await runCommand(command, cwd, signal);
      return `exit code ${exitCode}\n${output}`;
    },
  },

  search_documents: {
    access: 'read',
    description: 'Search the user\'s imported documents; cite the document name.',
    params: { type: 'object', properties: { query: { type: 'string' } } },
    async run({ query }, { rag }) {
      const hits = await rag.search(query, 6);
      if (!hits.length) return 'No relevant passages found.';
      return hits.map((h, i) => `[${i + 1}] ${h.docName} (part ${h.order + 1}, score ${h.score.toFixed(2)})\n${h.text}`).join('\n\n');
    },
  },

  move_file: {
    access: 'write',
    description: 'Move or rename a file or folder in the workspace (never overwrites).',
    params: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    run({ from, to }, { workspace, allowed }) {
      const src = resolveInside(workspace, from, allowed);
      const dest = resolveInside(workspace, to, allowed);
      if (!fs.existsSync(src)) throw new Error(`${from} does not exist`);
      if (fs.existsSync(dest)) throw new Error(`${to} already exists; choose another name`);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.renameSync(src, dest);
      return `Moved ${from} → ${to}`;
    },
  },

  run_code: {
    access: 'exec',
    description: 'Run a program and return its output (60 s limit). First write it in a ``` code block, then call this. "javascript" always works; "python" only if installed.',
    params: { type: 'object', properties: { language: { enum: ['javascript', 'python'] } } },
    prepare(args, { lastCodeBlock }) {
      const code = lastCodeBlock?.();
      if (code == null) throw new Error('No code block found. Write the program in a fenced code block first, then call run_code again.');
      return { ...args, code };
    },
    async run({ language, code }, { workspace, allowed, signal }) {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-run-'));
      const cwd = workspace ? resolveInside(workspace, '.') : dir;
      try {
        let result;
        if (language === 'python') {
          const py = findPython();
          if (!py) return 'Python is not installed on this computer. Rewrite the program in JavaScript and run it with language "javascript".';
          const file = path.join(dir, 'main.py');
          fs.writeFileSync(file, code);
          result = await runProcess(py[0], [...py[1], file], { cwd, env: { ...process.env, PYTHONIOENCODING: 'utf-8' } }, signal);
        } else {
          const file = path.join(dir, 'main.mjs');
          fs.writeFileSync(file, code);
          // Electron's own binary doubles as Node.js, so JavaScript always runs offline.
          result = await runProcess(process.execPath, [file], { cwd, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } }, signal);
        }
        return `exit code ${result.exitCode}\n${result.output}`;
      } finally {
        fs.rmSync(dir, { recursive: true, force: true });
      }
    },
  },

  // Online mode only (see agent.js): nothing here runs while Scorpion is offline.
  web_search: {
    access: 'web',
    description: 'Search the internet for current information. Returns titles, links and snippets; read the best page with read_webpage.',
    params: { type: 'object', properties: { query: { type: 'string' } } },
    async run({ query }) {
      const results = await webSearch(String(query || '').slice(0, 300));
      if (!results.length) return 'No results.';
      return `${UNTRUSTED}\n\n${results.map((r, i) => `[${i + 1}] ${r.title}\n${r.url}\n${r.snippet}`).join('\n\n')}`;
    },
  },

  read_webpage: {
    access: 'web',
    description: 'Read the text of a web page (http/https link). Cite the link when you use it.',
    params: { type: 'object', properties: { url: { type: 'string' } } },
    async run({ url }) {
      const page = await readWebpage(String(url || '').trim());
      return `${UNTRUSTED}\n\n${page.title ? `${page.title}\n` : ''}${page.url}\n\n${page.text || '(no readable text)'}`;
    },
  },

  // Face recognition (offered only once it is installed; see agent.js).
  find_faces: {
    access: 'read',
    requires: 'faces',
    description: 'Find faces in a photo, or in every photo of a folder, and say which enrolled people they are, plus face quality.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p }, { workspace, allowed }) {
      const target = resolveInside(workspace, p, allowed);
      const files = fs.statSync(target).isDirectory() ? listImages(target, { recursive: false, limit: 200 }) : [target];
      if (!files.length) return 'No photos found there.';
      const lines = [];
      for (const file of files) {
        let found;
        try { found = await analyzeFile(file); } catch (err) { lines.push(`${path.basename(file)}: can't be read (${err.message})`); continue; }
        const who = found.map((f) => (f.person ? `${f.person.name} (${Math.round(f.person.similarity * 100)}% match)` : 'unknown person') + (f.quality.ok ? '' : ` [${f.quality.issues.join(', ')}]`));
        lines.push(`${path.basename(file)}: ${found.length ? `${found.length} face(s): ${who.join('; ')}` : 'no faces'}`);
      }
      return clip(lines.join('\n'), MAX_READ_CHARS);
    },
  },

  // From DeepFace: what each face shows (age, gender, expression) and whether
  // it is a real face or a photo of one; and 1:1 verification of two photos.
  analyze_faces: {
    access: 'read',
    requires: 'faces',
    description: 'Describe the faces in a photo (or every photo in a folder): who they are if known, apparent age, gender, facial expression, and whether it is a real face or a photo/screen of one.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p }, { workspace, allowed }) {
      const target = resolveInside(workspace, p, allowed);
      const files = fs.statSync(target).isDirectory() ? listImages(target, { recursive: false, limit: 50 }) : [target];
      if (!files.length) return 'No photos found there.';
      const st = insightsStatus();
      const lines = [];
      for (const file of files) {
        let img, found;
        try { img = await decodeFile(file); found = await describeFaces(img, await analyzeImage(img)); } catch (err) { lines.push(`${path.basename(file)}: can't be read (${err.message})`); continue; }
        const about = found.map((f) => [
          f.person ? `${f.person.name} (${Math.round(f.person.similarity * 100)}% match)` : 'unknown person',
          f.gender && `${f.gender.label.toLowerCase()} (${Math.round(f.gender.score * 100)}%)`,
          f.age != null && `looks about ${f.age}`,
          f.expression && `${f.expression.label} (${Math.round(f.expression.score * 100)}%)`,
          f.liveness && (f.liveness.real ? 'real face' : 'looks like a photo or screen, not a real face'),
        ].filter(Boolean).join(', '));
        lines.push(`${path.basename(file)}: ${found.length ? `${found.length} face(s): ${about.join('; ')}` : 'no faces'}`);
      }
      const missing = [!st.insights.installed && 'expressions and liveness', !st.demography.installed && 'age and gender'].filter(Boolean);
      return clip(lines.join('\n'), MAX_READ_CHARS) + (missing.length ? `\n(Not installed: ${missing.join(', ')}. The user can add them in Settings → People → Face insights.)` : '') + '\nAge and gender are estimates from appearance only.';
    },
  },

  compare_faces: {
    access: 'read',
    requires: 'faces',
    description: 'Check whether two photos show the same person (face verification). Compares the largest face in each.',
    params: { type: 'object', properties: { path_a: { type: 'string' }, path_b: { type: 'string' } } },
    async run({ path_a: a, path_b: b }, { workspace, allowed }) {
      const faceOf = async (p) => {
        const found = await analyzeFile(resolveInside(workspace, p, allowed));
        return found.sort((x, y) => y.box[2] * y.box[3] - x.box[2] * x.box[3])[0] || null;
      };
      const [fa, fb] = [await faceOf(a), await faceOf(b)];
      if (!fa || !fb) return `No face found in ${!fa ? a : b}.`;
      const sim = cosine(fa.print, fb.print);
      const same = sim >= SAME_PERSON;
      const sure = Math.abs(sim - SAME_PERSON) > 0.15 ? 'clearly' : 'probably';
      const warn = [fa, fb].filter((f) => !f.quality.ok).length ? ' (one of the faces is low quality, so treat this with care)' : '';
      return `${same ? `Same person: ${sure} yes` : `Different people: ${sure}`} (similarity ${sim.toFixed(2)}; the same-person threshold is ${SAME_PERSON}).${warn}`;
    },
  },

  group_photos_by_person: {
    access: 'read',
    requires: 'faces',
    description: 'Group the photos in a folder (and its subfolders) by the people in them: enrolled people by name, others as "Unknown person N". Use move_file afterwards if the user wants them sorted into folders.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p }, { workspace, allowed }) {
      const folder = resolveInside(workspace, p, allowed);
      const r = await groupPhotos(folder);
      if (!r.scanned) return 'No photos found in that folder.';
      const rel = (f) => path.relative(folder, f).replaceAll('\\', '/');
      const groups = r.groups.map((g) => `${g.name} (${g.photos.length} photo${g.photos.length === 1 ? '' : 's'}):\n${g.photos.slice(0, 60).map((f) => `  ${rel(f)}`).join('\n')}`);
      return clip(`Scanned ${r.scanned} photo(s); ${r.withoutFaces} had no faces.\n\n${groups.join('\n\n') || 'No faces found.'}`, MAX_READ_CHARS);
    },
  },

  photos_of_person: {
    access: 'read',
    requires: 'faces',
    description: 'List the photos in a folder (and subfolders) that show a given enrolled person.',
    params: { type: 'object', properties: { name: { type: 'string' }, path: { type: 'string' } } },
    async run({ name, path: p }, { workspace, allowed }) {
      const folder = resolveInside(workspace, p, allowed);
      const r = await groupPhotos(folder);
      const want = String(name || '').trim().toLowerCase();
      const g = r.groups.find((x) => !x.unknown && x.name.toLowerCase() === want);
      if (!g) return `No photos of ${name} found in ${r.scanned} photo(s). Is ${name} enrolled in Settings → People?`;
      return clip(`${g.photos.length} photo(s) of ${g.name}:\n${g.photos.map((f) => path.relative(folder, f).replaceAll('\\', '/')).join('\n')}`, MAX_READ_CHARS);
    },
  },

  // The media library (Library view): photos, videos and music already tagged.
  search_library: {
    access: 'read',
    requires: 'library',
    description: 'Search the user\'s photo, video and music library by tag (dog, beach, Eiffel Tower, Haiti, Jazz, dancing, a person\'s name) or by description ("kids playing in the snow"). kind: "photo", "video", "music" or "" for all.',
    params: { type: 'object', properties: { query: { type: 'string' }, kind: { enum: ['', 'photo', 'video', 'music'] } } },
    async run({ query, kind }) {
      const found = await searchLibrary({ query: String(query || ''), kind: kind || null, limit: 40 });
      if (!found.length) return `Nothing in the library matches "${query}".`;
      return clip(found.map((r) => `${r.path}\n  ${r.kind}${r.tags.length ? ': ' + r.tags.map((t) => t.label).join(', ') : ''}`).join('\n'), MAX_READ_CHARS);
    },
  },

  tag_media: {
    access: 'read',
    requires: 'media',
    description: 'Recognize what is in any photo, video or song (objects, landmarks, place, people, actions, music genre), even if it is not in the library.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p }, { workspace, allowed }) {
      const info = await tagFile(resolveInside(workspace, p, allowed));
      const byCat = {};
      for (const t of info.tags) (byCat[t.cat] ||= []).push(`${t.label}${t.score < 1 ? ` (${Math.round(t.score * 100)}%)` : ''}`);
      return [`${info.name} (${info.kind}${info.duration ? `, ${Math.round(info.duration)} s` : ''}${info.faces ? `, ${info.faces} face(s)` : ''})`, ...Object.entries(byCat).map(([c, l]) => `${c}: ${l.join(', ')}`)].join('\n') + (info.tags.length ? '' : '\nNothing recognized.');
    },
  },

  library_tags: {
    access: 'read',
    requires: 'library',
    description: 'What the library knows about one photo, video or song: its tags (objects, landmarks, place, people, actions, genres).',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    run({ path: p }) {
      const info = itemInfo(String(p || ''));
      if (!info) return 'That file is not in the library (add its folder in Library → Settings).';
      const byCat = {};
      for (const t of info.tags) (byCat[t.cat] ||= []).push(t.label);
      return [`${info.name} (${info.kind}${info.duration ? `, ${Math.round(info.duration)} s` : ''})`, ...Object.entries(byCat).map(([c, l]) => `${c}: ${l.join(', ')}`), info.error ? `Note: ${info.error}` : ''].filter(Boolean).join('\n');
    },
  },

  calculator: {
    access: 'read',
    description: 'Exact math, e.g. "(1250*0.07)/12" or "sqrt(2)^3". Use it instead of mental arithmetic.',
    params: { type: 'object', properties: { expression: { type: 'string' } } },
    run({ expression }) {
      const v = evaluate(expression);
      if (!Number.isFinite(v)) return `${expression} = ${v} (not a finite number)`;
      return `${expression} = ${+v.toPrecision(15)}`;
    },
  },

  read_spreadsheet: {
    access: 'read',
    description: 'Summarize a .xlsx/.csv/.tsv in the workspace: columns, first 30 rows, numeric totals. sheet "" = first sheet.',
    params: { type: 'object', properties: { path: { type: 'string' }, sheet: { type: 'string' } } },
    async run({ path: p, sheet }, { workspace, allowed }) {
      const file = resolveInside(workspace, p, allowed);
      const { sheets, sheet: used, rows } = await readSheetRows(file, sheet);
      const head = sheets.length > 1 ? `Sheets: ${sheets.join(', ')} (showing "${used}")\n` : '';
      return clip(head + summarizeTable(rows), MAX_READ_CHARS);
    },
  },

  read_document: {
    access: 'read',
    description: 'Read the text of a PDF, Word (.docx) or text document in the workspace.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p }, { workspace, allowed }) {
      const text = await extractText(resolveInside(workspace, p, allowed));
      return clip(text.trim() || '(no text found — scanned PDFs need OCR)', MAX_READ_CHARS);
    },
  },

  remember: {
    access: 'memory',
    description: 'Save lasting facts about the user for future chats. One short full-sentence fact per item, e.g. ["The user is called Ana."]. Never secrets.',
    params: { type: 'object', properties: { facts: { type: 'array', items: { type: 'string' } } } },
    run({ facts }, { memory, onMemory }) {
      const out = [];
      for (const fact of [].concat(facts || [])) {
        if (/\b(password|passcode|api[ _-]?key|secret|token|pin)\b/i.test(fact)) {
          out.push(`Not saved (looks like a secret, tell the user secrets are not stored): ${fact}`);
          continue;
        }
        const { memory: m, duplicate } = memory.addMemory(fact, 'agent');
        out.push(duplicate ? `Already remembered: ${m.text}` : `Remembered: ${m.text}`);
      }
      onMemory?.();
      return out.join('\n') || 'Nothing to remember.';
    },
  },

  forget: {
    access: 'memory',
    description: 'Remove a saved memory (pass its text) when asked to forget, or when a fact changed.',
    params: { type: 'object', properties: { memory: { type: 'string' } } },
    run({ memory: query }, { memory, onMemory }) {
      const removed = memory.forgetMemory(query);
      onMemory?.();
      return removed ? `Forgot: ${removed.text}` : 'No matching memory found. Nothing was removed.';
    },
  },

  search_past_chats: {
    access: 'read',
    description: 'Search earlier conversations by keywords. Use it whenever the user refers to something said before; never guess what was said.',
    params: { type: 'object', properties: { query: { type: 'string' } } },
    run({ query }, { memory, threadId }) {
      const hits = memory.searchConversations(query, { k: 6, excludeThreadId: threadId });
      if (!hits.length) return 'No earlier conversations matched.';
      return hits.map((h, i) => `[${i + 1}] chat "${h.title}" (${new Date(h.at).toLocaleDateString()}) — ${h.role === 'user' ? 'user' : 'Scorpion'}:\n${h.text}`).join('\n\n');
    },
  },

  standing_intent: {
    access: 'memory',
    description: 'Remember to do something later WHEN a topic comes up (not at a time): "when X comes up, remind me / ask about Y". action add (with when, then, once), list, or cancel (with when or id).',
    params: {
      type: 'object',
      properties: {
        action: { enum: ['add', 'list', 'cancel'] },
        when: { type: 'string', description: 'the words or topic that trigger it' },
        then: { type: 'string', description: 'what to do or say then' },
        once: { type: 'boolean' },
        id: { type: 'string' },
      },
    },
    run({ action = 'add', when, then, once, id }, { memory, onMemory }) {
      if (action === 'list') {
        const list = memory.listIntents();
        return list.length ? list.map((i) => `- [${i.id}] when "${i.trigger}": ${i.action}${i.once ? ' (once)' : ''}`).join('\n') : 'No standing intents.';
      }
      if (action === 'cancel') {
        const gone = memory.cancelIntent(id || when || '');
        onMemory?.();
        return gone ? `Cancelled: when "${gone.trigger}": ${gone.action}` : 'No matching standing intent.';
      }
      const i = memory.addIntent({ when, then, once });
      onMemory?.();
      return `Saved. When "${i.trigger}" comes up, I will: ${i.action}${i.once ? ' (once)' : ''}.`;
    },
  },

  // ---------- Windows: apps, windows, files, Settings, system ----------
  list_apps: {
    access: 'system', requires: 'windows', noWorkspace: true,
    description: process.platform === 'linux' ? 'List the apps installed on this computer. Optional filter by name.' : 'List the apps installed on this Windows PC (desktop programs and Store apps). Optional filter by name.',
    params: { type: 'object', properties: { filter: { type: 'string' } } },
    async run({ filter }) {
      const apps = await win.listApps();
      const list = filter ? win.matchByName(filter, apps).best ? [win.matchByName(filter, apps).best, ...win.matchByName(filter, apps).others] : [] : apps;
      return list.length ? `${list.length} app(s):\n${list.map((a) => a.name).sort((a, b) => a.localeCompare(b)).join('\n')}` : `No installed app matches "${filter}".`;
    },
  },
  open_app: {
    access: 'system', requires: 'windows', noWorkspace: true,
    description: 'Open an installed app by name (e.g. "calculator", "word", "spotify", "file explorer").',
    params: { type: 'object', properties: { name: { type: 'string' } } },
    describeAction: ({ name }) => `open ${name}`,
    async run({ name }) {
      const r = await win.openApp(name);
      return `Opened ${r.opened}.${r.others.length ? ` (Other matches: ${r.others.join(', ')}.)` : ''}`;
    },
  },
  list_windows: {
    access: 'system', requires: 'windows', noWorkspace: true,
    description: 'List the windows that are open right now (title and program).',
    params: { type: 'object', properties: {} },
    async run() {
      const wins = await win.listWindows();
      return wins.length ? wins.map((w) => `${w.title} (${w.process})`).join('\n') : 'No open windows.';
    },
  },
  switch_window: {
    access: 'system', requires: 'windows', noWorkspace: true,
    description: 'Bring an open window to the front, or minimize, maximize or restore it, by part of its title or program name.',
    params: { type: 'object', properties: { window: { type: 'string' }, action: { enum: ['focus', 'minimize', 'maximize', 'restore'] } } },
    describeAction: ({ window: w, action = 'focus' }) => `${action} ${w}`,
    async run({ window: w, action = 'focus' }) {
      const done = await win.windowAction(w, action);
      return `${action === 'focus' ? 'Brought to the front' : `${action[0].toUpperCase()}${action.slice(1)}d`}: ${done.title}.`;
    },
  },
  close_app: {
    access: 'system', requires: 'windows', noWorkspace: true, changes: true,
    approve: () => true, // unsaved work could be lost
    describeAction: ({ window: w }) => `close ${w}`,
    description: 'Close an open app window by part of its title or program name (like clicking its X; it may ask to save).',
    params: { type: 'object', properties: { window: { type: 'string' } } },
    async run({ window: w }) {
      const r = await win.closeApp(w);
      return r.asked ? `Asked ${r.title} to close.` : `${r.title} has no window that can be closed this way.`;
    },
  },
  open_path: {
    access: 'system', requires: 'windows',
    // Opening a program or script runs it, so that asks first.
    approve: ({ path: p }) => win.isRunnable(p),
    describeAction: ({ path: p, reveal }) => (reveal ? `show ${p} in File Explorer` : `open ${p}`),
    description: 'Open a file in its default app, or a folder in File Explorer. reveal true shows the file selected in its folder instead.',
    params: { type: 'object', properties: { path: { type: 'string' }, reveal: { type: 'boolean' } } },
    async run({ path: p, reveal }, { workspace, allowed }) {
      const target = resolveInside(workspace, p, allowed);
      await win.openPath(target, { reveal: Boolean(reveal) });
      return `${reveal ? 'Showing' : 'Opened'} ${target}.`;
    },
  },
  recycle_path: {
    access: 'system', requires: 'windows', changes: true,
    approve: () => true,
    describeAction: ({ path: p }) => `move ${p} to the Recycle Bin`,
    description: 'Delete a file or folder by moving it to the Recycle Bin (the user can restore it).',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    async run({ path: p }, { workspace, allowed }) {
      const target = resolveInside(workspace, p, allowed);
      const r = await win.recyclePath(target);
      return `Moved ${r.folder ? 'folder' : 'file'} ${target} to the Recycle Bin.`;
    },
  },
  copy_path: {
    access: 'system', requires: 'windows', changes: true,
    approve: () => true,
    describeAction: ({ from, to }) => `copy ${from} to ${to}`,
    description: 'Copy a file or a whole folder to another place (never overwrites).',
    params: { type: 'object', properties: { from: { type: 'string' }, to: { type: 'string' } } },
    async run({ from, to }, { workspace, allowed }) {
      const dest = win.copyPath(resolveInside(workspace, from, allowed), resolveInside(workspace, to, allowed));
      return `Copied to ${dest}.`;
    },
  },
  windows_settings: {
    access: 'system', requires: 'windows', noWorkspace: true,
    description: `Open a page of ${process.platform === 'linux' ? 'the settings' : 'Windows Settings'}. Pages: ${Object.keys(win.SETTINGS_PAGES).join(', ')}.`,
    params: { type: 'object', properties: { page: { type: 'string' } } },
    describeAction: ({ page }) => `open Settings: ${page}`,
    async run({ page }) {
      const opened = await win.openSettings(page);
      return `Opened ${process.platform === 'linux' ? 'settings' : 'Windows Settings'}${opened ? ` (${opened})` : ''}.`;
    },
  },
  system_control: {
    access: 'system', requires: 'windows', noWorkspace: true, changes: true,
    // Restart, shut down and emptying the Recycle Bin always ask, even with Auto-approve.
    approve: ({ action }) => { const r = win.actionRisk(action); return r === 'always' ? 'always' : r === 'ask'; },
    describeAction: ({ action, amount }) => `${String(action).replace(/_/g, ' ')}${amount != null ? ` ${amount}` : ''}`,
    description: `Control this PC: ${win.ACTIONS.join(', ')}. amount: percent for volume and brightness. Restart and shutdown wait 30 seconds and can be cancelled with cancel_shutdown.`,
    params: { type: 'object', properties: { action: { enum: win.ACTIONS }, amount: { type: 'number' } } },
    run: ({ action, amount }) => win.systemControl(action, amount),
  },
  system_info: {
    access: 'system', requires: 'windows', noWorkspace: true,
    description: 'Facts about this PC right now: operating system version, uptime, CPU and load, memory, disk space, battery, network addresses, and the apps using the most memory.',
    params: { type: 'object', properties: {} },
    async run() {
      const i = await win.systemInfo();
      return [`System: ${i.os}, on for ${i.uptimeHours} h`, `CPU: ${i.cpu}, ${i.cpuLoad ?? '?'}% busy`, `Memory: ${i.ramFreeGB} GB free of ${i.ramGB} GB`, `Disks: ${[].concat(i.disks).join('; ')}`, `Battery: ${i.battery}`, `Network: ${[].concat(i.network).join('; ') || 'not connected'}`, `Using the most memory: ${[].concat(i.topApps).join(', ')}`].join('\n');
    },
  },

  // ---------- Linux (Scorpion OS): Wi-Fi, Bluetooth, apps, troubleshooting, drivers ----------
  wifi: {
    access: 'system', requires: 'linux', noWorkspace: true, changes: true,
    approve: ({ action }) => action === 'connect' || action === 'off',
    // Never the password: it goes to NetworkManager only.
    describeAction: ({ action, network }) => (action === 'connect' ? `join the Wi-Fi network ${network}` : `Wi-Fi: ${action}`),
    description: 'Wi-Fi: list the networks in range (list), join one (connect, with network and, if it has one, password), disconnect, or turn Wi-Fi on or off.',
    params: { type: 'object', properties: { action: { enum: ['list', 'connect', 'disconnect', 'on', 'off'] }, network: { type: 'string' }, password: { type: 'string' } } },
    async run({ action = 'list', network, password }) {
      if (action === 'list') {
        const nets = await win.wifiList();
        return nets.length ? nets.map((n) => `${n.connected ? '* ' : ''}${n.ssid} (signal ${n.signal}%, ${n.secure ? n.security : 'open'})`).join('\n') : 'No Wi-Fi networks in range (or Wi-Fi is off).';
      }
      if (action === 'connect') return win.wifiConnect(network, password);
      if (action === 'disconnect') return win.wifiDisconnect();
      return win.wifiRadio(action === 'on');
    },
  },
  bluetooth: {
    access: 'system', requires: 'linux', noWorkspace: true, changes: true,
    approve: ({ action }) => action === 'connect',
    describeAction: ({ action, device }) => `Bluetooth: ${action}${device ? ` ${device}` : ''}`,
    description: 'Bluetooth: list known devices (list), look for new ones nearby for 10 seconds (scan), pair and connect one by name or address (connect; the device must be in pairing mode), disconnect one, or turn Bluetooth on or off.',
    params: { type: 'object', properties: { action: { enum: ['list', 'scan', 'connect', 'disconnect', 'on', 'off'] }, device: { type: 'string' } } },
    async run({ action = 'list', device }) {
      if (action === 'list' || action === 'scan') {
        const list = await win.bluetoothList({ scan: action === 'scan' });
        return list.length ? list.map((d) => `${d.name} (${d.mac})${d.connected ? ', connected' : d.paired ? ', paired' : ''}`).join('\n') : 'No Bluetooth devices found. Put the device in pairing mode and scan again.';
      }
      if (action === 'connect') return win.bluetoothConnect(device);
      if (action === 'disconnect') return win.bluetoothDisconnect(device);
      return win.bluetoothPower(action === 'on');
    },
  },
  find_apps: {
    access: 'system', requires: 'linux', noWorkspace: true,
    description: 'Search the apps that can be installed: Flathub (most desktop apps, e.g. Spotify, Discord, GIMP) and Ubuntu\'s packages. Returns source and id for install_app.',
    params: { type: 'object', properties: { query: { type: 'string' } } },
    async run({ query }) {
      const found = await win.findApps(query);
      return found.length ? found.map((a) => `[${a.source}] ${a.name} (id: ${a.id}): ${a.description}`).join('\n') : `Nothing called "${query}" to install.`;
    },
  },
  install_app: {
    access: 'system', requires: 'linux', noWorkspace: true, changes: true,
    approve: () => 'always',
    describeAction: ({ source, id }) => `install ${id} from ${source === 'flathub' ? 'Flathub' : 'Ubuntu'}`,
    description: 'Install an app found with find_apps (source: flathub or apt, and its id). Ubuntu packages ask for the password. A snapshot is taken first where the system supports it.',
    params: { type: 'object', properties: { source: { enum: ['flathub', 'apt'] }, id: { type: 'string' } } },
    async run({ source, id }) {
      await win.snapshot(`before installing ${id}`);
      return win.installApp({ source, id });
    },
  },
  remove_app: {
    access: 'system', requires: 'linux', noWorkspace: true, changes: true,
    approve: () => 'always',
    describeAction: ({ id }) => `remove ${id}`,
    description: 'Uninstall an app (source: flathub or apt, and its id).',
    params: { type: 'object', properties: { source: { enum: ['flathub', 'apt'] }, id: { type: 'string' } } },
    async run({ source, id }) {
      await win.snapshot(`before removing ${id}`);
      return win.removeApp({ source, id });
    },
  },
  diagnose: {
    access: 'system', requires: 'linux', noWorkspace: true,
    description: `Look into a problem with this computer (nothing is changed): ${win.DIAGNOSE_TOPICS?.join(', ')}. Returns the state of the parts involved and their recent warnings; explain the cause in plain words and offer the fix.`,
    params: { type: 'object', properties: { topic: { enum: win.DIAGNOSE_TOPICS || ['general'] } } },
    run: ({ topic }) => win.diagnose(topic),
  },
  drivers: {
    access: 'system', requires: 'linux', noWorkspace: true, changes: true,
    approve: ({ action }) => (action === 'install' ? 'always' : false),
    describeAction: ({ action }) => (action === 'install' ? 'install the recommended drivers (then restart)' : 'check the drivers'),
    description: 'Drivers: list what this computer\'s hardware could use (list; e.g. NVIDIA\'s own driver), or install the recommended ones (install; needs the internet and a restart).',
    params: { type: 'object', properties: { action: { enum: ['list', 'install'] } } },
    async run({ action = 'list' }) {
      if (action !== 'install') return win.driverSuggestions();
      await win.snapshot('before installing drivers');
      return win.installDrivers();
    },
  },
  snapshots: {
    access: 'system', requires: 'linux', noWorkspace: true, changes: true,
    approve: ({ action }) => (action === 'undo' ? 'always' : false),
    describeAction: ({ action, id }) => (action === 'undo' ? `roll the computer back to snapshot ${id}` : 'list the snapshots'),
    description: 'Snapshots of the system (taken before installs and system changes): list them, or undo: roll the whole system back to one (applied at the next restart; files in the home folder stay).',
    params: { type: 'object', properties: { action: { enum: ['list', 'undo'] }, id: { type: 'string' } } },
    run: ({ action = 'list', id }) => (action === 'undo' ? win.undoSnapshot(id) : win.snapshots()),
  },

  use_skill: {
    access: 'skill',
    description: 'Read the full instructions of one of your skills (listed under SKILLS) before doing a task it covers.',
    params: { type: 'object', properties: { name: { type: 'string' } } },
    run({ name }) {
      const s = getSkill(name);
      if (!s) return `No skill called "${name}". Available: ${listSkills().filter((x) => x.enabled).map((x) => x.name).join(', ') || 'none'}.`;
      return `Skill "${s.name}": ${s.description}\n\n${s.body}${s.truncated ? '\n…[cut]' : ''}${s.files.length ? `\n\nFiles in this skill (folder ${s.dir}; read them with read_file and the full path):\n${s.files.map((f) => `- ${f}`).join('\n')}` : ''}`;
    },
  },

  save_skill: {
    access: 'write',
    description: 'Create or improve one of your skills: a reusable step-by-step guide for a kind of task, so you do it the same good way next time. Use when the user teaches you a procedure or asks you to make a skill.',
    params: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'short-dashed-name' },
        description: { type: 'string', description: 'One sentence: what it does and when to use it' },
        instructions: { type: 'string', description: 'Markdown steps' },
      },
    },
    run({ name, description, instructions }) {
      const existed = Boolean(getSkill(name));
      const s = saveSkill({ name, description, body: instructions });
      return `${existed ? 'Updated' : 'Created'} skill "${s.name}". The user can view, edit or undo it in Settings → Skills.`;
    },
  },

  update_plan: {
    access: 'plan',
    description: 'Create or update your step plan. Send the whole list each time; status is pending, in_progress or done.',
    params: {
      type: 'object',
      properties: {
        steps: {
          type: 'array',
          items: {
            type: 'object',
            properties: { title: { type: 'string' }, status: { enum: ['pending', 'in_progress', 'done'] } },
          },
        },
      },
    },
    run({ steps }, { onPlan, mode }) {
      // In Plan mode nothing gets built, so a plan is only a proposal: never
      // let the model mark steps done there (Build mode would then skip them).
      if (mode === 'plan') {
        const proposal = steps.map((s) => ({ ...s, status: 'pending' }));
        onPlan?.(proposal);
        return 'Plan saved as a proposal. Nothing has been built yet and you cannot build in Plan mode. Now explain the plan to the user in a few lines.';
      }
      onPlan?.(steps);
      const next = steps.find((s) => s.status !== 'done');
      return next ? `Plan saved. Continue with: ${next.title}` : 'Plan saved. All steps are done — give the user a short summary.';
    },
  },
};
