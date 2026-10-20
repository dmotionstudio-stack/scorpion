// API keys and bot tokens, kept out of settings.json and encrypted with the
// operating system's keychain (Electron safeStorage: DPAPI on Windows,
// Keychain on macOS) when it is available. The UI never gets them back; it
// only learns whether one is set.
import path from 'node:path';
import { paths, readJson, writeJson } from './store.js';

let crypto = null; // { isEncryptionAvailable(), encryptString(s), decryptString(buf) }
const file = () => path.join(paths.data, 'secrets.json');

export function initSecrets(safeStorage) {
  crypto = safeStorage || null;
}

const sealed = () => Boolean(crypto?.isEncryptionAvailable?.());

export function setSecret(name, value) {
  const all = readJson(file(), {});
  if (value == null || value === '') delete all[name];
  else all[name] = sealed() ? `enc:${crypto.encryptString(String(value)).toString('base64')}` : `raw:${Buffer.from(String(value)).toString('base64')}`;
  writeJson(file(), all);
}

export function getSecret(name) {
  const v = readJson(file(), {})[name];
  if (!v) return null;
  try {
    if (v.startsWith('enc:')) return sealed() ? crypto.decryptString(Buffer.from(v.slice(4), 'base64')) : null;
    if (v.startsWith('raw:')) return Buffer.from(v.slice(4), 'base64').toString();
  } catch { /* another user's or machine's key: unreadable */ }
  return null;
}

export const hasSecret = (name) => Boolean(readJson(file(), {})[name]);
