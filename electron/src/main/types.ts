export type HeaderValue = string | string[] | number | boolean | null | undefined;

export type HeaderMap = Record<string, HeaderValue>;

export interface RuleHeaderMatcher {
  name: string;
  value: string;
}

export interface RuleHeaderOverride {
  name: string;
  value: string;
}

export type RuleActionType = 'none' | 'delay' | 'overrideHeaders' | 'close';

export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  match: {
    methods: string[];
    hosts: string[];
    urls: string[];
    headers: RuleHeaderMatcher[];
  };
  actions: {
    type: RuleActionType;
    delayMs: number;
    overrideHeaders: RuleHeaderOverride[];
  };
}

export interface ProxyEntry {
  id: string;
  timestamp?: string;
  method: string;
  status?: number | null;
  protocol?: string;
  host: string;
  path: string;
  query?: string;
  requestHeaders: HeaderMap;
  responseHeaders: HeaderMap;
  requestBody?: string;
  responseBody?: string;
  requestDecodedBody?: string | null;
  responseDecodedBody?: string | null;
  requestBodySize?: number;
  responseBodySize?: number;
  requestDecodedSize?: number | null;
  responseDecodedSize?: number | null;
  requestHttpVersion?: string;
  responseHttpVersion?: string;
  durationMs?: number | null;
  error?: string | null;
  requestEncoding?: string | null;
  responseEncoding?: string | null;
}

export interface RuleRequestInfo {
  method: string;
  host: string;
  url: string;
  headers: HeaderMap;
}

export interface RepeatRequestOverrides {
  url?: string;
  headers?: Array<{ name: string; value: string }>;
  method?: string;
  body?: string;
}
