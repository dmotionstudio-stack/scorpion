// Type what I say (Windows): what you say is typed into the app in front,
// sentence by sentence. The main window's page listens and transcribes
// (Whisper, offline; app.js); this turns each sentence into keystrokes
// through the Windows helper, and shows a small pill at the bottom of the
// screen while it listens (it never takes the keyboard or the mouse).
//
// Said aloud: "new line", "new paragraph", "delete that" (the last sentence
// typed), and "stop typing" to finish.

// A command takes the comma or space before it, never the full stop that
// ended the sentence before it, and whatever punctuation Whisper put after it.
const STOP = /(?:^|[\s,;:]+)(?:stop|end|finish)\s+(?:typing|dictation|dictating)[\s.!?]*$/i;
const UNDO = /^(?:delete|scratch|undo)\s+that[\s.!?]*$/i;
const BREAKS = [
  [/[\s,;:]*\bnew paragraph\b[\s,.;:!?]*/gi, '\n\n'],
  [/[\s,;:]*\bnew line\b[\s,.;:!?]*/gi, '\n'],
];

// One sentence as heard, as what to do: { text, stop, undo }. after: what was
// typed just before (a space goes between sentences, none after a line break).
export function dictationSteps(said, { after = '' } = {}) {
  let text = String(said ?? '').trim();
  if (UNDO.test(text)) return { text: '', stop: false, undo: true };
  const stop = STOP.test(text);
  if (stop) text = text.replace(STOP, '').trim();
  for (const [re, to] of BREAKS) text = text.replace(re, to);
  // A break at the start stays; spaces left at its edges don't.
  text = text.replace(/ *\n */g, '\n');
  if (text && after && !/\s$/.test(after) && !/^[\s.,;:!?)]/.test(text)) text = ` ${text}`;
  return { text, stop, undo: false };
}

// deps: { BrowserWindow, screen, call(cmd, ...args) (the Windows helper),
//         url (the pill's page), theme() }
export function createDictation({ BrowserWindow, screen, call, url, theme }) {
  let pill = null;
  let ready = null;
  let typed = []; // the sentences typed this time, for "delete that"
  let hideTimer = 0;
  const W = 440;
  const H = 64;

  function window() {
    if (pill && !pill.isDestroyed()) return pill;
    pill = new BrowserWindow({
      width: W, height: H, show: false, frame: false, transparent: true, resizable: false, movable: false,
      focusable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: false, fullscreenable: false,
      webPreferences: { sandbox: true, contextIsolation: true },
    });
    pill.setIgnoreMouseEvents(true);
    pill.setAlwaysOnTop(true, 'screen-saver');
    ready = pill.loadURL(url).catch(() => {});
    return pill;
  }

  // state: 'listening' | 'typing' | 'error' | 'off'
  async function setState(state, message = '') {
    clearTimeout(hideTimer);
    if (state === 'listening' && !pill?.isVisible?.()) typed = [];
    if (state === 'off') { if (pill && !pill.isDestroyed()) pill.hide(); return; }
    const p = window();
    const area = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;
    p.setBounds({ x: Math.round(area.x + (area.width - W) / 2), y: Math.round(area.y + area.height - H - 28), width: W, height: H });
    await ready;
    if (p.isDestroyed()) return;
    await p.webContents.executeJavaScript(`window.showDictation?.(${JSON.stringify({ state, message, theme: theme() })})`).catch(() => {});
    p.showInactive();
    if (state === 'error') hideTimer = setTimeout(() => setState('off'), 6000);
  }

  // A sentence heard: typed into the app in front. Returns { stop }.
  async function heard(said) {
    const step = dictationSteps(said, { after: typed.at(-1) || '' });
    if (step.undo) {
      const last = typed.pop();
      if (last) await call('erase', [...last].length); // one Backspace a character (a line break too)
      return { stop: false };
    }
    if (step.text) {
      await call('type', Buffer.from(step.text, 'utf8').toString('base64'));
      typed.push(step.text);
    }
    return { stop: step.stop };
  }

  return { setState, heard };
}
