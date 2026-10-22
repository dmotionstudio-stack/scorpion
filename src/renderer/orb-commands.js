// What the orb understands without asking the model: the wake word, a spoken
// yes or no for approvals, and the names of the shortcuts around it. Plain
// functions (no page access), so they are tested on their own.

const clean = (text) => String(text || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/[^a-z0-9' ]+/g, ' ').replace(/\s+/g, ' ').trim();

// Whisper writes the name a few ways.
const WAKE = /^(?:(?:hey|hi|ok|okay|yo) )?(?:scorpion|scorpions|scorpio|scorpian|scorpeon|scorpio n)\b ?(.*)$/;

// "Scorpion" alone → { command: '' }; "Hey Scorpion, open files" → { command:
// 'open files' }; anything else → null.
export function parseWake(text) {
  const m = WAKE.exec(clean(text));
  return m ? { command: m[1].trim() } : null;
}

const YES = /^(?:yes|yeah|yep|yup|sure|ok|okay|do it|go ahead|allow( it)?|please do|confirm(ed)?|affirmative|of course|oui|si|sim|wi|ja)\b/;
const NO = /^(?:no|nope|nah|don'?t|do not|stop|cancel|deny|never mind|nevermind|negative|non|nein|nao|non merci)\b/;

// A spoken answer to "Should I …?": true, false, or null when unclear.
export function parseYesNo(text) {
  const t = clean(text);
  if (!t) return null;
  if (NO.test(t)) return false;
  if (YES.test(t)) return true;
  return null;
}

const OPENERS = /^(?:please )?(?:open|show(?: me)?|go to|switch to|bring up|take me to|launch)(?: the| my)? /;
const BACK = /^(?:(?:go )?back|close( it| that| this)?|home|desktop|show (?:the )?(?:orb|desktop)|minimi[sz]e( it| that| this)?)$/;

// A short command for one of the shortcuts: "files", "open my files",
// "switch to Chrome". Returns { item } for a shortcut, { back: true } for
// "back"/"close it", or null when it is a request for the model.
export function matchShortcut(text, items) {
  const t = clean(text).replace(/ please$/, '');
  if (!t) return null;
  if (BACK.test(t)) return { back: true };
  const opened = OPENERS.test(t);
  const name = t.replace(OPENERS, '').trim();
  // Only short commands: longer sentences go to the model, which has the tools.
  if (!name || name.split(' ').length > 4) return null;
  const norm = (s) => clean(s);
  const exact = items.find((i) => [i.label, ...(i.say || [])].some((n) => norm(n) === name));
  if (exact) return { item: exact };
  // Windows are matched by the start of their title only after "open"/"switch to".
  if (opened) {
    const win = items.find((i) => i.kind === 'window' && (norm(i.label).startsWith(name) || norm(i.app || '').startsWith(name)));
    if (win) return { item: win };
  }
  return null;
}

// The next window for a swipe, wrapping around.
export function nextIndex(current, count, direction) {
  if (!count) return -1;
  const step = direction === 'left' ? -1 : 1;
  return ((current < 0 ? (step > 0 ? -1 : 0) : current) + step + count) % count;
}
