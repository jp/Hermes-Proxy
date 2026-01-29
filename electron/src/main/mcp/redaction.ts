import type { HeaderMap, HeaderValue } from '../types';

const REDACTED = '[REDACTED]';

const SENSITIVE_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-session-token',
]);

const SENSITIVE_JSON_KEYS = new Set([
  'access_token',
  'refresh_token',
  'id_token',
  'token',
  'api_key',
  'apikey',
  'x-api-key',
  'client_secret',
  'password',
  'secret',
  'session',
  'jwt',
]);

const redactHeaderValue = (value: HeaderValue): HeaderValue => {
  if (Array.isArray(value)) return value.map(() => REDACTED);
  if (value === null || value === undefined) return value;
  return REDACTED;
};

export const redactHeaders = (headers: HeaderMap): HeaderMap => {
  const next: HeaderMap = {};
  Object.entries(headers || {}).forEach(([key, value]) => {
    if (SENSITIVE_HEADERS.has(key.toLowerCase())) {
      next[key] = redactHeaderValue(value);
    } else {
      next[key] = value;
    }
  });
  return next;
};

const redactJsonValue = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => redactJsonValue(item));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    Object.entries(obj).forEach(([key, child]) => {
      if (SENSITIVE_JSON_KEYS.has(key.toLowerCase())) {
        next[key] = REDACTED;
      } else {
        next[key] = redactJsonValue(child);
      }
    });
    return next;
  }
  return value;
};

export const redactJsonBody = (body: string): string => {
  try {
    const parsed = JSON.parse(body);
    const redacted = redactJsonValue(parsed);
    return JSON.stringify(redacted);
  } catch (_err) {
    return body;
  }
};

export const redactBodyByContentType = (body: string | null | undefined, contentType: string | null | undefined) => {
  if (!body) return body;
  const normalized = (contentType || '').toLowerCase();
  if (normalized.includes('application/json') || normalized.includes('+json')) {
    return redactJsonBody(body);
  }
  return body;
};

export const REDACTION = {
  REDACTED,
};
