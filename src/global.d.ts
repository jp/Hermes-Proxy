import type {
  CaCertificateDetails,
  InstalledBrowser,
  ProxyEntry,
  ProxySettings,
  RequestHeaderDraft,
  Rule,
} from './types';

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
  getCaCertificateDetails?: () => Promise<CaCertificateDetails | null>;
  getProxyPort?: () => Promise<number>;
  getProxyEndpoint?: () => Promise<{ host: string; port: number }>;
  getProxySettings?: () => Promise<ProxySettings>;
  setProxySettings?: (
    settings: Partial<ProxySettings>
  ) => Promise<{ settings: ProxySettings; proxyPort: number } | undefined>;
  getRules?: () => Promise<Rule[]>;
  setRules?: (rules: Rule[]) => Promise<void> | void;
  onProxyEntry?: (cb: (entry: ProxyEntry) => void) => () => void;
  onCaReady?: (cb: (path: string) => void) => () => void;
  onProxyPortReady?: (cb: (port: number) => void) => () => void;
  onProxyEndpointReady?: (cb: (endpoint: { host: string; port: number }) => void) => () => void;
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
  getBrowsers?: (refresh?: boolean) => Promise<InstalledBrowser[]>;
  launchBrowser?: (browserId: string) => Promise<{ ok: boolean; error?: string }>;
  showBrowserMenu?: () => void;
  deleteEntries?: (entryIds: string[]) => Promise<boolean>;
  getCapturePaused?: () => Promise<boolean>;
  setCapturePaused?: (paused: boolean) => Promise<boolean>;
  onEntriesRemoved?: (cb: (entryIds: string[]) => void) => () => void;
  onCapturePaused?: (cb: (paused: boolean) => void) => () => void;
  showTrafficContextMenu?: (entryIds: string[] | string) => void;
  exportCaCertificate?: () => void;
  saveResponseBody?: (payload: SaveBodyPayload) => void;
}

declare global {
  interface Window {
    electronAPI?: ElectronApi;
  }
}

export {};
