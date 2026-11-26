// French by rules: letters to the phonemes the speech model knows. French spelling is deep (silent endings, nasal vowels, many
// spellings for one sound), so this is a compact rule set plus a list of the common words the rules would get wrong. It is made for
// being understood, not for dictionary accuracy: liaison between words is left out.

import { digitsToWords, mapWords } from './common.js';

const VOWELS = 'aeiouyàâäéèêëîïôöùûüœ';
const isV = (c) => c !== undefined && VOWELS.includes(c);

// Small words, said without stress (the rules would mispronounce several of them).
const FUNCTION = {
  le: 'lə', la: 'la', les: 'le', de: 'də', des: 'de', du: 'dy', un: 'œ̃', une: 'yn', et: 'e', est: 'ɛ', es: 'ɛ', a: 'a', 'à': 'a', au: 'o', aux: 'o',
  en: 'ɑ̃', je: 'ʒə', tu: 'ty', il: 'il', elle: 'ɛl', nous: 'nu', vous: 'vu', ils: 'il', elles: 'ɛl', on: 'ɔ̃', me: 'mə', te: 'tə', se: 'sə',
  ce: 'sə', ces: 'se', ses: 'se', mes: 'me', tes: 'te', mon: 'mɔ̃', ton: 'tɔ̃', son: 'sɔ̃', ma: 'ma', ta: 'ta', sa: 'sa', ne: 'nə', que: 'kə',
  qui: 'ki', dans: 'dɑ̃', par: 'paʁ', pour: 'puʁ', sur: 'syʁ', sous: 'su', avec: 'avɛk', sans: 'sɑ̃', mais: 'mɛ', ou: 'u', 'où': 'u', donc: 'dɔ̃k',
  car: 'kaʁ', si: 'si', oui: 'wi', non: 'nɔ̃', pas: 'pa', plus: 'ply', ni: 'ni', y: 'i', ça: 'sa', 'là': 'la', lui: 'lɥi', leur: 'lœʁ', leurs: 'lœʁ',
  ai: 'e', as: 'a', ont: 'ɔ̃', sont: 'sɔ̃', suis: 'sɥi', fait: 'fɛ', tout: 'tu', tous: 'tus', très: 'tʁɛ', bien: 'bjɛ̃', comme: 'kɔm', quoi: 'kwa',
  quand: 'kɑ̃', comment: 'kɔmɑ̃', combien: 'kɔ̃bjɛ̃', pourquoi: 'puʁkwa', aujourd: 'oʒuʁd', hui: 'ɥi', monsieur: 'məsjø', madame: 'madam', mademoiselle: 'madmwazɛl',
  ordinateur: 'ɔʁdinatœʁ', femme: 'fam', fils: 'fis', plusieurs: 'plyzjœʁ', deux: 'dø', six: 'sis', dix: 'dis', huit: 'ɥit', sept: 'sɛt', cinq: 'sɛ̃k',
  neuf: 'nœf', vingt: 'vɛ̃', cent: 'sɑ̃', mille: 'mil', ville: 'vil', tranquille: 'tʁɑ̃kil', ouvre: 'uvʁ', œuf: 'œf', œufs: 'ø', yeux: 'jø', ciel: 'sjɛl',
  août: 'ut', temps: 'tɑ̃', corps: 'kɔʁ', alors: 'alɔʁ', souvent: 'suvɑ̃', maintenant: 'mɛ̃tənɑ̃', encore: 'ɑ̃kɔʁ', toujours: 'tuʒuʁ', jamais: 'ʒamɛ', peut: 'pø',
  veux: 'vø', veut: 'vø', peux: 'pø', eux: 'ø', ceux: 'sø', mieux: 'mjø', vieux: 'vjø', milieu: 'miljø', lieu: 'ljø', bleu: 'blø', feu: 'fø', jeu: 'ʒø',
  heure: 'œʁ', heures: 'œʁ', homme: 'ɔm', hommes: 'ɔm', femmes: 'fam', moi: 'mwa', toi: 'twa', soi: 'swa', voici: 'vwasi', voilà: 'vwala', travail: 'tʁavaj',
  ordinateurs: 'ɔʁdinatœʁ', allez: 'ale', êtes: 'ɛt', faites: 'fɛt', dites: 'dit', fichier: 'fiʃje', fichiers: 'fiʃje', dossier: 'dosje', dossiers: 'dosje',
};
// Words ending in -ent that are not a verb (the verb ending is silent).
const ENT_WORDS = new Set(['souvent', 'vent', 'dent', 'cent', 'content', 'différent', 'présent', 'parent', 'argent', 'excellent', 'évident', 'patient', 'client',
  'agent', 'urgent', 'récent', 'permanent', 'important', 'intelligent', 'puissant', 'moment', 'argument', 'document', 'instrument', 'élément', 'gouvernement', 'comment',
  'lentement', 'vraiment', 'seulement', 'rapidement', 'complètement', 'maintenant', 'ment', 'sentiment', 'événement', 'appartement', 'département', 'mouvement']);

// Letters that are said at the end of a word (the others are silent): c r f l (and q).
const FINAL_SAID = 'crflq';

function parts(w) {
  const chars = [...w];
  const out = [];
  let i = 0;
  const L = chars.length;
  const next = (k = 1) => chars[i + k];
  const prev = chars[i - 1];
  void prev;
  const isEnd = (k) => i + k >= L;
  // the last letter of the word, or the one before a plural s (enfants, grands): silent consonants there stay silent
  const finalish = () => i === L - 1 || (i === L - 2 && 'sxz'.includes(chars[L - 1]) && L > 3);
  // is the letter at i+k a vowel that follows (so an n/m there is not nasalising)
  const vowelAt = (k) => isV(chars[i + k]);
  const consAfter = (k) => i + k < L && !isV(chars[i + k]);
  while (i < L) {
    const c = chars[i];
    const n1 = next(1);
    const n2 = next(2);
    const rest = chars.slice(i).join('');
    const p = chars[i - 1];
    // -ment, -tion and friends first
    if (/^tions?$/.test(rest)) { out.push(p === 's' ? 'tjɔ̃' : 'sjɔ̃'); break; }
    if (/^ments?$/.test(rest) && i >= 3 && !/^(aiment|forment|nomment|animent|expriment|supriment)$/.test(w)) { out.push('mɑ̃'); break; }
    if (rest === 'sion' || rest === 'sions') { out.push(p && isV(p) ? 'zjɔ̃' : 'sjɔ̃'); break; }
    if (/^ement$|^ements$/.test(rest) && false) { out.push('əmɑ̃'); break; }
    if (/^ent$/.test(rest) && i > 1 && !ENT_WORDS.has(w)) { break; } // a verb's -ent: silent
    if (/^ents$/.test(rest) && ENT_WORDS.has(w.slice(0, -1))) { out.push('ɑ̃'); break; }
    if (/^(ent|ents)$/.test(rest)) { out.push('ɑ̃'); break; }
    if (rest === 'ons' && i > 0) { out.push('ɔ̃'); break; }
    if (rest === 'ez' && i > 0) { out.push('e'); break; }
    if (/^(er|ers)$/.test(rest) && i >= 2) { out.push(p === 'i' ? 'e' : 'e'); break; }
    if (rest === 'es' && i > 0) { break; }
    if (rest === 'e' && i > 0) { break; }
    if (rest === 'ée' || rest === 'ées') { out.push('e'); break; }
    if (rest === 'aient' || rest === 'ait' || rest === 'ais') { out.push('ɛ'); break; }
    if (rest === 'ai') { out.push(i > 0 ? 'e' : 'ɛ'); break; }
    if (rest === 'ille' || (rest === 'illes')) { out.push(i === 0 ? 'il' : 'ij'); break; }
    if (/^ill/.test(rest) && i > 0 && !/^(vill|mill|tranquill)/.test(w)) { out.push('ij'); i += 3; if (chars[i] === 'e' && (isEnd(1) || chars[i + 1] === 's')) i = L; continue; }
    if (rest === 'ail' || rest === 'ails') { out.push('aj'); break; }
    if (rest === 'eil' || rest === 'eils') { out.push('ɛj'); break; }
    if (rest === 'euil' || rest === 'euils') { out.push('œj'); break; }
    if (rest === 'ouil' || rest === 'ouils') { out.push('uj'); break; }
    // digraphs and trigraphs
    const three = rest.slice(0, 3);
    const two = rest.slice(0, 2);
    if (three === 'eau') { out.push('o'); i += 3; if (chars[i] === 'x') i++; continue; }
    if (three === 'oin' && !vowelAt(3)) { out.push('wɛ̃'); i += 3; continue; }
    if (three === 'ain' && !vowelAt(3) && chars[i + 3] !== 'n') { out.push('ɛ̃'); i += 3; continue; }
    if (three === 'ein' && !vowelAt(3) && chars[i + 3] !== 'n') { out.push('ɛ̃'); i += 3; continue; }
    if (three === 'aim' && !vowelAt(3) && chars[i + 3] !== 'm') { out.push('ɛ̃'); i += 3; continue; }
    if (three === 'ien' && !vowelAt(3) && chars[i + 3] !== 'n') { out.push('jɛ̃'); i += 3; continue; }
    if (three === 'oeu' || two === 'œu') { out.push(isEnd(three === 'oeu' ? 3 : 2) || /^(œ?u|oeu)(x|s|z)?$/.test(rest) ? 'ø' : 'œ'); i += two === 'œu' ? 2 : 3; continue; }
    if (three === 'sch') { out.push('ʃ'); i += 3; continue; }
    if (two === 'ou' || two === 'où') { out.push(chars[i + 2] === 'i' && !vowelAt(3) ? 'wi' : 'u'); i += chars[i + 2] === 'i' && !vowelAt(3) ? 3 : 2; continue; }
    if (two === 'oi') { out.push('wa'); i += 2; continue; }
    if (two === 'au') { out.push('o'); i += 2; continue; }
    if (two === 'eu') { out.push(/^eu(r|l|f|v|n|m|g|c|p|b|j|t|d)/.test(rest) && !/^eu(r?e|ses?)$/.test(rest) && !/^eu(s|se)$/.test(rest) ? (/^eu(se|ses)$/.test(rest) ? 'ø' : 'œ') : 'ø'); i += 2; continue; }
    if (two === 'aî') { out.push('ɛ'); i += 2; continue; }
    if (two === 'ai' || two === 'ei' || two === 'ay') { out.push(two === 'ay' ? 'ɛj' : 'ɛ'); i += 2; continue; }
    if (two === 'ch') { out.push('ʃ'); i += 2; continue; }
    if (two === 'ph') { out.push('f'); i += 2; continue; }
    if (two === 'gn') { out.push('ɲ'); i += 2; continue; }
    if (two === 'qu') { out.push('k'); i += 2; continue; }
    if (two === 'th') { out.push('t'); i += 2; continue; }
    if (two === 'ck') { out.push('k'); i += 2; continue; }
    if (two === 'ss') { out.push('s'); i += 2; continue; }
    if (two === 'cc' && 'eiy'.includes(chars[i + 2] ?? '-')) { out.push('ks'); i += 2; continue; }
    if (two === 'sc' && 'eiy'.includes(chars[i + 2] ?? '-')) { out.push('s'); i += 2; continue; }
    if (two === 'gu' && 'eiéèêy'.includes(chars[i + 2] ?? '-')) { out.push('ɡ'); i += 2; continue; }
    if (two === 'ge' && 'aou'.includes(chars[i + 2] ?? '-')) { out.push('ʒ'); i += 2; continue; }
    if (two === 'ei') { out.push('ɛ'); i += 2; continue; }
    // doubled consonants say once
    if (c === chars[i + 1] && !isV(c) && c !== 'c') { i++; continue; }
    // nasal vowels: a vowel then n or m before a consonant (not n/m) or at the end
    if ('nm'.includes(n1 ?? '-') && 'aeiouy'.includes(c)) {
      const nasalOk = !vowelAt(2) && !('nm'.includes(n2 ?? '-') && n2 !== undefined);
      const hasFollow = i + 2 >= L ? true : !isV(chars[i + 2]);
      if (nasalOk && hasFollow) {
        const map = { a: 'ɑ̃', e: 'ɑ̃', i: 'ɛ̃', y: 'ɛ̃', o: 'ɔ̃', u: 'œ̃' };
        out.push(map[c]);
        i += 2;
        continue;
      }
    }
    switch (c) {
      case 'a': case 'à': case 'â': out.push('a'); break;
      case 'ä': out.push('a'); break;
      case 'é': out.push('e'); break;
      case 'è': case 'ê': case 'ë': out.push('ɛ'); break;
      case 'e': {
        // end of a word: silent (the ending rules above); before two consonants or a said final consonant: open ɛ
        const afterIsCluster = consAfter(1) && consAfter(2) && !'lr'.includes(chars[i + 2] ?? '-') ;
        const finalSaid = i + 2 === L && FINAL_SAID.includes(n1 ?? '-');
        const finalConsOnly = i + 1 < L && !isV(n1) && (i + 2 >= L || (i + 3 >= L && chars[i + 2] === 's'));
        if (i === L - 1) break; // a final e is silent
        if (afterIsCluster || finalSaid) out.push('ɛ');
        else if (finalConsOnly && FINAL_SAID.includes(n1)) out.push('ɛ');
        else out.push('ə');
        break;
      }
      case 'i': case 'î': case 'ï': out.push(isV(n1) && !isV(p) && 'aeouéèêôûà'.includes(n1) && i > 0 ? 'j' : 'i'); break;
      case 'o': case 'ô': {
        const closed = c === 'ô' || i === L - 1 || (n1 === 's' && isV(n2) && n2 !== undefined) || (n1 === 's' && i + 2 >= L) || (n1 === 'z');
        out.push(closed ? 'o' : 'ɔ');
        break;
      }
      case 'œ': out.push('œ'); break;
      case 'u': case 'û': case 'ü': out.push(isV(n1) && 'aeoéè'.includes(n1) && !isV(p) && p !== undefined && p !== 'q' && p !== 'g' ? 'ɥ' : 'y'); break;
      case 'y': out.push(isV(n1) && i === 0 ? 'j' : isV(n1) && isV(p) ? 'j' : 'i'); break;
      case 'b': out.push(finalish() && L > 1 ? '' : 'b'); break;
      case 'c': out.push('eiyéèêî'.includes(n1 ?? '-') ? 's' : (i === L - 1 ? (L > 2 ? 'k' : 'k') : 'k')); break;
      case 'ç': out.push('s'); break;
      case 'd': out.push(finalish() && L > 1 ? '' : 'd'); break;
      case 'f': out.push('f'); break;
      case 'g': out.push('eiyéèê'.includes(n1 ?? '-') ? 'ʒ' : (finalish() && L > 1 ? '' : 'ɡ')); break;
      case 'h': break;
      case 'j': out.push('ʒ'); break;
      case 'k': out.push('k'); break;
      case 'l': out.push('l'); break;
      case 'm': out.push('m'); break;
      case 'n': out.push('n'); break;
      case 'p': out.push(finalish() && L > 2 ? '' : 'p'); break;
      case 'q': out.push('k'); break;
      case 'r': out.push('ʁ'); break;
      case 's': out.push(i === L - 1 && L > 1 ? '' : (isV(p) && isV(n1) ? 'z' : 's')); break;
      case 't': out.push(finalish() && L > 1 ? '' : 't'); break;
      case 'v': out.push('v'); break;
      case 'w': out.push('v'); break;
      case 'x': out.push(i === L - 1 && L > 1 ? '' : (i === 0 ? 'ɡz' : 'ks')); break;
      case 'z': out.push(i === L - 1 && L > 2 ? '' : 'z'); break;
      case '-': case "'": break;
      default: out.push(c);
    }
    i++;
  }
  return out;
}

function word(raw) {
  const w = raw.normalize('NFC').replace(/’/g, "'");
  if (FUNCTION[w]) return FUNCTION[w];
  // l'ordinateur, qu'il, c'est, vingt-cinq, après-midi: each part by itself, only the last one stressed
  if (/['-]/.test(w)) {
    const pieces = w.split(/['-]/).filter(Boolean);
    return pieces.map((p, k) => {
      if (p === 'vingt' && k < pieces.length - 1) return 'vɛ̃t';
      const last = k === pieces.length - 1;
      return wordPart(p, last && w.indexOf("'") < 0 ? true : last);
    }).join('');
  }
  return wordPart(w, true);
}
function wordPart(w, stress = true) {
  if (!w) return '';
  const lone = { l: 'l', d: 'd', j: 'ʒ', n: 'n', m: 'm', t: 't', s: 's', c: 's', qu: 'k', jusqu: 'ʒysk', lorsqu: 'lɔʁsk', puisqu: 'pɥisk' };
  if (lone[w]) return lone[w];
  if (FUNCTION[w]) return FUNCTION[w];
  const ph = parts(w);
  // the stress goes on the last pronounced vowel, in words of two syllables or more
  const VOW = /^(?:[aeiouyɛɔɑœøəɥ]|wa|wɛ̃|jɛ̃)/;
  const idx = [];
  ph.forEach((p, k) => { if (VOW.test(p) && !/^ə/.test(p)) idx.push(k); });
  if (stress && idx.length >= 2) ph[idx[idx.length - 1]] = 'ˈ' + ph[idx[idx.length - 1]];
  return ph.join('');
}

const ONES = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];
export function numberToWords(n) {
  if (n < 20) return ONES[n];
  if (n < 70) { const t = Math.floor(n / 10); const u = n % 10; return u ? `${TENS[t]}${u === 1 ? ' et un' : ' ' + ONES[u]}` : TENS[t]; }
  if (n < 80) return n === 71 ? 'soixante et onze' : n === 70 ? 'soixante-dix' : `soixante ${ONES[n - 60]}`;
  if (n < 100) return n === 80 ? 'quatre-vingts' : `quatre-vingt ${n === 81 ? 'un' : numberToWords(n - 80)}`;
  if (n < 1000) { const h = Math.floor(n / 100); const r = n % 100; return `${h === 1 ? 'cent' : ONES[h] + ' cent' + (r ? '' : 's')}${r ? ' ' + numberToWords(r) : ''}`; }
  if (n < 1e6) { const k = Math.floor(n / 1000); return `${k === 1 ? 'mille' : numberToWords(k) + ' mille'}${n % 1000 ? ' ' + numberToWords(n % 1000) : ''}`; }
  if (n < 1e12) { const k = Math.floor(n / 1e6); return `${numberToWords(k)} million${k > 1 ? 's' : ''}${n % 1e6 ? ' ' + numberToWords(n % 1e6) : ''}`; }
  return String(n).split('').map((d) => ONES[Number(d)]).join(' ');
}

export function phonemizeFrench(text) {
  return mapWords(digitsToWords(text, numberToWords), (w) => word(w));
}
