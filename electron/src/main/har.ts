import fs from 'fs';
import { app, dialog } from 'electron';
import { buildEntryFromHar, buildHarEntry } from './entries';
import { broadcastEntry } from './broadcast';
import { getEntries, getEntryById } from './state';

const buildHarLog = (entries: ReturnType<typeof buildHarEntry>[]) => ({
  log: {
    version: '1.2',
    creator: { name: 'Hermes Proxy', version: app.getVersion() },
    entries,
  },
});

export const exportEntryAsHar = async (entryId: string) => {
  const entry = getEntryById(entryId);
  if (!entry) return;

  const har = buildHarLog([buildHarEntry(entry)]);

  const savePath = await dialog.showSaveDialog({
    title: 'Export Exchange as HAR',
    defaultPath: 'exchange.har',
    filters: [{ name: 'HAR', extensions: ['har'] }],
  });
  if (savePath.canceled || !savePath.filePath) return;
  fs.writeFileSync(savePath.filePath, JSON.stringify(har, null, 2), 'utf-8');
};

export const exportAllEntriesAsHar = async () => {
  const entries = getEntries();
  if (!entries.length) return false;
  const har = buildHarLog(entries.slice().reverse().map((entry) => buildHarEntry(entry)));
  const savePath = await dialog.showSaveDialog({
    title: 'Export All Traffic as HAR',
    defaultPath: 'traffic.har',
    filters: [{ name: 'HAR', extensions: ['har'] }],
  });
  if (savePath.canceled || !savePath.filePath) return false;
  fs.writeFileSync(savePath.filePath, JSON.stringify(har, null, 2), 'utf-8');
  return true;
};

export const importHarFromFile = (filePath: string) => {
  const fileText = fs.readFileSync(filePath, 'utf8');
  const har = JSON.parse(fileText);
  const harEntries = har?.log?.entries;
  if (!Array.isArray(harEntries) || harEntries.length === 0) return false;
  harEntries.forEach((harEntry: any) => {
    try {
      const entry = buildEntryFromHar(harEntry);
      broadcastEntry(entry);
    } catch (err) {
      console.error('Failed to import HAR entry', err);
    }
  });
  return true;
};
