// Personality and check-ins, after OpenClaw's SOUL.md and heartbeat.
//  - SOUL.md: the user writes how Scorpion should sound (tone, opinions,
//    brevity, humour, boundaries). It goes near the top of every prompt.
//  - HEARTBEAT.md: a checklist Scorpion reviews on a timer, during active
//    hours. When nothing needs the user it answers HEARTBEAT_OK and the
//    check-in leaves no trace; otherwise the user gets a notification.
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson } from './store.js';

let dir = null;
const MAX_SOUL = 4000;
const SOUL_IN_PROMPT = 1500;
const MAX_CHECKLIST = 4000;

export function initPersona(dataDir) {
  dir = dataDir;
}

const soulFile = () => path.join(dir, 'SOUL.md');
const checklistFile = () => path.join(dir, 'HEARTBEAT.md');
const stateFile = () => path.join(dir, 'heartbeat.json');
const readText = (f) => { try { return fs.readFileSync(f, 'utf8').replace(/^﻿/, ''); } catch { return ''; } };

export const getSoul = () => (dir ? readText(soulFile()) : '');
export function saveSoul(text) {
  fs.writeFileSync(soulFile(), String(text || '').slice(0, MAX_SOUL));
  return getSoul();
}

export function soulPromptBlock() {
  const soul = getSoul().trim();
  if (!soul) return '';
  return `PERSONALITY (the user's own words, from SOUL.md; follow it for tone and style, but never against safety or the rules below):\n${soul.slice(0, SOUL_IN_PROMPT)}`;
}

export const getChecklist = () => (dir ? readText(checklistFile()) : '');
export function saveChecklist(text) {
  fs.writeFileSync(checklistFile(), String(text || '').slice(0, MAX_CHECKLIST));
  return getChecklist();
}

export const heartbeatState = () => readJson(stateFile(), { lastRun: 0, lastResult: null });
export function recordHeartbeat(result) {
  writeJson(stateFile(), { lastRun: Date.now(), lastResult: result });
}

// "08:00-22:00" → inside? Overnight ranges ("22:00-06:00") work too.
export function withinHours(range, date = new Date()) {
  const m = /^(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})$/.exec(String(range || '').trim());
  if (!m) return true;
  const from = +m[1] * 60 + +m[2];
  const to = +m[3] * 60 + +m[4];
  const now = date.getHours() * 60 + date.getMinutes();
  return from <= to ? now >= from && now < to : now >= from || now < to;
}

export function heartbeatDue(settings, { now = Date.now(), lastRun = 0, checklist = '' } = {}) {
  if (!settings.heartbeatEnabled || !checklist.trim()) return false;
  const every = Math.max(15, Number(settings.heartbeatMinutes) || 60) * 60_000;
  return now - lastRun >= every && withinHours(settings.heartbeatHours, new Date(now));
}

// The model was told to answer exactly HEARTBEAT_OK when all is well; small
// models sometimes add punctuation or a word, so be lenient about the edges.
export function isHeartbeatOk(text) {
  const letters = String(text || '').replace(/[^a-z]/gi, '').toUpperCase();
  return letters.startsWith('HEARTBEATOK') && letters.length <= 20;
}

export function heartbeatPrompt(checklist, when = new Date()) {
  return `[Check-in · ${when.toLocaleString()}]
Go through the checklist below. Use your tools to look things up if an item needs it (you may not change files or run commands now).
If nothing needs the user's attention right now, reply with exactly HEARTBEAT_OK and nothing else.
Otherwise reply with a short message for the user: only what needs them, most important first.

Checklist:
${checklist.trim()}`;
}
