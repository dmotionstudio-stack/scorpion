// The command palette: Ctrl+K anywhere in Scorpion's window (or typing on the
// intent wheel) searches everything Scorpion can do in one step
// (src/shared/intents.js) and runs the chosen entry. Anything that matches
// nothing can be asked of Scorpion instead.
import { intentsFor, rankIntents } from '/shared/intents.js';

export const PLATFORM = navigator.userAgent.includes('Windows') ? 'win32' : navigator.userAgent.includes('Mac') ? 'darwin' : 'linux';
const RECENT_KEY = 'paletteRecent';
const MAX_SHOWN = 12;

const readRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const keepRecent = (id) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((r) => r !== id)].slice(0, 5))); } catch { /* not kept */ } };

// ctx: { $, esc, api, toast, errText, nav, ask, ui: { newChat, talk, sidebar, welcome } }
export function initPalette({ $, esc, api, toast, errText, nav, ask, ui }) {
  const list = intentsFor(PLATFORM);
  const P = { open: false, shown: [], sel: 0, query: '', back: null };

  const root = document.createElement('div');
  root.className = 'palette hidden';
  root.id = 'palette';
  root.innerHTML = `<div class="pal-box" role="dialog" aria-label="Search everything Scorpion can do">
      <input id="pal-input" type="text" placeholder="Search Scorpion, or ask it anything" autocomplete="off" spellcheck="false" role="combobox" aria-controls="pal-list" aria-expanded="true" aria-autocomplete="list">
      <div id="pal-list" class="pal-list" role="listbox"></div>
      <div class="pal-foot muted small">↑ ↓ to choose · Enter to run · Esc to close</div>
    </div>`;
  document.body.appendChild(root);
  const input = $('#pal-input');

  // An empty query: the last few used first, then everything, by group.
  function entries(query) {
    if (query.trim()) return rankIntents(query, list).slice(0, MAX_SHOWN);
    const recent = readRecent().map((id) => list.find((i) => i.id === id)).filter(Boolean);
    return [...recent.map((it) => ({ ...it, group: 'Recent' })), ...list.filter((i) => !recent.includes(i))];
  }

  function render() {
    P.query = input.value;
    P.shown = entries(P.query);
    // Nothing fits (or as the last choice): ask Scorpion.
    if (P.query.trim()) P.shown.push({ id: 'ask', label: `Ask Scorpion: “${P.query.trim()}”`, group: 'Ask', keys: [], run: { ask: P.query.trim() } });
    P.sel = Math.min(P.sel, Math.max(0, P.shown.length - 1));
    let lastGroup = null;
    $('#pal-list').innerHTML = P.shown.map((it, i) => {
      const head = !P.query.trim() && it.group !== lastGroup ? `<div class="pal-group">${esc(it.group)}</div>` : '';
      lastGroup = it.group;
      const side = it.hint || (P.query.trim() ? it.group : '');
      return `${head}<div class="pal-item${i === P.sel ? ' sel' : ''}" role="option" id="pal-${i}" data-i="${i}" aria-selected="${i === P.sel}">
        <span>${esc(it.label)}</span>${side ? `<span class="pal-side">${esc(side)}</span>` : ''}</div>`;
    }).join('');
    input.setAttribute('aria-activedescendant', P.shown.length ? `pal-${P.sel}` : '');
    $(`#pal-${P.sel}`)?.scrollIntoView({ block: 'nearest' });
  }

  function open(query = '') {
    if (!P.open) P.back = document.activeElement; // focus goes back there on close
    P.open = true;
    P.sel = 0;
    root.classList.remove('hidden');
    input.value = query;
    render();
    input.focus();
    input.setSelectionRange(query.length, query.length);
  }
  function close() {
    if (!P.open) return;
    P.open = false;
    root.classList.add('hidden');
    if (P.back?.isConnected && P.back !== document.body) P.back.focus(); else input.blur();
    P.back = null;
  }

  // Runs one entry; true when it ran.
  async function run(it) {
    if (!it) return false;
    try {
      if (it.run.ask) { ask(it.run.ask); return true; }
      if (it.run.view) nav({ view: it.run.view });
      else if (it.run.ui) await ui[it.run.ui]?.();
      else if (it.run.main) await api.intentRun(it.id);
      if (it.id !== 'ask') keepRecent(it.id);
      return true;
    } catch (err) {
      toast(`Couldn't do that: ${errText(err)}`);
      return false;
    }
  }
  const choose = (i) => { const it = P.shown[i]; close(); run(it); };

  input.addEventListener('input', () => { P.sel = 0; render(); });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const n = P.shown.length;
      if (n) P.sel = (P.sel + (e.key === 'ArrowDown' ? 1 : -1) + n) % n;
      render();
    } else if (e.key === 'Enter') { e.preventDefault(); choose(P.sel); }
    else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
  });
  $('#pal-list').addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.pal-item');
    if (item) { e.preventDefault(); choose(Number(item.dataset.i)); }
  });
  root.addEventListener('pointerdown', (e) => { if (e.target === root) close(); });
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      e.stopPropagation();
      if (P.open) close(); else open();
    }
  }, true);

  return { open, close, run, get isOpen() { return P.open; } };
}
