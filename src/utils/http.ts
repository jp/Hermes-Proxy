import type { HeaderMap, HeaderValue } from '../types';

const statusTone = (status?: number) => {
  if (!status) return 'status-warn';
  if (status >= 500) return 'status-bad';
  if (status >= 400) return 'status-warn';
  return 'status-ok';
};

const headersToText = (headers: HeaderMap = {}) =>
  Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

const headersToList = (headers: HeaderMap = {}) => Object.entries(headers);

const buildEntryUrl = (entry?: { protocol?: string; host?: string; path?: string; query?: string }) => {
  const protocol = entry?.protocol?.replace(':', '') || 'http';
  if (!entry) return '';
  return `${protocol}://${entry.host ?? ''}${entry.path ?? ''}${entry.query || ''}`;
};

const getHeaderValue = (headers: HeaderMap | undefined, name: string) => {
  if (!headers) return '';
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  const value = match ? (headers?.[match] as HeaderValue) : undefined;
  if (Array.isArray(value)) return value.join(', ');
  return value !== null && typeof value !== 'undefined' ? String(value) : '';
};

const parseContentLength = (headers: HeaderMap | undefined) => {
  const value = getHeaderValue(headers, 'content-length');
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const isCompressibleType = (contentType = '') => {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('text/') ||
    normalized.includes('json') ||
    normalized.includes('javascript') ||
    normalized.includes('xml') ||
    normalized.includes('svg')
  );
};

const isJsonContent = (contentType = '') => contentType.toLowerCase().includes('json');

const isHtmlContent = (contentType = '') => {
  const normalized = contentType.toLowerCase();
  return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
};

const isLikelyHtmlBody = (text = '') => {
  const snippet = text.trim().slice(0, 200).toLowerCase();
  return snippet.startsWith('<!doctype html') || snippet.startsWith('<html') || snippet.includes('<html');
};

const parseQueryParams = (query = '') => {
  const trimmed = query.startsWith('?') ? query.slice(1) : query;
  if (!trimmed) return [];
  const params = new URLSearchParams(trimmed);
  return Array.from(params.entries()).map(([name, value]) => ({
    name,
    value,
  }));
};

const summarizeCacheability = (headers: HeaderMap = {}) => {
  const cacheControl = getHeaderValue(headers, 'cache-control');
  const pragma = getHeaderValue(headers, 'pragma');
  const expires = getHeaderValue(headers, 'expires');
  const etag = getHeaderValue(headers, 'etag');
  const lastModified = getHeaderValue(headers, 'last-modified');

  const lowered = cacheControl.toLowerCase();
  if (lowered.includes('no-store')) return 'No (no-store)';
  if (lowered.includes('no-cache') || pragma.toLowerCase().includes('no-cache')) return 'Revalidate';
  if (lowered.includes('private')) return 'Private';
  if (lowered.includes('max-age') || lowered.includes('s-maxage') || lowered.includes('public')) return 'Yes';
  if (expires) return 'Yes (expires)';
  if (etag || lastModified) return 'Revalidate';
  return 'Unknown';
};

export {
  statusTone,
  headersToText,
  headersToList,
  buildEntryUrl,
  getHeaderValue,
  parseContentLength,
  isCompressibleType,
  isJsonContent,
  isHtmlContent,
  isLikelyHtmlBody,
  summarizeCacheability,
  parseQueryParams,
};
