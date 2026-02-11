import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { SETTINGS_FILENAME } from './constants';
import type { ProxySettings } from './types';

export const getDefaultProxySettings = (): ProxySettings => ({
  listenOnAllInterfaces: true,
});

export const normalizeProxySettings = (settings: unknown): ProxySettings => {
  const current = (settings || {}) as Partial<ProxySettings>;
  return {
    listenOnAllInterfaces:
      typeof current.listenOnAllInterfaces === 'boolean'
        ? current.listenOnAllInterfaces
        : getDefaultProxySettings().listenOnAllInterfaces,
  };
};

export const getDefaultSettingsPath = () => path.join(app.getPath('userData'), SETTINGS_FILENAME);

export const loadProxySettings = (filePath = getDefaultSettingsPath()): ProxySettings => {
  if (!filePath || !fs.existsSync(filePath)) return getDefaultProxySettings();
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  return normalizeProxySettings(payload);
};

export const persistProxySettings = (settings: ProxySettings, filePath = getDefaultSettingsPath()) => {
  const normalized = normalizeProxySettings(settings);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf-8');
};
