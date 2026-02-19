import fs from 'fs';
import path from 'path';
import { app, dialog, ipcMain, shell } from 'electron';
import { broadcastClearTraffic, broadcastRulesUpdated } from './broadcast';
import { getCaCertificateDetails, pemToDer } from './ca';
import { exportAllEntriesAsHar, exportEntryAsHar, importHarFromFile } from './har';
import { restartMitmProxy } from './proxy';
import { repeatEntryRequest } from './replay';
import { normalizeProxySettings, persistProxySettings } from './settings';
import { createRequestEditorWindow } from './windows';
import {
  getProxySettings,
  getProxyHost,
  getEntries,
  getEntryById,
  getProxyPort,
  getCaCertPath,
  getRules,
  setRules,
  setProxySettings,
  clearEntries,
  getRulesFilePath,
} from './state';
import { getDefaultRulesPath, loadRulesFromFile, normalizeRules, persistRules } from './rules';
import { showTrafficContextMenu } from './menu';

export const registerIpcHandlers = () => {
  ipcMain.handle('proxy:get-port', () => getProxyPort());
  ipcMain.handle('proxy:get-endpoint', () => ({
    host: getProxyHost(),
    port: getProxyPort(),
  }));
  ipcMain.handle('proxy:get-settings', () => getProxySettings());
  ipcMain.handle('proxy:set-settings', async (_event, nextSettings) => {
    const current = getProxySettings();
    const merged = normalizeProxySettings({
      ...current,
      ...(typeof nextSettings === 'object' && nextSettings ? nextSettings : {}),
    });
    const shouldRestart =
      merged.listenOnAllInterfaces !== current.listenOnAllInterfaces ||
      merged.maxCaptureBodySizeMb !== current.maxCaptureBodySizeMb;
    setProxySettings(merged);

    try {
      persistProxySettings(merged);
    } catch (err) {
      console.error('Failed to persist proxy settings', err);
    }

    if (shouldRestart) {
      try {
        await restartMitmProxy();
      } catch (err) {
        console.error('Failed to restart proxy after settings update', err);
      }
    }

    return {
      settings: getProxySettings(),
      proxyPort: getProxyPort(),
    };
  });

  ipcMain.handle('proxy:get-history', () => getEntries());
  ipcMain.handle('proxy:get-ca', () => ({ caCertPath: getCaCertPath() }));
  ipcMain.handle('proxy:get-ca-details', () => {
    const caCertPath = getCaCertPath();
    if (!caCertPath) return null;
    return getCaCertificateDetails(caCertPath);
  });
  ipcMain.handle('proxy:get-rules', () => getRules());
  ipcMain.handle('proxy:set-rules', (_event, nextRules) => {
    const normalized = normalizeRules(nextRules);
    setRules(normalized);
    try {
      persistRules(normalized);
    } catch (err) {
      console.error('Failed to persist rules', err);
    }
    return normalized;
  });
  ipcMain.handle('proxy:save-rules', async () => {
    const savePath = await dialog.showSaveDialog({
      title: 'Save rules',
      defaultPath: getRulesFilePath() || getDefaultRulesPath(),
      filters: [{ name: 'Rules', extensions: ['json'] }],
    });
    if (savePath.canceled || !savePath.filePath) return false;
    try {
      persistRules(getRules(), savePath.filePath);
      return true;
    } catch (err) {
      console.error('Failed to save rules', err);
      return false;
    }
  });
  ipcMain.handle('proxy:load-rules', async () => {
    const openPath = await dialog.showOpenDialog({
      title: 'Load rules',
      defaultPath: getRulesFilePath() || getDefaultRulesPath(),
      filters: [{ name: 'Rules', extensions: ['json'] }],
      properties: ['openFile'],
    });
    if (openPath.canceled || !openPath.filePaths?.length) return false;
    try {
      const loadedRules = loadRulesFromFile(openPath.filePaths[0]);
      setRules(loadedRules);
      broadcastRulesUpdated(loadedRules);
      return true;
    } catch (err) {
      console.error('Failed to load rules', err);
      return false;
    }
  });
  ipcMain.handle('proxy:repeat-request', async (_event, payload) => {
    const entryId = typeof payload === 'string' ? payload : payload?.entryId;
    const entry = entryId ? getEntryById(entryId) : null;
    if (!entry) return false;
    try {
      await repeatEntryRequest(entry, typeof payload === 'object' ? payload : {});
      return true;
    } catch (err) {
      console.error('Failed to repeat request', err);
      return false;
    }
  });
  ipcMain.handle('proxy:open-request-editor', (_event, entryId) => {
    const entry = getEntryById(entryId);
    if (!entry) return false;
    createRequestEditorWindow(entryId);
    return true;
  });
  ipcMain.handle('proxy:export-all-har', async () => {
    try {
      return await exportAllEntriesAsHar();
    } catch (err) {
      console.error('Failed to export all HAR', err);
      return false;
    }
  });
  ipcMain.handle('proxy:import-har', async () => {
    const openPath = await dialog.showOpenDialog({
      title: 'Import HAR file',
      filters: [{ name: 'HAR', extensions: ['har'] }],
      properties: ['openFile'],
    });
    if (openPath.canceled || !openPath.filePaths?.length) return false;
    try {
      return importHarFromFile(openPath.filePaths[0]);
    } catch (err) {
      console.error('Failed to import HAR file', err);
      return false;
    }
  });
  ipcMain.handle('proxy:clear-traffic', () => {
    clearEntries();
    broadcastClearTraffic();
    return true;
  });
  ipcMain.handle('proxy:open-ca-folder', () => {
    const caCertPath = getCaCertPath();
    if (caCertPath) {
      shell.showItemInFolder(caCertPath);
      return true;
    }
    return false;
  });
  ipcMain.handle('proxy:export-ca-certificate', async () => {
    const caCertPath = getCaCertPath();
    if (!caCertPath) return false;
    try {
      const pemText = fs.readFileSync(caCertPath, 'utf8');
      const derBuffer = pemToDer(pemText);
      if (!derBuffer) return false;
      const defaultDir = app.getPath('downloads');
      const savePath = await dialog.showSaveDialog({
        title: 'Export Hermes Proxy CA certificate',
        defaultPath: path.join(defaultDir, 'hermes-proxy-ca.cer'),
        filters: [{ name: 'Certificate', extensions: ['cer', 'crt'] }],
      });
      if (savePath.canceled || !savePath.filePath) return false;
      const filePath = savePath.filePath.endsWith('.cer') || savePath.filePath.endsWith('.crt')
        ? savePath.filePath
        : `${savePath.filePath}.cer`;
      fs.writeFileSync(filePath, derBuffer);
      shell.showItemInFolder(filePath);
      return true;
    } catch (err) {
      console.error('Failed to export CA certificate', err);
      return false;
    }
  });
  ipcMain.handle('proxy:traffic-context-menu', async (event, entryIds) => {
    showTrafficContextMenu(event, entryIds);
  });
  ipcMain.handle('proxy:save-response-body', async (_event, payload) => {
    const body = payload?.body;
    if (!body) return false;
    const defaultPath = payload?.defaultPath || 'response-body.txt';
    const savePath = await dialog.showSaveDialog({
      title: 'Save Response Body',
      defaultPath,
    });
    if (savePath.canceled || !savePath.filePath) return false;
    fs.writeFileSync(savePath.filePath, body, 'utf-8');
    return true;
  });
  ipcMain.handle('proxy:export-entry-har', async (_event, entryId) => exportEntryAsHar(entryId));
};
