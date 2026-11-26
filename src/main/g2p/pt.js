// Portuguese (Brazilian) by rules: letters to the phonemes the speech model knows. The stress is on the last syllable of words ending in
// r l z i u or a nasal, and on the next to last otherwise (an accent mark overrides both); unstressed final e and o are said i and u;
// t and d before i are ch and j; nasal vowels come from ã õ and from vowels before m or n.

import { digitsToWords, mapWords } from './common.js';

const VOWELS = 'aeiouáâãàéêíóôõúü';
const isV = (c) => c !== undefined && VOWELS.includes(c);
const ACCENTED = 'áâãàéêíóôõú';
const WEAK = 'iu';
const UNSTRESSED = new Set(['o', 'a', 'os', 'as', 'um', 'uma', 'de', 'do', 'da', 'dos', 'das', 'em', 'no', 'na', 'nos', 'nas', 'e', 'que', 'se', 'me', 'te', 'lhe', 'com', 'por', 'para', 'pra', 'mas', 'ou', 'ao', 'aos', 'meu', 'seu', 'teu', 'eu', 'tu', 'ele', 'ela']);

function nuclei(chars) {
  const out = [];
  let i = 0;
  while (i < chars.length) {
    if (!isV(chars[i])) { i++; continue; }
    let j = i;
    while (j + 1 < chars.length && isV(chars[j + 1]) && ((WEAK.includes(chars[j]) || WEAK.includes(chars[j + 1])) || (chars[j] === 'ã' && chars[j + 1] === 'o') || (chars[j] === 'õ' && chars[j + 1] === 'e') || (chars[j] === 'ã' && chars[j + 1] === 'e'))) j++;
    out.push({ from: i, to: j });
    i = j + 1;
  }
  return out;
}
const heavy = (chars, g) => { for (let k = g.from; k <= g.to; k++) if (!WEAK.includes(chars[k])) return k; return g.to; };

function word(raw) {
  let w = raw.normalize('NFC');
  if (w.includes("'") || w.includes('-')) return w.split(/['-]/).filter(Boolean).map(word).join('');
  const orig = w;
  w = w.replace(/qu(?=[eiêé])/g, 'k').replace(/gu(?=[eiêé])/g, 'ɡ').replace(/ch/g, 'ʃ').replace(/lh/g, 'ʎ').replace(/nh/g, 'ɲ').replace(/rr/g, 'R').replace(/ss/g, 'S')
    .replace(/sc(?=[eiêé])/g, 'S').replace(/ç/g, 'S').replace(/c(?=[eiêé])/g, 'S').replace(/g(?=[eiêé])/g, 'ʒ').replace(/j/g, 'ʒ').replace(/xc?(?=[eiêé])/g, 'S');
  const chars = [...w];
  const groups = nuclei(chars);
  // the stress
  let stress = -1;
  if (!UNSTRESSED.has(orig) && groups.length) {
    const acc = groups.find((g) => { for (let k = g.from; k <= g.to; k++) if (ACCENTED.includes(chars[k])) return true; return false; });
    let g;
    if (acc) g = acc;
    else {
      const last = chars[chars.length - 1];
      const lastIsNasal = /(ão|ões|ãe|ões|ã|ãs)$/.test(orig) || /[mn]s?$/.test(orig) && orig.length > 2 && !/(am|em|ens|ns)$/.test(orig);
      g = /[rlzuiI]$/.test(orig) || /(im|um|ins|uns)$/.test(orig) || lastIsNasal || last === 'ʃ' ? groups[groups.length - 1] : (groups.length >= 2 ? groups[groups.length - 2] : groups[0]);
      if (/(ei|ou|ai|oi|au|iu)$/.test(orig)) g = groups[groups.length - 1];
    }
    if (groups.length >= 2 || acc) stress = heavy(chars, g);
  }
  const parts = [];
  const L = chars.length;
  for (let i = 0; i < L; i++) {
    const c = chars[i];
    const n1 = chars[i + 1];
    const n2 = chars[i + 2];
    const p = chars[i - 1];
    const final = i === L - 1;
    const stressed = i === stress;
    let o;
    // a vowel before m or n (and then a consonant or the end of the word) is nasal
    const nasalNext = (n1 === 'm' || n1 === 'n') && !isV(n2) && n2 !== 'h' && 'aeiou'.includes(c);
    if (isV(c)) {
      if (c === 'ã' || c === 'õ') o = c === 'ã' ? 'ɐ̃' : 'õ';
      else if (nasalNext) { o = { a: 'ɐ̃', e: 'ẽ', i: 'ĩ', o: 'õ', u: 'ũ' }[c]; parts.push((stressed ? 'ˈ' : '') + o); i++; continue; }
      else {
        const g = groups.find((x) => i >= x.from && i <= x.to);
        const glide = g && g.to > g.from && WEAK.includes(c) && i !== heavy(chars, g);
        if (glide) o = c === 'i' ? 'j' : 'w';
        else if (c === 'a' || c === 'á' || c === 'à') o = stressed || !final ? 'a' : 'ɐ';
        else if (c === 'â') o = 'ɐ';
        else if (c === 'e') o = final && !stressed ? 'i' : (stressed || i === 0 ? 'e' : 'e');
        else if (c === 'é') o = 'ɛ';
        else if (c === 'ê') o = 'e';
        else if (c === 'o') o = final && !stressed ? 'u' : 'o';
        else if (c === 'ó') o = 'ɔ';
        else if (c === 'ô') o = 'o';
        else if (c === 'i' || c === 'í') o = 'i';
        else if (c === 'u' || c === 'ú' || c === 'ü') o = 'u';
        else o = c;
      }
      // the end -ão / -õe: a nasal vowel and a glide
      if (c === 'ã' && n1 === 'o') { parts.push((stressed ? 'ˈ' : '') + 'ɐ̃w̃'); i++; continue; }
      if (c === 'õ' && n1 === 'e') { parts.push((stressed ? 'ˈ' : '') + 'õj̃'); i++; continue; }
      if (c === 'ã' && n1 === 'e') { parts.push((stressed ? 'ˈ' : '') + 'ɐ̃j̃'); i++; continue; }
      parts.push((stressed && o ? 'ˈ' : '') + o);
      continue;
    }
    switch (c) {
      case 'b': o = 'b'; break;
      case 'c': o = 'k'; break;
      case 'S': o = 's'; break;
      case 'R': o = 'ʁ'; break;
      case 'd': o = 'iíe'.includes(n1 ?? '-') && (n1 !== 'e' || i + 2 === L) ? 'ʤ' : 'd'; break;
      case 't': o = 'iíe'.includes(n1 ?? '-') && (n1 !== 'e' || i + 2 === L) ? 'ʧ' : 't'; break;
      case 'f': o = 'f'; break;
      case 'g': o = 'ɡ'; break;
      case 'h': o = ''; break;
      case 'k': case 'q': o = 'k'; break;
      case 'l': o = isV(n1) ? 'l' : 'w'; break;
      case 'm': o = 'm'; break;
      case 'n': o = 'n'; break;
      case 'p': o = 'p'; break;
      case 'r': o = i === 0 || 'nls'.includes(p ?? '-') ? 'ʁ' : (isV(n1) ? 'ɾ' : 'ʁ'); break;
      case 's': o = isV(p) && isV(n1) ? 'z' : 's'; break;
      case 'v': o = 'v'; break;
      case 'w': o = 'w'; break;
      case 'x': o = isV(p) && isV(n1) ? 'ʃ' : 'ks'; break;
      case 'y': o = 'i'; break;
      case 'z': o = 'z'; break;
      default: o = c; // ʃ ʎ ɲ ʒ ɡ stay
    }
    parts.push(o);
  }
  return parts.join('');
}

const ONES = ['zero', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove', 'dez', 'onze', 'doze', 'treze', 'catorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
const TENS = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta', 'oitenta', 'noventa'];
const HUND = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];
export function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 100) return n % 10 ? `${TENS[Math.floor(n / 10)]} e ${ONES[n % 10]}` : TENS[n / 10];
  if (n === 100) return 'cem';
  if (n < 1000) return `${HUND[Math.floor(n / 100)]}${n % 100 ? ' e ' + numberToWords(n % 100) : ''}`;
  if (n < 1e6) { const k = Math.floor(n / 1000); return `${k === 1 ? 'mil' : numberToWords(k) + ' mil'}${n % 1000 ? (n % 1000 < 100 || n % 100 === 0 ? ' e ' : ' ') + numberToWords(n % 1000) : ''}`; }
  if (n < 1e12) { const k = Math.floor(n / 1e6); return `${numberToWords(k)} ${k === 1 ? 'milhão' : 'milhões'}${n % 1e6 ? ' ' + numberToWords(n % 1e6) : ''}`; }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

export function phonemizePortuguese(text) {
  return mapWords(digitsToWords(text, numberToWords), (w) => word(w));
}
