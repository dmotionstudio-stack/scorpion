import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as shell from '../src/main/shell.js';

// The summon dot on the normal Windows desktop and Stage's strip, with
// stand-in windows: what is made, shown, hidden and where.
const made = [];
class FakeWindow extends EventEmitter {
  constructor(opts) {
    super();
    this.opts = opts; this.visible = false; this.bounds = null; this.sent = []; this.destroyed = false;
    this.webContents = Object.assign(new EventEmitter(), { send: (ch, arg) => this.sent.push([ch, arg]) });
    made.push(this);
  }
  loadURL(u) { this.url = u; setImmediate(() => { this.webContents.emit('did-finish-load'); this.emit('ready-to-show'); }); }
  setAlwaysOnTop() {} setBounds(b) { this.bounds = b; } showInactive() { this.visible = true; } show() { this.visible = true; }
  hide() { this.visible = false; } focus() {} blur() {} moveTop() {} setIgnoreMouseEvents() {} isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; this.emit('closed'); }
}
let cursor = { x: 500, y: 400 };
const screen = {
  getPrimaryDisplay: () => ({ bounds: { x: 0, y: 0, width: 1600, height: 900 }, workArea: { x: 0, y: 0, width: 1600, height: 852 } }),
  getCursorScreenPoint: () => cursor, on() {}, removeListener() {},
};
shell.initShell({ BrowserWindow: FakeWindow, screen, preload: 'p', dataDir: '.', getMainWindow: () => null, showView() {}, getLayout: () => 'orbit', perf: () => 'full' });
const tick = () => new Promise((r) => setTimeout(r, 30));
const opts = { skip: process.platform !== 'win32' && 'the floating dot and Stage are Windows only' };

test('the dot floats while Scorpion is away, above the taskbar, and the wheel grows from it', opts, async () => {
  shell.setFloatingDot(true);
  await tick();
  const dot = made.find((w) => w.url.endsWith('summon.html'));
  assert.ok(dot.visible);
  assert.deepEqual(dot.bounds, { x: 8, y: 852 - 8 - 74, width: 74, height: 74 }); // above the 48px taskbar, sized for a 900-pixel screen
  assert.equal(await shell.openWheel(null), true);
  assert.deepEqual(dot.bounds, { x: 0, y: 0, width: 1600, height: 900 }); // no rail: the whole screen
  const [ch, at] = dot.sent.at(-1);
  assert.equal(ch, 'wheel:open');
  assert.deepEqual(at, { x: 800, y: 450, dot: { x: 45, y: 852 - 45, size: 74 }, backdrop: null }); // no snapshot given
  shell.setFloatingDot(false); // back while the wheel is open: it stays until closed
  assert.ok(dot.visible);
  shell.closeWheel();
  assert.equal(dot.visible, false);
  // Win+Shift+Space with Scorpion in front: the wheel opens at the pointer, not from a dot.
  await shell.openWheel({ x: 300, y: 200 });
  assert.deepEqual(dot.sent.at(-1)[1], { x: 300, y: 200, dot: null, backdrop: null });
  shell.closeWheel();
});

test("Stage's strip slides in at the left edge and out when the pointer leaves", opts, async () => {
  shell.setStage(true);
  cursor = { x: 0, y: 300 };
  await new Promise((r) => setTimeout(r, 200));
  const strip = made.find((w) => w.url.endsWith('stage.html'));
  assert.ok(strip && strip.visible);
  assert.equal(strip.opts.focusable, false); // the window in front stays in front
  assert.deepEqual(strip.bounds, { x: 0, y: 0, width: 230, height: 852 });
  assert.equal(strip.sent.at(-1)[0], 'stage:show');
  cursor = { x: 900, y: 300 };
  await new Promise((r) => setTimeout(r, 450));
  assert.equal(strip.sent.at(-1)[0], 'stage:hide');
  assert.equal(strip.visible, false);
  shell.setStage(false);
  assert.ok(strip.destroyed);
});

test('the dot stays where it was dropped, whole inside the screen', () => {
  const bounds = { x: 0, y: 0, width: 1600, height: 900 };
  const area = { x: 0, y: 0, width: 1600, height: 852 };
  assert.deepEqual(shell.dotCentre(null, bounds, area), { x: 52, y: 800 }); // its corner
  assert.deepEqual(shell.dotCentre({ x: 0.5, y: 0.25 }, bounds, area), { x: 800, y: 225 });
  assert.deepEqual(shell.dotCentre({ x: 1, y: 1 }, bounds, area), { x: 1600 - 44, y: 852 - 44 }); // not under the taskbar
  assert.deepEqual(shell.dotCentre({ x: -1, y: 0 }, bounds, area), { x: 44, y: 44 });
});

test('dragged, the dot follows and its spot is given back as fractions', opts, async () => {
  shell.setFloatingDot(true);
  await tick();
  const dot = made.filter((w) => w.url.endsWith('summon.html') && !w.destroyed).at(-1);
  const r = shell.dragDot({ phase: 'move', x: 400, y: 300 });
  assert.deepEqual(dot.bounds, { x: 363, y: 263, width: 74, height: 74 });
  assert.deepEqual(r.at, { x: 0.25, y: 300 / 900 });
  shell.setFloatingDot(false);
});

test('minimized, the rail floats with the dot and hides until the pointer reaches the edge', opts, async () => {
  shell.initShell({ BrowserWindow: FakeWindow, screen, preload: 'p', dataDir: '.', getMainWindow: () => null, showView() {}, getLayout: () => 'orbit', perf: () => 'full', autoHide: () => true, railAway: () => true });
  cursor = { x: 800, y: 400 };
  shell.setFloatingDot(true);
  await new Promise((r) => setTimeout(r, 300));
  const rail = made.filter((w) => w.url.endsWith('edge.html')).at(-1);
  assert.ok(rail && rail.visible, 'the rail is up');
  assert.deepEqual(rail.bounds, { x: 1600 - 76, y: 0, width: 76, height: 852 }); // above the Windows taskbar
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: true }]);
  cursor = { x: 1599, y: 400 };
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: false }]);
  shell.setFloatingDot(false);
  assert.ok(rail.destroyed, 'back: the rail goes');
});

test('the dot goes into any corner, and snaps into one dropped near it', () => {
  const bounds = { x: 0, y: 0, width: 1600, height: 900 };
  const area = { x: 0, y: 0, width: 1600, height: 852 };
  assert.deepEqual(shell.dotCentre({ corner: 'tl' }, bounds, area), { x: 52, y: 52 });
  assert.deepEqual(shell.dotCentre({ corner: 'tr' }, bounds, area), { x: 1600 - 52, y: 52 });
  assert.deepEqual(shell.dotCentre({ corner: 'br' }, bounds, area), { x: 1600 - 52, y: 852 - 52 });
  assert.deepEqual(shell.dotCentre({ corner: 'bl' }, bounds, area, 64), { x: 40, y: 852 - 40 });
  assert.equal(shell.nearCorner({ x: 1500, y: 120 }, area), 'tr');
  assert.equal(shell.nearCorner({ x: 90, y: 780 }, area), 'bl');
  assert.equal(shell.nearCorner({ x: 800, y: 400 }, area), null);
});

test('the dot is sized for the screen', () => {
  assert.equal(shell.dotSizeFor({ width: 1920, height: 1080 }), 88);
  assert.equal(shell.dotSizeFor({ width: 1366, height: 768 }), 64);
  assert.equal(shell.dotSizeFor({ width: 3840, height: 2160 }), 112);
});

test('dropped near a corner, the dot is kept in that corner', opts, async () => {
  shell.setFloatingDot(true);
  await tick();
  const dot = made.filter((w) => w.url.endsWith('summon.html') && !w.destroyed).at(-1);
  const r = shell.dragDot({ phase: 'end', x: 1560, y: 60 });
  assert.deepEqual(r.at, { corner: 'tr' });
  assert.deepEqual(dot.bounds, { x: 1600 - 8 - 74, y: 8, width: 74, height: 74 });
  shell.setFloatingDot(false);
});

test('the taskbar on any edge: its strip and the room it keeps', () => {
  const base = { x: 0, y: 0, width: 1600, height: 900 };
  assert.deepEqual(shell.railRect(base, 'left', 76), { x: 0, y: 0, width: 76, height: 900 });
  assert.deepEqual(shell.railRect(base, 'right', 76), { x: 1524, y: 0, width: 76, height: 900 });
  assert.deepEqual(shell.railRect(base, 'top', 64), { x: 0, y: 0, width: 1600, height: 64 });
  assert.deepEqual(shell.railRect(base, 'bottom', 64), { x: 0, y: 836, width: 1600, height: 64 });
});

test('the rail on the left: it floats there, and Stage comes in from the right', opts, async () => {
  shell.initShell({ BrowserWindow: FakeWindow, screen, preload: 'p', dataDir: '.', getMainWindow: () => null, showView() {}, getLayout: () => 'orbit', perf: () => 'full', autoHide: () => true, railAway: () => true, edge: () => 'left' });
  cursor = { x: 800, y: 400 };
  shell.setFloatingDot(true);
  await new Promise((r) => setTimeout(r, 300));
  const rail = made.filter((w) => w.url.endsWith('edge.html')).at(-1);
  assert.deepEqual(rail.bounds, { x: 0, y: 0, width: 76, height: 852 });
  assert.equal(shell.railEdge(), 'left');
  assert.deepEqual(shell.taskbarInsets(), { top: 0, right: 0, bottom: 0, left: 0 }); // hiding, it keeps no room
  cursor = { x: 0, y: 400 };
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: false }]);
  shell.setFloatingDot(false);
  shell.setStage(true);
  cursor = { x: 1599, y: 300 };
  await new Promise((r) => setTimeout(r, 200));
  const strip = made.filter((w) => w.url.endsWith('stage.html')).at(-1);
  assert.deepEqual(strip.bounds, { x: 1600 - 230, y: 0, width: 230, height: 852 });
  shell.setStage(false);
});
