// Scorpion OS boot test (GitHub Actions; any Linux with QEMU, OVMF, xorriso
// and ImageMagick):  node os/test/boot-test.mjs out/scorpion-os-0.1-amd64.iso shots/
//
// 1. Boots the live system's kernel straight from the ISO with a serial
//    console and the scorpion.test option, and follows the checks inside
//    the system (boot-test-steps, through scorpion-boot-report.service):
//    Scorpion running in the session; started again after it crashes; the
//    lock screen, and back after swaylock crashes; and, after the machine
//    sleeps and this wakes it, Scorpion and the lock still there and the
//    screen not black. Pass or fail comes from these, with pictures.
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

// QEMU's machine protocol: one command, its answer.
function qmp(sock, execute, args) {
  return new Promise((resolve, reject) => {
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
        if (m.event) continue;
        if (m.QMP && step === 0) { step = 1; c.write('{"execute":"qmp_capabilities"}\n'); }
        else if (m.return !== undefined && step === 1) { step = 2; c.write(JSON.stringify({ execute, ...(args ? { arguments: args } : {}) }) + '\n'); }
        else if ((m.return !== undefined || m.error) && step === 2) { c.end(); return m.error ? reject(new Error(m.error.desc)) : resolve(m.return); }
      }
    });
    c.on('error', reject);
  });
}
// A picture of the screen; returns how bright it is on average (0 black, 1 white).
async function screenshot(sock, name) {
  const ppm = path.join(tmp, `${name}.ppm`);
  await qmp(sock, 'screendump', { filename: ppm });
  await sleep(500);
  const png = path.join(shots, `${name}.png`);
  try { execFileSync('convert', [ppm, png]); } catch { fs.copyFileSync(ppm, path.join(shots, `${name}.ppm`)); }
  let bright = null;
  try { bright = Number(execFileSync('convert', [ppm, '-colorspace', 'Gray', '-format', '%[fx:mean]', 'info:'], { encoding: 'utf8' })); } catch { /* no ImageMagick */ }
  console.log(`  picture: ${png}${bright == null ? '' : ` (brightness ${bright.toFixed(3)})`}`);
  return bright;
}
// The lock screen's dark background is about 0.05; a screen with nothing on it is 0.
const NOT_BLACK = 0.02;

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
  // Sleep that QEMU can wake (S3, which q35 has off unless asked).
  '-global', 'ICH9-LPC.disable_s3=0',
  '-append', 'boot=casper ignore_uuid console=ttyS0,115200 scorpion.test systemd.show_status=1 mem_sleep_default=deep'], serial);
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
console.log(`  result: ${result}`);

// The checks after it: each waits for its line on the console.
const problems = [];
const seen = (re) => (fs.existsSync(serial) ? fs.readFileSync(serial, 'utf8') : '').match(re);
async function until(re, seconds) {
  const end = Date.now() + seconds * 1000;
  while (Date.now() < end) { const m = seen(re); if (m) return m; await sleep(1000); }
  return null;
}
const picture = (name) => screenshot(live.sock, name).catch((e) => { console.log(`  no picture: ${e.message}`); return null; });
if (result === 'RUNNING') {
  console.log('1b. Scorpion crashes: started again by its service…');
  const restart = await until(/SCORPION-RESTART-(OK|FAILED)/, 120);
  console.log(`  ${restart ? restart[0] : 'no answer'}`);
  if (restart?.[1] !== 'OK') problems.push('Scorpion was not started again after it crashed');

  console.log('1c. The lock screen, and swaylock crashing…');
  const locked = await until(/SCORPION-LOCK(ED|-MISSING)/, 90);
  console.log(`  ${locked ? locked[0] : 'no answer'}`);
  if (locked?.[1] !== 'ED') problems.push('the screen did not lock');
  await sleep(4000);
  const lockBright = await picture('lock-screen');
  if (lockBright != null && lockBright < NOT_BLACK) problems.push('the lock screen is black');
  const back = await until(/SCORPION-LOCK-(BACK|GONE)/, 60);
  console.log(`  ${back ? back[0] : 'no answer'}`);
  if (back?.[1] !== 'BACK') problems.push('the lock did not come back after swaylock crashed');
  await sleep(4000);
  const crashBright = await picture('lock-after-crash');
  if (crashBright != null && crashBright < NOT_BLACK) problems.push('the screen is black after swaylock crashed');

  console.log('1d. Sleep and wake…');
  if (await until(/SCORPION-SLEEPING/, 60)) {
    let asleep = false;
    const end = Date.now() + 90_000;
    while (Date.now() < end && !seen(/SCORPION-WOKE/)) {
      const st = await qmp(live.sock, 'query-status').catch(() => null);
      if (st?.status === 'suspended') { asleep = true; break; }
      await sleep(1000);
    }
    console.log(`  ${asleep ? 'asleep; waking it' : 'it did not go to sleep'}`);
    if (!asleep) problems.push('the machine did not go to sleep');
    else {
      await sleep(5000);
      await qmp(live.sock, 'system_wakeup').catch((e) => problems.push(`waking failed: ${e.message}`));
    }
    const woke = await until(/SCORPION-WOKE scorpion=(\d) lock=(\d)/, 120);
    console.log(`  ${woke ? woke[0] : 'it did not wake'}`);
    if (!woke) problems.push('the machine did not wake (or the system stopped answering)');
    else {
      if (woke[1] !== '1') problems.push('Scorpion was not running after waking');
      if (woke[2] !== '1') problems.push('the screen was not locked after waking');
      await sleep(5000);
      const wakeBright = await picture('after-wake');
      if (wakeBright != null && wakeBright < NOT_BLACK) problems.push('the screen is black after waking');
    }
  } else problems.push('the sleep step never started');
  console.log(`  ${(await until(/SCORPION-STEPS-DONE/, 60)) ? 'all steps done' : 'the steps did not finish'}`);
}
// The evidence the steps left (lines starting '| '), for when one failed.
const evidence = (fs.existsSync(serial) ? fs.readFileSync(serial, 'utf8') : '').split(/\r?\n/).filter((l) => l.startsWith('| '));
if (evidence.length) console.log(`  what the system said:\n${evidence.map((l) => `    ${l}`).join('\n')}`);
live.stop();

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
if (problems.length) { console.error(`Boot test failed:\n  - ${problems.join('\n  - ')}\nSee ${serial} and the pictures.`); process.exit(1); }
console.log('Boot test passed: Scorpion runs in the live session, comes back after crashes, and wakes from sleep to its lock screen.');
