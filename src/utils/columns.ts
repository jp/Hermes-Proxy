import type { ProxyEntry } from '../types';
import { getHeaderValue } from './http';

export type ColumnKey = 'time' | 'method' | 'status' | 'host' | 'path' | 'query' | 'type' | 'size' | 'duration';

export const COLUMN_ORDER: ColumnKey[] = ['time', 'method', 'status', 'host', 'path', 'query', 'type', 'size', 'duration'];

export const COLUMN_LABELS: Record<ColumnKey, string> = {
  time: 'Time',
  method: 'Method',
  status: 'Status',
  host: 'Host',
  path: 'Path',
  query: 'Query',
  type: 'Type',
  size: 'Size',
  duration: 'Duration',
};

export const DEFAULT_VISIBLE_COLUMNS: Record<ColumnKey, boolean> = {
  time: false,
  method: true,
  status: true,
  host: true,
  path: true,
  query: true,
  type: false,
  size: true,
  duration: true,
};

export type SortDirection = 'asc' | 'desc';

export interface SortState {
  key: ColumnKey;
  direction: SortDirection;
}

export const getEntryStartMs = (entry: ProxyEntry) => {
  if (typeof entry.requestStartAt === 'number') return entry.requestStartAt;
  if (typeof entry.timestamp === 'number') return entry.timestamp;
  if (typeof entry.timestamp === 'string') {
    const parsed = Date.parse(entry.timestamp);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

export const getEntrySize = (entry: ProxyEntry) => {
  if (entry.kind === 'websocket') {
    return (entry.webSocketMessages || []).reduce((total, message) => total + (message.size || 0), 0);
  }
  if (typeof entry.responseBodySize === 'number' && entry.responseBodySize > 0) return entry.responseBodySize;
  const contentLength = Number.parseInt(getHeaderValue(entry.responseHeaders, 'content-length'), 10);
  if (Number.isFinite(contentLength)) return contentLength;
  return typeof entry.responseBodySize === 'number' ? entry.responseBodySize : null;
};

/** Short content type for the table, e.g. "application/json; charset=utf-8" -> "json". */
export const getEntryShortType = (entry: ProxyEntry) => {
  if (entry.kind === 'websocket') return 'websocket';
  const contentType = getHeaderValue(entry.responseHeaders, 'content-type').split(';')[0].trim().toLowerCase();
  if (!contentType) return '';
  const [major, minor = ''] = contentType.split('/');
  if (major === 'image' || major === 'font' || major === 'audio' || major === 'video') return major;
  const subtype = minor.replace(/^x-/, '').replace(/^vnd\./, '');
  if (subtype.endsWith('+json')) return 'json';
  if (subtype.endsWith('+xml')) return 'xml';
  if (subtype === 'javascript' || subtype === 'ecmascript') return 'js';
  if (subtype === 'plain') return 'text';
  return subtype || major;
};

const sortValue = (entry: ProxyEntry, key: ColumnKey): string | number | null => {
  switch (key) {
    case 'time':
      return getEntryStartMs(entry);
    case 'method':
      return entry.kind === 'websocket' ? 'WS' : entry.method || '';
    case 'status':
      return typeof entry.status === 'number' ? entry.status : null;
    case 'host':
      return (entry.host || '').toLowerCase();
    case 'path':
      return (entry.path || '').toLowerCase();
    case 'query':
      return (entry.query || '').toLowerCase();
    case 'type':
      return getEntryShortType(entry);
    case 'size':
      return getEntrySize(entry);
    case 'duration':
      return typeof entry.durationMs === 'number' ? entry.durationMs : null;
    default:
      return null;
  }
};

/** Stable sort; empty values always go last regardless of direction. */
export const sortEntries = (entries: ProxyEntry[], sort: SortState | null) => {
  if (!sort) return entries;
  const factor = sort.direction === 'asc' ? 1 : -1;
  return entries
    .map((entry, index) => ({ entry, index, value: sortValue(entry, sort.key) }))
    .sort((a, b) => {
      const aEmpty = a.value === null || a.value === '';
      const bEmpty = b.value === null || b.value === '';
      if (aEmpty || bEmpty) {
        if (aEmpty && bEmpty) return a.index - b.index;
        return aEmpty ? 1 : -1;
      }
      if (a.value! < b.value!) return -1 * factor;
      if (a.value! > b.value!) return 1 * factor;
      return a.index - b.index;
    })
    .map((item) => item.entry);
};

export const nextSort = (current: SortState | null, key: ColumnKey): SortState | null => {
  if (!current || current.key !== key) return { key, direction: 'asc' };
  if (current.direction === 'asc') return { key, direction: 'desc' };
  return null;
};
