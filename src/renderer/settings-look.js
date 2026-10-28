// Settings → General, the part about how Scorpion looks and runs:
// Performance (Full, Balanced, Light, and Light on battery), accessibility, the orb's look,
// the constellation map's options, its summon shortcut, and showing the
// welcome again. Its own module (show the values, wire the controls), the
// first part of Settings moved out of app.js.
export const PERF_LEVELS = ['full', 'balanced', 'light'];
export const CONSTELLATION_DEFAULTS = { recommend: true, motion: true, large: false, contrast: false };

// "Now: Light (on battery)" when the level in use isn't the one chosen.
export function perfNote(chosen, now) {
  return now && now !== chosen ? `Now: ${now[0].toUpperCase()}${now.slice(1)} (on battery)` : '';
}
export const constellationOptions = (settings) => ({ ...CONSTELLATION_DEFAULTS, ...(settings?.constellation || {}) });

// ctx: { $, api, S, setSetting, toast, IX, startWelcome }
export function initLookSettings({ $, api, S, setSetting, toast, IX, startWelcome }) {
  function render() {
    const chosen = PERF_LEVELS.includes(S.settings.performance) ? S.settings.performance : 'full';
    $('#perf-level').value = chosen;
    $('#perf-battery').checked = Boolean(S.settings.performanceOnBattery);
    $('#perf-now').textContent = perfNote(chosen, S.perf);
    $('#orb-look').value = S.settings.orbLook === 'constellation' ? 'constellation' : 'classic';
    if (document.activeElement !== $('#const-shortcut')) $('#const-shortcut').value = S.settings.constellationShortcut ?? 'Super+Space';
    const opts = constellationOptions(S.settings);
    for (const box of document.querySelectorAll('[data-const]')) box.checked = opts[box.dataset.const];
    const access = S.settings.access || {};
    for (const box of document.querySelectorAll('[data-access]')) box.checked = Boolean(access[box.dataset.access]);
  }

  $('#perf-level').onchange = (e) => setSetting({ performance: e.target.value });
  $('#perf-battery').onchange = (e) => setSetting({ performanceOnBattery: e.target.checked });
  $('#orb-look').onchange = async (e) => {
    S.settings = await api.updateSettings({ orbLook: e.target.value });
    if (IX.open) toast('The new look shows the next time the orb opens.');
  };
  $('#const-shortcut-save').onclick = async () => {
    const got = await api.constShortcut($('#const-shortcut').value.trim());
    $('#const-shortcut-now').textContent = got ? `In use: ${got}` : 'That combination is taken by the system or another app.';
  };
  for (const box of document.querySelectorAll('[data-const]')) {
    box.onchange = async () => {
      S.settings = await api.updateSettings({ constellation: { ...constellationOptions(S.settings), [box.dataset.const]: box.checked } });
      IX.orb?.refreshSettings?.();
    };
  }
  // Accessibility: each switch takes effect at once (main.js applyAccess).
  for (const box of document.querySelectorAll('[data-access]')) {
    box.onchange = async () => {
      try { S.settings.access = await api.sysAccess({ feature: box.dataset.access, on: box.checked }); } catch (err) { box.checked = !box.checked; toast(err.message || String(err)); }
    };
  }
  $('#welcome-again').onclick = () => startWelcome();
  render();
  return { render };
}
