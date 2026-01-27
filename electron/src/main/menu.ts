import { BrowserWindow, Menu, clipboard } from 'electron';
import { buildCurlCommand, buildFetchCommand, buildPowerShellCommand } from './commands';
import { buildEntryUrl } from './entries';
import { exportEntryAsHar } from './har';
import { getEntryById } from './state';

export const showTrafficContextMenu = (event: Electron.IpcMainInvokeEvent, entryId: string) => {
  const entry = getEntryById(entryId);
  const menu = Menu.buildFromTemplate([
    {
      label: 'Add matching rule',
      enabled: Boolean(entry),
      click: () => {
        if (!entry) return;
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.webContents.send('proxy-add-rule', {
          method: entry.method,
          host: entry.host,
          url: `${entry.path || ''}${entry.query || ''}`,
          headers: entry.requestHeaders || {},
        });
      },
    },
    { type: 'separator' },
    {
      label: 'Copy',
      enabled: Boolean(entry),
      submenu: [
        {
          label: 'Copy URL',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildEntryUrl(entry));
          },
        },
        {
          label: 'Copy as cURL',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildCurlCommand(entry));
          },
        },
        {
          label: 'Copy as PowerShell',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildPowerShellCommand(entry));
          },
        },
        {
          label: 'Copy as fetch',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildFetchCommand(entry));
          },
        },
        { type: 'separator' },
        {
          label: 'Copy response',
          click: () => {
            if (!entry) return;
            clipboard.writeText(entry.responseBody || '');
          },
        },
      ],
    },
    {
      label: 'Export Exchange as HAR',
      click: () => exportEntryAsHar(entryId),
      enabled: Boolean(entry),
    },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
};
