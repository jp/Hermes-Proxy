import type { HeaderMap, ProxyEntry } from './types';
import {
  bodyToText,
  decodeBody,
  decodeHarBody,
  getHeaderValue,
  headersListToObject,
  normalizeHarHttpVersion,
  normalizeHeaderValue,
  normalizeHttpVersion,
} from './http';
import { applyHeaderOverrides } from './headers';

export const buildEntryUrl = (entry: ProxyEntry) => {
  const protocol = entry.protocol?.replace(':', '') || 'http';
  return `${protocol}://${entry.host}${entry.path}${entry.query || ''}`;
};

export const buildEntryFromHar = (harEntry: any): ProxyEntry => {
  const request = harEntry?.request || {};
  const response = harEntry?.response || {};
  const url = new URL(request.url || 'http://unknown');
  const requestHeaders = headersListToObject(request.headers || []);
  const responseHeaders = headersListToObject(response.headers || []);
  const requestBodyBuffer = request.postData?.text ? Buffer.from(request.postData.text, 'utf8') : Buffer.alloc(0);
  const responseBodyBuffer = decodeHarBody(response.content || {});
  const requestEncoding = getHeaderValue(requestHeaders, 'content-encoding') || null;
  const responseEncoding = getHeaderValue(responseHeaders, 'content-encoding') || null;
  const decodedRequest = decodeBody(requestBodyBuffer, requestEncoding);
  const decodedResponse = decodeBody(responseBodyBuffer, responseEncoding);

  return {
    id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    timestamp: harEntry.startedDateTime || new Date().toISOString(),
    method: request.method || 'GET',
    requestHttpVersion: normalizeHarHttpVersion(request.httpVersion),
    responseHttpVersion: normalizeHarHttpVersion(response.httpVersion),
    status: typeof response.status === 'number' ? response.status : null,
    protocol: url.protocol || 'http:',
    host: url.host || url.hostname,
    path: url.pathname,
    query: url.search,
    requestHeaders,
    responseHeaders,
    requestBody: bodyToText(requestBodyBuffer),
    requestDecodedBody: decodedRequest ? bodyToText(decodedRequest) : null,
    responseBody: bodyToText(responseBodyBuffer),
    responseDecodedBody: decodedResponse ? bodyToText(decodedResponse) : null,
    requestBodySize: requestBodyBuffer.length || 0,
    responseBodySize: responseBodyBuffer.length || 0,
    requestEncoding,
    responseEncoding,
    requestDecodedSize: decodedRequest?.length ?? null,
    responseDecodedSize: decodedResponse?.length ?? null,
    durationMs: typeof harEntry.time === 'number' ? harEntry.time : null,
    error: null,
  };
};

type BuildEntryInput = {
  target: URL;
  request: {
    method?: string;
    headers?: HeaderMap;
    httpVersion?: string;
    httpVersionMajor?: number;
    httpVersionMinor?: number;
  };
  status?: number | null;
  responseHeaders?: HeaderMap;
  requestBody?: Buffer;
  responseBody?: Buffer;
  error?: unknown;
  responseHttpVersion?: string | null;
  durationMs?: number | null;
  requestHeadersOverride?: Array<{ name: string; value: string }> | null;
};

export const buildEntry = ({
  target,
  request,
  status,
  responseHeaders,
  requestBody,
  responseBody,
  error,
  responseHttpVersion,
  durationMs,
  requestHeadersOverride,
}: BuildEntryInput): ProxyEntry => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  timestamp: new Date().toISOString(),
  method: request.method || 'GET',
  requestHttpVersion: normalizeHttpVersion(request.httpVersion, request.httpVersionMajor, request.httpVersionMinor),
  responseHttpVersion: normalizeHttpVersion(responseHttpVersion || undefined, undefined, undefined),
  status: (error as { code?: string })?.code === 'ENOTFOUND' ? null : status ?? null,
  protocol: target.protocol || 'http:',
  host: target.host || target.hostname,
  path: target.pathname,
  query: target.search,
  requestHeaders:
    requestHeadersOverride && requestHeadersOverride.length > 0
      ? applyHeaderOverrides(request.headers || {}, requestHeadersOverride)
      : request.headers || {},
  responseHeaders: responseHeaders || {},
  requestBody: bodyToText(requestBody),
  requestDecodedBody: (() => {
    const decoded = decodeBody(requestBody, getHeaderValue(request.headers || {}, 'content-encoding'));
    return decoded ? bodyToText(decoded) : null;
  })(),
  responseBody: bodyToText(responseBody),
  responseDecodedBody: (() => {
    const decoded = decodeBody(responseBody, getHeaderValue(responseHeaders || {}, 'content-encoding'));
    return decoded ? bodyToText(decoded) : null;
  })(),
  requestBodySize: requestBody?.length || 0,
  responseBodySize: responseBody?.length || 0,
  requestEncoding: getHeaderValue(request.headers || {}, 'content-encoding') || null,
  responseEncoding: getHeaderValue(responseHeaders || {}, 'content-encoding') || null,
  requestDecodedSize: decodeBody(requestBody, getHeaderValue(request.headers || {}, 'content-encoding'))?.length ?? null,
  responseDecodedSize: decodeBody(responseBody, getHeaderValue(responseHeaders || {}, 'content-encoding'))?.length ?? null,
  durationMs: typeof durationMs === 'number' ? durationMs : null,
  error: error ? String((error as { message?: string }).message || error) : null,
});

export const buildHarEntry = (entry: ProxyEntry) => ({
  startedDateTime: entry.timestamp,
  time: entry.durationMs ?? 0,
  request: {
    method: entry.method,
    url: buildEntryUrl(entry),
    httpVersion: entry.requestHttpVersion || 'HTTP/1.1',
    cookies: [],
    headers: Object.entries(entry.requestHeaders || {}).map(([name, value]) => ({
      name,
      value: normalizeHeaderValue(value),
    })),
    queryString: [],
    headersSize: -1,
    bodySize: entry.requestBody ? Buffer.byteLength(entry.requestBody) : 0,
    postData: entry.requestBody
      ? { mimeType: (entry.requestHeaders as HeaderMap)?.['content-type'] || '', text: entry.requestBody }
      : undefined,
  },
  response: {
    status: entry.status || 0,
    statusText: '',
    httpVersion: entry.responseHttpVersion || 'HTTP/1.1',
    cookies: [],
    headers: Object.entries(entry.responseHeaders || {}).map(([name, value]) => ({
      name,
      value: normalizeHeaderValue(value),
    })),
    content: {
      size: entry.responseBody ? Buffer.byteLength(entry.responseBody) : 0,
      text: entry.responseBody || '',
      mimeType: (entry.responseHeaders as HeaderMap)?.['content-type'] || '',
    },
    redirectURL: '',
    headersSize: -1,
    bodySize: entry.responseBody ? Buffer.byteLength(entry.responseBody) : 0,
  },
  cache: {},
  timings: { send: 0, wait: 0, receive: 0 },
});
