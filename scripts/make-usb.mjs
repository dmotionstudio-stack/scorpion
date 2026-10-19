// Assembles a folder to copy onto a USB stick: Scorpion for Windows (no
// install), the Mac disk images, and one shared scorpion-data folder with
// models, so the same chats, memory and models work on both systems.
//   node scripts/make-usb.mjs <out-dir> [--mac-arm <dmg>] [--mac-intel <dmg>] [--models <dir> <file.gguf>...]
// Build the Windows app first: npx electron-builder --win dir
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const out = args.shift();
if (!out) { console.error('usage: node scripts/make-usb.mjs <out-dir> [--mac-arm dmg] [--mac-intel dmg] [--models dir file...]'); process.exit(1); }
const opt = (name) => { const i = args.indexOf(name); return i < 0 ? null : args[i + 1]; };
const modelsAt = args.indexOf('--models');
const modelDir = modelsAt < 0 ? null : args[modelsAt + 1];
const modelFiles = modelsAt < 0 ? [] : args.slice(modelsAt + 2).filter((a) => !a.startsWith('--'));

const root = path.resolve(import.meta.dirname, '..');
const winApp = path.join(root, 'release', 'win-unpacked');
if (!fs.existsSync(path.join(winApp, 'Scorpion.exe'))) { console.error('Build the Windows app first: npx electron-builder --win dir'); process.exit(1); }

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });
const copy = (from, to) => { fs.cpSync(from, to, { recursive: true }); console.log(`  ${path.relative(out, to)}`); };

copy(winApp, path.join(out, 'Windows'));
for (const [flag, name] of [['--mac-arm', 'Scorpion for Apple Silicon Mac.dmg'], ['--mac-intel', 'Scorpion for Intel Mac.dmg']]) {
  const dmg = opt(flag);
  if (dmg) copy(dmg, path.join(out, 'Mac', name));
}
const data = path.join(out, 'scorpion-data');
fs.mkdirSync(path.join(data, 'models'), { recursive: true });
for (const f of modelFiles) copy(path.join(modelDir, f), path.join(data, 'models', f));
copy(path.join(root, 'resources', 'USB-START-HERE.txt'), path.join(out, 'START HERE.txt'));

const size = (p) => fs.statSync(p).isDirectory() ? fs.readdirSync(p).reduce((n, f) => n + size(path.join(p, f)), 0) : fs.statSync(p).size;
console.log(`\n${out}: ${(size(out) / 1024 ** 3).toFixed(2)} GB. Copy everything inside it to the root of the USB stick.`);
