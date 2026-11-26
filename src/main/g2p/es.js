// Spanish (Latin American, with seseo and yeismo) by rules: letters to the phonemes the speech model knows. Spanish spelling is nearly
// phonetic, so the rules are short: the stress comes from the accent mark or the ending, i and u beside a strong vowel are glides, and
// b d g between vowels are soft (β ð ɣ).

import { digitsToWords, mapWords } from './common.js';

const VOWELS = 'aeiouáéíóú';
const isVowel = (c) => c !== undefined && VOWELS.includes(c);
const isWeak = (c) => c === 'i' || c === 'u'; // unaccented i and u: the ones that make diphthongs
const BASE = { á: 'a', é: 'e', í: 'i', ó: 'o', ú: 'u' };
// Small words that are said without stress.
const UNSTRESSED = new Set(['el', 'la', 'los', 'las', 'un', 'una', 'de', 'del', 'en', 'y', 'e', 'o', 'u', 'a', 'al', 'que', 'se', 'lo', 'le', 'les', 'me', 'te', 'nos', 'os', 'mi', 'tu', 'su', 'mis', 'tus', 'sus', 'por', 'con', 'sin', 'si', 'ni', 'ya', 'es', 'son', 'fue', 'ha', 'he', 'va', 've', 'di', 'da', 'ti']);

// The vowel groups of a word: [{ from, to }] in letters, a diphthong being one group.
function nuclei(chars) {
  const out = [];
  let i = 0;
  while (i < chars.length) {
    if (!isVowel(chars[i])) { i++; continue; }
    let j = i;
    while (j + 1 < chars.length && isVowel(chars[j + 1]) && (isWeak(chars[j]) || isWeak(chars[j + 1]))) j++;
    out.push({ from: i, to: j });
    i = j + 1;
  }
  return out;
}

// Which letter carries the stress.
function stressedAt(chars, groups) {
  for (const g of groups) for (let k = g.from; k <= g.to; k++) if (BASE[chars[k]]) return strong(chars, g);
  if (groups.length < 2) return -1;
  const last = chars[chars.length - 1];
  const g = 'aeiouns'.includes(last) ? groups[groups.length - 2] : groups[groups.length - 1];
  return strong(chars, g);
}
// Inside a diphthong the stress is on the strong vowel (or the second of two weak ones).
function strong(chars, g) {
  for (let k = g.from; k <= g.to; k++) if (!isWeak(chars[k])) return k;
  return g.to;
}

function word(raw) {
  let w = raw.normalize('NFC');
  // u is silent in que qui gue gui; gü is gw; ɡ is a g that is always hard
  w = w.replace(/qu(?=[eiéí])/g, 'k').replace(/gu(?=[eiéí])/g, 'ɡ').replace(/gü/g, 'ɡw').replace(/ch/g, 'ʧ').replace(/ll/g, 'ʝ').replace(/rr/g, 'R').replace(/cc(?=[eiéí])/g, 'ks');
  const chars = [...w];
  const groups = nuclei(chars);
  const bare = chars.map((c) => BASE[c] ?? c).join('');
  const stress = UNSTRESSED.has(raw) ? -1 : stressedAt(chars, groups);
  const nucleusOf = (i) => groups.find((g) => i >= g.from && i <= g.to);
  const parts = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const afterVowel = isVowel(prev) || prev === 'w' || prev === 'j';
    const initial = i === 0;
    let p;
    if (isVowel(c)) {
      const base = BASE[c] ?? c;
      const g = nucleusOf(i);
      const glide = g && g.to > g.from && isWeak(c) && (i !== strong(chars, g) || false);
      p = glide ? (base === 'i' ? 'j' : 'w') : base;
    } else {
      switch (c) {
        case 'ü': p = 'w'; break;
        case 'b': case 'v': p = initial || !(afterVowel || 'lrɾ'.includes(prev ?? ' ')) || prev === 'n' || prev === 'm' ? 'b' : 'β'; break;
        case 'c': p = 'eiéí'.includes(next ?? '-') ? 's' : 'k'; break;
        case 'd': p = initial || prev === 'n' || prev === 'l' ? 'd' : 'ð'; break;
        case 'g': p = 'eiéí'.includes(next ?? '-') ? 'x' : (initial || prev === 'n' ? 'ɡ' : 'ɣ'); break;
        case 'ɡ': p = initial || prev === 'n' ? 'ɡ' : 'ɣ'; break;
        case 'h': p = ''; break;
        case 'j': p = 'x'; break;
        case 'k': case 'q': p = 'k'; break;
        case 'n': p = 'kgɡxj'.includes(next ?? '-') ? 'ŋ' : 'n'; break;
        case 'ñ': p = 'ɲ'; break;
        case 'r': p = initial || 'nls'.includes(prev ?? '-') ? 'r' : 'ɾ'; break;
        case 'R': p = 'r'; break;
        case 's': case 'z': p = 's'; break;
        case 'x': p = initial ? 's' : 'ks'; break;
        case 'y': p = i === chars.length - 1 ? (afterVowel ? 'j' : 'i') : chars.length === 1 ? 'i' : 'ʝ'; break;
        case 'w': p = 'w'; break;
        default: p = c; // f l m p t ʧ ʝ and the rest map to themselves
      }
    }
    // ʝ: the stress sign goes before the vowel, never before a consonant
    parts.push(p);
  }
  // the weak vowels of 'hi' + vowel and 'hu' + vowel at the start are glides (hielo, huevo)
  if (/^h[iu][aeoáéó]/.test(raw)) { const k = 1; parts[k] = parts[k] === 'i' ? 'j' : parts[k] === 'u' ? 'w' : parts[k]; }
  if (stress >= 0) parts[stress] = 'ˈ' + parts[stress];
  void bare;
  return parts.join('');
}

const ONES = ['cero', 'uno', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve', 'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete', 'dieciocho', 'diecinueve', 'veinte', 'veintiuno', 'veintidós', 'veintitrés', 'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve'];
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa'];
const HUNDREDS = ['', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos', 'seiscientos', 'setecientos', 'ochocientos', 'novecientos'];
export function numberToWords(n) {
  if (n < 30) return ONES[n];
  if (n < 100) return n % 10 ? `${TENS[Math.floor(n / 10)]} y ${ONES[n % 10]}` : TENS[n / 10];
  if (n === 100) return 'cien';
  if (n < 1000) return `${HUNDREDS[Math.floor(n / 100)]}${n % 100 ? ' ' + numberToWords(n % 100) : ''}`;
  if (n < 1e6) { const k = Math.floor(n / 1000); return `${k === 1 ? 'mil' : numberToWords(k).replace(/uno$/, 'un') + ' mil'}${n % 1000 ? ' ' + numberToWords(n % 1000) : ''}`; }
  if (n < 1e12) { const k = Math.floor(n / 1e6); return `${k === 1 ? 'un millón' : numberToWords(k).replace(/uno$/, 'un') + ' millones'}${n % 1e6 ? ' ' + numberToWords(n % 1e6) : ''}`; }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

export function phonemizeSpanish(text) {
  return mapWords(digitsToWords(text, numberToWords), (w) => word(w));
}
