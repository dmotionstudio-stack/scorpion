import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAgentBrowser } from '../src/main/agent-browser.js';

// The agent's browser works in Scorpion's own browser pane (beside the chat, or the chat's tile in the orb), not in a window of its own.
function fakePane() {
  const log = [];
  let open = false;
  const wc = {
    loadURL: async (u) => { log.push(['load', u]); },
    isLoading: () => false,
    executeJavaScript: async () => ({ title: 'Page', url: 'https://example.com/', text: 'Hello', items: [{ ref: 1, kind: 'link', text: 'More', href: 'https://example.com/more' }] }),
    sendInputEvent: (e) => log.push(['input', e.type]),
  };
  const pane = {
    ensure: async () => { log.push(['ensure']); open = true; return wc; },
    isOpen: () => open,
    show: () => log.push(['show']),
    close: () => { open = false; log.push(['close']); },
    clearData: async () => log.push(['clear']),
  };
  return { pane, log };
}

test('the agent browser opens its pages in the pane, and closing it closes the pane', async () => {
  const { pane, log } = fakePane();
  const b = createAgentBrowser({ pane });
  assert.equal(b.isOpen(), false);
  await assert.rejects(() => b.read(), /No page is open/);
  const seen = await b.open('example.com');
  assert.ok(log.some(([k, u]) => k === 'load' && u === 'https://example.com/'));
  assert.ok(log.some(([k]) => k === 'ensure'));
  assert.match(seen, /Hello/);
  assert.match(seen, /\[1\] link "More"|More/);
  assert.equal(b.isOpen(), true);
  assert.equal(b.element(1).text, 'More');
  b.show();
  assert.ok(log.some(([k]) => k === 'show'));
  assert.match(b.close(), /Closed/);
  assert.equal(b.isOpen(), false);
  await b.clearData();
  assert.ok(log.some(([k]) => k === 'clear'));
});

test('a page that cannot be opened is an error, not a new window', async () => {
  const b = createAgentBrowser({ pane: { ensure: async () => { throw new Error("Scorpion's browser could not open."); }, isOpen: () => false, show() {}, close() {}, clearData: async () => {} } });
  await assert.rejects(() => b.open('example.com'), /could not open/);
});
