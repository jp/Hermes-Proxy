import http from 'http';
import https from 'https';
import type { OutgoingHttpHeaders, RequestOptions } from 'http';
import { buildEntry } from './entries';
import type { ProxyEntry, RepeatRequestOverrides } from './types';
import { broadcastEntry } from './broadcast';
import { buildReplayHeaders, sanitizeHeaders } from './headers';
import { buildEntryUrl } from './entries';
import { isTimeoutError } from './utils';

const resolveReplayUrl = (entry: ProxyEntry, overrideUrl?: string) => {
  const candidate = overrideUrl?.trim();
  if (!candidate) {
    return new URL(buildEntryUrl(entry));
  }
  try {
    return new URL(candidate);
  } catch (err) {
    if (!candidate.includes('://')) {
      const protocol = entry.protocol || 'http:';
      return new URL(`${protocol}//${candidate}`);
    }
    throw err;
  }
};

export const repeatEntryRequest = (entry: ProxyEntry, overrides: RepeatRequestOverrides = {}) =>
  new Promise<boolean>((resolve, reject) => {
    const url = resolveReplayUrl(entry, overrides.url);
    const isHttps = url.protocol === 'https:';
    const transport = isHttps ? https : http;
    const method = overrides.method || entry.method || 'GET';
    const hasBodyOverride = typeof overrides.body === 'string';
    const hasDecodedBody = hasBodyOverride ? true : Boolean(entry.requestDecodedBody);
    const requestBodyText = hasBodyOverride
      ? overrides.body
      : hasDecodedBody
        ? entry.requestDecodedBody
        : entry.requestBody;
    const requestBodyBuffer = requestBodyText ? Buffer.from(requestBodyText) : Buffer.alloc(0);
    const replayHeaders = buildReplayHeaders(entry.requestHeaders || {}, overrides.headers);
    const headers = sanitizeHeaders(replayHeaders, { stripContentEncoding: hasDecodedBody }) as OutgoingHttpHeaders;
    if (typeof requestBodyText === 'string') {
      headers['content-length'] = String(requestBodyBuffer.length);
    }
    const options: RequestOptions = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
    };
    const startedAt = Date.now();
    const req = transport.request(options, (res) => {
      const responseChunks: Buffer[] = [];
      res.on('data', (chunk) => responseChunks.push(chunk));
      res.on('end', () => {
        const responseBody = Buffer.concat(responseChunks);
        broadcastEntry(
          buildEntry({
            target: url,
            request: {
              method,
              headers: replayHeaders,
              httpVersion: entry.requestHttpVersion?.replace('HTTP/', '') || '1.1',
            },
            status: res.statusCode,
            responseHeaders: res.headers,
            requestBody: requestBodyBuffer,
            responseBody,
            responseHttpVersion: res.httpVersion,
            durationMs: Date.now() - startedAt,
          })
        );
        resolve(true);
      });
    });
    req.on('error', (err) => {
      broadcastEntry(
        buildEntry({
          target: url,
          request: {
            method,
            headers: replayHeaders,
            httpVersion: entry.requestHttpVersion?.replace('HTTP/', '') || '1.1',
          },
          status: isTimeoutError(err) ? 499 : 500,
          responseHeaders: {},
          requestBody: requestBodyBuffer,
          responseBody: Buffer.alloc(0),
          responseHttpVersion: null,
          durationMs: Date.now() - startedAt,
          error: err,
        })
      );
      reject(err);
    });
    if (requestBodyBuffer.length) {
      req.write(requestBodyBuffer);
    }
    req.end();
  });
