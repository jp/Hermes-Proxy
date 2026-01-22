const { app, BrowserWindow, ipcMain, shell, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const { Proxy: createProxy } = require('http-mitm-proxy');
const fs = require('fs');
const zlib = require('zlib');

const HISTORY_LIMIT = 500;
const PROXY_PORT_START = 8000;
const entries = [];
let caCertPath = null;
let proxyInstance;
let proxyPort = PROXY_PORT_START;

const broadcastCaReady = () => {
  if (!caCertPath) return;
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-ca-ready', caCertPath);
  });
};

const broadcastPortReady = () => {
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-port-ready', proxyPort);
  });
};

const bodyToText = (buffer) => {
  if (!buffer || buffer.length === 0) return '';
  try {
    return buffer.toString('utf8');
  } catch (err) {
    return `<non-text payload: ${buffer.length} bytes>`;
  }
};

const normalizeHeaderValue = (value) => {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'undefined' || value === null) return '';
  return String(value);
};

const getHeaderValue = (headers, name) => {
  if (!headers) return '';
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return normalizeHeaderValue(headers[match]);
};

const normalizeEncoding = (value) => {
  if (!value) return '';
  return String(value).split(',')[0].trim().toLowerCase();
};

const decodeBody = (buffer, encoding) => {
  if (!buffer || buffer.length === 0) return null;
  const normalized = normalizeEncoding(encoding);
  if (!normalized) return null;
  try {
    if (normalized === 'gzip' || normalized === 'x-gzip') {
      return zlib.gunzipSync(buffer);
    }
    if (normalized === 'deflate') {
      return zlib.inflateSync(buffer);
    }
    if (normalized === 'br') {
      return zlib.brotliDecompressSync(buffer);
    }
  } catch (err) {
    return null;
  }
  return null;
};

const normalizeHttpVersion = (version, major, minor) => {
  if (version) return `HTTP/${version}`;
  if (typeof major !== 'undefined' && typeof minor !== 'undefined') return `HTTP/${major}.${minor}`;
  return 'HTTP/1.1';
};

const buildEntry = ({
  target,
  request,
  status,
  responseHeaders,
  requestBody,
  responseBody,
  error,
  responseHttpVersion,
  durationMs,
}) => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  timestamp: new Date().toISOString(),
  method: request.method || 'GET',
  requestHttpVersion: normalizeHttpVersion(request.httpVersion, request.httpVersionMajor, request.httpVersionMinor),
  responseHttpVersion: normalizeHttpVersion(responseHttpVersion, undefined, undefined),
  status: error?.code === 'ENOTFOUND' ? null : status,
  protocol: target.protocol || 'http:',
  host: target.host || target.hostname,
  path: target.pathname,
  query: target.search,
  requestHeaders: request.headers || {},
  responseHeaders: responseHeaders || {},
  requestBody: bodyToText(requestBody),
  responseBody: bodyToText(responseBody),
  requestBodySize: requestBody?.length || 0,
  responseBodySize: responseBody?.length || 0,
  requestEncoding: getHeaderValue(request.headers || {}, 'content-encoding') || null,
  responseEncoding: getHeaderValue(responseHeaders || {}, 'content-encoding') || null,
  requestDecodedSize:
    decodeBody(requestBody, getHeaderValue(request.headers || {}, 'content-encoding'))?.length ?? null,
  responseDecodedSize:
    decodeBody(responseBody, getHeaderValue(responseHeaders || {}, 'content-encoding'))?.length ?? null,
  durationMs: typeof durationMs === 'number' ? durationMs : null,
  error: error ? String(error.message || error) : null,
});

const broadcastEntry = (entry) => {
  entries.unshift(entry);
  if (entries.length > HISTORY_LIMIT) entries.pop();
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-entry', entry);
  });
};

const toTargetUrl = (ctx) => {
  const host = ctx.clientToProxyRequest.headers.host || 'unknown';
  const protocol = ctx.isSSL ? 'https:' : 'http:';
  const rawUrl = ctx.clientToProxyRequest.url.startsWith('http')
    ? ctx.clientToProxyRequest.url
    : `${protocol}//${host}${ctx.clientToProxyRequest.url}`;
  return new URL(rawUrl);
};

const startMitmProxy = async () => {
  const caDir = path.join(app.getPath('userData'), 'mitm-ca');
  const proxy = new createProxy();

  proxy.onError((ctx, err, kind) => {
    console.error('Proxy error', kind, err);
    if (ctx) {
      const target = toTargetUrl(ctx);
      broadcastEntry(
        buildEntry({
          target,
          request: ctx.clientToProxyRequest,
          status: 500,
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

  proxy.onRequest((ctx, callback) => {
    ctx._startAt = Date.now();
    const requestChunks = [];
    ctx.onRequestData((_, chunk, cb) => {
      requestChunks.push(chunk);
      cb(null, chunk);
    });
    ctx.onRequestEnd((ctxReq, cb) => {
      ctxReq._requestBody = Buffer.concat(requestChunks);
      cb();
    });

    const responseChunks = [];
    ctx.onResponseData((_, chunk, cb) => {
      responseChunks.push(chunk);
      cb(null, chunk);
    });
    ctx.onResponseEnd((ctxRes, cb) => {
      const target = toTargetUrl(ctxRes);
      broadcastEntry(
        buildEntry({
          target,
          request: ctxRes.clientToProxyRequest,
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

    return callback();
  });

  const listenOnPort = (port) =>
    new Promise((resolve, reject) => {
      proxy.listen(
        {
          port,
          host: '0.0.0.0',
          sslCaDir: caDir,
          forceSNI: true,
        },
        (err) => {
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
    } catch (err) {
      if (err?.code === 'EADDRINUSE') {
        port += 1;
        continue;
      }
      throw err;
    }
  }

  proxyPort = port;
  proxyInstance = proxy;
  caCertPath = path.join(caDir, 'certs', 'ca.pem');
  console.log(`Hermes Proxy MITM listening on http://localhost:${proxyPort}`);
  console.log(`Root CA generated at: ${caCertPath}`);
  broadcastCaReady();
  broadcastPortReady();
};

const createWindow = () => {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL('http://localhost:5174');
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  if (caCertPath) {
    broadcastCaReady();
  }
  if (proxyPort) {
    broadcastPortReady();
  }
};

app.whenReady().then(() => {
  startMitmProxy().catch((err) => {
    console.error('Failed to start MITM proxy', err);
  });
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  proxyInstance?.close?.();
});

ipcMain.handle('proxy:get-port', () => proxyPort);

ipcMain.handle('proxy:get-history', () => entries);
ipcMain.handle('proxy:get-ca', () => ({ caCertPath }));
ipcMain.handle('proxy:open-ca-folder', () => {
  if (caCertPath) {
    shell.showItemInFolder(caCertPath);
    return true;
  }
  return false;
});
ipcMain.handle('proxy:traffic-context-menu', async (event, entryId) => {
  const entry = entries.find((e) => e.id === entryId);
  const menu = Menu.buildFromTemplate([
    {
      label: 'Copy',
      enabled: Boolean(entry),
      submenu: [
        {
          label: 'Copy URL',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildEntryUrl(entry));
          },
        },
        {
          label: 'Copy as cURL',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildCurlCommand(entry));
          },
        },
        {
          label: 'Copy as PowerShell',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildPowerShellCommand(entry));
          },
        },
        {
          label: 'Copy as fetch',
          click: () => {
            if (!entry) return;
            clipboard.writeText(buildFetchCommand(entry));
          },
        },
        { type: 'separator' },
        {
          label: 'Copy response',
          click: () => {
            if (!entry) return;
            clipboard.writeText(entry.responseBody || '');
          },
        },
      ],
    },
    {
      label: 'Export Exchange as HAR',
      click: () => exportEntryAsHar(entryId),
      enabled: Boolean(entry),
    },
  ]);
  menu.popup({ window: BrowserWindow.fromWebContents(event.sender) || undefined });
});

const exportEntryAsHar = async (entryId) => {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;

  const protocol = entry.protocol?.replace(':', '') || 'http';
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Hermes Proxy', version: app.getVersion() },
      entries: [
        {
          startedDateTime: entry.timestamp,
          time: 0,
          request: {
            method: entry.method,
            url: `${protocol}://${entry.host}${entry.path}${entry.query || ''}`,
            httpVersion: entry.requestHttpVersion || 'HTTP/1.1',
            cookies: [],
            headers: Object.entries(entry.requestHeaders || {}).map(([name, value]) => ({ name, value })),
            queryString: [],
            headersSize: -1,
            bodySize: entry.requestBody ? Buffer.byteLength(entry.requestBody) : 0,
            postData: entry.requestBody
              ? { mimeType: entry.requestHeaders?.['content-type'] || '', text: entry.requestBody }
              : undefined,
          },
          response: {
            status: entry.status || 0,
            statusText: '',
            httpVersion: entry.responseHttpVersion || 'HTTP/1.1',
            cookies: [],
            headers: Object.entries(entry.responseHeaders || {}).map(([name, value]) => ({ name, value })),
            content: {
              size: entry.responseBody ? Buffer.byteLength(entry.responseBody) : 0,
              text: entry.responseBody || '',
              mimeType: entry.responseHeaders?.['content-type'] || '',
            },
            redirectURL: '',
            headersSize: -1,
            bodySize: entry.responseBody ? Buffer.byteLength(entry.responseBody) : 0,
          },
          cache: {},
          timings: { send: 0, wait: 0, receive: 0 },
        },
      ],
    },
  };

  const savePath = await dialog.showSaveDialog({
    title: 'Export Exchange as HAR',
    defaultPath: 'exchange.har',
    filters: [{ name: 'HAR', extensions: ['har'] }],
  });
  if (savePath.canceled || !savePath.filePath) return;
  fs.writeFileSync(savePath.filePath, JSON.stringify(har, null, 2), 'utf-8');
};

const buildEntryUrl = (entry) => {
  const protocol = entry.protocol?.replace(':', '') || 'http';
  return `${protocol}://${entry.host}${entry.path}${entry.query || ''}`;
};

const escapeSingleQuotes = (value) => String(value).replace(/'/g, `'\"'\"'`);
const escapePowerShell = (value) => String(value).replace(/'/g, "''");

const buildCurlCommand = (entry) => {
  const url = buildEntryUrl(entry);
  const parts = [`curl -X ${entry.method || 'GET'}`];
  parts.push(`'${escapeSingleQuotes(url)}'`);

  const headers = entry.requestHeaders || {};
  Object.entries(headers).forEach(([name, value]) => {
    if (typeof value === 'undefined') return;
    const headerValue = Array.isArray(value) ? value.join(', ') : String(value);
    parts.push(`-H '${escapeSingleQuotes(`${name}: ${headerValue}`)}'`);
  });

  if (entry.requestBody) {
    parts.push(`--data-raw '${escapeSingleQuotes(entry.requestBody)}'`);
  }

  return parts.join(' ');
};

const buildPowerShellCommand = (entry) => {
  const url = buildEntryUrl(entry);
  const method = entry.method || 'GET';
  const headers = entry.requestHeaders || {};
  const headerEntries = Object.entries(headers)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([name, value]) => {
      const headerValue = Array.isArray(value) ? value.join(', ') : String(value);
      return `'${escapePowerShell(name)}'='${escapePowerShell(headerValue)}'`;
    });
  const headerBlock = headerEntries.length ? `-Headers @{ ${headerEntries.join('; ')} }` : '';
  const bodyBlock = entry.requestBody ? `-Body '${escapePowerShell(entry.requestBody)}'` : '';
  const parts = [
    'Invoke-WebRequest',
    `-Uri '${escapePowerShell(url)}'`,
    `-Method ${method}`,
    headerBlock,
    bodyBlock,
  ].filter(Boolean);
  return parts.join(' ');
};

const buildFetchCommand = (entry) => {
  const url = buildEntryUrl(entry);
  const method = entry.method || 'GET';
  const headers = entry.requestHeaders || {};
  const headerEntries = Object.entries(headers)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([name, value]) => {
      const headerValue = Array.isArray(value) ? value.join(', ') : String(value);
      return `    '${String(name)}': '${escapeSingleQuotes(headerValue)}'`;
    });
  const bodyBlock = entry.requestBody
    ? `  body: '${escapeSingleQuotes(entry.requestBody)}',\n`
    : '';
  const headerBlock = headerEntries.length
    ? `  headers: {\n${headerEntries.join(',\n')}\n  },\n`
    : '';
  return `fetch('${escapeSingleQuotes(url)}', {\n  method: '${method}',\n${headerBlock}${bodyBlock}});`;
};
