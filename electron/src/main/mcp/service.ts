import type { ProxyEntry } from '../types';
import { buildEntryUrl } from '../entries';
import { getHeaderValue } from '../http';
import { assertAnnotation, assertRequestEvent, assertResponseEvent, assertTimingEvent } from './schema';
import { redactBodyByContentType, redactHeaders } from './redaction';
import { HermesMcpStore, buildTimingFromTimestamp, ensureIsoTimestamp, timestampMsFromIso } from './store';
import { proxyEntryFromDetails } from './adapters';
import type {
  AggregationGroupBy,
  AggregationResult,
  Annotation,
  RequestDetails,
  RequestEvent,
  RequestListFilter,
  RequestSummary,
  ResponseEvent,
  TimingEvent,
} from './types';

const defaultPortForScheme = (scheme: string) => (scheme === 'https' ? 443 : 80);

const parseUrlParts = (entry: ProxyEntry) => {
  try {
    const url = new URL(buildEntryUrl(entry));
    const scheme = url.protocol.replace(':', '') || 'http';
    const port = url.port ? Number(url.port) : defaultPortForScheme(scheme);
    return {
      scheme,
      host: url.hostname || entry.host,
      port: Number.isFinite(port) ? port : null,
      path: url.pathname || entry.path,
      query: url.search || entry.query || '',
    };
  } catch (_err) {
    const rawScheme = entry.protocol?.replace(':', '') || 'http';
    return {
      scheme: rawScheme,
      host: entry.host,
      port: null,
      path: entry.path,
      query: entry.query || '',
    };
  }
};

const toRequestEvent = (entry: ProxyEntry): RequestEvent => {
  const timestamp = ensureIsoTimestamp(entry.timestamp || new Date().toISOString());
  const urlParts = parseUrlParts(entry);
  return {
    id: entry.id,
    timestamp,
    scheme: urlParts.scheme,
    host: urlParts.host,
    port: urlParts.port,
    method: entry.method || 'GET',
    path: urlParts.path,
    query: urlParts.query,
    headers: entry.requestHeaders || {},
    body: entry.requestBody ?? null,
    size: typeof entry.requestBodySize === 'number' ? entry.requestBodySize : Buffer.byteLength(entry.requestBody || ''),
  };
};

const toResponseEvent = (entry: ProxyEntry): ResponseEvent => {
  const timestamp = ensureIsoTimestamp(entry.timestamp || new Date().toISOString());
  return {
    request_id: entry.id,
    timestamp,
    status: typeof entry.status === 'number' ? entry.status : null,
    headers: entry.responseHeaders || {},
    body: entry.responseBody ?? null,
    size: typeof entry.responseBodySize === 'number' ? entry.responseBodySize : Buffer.byteLength(entry.responseBody || ''),
  };
};

const toTimingEvent = (entry: ProxyEntry): TimingEvent | null => {
  const timestamp = ensureIsoTimestamp(entry.timestamp || new Date().toISOString());
  const timestampMs = timestampMsFromIso(timestamp);
  if (typeof entry.durationMs !== 'number') return null;
  const { start, end, duration } = buildTimingFromTimestamp(timestampMs, entry.durationMs);
  return {
    request_id: entry.id,
    start,
    end,
    duration,
  };
};

export class HermesMcpService {
  constructor(private store: HermesMcpStore) {}

  ingestProxyEntry(entry: ProxyEntry) {
    const requestEvent = toRequestEvent(entry);
    const responseEvent = toResponseEvent(entry);
    const timingEvent = toTimingEvent(entry);

    const redactedRequest: RequestEvent = {
      ...requestEvent,
      headers: redactHeaders(requestEvent.headers),
      body: redactBodyByContentType(requestEvent.body || null, getHeaderValue(requestEvent.headers, 'content-type')),
    };

    const redactedResponse: ResponseEvent = {
      ...responseEvent,
      headers: redactHeaders(responseEvent.headers),
      body: redactBodyByContentType(responseEvent.body || null, getHeaderValue(responseEvent.headers, 'content-type')),
    };

    assertRequestEvent(redactedRequest);
    assertResponseEvent(redactedResponse);
    if (timingEvent) assertTimingEvent(timingEvent);

    this.store.insertRequest(redactedRequest);
    this.store.insertResponse(redactedResponse);
    if (timingEvent) this.store.insertTiming(timingEvent);
  }

  listRequests(filter?: RequestListFilter): RequestSummary[] {
    return this.store.listRequests(filter);
  }

  listProxyEntries(filter?: RequestListFilter): ProxyEntry[] {
    const summaries = this.store.listRequests(filter);
    return summaries
      .map((summary) => this.store.getRequestDetails(summary.id))
      .filter((details): details is RequestDetails => !!details)
      .map((details) => proxyEntryFromDetails(details));
  }

  getRequestDetails(requestId: string): RequestDetails | null {
    return this.store.getRequestDetails(requestId);
  }

  aggregateRequests(groupBy: AggregationGroupBy, filter?: RequestListFilter): AggregationResult[] {
    return this.store.aggregate(groupBy, filter);
  }

  addAnnotation(annotation: Annotation) {
    assertAnnotation(annotation);
    this.store.addAnnotation(annotation);
  }

  listAnnotations(requestId: string): Annotation[] {
    return this.store.listAnnotations(requestId);
  }

  clearAll() {
    this.store.clearAll();
  }

  close() {
    this.store.close();
  }
}
