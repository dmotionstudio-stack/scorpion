import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findFiles, binaryAnswer, resolveInside, TOOLS } from '../src/main/tools.js';
import { buildFunctions, buildSystemPrompt, ORB_TOOLS } from '../src/main/agent.js';

const tree = () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'finder-'));
  fs.mkdirSync(path.join(root, 'Downloads', 'deep'), { recursive: true });
  fs.mkdirSync(path.join(root, 'Pictures'));
  fs.mkdirSync(path.join(root, 'node_modules', 'x'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Downloads', 'Tax Return 2025.pdf'), 'x'.repeat(3000));
  fs.writeFileSync(path.join(root, 'Downloads', 'deep', 'tax notes.txt'), 'notes');
  fs.writeFileSync(path.join(root, 'Pictures', 'beach.jpg'), 'jpg');
  fs.writeFileSync(path.join(root, 'node_modules', 'x', 'tax.js'), 'skipped');
  return root;
};

test('finding files by name: a word, a pattern, folders, and never inside node_modules', () => {
  const root = tree();
  const word = findFiles(root, 'tax');
  assert.match(word, /2 match/);
  assert.match(word, /Tax Return 2025\.pdf/);
  assert.match(word, /tax notes\.txt/);
  assert.ok(!/node_modules/.test(word), 'dependencies are skipped');
  assert.match(findFiles(root, '*.jpg'), /beach\.jpg/);
  assert.match(findFiles(root, 'Tax*2025*'), /Tax Return 2025\.pdf/);
  assert.match(findFiles(root, 'pict', 'folder'), /Pictures/);
  assert.match(findFiles(root, 'zzzz'), /Nothing named like "zzzz"/);
  assert.throws(() => findFiles(root, ''), /Say what to look for/);
});

test('"~" is the home folder, and a file that is not text says what it is and what to do', () => {
  assert.equal(resolveInside(null, '~/Downloads', [os.homedir()]), path.join(os.homedir(), 'Downloads'));
  assert.match(binaryAnswer('/x/report.pdf', 4000), /document file.*read_document/);
  assert.match(binaryAnswer('/x/photo.HEIC', 2_000_000), /image file.*open_path/);
  assert.match(binaryAnswer('/x/song.mp3', 5000), /audio file/);
  assert.match(binaryAnswer('/x/blob', 10), /binary file/);
  assert.ok(typeof TOOLS.find_files.run === 'function');
});

const toolsFor = (settings, extra = {}) => Object.keys(buildFunctions({ settings, agent: null, rag: { hasDocuments: () => false }, emit() {}, streamedText: () => '', requestApproval: async () => true, requestFolderAccess: async () => null, windowsReady: true, ...extra }));

test('chat looks at files when the whole computer is allowed, and never changes them', () => {
  const full = toolsFor({ mode: 'chat', workspace: os.homedir(), fileAccess: 'full' });
  for (const t of ['find_files', 'list_files', 'read_file', 'search_files', 'read_document', 'open_path']) assert.ok(full.includes(t), `${t} in Chat with full access`);
  for (const t of ['write_file', 'run_command', 'edit_file']) assert.ok(!full.includes(t), `${t} stays out of Chat`);
  const ask = toolsFor({ mode: 'chat', workspace: null, fileAccess: 'ask' });
  assert.ok(!ask.includes('read_file') && !ask.includes('find_files'), 'with "ask" the folders are chosen first, as before');
});

test('the orb looks through files and runs the computer, but writes nothing and runs no commands', () => {
  const orb = toolsFor({ mode: 'chat', workspace: os.homedir(), fileAccess: 'full' }, { orb: true });
  for (const t of ['find_files', 'read_file', 'open_path', 'open_app', 'system_control']) assert.ok(orb.includes(t), `${t} in the orb`);
  for (const t of ['write_file', 'run_command', 'run_code', 'download_file']) assert.ok(!orb.includes(t), `${t} not in the orb`);
  assert.ok(!orb.includes('search_past_chats'), 'the orb never searches your chats');
  assert.ok(ORB_TOOLS.has('find_files'));
});

test('the prompt names the folders people mean', () => {
  const folders = { Home: '/Users/ana', Downloads: '/Users/ana/Downloads', Pictures: '/Users/ana/Pictures' };
  const p = buildSystemPrompt({ mode: 'chat', fileAccess: 'full', memoryEnabled: false, voiceLanguage: 'en' }, { docNames: [], folders });
  assert.match(p, /Downloads = \/Users\/ana\/Downloads/);
  assert.match(p, /you can look through the files/);
});
