// Shared by the letters-to-sounds rules (one file per language): the speech model (Kokoro) is told how to say a text as a string of
// phonemes. English comes from eSpeak (the kokoro-js package); the other languages are done here, by rules, so that nothing GPL has
// to be shipped and no extra voice has to be downloaded.

// Punctuation the speech model knows (and that gives it its pauses); everything else that is not a letter is a space.
const KEEP = /[;:,.!?¡¿—…"«»“”()]/;

// Maps a text to phonemes word by word: wordToIpa(word, nextWord) for each run of letters, punctuation kept as it is.
// letters: a RegExp source for what counts as a letter of the language.
export function mapWords(text, wordToIpa, letters = "\\p{L}\\p{M}") {
  const re = new RegExp(`[${letters}]+(?:['’-][${letters}]+)*`, 'gu');
  const out = [];
  let last = 0;
  const words = [];
  for (const m of text.matchAll(re)) words.push({ word: m[0], at: m.index, end: m.index + m[0].length });
  const sep = (from, to) => {
    // what is between two words: punctuation stays, a space or anything else becomes one space
    let s = '';
    for (const ch of text.slice(from, to).replace(/[‘’]/g, "'")) {
      if (ch === '«') s += '“';
      else if (ch === '»') s += '”';
      else if (ch === '¡' || ch === '¿') continue; // the speech model has no such signs
      else if (KEEP.test(ch)) s += ch;
      else if (/\s/.test(ch) && !s.endsWith(' ')) s += ' ';
    }
    return s.replace(/ +/g, ' ');
  };
  words.forEach((w, i) => {
    out.push(sep(last, w.at));
    out.push(wordToIpa(w.word.toLowerCase(), words[i + 1]?.word.toLowerCase() ?? '', i));
    last = w.end;
  });
  out.push(sep(last, text.length));
  return out.join('').replace(/ +/g, ' ').trim();
}

// Numbers are spoken as words, so each language gives a function for its own.
export const digitsToWords = (text, toWords) => String(text).replace(/\d+(?:[.,]\d+)?/g, (n) => {
  const [whole, frac] = n.replace(',', '.').split('.');
  if (whole.length > 12) return n.split('').map((d) => toWords(Number(d))).join(' ');
  return frac === undefined ? toWords(Number(whole)) : `${toWords(Number(whole))} ${frac.split('').map((d) => toWords(Number(d))).join(' ')}`;
});
