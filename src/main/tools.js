// Agent tools. Every tool is tagged with an access level:
//   read  — runs freely
//   write — changes files; needs approval unless auto-approve is on
//   exec  — runs a shell command; needs approval unless auto-approve is on
// All file paths are resolved inside the workspace folder and escapes are refused.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const MAX_READ_CHARS = 24_000;
const MAX_OUTPUT_CHARS = 16_000;
const COMMAND_TIMEOUT_MS = 120_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'release', '.venv', '__pycache__', '.next']);

export function resolveInside(root, p) {
  if (!root) throw new Error('No workspace folder is set. Ask the user to choose one in Settings.');
  const base = fs.realpathSync(root);
  const abs = path.resolve(base, p || '.');
  // Follow symlinks for the deepest existing ancestor so links can't escape.
  let probe = abs;
  while (!fs.existsSync(probe) && path.dirname(probe) !== probe) probe = path.dirname(probe);
  const real = path.join(fs.realpathSync(probe), path.relative(probe, abs));
  const rel = path.relative(base, real);
  if (rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path "${p}" is outside the workspace`);
  return real;
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
  return new Promise((resolve) => {
    const isWin = process.platform === 'win32';
    const child = isWin
      ? spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { cwd, windowsHide: true })
      : spawn(process.env.SHELL || '/bin/bash', ['-lc', command], { cwd });
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
    description: 'List files and folders in the workspace. Use path "." for the workspace root. depth 1-4.',
    params: { type: 'object', properties: { path: { type: 'string' }, depth: { type: 'integer' } } },
    run({ path: p, depth }, { workspace }) {
      const dir = resolveInside(workspace, p);
      const out = [];
      walk(dir, Math.min(Math.max(depth || 2, 1), 4), out, dir);
      return out.length ? out.join('\n') : '(empty folder)';
    },
  },

  read_file: {
    access: 'read',
    description: 'Read a text file from the workspace. startLine is 1-based (use 1 for the start).',
    params: { type: 'object', properties: { path: { type: 'string' }, startLine: { type: 'integer' } } },
    run({ path: p, startLine }, { workspace }) {
      const file = resolveInside(workspace, p);
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
    run({ query, path: p }, { workspace }) {
      const dir = resolveInside(workspace, p);
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
    description: 'Create or overwrite a file. FIRST write the complete file content in a fenced code block (```lang ... ```) in your reply, THEN call write_file with the path. The last code block you wrote is saved.',
    params: { type: 'object', properties: { path: { type: 'string' } } },
    prepare(args, { lastCodeBlock }) {
      const content = lastCodeBlock?.();
      if (content == null) throw new Error('No code block found. Write the full file content in a fenced code block first, then call write_file again.');
      return { ...args, content };
    },
    run({ path: p, content }, { workspace }) {
      const file = resolveInside(workspace, p);
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
    run({ path: p, find, replace }, { workspace }) {
      const file = resolveInside(workspace, p);
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
    async run({ command, subdir }, { workspace, signal }) {
      const cwd = resolveInside(workspace, subdir);
      const { exitCode, output } = await runCommand(command, cwd, signal);
      return `exit code ${exitCode}\n${output}`;
    },
  },

  search_documents: {
    access: 'read',
    description: 'Search the user\'s imported documents (PDF, Word, text) for passages relevant to a question. Cite the document name in your answer.',
    params: { type: 'object', properties: { query: { type: 'string' } } },
    async run({ query }, { rag }) {
      const hits = await rag.search(query, 6);
      if (!hits.length) return 'No relevant passages found.';
      return hits.map((h, i) => `[${i + 1}] ${h.docName} (part ${h.order + 1}, score ${h.score.toFixed(2)})\n${h.text}`).join('\n\n');
    },
  },

  update_plan: {
    access: 'plan',
    description: 'Create or update your step-by-step plan for a multi-step task. Send the whole list every time; mark each step "pending", "in_progress" or "done". Keep exactly one step in_progress while working.',
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
    run({ steps }, { onPlan }) {
      onPlan?.(steps);
      const next = steps.find((s) => s.status !== 'done');
      return next ? `Plan saved. Continue with: ${next.title}` : 'Plan saved. All steps are done — give the user a short summary.';
    },
  },
};
