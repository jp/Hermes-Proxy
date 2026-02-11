import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './main/windows';
import { registerIpcHandlers } from './main/ipc';
import { getDefaultRulesPath, loadRulesFromFile } from './main/rules';
import { loadProxySettings } from './main/settings';
import { setRules, setProxySettings } from './main/state';
import { startMitmProxy, stopMitmProxy } from './main/proxy';

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

  try {
    setProxySettings(loadProxySettings());
  } catch (err) {
    console.error('Failed to load proxy settings', err);
  }

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
  void stopMitmProxy();
});
