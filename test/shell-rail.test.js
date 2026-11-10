import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import * as shell from '../src/main/shell.js';

// The intent wheel's window and the rail floating on the normal Windows
// desktop, with stand-in windows: what is made, shown, hidden and where.
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
const opts = { skip: process.platform !== 'win32' && 'the floating rail is Windows only' };

test('nothing floats on the screen while Scorpion is away: the wheel has its own window, there only while it is open', opts, async () => {
  shell.setAway(true); // no rail asked for (railAway isn't given): nothing at all is made
  await tick();
  assert.equal(made.length, 0);
  assert.equal(await shell.openWheel(null), true);
  const wheel = made.find((w) => w.url.endsWith('summon.html'));
  assert.ok(wheel.visible);
  assert.deepEqual(wheel.bounds, { x: 0, y: 0, width: 1600, height: 900 }); // no rail: the whole screen
  const [ch, at] = wheel.sent.at(-1);
  assert.equal(ch, 'wheel:open');
  assert.deepEqual(at, { x: 800, y: 450, backdrop: null }); // its middle; no snapshot given
  shell.closeWheel();
  assert.equal(wheel.visible, false, 'closed: nothing is left on the screen');
  // Win+Shift+Space: the wheel opens at the pointer.
  await shell.openWheel({ x: 300, y: 200 });
  assert.deepEqual(wheel.sent.at(-1)[1], { x: 300, y: 200, backdrop: null });
  assert.ok(wheel.visible);
  shell.closeWheel();
  assert.equal(wheel.visible, false);
  shell.setAway(false);
  assert.equal(made.filter((w) => !w.url.endsWith('summon.html')).length, 0);
});

test('minimized, the rail floats and hides until the pointer reaches the edge', opts, async () => {
  shell.initShell({ BrowserWindow: FakeWindow, screen, preload: 'p', dataDir: '.', getMainWindow: () => null, showView() {}, getLayout: () => 'orbit', perf: () => 'full', autoHide: () => true, railAway: () => true });
  cursor = { x: 800, y: 400 };
  shell.setAway(true);
  await new Promise((r) => setTimeout(r, 300));
  const rail = made.filter((w) => w.url.endsWith('edge.html')).at(-1);
  assert.ok(rail && rail.visible, 'the rail is up');
  assert.deepEqual(rail.bounds, { x: 1600 - 76, y: 0, width: 76, height: 852 }); // above the Windows taskbar
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: true }]);
  cursor = { x: 1599, y: 400 };
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: false }]);
  shell.setAway(false);
  assert.ok(rail.destroyed, 'back: the rail goes');
});

test('the taskbar on any edge: its strip and the room it keeps', () => {
  const base = { x: 0, y: 0, width: 1600, height: 900 };
  assert.deepEqual(shell.railRect(base, 'left', 76), { x: 0, y: 0, width: 76, height: 900 });
  assert.deepEqual(shell.railRect(base, 'right', 76), { x: 1524, y: 0, width: 76, height: 900 });
  assert.deepEqual(shell.railRect(base, 'top', 64), { x: 0, y: 0, width: 1600, height: 64 });
  assert.deepEqual(shell.railRect(base, 'bottom', 64), { x: 0, y: 836, width: 1600, height: 64 });
});

test('the rail on the left: it floats there', opts, async () => {
  shell.initShell({ BrowserWindow: FakeWindow, screen, preload: 'p', dataDir: '.', getMainWindow: () => null, showView() {}, getLayout: () => 'orbit', perf: () => 'full', autoHide: () => true, railAway: () => true, edge: () => 'left' });
  cursor = { x: 800, y: 400 };
  shell.setAway(true);
  await new Promise((r) => setTimeout(r, 300));
  const rail = made.filter((w) => w.url.endsWith('edge.html')).at(-1);
  assert.deepEqual(rail.bounds, { x: 0, y: 0, width: 76, height: 852 });
  assert.equal(shell.railEdge(), 'left');
  assert.deepEqual(shell.taskbarInsets(), { top: 0, right: 0, bottom: 0, left: 0 }); // hiding, it keeps no room
  cursor = { x: 0, y: 400 };
  await new Promise((r) => setTimeout(r, 200));
  assert.deepEqual(rail.sent.at(-1), ['shell:rail', { hidden: false }]);
  shell.setAway(false);
});

test('dragging the taskbar\'s inner edge makes it thicker or thinner, within limits', opts, async () => {
  let kept = null;
  shell.initShell({ BrowserWindow: FakeWindow, screen, preload: 'p', dataDir: '.', getMainWindow: () => null, showView() {}, getLayout: () => 'orbit', perf: () => 'full', autoHide: () => true, railAway: () => true, edge: () => 'right', railSize: () => kept });
  cursor = { x: 800, y: 400 };
  shell.setAway(true);
  await new Promise((r) => setTimeout(r, 300));
  const rail = made.filter((w) => w.url.endsWith('edge.html')).at(-1);
  assert.deepEqual(shell.resizeRail({ phase: 'move', x: 1600 - 120, y: 400 }), { key: 'rail-side', size: 120 });
  assert.deepEqual(rail.bounds, { x: 1480, y: 0, width: 120, height: 852 }); // it follows the pointer
  assert.equal(shell.resizeRail({ phase: 'move', x: 1000, y: 400 }).size, 170); // no thicker than this
  assert.equal(shell.resizeRail({ phase: 'move', x: 1590, y: 400 }).size, 56); // nor thinner
  const end = shell.resizeRail({ phase: 'end', x: 1600 - 100, y: 400 });
  assert.deepEqual(end, { key: 'rail-side', size: 100 });
  kept = end.size; // kept in the settings
  assert.equal(shell.railThickness('right'), 100);
  shell.setAway(false);
});
