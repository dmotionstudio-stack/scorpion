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
import { analyzeFile, groupPhotos, listImages } from './faces.js';

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
      if (content == null) throw new Error(`Nothing saved yet: there is no new \`\`\` code block since your last file write. Next, write the complete content of ${args.path} inside a new \`\`\` fenced code block as normal reply text (not inside a tool call), then call write_file again with path "${args.path}".`);
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
