// Makes the portable Windows .zip: Scorpion with an empty scorpion-data
// folder next to Scorpion.exe (so it keeps everything there and runs from a
// USB stick without installing) and the portable instructions.
//   npm run dist:portable      (builds the Windows app, then this)
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const { version } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const app = path.join(root, 'release', 'win-unpacked');
if (!fs.existsSync(path.join(app, 'Scorpion.exe'))) { console.error('Build the Windows app first: npx electron-builder --win dir'); process.exit(1); }

const name = `Scorpion-${version}-portable`;
const stage = path.join(root, 'release', name);
const zip = path.join(root, 'release', `${name}.zip`);
fs.rmSync(stage, { recursive: true, force: true });
fs.rmSync(zip, { force: true });
fs.cpSync(app, stage, { recursive: true });
fs.mkdirSync(path.join(stage, 'scorpion-data', 'models'), { recursive: true });
fs.copyFileSync(path.join(root, 'resources', 'PORTABLE.txt'), path.join(stage, 'README (portable).txt'));

if (process.platform === 'win32') {
  // Compress-Archive skips empty folders, so the data folder gets a note.
  fs.writeFileSync(path.join(stage, 'scorpion-data', 'models', 'Put .gguf models here.txt'), 'Copy .gguf model files here to use them without downloading.\r\n');
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${stage.replace(/'/g, "''")}' -DestinationPath '${zip.replace(/'/g, "''")}' -CompressionLevel Optimal`], { stdio: 'inherit' });
} else {
  execFileSync('zip', ['-qr', zip, name], { cwd: path.dirname(stage), stdio: 'inherit' });
}
fs.rmSync(stage, { recursive: true, force: true });
console.log(`${zip}: ${(fs.statSync(zip).size / 1024 ** 2).toFixed(0)} MB. Unzip anywhere (a USB stick too) and run Scorpion.exe.`);
