import path from 'path';
import { app } from 'electron';
import { getLocal } from 'mockttp';
import { buildEntry } from './entries';
import { ensureHermesCa } from './ca';
import { broadcastCaReady, broadcastEndpointReady, broadcastEntry, broadcastPortReady } from './broadcast';
import { PROXY_PORT_START } from './constants';
import { applyHeaderOverrides } from './headers';
import { getLocalNetworkIp } from './network';
import { buildRuleShortCircuitResponse, matchRule } from './rules';
import type { ProxyEntry, WebSocketFrame } from './types';
import {
  getProxyInstance,
  getProxySettings,
  getRules,
  setCaCertPath,
  setProxyHost,
  setProxyInstance,
  setProxyPort,
} from './state';

const normalizeHeaders = (headers: any) => {
  if (!headers) return {};
  if (Array.isArray(headers)) {
    return headers.reduce<Record<string, string | string[]>>((acc, header) => {
      const name = String(header?.name || '').trim();
      if (!name) return acc;
      const value = String(header?.value ?? '');
      const existing = acc[name];
      if (existing) {
        acc[name] = Array.isArray(existing) ? [...existing, value] : [String(existing), value];
      } else {
        acc[name] = value;
      }
      return acc;
    }, {});
  }
  if (headers instanceof Map) {
    const result: Record<string, string | string[]> = {};
    headers.forEach((value, key) => {
      result[String(key)] = Array.isArray(value) ? value.map(String) : String(value ?? '');
    });
    return result;
  }
  if (typeof headers === 'object') return headers as Record<string, string | string[]>;
  return {};
};

const toEpochMs = (value: unknown) => {
  if (typeof value === 'number') return value;
  if (value instanceof Date) return value.getTime();
  return null;
};

const toEventEpochMs = (timingEvents: any, key: string) => {
  const eventValue = timingEvents?.[key];
  if (typeof eventValue !== 'number') return null;

  return toMonotonicEpochMs(timingEvents, eventValue);
};

const toMonotonicEpochMs = (timingEvents: any, eventValue: unknown) => {
  if (typeof eventValue !== 'number') return null;

  const startTime = toEpochMs(timingEvents?.startTime);
  const startTimestamp = typeof timingEvents?.startTimestamp === 'number' ? timingEvents.startTimestamp : null;

  if (typeof startTime === 'number' && typeof startTimestamp === 'number') {
    return Math.round(startTime + (eventValue - startTimestamp));
  }

  return Math.round(eventValue);
};

const firstHeaderValue = (value: unknown) => {
  if (Array.isArray(value)) return value[0] ? String(value[0]) : '';
  if (typeof value === 'undefined' || value === null) return '';
  return String(value);
};

const toAbsoluteRequestUrl = (request: any, headers: Record<string, unknown>) => {
  const rawUrl = String(request?.url || '').trim();
  if (rawUrl.startsWith('http://') || rawUrl.startsWith('https://')) {
    return rawUrl;
  }

  const protocolRaw = String(request?.protocol || '').replace(':', '').toLowerCase();
  const protocol = protocolRaw === 'https' ? 'https' : 'http';
  const hostHeader = firstHeaderValue(headers[':authority']) || firstHeaderValue(headers.host);

  if (hostHeader && rawUrl.startsWith('/')) {
    return `${protocol}://${hostHeader}${rawUrl}`;
  }

  return rawUrl;
};

const toWebSocketTargetUrl = (request: any, headers: Record<string, unknown>) => {
  const absoluteUrl = toAbsoluteRequestUrl(request, headers);
  if (!absoluteUrl) return null;

  try {
    const target = new URL(absoluteUrl);
    if (target.protocol === 'https:') {
      target.protocol = 'wss:';
    } else if (target.protocol === 'http:') {
      target.protocol = 'ws:';
    }
    return target;
  } catch (err) {
    return null;
  }
};

const buildWebSocketFrame = (message: any): WebSocketFrame => {
  const contentBuffer = Buffer.from(message?.content ?? []);
  const isBinary = Boolean(message?.isBinary);

  return {
    id: `${String(message?.streamId ?? 'ws')}-${String(message?.direction ?? 'sent')}-${Math.round(message?.eventTimestamp ?? Date.now())}-${Math.random().toString(16).slice(2)}`,
    direction: message?.direction === 'received' ? 'received' : 'sent',
    content: isBinary ? contentBuffer.toString('base64') : contentBuffer.toString('utf8'),
    encoding: isBinary ? 'base64' : 'utf8',
    isBinary,
    size: contentBuffer.length,
    timestamp: toMonotonicEpochMs(message?.timingEvents, message?.eventTimestamp),
  };
};

const computeDurationMs = (startAt: number | null | undefined, endAt: number | null | undefined) => {
  if (typeof startAt !== 'number' || typeof endAt !== 'number') return null;
  return Math.max(0, endAt - startAt);
};

const getWebSocketTargetFromEntry = (entry: ProxyEntry) => {
  if (entry.url) {
    try {
      return new URL(entry.url);
    } catch (err) {
      // Fall through to reconstruct from structured fields below.
    }
  }

  return new URL(`${entry.protocol || 'ws:'}//${entry.host}${entry.path}${entry.query || ''}`);
};

const createWebSocketEntry = ({
  entryId,
  target,
  request,
  status,
  responseHeaders,
  responseHttpVersion,
  requestStartAt,
  requestEndAt,
  responseStartAt,
  responseEndAt,
  state,
  messages,
  closeCode,
  closeReason,
}: {
  entryId: string;
  target: URL;
  request: {
    method?: string;
    headers?: ProxyEntry['requestHeaders'];
    httpVersion?: string;
  };
  status?: number | null;
  responseHeaders?: ProxyEntry['responseHeaders'];
  responseHttpVersion?: string | null;
  requestStartAt?: number | null;
  requestEndAt?: number | null;
  responseStartAt?: number | null;
  responseEndAt?: number | null;
  state: 'connecting' | 'open' | 'closed';
  messages?: WebSocketFrame[];
  closeCode?: number | null;
  closeReason?: string | null;
}): ProxyEntry => {
  const lastMessageAt = messages?.length ? messages[messages.length - 1]?.timestamp ?? null : null;
  const latestAt = responseEndAt ?? lastMessageAt ?? responseStartAt ?? requestEndAt ?? requestStartAt ?? null;
  const durationMs = computeDurationMs(requestStartAt, latestAt);
  const receiveEndAt = responseEndAt ?? lastMessageAt ?? responseStartAt ?? null;
  const base = buildEntry({
    target,
    request,
    status,
    responseHeaders,
    requestBody: Buffer.alloc(0),
    responseBody: Buffer.alloc(0),
    responseHttpVersion,
    durationMs,
    requestStartAt,
    requestEndAt,
    responseStartAt,
    responseEndAt: receiveEndAt,
  });

  return {
    ...base,
    id: entryId,
    kind: 'websocket',
    webSocketState: state,
    webSocketStreamId: entryId,
    webSocketMessages: messages ?? [],
    webSocketMessageCount: messages?.length ?? 0,
    webSocketCloseCode: closeCode ?? null,
    webSocketCloseReason: closeReason ?? null,
    responseEndAt: receiveEndAt,
    timingReceiveMs: computeDurationMs(responseStartAt, receiveEndAt),
  };
};

const applyGlobalMockttpBodyLimit = (limitBytes: number) => {
  const boundedLimitBytes = Math.max(1, Math.floor(limitBytes));
  const bufferUtils = require('mockttp/dist/util/buffer-utils') as {
    streamToBuffer: (input: unknown, maxSize?: number) => unknown;
    __hermesOriginalStreamToBuffer?: (input: unknown, maxSize?: number) => unknown;
    __hermesBodyLimitBytes?: number;
  };

  if (!bufferUtils.__hermesOriginalStreamToBuffer) {
    bufferUtils.__hermesOriginalStreamToBuffer = bufferUtils.streamToBuffer;
    bufferUtils.streamToBuffer = (input: unknown, maxSize?: number) => {
      const configuredLimit =
        typeof bufferUtils.__hermesBodyLimitBytes === 'number' ? bufferUtils.__hermesBodyLimitBytes : boundedLimitBytes;
      const requestedLimit = typeof maxSize === 'number' && Number.isFinite(maxSize) ? maxSize : configuredLimit;
      const effectiveLimit = Math.max(1, Math.min(requestedLimit, configuredLimit));
      return bufferUtils.__hermesOriginalStreamToBuffer!(input, effectiveLimit);
    };
  }

  bufferUtils.__hermesBodyLimitBytes = boundedLimitBytes;
};

export const startMitmProxy = async () => {
  const caDir = path.join(app.getPath('userData'), 'mitm-ca');
  await ensureHermesCa(caDir);
  const certPath = path.join(caDir, 'certs', 'ca.pem');
  const keyPath = path.join(caDir, 'keys', 'ca.private.key');
  const proxySettings = getProxySettings();
  const maxCaptureBodySizeMb = Math.max(1, Math.round(proxySettings.maxCaptureBodySizeMb || 5));
  const maxCaptureBodySizeBytes = maxCaptureBodySizeMb * 1024 * 1024;
  applyGlobalMockttpBodyLimit(maxCaptureBodySizeBytes);
  const proxy: any = getLocal({
    http2: 'fallback',
    https: {
      certPath,
      keyPath,
    },
    maxBodySize: maxCaptureBodySizeBytes,
  });
  const listenHost = proxySettings.listenOnAllInterfaces ? '0.0.0.0' : '127.0.0.1';

  const pendingRequests = new Map<
    string,
    {
      request: any;
      requestBody: Buffer;
      requestHeadersOverride?: Array<{ name: string; value: string }> | null;
      requestStartAt: number | null;
      requestEndAt: number | null;
    }
  >();
  const webSocketEntries = new Map<string, ProxyEntry>();

  await proxy.forAnyRequest().thenPassThrough({
    beforeRequest: async (req: any) => {
      const requestHeaders = normalizeHeaders(req.headers);
      const requestUrl = toAbsoluteRequestUrl(req, requestHeaders);
      const requestInfo = {
        method: req.method || '',
        host: (() => {
          try {
            return new URL(requestUrl || '').host || '';
          } catch (err) {
            return firstHeaderValue(requestHeaders[':authority']) || firstHeaderValue(requestHeaders.host) || '';
          }
        })(),
        url: requestUrl || req.url || '',
        headers: requestHeaders,
      };
      const activeRule = getRules().find((rule) => matchRule(rule, requestInfo));
      if (!activeRule) return undefined;
      if (activeRule.actions.type === 'delay' && activeRule.actions.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, activeRule.actions.delayMs));
      }
      if (activeRule.actions.type === 'overrideHeaders' && activeRule.actions.overrideHeaders.length) {
        req._overrideHeaders = activeRule.actions.overrideHeaders;
        const nextHeaders = applyHeaderOverrides(requestHeaders, activeRule.actions.overrideHeaders);
        return { headers: nextHeaders };
      }
      const shortCircuitResponse = buildRuleShortCircuitResponse(activeRule);
      if (shortCircuitResponse) return shortCircuitResponse;
      return undefined;
    },
  });
  await proxy.forAnyWebSocket().thenPassThrough();

  await proxy.on('request', async (req: any) => {
    const requestBody = req.body?.buffer ?? Buffer.alloc(0);
    const timingEvents = req.timingEvents || {};
    const requestStartAt =
      toEventEpochMs(timingEvents, 'startTimestamp') ??
      toEpochMs(timingEvents.startTime) ??
      Date.now();
    const requestEndAt =
      toEventEpochMs(timingEvents, 'bodyReceivedTimestamp') ??
      requestStartAt;
    pendingRequests.set(String(req.id ?? req.requestId ?? `${Date.now()}-${Math.random()}`), {
      request: req,
      requestBody,
      requestHeadersOverride: req._overrideHeaders ?? null,
      requestStartAt,
      requestEndAt,
    });
  });

  await proxy.on('websocket-request', async (req: any) => {
    const requestHeaders = normalizeHeaders(req.headers);
    const target = toWebSocketTargetUrl(req, requestHeaders);
    if (!target) return;

    const timingEvents = req.timingEvents || {};
    const requestStartAt =
      toEventEpochMs(timingEvents, 'startTimestamp') ??
      toEpochMs(timingEvents.startTime) ??
      Date.now();
    const requestEndAt =
      toEventEpochMs(timingEvents, 'bodyReceivedTimestamp') ??
      requestStartAt;
    const entryId = String(req.id ?? req.requestId ?? `${Date.now()}-${Math.random()}`);
    const entry = createWebSocketEntry({
      entryId,
      target,
      request: {
        method: req.method || 'GET',
        headers: requestHeaders,
        httpVersion: req.httpVersion,
      },
      status: null,
      responseHeaders: {},
      responseHttpVersion: null,
      requestStartAt,
      requestEndAt,
      responseStartAt: null,
      responseEndAt: null,
      state: 'connecting',
      messages: [],
      closeCode: null,
      closeReason: null,
    });

    webSocketEntries.set(entryId, entry);
    broadcastEntry(entry);
  });

  await proxy.on('websocket-accepted', async (res: any) => {
    const entryId = String(res.id ?? res.requestId ?? '');
    const currentEntry = entryId ? webSocketEntries.get(entryId) : null;
    if (!currentEntry) return;

    const responseHeaders = normalizeHeaders(res.headers);
    const timingEvents = res.timingEvents || {};
    const responseStartAt =
      toEventEpochMs(timingEvents, 'wsAcceptedTimestamp') ??
      toEventEpochMs(timingEvents, 'headersSentTimestamp') ??
      currentEntry.requestEndAt ??
      currentEntry.requestStartAt ??
      Date.now();
    const nextEntry = createWebSocketEntry({
      entryId,
      target: getWebSocketTargetFromEntry(currentEntry),
      request: {
        method: currentEntry.method || 'GET',
        headers: currentEntry.requestHeaders,
        httpVersion: currentEntry.requestHttpVersion,
      },
      status: typeof res.statusCode === 'number' ? res.statusCode : 101,
      responseHeaders,
      responseHttpVersion: currentEntry.responseHttpVersion ?? null,
      requestStartAt: currentEntry.requestStartAt,
      requestEndAt: currentEntry.requestEndAt,
      responseStartAt,
      responseEndAt: currentEntry.responseEndAt ?? null,
      state: currentEntry.webSocketState === 'closed' ? 'closed' : 'open',
      messages: currentEntry.webSocketMessages ?? [],
      closeCode: currentEntry.webSocketCloseCode ?? null,
      closeReason: currentEntry.webSocketCloseReason ?? null,
    });

    webSocketEntries.set(entryId, nextEntry);
    broadcastEntry(nextEntry);
  });

  const updateWebSocketMessages = (message: any) => {
    const streamId = String(message?.streamId ?? '');
    const currentEntry = streamId ? webSocketEntries.get(streamId) : null;
    if (!currentEntry) return;

    const frame = buildWebSocketFrame(message);
    const nextMessages = [...(currentEntry.webSocketMessages ?? []), frame];
    const nextEntry: ProxyEntry = {
      ...currentEntry,
      webSocketMessages: nextMessages,
      webSocketMessageCount: nextMessages.length,
      responseEndAt: frame.timestamp ?? currentEntry.responseEndAt ?? null,
      durationMs: computeDurationMs(currentEntry.requestStartAt, frame.timestamp ?? currentEntry.responseEndAt),
      timingReceiveMs: computeDurationMs(currentEntry.responseStartAt, frame.timestamp ?? currentEntry.responseEndAt),
    };

    webSocketEntries.set(streamId, nextEntry);
    broadcastEntry(nextEntry);
  };

  await proxy.on('websocket-message-received', async (message: any) => {
    updateWebSocketMessages(message);
  });

  await proxy.on('websocket-message-sent', async (message: any) => {
    updateWebSocketMessages(message);
  });

  await proxy.on('websocket-close', async (close: any) => {
    const streamId = String(close?.streamId ?? '');
    const currentEntry = streamId ? webSocketEntries.get(streamId) : null;
    if (!currentEntry) return;

    const closedAt =
      toEventEpochMs(close?.timingEvents, 'wsClosedTimestamp') ??
      currentEntry.responseEndAt ??
      Date.now();
    const nextEntry: ProxyEntry = {
      ...currentEntry,
      webSocketState: 'closed',
      webSocketCloseCode:
        typeof close?.closeCode === 'number' ? close.closeCode : currentEntry.webSocketCloseCode ?? null,
      webSocketCloseReason:
        typeof close?.closeReason === 'string' ? close.closeReason : currentEntry.webSocketCloseReason ?? null,
      responseEndAt: closedAt,
      durationMs: computeDurationMs(currentEntry.requestStartAt, closedAt),
      timingReceiveMs: computeDurationMs(currentEntry.responseStartAt, closedAt),
    };

    webSocketEntries.set(streamId, nextEntry);
    broadcastEntry(nextEntry);
  });

  await proxy.on('response', async (res: any) => {
    const requestId = String(res.id ?? res.requestId ?? '');
    const pending = pendingRequests.get(requestId);
    if (requestId) {
      pendingRequests.delete(requestId);
    }
    const request = pending?.request;
    const requestBody = pending?.requestBody ?? request?.body?.buffer ?? Buffer.alloc(0);
    const requestHeaders = normalizeHeaders(request?.headers);
    const responseHeaders = normalizeHeaders(res.headers);
    const responseBody = res.body?.buffer ?? Buffer.alloc(0);
    const timingEvents = res.timingEvents || {};
    const requestStartAt =
      pending?.requestStartAt ??
      toEventEpochMs(timingEvents, 'startTimestamp') ??
      toEpochMs(timingEvents.startTime) ??
      (request ? Date.now() : null);
    const requestEndAt =
      pending?.requestEndAt ??
      toEventEpochMs(timingEvents, 'bodyReceivedTimestamp') ??
      requestStartAt;
    const responseStartAt =
      toEventEpochMs(timingEvents, 'headersSentTimestamp') ??
      toEventEpochMs(timingEvents, 'bodyReceivedTimestamp') ??
      requestEndAt;
    const responseEndAt =
      toEventEpochMs(timingEvents, 'responseSentTimestamp') ??
      toEventEpochMs(timingEvents, 'bodyReceivedTimestamp') ??
      responseStartAt;

    try {
      const urlValue = toAbsoluteRequestUrl(request, requestHeaders);
      if (!urlValue) return;
      const target = new URL(urlValue);
      const durationMs =
        typeof responseEndAt === 'number' && typeof requestStartAt === 'number'
          ? Math.max(0, responseEndAt - requestStartAt)
          : null;
      broadcastEntry(
        buildEntry({
          target,
          request: {
            method: request?.method || '',
            headers: requestHeaders,
            httpVersion: request?.httpVersion,
          },
          requestHeadersOverride: pending?.requestHeadersOverride ?? null,
          status: res.statusCode,
          responseHeaders,
          requestBody,
          responseBody,
          responseHttpVersion: res.httpVersion,
          durationMs,
          requestStartAt,
          requestEndAt,
          responseStartAt,
          responseEndAt,
        })
      );
    } catch (err) {
      console.error('Failed to record proxy response', err);
    }
  });

  const listenOnPort = (port: number) =>
    new Promise<void>((resolve, reject) => {
      const done = async () => {
        try {
          await proxy.start(port, listenHost);
          resolve();
        } catch (err: any) {
          reject(err);
        }
      };
      void done();
    });

  let port = PROXY_PORT_START;
  while (true) {
    try {
      await listenOnPort(port);
      break;
    } catch (err: any) {
      if (err?.code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }

  setProxyPort(port);
  const displayHost = listenHost === '0.0.0.0' ? getLocalNetworkIp() || 'localhost' : 'localhost';
  setProxyHost(displayHost);
  setProxyInstance(proxy);
  setCaCertPath(certPath);
  console.log(`Hermes Proxy MITM listening on http://${listenHost}:${port}`);
  console.log(`Hermes Proxy endpoint for clients: http://${displayHost}:${port}`);
  console.log(`Root CA generated at: ${certPath}`);
  broadcastCaReady();
  broadcastPortReady();
  broadcastEndpointReady();
};

export const stopMitmProxy = async () => {
  const proxyInstance = getProxyInstance();
  const stopProxy = proxyInstance?.stop;
  if (!stopProxy) {
    setProxyInstance(null);
    return;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      resolve();
    };

    try {
      Promise.resolve(stopProxy())
        .then(() => done())
        .catch((err) => {
          console.error('Failed to stop proxy', err);
          done();
        });
    } catch (err) {
      console.error('Failed to stop MITM proxy', err);
      done();
    }
  });

  setProxyInstance(null);
};

export const restartMitmProxy = async () => {
  await stopMitmProxy();
  await startMitmProxy();
};
