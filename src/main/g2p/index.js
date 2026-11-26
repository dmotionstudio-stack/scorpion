// The letters-to-sounds rules, by language, and the Kokoro voices that speak them. English is not here: it goes through eSpeak (the
// kokoro-js package). Everything else is phonemized by these rules and spoken by one of Kokoro's own voices for that language, which
// already ship with the app (no download), instead of by a separate small voice per language.

import { phonemizeFrench } from './fr.js';
import { phonemizeSpanish } from './es.js';
import { phonemizeItalian } from './it.js';
import { phonemizePortuguese } from './pt.js';
import { phonemizeHindi } from './hi.js';
import { phonemizeCreole } from './ht.js';

// language id (Scorpion's, as in voice.js) -> { phonemize, voices: [{ id, name }] }. The first voice is the default.
export const KOKORO_LANGUAGES = {
  fr: { phonemize: phonemizeFrench, voices: [{ id: 'ff_siwis', name: 'Siwis (female)' }] },
  ht: { phonemize: phonemizeCreole, voices: [{ id: 'ff_siwis', name: 'Siwis (female)' }] },
  es: { phonemize: phonemizeSpanish, voices: [{ id: 'ef_dora', name: 'Dora (female)' }, { id: 'em_alex', name: 'Alex (male)' }, { id: 'em_santa', name: 'Santa (male)' }] },
  it: { phonemize: phonemizeItalian, voices: [{ id: 'if_sara', name: 'Sara (female)' }, { id: 'im_nicola', name: 'Nicola (male)' }] },
  pt: { phonemize: phonemizePortuguese, voices: [{ id: 'pf_dora', name: 'Dora (female)' }, { id: 'pm_alex', name: 'Alex (male)' }, { id: 'pm_santa', name: 'Santa (male)' }] },
  hi: { phonemize: phonemizeHindi, voices: [{ id: 'hf_alpha', name: 'Alpha (female)' }, { id: 'hf_beta', name: 'Beta (female)' }, { id: 'hm_omega', name: 'Omega (male)' }, { id: 'hm_psi', name: 'Psi (male)' }] },
};

// The phonemes of a text in a language, in the form the model's tokenizer wants (combining marks apart from their letters).
export function phonemes(languageId, text) {
  const lang = KOKORO_LANGUAGES[languageId];
  return lang ? lang.phonemize(text).normalize('NFD') : null;
}

export const hasKokoroVoice = (languageId) => Boolean(KOKORO_LANGUAGES[languageId]);
export const voiceFor = (languageId, wanted) => {
  const voices = KOKORO_LANGUAGES[languageId]?.voices ?? [];
  return voices.find((v) => v.id === wanted)?.id ?? voices[0]?.id ?? null;
};
