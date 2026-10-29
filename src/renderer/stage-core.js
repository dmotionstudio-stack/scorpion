// Which windows Stage's strip shows (stage.js), kept apart so it can be
// tested: every open app's window except the one in front (it's on the
// stage) and Scorpion's own, in the order the system lists them (front to
// back on Windows), minimized ones included, at most ten (the strip scrolls).
export const STAGE_MAX = 10;

export function stageWindows(list = [], max = STAGE_MAX) {
  return list.filter((w) => w && w.hwnd && !w.active && !w.self).slice(0, max);
}
