import { BrowserWindow, Menu, clipboard } from 'electron';
import { deleteEntries } from './broadcast';
import { buildCurlCommand, buildFetchCommand, buildPowerShellCommand } from './commands';
import { buildEntryUrl } from './entries';
import { exportEntryAsHar, exportSelectedEntriesAsHar } from './har';
import { getEntryById } from './state';

export const showTrafficContextMenu = (
  event: Electron.IpcMainInvokeEvent,
  entryIds: string[] | string,
) => {
  const ids = Array.isArray(entryIds) ? entryIds : [entryIds];
  const uniqueIds = Array.from(new Set(ids.filter((id) => Boolean(id))));
  if (uniqueIds.length > 1) {
    const menu = Menu.buildFromTemplate([
      {
        label: `Copy ${uniqueIds.length} URLs`,
        click: () => {
          const urls = uniqueIds
            .map((id) => getEntryById(id))
            .filter((candidate): candidate is NonNullable<typeof candidate> => Boolean(candidate))
            .map((candidate) => buildEntryUrl(candidate));
          clipboard.writeText(urls.join('\n'));
        },
      },
      {
        label: 'Export Selected as HAR',
        click: () => exportSelectedEntriesAsHar(uniqueIds),
      },
      { type: 'separator' },
      {
        label: `Delete ${uniqueIds.length} Requests`,
        click: () => deleteEntries(uniqueIds),
      },
    ]);
    menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
    return;
  }

  const entryId = uniqueIds[0];
  const entry = entryId ? getEntryById(entryId) : null;
  const isHttpEntry = Boolean(entry) && entry?.kind !== 'websocket';
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
          enabled: isHttpEntry,
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildCurlCommand(entry));
          },
        },
        {
          label: 'Copy as PowerShell',
          enabled: isHttpEntry,
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildPowerShellCommand(entry));
          },
        },
        {
          label: 'Copy as fetch',
          enabled: isHttpEntry,
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildFetchCommand(entry));
          },
        },
        { type: 'separator' },
        {
          label: 'Copy response',
          enabled: isHttpEntry,
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
      enabled: isHttpEntry,
    },
    { type: 'separator' },
    {
      label: 'Delete',
      enabled: Boolean(entry),
      click: () => deleteEntries([entryId]),
    },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
};
