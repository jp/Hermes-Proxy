import os from 'os';
import path from 'path';
import { app, BrowserWindow, dialog, Menu } from 'electron';
import { closeLaunchedBrowsers, detectBrowsers, isExecutableFile, launchBrowser, type DetectedBrowser } from './browsers';
import { getCaCertPath, getProxyPort } from './state';

let cachedBrowsers: DetectedBrowser[] | null = null;

export const getInstalledBrowsers = (refresh = false) => {
  if (!cachedBrowsers || refresh) {
    cachedBrowsers = detectBrowsers({
      platform: process.platform,
      env: process.env,
      homeDir: os.homedir(),
      isExecutable: isExecutableFile,
    });
  }
  return cachedBrowsers;
};

export const launchInstalledBrowser = async (browserId: string) => {
  const browser = getInstalledBrowsers().find((candidate) => candidate.id === browserId);
  if (!browser) return { ok: false, error: 'This browser is no longer installed.' };
  const caCertPath = getCaCertPath();
  if (!caCertPath) return { ok: false, error: 'The proxy is still starting. Try again in a moment.' };
  try {
    await launchBrowser({
      browser,
      proxyPort: getProxyPort(),
      caCertPath,
      profilesRoot: path.join(app.getPath('userData'), 'browser-profiles'),
    });
    return { ok: true };
  } catch (err) {
    console.error(`Failed to launch ${browser.name}`, err);
    return { ok: false, error: `Could not start ${browser.name}: ${(err as Error)?.message || err}` };
  }
};

const launchAndReport = async (browserId: string) => {
  const result = await launchInstalledBrowser(browserId);
  if (!result.ok) dialog.showErrorBox('Could not open browser', result.error || 'Unknown error');
};

export const showBrowserMenu = (event: Electron.IpcMainInvokeEvent) => {
  const browsers = getInstalledBrowsers(true);
  const menu = Menu.buildFromTemplate([
    { label: 'Open a browser through Hermes', enabled: false },
    { type: 'separator' },
    ...(browsers.length
      ? browsers.map((browser) => ({ label: browser.name, click: () => void launchAndReport(browser.id) }))
      : [{ label: 'No supported browser found', enabled: false }]),
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
};

export { closeLaunchedBrowsers };
