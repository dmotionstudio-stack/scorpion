// Haitian Creole (Kreyòl ayisyen) by rules. Its spelling was made to be read as it sounds, so this is the best-understood of the
// languages here: one sound per letter or letter group, nasal vowels written an / en / on, the r a back one (ʁ), the stress on the last
// syllable. It is spoken with the French voice of the speech model, which is the nearest voice there is, but with Creole sounds
// instead of French spelling (before this, French rules were applied to Creole words, which is what made it sound wrong).

import { digitsToWords, mapWords } from './common.js';

const VOWELS = 'aeiouòè';
const isVowel = (c) => c !== undefined && VOWELS.includes(c);

function word(raw) {
  const w = raw.normalize('NFC').replace(/’/g, "'");
  const parts = [];
  let i = 0;
  const at = (k) => w[k];
  let vowelCount = 0;
  while (i < w.length) {
    const c = w[i];
    const two = w.slice(i, i + 2);
    const three = w.slice(i, i + 3);
    const nextIsVowel = isVowel(at(i + 2));
    // sound groups, longest first
    if (three === 'tch') { parts.push('ʧ'); i += 3; continue; }
    if (two === 'ch') { parts.push('ʃ'); i += 2; continue; }
    if (two === 'dj') { parts.push('ʤ'); i += 2; continue; }
    if (two === 'ou') { parts.push(at(i + 2) === 'n' && !isVowel(at(i + 3)) && at(i + 3) !== 'n' ? 'ũ' : 'u'); vowelCount++; i += at(i + 2) === 'n' && !isVowel(at(i + 3)) && at(i + 3) !== 'n' ? 3 : 2; continue; }
    if (two === 'ui') { parts.push('ɥi'); vowelCount++; i += 2; continue; }
    if (two === 'oi') { parts.push('wa'); vowelCount++; i += 2; continue; }
    if (two === 'ng' && !isVowel(at(i + 2))) { parts.push('ŋ'); i += 2; continue; }
    // nasal vowels: an en on (and in, un), also written ann enn onn, before a consonant or at the end of the word (konprann, venn),
    // not before a vowel (an oral vowel then n: ayisyèn, bèl-ene)
    {
      const n = at(i + 1) === 'n' ? (at(i + 2) === 'n' ? 2 : 1) : 0;
      if (n && 'aeo'.includes(c) && !isVowel(at(i + 1 + n))) {
        parts.push(c === 'a' ? 'ɑ̃' : c === 'e' ? 'ɛ̃' : 'ɔ̃');
        vowelCount++;
        i += 1 + n;
        continue;
      }
      if (n && (c === 'i' || c === 'u') && !isVowel(at(i + 1 + n)) && i > 0) {
        parts.push(c === 'i' ? 'ɛ̃' : 'œ̃');
        vowelCount++;
        i += 1 + n;
        continue;
      }
    }
    void nextIsVowel;
    switch (c) {
      case 'a': parts.push('a'); vowelCount++; break;
      case 'e': parts.push('e'); vowelCount++; break;
      case 'è': parts.push('ɛ'); vowelCount++; break;
      case 'i': parts.push('i'); vowelCount++; break;
      case 'o': parts.push('o'); vowelCount++; break;
      case 'ò': parts.push('ɔ'); vowelCount++; break;
      case 'u': parts.push('y'); vowelCount++; break;
      case 'j': parts.push('ʒ'); break;
      case 'r': parts.push('ʁ'); break;
      case 'w': parts.push('w'); break;
      case 'y': parts.push('j'); break;
      case 'g': parts.push('ɡ'); break;
      case 'c': parts.push('k'); break;
      case 'x': parts.push('ks'); break;
      case 'h': break;
      case '-': case "'": break;
      default: parts.push(c);
    }
    i++;
  }
  // the stress goes on the last syllable's vowel, in words of two syllables or more
  if (vowelCount >= 2) {
    const VOW = /^(?:[aeiouyɛɔɑœ]|ɥi|wa)/;
    for (let k = parts.length - 1; k >= 0; k--) {
      if (VOW.test(parts[k])) { parts[k] = 'ˈ' + parts[k]; break; }
    }
  }
  return parts.join('');
}

const ONES = ['zewo', 'en', 'de', 'twa', 'kat', 'senk', 'sis', 'sèt', 'uit', 'nèf', 'dis', 'onz', 'douz', 'trèz', 'katòz', 'kenz', 'sèz', 'disèt', 'dizuit', 'diznèf'];
const TENS = { 20: 'venn', 30: 'trant', 40: 'karant', 50: 'senkant', 60: 'swasant', 80: 'katreven' };
export function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const ten = n - (n % 10);
    const unit = n % 10;
    if (ten === 70) return unit ? `swasant ${numberToWords(10 + unit)}` : 'swasant dis';
    if (ten === 90) return unit ? `katreven ${numberToWords(10 + unit)}` : 'katreven dis';
    return unit ? `${TENS[ten]} ${unit === 1 ? 'en' : ONES[unit]}` : TENS[ten];
  }
  if (n < 1000) { const h = Math.floor(n / 100); return `${h === 1 ? 'san' : ONES[h] + ' san'}${n % 100 ? ' ' + numberToWords(n % 100) : ''}`; }
  if (n < 1e6) { const k = Math.floor(n / 1000); return `${k === 1 ? 'mil' : numberToWords(k) + ' mil'}${n % 1000 ? ' ' + numberToWords(n % 1000) : ''}`; }
  if (n < 1e12) { const k = Math.floor(n / 1e6); return `${numberToWords(k)} milyon${n % 1e6 ? ' ' + numberToWords(n % 1e6) : ''}`; }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

export function phonemizeCreole(text) {
  return mapWords(digitsToWords(text, numberToWords), (w) => word(w));
}
