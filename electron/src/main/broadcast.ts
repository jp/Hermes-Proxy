import { BrowserWindow } from 'electron';
import type { ProxyEntry, Rule } from './types';
import { addEntry, getCaCertPath, getProxyPort } from './state';

export const broadcastEntry = (entry: ProxyEntry) => {
  addEntry(entry);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-entry', entry);
  });
};

export const broadcastCaReady = () => {
  const caCertPath = getCaCertPath();
  if (!caCertPath) return;
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-ca-ready', caCertPath);
  });
};

export const broadcastPortReady = () => {
  const proxyPort = getProxyPort();
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-port-ready', proxyPort);
  });
};

export const broadcastRulesUpdated = (rules: Rule[]) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-rules-updated', rules);
  });
};

export const broadcastClearTraffic = () => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-clear-traffic');
  });
};
