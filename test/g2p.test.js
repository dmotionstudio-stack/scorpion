import { test } from 'node:test';
import assert from 'node:assert/strict';
import { phonemizeSpanish, numberToWords as esNum } from '../src/main/g2p/es.js';
import { phonemizeFrench, numberToWords as frNum } from '../src/main/g2p/fr.js';
import { phonemizeItalian } from '../src/main/g2p/it.js';
import { phonemizePortuguese } from '../src/main/g2p/pt.js';
import { phonemizeHindi, numberToWords as hiNum } from '../src/main/g2p/hi.js';
import { phonemizeCreole, numberToWords as htNum } from '../src/main/g2p/ht.js';
import { KOKORO_LANGUAGES, hasKokoroVoice, phonemes, voiceFor } from '../src/main/g2p/index.js';
import { LANGUAGES, languageOf } from '../src/main/voice.js';

// The speech model only knows these symbols (its tokenizer's vocabulary): anything else would be dropped.
const VOCAB = new Set(Object.keys(JSON.parse(`{"$":0,";":0,":":0,",":0,".":0,"!":0,"?":0,"—":0,"…":0,"\\"":0,"(":0,")":0,"“":0,"”":0," ":0,"̃":0,"ʣ":0,"ʥ":0,"ʦ":0,"ʨ":0,"ᵝ":0,"ꭧ":0,"A":0,"I":0,"O":0,"Q":0,"S":0,"T":0,"W":0,"Y":0,"ᵊ":0,"a":0,"b":0,"c":0,"d":0,"e":0,"f":0,"h":0,"i":0,"j":0,"k":0,"l":0,"m":0,"n":0,"o":0,"p":0,"q":0,"r":0,"s":0,"t":0,"u":0,"v":0,"w":0,"x":0,"y":0,"z":0,"ɑ":0,"ɐ":0,"ɒ":0,"æ":0,"β":0,"ɔ":0,"ɕ":0,"ç":0,"ɖ":0,"ð":0,"ʤ":0,"ə":0,"ɚ":0,"ɛ":0,"ɜ":0,"ɟ":0,"ɡ":0,"ɥ":0,"ɨ":0,"ɪ":0,"ʝ":0,"ɯ":0,"ɰ":0,"ŋ":0,"ɳ":0,"ɲ":0,"ɴ":0,"ø":0,"ɸ":0,"θ":0,"œ":0,"ɹ":0,"ɾ":0,"ɻ":0,"ʁ":0,"ɽ":0,"ʂ":0,"ʃ":0,"ʈ":0,"ʧ":0,"ʊ":0,"ʋ":0,"ʌ":0,"ɣ":0,"ɤ":0,"χ":0,"ʎ":0,"ʒ":0,"ʔ":0,"ˈ":0,"ˌ":0,"ː":0,"ʰ":0,"ʲ":0,"↓":0,"→":0,"↗":0,"↘":0,"ᵻ":0}`)));

test('Spanish: stress, glides, soft consonants, seseo', () => {
  assert.equal(phonemizeSpanish('hola'), 'ˈola');
  assert.equal(phonemizeSpanish('casa'), 'kˈasa');
  assert.equal(phonemizeSpanish('ordenador'), 'oɾðenaðˈoɾ');
  assert.equal(phonemizeSpanish('niños'), 'nˈiɲos');
  assert.equal(phonemizeSpanish('¿Cómo estás hoy?'), 'kˈomo estˈas oj?');
  assert.match(phonemizeSpanish('agua'), /ˈaɣwa/);
  assert.match(phonemizeSpanish('cielo'), /sjˈelo/);
  assert.equal(esNum(25), 'veinticinco');
  assert.equal(esNum(142), 'ciento cuarenta y dos');
  assert.match(phonemizeSpanish('Hay 25 archivos'), /bejntisˈinko/);
});

test('French: nasal vowels, silent endings, ou oi eau', () => {
  assert.match(phonemizeFrench('bonjour'), /^bɔ̃ʒˈuʁ$/u);
  assert.match(phonemizeFrench('maison'), /mɛzˈɔ̃|mɛzɔ̃/);
  assert.match(phonemizeFrench('beaucoup'), /bokˈu|boku/);
  assert.match(phonemizeFrench('les enfants parlent'), /ɑ̃fˈɑ̃ paʁl/);
  assert.match(phonemizeFrench('entièrement'), /ɑ̃tjˈɛʁəmɑ̃/);
  assert.match(phonemizeFrench("l'ordinateur"), /^lɔʁdinatˈœʁ$|^lɔʁdinatœʁ$/);
  assert.equal(frNum(21), 'vingt et un');
  assert.equal(frNum(80), 'quatre-vingts');
  assert.match(phonemizeFrench('vingt-cinq'), /^vɛ̃tsɛ̃k$|^vɛ̃tsˈɛ̃k$/);
});

test('Italian: soft c and g, double consonants, the stress', () => {
  assert.match(phonemizeItalian('ciao'), /ʧˈao/);
  assert.match(phonemizeItalian('oggi'), /ˈoʤːi/);
  assert.match(phonemizeItalian('gli amici'), /ʎ.*amˈiʧi/);
  assert.match(phonemizeItalian('computer'), /^kompˈuter$|^komputˈer$/);
});

test('Portuguese: nasal vowels, ch lh nh, t and d before i', () => {
  assert.match(phonemizePortuguese('você'), /vosˈe/);
  assert.match(phonemizePortuguese('computador'), /dˈoʁ$/);
  assert.match(phonemizePortuguese('ação'), /ɐ̃w̃/u);
  assert.match(phonemizePortuguese('tarde'), /tˈaʁʤi/);
});

test('Hindi: the short a is dropped at the end of a word and between full syllables', () => {
  assert.equal(phonemizeHindi('कल'), 'kəl');
  assert.equal(phonemizeHindi('आज'), 'aːʤ');
  assert.equal(phonemizeHindi('कमल'), 'kəməl'.replace('kəməl', 'kəməl'));
  assert.match(phonemizeHindi('नमस्ते'), /^nəməsteː$/);
  assert.match(phonemizeHindi('दोपहर'), /^doːpəhəɾ$/);
  assert.equal(hiNum(25), 'पच्चीस');
  assert.equal(phonemizeHindi('।'), '.');
});

test('Haitian Creole: one sound per letter group, nasal vowels an en on, the stress last', () => {
  assert.equal(phonemizeCreole('konprann'), 'kɔ̃pʁˈɑ̃');
  assert.equal(phonemizeCreole('mwen'), 'mwɛ̃');
  assert.equal(phonemizeCreole('moun'), 'mũ');
  assert.equal(phonemizeCreole('ayisyèn'), 'ajisjˈɛn');
  assert.equal(phonemizeCreole('kijan ou ye'), 'kiʒˈɑ̃ u je');
  assert.equal(htNum(25), 'venn senk');
  assert.equal(htNum(71), 'swasant onz');
  assert.equal(htNum(99), 'katreven diznèf');
});

test('every language that uses a Kokoro voice has rules, voices and only symbols the model knows', () => {
  const sample = { fr: 'Bonjour, comment allez-vous ?', ht: 'Bonjou, kijan ou ye?', es: 'Hola, ¿cómo estás?', it: 'Ciao, come stai?', pt: 'Olá, como você está?', hi: 'नमस्ते, आप कैसे हैं?' };
  for (const id of Object.keys(KOKORO_LANGUAGES)) {
    assert.ok(hasKokoroVoice(id) && KOKORO_LANGUAGES[id].voices.length >= 1, id);
    assert.equal(languageOf(id).speech, 'kokoro', `${id} is spoken by the main voice model`);
    const ph = phonemes(id, sample[id]);
    assert.ok(ph.length > 5, id);
    for (const ch of ph) assert.ok(VOCAB.has(ch), `${id}: the model does not know "${ch}" (U+${ch.codePointAt(0).toString(16)}) in ${ph}`);
  }
  assert.equal(voiceFor('es', 'em_alex'), 'em_alex');
  assert.equal(voiceFor('es', 'af_heart'), 'ef_dora', 'an English voice falls back to the language\'s first');
  assert.equal(voiceFor('en', 'af_heart'), null);
});

test('the languages list: unique codes, a way to speak each, and more than before', () => {
  const ids = LANGUAGES.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(LANGUAGES.length >= 36);
  for (const l of LANGUAGES) {
    assert.ok(l.name && l.native, l.id);
    assert.ok(['kokoro', 'system'].includes(l.speech) || /^[a-z]{3}$/.test(l.speech), `${l.id}: ${l.speech}`);
  }
  for (const id of ['fr', 'es', 'ht', 'it', 'pt', 'hi', 'el', 'he', 'th', 'bn', 'ur', 'fa', 'cs', 'sv', 'ca', 'ta', 'tl']) assert.ok(ids.includes(id), id);
  assert.equal(languageOf('Haitian Creole').id, 'ht');
});
