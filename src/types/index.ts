export type HeaderValue = string | string[] | number | boolean | null | undefined;

export type HeaderMap = Record<string, HeaderValue>;

export interface ProxyEntry {
  id: string;
  method: string;
  status?: number;
  protocol?: string;
  host: string;
  path: string;
  query?: string;
  url?: string;
  referrer?: string | null;
  parentId?: string | null;
  requestHeaders: HeaderMap;
  responseHeaders: HeaderMap;
  requestBody?: string;
  responseBody?: string;
  requestDecodedBody?: string;
  responseDecodedBody?: string;
  requestBodySize?: number;
  responseBodySize?: number;
  requestDecodedSize?: number;
  responseDecodedSize?: number;
  requestHttpVersion?: string;
  responseHttpVersion?: string;
  timestamp?: number;
  durationMs?: number;
  error?: string;
  requestEncoding?: string;
  responseEncoding?: string;
  requestStartAt?: number | null;
  requestEndAt?: number | null;
  responseStartAt?: number | null;
  responseEndAt?: number | null;
  timingSendMs?: number | null;
  timingWaitMs?: number | null;
  timingReceiveMs?: number | null;
}

export interface RequestHeaderDraft {
  name: string;
  value: string;
}

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

export interface PerformanceData {
  capturedAt: string;
  durationMs?: number;
  requestSize: number | null;
  requestSizeSource: string;
  requestDecodedSize?: number | null;
  requestEncoding: string;
  responseSize: number | null;
  responseSizeSource: string;
  responseDecodedSize?: number | null;
  responseEncoding: string;
  compressionSummary: string;
  potentialCompression: string;
  cacheable: string;
  cacheControl: string;
  expires: string;
  etag: string;
  lastModified: string;
  age: string;
  contentType: string;
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
