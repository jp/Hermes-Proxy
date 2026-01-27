import type { HeaderMap } from './types';

export const applyHeaderOverrides = (
  headers: HeaderMap,
  overrides: Array<{ name: string; value: string }>
): HeaderMap => {
  const next: HeaderMap = { ...(headers || {}) };
  overrides.forEach((override) => {
    if (!override.name) return;
    const lower = override.name.toLowerCase();
    Object.keys(next).forEach((key) => {
      if (key.toLowerCase() === lower) {
        delete next[key];
      }
    });
    next[override.name] = override.value ?? '';
  });
  return next;
};

export const sanitizeHeaders = (headers: HeaderMap = {}, options: { stripContentEncoding?: boolean } = {}) => {
  const stripContentEncoding = Boolean(options.stripContentEncoding);
  const sanitized: HeaderMap = {};
  Object.entries(headers).forEach(([name, value]) => {
    if (typeof value === 'undefined') return;
    const lower = name.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'proxy-connection') return;
    if (stripContentEncoding && lower === 'content-encoding') return;
    sanitized[name] = Array.isArray(value) ? value.join(', ') : String(value);
  });
  return sanitized;
};

export const buildReplayHeaders = (entryHeaders: HeaderMap, overrides?: Array<{ name: string; value: string }>) => {
  const list = overrides;
  if (!Array.isArray(list)) return entryHeaders || {};
  return list.reduce<HeaderMap>((acc, item) => {
    const name = String(item?.name || '').trim();
    if (!name) return acc;
    acc[name] = String(item?.value ?? '');
    return acc;
  }, {});
};
