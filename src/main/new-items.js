// "New" on the desktop and in Files (right-click): a folder, or an empty
// document of a kind most programs open. Plain functions with the file
// system passed in, so the rules are tested on their own (test/new-items.test.js).
import fs from 'node:fs';
import path from 'node:path';

// kind: the menu's id; label: its menu entry; base: the new item's name; ext;
// text: what a new one starts with (empty is fine for a text file).
export const NEW_KINDS = [
  { id: 'folder', label: 'Folder', base: 'New folder', dir: true },
  { id: 'text', label: 'Text document (.txt)', base: 'New Text Document', ext: '.txt', text: '' },
  { id: 'rtf', label: 'Document (.rtf, opens in Word)', base: 'New Document', ext: '.rtf', text: '{\\rtf1\\ansi\\deff0{\\fonttbl{\\f0 Calibri;}}\\f0\\fs22 \\par}\n' },
  { id: 'markdown', label: 'Note (.md)', base: 'New Note', ext: '.md', text: '# \n' },
  { id: 'csv', label: 'Spreadsheet (.csv, opens in Excel)', base: 'New Spreadsheet', ext: '.csv', text: '' },
  { id: 'html', label: 'Web page (.html)', base: 'New Web Page', ext: '.html', text: '<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>New page</title>\n</head>\n<body>\n\n</body>\n</html>\n' },
];

// "New folder", then "New folder (2)", "New folder (3)"…: the first name not taken.
export function uniqueName(dir, base, ext = '', exists = fs.existsSync) {
  for (let n = 1; n < 1000; n++) {
    const name = `${base}${n > 1 ? ` (${n})` : ''}${ext}`;
    if (!exists(path.join(dir, name))) return name;
  }
  throw new Error(`Too many items named ${base}`);
}

// Make one in dir; gives its path. A name given (renamed straight away) is
// kept clean of what a file name can't hold.
export function createItem(dir, kindId, { io = fs } = {}) {
  const kind = NEW_KINDS.find((k) => k.id === kindId);
  if (!kind) throw new Error('Unknown kind of new item');
  if (!dir || !io.existsSync(dir)) throw new Error("That folder isn't there any more");
  const name = uniqueName(dir, kind.base, kind.ext || '', io.existsSync);
  const full = path.join(dir, name);
  if (kind.dir) io.mkdirSync(full);
  else io.writeFileSync(full, kind.text ?? '', { flag: 'wx' });
  return full;
}
