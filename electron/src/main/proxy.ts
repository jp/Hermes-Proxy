import path from 'path';
import { app } from 'electron';
import { Proxy as MitmProxy } from 'http-mitm-proxy';
import { buildEntry } from './entries';
import { ensureHermesCa } from './ca';
import { broadcastCaReady, broadcastEntry, broadcastPortReady } from './broadcast';
import { PROXY_PORT_START } from './constants';
import { applyHeaderOverrides } from './headers';
import { buildRuleRequestInfo, matchRule } from './rules';
import { getRules, setCaCertPath, setProxyInstance, setProxyPort } from './state';
import { isTimeoutError } from './utils';

const toTargetUrl = (ctx: any) => {
  const host = ctx.clientToProxyRequest.headers.host || 'unknown';
  const protocol = ctx.isSSL ? 'https:' : 'http:';
  const rawUrl = ctx.clientToProxyRequest.url.startsWith('http')
    ? ctx.clientToProxyRequest.url
    : `${protocol}//${host}${ctx.clientToProxyRequest.url}`;
  return new URL(rawUrl);
};

export const startMitmProxy = async () => {
  const caDir = path.join(app.getPath('userData'), 'mitm-ca');
  await ensureHermesCa(caDir);
  const proxy = new MitmProxy();

  proxy.onError((ctx: any, err: unknown, kind: string) => {
    console.error('Proxy error', kind, err);
    if (ctx) {
      const target = toTargetUrl(ctx);
      broadcastEntry(
        buildEntry({
          target,
          request: ctx.clientToProxyRequest,
          status: isTimeoutError(err) ? 499 : 500,
          responseHeaders: ctx.serverToProxyResponse?.headers,
          requestBody: ctx._requestBody || Buffer.alloc(0),
          responseBody: Buffer.alloc(0),
          error: err,
          responseHttpVersion: ctx.serverToProxyResponse?.httpVersion,
          durationMs: ctx._startAt ? Date.now() - ctx._startAt : null,
        })
      );
    }
  });

  proxy.onRequest((ctx: any, callback: () => void) => {
    ctx._startAt = Date.now();
    const target = toTargetUrl(ctx);
    const requestInfo = buildRuleRequestInfo(ctx, target);
    const activeRule = getRules().find((rule) => matchRule(rule, requestInfo));
    let delayMs = 0;
    if (activeRule) {
      if (activeRule.actions.type === 'overrideHeaders' && activeRule.actions.overrideHeaders.length) {
        const overrideHeaders = activeRule.actions.overrideHeaders;
        ctx.clientToProxyRequest.headers = applyHeaderOverrides(ctx.clientToProxyRequest.headers, overrideHeaders);
        if (ctx.proxyToServerRequestOptions?.headers) {
          ctx.proxyToServerRequestOptions.headers = applyHeaderOverrides(
            ctx.proxyToServerRequestOptions.headers,
            overrideHeaders
          );
        }
        ctx._overrideHeaders = activeRule.actions.overrideHeaders;
        ctx.onRequestHeaders((ctxReq: any, cb: () => void) => {
          if (ctxReq.proxyToServerRequestOptions?.headers) {
            ctxReq.proxyToServerRequestOptions.headers = applyHeaderOverrides(
              ctxReq.proxyToServerRequestOptions.headers,
              overrideHeaders
            );
          }
          cb();
        });
      }

      if (activeRule.actions.type === 'delay') {
        delayMs = activeRule.actions.delayMs;
      }

      if (activeRule.actions.type === 'close') {
        ctx.clientToProxyRequest.socket.destroy();
        broadcastEntry(
          buildEntry({
            target,
            request: ctx.clientToProxyRequest,
            status: null,
            responseHeaders: {},
            requestBody: Buffer.alloc(0),
            responseBody: Buffer.alloc(0),
            error: 'Connection closed by rule',
            responseHttpVersion: null,
            durationMs: 0,
          })
        );
        return;
      }
    }

    const requestChunks: Buffer[] = [];
    ctx.onRequestData((_ctxReq: any, chunk: Buffer, cb: (_err: null, next: Buffer) => void) => {
      requestChunks.push(chunk);
      cb(null, chunk);
    });
    ctx.onRequestEnd((ctxReq: any, cb: () => void) => {
      ctxReq._requestBody = Buffer.concat(requestChunks);
      cb();
    });

    const responseChunks: Buffer[] = [];
    ctx.onResponseData((_ctxRes: any, chunk: Buffer, cb: (_err: null, next: Buffer) => void) => {
      responseChunks.push(chunk);
      cb(null, chunk);
    });
    ctx.onResponseEnd((ctxRes: any, cb: () => void) => {
      broadcastEntry(
        buildEntry({
          target: toTargetUrl(ctxRes),
          request: ctxRes.clientToProxyRequest,
          requestHeadersOverride: ctxRes._overrideHeaders,
          status: ctxRes.serverToProxyResponse?.statusCode,
          responseHeaders: ctxRes.serverToProxyResponse?.headers,
          requestBody: ctxRes._requestBody || Buffer.alloc(0),
          responseBody: Buffer.concat(responseChunks),
          responseHttpVersion: ctxRes.serverToProxyResponse?.httpVersion,
          durationMs: ctxRes._startAt ? Date.now() - ctxRes._startAt : null,
        })
      );
      cb();
    });

    if (delayMs > 0) {
      setTimeout(() => callback(), delayMs);
      return;
    }
    callback();
  });

  const listenOnPort = (port: number) =>
    new Promise<void>((resolve, reject) => {
      proxy.listen(
        {
          port,
          host: '0.0.0.0',
          sslCaDir: caDir,
          forceSNI: true,
        },
        (err: { code?: string } | null) => {
          if (err) return reject(err);
          return resolve();
        }
      );
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
  setProxyInstance(proxy);
  const caCertPath = path.join(caDir, 'certs', 'ca.pem');
  setCaCertPath(caCertPath);
  console.log(`Hermes Proxy MITM listening on http://localhost:${port}`);
  console.log(`Root CA generated at: ${caCertPath}`);
  broadcastCaReady();
  broadcastPortReady();
};
