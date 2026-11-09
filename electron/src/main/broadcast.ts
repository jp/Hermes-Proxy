import { BrowserWindow } from 'electron';
import type { ProxyEntry, Rule } from './types';
import { addEntry, getCaCertPath, getProxyHost, getProxyPort, hasEntry, isCapturePaused, removeEntries } from './state';

/**
 * Records an entry and sends it to every window. While capture is paused, new
 * entries are dropped but updates to already-recorded ones still go through.
 * `force` is for user-initiated entries (replays, HAR imports).
 */
export const broadcastEntry = (entry: ProxyEntry, options: { force?: boolean } = {}) => {
  if (!options.force && isCapturePaused() && !hasEntry(entry.id)) return;
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

export const broadcastEndpointReady = () => {
  const payload = {
    host: getProxyHost(),
    port: getProxyPort(),
  };
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-endpoint-ready', payload);
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

export const broadcastEntriesRemoved = (entryIds: string[]) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-entries-removed', entryIds);
  });
};

export const broadcastCapturePaused = (paused: boolean) => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-capture-paused', paused);
  });
};

export const deleteEntries = (entryIds: unknown) => {
  const ids = (Array.isArray(entryIds) ? entryIds : [entryIds]).filter(
    (id): id is string => typeof id === 'string' && id.length > 0,
  );
  if (ids.length === 0) return false;
  removeEntries(ids);
  broadcastEntriesRemoved(ids);
  return true;
};
