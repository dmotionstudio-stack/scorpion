// What Scorpion's shell pages (the edge rail, the summon dot and intent wheel,
// notifications, the on-screen display, Stage's strip) may use: each method of their
// window.scorpion with its IPC channel, and the events they receive. The
// Electron preload (preload.cjs) and the native shell host's bridge
// (shell-bridge.js, over shell-api.js) both expose exactly these, so the same
// pages run in either.
export const SHELL_CALLS = {
  state: 'app:state',
  shellPinned: 'shell:pinned',
  shellWindows: 'shell:windows',
  shellWindow: 'shell:window',
  shellTray: 'shell:tray',
  shellLaunch: 'shell:launch',
  shellVolume: 'shell:volume',
  shellMenu: 'shell:menu',
  shellGlance: 'shell:glance',
  shellRecent: 'shell:recent',
  shellIntent: 'shell:intent',
  shellIntents: 'shell:intents',
  shellWheel: 'shell:wheel',
  shellPalette: 'shell:palette',
  shellQuick: 'shell:quick',
  shellInstall: 'shell:install',
  constPreview: 'const:preview',
  notifications: 'shell:notifications',
  notificationAct: 'shell:notificationAct',
  shellStagePick: 'shell:stagePick',
  shellDot: 'shell:dot',
};
export const SHELL_EVENTS = {
  onSettingsChanged: 'settings:changed',
  onPerfChanged: 'perf:changed',
  onWheelOpen: 'wheel:open',
  onWheelClose: 'wheel:close',
  onNotify: 'shell:notify',
  onNotificationsChanged: 'shell:notifications',
  onOsd: 'shell:osd',
  onStageShow: 'stage:show',
  onStageHide: 'stage:hide',
  onStageArrive: 'stage:arrive',
  onRail: 'shell:rail',
};
// Only these may come in from outside Electron (the shell host).
export const SHELL_CHANNELS = new Set([...Object.values(SHELL_CALLS), 'shell:menuPick', 'shell:hostReady', 'shell:notifyIn', 'shell:notifyClosed']);
export const SHELL_EVENT_CHANNELS = new Set(Object.values(SHELL_EVENTS));
