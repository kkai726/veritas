const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('veritasNative', {
  platform: process.platform,
  version: process.versions.electron,
  httpPost: (req) => ipcRenderer.invoke('veritas:http', req),
});
