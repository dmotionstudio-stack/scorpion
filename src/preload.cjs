// The only bridge between the UI and the main process. The renderer gets a
// fixed list of calls, never Node.js or raw ipcRenderer.
const { contextBridge, ipcRenderer } = require('electron');

const invoke = (channel) => (arg) => ipcRenderer.invoke(channel, arg);
const on = (channel) => (fn) => {
  const listener = (_e, payload) => fn(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('kenzo', {
  state: invoke('app:state'),
  updateSettings: invoke('settings:update'),

  loadModel: invoke('model:load'),
  downloadModel: invoke('model:download'),
  cancelDownload: invoke('model:cancelDownload'),
  importModel: invoke('model:import'),
  deleteModel: invoke('model:delete'),

  chooseWorkspace: invoke('workspace:choose'),
  openWorkspace: invoke('workspace:open'),

  createThread: invoke('thread:create'),
  getThread: invoke('thread:get'),
  deleteThread: invoke('thread:delete'),
  renameThread: invoke('thread:rename'),

  send: invoke('chat:send'),
  stop: invoke('chat:stop'),
  approve: invoke('chat:approve'),

  addDocuments: invoke('docs:add'),
  removeDocument: invoke('docs:remove'),

  onChatEvent: on('chat:event'),
  onModelStatus: on('model:status'),
  onDownload: on('model:download'),
  onDocsProgress: on('docs:progress'),
});
