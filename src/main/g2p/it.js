// Italian by rules: letters to the phonemes the speech model knows. Italian is spelled almost as it is said: c and g are soft before e and
// i, double consonants are held longer, gl and gn and sc have their own sounds, and the stress is on the next to last syllable unless an
// accent mark says otherwise.

import { digitsToWords, mapWords } from './common.js';

const VOWELS = 'aeiouàèéìòóù';
const BASE = { à: 'a', è: 'ɛ', é: 'e', ì: 'i', ò: 'ɔ', ó: 'o', ù: 'u' };
const isV = (c) => c !== undefined && VOWELS.includes(c);
const isWeak = (c) => c === 'i' || c === 'u';
const UNSTRESSED = new Set(['il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'una', 'di', 'a', 'da', 'in', 'con', 'su', 'per', 'tra', 'fra', 'e', 'o', 'ma', 'se', 'che', 'mi', 'ti', 'ci', 'vi', 'si', 'ne', 'non', 'del', 'al', 'dal', 'nel', 'sul', 'ho', 'ha', 'hai', 'sono', 'è']);

function nuclei(chars) {
  const out = [];
  let i = 0;
  while (i < chars.length) {
    if (!isV(chars[i])) { i++; continue; }
    let j = i;
    // i and u beside another vowel make a diphthong, unless the weak vowel carries the accent (ì ù)
    while (j + 1 < chars.length && isV(chars[j + 1]) && (isWeak(chars[j]) || isWeak(chars[j + 1]))) j++;
    out.push({ from: i, to: j });
    i = j + 1;
  }
  return out;
}
const heavy = (chars, g) => { for (let k = g.from; k <= g.to; k++) if (!isWeak(chars[k])) return k; return g.to; };

function word(raw) {
  let w = raw.normalize('NFC').replace(/’/g, "'");
  if (w.includes("'")) return w.split("'").map(word).join('');
  // digraphs become single marker letters first
  w = w.replace(/sci(?=[aouàòù])/g, 'ʃ').replace(/sce/g, 'ʃe').replace(/sci/g, 'ʃi').replace(/sch/g, 'sk').replace(/gli(?=[aeouàòù])/g, 'ʎ').replace(/gli/g, 'ʎi')
    .replace(/gn/g, 'ɲ').replace(/ch/g, 'k').replace(/gh/g, 'ɡ').replace(/cci(?=[aouàòù])/g, 'ʧ:').replace(/cc(?=[ei])/g, 'ʧ:').replace(/ggi(?=[aouàòù])/g, 'ʤ:').replace(/gg(?=[ei])/g, 'ʤ:')
    .replace(/ci(?=[aouàòù])/g, 'ʧ').replace(/c(?=[ei])/g, 'ʧ').replace(/gi(?=[aouàòù])/g, 'ʤ').replace(/g(?=[ei])/g, 'ʤ').replace(/qu/g, 'kw').replace(/ʃ(?=i[aouàòù])/g, 'ʃ');
  const chars = [...w];
  const groups = nuclei(chars);
  let stress = -1;
  if (!UNSTRESSED.has(raw) && groups.length >= 1) {
    const accented = groups.find((g) => { for (let k = g.from; k <= g.to; k++) if (BASE[chars[k]]) return true; return false; });
    const g = accented || (groups.length >= 2 ? groups[groups.length - 2] : groups[0]);
    if (groups.length >= 2 || accented) stress = heavy(chars, g);
  }
  const parts = [];
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const n1 = chars[i + 1];
    const p = chars[i - 1];
    let o;
    if (isV(c)) {
      const g = groups.find((x) => i >= x.from && i <= x.to);
      const glide = g && g.to > g.from && isWeak(c) && i !== heavy(chars, g) && !BASE[c];
      o = glide ? (c === 'i' ? 'j' : 'w') : (BASE[c] ?? c);
    } else {
      switch (c) {
        case 'c': o = 'k'; break;
        case 'g': o = 'ɡ'; break;
        case 'h': o = ''; break;
        case 'j': o = 'j'; break;
        case 'q': o = 'k'; break;
        case 's': o = isV(p) && isV(n1) ? 'z' : (n1 && 'bdgvlmnr'.includes(n1) ? 'z' : 's'); break;
        case 'z': o = n1 === 'z' ? 't' : p === 'z' ? 's' : 'ts'; break;
        case 'x': o = 'ks'; break;
        case 'y': o = 'i'; break;
        case 'w': o = 'w'; break;
        default: o = c;
      }
      if (c === chars[i + 1] && c !== 'z') { parts.push(''); continue; } // a double consonant: held once, marked by ː below
      if (c === p && c !== 'z' && o) o += 'ː';
    }
    parts.push(o);
  }
  if (stress >= 0) parts[stress] = 'ˈ' + parts[stress];
  return parts.join('').replace(/ʧ:/g, 'ʧː').replace(/ʤ:/g, 'ʤː');
}

const ONES = ['zero', 'uno', 'due', 'tre', 'quattro', 'cinque', 'sei', 'sette', 'otto', 'nove', 'dieci', 'undici', 'dodici', 'tredici', 'quattordici', 'quindici', 'sedici', 'diciassette', 'diciotto', 'diciannove'];
const TENS = ['', '', 'venti', 'trenta', 'quaranta', 'cinquanta', 'sessanta', 'settanta', 'ottanta', 'novanta'];
export function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) {
    const t = Math.floor(n / 10);
    const u = n % 10;
    if (!u) return TENS[t];
    const stem = u === 1 || u === 8 ? TENS[t].slice(0, -1) : TENS[t];
    return `${stem}${u === 3 ? 'tré' : ONES[u]}`;
  }
  if (n < 1000) { const h = Math.floor(n / 100); const r = n % 100; const stem = h === 1 ? 'cento' : `${ONES[h]}cento`; return r ? `${r < 90 && Math.floor(r / 10) !== 8 && r % 10 !== 1 && r % 10 !== 8 ? stem : stem.replace(/o$/, '')} ${numberToWords(r)}`.replace(/^(\S*cent)o? /, '$1o ') : stem; }
  if (n < 1e6) { const k = Math.floor(n / 1000); return `${k === 1 ? 'mille' : numberToWords(k) + 'mila'}${n % 1000 ? ' ' + numberToWords(n % 1000) : ''}`; }
  if (n < 1e12) { const k = Math.floor(n / 1e6); return `${k === 1 ? 'un milione' : numberToWords(k) + ' milioni'}${n % 1e6 ? ' ' + numberToWords(n % 1e6) : ''}`; }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

export function phonemizeItalian(text) {
  return mapWords(digitsToWords(text, numberToWords), (w) => word(w));
}
