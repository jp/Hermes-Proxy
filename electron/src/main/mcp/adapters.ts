import type { ProxyEntry } from '../types';
import type { RequestDetails, RequestSummary } from './types';

export const proxyEntryFromDetails = (details: RequestDetails): ProxyEntry => {
  const request = details.request;
  const response = details.response;
  const timing = details.timing;
  return {
    id: request.id,
    timestamp: request.timestamp,
    method: request.method,
    status: response?.status ?? null,
    protocol: request.scheme ? `${request.scheme}:` : undefined,
    host: request.port ? `${request.host}:${request.port}` : request.host,
    path: request.path,
    query: request.query,
    requestHeaders: request.headers,
    responseHeaders: response?.headers || {},
    requestBody: request.body ?? undefined,
    responseBody: response?.body ?? undefined,
    requestBodySize: request.size,
    responseBodySize: response?.size ?? 0,
    requestDecodedBody: null,
    responseDecodedBody: null,
    requestDecodedSize: null,
    responseDecodedSize: null,
    durationMs: timing?.duration ?? null,
    error: null,
    requestEncoding: null,
    responseEncoding: null,
  };
};

export const proxyEntryFromSummary = (summary: RequestSummary): ProxyEntry => ({
  id: summary.id,
  timestamp: summary.timestamp,
  method: summary.method,
  status: summary.status,
  protocol: summary.scheme ? `${summary.scheme}:` : undefined,
  host: summary.port ? `${summary.host}:${summary.port}` : summary.host,
  path: summary.path,
  query: summary.query,
  requestHeaders: {},
  responseHeaders: {},
  requestBody: undefined,
  responseBody: undefined,
  requestBodySize: summary.requestSize,
  responseBodySize: summary.responseSize ?? 0,
  requestDecodedBody: null,
  responseDecodedBody: null,
  requestDecodedSize: null,
  responseDecodedSize: null,
  durationMs: summary.durationMs ?? null,
  error: null,
  requestEncoding: null,
  responseEncoding: null,
});
