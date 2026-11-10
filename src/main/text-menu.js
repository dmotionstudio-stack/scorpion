// The right-click menu for text: what Electron's windows don't have by default.
// `params` is the 'context-menu' event's argument; `ops` does the things a menu
// item can't do by role (open or copy a link, correct a spelling).
export function textMenuTemplate(params, ops = {}) {
  const flags = params.editFlags || {};
  const selected = Boolean((params.selectionText || '').trim());
  const out = [];
  const group = (items) => {
    if (!items.length) return;
    if (out.length) out.push({ type: 'separator' });
    out.push(...items);
  };

  if (params.linkURL && /^(https?|mailto):/i.test(params.linkURL)) {
    group([
      { label: 'Open link', click: () => ops.openLink?.(params.linkURL) },
      { label: 'Copy link address', click: () => ops.copyText?.(params.linkURL.replace(/^mailto:/i, '')) },
    ]);
  }
  if (params.isEditable && params.misspelledWord) {
    const tips = (params.dictionarySuggestions || []).slice(0, 5);
    group([
      ...(tips.length ? tips.map((s) => ({ label: s, click: () => ops.replaceWord?.(s) })) : [{ label: 'No suggestions', enabled: false }]),
      { label: 'Add to dictionary', click: () => ops.addWord?.(params.misspelledWord) },
    ]);
  }
  if (params.isEditable) {
    group([
      { label: 'Undo', role: 'undo', enabled: flags.canUndo !== false },
      { label: 'Redo', role: 'redo', enabled: flags.canRedo !== false },
    ]);
    group([
      { label: 'Cut', role: 'cut', enabled: flags.canCut !== false && selected },
      { label: 'Copy', role: 'copy', enabled: flags.canCopy !== false && selected },
      { label: 'Paste', role: 'paste', enabled: flags.canPaste !== false },
      { label: 'Select all', role: 'selectAll', enabled: flags.canSelectAll !== false },
    ]);
  } else if (selected) {
    group([
      { label: 'Copy', role: 'copy' },
      { label: 'Select all', role: 'selectAll' },
    ]);
  }
  return out;
}
