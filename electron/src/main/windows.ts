import path from 'path';
import { app, BrowserWindow } from 'electron';
import { broadcastCaReady, broadcastPortReady } from './broadcast';
import { getCaCertPath, getProxyPort } from './state';

const getIconPath = () => path.join(app.getAppPath(), 'src/images/icon.png');

const getPreloadPath = () => path.join(app.getAppPath(), 'electron', 'preload.js');

export const createMainWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#0f172a',
    icon: getIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://localhost:5174');
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  if (getCaCertPath()) {
    broadcastCaReady();
  }
  if (getProxyPort()) {
    broadcastPortReady();
  }
};

export const createRequestEditorWindow = (entryId: string) => {
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    backgroundColor: '#0f172a',
    icon: getIconPath(),
    webPreferences: {
      preload: getPreloadPath(),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL(`http://localhost:5174/?mode=request-editor&entryId=${encodeURIComponent(entryId)}`);
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), {
      query: { mode: 'request-editor', entryId },
    });
  }
};
