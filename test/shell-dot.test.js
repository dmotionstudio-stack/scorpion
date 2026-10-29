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
  assert.deepEqual(dot.bounds, { x: 8, y: 852 - 8 - 88, width: 88, height: 88 }); // above the 48px taskbar
  assert.equal(await shell.openWheel(null), true);
  assert.deepEqual(dot.bounds, { x: 0, y: 0, width: 1600, height: 900 }); // no rail: the whole screen
  const [ch, at] = dot.sent.at(-1);
  assert.equal(ch, 'wheel:open');
  assert.deepEqual(at, { x: 800, y: 450, dot: { x: 52, y: 852 - 52 }, backdrop: null }); // no snapshot given
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
  assert.deepEqual(dot.bounds, { x: 356, y: 256, width: 88, height: 88 });
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
  assert.deepEqual(rail.bounds, { x: 1600 - 76, y: 0, width: 76, height: 900 });
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: true }]);
  cursor = { x: 1599, y: 400 };
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: false }]);
  shell.setFloatingDot(false);
  assert.ok(rail.destroyed, 'back: the rail goes');
});
