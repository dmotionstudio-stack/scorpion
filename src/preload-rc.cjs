// The small red banner that shows on the computer while someone controls it from another device (main.js, rcShowBanner).
// It can do one thing: ask Scorpion to end the session.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('scorpionRc', { stop: () => ipcRenderer.send('rc:banner-stop') });
