const statusTone = (status) => {
  if (!status) return 'status-warn';
  if (status >= 500) return 'status-bad';
  if (status >= 400) return 'status-warn';
  return 'status-ok';
};

const headersToText = (headers = {}) =>
  Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

const headersToList = (headers = {}) => Object.entries(headers);

const buildEntryUrl = (entry) => {
  const protocol = entry?.protocol?.replace(':', '') || 'http';
  if (!entry) return '';
  return `${protocol}://${entry.host}${entry.path}${entry.query || ''}`;
};

const getHeaderValue = (headers, name) => {
  if (!headers) return '';
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  const value = headers?.[match];
  if (Array.isArray(value)) return value.join(', ');
  return value ? String(value) : '';
};

const parseContentLength = (headers) => {
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

const summarizeCacheability = (headers = {}) => {
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
};
