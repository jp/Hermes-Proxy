const { app, BrowserWindow, ipcMain, shell, Menu, dialog, clipboard } = require('electron');
const path = require('path');
const { Proxy: createProxy } = require('http-mitm-proxy');
const fs = require('fs');
const zlib = require('zlib');
const forge = require('node-forge');
const http = require('http');
const https = require('https');

const HISTORY_LIMIT = 500;
const PROXY_PORT_START = 8000;
const RULE_TIMEOUT_MS = 30000;
const RULES_FILENAME = 'rules.json';
const entries = [];
let rules = [];
let caCertPath = null;
let proxyInstance;
let proxyPort = PROXY_PORT_START;
let rulesFilePath = null;

const CA_SUBJECT = [
  { name: 'commonName', value: 'HermesProxyCA' },
  { name: 'countryName', value: 'Internet' },
  { shortName: 'ST', value: 'Internet' },
  { name: 'localityName', value: 'Internet' },
  { name: 'organizationName', value: 'Hermes Proxy' },
  { shortName: 'OU', value: 'CA' },
];

const CA_EXTENSIONS = [
  { name: 'basicConstraints', cA: true },
  {
    name: 'keyUsage',
    keyCertSign: true,
    digitalSignature: true,
    nonRepudiation: true,
    keyEncipherment: true,
    dataEncipherment: true,
  },
  {
    name: 'extKeyUsage',
    serverAuth: true,
    clientAuth: true,
    codeSigning: true,
    emailProtection: true,
    timeStamping: true,
  },
  {
    name: 'nsCertType',
    client: true,
    server: true,
    email: true,
    objs: true,
    sslCA: true,
    emailCA: true,
    objCA: true,
  },
  { name: 'subjectKeyIdentifier' },
];

const getCertCommonName = (pemText) => {
  try {
    const cert = forge.pki.certificateFromPem(pemText);
    const field = cert.subject.getField('CN');
    return field?.value || null;
  } catch (err) {
    return null;
  }
};

const randomSerialNumber = () => {
  let serial = '';
  for (let i = 0; i < 4; i += 1) {
    serial += `00000000${Math.floor(Math.random() * 256 ** 4).toString(16)}`.slice(-8);
  }
  return serial;
};

const ensureHermesCa = async (caDir) => {
  const certsDir = path.join(caDir, 'certs');
  const keysDir = path.join(caDir, 'keys');
  const certPath = path.join(certsDir, 'ca.pem');
  const privateKeyPath = path.join(keysDir, 'ca.private.key');
  const publicKeyPath = path.join(keysDir, 'ca.public.key');
  fs.mkdirSync(certsDir, { recursive: true });
  fs.mkdirSync(keysDir, { recursive: true });

  if (fs.existsSync(certPath)) {
    const pemText = fs.readFileSync(certPath, 'utf8');
    const commonName = getCertCommonName(pemText);
    if (commonName === 'HermesProxyCA') {
      return;
    }
  }

  const keys = await new Promise((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048 }, (err, keyPair) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(keyPair);
    });
  });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  cert.setSubject(CA_SUBJECT);
  cert.setIssuer(CA_SUBJECT);
  cert.setExtensions(CA_EXTENSIONS);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
  fs.writeFileSync(privateKeyPath, forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(publicKeyPath, forge.pki.publicKeyToPem(keys.publicKey));
};

const pemToDer = (pemText) => {
  if (!pemText) return null;
  const match = pemText.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!match) return null;
  const b64 = match[1].replace(/\s+/g, '');
  try {
    return Buffer.from(b64, 'base64');
  } catch (err) {
    return null;
  }
};

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

const normalizeRule = (rule, index) => {
  const match = rule?.match || {};
  const actions = rule?.actions || {};
  const normalizeList = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  const normalizeHeaderList = (list) =>
    (Array.isArray(list) ? list : [])
      .map((item) => ({
        name: String(item?.name || '').trim(),
        value: String(item?.value || '').trim(),
      }))
      .filter((item) => item.name || item.value);
  const legacyType = actions.delayMs
    ? 'delay'
    : Array.isArray(actions.overrideHeaders) && actions.overrideHeaders.length
      ? 'overrideHeaders'
      : 'none';
  const normalizedType = ['none', 'delay', 'overrideHeaders', 'close'].includes(actions.type)
    ? actions.type
    : legacyType;

  return {
    id: rule?.id || `rule-${Date.now()}-${index}`,
    name: String(rule?.name || `Rule ${index + 1}`),
    enabled: rule?.enabled !== false,
    match: {
      methods: normalizeList(match.methods).map((value) => value.toUpperCase()),
      hosts: normalizeList(match.hosts),
      urls: normalizeList(match.urls),
      headers: normalizeHeaderList(match.headers),
    },
    actions: {
      type: normalizedType,
      delayMs: Number.isFinite(Number(actions.delayMs)) ? Math.max(0, Number(actions.delayMs)) : 0,
      overrideHeaders: normalizeHeaderList(actions.overrideHeaders),
    },
  };
};

const normalizeRules = (list) => (Array.isArray(list) ? list : []).map(normalizeRule);

const getDefaultRulesPath = () => path.join(app.getPath('userData'), RULES_FILENAME);

const persistRules = (rulesList, targetPath) => {
  const filePath = targetPath || rulesFilePath || getDefaultRulesPath();
  const payload = JSON.stringify({ rules: rulesList }, null, 2);
  fs.writeFileSync(filePath, payload, 'utf-8');
  rulesFilePath = filePath;
};

const loadRulesFromFile = (filePath) => {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const loadedRules = normalizeRules(payload?.rules || payload);
  rulesFilePath = filePath;
  return loadedRules;
};

const toLower = (value) => String(value || '').toLowerCase();

const matchesSubstringList = (value, list) => {
  if (!list.length) return true;
  const haystack = toLower(value);
  return list.some((pattern) => haystack.includes(toLower(pattern)));
};

const headerMatchesRule = (headers, matcher) => {
  const nameNeedle = toLower(matcher.name);
  const valueNeedle = toLower(matcher.value);
  return Object.entries(headers).some(([name, value]) => {
    const headerName = toLower(name);
    const headerValue = toLower(normalizeHeaderValue(value));
    if (nameNeedle && !headerName.includes(nameNeedle)) return false;
    if (valueNeedle && !headerValue.includes(valueNeedle)) return false;
    return true;
  });
};

const matchRule = (rule, requestInfo) => {
  if (!rule.enabled) return false;
  if (rule.match.methods.length) {
    const method = String(requestInfo.method || '').toUpperCase();
    if (rule.match.methods.includes('*')) return true;
    if (!rule.match.methods.includes(method)) return false;
  }
  if (!matchesSubstringList(requestInfo.host, rule.match.hosts)) return false;
  if (!matchesSubstringList(requestInfo.url, rule.match.urls)) return false;
  if (rule.match.headers.length) {
    const headers = requestInfo.headers || {};
    const matchesAll = rule.match.headers.every((matcher) => headerMatchesRule(headers, matcher));
    if (!matchesAll) return false;
  }
  return true;
};

const buildRuleRequestInfo = (ctx, targetUrl) => ({
  method: ctx.clientToProxyRequest?.method || '',
  host: targetUrl?.host || '',
  url: targetUrl?.toString?.() || '',
  headers: ctx.clientToProxyRequest?.headers || {},
});

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

const normalizeHarHttpVersion = (version) => {
  if (!version) return 'HTTP/1.1';
  const trimmed = String(version).trim();
  return /^HTTP\//i.test(trimmed) ? trimmed : `HTTP/${trimmed}`;
};

const headersListToObject = (headers = []) =>
  headers.reduce((acc, header) => {
    if (!header) return acc;
    const name = String(header.name || '').trim();
    if (!name) return acc;
    const value = normalizeHeaderValue(header.value);
    if (acc[name]) {
      acc[name] = `${acc[name]}, ${value}`;
    } else {
      acc[name] = value;
    }
    return acc;
  }, {});

const decodeHarBody = (content = {}) => {
  if (!content?.text) return Buffer.alloc(0);
  if (content.encoding === 'base64') {
    return Buffer.from(content.text, 'base64');
  }
  return Buffer.from(content.text, 'utf8');
};

const isTimeoutError = (err) => {
  if (!err) return false;
  const code = String(err.code || '').toUpperCase();
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ETIMEOUT'].includes(code)) return true;
  return /timeout/i.test(String(err.message || ''));
};

const buildEntryFromHar = (harEntry) => {
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
  requestHeadersOverride,
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
  requestHeaders:
    requestHeadersOverride?.length > 0
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
  await ensureHermesCa(caDir);
  const proxy = new createProxy();

  proxy.onError((ctx, err, kind) => {
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

  proxy.onRequest((ctx, callback) => {
    ctx._startAt = Date.now();
    const target = toTargetUrl(ctx);
    const requestInfo = buildRuleRequestInfo(ctx, target);
    const activeRule = rules.find((rule) => matchRule(rule, requestInfo));
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
        ctx.onRequestHeaders((ctxReq, cb) => {
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
  const iconPath = path.join(__dirname, '../src/images/icon.png');
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    backgroundColor: '#0f172a',
    icon: iconPath,
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
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'));
  }

  if (caCertPath) {
    broadcastCaReady();
  }
  if (proxyPort) {
    broadcastPortReady();
  }
};

const createRequestEditorWindow = (entryId) => {
  const iconPath = path.join(__dirname, '../src/images/icon.png');
  const win = new BrowserWindow({
    width: 900,
    height: 720,
    backgroundColor: '#0f172a',
    icon: iconPath,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const isDev = !app.isPackaged;
  if (isDev) {
    win.loadURL(`http://localhost:5174/?mode=request-editor&entryId=${encodeURIComponent(entryId)}`);
  } else {
    win.loadFile(path.join(app.getAppPath(), 'dist', 'index.html'), {
      query: { mode: 'request-editor', entryId },
    });
  }
};

app.whenReady().then(() => {
  try {
    const defaultRulesPath = getDefaultRulesPath();
    if (fs.existsSync(defaultRulesPath)) {
      rules = loadRulesFromFile(defaultRulesPath);
    }
  } catch (err) {
    console.error('Failed to load rules', err);
  }
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
ipcMain.handle('proxy:get-rules', () => rules);
ipcMain.handle('proxy:set-rules', (_event, nextRules) => {
  rules = normalizeRules(nextRules);
  try {
    persistRules(rules);
  } catch (err) {
    console.error('Failed to persist rules', err);
  }
  return rules;
});
ipcMain.handle('proxy:save-rules', async () => {
  const savePath = await dialog.showSaveDialog({
    title: 'Save rules',
    defaultPath: rulesFilePath || getDefaultRulesPath(),
    filters: [{ name: 'Rules', extensions: ['json'] }],
  });
  if (savePath.canceled || !savePath.filePath) return false;
  try {
    persistRules(rules, savePath.filePath);
    return true;
  } catch (err) {
    console.error('Failed to save rules', err);
    return false;
  }
});
ipcMain.handle('proxy:load-rules', async () => {
  const openPath = await dialog.showOpenDialog({
    title: 'Load rules',
    defaultPath: rulesFilePath || getDefaultRulesPath(),
    filters: [{ name: 'Rules', extensions: ['json'] }],
    properties: ['openFile'],
  });
  if (openPath.canceled || !openPath.filePaths?.length) return false;
  try {
    rules = loadRulesFromFile(openPath.filePaths[0]);
    BrowserWindow.getAllWindows().forEach((win) => {
      win.webContents.send('proxy-rules-updated', rules);
    });
    return true;
  } catch (err) {
    console.error('Failed to load rules', err);
    return false;
  }
});
ipcMain.handle('proxy:repeat-request', async (_event, payload) => {
  const entryId = typeof payload === 'string' ? payload : payload?.entryId;
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return false;
  try {
    await repeatEntryRequest(entry, typeof payload === 'object' ? payload : {});
    return true;
  } catch (err) {
    console.error('Failed to repeat request', err);
    return false;
  }
});
ipcMain.handle('proxy:open-request-editor', (_event, entryId) => {
  const entry = entries.find((item) => item.id === entryId);
  if (!entry) return false;
  createRequestEditorWindow(entryId);
  return true;
});
ipcMain.handle('proxy:export-all-har', async () => {
  try {
    return await exportAllEntriesAsHar();
  } catch (err) {
    console.error('Failed to export all HAR', err);
    return false;
  }
});
ipcMain.handle('proxy:import-har', async () => {
  const openPath = await dialog.showOpenDialog({
    title: 'Import HAR file',
    filters: [{ name: 'HAR', extensions: ['har'] }],
    properties: ['openFile'],
  });
  if (openPath.canceled || !openPath.filePaths?.length) return false;
  try {
    const fileText = fs.readFileSync(openPath.filePaths[0], 'utf8');
    const har = JSON.parse(fileText);
    const harEntries = har?.log?.entries;
    if (!Array.isArray(harEntries) || harEntries.length === 0) return false;
    harEntries.forEach((harEntry) => {
      try {
        const entry = buildEntryFromHar(harEntry);
        broadcastEntry(entry);
      } catch (err) {
        console.error('Failed to import HAR entry', err);
      }
    });
    return true;
  } catch (err) {
    console.error('Failed to import HAR file', err);
    return false;
  }
});
ipcMain.handle('proxy:clear-traffic', () => {
  entries.splice(0, entries.length);
  BrowserWindow.getAllWindows().forEach((win) => {
    win.webContents.send('proxy-clear-traffic');
  });
  return true;
});
ipcMain.handle('proxy:open-ca-folder', () => {
  if (caCertPath) {
    shell.showItemInFolder(caCertPath);
    return true;
  }
  return false;
});
ipcMain.handle('proxy:export-ca-certificate', async () => {
  if (!caCertPath) return false;
  try {
    const pemText = fs.readFileSync(caCertPath, 'utf8');
    const derBuffer = pemToDer(pemText);
    if (!derBuffer) return false;
    const defaultDir = app.getPath('downloads');
    const savePath = await dialog.showSaveDialog({
      title: 'Export Hermes Proxy CA certificate',
      defaultPath: path.join(defaultDir, 'hermes-proxy-ca.cer'),
      filters: [{ name: 'Certificate', extensions: ['cer', 'crt'] }],
    });
    if (savePath.canceled || !savePath.filePath) return false;
    const filePath = savePath.filePath.endsWith('.cer') || savePath.filePath.endsWith('.crt')
      ? savePath.filePath
      : `${savePath.filePath}.cer`;
    fs.writeFileSync(filePath, derBuffer);
    shell.showItemInFolder(filePath);
    return true;
  } catch (err) {
    console.error('Failed to export CA certificate', err);
    return false;
  }
});
ipcMain.handle('proxy:traffic-context-menu', async (event, entryId) => {
  const entry = entries.find((e) => e.id === entryId);
  const menu = Menu.buildFromTemplate([
    {
      label: 'Add matching rule',
      enabled: Boolean(entry),
      click: () => {
        if (!entry) return;
        const win = BrowserWindow.fromWebContents(event.sender);
        win?.webContents.send('proxy-add-rule', {
          method: entry.method,
          host: entry.host,
          url: `${entry.path || ''}${entry.query || ''}`,
          headers: entry.requestHeaders || {},
        });
      },
    },
    { type: 'separator' },
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

ipcMain.handle('proxy:save-response-body', async (_event, payload) => {
  const body = payload?.body;
  if (!body) return false;
  const defaultPath = payload?.defaultPath || 'response-body.txt';
  const savePath = await dialog.showSaveDialog({
    title: 'Save Response Body',
    defaultPath,
  });
  if (savePath.canceled || !savePath.filePath) return false;
  fs.writeFileSync(savePath.filePath, body, 'utf-8');
  return true;
});

const buildHarEntry = (entry) => ({
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
      ? { mimeType: entry.requestHeaders?.['content-type'] || '', text: entry.requestBody }
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
      mimeType: entry.responseHeaders?.['content-type'] || '',
    },
    redirectURL: '',
    headersSize: -1,
    bodySize: entry.responseBody ? Buffer.byteLength(entry.responseBody) : 0,
  },
  cache: {},
  timings: { send: 0, wait: 0, receive: 0 },
});

const exportEntryAsHar = async (entryId) => {
  const entry = entries.find((e) => e.id === entryId);
  if (!entry) return;

  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Hermes Proxy', version: app.getVersion() },
      entries: [buildHarEntry(entry)],
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

const exportAllEntriesAsHar = async () => {
  if (!entries.length) return false;
  const har = {
    log: {
      version: '1.2',
      creator: { name: 'Hermes Proxy', version: app.getVersion() },
      entries: entries.slice().reverse().map((entry) => buildHarEntry(entry)),
    },
  };
  const savePath = await dialog.showSaveDialog({
    title: 'Export All Traffic as HAR',
    defaultPath: 'traffic.har',
    filters: [{ name: 'HAR', extensions: ['har'] }],
  });
  if (savePath.canceled || !savePath.filePath) return false;
  fs.writeFileSync(savePath.filePath, JSON.stringify(har, null, 2), 'utf-8');
  return true;
};

const buildEntryUrl = (entry) => {
  const protocol = entry.protocol?.replace(':', '') || 'http';
  return `${protocol}://${entry.host}${entry.path}${entry.query || ''}`;
};

const applyHeaderOverrides = (headers, overrides) => {
  const next = { ...(headers || {}) };
  overrides.forEach((override) => {
    if (!override.name) return;
    const lower = override.name.toLowerCase();
    Object.keys(next).forEach((key) => {
      if (key.toLowerCase() === lower) {
        delete next[key];
      }
    });
    next[override.name] = override.value ?? '';
  });
  return next;
};

const sanitizeHeaders = (headers = {}, options = {}) => {
  const stripContentEncoding = Boolean(options.stripContentEncoding);
  const sanitized = {};
  Object.entries(headers).forEach(([name, value]) => {
    if (typeof value === 'undefined') return;
    const lower = name.toLowerCase();
    if (lower === 'host' || lower === 'content-length' || lower === 'proxy-connection') return;
    if (stripContentEncoding && lower === 'content-encoding') return;
    sanitized[name] = Array.isArray(value) ? value.join(', ') : String(value);
  });
  return sanitized;
};

const resolveReplayUrl = (entry, overrideUrl) => {
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

const buildReplayHeaders = (entry, overrides) => {
  const list = overrides?.headers;
  if (!Array.isArray(list)) return entry.requestHeaders || {};
  return list.reduce((acc, item) => {
    const name = String(item?.name || '').trim();
    if (!name) return acc;
    acc[name] = String(item?.value ?? '');
    return acc;
  }, {});
};

const repeatEntryRequest = (entry, overrides = {}) =>
  new Promise((resolve, reject) => {
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
    const replayHeaders = buildReplayHeaders(entry, overrides);
    const headers = sanitizeHeaders(replayHeaders, { stripContentEncoding: hasDecodedBody });
    if (typeof requestBodyText === 'string') {
      headers['content-length'] = String(requestBodyBuffer.length);
    }
    const options = {
      method,
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers,
    };
    const startedAt = Date.now();
    const req = transport.request(options, (res) => {
      const responseChunks = [];
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
