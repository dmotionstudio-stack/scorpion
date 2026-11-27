import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, ORB_TEXT, ORB_LANGUAGES, orbT, orbLanguage, orbHint } from '../src/renderer/orb-text.js';
import { LANGUAGES } from '../src/main/voice.js';

test('every language Scorpion speaks has the orb screen in it, every word filled in', () => {
  for (const l of LANGUAGES) assert.ok(ORB_TEXT[l.id], `${l.name} has no orb text`);
  for (const id of ORB_LANGUAGES) {
    for (const k of KEYS) assert.ok(typeof ORB_TEXT[id][k] === 'string' && ORB_TEXT[id][k].trim(), `${id}: ${k} is empty`);
    assert.equal(Object.keys(ORB_TEXT[id]).length, KEYS.length, `${id}: wrong number of words`);
  }
});

test('names and numbers are kept in every language', () => {
  for (const id of ORB_LANGUAGES) {
    for (const k of ['switching', 'opening', 'zoomInto']) assert.ok(ORB_TEXT[id][k].includes('{x}'), `${id}.${k} lost {x}`);
    assert.ok(ORB_TEXT[id].downloading.includes('{n}'), `${id}.downloading lost {n}`);
    assert.ok(ORB_TEXT[id].sayName.includes('Scorpion') && ORB_TEXT[id].andAsk.includes('Scorpion'), `${id}: the wake word is Scorpion`);
  }
  assert.equal(orbT('fr', 'opening', { x: 'Fichiers' }), 'Ouverture de Fichiers');
  assert.equal(orbT('en', 'downloading', { n: 42 }), 'Downloading voice 42%');
});

test('the words change with the language, and English is the fallback', () => {
  assert.equal(orbT('es', 'listening'), 'Escuchando');
  assert.equal(orbT('ja', 'send'), '送信');
  assert.equal(orbT('ES', 'yes'), 'Sí'); // capitals do not matter
  assert.equal(orbLanguage('klingon'), 'en');
  assert.equal(orbT('klingon', 'listening'), 'Listening');
  assert.equal(orbT(undefined, 'standby'), 'Standby');
  assert.equal(orbT('en', 'nothing-like-this'), 'nothing-like-this');
  // Not the same text as English in languages with their own script.
  for (const id of ['ru', 'ar', 'hi', 'ko', 'zh', 'ja', 'el', 'he', 'th', 'bn', 'ur', 'fa', 'ta']) assert.notEqual(ORB_TEXT[id].listening, ORB_TEXT.en.listening, id);
});

test('the hint line keeps the keys and follows the language', () => {
  const fr = orbHint('fr');
  assert.match(fr, /<span class="key">Space<\/span> parler \/ interrompre/);
  assert.match(fr, /<span class="key">Esc<\/span> quitter/);
  assert.match(orbHint('en'), /<span class="key">Click<\/span> a shortcut/);
  assert.match(orbHint('de', true), /Sag/);
  assert.match(orbHint('de', true), /„Scorpion“ und frag/);
  assert.ok(!/<script/.test(orbHint('en')));
});
