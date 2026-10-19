// Face lock: when it's on, Scorpion starts locked and every data request from
// the page is refused until the owner's face is recognized (or the PIN is
// entered). The PIN is stored only as a salted scrypt hash in lock.json.
// This keeps people out of the app; it does not encrypt the files on disk.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let file = null;
let locked = false;

export function initLock(dataDir) {
  file = path.join(dataDir, 'lock.json');
  locked = lockEnabled();
}

function read() {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

export function lockEnabled() { return Boolean(read().enabled && read().pin); }
export function hasPin() { return Boolean(read().pin); }
export function isLocked() { return locked; }
export function lockNow() { if (lockEnabled()) locked = true; return locked; }
export function unlock() { locked = false; }

export function setPin(pin) {
  const p = String(pin ?? '');
  if (!/^\d{4,8}$/.test(p)) throw new Error('The PIN must be 4 to 8 digits.');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(p, salt, 32).toString('hex');
  fs.writeFileSync(file, JSON.stringify({ ...read(), pin: `${salt}:${hash}` }));
}

export function checkPin(pin) {
  const [salt, hash] = String(read().pin || '').split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(pin ?? ''), salt, 32);
  return crypto.timingSafeEqual(got, Buffer.from(hash, 'hex'));
}

export function setEnabled(on) {
  if (on && !hasPin()) throw new Error('Set a PIN first, so you can always get in.');
  fs.writeFileSync(file, JSON.stringify({ ...read(), enabled: Boolean(on) }));
}

export function lockStatus() { return { enabled: lockEnabled(), hasPin: hasPin(), locked }; }
