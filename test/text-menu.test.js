import { test } from 'node:test';
import assert from 'node:assert/strict';
import { textMenuTemplate } from '../src/main/text-menu.js';

const labels = (t) => t.map((i) => (i.type === 'separator' ? '-' : i.label));

test('a text field offers undo, cut, copy, paste and select all', () => {
  const t = textMenuTemplate({ isEditable: true, selectionText: 'hello', editFlags: { canUndo: true, canRedo: false, canCut: true, canCopy: true, canPaste: true, canSelectAll: true } });
  assert.deepEqual(labels(t), ['Undo', 'Redo', '-', 'Cut', 'Copy', 'Paste', 'Select all']);
  assert.equal(t.find((i) => i.label === 'Redo').enabled, false);
  assert.equal(t.find((i) => i.label === 'Cut').enabled, true);
});

test('cut and copy are off with nothing selected, paste stays on', () => {
  const t = textMenuTemplate({ isEditable: true, selectionText: '', editFlags: { canPaste: true } });
  assert.equal(t.find((i) => i.label === 'Cut').enabled, false);
  assert.equal(t.find((i) => i.label === 'Copy').enabled, false);
  assert.equal(t.find((i) => i.label === 'Paste').enabled, true);
});

test('selected text in a message can be copied; nothing selected shows no menu', () => {
  assert.deepEqual(labels(textMenuTemplate({ isEditable: false, selectionText: 'a line' })), ['Copy', 'Select all']);
  assert.deepEqual(textMenuTemplate({ isEditable: false, selectionText: '  ' }), []);
});

test('a link can be opened or copied, and only web and mail links', () => {
  const calls = [];
  const t = textMenuTemplate({ linkURL: 'https://example.com/x', selectionText: '' }, { openLink: (u) => calls.push(['open', u]), copyText: (u) => calls.push(['copy', u]) });
  assert.deepEqual(labels(t), ['Open link', 'Copy link address']);
  t[0].click(); t[1].click();
  assert.deepEqual(calls, [['open', 'https://example.com/x'], ['copy', 'https://example.com/x']]);
  assert.deepEqual(textMenuTemplate({ linkURL: 'javascript:alert(1)' }), []);
  const mail = textMenuTemplate({ linkURL: 'mailto:a@b.c' }, { copyText: (u) => calls.push(['copy', u]) });
  mail[1].click();
  assert.deepEqual(calls.at(-1), ['copy', 'a@b.c']);
});

test('a misspelled word offers corrections first', () => {
  const calls = [];
  const t = textMenuTemplate({ isEditable: true, misspelledWord: 'helo', dictionarySuggestions: ['hello', 'help', 'hero', 'held', 'helot', 'helm'], editFlags: {} }, { replaceWord: (w) => calls.push(w), addWord: (w) => calls.push(`add ${w}`) });
  assert.deepEqual(labels(t).slice(0, 7), ['hello', 'help', 'hero', 'held', 'helot', 'Add to dictionary', '-']);
  t[0].click(); t.find((i) => i.label === 'Add to dictionary').click();
  assert.deepEqual(calls, ['hello', 'add helo']);
  assert.equal(textMenuTemplate({ isEditable: true, misspelledWord: 'zzq', dictionarySuggestions: [], editFlags: {} })[0].label, 'No suggestions');
});
