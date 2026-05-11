import type { ProxyEntry, ProxySettings, Rule } from './types';
import { HISTORY_LIMIT, PROXY_PORT_START } from './constants';

const entries: ProxyEntry[] = [];
const entryIdByUrl = new Map<string, string>();
let rules: Rule[] = [];
let caCertPath: string | null = null;
let proxyInstance: { stop?: (...args: any[]) => void } | null = null;
let proxyPort = PROXY_PORT_START;
let proxyHost = 'localhost';
let rulesFilePath: string | null = null;
let proxySettings: ProxySettings = {
  listenOnAllInterfaces: true,
  maxCaptureBodySizeMb: 5,
};

export const getEntries = () => entries;

export const addEntry = (entry: ProxyEntry) => {
  const normalizeUrl = (value?: string | null) => {
    if (!value) return null;
    try {
      const parsed = new URL(value);
      parsed.hash = '';
      return parsed.toString();
    } catch (err) {
      return value.split('#')[0];
    }
  };
  const referrer = normalizeUrl(entry.referrer);
  const parentId = referrer ? entryIdByUrl.get(referrer) || null : null;
  const existingIndex = entries.findIndex((existingEntry) => existingEntry.id === entry.id);
  if (existingIndex >= 0) {
    const existingEntry = entries[existingIndex];
    entry.parentId = entry.parentId ?? existingEntry.parentId ?? parentId;
    const url = normalizeUrl(entry.url);
    if (url) {
      entryIdByUrl.set(url, entry.id);
    }
    entries[existingIndex] = entry;
    return;
  }

  entry.parentId = entry.parentId ?? parentId;
  const url = normalizeUrl(entry.url);
  if (url) {
    entryIdByUrl.set(url, entry.id);
  }
  entries.unshift(entry);
  if (entries.length > HISTORY_LIMIT) entries.pop();
};

export const clearEntries = () => {
  entries.splice(0, entries.length);
  entryIdByUrl.clear();
};

export const getEntryById = (entryId: string) => entries.find((entry) => entry.id === entryId);

export const getRules = () => rules;

export const setRules = (nextRules: Rule[]) => {
  rules = nextRules;
};

export const getCaCertPath = () => caCertPath;

export const setCaCertPath = (nextPath: string | null) => {
  caCertPath = nextPath;
};

export const getProxyInstance = () => proxyInstance;

export const setProxyInstance = (nextInstance: { stop?: (...args: any[]) => void } | null) => {
  proxyInstance = nextInstance;
};

export const getProxyPort = () => proxyPort;

export const setProxyPort = (nextPort: number) => {
  proxyPort = nextPort;
};

export const getProxyHost = () => proxyHost;

export const setProxyHost = (nextHost: string) => {
  proxyHost = nextHost;
};

export const getRulesFilePath = () => rulesFilePath;

export const setRulesFilePath = (nextPath: string | null) => {
  rulesFilePath = nextPath;
};

export const getProxySettings = (): ProxySettings => ({ ...proxySettings });

export const setProxySettings = (nextSettings: ProxySettings) => {
  proxySettings = nextSettings;
};
