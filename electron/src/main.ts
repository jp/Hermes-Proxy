import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './main/windows';
import { registerIpcHandlers } from './main/ipc';
import { getDefaultRulesPath, loadRulesFromFile } from './main/rules';
import { setRules, getProxyInstance } from './main/state';
import { startMitmProxy } from './main/proxy';
import { getMcpService, initMcpService } from './main/mcp';
import { startBridgeServer, stopBridgeServer } from './main/mcp/bridgeServer';

registerIpcHandlers();

app.whenReady().then(() => {
  try {
    const defaultRulesPath = getDefaultRulesPath();
    if (defaultRulesPath) {
      setRules(loadRulesFromFile(defaultRulesPath));
    }
  } catch (err) {
    console.error('Failed to load rules', err);
  }

  initMcpService();
  startBridgeServer();

  startMitmProxy().catch((err) => {
    console.error('Failed to start MITM proxy', err);
  });

  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  getProxyInstance()?.close?.();
  getMcpService()?.close();
  stopBridgeServer();
});
