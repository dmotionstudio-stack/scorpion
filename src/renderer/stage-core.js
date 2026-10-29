// Which windows Stage's strip shows (stage.js), kept apart so it can be
// tested: the recent ones except the window in front (it's on the stage)
// and Scorpion's own, most recently used first, at most five.
export const STAGE_MAX = 5;

export function stageWindows(recent = [], max = STAGE_MAX) {
  return recent.filter((w) => w && w.hwnd && !w.active && !w.self).slice(0, max);
}
