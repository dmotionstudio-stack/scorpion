// The floating orb's page may only report a click, a right-click and a drag.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scorpionFloat', {
  click: () => ipcRenderer.send('float:click'),
  menu: () => ipcRenderer.send('float:menu'),
  drag: (phase, x, y) => ipcRenderer.send('float:drag', { phase, x, y }),
});
