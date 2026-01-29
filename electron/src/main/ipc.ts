import fs from 'fs';
import path from 'path';
import { app, dialog, ipcMain, shell } from 'electron';
import { broadcastClearTraffic, broadcastRulesUpdated } from './broadcast';
import { pemToDer } from './ca';
import { exportAllEntriesAsHar, exportEntryAsHar, importHarFromFile } from './har';
import { repeatEntryRequest } from './replay';
import { createRequestEditorWindow } from './windows';
import {
  getEntries,
  getEntryById,
  getProxyPort,
  getCaCertPath,
  getRules,
  setRules,
  clearEntries,
  getRulesFilePath,
} from './state';
import { getMcpEnabled, getMcpService, setMcpEnabled } from './mcp';
import { HISTORY_LIMIT } from './constants';
import type { AggregationGroupBy } from './mcp/types';
import { getBridgeInfoPath } from './mcp/bridgeServer';
import { getDefaultRulesPath, loadRulesFromFile, normalizeRules, persistRules } from './rules';
import { showTrafficContextMenu } from './menu';

export const registerIpcHandlers = () => {
  const buildMcpAgentConfig = () =>
    JSON.stringify(
      {
        name: 'Hermes MCP',
        transport: 'stdio',
        command: 'hermes-mcp-bridge',
        args: ['--info', getBridgeInfoPath()],
      },
      null,
      2
    );

  ipcMain.handle('mcp:get-enabled', () => getMcpEnabled());
  ipcMain.handle('mcp:set-enabled', (_event, enabled) => setMcpEnabled(Boolean(enabled)));
  ipcMain.handle('mcp:get-agent-config', () => buildMcpAgentConfig());
  ipcMain.handle('mcp:list-requests', (_event, filter) => getMcpService()?.listRequests(filter) ?? []);
  ipcMain.handle('mcp:get-request-details', (_event, requestId) =>
    requestId ? getMcpService()?.getRequestDetails(requestId) ?? null : null
  );
  ipcMain.handle('mcp:aggregate', (_event, groupBy: AggregationGroupBy, filter) =>
    getMcpService()?.aggregateRequests(groupBy, filter) ?? []
  );
  ipcMain.handle('mcp:add-annotation', (_event, annotation) => {
    if (!annotation) return false;
    getMcpService()?.addAnnotation(annotation);
    return true;
  });
  ipcMain.handle('mcp:list-annotations', (_event, requestId) =>
    requestId ? getMcpService()?.listAnnotations(requestId) ?? [] : []
  );

  ipcMain.handle('proxy:get-port', () => getProxyPort());

  ipcMain.handle('proxy:get-history', () => {
    const mcp = getMcpService();
    if (!mcp) return getEntries();
    return mcp.listProxyEntries({ limit: HISTORY_LIMIT });
  });
  ipcMain.handle('proxy:get-ca', () => ({ caCertPath: getCaCertPath() }));
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
    try {
      getMcpService()?.clearAll();
    } catch (err) {
      console.error('Failed to clear MCP store', err);
    }
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
  ipcMain.handle('proxy:traffic-context-menu', async (event, entryId) => {
    showTrafficContextMenu(event, entryId);
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
