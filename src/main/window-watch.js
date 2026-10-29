// What happened to the open windows between two looks at them: which apps
// opened a window (it then fills the screen, when Settings says so) and which
// windows were just minimized (they fly into Stage). Plain functions, so the
// rules are tested on their own (test/window-watch.test.js).

// A window's lasting identity: Windows' handle, or on Linux the compositor's
// identifier when lswt gives one (its handle there is the app and title,
// which change with every browser tab).
export const keyOf = (w) => String(w.key || w.hwnd);
// The app a window belongs to.
export const appOf = (w) => String(w.exe || w.appId || w.process || '').toLowerCase();

const countApps = (list) => {
  const n = new Map();
  for (const w of list) n.set(appOf(w), (n.get(appOf(w)) || 0) + 1);
  return n;
};

// before: the last look (null the first time: nothing counts as new then).
export function windowChanges(before, after) {
  if (!before) return { opened: [], minimized: [] };
  const was = new Map(before.map((w) => [keyOf(w), w]));
  const had = countApps(before);
  const has = countApps(after);
  // New, and its app has more windows than before (a window whose title
  // changed, on Linux without identifiers, is the same window again).
  const opened = after.filter((w) => !was.has(keyOf(w)) && !w.minimized && (has.get(appOf(w)) || 0) > (had.get(appOf(w)) || 0));
  const minimized = after.filter((w) => w.minimized && was.has(keyOf(w)) && !was.get(keyOf(w)).minimized);
  return { opened, minimized };
}

// Fill the screen with a newly opened window only when it's its app's only
// window: a second one is usually a dialog or a picker, best left its size.
export function shouldFill(w, all) {
  if (w.self || w.minimized || !appOf(w)) return false;
  return all.filter((x) => appOf(x) === appOf(w)).length === 1;
}
