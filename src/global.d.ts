import type { ProxyEntry, RequestHeaderDraft, Rule } from './types';

type AddRulePayload = {
  method?: string;
  host?: string;
  url?: string;
  headers?: Record<string, string | string[]>;
};

type SaveBodyPayload = {
  body: string;
  defaultPath: string;
};

type RepeatRequestPayload = {
  entryId: string;
  url: string;
  headers: RequestHeaderDraft[];
  method?: string;
  body?: string;
};

interface ElectronApi {
  getHistory?: () => Promise<ProxyEntry[]>;
  getCaCertificate?: () => Promise<{ caCertPath?: string }>;
  getProxyPort?: () => Promise<number>;
  getRules?: () => Promise<Rule[]>;
  setRules?: (rules: Rule[]) => Promise<void> | void;
  onProxyEntry?: (cb: (entry: ProxyEntry) => void) => () => void;
  onCaReady?: (cb: (path: string) => void) => () => void;
  onProxyPortReady?: (cb: (port: number) => void) => () => void;
  onClearTraffic?: (cb: () => void) => () => void;
  onAddRule?: (cb: (payload: AddRulePayload) => void) => () => void;
  onRulesUpdated?: (cb: (rules: Rule[]) => void) => () => void;
  repeatRequest?: (payload: RepeatRequestPayload) => Promise<void>;
  exportAllHar?: () => Promise<void>;
  importHar?: () => Promise<void>;
  clearTraffic?: () => Promise<void>;
  openRequestEditor?: (entryId: string) => Promise<boolean> | boolean;
  saveRules?: () => Promise<void>;
  loadRules?: () => Promise<void>;
  showTrafficContextMenu?: (entryId: string) => void;
  exportCaCertificate?: () => void;
  saveResponseBody?: (payload: SaveBodyPayload) => void;
  getMcpEnabled?: () => Promise<boolean>;
  setMcpEnabled?: (enabled: boolean) => Promise<boolean>;
  getMcpAgentConfig?: () => Promise<string>;
  mcpListRequests?: (filter?: unknown) => Promise<unknown[]>;
  mcpGetRequestDetails?: (requestId: string) => Promise<unknown>;
  mcpAggregate?: (groupBy: string, filter?: unknown) => Promise<unknown[]>;
  mcpAddAnnotation?: (annotation: unknown) => Promise<boolean>;
  mcpListAnnotations?: (requestId: string) => Promise<unknown[]>;
}

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
