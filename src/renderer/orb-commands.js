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

// What Scorpion says when it is called by name and nothing else ("Scorpion"). Time of
// day in English; a short "yes, I'm listening" in the languages with a line here, and a
// plain "Yes?" for the rest. pick: a function giving 0 to 1 (for tests).
const CALLED = {
  fr: ['Oui ? Je vous écoute.', 'Je suis là. Que puis-je faire ?'],
  es: ['¿Sí? Te escucho.', 'Aquí estoy. ¿En qué puedo ayudarte?'],
  pt: ['Sim? Estou ouvindo.', 'Estou aqui. Como posso ajudar?'],
  de: ['Ja? Ich höre zu.', 'Ich bin da. Wie kann ich helfen?'],
};
export function callGreeting({ hour = new Date().getHours(), lang = 'en', pick = Math.random } = {}) {
  const l = String(lang || 'en').toLowerCase().split('-')[0];
  const options = l === 'en'
    ? [`${hour < 5 ? 'Good evening' : hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'}. How can I help?`, 'Yes? I’m listening.', 'Hi. How can I help?']
    : CALLED[l] || ['Yes?'];
  return options[Math.min(options.length - 1, Math.floor(pick() * options.length))];
}

// Things the orb answers or does at once, without the model: the time, the date, the volume. English only (the
// other languages go to the model). now: a Date (for tests). Returns { say, volume? } or null.
const TIME_Q = /^(?:what(?:'s| is)? the time|what time is it|tell me the time|do you have the time|what(?:'s| is) the time now|time please|current time)(?: now| right now| please)?$/;
const DATE_Q = /^(?:what(?:'s| is)? (?:the )?(?:date|day)(?: is it)?(?: today)?|what day is it(?: today)?|what is today'?s date|today'?s date|what(?:'s| is) today)(?: please)?$/;
const VOL_UP = /^(?:(?:turn|put|pump|crank)? ?(?:the )?(?:volume|sound) up|(?:turn|put) it up|louder|volume up|raise the volume|increase the volume)(?: a bit| a little| please)?$/;
const VOL_DOWN = /^(?:(?:turn|put|bring)? ?(?:the )?(?:volume|sound) down|(?:turn|put) it down|quieter|softer|volume down|lower the volume|decrease the volume)(?: a bit| a little| please)?$/;
const MUTE = /^(?:mute|mute (?:the )?(?:volume|sound|it)|unmute|unmute (?:the )?(?:volume|sound|it)|toggle (?:the )?(?:mute|sound))(?: please)?$/;
export function instantCommand(text, { now = new Date(), lang = 'en' } = {}) {
  if (String(lang || 'en').toLowerCase().split('-')[0] !== 'en') return null;
  const t = clean(text).replace(/^(?:hey |ok |okay )?(?:scorpion )?(?:please )?/, '').trim();
  if (!t) return null;
  if (TIME_Q.test(t)) return { say: `It's ${now.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}.` };
  if (DATE_Q.test(t)) return { say: `Today is ${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}.` };
  if (VOL_UP.test(t)) return { say: 'Louder.', volume: 'up' };
  if (VOL_DOWN.test(t)) return { say: 'Quieter.', volume: 'down' };
  if (MUTE.test(t)) return { say: /^un/.test(t) ? 'Sound on.' : 'Muted.', volume: 'mute' };
  return null;
}

// More things done without the model: open an installed app by name, a screenshot, dark or light mode, the battery.
// Returns { open: 'name' } | { intent: 'screenshot' | 'dark-mode' | 'light-mode', say } | { battery: true } or null. English only.
// (The app name is matched against the installed apps by bestApp: no match, and the model gets the request.)
const OPEN_APP = /^(?:open|launch|start|run)(?: up)?(?: the| my)? (.+?)(?: app| application)?$/;
export function parseAction(text, { lang = 'en' } = {}) {
  if (String(lang || 'en').toLowerCase().split('-')[0] !== 'en') return null;
  const t = clean(text).replace(/^(?:hey |ok |okay )?(?:scorpion )?(?:please )?/, '').replace(/ please$/, '').trim();
  if (!t) return null;
  if (/^(?:take (?:a )?(?:screenshot|screen shot)|screenshot|capture the screen)$/.test(t)) return { intent: 'screenshot', say: 'Taking a screenshot.' };
  if (/^(?:(?:switch|go|turn) to dark (?:mode|theme)|(?:turn on|enable) dark (?:mode|theme)|dark (?:mode|theme)(?: on)?|night mode)$/.test(t)) return { intent: 'dark-mode', say: 'Dark mode.' };
  if (/^(?:(?:switch|go|turn) to light (?:mode|theme)|(?:turn on|enable) light (?:mode|theme)|light (?:mode|theme)(?: on)?|day mode)$/.test(t)) return { intent: 'light-mode', say: 'Light mode.' };
  if (/^(?:what(?:'s| is) (?:my |the )?battery(?: level| at| percentage)?|how much battery(?: do i have| is left| left| power)?|battery level|battery status)$/.test(t)) return { battery: true };
  const m = OPEN_APP.exec(t);
  if (m && m[1].split(' ').length <= 4) return { open: m[1] };
  return null;
}

// The installed app a spoken name means: an exact name, then one that starts with it, then a word of it, then one containing it.
// apps: [{ name, id }]. Null when nothing fits well (the model then gets the request).
export function bestApp(query, apps) {
  const q = clean(query);
  if (!q || q.length < 2) return null;
  let best = null;
  for (const app of apps || []) {
    const n = clean(app.name);
    const score = n === q ? 100 : n.startsWith(q) ? 80 - Math.min(30, n.length - q.length) / 3 : n.split(' ').some((w) => w.startsWith(q)) ? 60 : q.length >= 4 && n.includes(q) ? 40 : 0;
    if (score && (!best || score > best.score || (score === best.score && n.length < clean(best.app.name).length))) best = { app, score };
  }
  return best && best.score >= 40 ? best.app : null;
}

const OPENERS =/^(?:please )?(?:open|show(?: me)?|go to|switch to|bring up|take me to|launch)(?: the| my)? /;
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
