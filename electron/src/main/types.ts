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

export interface ProxySettings {
  listenOnAllInterfaces: boolean;
}

export interface CertificateAttribute {
  name: string;
  shortName: string;
  oid: string;
  value: string;
}

export interface CertificateExtensionDetail {
  key: string;
  value: string;
}

export interface CertificateExtensionSummary {
  name: string;
  oid: string;
  critical: boolean;
  details: CertificateExtensionDetail[];
}

export interface CaCertificateDetails {
  subject: CertificateAttribute[];
  issuer: CertificateAttribute[];
  serialNumberHex: string;
  serialNumberDecimal: string;
  version: number | null;
  validFrom: string;
  validTo: string;
  signatureAlgorithm: string;
  fingerprintSha256: string;
  fingerprintSha1: string;
  publicKeyAlgorithm: string;
  publicKeyBits: number | null;
  publicKeyFingerprintSha256: string;
  subjectKeyIdentifier: string;
  authorityKeyIdentifier: string;
  extensions: CertificateExtensionSummary[];
}
