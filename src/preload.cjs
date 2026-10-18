// The only bridge between the UI and the main process. The renderer gets a
// fixed list of calls, never Node.js or raw ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);
const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('scorpion', {
  state: invoke('app:state'),
  updateSettings: invoke('settings:update'),

  loadModel: invoke('model:load'),
  downloadModel: invoke('model:download'),
  cancelDownload: invoke('model:cancelDownload'),
  importModel: invoke('model:import'),
  deleteModel: invoke('model:delete'),
  uninstallCatalogModel: invoke('model:uninstallCatalog'),
  reinstallModel: invoke('model:reinstall'),

  chooseWorkspace: invoke('workspace:choose'),
  openWorkspace: invoke('workspace:open'),

  createThread: invoke('thread:create'),
  getThread: invoke('thread:get'),
  deleteThread: invoke('thread:delete'),
  renameThread: invoke('thread:rename'),
  setThreadAgent: invoke('thread:setAgent'),
  setThreadMode: invoke('thread:setMode'),

  saveAgent: invoke('agents:save'),
  deleteAgent: invoke('agents:delete'),

  listSchedules: invoke('schedules:list'),
  saveSchedule: invoke('schedules:save'),
  deleteSchedule: invoke('schedules:delete'),
  runSchedule: invoke('schedules:run'),
  chooseFolder: invoke('dialog:folder'),
  setOpenAtLogin: invoke('app:setOpenAtLogin'),

  send: invoke('chat:send'),
  stop: invoke('chat:stop'),
  approve: invoke('chat:approve'),

  addDocuments: invoke('docs:add'),
  removeDocument: invoke('docs:remove'),

  listMemories: invoke('memory:list'),
  addMemory: invoke('memory:add'),
  updateMemory: invoke('memory:update'),
  deleteMemory: invoke('memory:delete'),
  clearMemories: invoke('memory:clear'),

  onChatEvent: on('chat:event'),
  onModelStatus: on('model:status'),
  onDownload: on('model:download'),
  onDocsProgress: on('docs:progress'),
  onThreadsChanged: on('threads:changed'),
  onSchedulesChanged: on('schedules:changed'),
  onOpenThread: on('open-thread'),
});
