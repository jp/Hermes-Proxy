import { describe, expect, it } from 'vitest';
import { isStaticAsset, matchesFilter, parseFilter } from '../utils/filter';
import { getEntryShortType, nextSort, sortEntries } from '../utils/columns';
import { formatDuration, hexDump } from '../utils/format';
import type { ProxyEntry } from '../types';

const entry = (overrides: Partial<ProxyEntry> = {}): ProxyEntry => ({
  id: Math.random().toString(16).slice(2),
  method: 'GET',
  status: 200,
  protocol: 'https:',
  host: 'api.example.com',
  path: '/v1/users',
  query: '?page=2',
  requestHeaders: { 'user-agent': 'curl/8' },
  responseHeaders: { 'content-type': 'application/json; charset=utf-8' },
  ...overrides,
});

const matches = (filter: string, candidate: ProxyEntry) => matchesFilter(candidate, parseFilter(filter));

describe('parseFilter', () => {
  it('parses fields, negation and quoted values', () => {
    expect(parseFilter('status:4xx -host:"cdn example" hello')).toEqual([
      { field: 'status', value: '4xx', negate: false },
      { field: 'host', value: 'cdn example', negate: true },
      { field: null, value: 'hello', negate: false },
    ]);
  });

  it('treats unknown prefixes as free text', () => {
    expect(parseFilter('foo:bar')).toEqual([{ field: null, value: 'foo:bar', negate: false }]);
  });

  it('ignores a lone dash and empty input', () => {
    expect(parseFilter('   ')).toEqual([]);
    expect(parseFilter('-')).toEqual([{ field: null, value: '-', negate: false }]);
  });
});

describe('matchesFilter', () => {
  it('matches free text against URL and headers, case-insensitively', () => {
    expect(matches('USERS', entry())).toBe(true);
    expect(matches('curl/8', entry())).toBe(true);
    expect(matches('missing', entry())).toBe(false);
  });

  it('matches method exactly, with WS for websockets', () => {
    expect(matches('method:get', entry())).toBe(true);
    expect(matches('method:POST', entry())).toBe(false);
    expect(matches('method:ws', entry({ kind: 'websocket' }))).toBe(true);
  });

  it('supports status ranges, comparisons and pending', () => {
    expect(matches('status:2xx', entry())).toBe(true);
    expect(matches('status:4xx', entry({ status: 404 }))).toBe(true);
    expect(matches('status:>=400', entry({ status: 399 }))).toBe(false);
    expect(matches('status:<300', entry({ status: 204 }))).toBe(true);
    expect(matches('status:404', entry({ status: 404 }))).toBe(true);
    expect(matches('status:pending', entry({ status: undefined }))).toBe(true);
    expect(matches('status:2xx', entry({ status: undefined }))).toBe(false);
  });

  it('supports host wildcards and substrings', () => {
    expect(matches('host:*.example.com', entry())).toBe(true);
    expect(matches('host:*.example.com', entry({ host: 'example.com' }))).toBe(false);
    expect(matches('host:example', entry())).toBe(true);
    expect(matches('host:api.*', entry({ host: 'api.other.org' }))).toBe(true);
  });

  it('matches path including query, and content type', () => {
    expect(matches('path:page=2', entry())).toBe(true);
    expect(matches('path:/v1/*', entry())).toBe(true);
    expect(matches('type:json', entry())).toBe(true);
    expect(matches('type:html', entry())).toBe(false);
  });

  it('negates terms and requires all terms to match', () => {
    expect(matches('-host:gstatic.com', entry())).toBe(true);
    expect(matches('-host:example.com', entry())).toBe(false);
    expect(matches('method:GET status:5xx', entry())).toBe(false);
    expect(matches('method:GET status:2xx', entry())).toBe(true);
  });

  it('refreshes cached search text when an entry is replaced', () => {
    const original = entry({ responseHeaders: {} });
    expect(matches('etag', original)).toBe(false);
    expect(matches('etag', { ...original, responseHeaders: { etag: 'abc' } })).toBe(true);
  });
});

describe('isStaticAsset', () => {
  it('detects assets by extension or content type', () => {
    expect(isStaticAsset(entry({ path: '/logo.PNG', responseHeaders: {} }))).toBe(true);
    expect(isStaticAsset(entry({ path: '/font', responseHeaders: { 'content-type': 'font/woff2' } }))).toBe(true);
    expect(isStaticAsset(entry({ path: '/app', responseHeaders: { 'content-type': 'text/javascript' } }))).toBe(true);
    expect(isStaticAsset(entry())).toBe(false);
    expect(isStaticAsset(entry({ kind: 'websocket', path: '/socket.js' }))).toBe(false);
  });
});

describe('sorting', () => {
  it('cycles asc -> desc -> off', () => {
    const asc = nextSort(null, 'status');
    expect(asc).toEqual({ key: 'status', direction: 'asc' });
    const desc = nextSort(asc, 'status');
    expect(desc).toEqual({ key: 'status', direction: 'desc' });
    expect(nextSort(desc, 'status')).toBeNull();
    expect(nextSort(desc, 'host')).toEqual({ key: 'host', direction: 'asc' });
  });

  it('sorts stably and keeps empty values last in both directions', () => {
    const a = entry({ id: 'a', status: 500 });
    const b = entry({ id: 'b', status: undefined });
    const c = entry({ id: 'c', status: 200 });
    const d = entry({ id: 'd', status: 200 });
    const ids = (list: ProxyEntry[]) => list.map((item) => item.id);
    expect(ids(sortEntries([a, b, c, d], { key: 'status', direction: 'asc' }))).toEqual(['c', 'd', 'a', 'b']);
    expect(ids(sortEntries([a, b, c, d], { key: 'status', direction: 'desc' }))).toEqual(['a', 'c', 'd', 'b']);
    expect(ids(sortEntries([a, b], null))).toEqual(['a', 'b']);
  });

  it('sorts by size using captured size, then content-length', () => {
    const small = entry({ id: 'small', responseBodySize: 10 });
    const big = entry({ id: 'big', responseBodySize: 0, responseHeaders: { 'content-length': '5000' } });
    expect(sortEntries([big, small], { key: 'size', direction: 'asc' }).map((item) => item.id)).toEqual([
      'small',
      'big',
    ]);
  });
});

describe('getEntryShortType', () => {
  it('shortens common content types', () => {
    expect(getEntryShortType(entry())).toBe('json');
    expect(getEntryShortType(entry({ responseHeaders: { 'content-type': 'application/problem+json' } }))).toBe('json');
    expect(getEntryShortType(entry({ responseHeaders: { 'content-type': 'image/png' } }))).toBe('image');
    expect(getEntryShortType(entry({ responseHeaders: { 'content-type': 'text/plain' } }))).toBe('text');
    expect(getEntryShortType(entry({ responseHeaders: { 'content-type': 'application/x-protobuf' } }))).toBe('protobuf');
    expect(getEntryShortType(entry({ responseHeaders: {} }))).toBe('');
  });
});

describe('formatting', () => {
  it('formats durations', () => {
    expect(formatDuration(42.4)).toBe('42 ms');
    expect(formatDuration(1534)).toBe('1.53 s');
    expect(formatDuration(65000)).toBe('65.0 s');
    expect(formatDuration(null)).toBe('—');
  });

  it('renders a hex dump with offsets and ASCII column', () => {
    const base64 = btoa('Hello, world!\x00\x01\x02ABCD');
    const lines = hexDump(base64).split('\n');
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('00000000  48 65 6c 6c 6f 2c 20 77  6f 72 6c 64 21 00 01 02  |Hello, world!...|');
    expect(lines[1].startsWith('00000010  41 42 43 44')).toBe(true);
    expect(lines[1].endsWith('|ABCD|')).toBe(true);
  });

  it('returns an empty dump for invalid base64', () => {
    expect(hexDump('%%%')).toBe('');
  });
});
