// Scorpion OS boot test (GitHub Actions; any Linux with QEMU, OVMF, xorriso
// and ImageMagick):  node os/test/boot-test.mjs out/scorpion-os-0.1-amd64.iso shots/
//
// 1. Boots the live system's kernel straight from the ISO with a serial
//    console and the scorpion.test option, and waits for the system to say
//    Scorpion is running in the session (scorpion-boot-report.service).
//    Pass or fail comes from this, with a screenshot of the session.
// 2. Boots the ISO the way a computer does, through UEFI (OVMF) and through
//    BIOS, and takes a picture of each boot menu (for a look, not judged).
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';

const [iso, shots = 'shots'] = process.argv.slice(2);
if (!iso || !fs.existsSync(iso)) { console.error('usage: node boot-test.mjs path/to.iso [shots-folder]'); process.exit(2); }
fs.mkdirSync(shots, { recursive: true });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scorpion-boot-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const kvm = fs.existsSync('/dev/kvm') && (() => { try { fs.accessSync('/dev/kvm', fs.constants.R_OK | fs.constants.W_OK); return true; } catch { return false; } })();
const accel = kvm ? ['-accel', 'kvm', '-cpu', 'host'] : ['-accel', 'tcg', '-cpu', 'max'];
console.log(`QEMU with ${kvm ? 'KVM' : 'software emulation (slow)'}`);

// QEMU's machine protocol: a picture of the screen.
async function screenshot(sock, name) {
  const ppm = path.join(tmp, `${name}.ppm`);
  await new Promise((resolve, reject) => {
    const c = net.createConnection(sock);
    let buf = '';
    let step = 0;
    c.on('data', (d) => {
      buf += d;
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        if (!line.trim()) continue;
        const m = JSON.parse(line);
        if (m.QMP && step === 0) { step = 1; c.write('{"execute":"qmp_capabilities"}\n'); }
        else if (m.return !== undefined && step === 1) { step = 2; c.write(JSON.stringify({ execute: 'screendump', arguments: { filename: ppm } }) + '\n'); }
        else if ((m.return !== undefined || m.error) && step === 2) { c.end(); return m.error ? reject(new Error(m.error.desc)) : resolve(); }
      }
    });
    c.on('error', reject);
  });
  await sleep(500);
  const png = path.join(shots, `${name}.png`);
  try { execFileSync('convert', [ppm, png]); } catch { fs.copyFileSync(ppm, path.join(shots, `${name}.ppm`)); }
  console.log(`  picture: ${png}`);
}

function qemu(args, serial) {
  const sock = path.join(tmp, `qmp-${Date.now()}.sock`);
  const p = spawn('qemu-system-x86_64', [
    ...accel, '-machine', 'q35', '-m', '6144', '-smp', '4',
    '-vga', 'virtio', '-display', 'none',
    '-qmp', `unix:${sock},server=on,wait=off`,
    '-serial', `file:${serial}`,
    '-netdev', 'user,id=n0', '-device', 'virtio-net-pci,netdev=n0',
    '-audiodev', 'none,id=snd0',
    ...args,
  ], { stdio: ['ignore', 'inherit', 'inherit'] });
  return { p, sock, stop: () => { try { p.kill('SIGKILL'); } catch { /* gone */ } } };
}

// 1. The live system, all the way to Scorpion running in the session.
console.log('1. Live system: booting to the Scorpion session…');
execFileSync('xorriso', ['-osirrox', 'on', '-indev', iso, '-extract', '/casper/vmlinuz', path.join(tmp, 'vmlinuz'), '-extract', '/casper/initrd', path.join(tmp, 'initrd')], { stdio: 'ignore' });
const serial = path.join(shots, 'serial-live.log');
const live = qemu(['-cdrom', iso, '-kernel', path.join(tmp, 'vmlinuz'), '-initrd', path.join(tmp, 'initrd'),
  '-append', 'boot=casper ignore_uuid console=ttyS0,115200 scorpion.test systemd.show_status=1'], serial);
const limit = Date.now() + (kvm ? 15 : 45) * 60_000;
let result = 'TIMEOUT';
let tookPicture = false;
while (Date.now() < limit) {
  await sleep(5000);
  const log = fs.existsSync(serial) ? fs.readFileSync(serial, 'utf8') : '';
  if (log.includes('SCORPION-SESSION-RUNNING')) { result = 'RUNNING'; break; }
  if (log.includes('SCORPION-SESSION-MISSING')) { result = 'MISSING'; break; }
  if (/Kernel panic|end Kernel panic/.test(log)) { result = 'PANIC'; break; }
  if (!tookPicture && /Reached target.*Graphical Interface/.test(log)) { tookPicture = true; await screenshot(live.sock, 'live-graphical').catch(() => {}); }
}
// Scorpion draws its desktop a few seconds after it starts.
if (result === 'RUNNING') await sleep(20000);
await screenshot(live.sock, 'live-session').catch((e) => console.log(`  no picture: ${e.message}`));
live.stop();
console.log(`  result: ${result}`);

// 2. The boot menus, as computers see the disc.
for (const [name, firmware] of [['menu-uefi', ['-bios', '/usr/share/ovmf/OVMF.fd']], ['menu-bios', []]]) {
  if (firmware.length && !fs.existsSync(firmware[1])) { console.log(`2. ${name}: no OVMF firmware, skipped`); continue; }
  console.log(`2. ${name}: boot menu…`);
  const vm = qemu([...firmware, '-cdrom', iso, '-boot', 'd'], path.join(shots, `serial-${name}.log`));
  await sleep(kvm ? 7000 : 25000);
  await screenshot(vm.sock, name).catch((e) => console.log(`  no picture: ${e.message}`));
  await sleep(kvm ? 8000 : 20000);
  await screenshot(vm.sock, `${name}-later`).catch((e) => console.log(`  no picture: ${e.message}`));
  vm.stop();
}

fs.rmSync(tmp, { recursive: true, force: true });
if (result !== 'RUNNING') { console.error(`Boot test failed: ${result}. See ${serial}.`); process.exit(1); }
console.log('Boot test passed: Scorpion runs in the live session.');
