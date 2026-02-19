import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { SETTINGS_FILENAME } from './constants';
import type { ProxySettings } from './types';

const DEFAULT_MAX_CAPTURE_BODY_SIZE_MB = 5;
const MIN_CAPTURE_BODY_SIZE_MB = 1;
const MAX_CAPTURE_BODY_SIZE_MB = 1024;

const normalizeMaxCaptureBodySizeMb = (value: unknown) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return DEFAULT_MAX_CAPTURE_BODY_SIZE_MB;
  }
  const rounded = Math.round(value);
  return Math.min(MAX_CAPTURE_BODY_SIZE_MB, Math.max(MIN_CAPTURE_BODY_SIZE_MB, rounded));
};

export const getDefaultProxySettings = (): ProxySettings => ({
  listenOnAllInterfaces: true,
  maxCaptureBodySizeMb: DEFAULT_MAX_CAPTURE_BODY_SIZE_MB,
});

export const normalizeProxySettings = (settings: unknown): ProxySettings => {
  const current = (settings || {}) as Partial<ProxySettings>;
  return {
    listenOnAllInterfaces:
      typeof current.listenOnAllInterfaces === 'boolean'
        ? current.listenOnAllInterfaces
        : getDefaultProxySettings().listenOnAllInterfaces,
    maxCaptureBodySizeMb: normalizeMaxCaptureBodySizeMb(current.maxCaptureBodySizeMb),
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
