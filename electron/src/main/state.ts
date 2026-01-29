import type { ProxyEntry, Rule } from './types';
import { getMcpService } from './mcp';
import { proxyEntryFromDetails } from './mcp/adapters';
import { HISTORY_LIMIT, PROXY_PORT_START } from './constants';

const entries: ProxyEntry[] = [];
let rules: Rule[] = [];
let caCertPath: string | null = null;
let proxyInstance: { close?: () => void } | null = null;
let proxyPort = PROXY_PORT_START;
let rulesFilePath: string | null = null;

export const getEntries = () => entries;

export const addEntry = (entry: ProxyEntry) => {
  entries.unshift(entry);
  if (entries.length > HISTORY_LIMIT) entries.pop();
};

export const clearEntries = () => {
  entries.splice(0, entries.length);
};

export const getEntryById = (entryId: string) => {
  const inMemory = entries.find((entry) => entry.id === entryId);
  if (inMemory) return inMemory;
  const service = getMcpService();
  const details = service?.getRequestDetails(entryId);
  return details ? proxyEntryFromDetails(details) : undefined;
};

export const getRules = () => rules;

export const setRules = (nextRules: Rule[]) => {
  rules = nextRules;
};

export const getCaCertPath = () => caCertPath;

export const setCaCertPath = (nextPath: string | null) => {
  caCertPath = nextPath;
};

export const getProxyInstance = () => proxyInstance;

export const setProxyInstance = (nextInstance: { close?: () => void } | null) => {
  proxyInstance = nextInstance;
};

export const getProxyPort = () => proxyPort;

export const setProxyPort = (nextPort: number) => {
  proxyPort = nextPort;
};

export const getRulesFilePath = () => rulesFilePath;

export const setRulesFilePath = (nextPath: string | null) => {
  rulesFilePath = nextPath;
};
