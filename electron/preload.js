const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onProxyEntry: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('proxy-entry', listener);
    return () => ipcRenderer.removeListener('proxy-entry', listener);
  },
  onCaReady: (callback) => {
    const listener = (_event, caPath) => callback(caPath);
    ipcRenderer.on('proxy-ca-ready', listener);
    return () => ipcRenderer.removeListener('proxy-ca-ready', listener);
  },
  onProxyPortReady: (callback) => {
    const listener = (_event, port) => callback(port);
    ipcRenderer.on('proxy-port-ready', listener);
    return () => ipcRenderer.removeListener('proxy-port-ready', listener);
  },
  getHistory: () => ipcRenderer.invoke('proxy:get-history'),
  getCaCertificate: () => ipcRenderer.invoke('proxy:get-ca'),
  getProxyPort: () => ipcRenderer.invoke('proxy:get-port'),
  saveResponseBody: (payload) => ipcRenderer.invoke('proxy:save-response-body', payload),
  openCaFolder: () => ipcRenderer.invoke('proxy:open-ca-folder'),
  showTrafficContextMenu: (entryId) => ipcRenderer.invoke('proxy:traffic-context-menu', entryId),
});
