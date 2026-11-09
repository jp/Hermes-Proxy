import type { ProxyEntry } from '../types';
import { getHeaderValue, headersToText } from './http';

/**
 * Traffic filter syntax (space-separated terms, all must match):
 *   text               free text across method, URL, status, headers and WebSocket payloads
 *   "two words"        quoted free text
 *   method:POST        HTTP method (WS for WebSockets)
 *   status:404         exact status; also 4xx, >=400, <300, etc.
 *   host:*.example.com host, `*` wildcard; without a wildcard it is a substring match
 *   path:/api          path + query, same wildcard rules as host
 *   type:json          response content-type substring
 *   -term              negates any of the above, e.g. -host:gstatic.com
 */

export type FilterField = 'method' | 'status' | 'host' | 'path' | 'type';

export interface FilterTerm {
  field: FilterField | null;
  value: string;
  negate: boolean;
}

const FIELD_ALIASES: Record<string, FilterField> = {
  method: 'method',
  m: 'method',
  status: 'status',
  s: 'status',
  code: 'status',
  host: 'host',
  domain: 'host',
  h: 'host',
  path: 'path',
  url: 'path',
  p: 'path',
  type: 'type',
  mime: 'type',
  t: 'type',
};

const tokenize = (input: string) => {
  const tokens: string[] = [];
  const re = /(-?[\w]+:)?"([^"]*)"|\S+/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(input))) {
    tokens.push(match[2] !== undefined ? `${match[1] ?? ''}${match[2]}` : match[0]);
  }
  return tokens;
};

export const parseFilter = (input: string): FilterTerm[] =>
  tokenize(input.trim())
    .map((token) => {
      let negate = false;
      let rest = token;
      if (rest.startsWith('-') && rest.length > 1) {
        negate = true;
        rest = rest.slice(1);
      }
      const colon = rest.indexOf(':');
      if (colon > 0) {
        const field = FIELD_ALIASES[rest.slice(0, colon).toLowerCase()];
        if (field) {
          return { field, value: rest.slice(colon + 1), negate };
        }
      }
      return { field: null, value: rest, negate };
    })
    .filter((term) => term.value.length > 0);

const wildcardToRegExp = (pattern: string) =>
  new RegExp(`^${pattern.split('*').map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*')}$`, 'i');

const matchText = (actual: string, pattern: string) => {
  if (pattern.includes('*')) return wildcardToRegExp(pattern).test(actual);
  return actual.toLowerCase().includes(pattern.toLowerCase());
};

const matchStatus = (status: number | undefined | null, pattern: string) => {
  const value = pattern.toLowerCase();
  const range = /^([1-5])xx$/.exec(value);
  if (range) {
    if (typeof status !== 'number') return false;
    return Math.floor(status / 100) === Number(range[1]);
  }
  const comparison = /^(>=|<=|>|<)(\d+)$/.exec(value);
  if (comparison) {
    if (typeof status !== 'number') return false;
    const target = Number(comparison[2]);
    switch (comparison[1]) {
      case '>=':
        return status >= target;
      case '<=':
        return status <= target;
      case '>':
        return status > target;
      default:
        return status < target;
    }
  }
  if (value === 'none' || value === 'pending' || value === '-') return typeof status !== 'number';
  return String(status ?? '') === value;
};

// Entries are replaced (new object) whenever they change, so a WeakMap cache stays correct.
const haystackCache = new WeakMap<ProxyEntry, string>();

const getHaystack = (entry: ProxyEntry) => {
  let haystack = haystackCache.get(entry);
  if (haystack !== undefined) return haystack;
  const webSocketPayload = (entry.webSocketMessages || []).map((message) => message.content).join(' ');
  haystack = [
    entry.kind,
    entry.method,
    entry.host,
    entry.path,
    entry.query,
    String(entry.status ?? ''),
    entry.webSocketState,
    String(entry.webSocketCloseCode ?? ''),
    entry.webSocketCloseReason,
    webSocketPayload,
    headersToText(entry.requestHeaders),
    headersToText(entry.responseHeaders),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
  haystackCache.set(entry, haystack);
  return haystack;
};

const matchTerm = (entry: ProxyEntry, term: FilterTerm) => {
  switch (term.field) {
    case 'method': {
      const method = entry.kind === 'websocket' ? 'WS' : entry.method || '';
      return method.toLowerCase() === term.value.toLowerCase();
    }
    case 'status':
      return matchStatus(entry.status, term.value);
    case 'host':
      return matchText(entry.host || '', term.value);
    case 'path':
      return matchText(`${entry.path || ''}${entry.query || ''}`, term.value);
    case 'type':
      return matchText(getHeaderValue(entry.responseHeaders, 'content-type'), term.value);
    default:
      return getHaystack(entry).includes(term.value.toLowerCase());
  }
};

export const matchesFilter = (entry: ProxyEntry, terms: FilterTerm[]) =>
  terms.every((term) => matchTerm(entry, term) !== term.negate);

const STATIC_EXTENSIONS =
  /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp|css|js|mjs|map|woff2?|ttf|otf|eot|mp4|webm|mp3|wav|ogg)$/i;
const STATIC_TYPES = /^(image|font|audio|video)\/|text\/css|javascript/i;

/** Images, fonts, stylesheets, scripts and media: the noise you usually want to hide. */
export const isStaticAsset = (entry: ProxyEntry) => {
  if (entry.kind === 'websocket') return false;
  if (STATIC_EXTENSIONS.test(entry.path || '')) return true;
  return STATIC_TYPES.test(getHeaderValue(entry.responseHeaders, 'content-type'));
};
