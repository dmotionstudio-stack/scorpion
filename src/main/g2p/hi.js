// Hindi (Devanagari) by rules: letters to the phonemes the speech model knows. Every consonant carries a short a (schwa) unless a vowel
// sign, a virama (the conjunct mark) or the rules of spoken Hindi take it away: it is dropped at the end of a word and, in the middle,
// when it sits between two syllables that keep their vowels (कमल is kamal, not kamala).

import { digitsToWords, mapWords } from './common.js';

const CONS = {
  'क': 'k', 'ख': 'kʰ', 'ग': 'ɡ', 'घ': 'ɡʰ', 'ङ': 'ŋ',
  'च': 'ʧ', 'छ': 'ʧʰ', 'ज': 'ʤ', 'झ': 'ʤʰ', 'ञ': 'ɲ',
  'ट': 'ʈ', 'ठ': 'ʈʰ', 'ड': 'ɖ', 'ढ': 'ɖʰ', 'ण': 'ɳ',
  'त': 't', 'थ': 'tʰ', 'द': 'd', 'ध': 'dʰ', 'न': 'n',
  'प': 'p', 'फ': 'pʰ', 'ब': 'b', 'भ': 'bʰ', 'म': 'm',
  'य': 'j', 'र': 'ɾ', 'ल': 'l', 'व': 'ʋ', 'श': 'ʃ', 'ष': 'ʂ', 'स': 's', 'ह': 'h',
  'ळ': 'ɭ', 'क्ष': 'kʂ', 'ज्ञ': 'ɡj',
};
const NUKTA = { 'क': 'q', 'ख': 'x', 'ग': 'ɣ', 'ज': 'z', 'ड': 'ɽ', 'ढ': 'ɽʰ', 'फ': 'f', 'य': 'j' };
const INDEP = { 'अ': 'ə', 'आ': 'aː', 'इ': 'ɪ', 'ई': 'iː', 'उ': 'ʊ', 'ऊ': 'uː', 'ऋ': 'ɾɪ', 'ए': 'eː', 'ऐ': 'ɛː', 'ओ': 'oː', 'औ': 'ɔː', 'ऑ': 'ɔː', 'ऍ': 'ɛː' };
const MATRA = { 'ा': 'aː', 'ि': 'ɪ', 'ी': 'iː', 'ु': 'ʊ', 'ू': 'uː', 'ृ': 'ɾɪ', 'े': 'eː', 'ै': 'ɛː', 'ो': 'oː', 'ौ': 'ɔː', 'ॉ': 'ɔː', 'ॅ': 'ɛː' };
const VIRAMA = '्';
const NUKTA_MARK = '़';
const ANUSVARA = 'ं';
const CHANDRA = 'ँ';
const VISARGA = 'ः';
const DIGITS = '०१२३४५६७८९';

// A word as a list of units: { c: consonant phoneme or '', v: vowel phoneme (null: a bare schwa that may be dropped), nas: nasal }
function units(word) {
  const chars = [...word.normalize('NFC')];
  const out = [];
  let i = 0;
  while (i < chars.length) {
    const ch = chars[i];
    if (INDEP[ch]) { out.push({ c: '', v: INDEP[ch], fixed: true }); i++; continue; }
    // क्ष and ज्ञ as one consonant
    let cons = null;
    if ((ch === 'क' || ch === 'ज') && chars[i + 1] === VIRAMA && ((ch === 'क' && chars[i + 2] === 'ष') || (ch === 'ज' && chars[i + 2] === 'ञ'))) { cons = ch === 'क' ? CONS['क्ष'] : CONS['ज्ञ']; i += 3; }
    else if (CONS[ch]) { cons = CONS[ch]; i++; if (chars[i] === NUKTA_MARK) { cons = NUKTA[ch] ?? cons; i++; } }
    else { if (ch === ANUSVARA || ch === CHANDRA) { const last = out[out.length - 1]; if (last) last.nas = true; } else if (ch === VISARGA) out.push({ c: 'h', v: null, fixed: false, bare: true }); i++; continue; }
    const u = { c: cons, v: null, fixed: false };
    if (chars[i] === VIRAMA) { u.v = ''; u.fixed = true; i++; } // no vowel: joins the next consonant
    else if (MATRA[chars[i]]) { u.v = MATRA[chars[i]]; u.fixed = true; i++; }
    out.push(u);
  }
  return out;
}

function word(raw) {
  const us = units(raw);
  // the short a: said in each consonant that has no sign, except the ones dropped by the rules of the spoken language
  const hasVowel = (u) => u.fixed ? u.v !== '' : true;
  const isLong = (u) => u.fixed && u.v && /ː/.test(u.v);
  const keep = us.map(() => true);
  const last = us.length - 1;
  // the final short a is silent (but not in a one-consonant word)
  if (last >= 1 && !us[last].fixed) keep[last] = false;
  // inside the word: a short a between two syllables with vowels is dropped, going from the right
  for (let k = last - 1; k >= 1; k--) {
    const u = us[k];
    if (u.fixed || !keep[k]) continue;
    const before = us[k - 1];
    const after = us[k + 1];
    if (!after || !hasVowel(after) || !before || after.c === 'h') continue;
    const afterKeeps = after.fixed ? after.v !== '' : keep[k + 1];
    const beforeKeeps = before.fixed ? before.v !== '' : keep[k - 1];
    if (afterKeeps && beforeKeeps && (k + 1 !== last || after.fixed || keep[k + 1])) keep[k] = false;
  }
  void isLong;
  return us.map((u, k) => {
    const v = u.fixed ? u.v : (keep[k] ? 'ə' : '');
    return `${u.c}${v}${u.nas && v ? '̃' : u.nas ? 'n' : ''}`;
  }).join('');
}

const ONES = ['शून्य', 'एक', 'दो', 'तीन', 'चार', 'पाँच', 'छह', 'सात', 'आठ', 'नौ', 'दस', 'ग्यारह', 'बारह', 'तेरह', 'चौदह', 'पंद्रह', 'सोलह', 'सत्रह', 'अठारह', 'उन्नीस'];
const TENS = ['', '', 'बीस', 'तीस', 'चालीस', 'पचास', 'साठ', 'सत्तर', 'अस्सी', 'नब्बे'];
// 21 to 99 have their own names in Hindi: the common ones are listed whole (the rest are read digit by digit)
const IRREGULAR = {
  21: 'इक्कीस', 22: 'बाईस', 23: 'तेईस', 24: 'चौबीस', 25: 'पच्चीस', 26: 'छब्बीस', 27: 'सत्ताईस', 28: 'अट्ठाईस', 29: 'उनतीस', 31: 'इकतीस', 32: 'बत्तीस', 33: 'तैंतीस', 34: 'चौंतीस', 35: 'पैंतीस', 36: 'छत्तीस', 37: 'सैंतीस', 38: 'अड़तीस', 39: 'उनतालीस',
  40: 'चालीस', 41: 'इकतालीस', 42: 'बयालीस', 43: 'तैंतालीस', 44: 'चौवालीस', 45: 'पैंतालीस', 46: 'छियालीस', 47: 'सैंतालीस', 48: 'अड़तालीस', 49: 'उनचास', 50: 'पचास', 51: 'इक्यावन', 52: 'बावन', 53: 'तिरपन', 54: 'चौवन', 55: 'पचपन', 56: 'छप्पन', 57: 'सत्तावन', 58: 'अट्ठावन', 59: 'उनसठ',
  60: 'साठ', 61: 'इकसठ', 62: 'बासठ', 63: 'तिरसठ', 64: 'चौंसठ', 65: 'पैंसठ', 66: 'छियासठ', 67: 'सड़सठ', 68: 'अड़सठ', 69: 'उनहत्तर', 70: 'सत्तर', 71: 'इकहत्तर', 72: 'बहत्तर', 73: 'तिहत्तर', 74: 'चौहत्तर', 75: 'पचहत्तर', 76: 'छिहत्तर', 77: 'सतहत्तर', 78: 'अठहत्तर', 79: 'उन्यासी',
  80: 'अस्सी', 81: 'इक्यासी', 82: 'बयासी', 83: 'तिरासी', 84: 'चौरासी', 85: 'पचासी', 86: 'छियासी', 87: 'सत्तासी', 88: 'अट्ठासी', 89: 'नवासी', 90: 'नब्बे', 91: 'इक्यानवे', 92: 'बानवे', 93: 'तिरानवे', 94: 'चौरानवे', 95: 'पंचानवे', 96: 'छियानवे', 97: 'सत्तानवे', 98: 'अट्ठानवे', 99: 'निन्यानवे',
};
export function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return IRREGULAR[n] ?? TENS[Math.floor(n / 10)];
  if (n < 1000) { const h = Math.floor(n / 100); return `${ONES[h]} सौ${n % 100 ? ' ' + numberToWords(n % 100) : ''}`; }
  if (n < 1e5) { const k = Math.floor(n / 1000); return `${numberToWords(k)} हज़ार${n % 1000 ? ' ' + numberToWords(n % 1000) : ''}`; }
  if (n < 1e7) { const k = Math.floor(n / 1e5); return `${numberToWords(k)} लाख${n % 1e5 ? ' ' + numberToWords(n % 1e5) : ''}`; }
  if (n < 1e12) { const k = Math.floor(n / 1e7); return `${numberToWords(k)} करोड़${n % 1e7 ? ' ' + numberToWords(n % 1e7) : ''}`; }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

export function phonemizeHindi(text) {
  const ascii = String(text).replace(/[०-९]/g, (d) => String(DIGITS.indexOf(d)));
  // letters of the language: the Devanagari block (consonants, vowels, signs) and the nukta/virama marks; Latin words are left to be skipped
  return mapWords(digitsToWords(ascii, numberToWords).replace(/।/g, '.'), (w) => word(w), '\\u0900-\\u097F');
}
