// Scorpion as the Windows desktop ("shell"). When Windows starts Scorpion at
// sign-in (scorpion --shell), Scorpion shows its home screen as the desktop
// and its taskbar: by default a glance rail along the right edge (edge.html)
// with a summon dot that opens the intent wheel (summon.html), the classic
// bar along the bottom (taskbar.html), or the Scorpion taskbar, apps as stones on
// a horizon along the bottom (gravity.html; right-click the taskbar → Layout). 'bar' (Settings: the holographic taskbar
// whenever Scorpion runs) takes over from the Windows taskbar on the normal
// Windows desktop: the Windows one is hidden while Scorpion's runs and comes
// back when it stops.
// Safety: starting it three times within three minutes (a crash loop) starts
// the Windows desktop instead; quitting Scorpion while it is the desktop starts
// the Windows desktop so the user is never left with an empty screen; and the
// switch itself (Winlogon Shell for this account) changes only from Settings.
import fs from 'node:fs';
import path from 'node:path';
import win from './system.js';
import { shellEvent } from './shell-api.js';

const WIN = process.platform === 'win32';
const TASKBAR_HEIGHT = 48; // the bar along the top or bottom
const BAR_SIDE = 60; // the bar down a side
const RAIL_WIDTH = 76; // the rail down a side
const RAIL_ACROSS = 64; // the rail along the top or bottom
const EDGES = ['right', 'left', 'top', 'bottom'];
const DOT = 88; // the summon dot's window on a 1080-pixel screen (dotSizeFor)
// deps.dotAt: where the dot was dropped ({ x, y } as fractions of the screen,
// { corner: 'tl' | 'tr' | 'bl' | 'br' }, or null for the bottom-left corner);
// deps.autoHide: the taskbar hides until the pointer reaches its edge;
// deps.railAway: the rail comes with the floating dot; deps.edge: the screen
// edge the taskbar is on (null: the rail down the right, the bar along the bottom).
let deps = null; // { BrowserWindow, screen, preload, dataDir, getMainWindow, showView, getLayout, perf, snapScreen, dotAt, autoHide, railAway, edge }
let taskbar = null;
let summon = null; // the summon dot, which opens into the intent wheel
let wheelOpen = false;
let held = false; // a menu or dialog from the wheel is up: it stays open
let layout = 'orbit'; // 'orbit' (edge rail + wheel) | 'bar' | 'gravity'
const LAYOUTS = ['orbit', 'bar', 'gravity'];
const layoutOf = (l) => (LAYOUTS.includes(l) ? l : 'orbit');
let tall = false; // the Scorpion taskbar's window taller while an app's card is open
let taskbarPage = null; // which page the taskbar's window shows
// On the normal Windows desktop the dot floats on its own while Scorpion's
// window is minimized or hidden ("summon anywhere"), and Win+Shift+Space opens
// the wheel whenever Scorpion runs.
let floating = false;
let railFloats = false; // the rail is up with the floating dot (Scorpion minimized)
// Auto-hide: the taskbar slides away and the pointer at its edge brings it back.
let railHidden = false;
let railHeld = 0; // until when it stays (a menu from it is open)
// Stage (Windows): the recent windows as a strip of live pictures that slides
// in from the screen's left edge when the pointer touches it (stage.html).
// A window just minimized flies into it from the middle of the screen.
const STAGE_W = 230;
// From the right edge instead while the taskbar is on the left.
const sideForStage = () => (railEdge() === 'left' ? 'right' : 'left');
let stageSide = 'left';
let stage = null;
let stageOn = false;
let stageShown = false;
let stageStay = 0; // until when it stays in after a window flew in
let arriving = false;
let pointerWatch = 0;
// Scorpion OS's native shell host shows the rail, the dot and the wheel as
// layer-shell panels (os/.../scorpion-shell); then Scorpion makes none itself.
let hostMode = false;
let savedWorkArea = null;
let mode = null; // null | 'bar' | 'shell'
let keeper = 0; // 'bar': keeps the Windows taskbar hidden and the screen space reserved

export function initShell(d) { deps = d; }
export const shellMode = () => mode;
// Scorpion's taskbar back on top (Scorpion itself is on top in full mode).
export function raiseTaskbar() {
  if (taskbar && !taskbar.isDestroyed()) taskbar.moveTop();
  if (summon && !summon.isDestroyed()) summon.moveTop();
}
// The edge of the screen the taskbar is on (Settings, or a right-click on
// it): by default the rail down the right, the bar along the bottom. The
// native shell host (Scorpion OS) always draws the rail.
export const railEdge = () => {
  if (gravityOn() || hostGravity()) return 'bottom'; // the horizon is along the bottom
  const e = deps?.edge?.();
  return EDGES.includes(e) ? e : barLayout() && !hostMode ? 'bottom' : 'right';
};
const across = (e) => e === 'top' || e === 'bottom';
// How thick it is on that edge.
export const railThickness = (e = railEdge()) => (gravityOn() || hostGravity() ? gravityHeight() : barLayout() && !hostMode ? (across(e) ? TASKBAR_HEIGHT : BAR_SIDE) : (across(e) ? RAIL_ACROSS : RAIL_WIDTH));
// The Scorpion taskbar (as the desktop, or floating with the dot): its height
// grows with the screen (gravity.js scales its drawing to it).
const gravityOn = () => !hostMode && layoutOf(mode ? layout : deps?.getLayout?.()) === 'gravity';
// Scorpion OS: the shell host shows it (gravity.js asks it for the same height).
const hostGravity = () => hostMode && layoutOf(deps?.getLayout?.()) === 'gravity';
export const gravityHeightFor = (h) => Math.round(Math.min(200, Math.max(140, h * 0.19)));
const gravityHeight = () => gravityHeightFor(deps.screen.getPrimaryDisplay().bounds.height);
// While an app's card is open the Scorpion taskbar's window reaches up this much more.
const tallBy = () => Math.round(gravityHeight() * 1.6);
// A rectangle less the taskbar's strip along its edge.
function besideEdge(r, e = railEdge(), t = railThickness(e)) {
  if (e === 'left') return { ...r, x: r.x + t, width: r.width - t };
  if (e === 'top') return { ...r, y: r.y + t, height: r.height - t };
  if (e === 'bottom') return { ...r, height: r.height - t };
  return { ...r, width: r.width - t };
}
// The room Scorpion's taskbar takes, on its edge ({ top, right, bottom, left }).
// The native shell host (Scorpion OS) draws the rail over Scorpion's window
// (XWayland windows aren't shrunk to leave it room). Hiding by itself, it
// keeps no room.
export const taskbarInsets = () => {
  const none = { top: 0, right: 0, bottom: 0, left: 0 };
  if (deps?.autoHide?.() || (!hostMode && !mode && !railFloats)) return none;
  return { ...none, [railEdge()]: railThickness() };
};
const file = (name) => path.join(deps.dataDir, name);

// Crash-loop guard: true when the last three shell starts were within 3 minutes.
export function recordShellStart(now = Date.now()) {
  let starts = [];
  try { starts = JSON.parse(fs.readFileSync(file('shell-starts.json'), 'utf8')); } catch { /* first */ }
  starts = [...starts.filter((t) => now - t < 3 * 60_000), now];
  fs.writeFileSync(file('shell-starts.json'), JSON.stringify(starts));
  return starts.length >= 3;
}
export function clearShellStarts() { fs.rmSync(file('shell-starts.json'), { force: true }); }

// The bar only as Scorpion's desktop; floating, it's the rail.
const barLayout = () => Boolean(mode) && layout === 'bar';
// What the taskbar runs along: the whole screen as the desktop; floating with
// the dot, the area the Windows taskbar leaves (as it was before the rail
// took its own room from it).
function railBase() {
  const d = deps.screen.getPrimaryDisplay();
  if (mode || !WIN) return d.bounds;
  const a = savedWorkArea;
  return a ? { x: a.left, y: a.top, width: a.right - a.left, height: a.bottom - a.top } : d.workArea;
}
// The taskbar's strip along its edge.
export function railRect(base, e = railEdge(), t = railThickness(e)) {
  if (e === 'left') return { x: base.x, y: base.y, width: t, height: base.height };
  if (e === 'top') return { x: base.x, y: base.y, width: base.width, height: t };
  if (e === 'bottom') return { x: base.x, y: base.y + base.height - t, width: base.width, height: t };
  return { x: base.x + base.width - t, y: base.y, width: t, height: base.height };
}
function placeTaskbar() {
  if (taskbar && !taskbar.isDestroyed()) {
    const r = railRect(railBase());
    taskbar.setBounds(tall && gravityOn() ? { ...r, y: r.y - tallBy(), height: r.height + tallBy() } : r);
  }
  placeSummon();
}
// Where the wheel opens: the screen, less the rail's strip while it's up.
const wheelArea = (r) => (railUp() ? besideEdge(r) : r);
// The dot (in the bottom-left corner above a taskbar, or wherever it was
// dropped), or (open) the whole screen beside the rail.
function placeSummon() {
  if (!summon || summon.isDestroyed()) return;
  const r = deps.screen.getPrimaryDisplay().bounds;
  const dot = dotSpot();
  const size = dotSize();
  summon.setBounds(wheelOpen ? wheelArea(r) : { x: Math.round(dot.x - size / 2), y: Math.round(dot.y - size / 2), width: size, height: size });
}
// The dot's window grows with the screen (88 pixels on a 1080-pixel one) and
// shrinks on a small one, within reason; an even size, so it has a middle.
export const dotSizeFor = (b) => 2 * Math.round(Math.min(112, Math.max(64, Math.min(b.width, b.height) / 12.3)) / 2);
const dotSize = () => dotSizeFor(deps.screen.getPrimaryDisplay().bounds);
const CORNERS = { tl: [0, 0], tr: [1, 0], bl: [0, 1], br: [1, 1] };
const MARGIN = 8; // between a dot in a corner and the edges
// The dot's centre: in a corner of the area apps use; or where it was dropped
// (as fractions of the screen), kept whole inside that area. Nowhere yet: the
// bottom-left corner.
export function dotCentre(at, bounds, area, size = DOT) {
  const half = size / 2;
  const free = !at || !Number.isFinite(at.x) || !Number.isFinite(at.y);
  const corner = CORNERS[at?.corner] || (free ? CORNERS.bl : null);
  if (corner) {
    return {
      x: Math.round(corner[0] ? area.x + area.width - MARGIN - half : area.x + MARGIN + half),
      y: Math.round(corner[1] ? area.y + area.height - MARGIN - half : area.y + MARGIN + half),
    };
  }
  const x = bounds.x + at.x * bounds.width;
  const y = bounds.y + at.y * bounds.height;
  return {
    x: Math.round(Math.min(Math.max(x, area.x + half), area.x + area.width - half)),
    y: Math.round(Math.min(Math.max(y, area.y + half), area.y + area.height - half)),
  };
}
// The corner a dot dropped this close to (about its own size) snaps into, or null.
export function nearCorner(c, area, size = DOT) {
  for (const [name] of Object.entries(CORNERS)) {
    const spot = dotCentre({ corner: name }, area, area, size);
    if (Math.abs(c.x - spot.x) <= size && Math.abs(c.y - spot.y) <= size) return name;
  }
  return null;
}
function dotSpot() {
  const d = deps.screen.getPrimaryDisplay();
  return dotCentre(deps.dotAt?.(), d.bounds, d.workArea, dotSize());
}
// Scorpion OS: the screen beside the rail (the host's panels sit over it all).
function hostArea() {
  const r = deps.screen.getPrimaryDisplay().bounds;
  const all = { x: 0, y: 0, width: r.width, height: r.height };
  return deps.autoHide?.() ? all : besideEdge(all);
}
// The dot dragged: it follows (Windows; on Scorpion OS the page moves the
// host's panel itself), and where it's dropped is kept (as fractions of the
// screen, so it stays put when the resolution changes; near a corner, that
// corner). 'get': where it is, in the screen's own terms.
export function dragDot({ phase, x, y } = {}) {
  const r = deps.screen.getPrimaryDisplay().bounds;
  const size = dotSize();
  const area = hostMode ? hostArea() : deps.screen.getPrimaryDisplay().workArea;
  const bounds = hostMode ? { ...r, x: 0, y: 0 } : r;
  if (phase === 'get') {
    // On Windows in screen terms (what a move sends back); on Scorpion OS from the screen's corner.
    const c = dotCentre(deps.dotAt?.(), bounds, area, size);
    return { x: c.x, y: c.y, w: r.width, h: r.height, size };
  }
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  let c = dotCentre({ x: (x - bounds.x) / bounds.width, y: (y - bounds.y) / bounds.height }, bounds, area, size);
  const corner = phase === 'end' ? nearCorner(c, area, size) : null;
  if (corner) c = dotCentre({ corner }, bounds, area, size);
  if (!hostMode && summon && !summon.isDestroyed() && !wheelOpen) {
    summon.setBounds({ x: Math.round(c.x - size / 2), y: Math.round(c.y - size / 2), width: size, height: size });
  }
  return { at: corner ? { corner } : { x: (c.x - bounds.x) / bounds.width, y: (c.y - bounds.y) / bounds.height }, x: c.x, y: c.y, size };
}
// On Linux the window manager places a new window itself (labwc centres it);
// a move asked for once it's on screen is honoured, so the rail and the dot
// ask again.
function placeAgain() {
  if (WIN) return;
  for (const ms of [150, 600, 1500]) setTimeout(placeTaskbar, ms);
}

const windowOptions = (title) => ({
  frame: false, resizable: false, movable: false, minimizable: false, maximizable: false, fullscreenable: false,
  // See-through, for the glass look (edge.css, summon.css, taskbar.css).
  skipTaskbar: true, alwaysOnTop: true, show: false, transparent: true, hasShadow: false, backgroundColor: '#00000000', title,
  webPreferences: { preload: deps.preload, contextIsolation: true, nodeIntegration: false, sandbox: true },
});
function createWindows() {
  layout = layoutOf(deps.getLayout?.());
  if (hostMode) return;
  taskbar?.destroy(); // a floating rail makes way for the desktop's own
  railFloats = false;
  makeTaskbar();
  if ((layout === 'orbit' || floating) && (!summon || summon.isDestroyed())) makeSummon();
  else if (railUp()) { placeSummon(); summon.showInactive(); } // the floating dot was already there
}
const pageWanted = () => (gravityOn() ? 'gravity' : barLayout() ? 'taskbar' : 'edge');
function makeTaskbar() {
  railHidden = false;
  tall = false;
  taskbarPage = pageWanted();
  taskbar = new deps.BrowserWindow(windowOptions('Scorpion taskbar'));
  taskbar.setAlwaysOnTop(true, 'pop-up-menu');
  taskbar.loadURL(`scorpion://app/${taskbarPage}.html`);
  taskbar.once('ready-to-show', () => { placeTaskbar(); taskbar.showInactive(); placeAgain(); watchPointer(); });
  taskbar.on('closed', () => { taskbar = null; });
}
// The summon dot's window (the wheel opens in it). With the rail it shows at
// once; floating, only while Scorpion's window is away.
function makeSummon() {
  summon = new deps.BrowserWindow(windowOptions('Scorpion summon'));
  summon.setAlwaysOnTop(true, 'pop-up-menu');
  summon.loadURL('scorpion://app/summon.html');
  summon.loaded = new Promise((resolve) => summon.webContents.once('did-finish-load', resolve));
  summon.once('ready-to-show', () => { placeSummon(); if (dotWanted()) summon.showInactive(); placeAgain(); });
  summon.on('blur', () => { if (wheelOpen && !held) summon.webContents.send('wheel:close'); });
  summon.on('closed', () => { summon = null; wheelOpen = false; });
}
// The rail is up (Scorpion as the desktop, orbit layout, or floating with the
// dot): then so is the dot.
const railUp = () => (Boolean(mode) && layout === 'orbit') || railFloats;
const dotWanted = () => railUp() || floating;
function destroyWindows() {
  taskbar?.destroy();
  taskbar = null;
  railFloats = false;
  railHidden = false;
  summon?.destroy();
  summon = null;
  wheelOpen = false;
}

// The intent wheel: open (centred on a point of the screen, or its middle) or
// back to the dot.
// On the normal Windows desktop the dot's window is made when first needed.
// The page hears where the dot is, so the wheel can grow out of it and
// shrink back into it.
// Frosted glass: a small picture of the screen, taken before the wheel shows,
// which the page blurs behind it (not in Light, nor if it's slow).
async function snapBackdrop(r, wait) {
  if (!deps.snapScreen || deps.perf?.() === 'light') return null;
  const src = await Promise.race([deps.snapScreen().catch(() => null), new Promise((resolve) => setTimeout(() => resolve(null), wait))]);
  return src ? { src, w: r.width, h: r.height } : null;
}
export async function openWheel(at) {
  const r = deps.screen.getPrimaryDisplay().bounds;
  // Scorpion OS: the host's summon surface grows to the whole screen (rail
  // included) once the page asks, so the page hears the centre beside the
  // rail and where the dot sits, both in screen terms.
  if (hostMode) {
    const backdrop = await snapBackdrop(r, 400);
    const area = hostArea();
    const centre = at ? { x: at.x - r.x, y: at.y - r.y } : { x: area.x + area.width / 2, y: area.y + area.height / 2 };
    const size = dotSize();
    shellEvent('wheel:open', { ...centre, dot: { ...dotCentre(deps.dotAt?.(), { ...r, x: 0, y: 0 }, area, size), size }, backdrop });
    return true;
  }
  if (!summon || summon.isDestroyed()) {
    if (!WIN) return false;
    makeSummon();
  }
  await summon.loaded;
  if (!summon || summon.isDestroyed()) return false;
  hideStage(true);
  const shot = WIN ? await snapBackdrop(r, 250) : null;
  wheelOpen = true;
  summon.setAlwaysOnTop(true, 'screen-saver');
  placeSummon();
  // In the open window's terms (it starts beside a rail on the left or top);
  // the screen's picture is shifted to match.
  const w = wheelArea(r);
  const spot = dotSpot();
  const dot = dotWanted() ? { x: spot.x - w.x, y: spot.y - w.y, size: dotSize() } : null;
  const centre = at ? { x: at.x - w.x, y: at.y - w.y } : { x: w.width / 2, y: w.height / 2 };
  const backdrop = shot && { ...shot, x: r.x - w.x, y: r.y - w.y };
  summon.webContents.send('wheel:open', { ...centre, dot, backdrop });
  summon.show();
  summon.focus();
  return true;
}
export function closeWheel() {
  if (hostMode) { shellEvent('wheel:close'); return true; }
  if (!summon || summon.isDestroyed() || !wheelOpen) return false;
  wheelOpen = false;
  summon.setAlwaysOnTop(true, 'pop-up-menu');
  placeSummon();
  summon.blur();
  if (!dotWanted()) summon.hide();
  return true;
}
// Scorpion's window went away (minimized, or to the tray) or came back: on
// the normal Windows desktop the dot floats while it's away, with the rail
// (open windows, clock, notifications) down the right edge.
export function setFloatingDot(on) {
  floating = WIN && Boolean(on);
  if (hostMode || (mode && layout === 'orbit')) return; // as the desktop, they're always there
  setFloatingRail(floating && !mode && Boolean(deps.railAway?.()));
  if (floating) {
    if (!summon || summon.isDestroyed()) makeSummon();
    else if (!wheelOpen) { placeSummon(); summon.showInactive(); }
  } else if (summon && !summon.isDestroyed() && !wheelOpen) summon.hide();
}
function setFloatingRail(on) {
  if (on === railFloats) return;
  railFloats = on;
  if (on) {
    makeTaskbar();
    if (!deps.autoHide?.()) reserveWorkArea().catch(() => {}); // hiding, it keeps no room
  } else {
    taskbar?.destroy();
    taskbar = null;
    if (savedWorkArea) restoreWorkArea().catch(() => {});
  }
  watchPointer();
}
// Settings changed (auto-hide, the rail with the dot, its edge): the rail,
// the room it keeps and Stage's side follow.
export function refreshRail() {
  if (floating && !mode && !hostMode) setFloatingRail(Boolean(deps.railAway?.()));
  if (railFloats && !mode && taskbar && !taskbar.isDestroyed() && taskbarPage !== pageWanted()) { taskbar.destroy(); makeTaskbar(); }
  if (!hostMode) placeTaskbar();
  if (stageSide !== sideForStage()) { hideStage(true); stageSide = sideForStage(); }
  if (mode && !hostMode) win.setWorkArea(wantedArea()).catch(() => {});
  else if (railFloats && !hostMode) (deps.autoHide?.() ? (savedWorkArea ? restoreWorkArea() : Promise.resolve()) : reserveWorkArea()).catch(() => {});
  if (!deps.autoHide?.() && railHidden) showRail();
  watchPointer();
}

// ---------- Stage ----------
// The pointer at the screen's left edge (the right, with the taskbar on the
// left; stage.js follows the same setting) slides the strip in; moving well
// away from it slides it out. The pointer is only watched while Stage (or
// the taskbar's auto-hide) is on. On Scorpion OS the shell host shows the
// strip as a panel and watches the edge itself.
export function setStage(on) {
  stageOn = WIN && Boolean(on);
  if (!stageOn) { hideStage(true); stage?.destroy(); stage = null; }
  watchPointer();
  return Boolean(on) && (WIN || hostMode);
}
function makeStage() {
  stage = new deps.BrowserWindow({ ...windowOptions('Scorpion stage'), focusable: false });
  stage.setAlwaysOnTop(true, 'pop-up-menu');
  stage.loadURL('scorpion://app/stage.html');
  stage.loaded = new Promise((resolve) => stage.webContents.once('did-finish-load', resolve));
  stage.on('closed', () => { stage = null; stageShown = false; arriving = false; });
}
const stripBounds = () => {
  const a = deps.screen.getPrimaryDisplay().workArea;
  return { x: stageSide === 'right' ? a.x + a.width - STAGE_W : a.x, y: a.y, width: STAGE_W, height: a.height };
};
async function showStage() {
  if (!stage || stage.isDestroyed()) makeStage();
  stageSide = sideForStage();
  stageShown = true;
  stage.setBounds(stripBounds());
  await stage.loaded;
  if (!stageShown || !stage || stage.isDestroyed()) return;
  stage.webContents.send('stage:show');
  stage.showInactive();
}
// Slides out (the page animates), then the window goes.
export function hideStage(now = false) {
  if (!stageShown) return;
  stageShown = false;
  if (!stage || stage.isDestroyed()) return;
  stage.webContents.send('stage:hide');
  setTimeout(() => { if (!stageShown && stage && !stage.isDestroyed()) stage.hide(); }, now ? 0 : 220);
}
// A window was just minimized: its card flies from the middle of the screen
// into the strip (the strip's window covers the screen for the flight, and
// lets clicks through), and the strip stays a moment before sliding away.
const FLIGHT_MS = 650;
export async function stageArrive(hwnd) {
  if (hostMode) { shellEvent('stage:arrive', { hwnd }); return true; }
  if (!stageOn || wheelOpen || arriving) return false;
  if (!stage || stage.isDestroyed()) makeStage();
  const a = deps.screen.getPrimaryDisplay().workArea;
  arriving = true;
  stageShown = true;
  stage.setIgnoreMouseEvents(true);
  stage.setBounds({ x: a.x, y: a.y, width: a.width, height: a.height });
  await stage.loaded;
  if (!stage || stage.isDestroyed()) { arriving = false; return false; }
  stage.webContents.send('stage:arrive', { hwnd: String(hwnd) });
  stage.showInactive();
  setTimeout(() => {
    arriving = false;
    if (!stage || stage.isDestroyed()) return;
    stage.setIgnoreMouseEvents(false);
    if (stageShown) stage.setBounds(stripBounds());
    stageStay = Date.now() + 1400;
  }, FLIGHT_MS);
  return true;
}

// ---------- the pointer: Stage's edge and the taskbar's auto-hide ----------
const hidesNow = () => Boolean(deps.autoHide?.()) && taskbar && !taskbar.isDestroyed() && !hostMode;
function watchPointer() {
  const want = stageOn || hidesNow();
  if (!want) { clearInterval(pointerWatch); pointerWatch = 0; return; }
  if (pointerWatch) return;
  pointerWatch = setInterval(lookAtPointer, deps.perf?.() === 'light' ? 250 : 120);
}
function lookAtPointer() {
  if (!stageOn && !hidesNow()) { watchPointer(); return; }
  if (wheelOpen) return;
  const p = deps.screen.getCursorScreenPoint();
  const d = deps.screen.getPrimaryDisplay();
  const a = d.workArea;
  const r = d.bounds;
  if (stageOn && !arriving) {
    const level = p.y >= a.y && p.y < a.y + a.height;
    // How far in from Stage's edge the pointer is.
    const inward = sideForStage() === 'right' ? a.x + a.width - 1 - p.x : p.x - a.x;
    if (!stageShown && level && inward <= 1) showStage().catch(() => {});
    else if (stageShown && Date.now() > stageStay && (inward > STAGE_W + 40 || !level)) hideStage();
  }
  if (hidesNow() && !tall) {
    // How far in from the taskbar's outer edge the pointer is (beyond it,
    // over the Windows taskbar for one floating along the bottom: below 0).
    const e = railEdge();
    const s = railRect(railBase(), e);
    const depth = { left: p.x - s.x, right: s.x + s.width - 1 - p.x, top: p.y - s.y, bottom: s.y + s.height - 1 - p.y }[e];
    const atEdge = depth >= 0 && depth <= 2;
    const away = depth > railThickness(e) + 30 || depth < -2;
    if (railHidden && atEdge) showRail();
    else if (!railHidden && away && Date.now() > railHeld) hideRail();
  }
}
// Hidden, the taskbar's page slides away and its window lets clicks through
// to the apps under it.
function hideRail() {
  if (!taskbar || taskbar.isDestroyed()) return;
  railHidden = true;
  taskbar.webContents.send('shell:rail', { hidden: true });
  setTimeout(() => { if (railHidden && taskbar && !taskbar.isDestroyed()) taskbar.setIgnoreMouseEvents(true); }, 200);
}
function showRail() {
  railHidden = false;
  if (!taskbar || taskbar.isDestroyed()) return;
  taskbar.setIgnoreMouseEvents(false);
  taskbar.webContents.send('shell:rail', { hidden: false });
}
// A menu from the taskbar is open: it stays while it is (at most a minute).
export function holdRail(on) { railHeld = on ? Date.now() + 60_000 : Date.now() + 800; }
// The Scorpion taskbar: clicks through its empty sky to the apps under it (the
// pointer's moves still reach its page, to notice a stone), or not.
export function passClicks(on) {
  if (!taskbar || taskbar.isDestroyed() || railHidden || taskbarPage !== 'gravity') return false;
  taskbar.setIgnoreMouseEvents(Boolean(on), { forward: true });
  return true;
}
// Its window reaches up for an app's card, and back down.
export function setTall(on) {
  if (taskbarPage !== 'gravity' || tall === Boolean(on)) return false;
  tall = Boolean(on);
  if (tall) taskbar?.setIgnoreMouseEvents(false);
  placeTaskbar();
  return true;
}
export function holdWheel(on) { held = Boolean(on); }
// The dot back where the settings say (dropped somewhere, or its corner).
export function placeDot() { if (!hostMode && !wheelOpen) placeSummon(); }
// The native shell host came up (or went away): its panels, or Scorpion's own windows.
export function useHost(on) {
  if (hostMode === Boolean(on)) return;
  hostMode = Boolean(on);
  if (hostMode) destroyWindows();
  else if (mode) createWindows();
}
export const hostActive = () => hostMode;
// A different layout: the windows are made again, and the reserved room follows.
export async function relayout() {
  if (!mode || layoutOf(deps.getLayout?.()) === layout) return false;
  destroyWindows();
  createWindows();
  await win.setWorkArea(wantedArea()).catch(() => {});
  return true;
}

// The screen area apps maximize into stops above Scorpion's taskbar. PowerShell
// sees the screen in the same scaled pixels as Electron (it isn't DPI-aware),
// so the numbers go across unconverted.
// The rail floating with the dot (the Windows taskbar still there) takes its
// room from the area as it was, not from the whole screen.
const wantedArea = () => {
  const inset = taskbarInsets();
  const b = deps.screen.getPrimaryDisplay().bounds;
  const from = !mode && savedWorkArea ? savedWorkArea : { left: b.x, top: b.y, right: b.x + b.width, bottom: b.y + b.height };
  return { left: from.left + inset.left, top: from.top + inset.top, right: from.right - inset.right, bottom: from.bottom - inset.bottom };
};
// On Linux the session's window manager (labwc) keeps the room instead (its rc.xml margins).
async function reserveWorkArea() {
  if (!WIN) return;
  savedWorkArea ??= await win.getWorkArea().catch(() => null);
  if (savedWorkArea) fs.writeFileSync(file('shell-workarea.json'), JSON.stringify(savedWorkArea));
  await win.setWorkArea(wantedArea()).catch(() => {});
}
async function restoreWorkArea() {
  if (!WIN) return;
  let area = savedWorkArea;
  if (!area) { try { area = JSON.parse(fs.readFileSync(file('shell-workarea.json'), 'utf8')); } catch { /* none saved */ } }
  if (area) await win.setWorkArea(area).catch(() => {});
  savedWorkArea = null;
  fs.rmSync(file('shell-workarea.json'), { force: true });
}

export async function startShell(kind) {
  if (!WIN && process.platform !== 'linux') throw new Error('Scorpion as the desktop works on Windows and Linux.');
  if (!WIN && kind === 'bar') throw new Error("On Linux, Scorpion's taskbar comes with the Scorpion session.");
  if (mode) return mode;
  mode = kind;
  createWindows();
  deps.screen.on('display-metrics-changed', placeTaskbar);
  if (kind === 'bar') {
    // The Windows taskbar steps aside (a flag file brings it back after a crash).
    fs.writeFileSync(file('taskbar-hidden'), '1');
    await win.setWindowsTaskbar(false).catch(() => {});
    let beat = 0;
    keeper = setInterval(() => {
      if (mode !== 'bar' || (deps.perf?.() === 'light' && beat++ % 2)) return; // every 6 s in Light
      win.setWindowsTaskbar(false, wantedArea()).catch(() => {});
    }, 3000);
  }
  await reserveWorkArea();
  win.setShellActive(kind === 'shell');
  if (kind === 'shell') {
    // The desktop: Scorpion's home screen, filling the screen above the taskbar.
    const main = deps.getMainWindow();
    main?.maximize();
    // The desktop keeps listening for gestures and the wake word while apps
    // are in front of it.
    main?.webContents.setBackgroundThrottling(false);
    deps.showView('desktop', { signin: true });
    win.runStartupApps().catch(() => {});
    // Running steadily for two minutes: not a crash loop.
    setTimeout(clearShellStarts, 2 * 60_000);
  }
  return mode;
}

export async function stopShell() {
  if (!mode) return;
  const was = mode;
  mode = null;
  win.setShellActive(false);
  deps.screen.removeListener('display-metrics-changed', placeTaskbar);
  destroyWindows();
  clearInterval(keeper);
  keeper = 0;
  await restoreWorkArea();
  setFloatingDot(floating); // the desktop's rail goes; a floating dot (and rail) stays
  // The Windows taskbar back in its place.
  if (was === 'bar') await showWindowsTaskbar();
  // Leaving the real shell: bring the Windows desktop back.
  if (WIN && was === 'shell' && !(await win.explorerRunning().catch(() => true))) await win.startExplorer();
}

async function showWindowsTaskbar() {
  await win.setWindowsTaskbar(true).catch(() => {});
  fs.rmSync(file('taskbar-hidden'), { force: true });
}

// Leftovers from a session that ended without stopShell (power loss, a crash):
// the work area and the Windows taskbar back.
export async function recoverWorkArea() {
  if (mode) return;
  if (fs.existsSync(file('shell-workarea.json'))) await restoreWorkArea();
  if (fs.existsSync(file('taskbar-hidden'))) await showWindowsTaskbar();
}

// What the taskbar shows besides the windows: battery and network.
export const trayStatus = () => win.trayStatus().catch(() => ({}));
