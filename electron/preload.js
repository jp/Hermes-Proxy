const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  onProxyEntry: (callback) => {
    const listener = (_event, entry) => callback(entry);
    ipcRenderer.on('proxy-entry', listener);
    return () => ipcRenderer.removeListener('proxy-entry', listener);
  },
  getRules: () => ipcRenderer.invoke('proxy:get-rules'),
  setRules: (rules) => ipcRenderer.invoke('proxy:set-rules', rules),
  onClearTraffic: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('proxy-clear-traffic', listener);
    return () => ipcRenderer.removeListener('proxy-clear-traffic', listener);
  },
  onAddRule: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('proxy-add-rule', listener);
    return () => ipcRenderer.removeListener('proxy-add-rule', listener);
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
  repeatRequest: (payload) => ipcRenderer.invoke('proxy:repeat-request', payload),
  exportAllHar: () => ipcRenderer.invoke('proxy:export-all-har'),
  importHar: () => ipcRenderer.invoke('proxy:import-har'),
  clearTraffic: () => ipcRenderer.invoke('proxy:clear-traffic'),
  saveResponseBody: (payload) => ipcRenderer.invoke('proxy:save-response-body', payload),
  exportCaCertificate: () => ipcRenderer.invoke('proxy:export-ca-certificate'),
  openCaFolder: () => ipcRenderer.invoke('proxy:open-ca-folder'),
  showTrafficContextMenu: (entryId) => ipcRenderer.invoke('proxy:traffic-context-menu', entryId),
});
