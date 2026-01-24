import { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup';
import logo from './images/logo.png';

const MAX_ENTRIES = 20000;

const statusTone = (status) => {
  if (!status) return 'status-warn';
  if (status >= 500) return 'status-bad';
  if (status >= 400) return 'status-warn';
  return 'status-ok';
};

const headersToText = (headers = {}) =>
  Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n');

const buildEntryUrl = (entry) => {
  const protocol = entry?.protocol?.replace(':', '') || 'http';
  if (!entry) return '';
  return `${protocol}://${entry.host}${entry.path}${entry.query || ''}`;
};

const headersToList = (headers = {}) => Object.entries(headers);

const HTTP_METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'];

const createRule = () => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name: 'New rule',
  enabled: true,
  match: {
    methods: [],
    hosts: [],
    urls: [],
    headers: [],
  },
  actions: {
    type: 'none',
    delayMs: 0,
    overrideHeaders: [],
  },
});

const parseListInput = (value, options = {}) => {
  const entries = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (options.uppercase) {
    return entries.map((item) => item.toUpperCase());
  }
  return entries;
};

const bufferPreview = (text = '') => (text.length > 4000 ? `${text.slice(0, 4000)}\n…truncated…` : text);

const formatBytes = (bytes) => {
  if (bytes === null || typeof bytes === 'undefined') return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const formatMs = (ms) => (typeof ms === 'number' ? `${ms} ms` : '—');

const resizeTextarea = (el) => {
  if (!el) return;
  el.style.height = 'auto';
  const maxHeight = Number.parseFloat(window.getComputedStyle(el).maxHeight || '0');
  const clamped = maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight;
  el.style.height = `${clamped}px`;
};

const getHeaderValue = (headers, name) => {
  if (!headers) return '';
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  const value = headers?.[match];
  if (Array.isArray(value)) return value.join(', ');
  return value ? String(value) : '';
};

const parseContentLength = (headers) => {
  const value = getHeaderValue(headers, 'content-length');
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
};

const isCompressibleType = (contentType = '') => {
  const normalized = contentType.toLowerCase();
  return (
    normalized.includes('text/') ||
    normalized.includes('json') ||
    normalized.includes('javascript') ||
    normalized.includes('xml') ||
    normalized.includes('svg')
  );
};

const isJsonContent = (contentType = '') => contentType.toLowerCase().includes('json');
const isHtmlContent = (contentType = '') => {
  const normalized = contentType.toLowerCase();
  return normalized.includes('text/html') || normalized.includes('application/xhtml+xml');
};

const isLikelyHtmlBody = (text = '') => {
  const snippet = text.trim().slice(0, 200).toLowerCase();
  return snippet.startsWith('<!doctype html') || snippet.startsWith('<html') || snippet.includes('<html');
};

const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const tryPrettyJson = (text) => {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch (err) {
    return null;
  }
};

const prettyPrintHtml = (input = '') => {
  if (!input) return '';
  const normalized = input.replace(/\r\n/g, '\n').trim();
  const collapsed = normalized.replace(/>\s+</g, '><');
  const tokens = [];
  let index = 0;
  while (index < collapsed.length) {
    const lt = collapsed.indexOf('<', index);
    if (lt === -1) {
      tokens.push(collapsed.slice(index));
      break;
    }
    if (lt > index) {
      tokens.push(collapsed.slice(index, lt));
    }
    const gt = collapsed.indexOf('>', lt);
    if (gt === -1) {
      tokens.push(collapsed.slice(lt));
      break;
    }
    tokens.push(collapsed.slice(lt, gt + 1));
    index = gt + 1;
  }

  let indent = 0;
  const lines = [];
  tokens.forEach((token) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('<!--') || /^<!DOCTYPE/i.test(trimmed)) {
      lines.push(`${'  '.repeat(indent)}${trimmed}`);
      return;
    }
    if (trimmed.startsWith('</')) {
      indent = Math.max(indent - 1, 0);
      lines.push(`${'  '.repeat(indent)}${trimmed}`);
      return;
    }
    if (trimmed.startsWith('<')) {
      const tagMatch = trimmed.match(/^<\s*([a-z0-9-]+)/i);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
      const selfClosing = trimmed.endsWith('/>') || HTML_VOID_TAGS.has(tagName);
      lines.push(`${'  '.repeat(indent)}${trimmed}`);
      if (!selfClosing) {
        indent += 1;
      }
      return;
    }
    lines.push(`${'  '.repeat(indent)}${trimmed}`);
  });
  return lines.join('\n');
};

const summarizeCacheability = (headers = {}) => {
  const cacheControl = getHeaderValue(headers, 'cache-control');
  const pragma = getHeaderValue(headers, 'pragma');
  const expires = getHeaderValue(headers, 'expires');
  const etag = getHeaderValue(headers, 'etag');
  const lastModified = getHeaderValue(headers, 'last-modified');

  const lowered = cacheControl.toLowerCase();
  if (lowered.includes('no-store')) return 'No (no-store)';
  if (lowered.includes('no-cache') || pragma.toLowerCase().includes('no-cache')) return 'Revalidate';
  if (lowered.includes('private')) return 'Private';
  if (lowered.includes('max-age') || lowered.includes('s-maxage') || lowered.includes('public')) return 'Yes';
  if (expires) return 'Yes (expires)';
  if (etag || lastModified) return 'Revalidate';
  return 'Unknown';
};

function App() {
  const [entries, setEntries] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [caPath, setCaPath] = useState('');
  const [activeTab, setActiveTab] = useState('intercept');
  const [autoScroll, setAutoScroll] = useState(true);
  const [requestCollapsed, setRequestCollapsed] = useState(false);
  const [responseCollapsed, setResponseCollapsed] = useState(false);
  const [performanceCollapsed, setPerformanceCollapsed] = useState(false);
  const [responseBodyCollapsed, setResponseBodyCollapsed] = useState(false);
  const [filterText, setFilterText] = useState('');
  const [prettyPrintResponse, setPrettyPrintResponse] = useState(true);
  const [requestUrlDraft, setRequestUrlDraft] = useState('');
  const [requestHeadersDraft, setRequestHeadersDraft] = useState([]);
  const [rules, setRules] = useState([]);
  const [proxyPort, setProxyPort] = useState(8000);
  const [splitPercent, setSplitPercent] = useState(55);
  const [isResizing, setIsResizing] = useState(false);
  const tableRef = useRef(null);
  const splitRef = useRef(null);
  const resizeRef = useRef(null);
  const rulesReadyRef = useRef(false);

  useEffect(() => {
    let cleanup;
    const api = window.electronAPI;
    let offClearTraffic;
    let offAddRule;
    let offRulesUpdated;

    if (api?.getHistory) {
      api.getHistory().then((history) => {
        const normalized = (history || []).slice().reverse();
        setEntries(normalized);
        if (normalized.length) {
          setSelectedId(normalized[normalized.length - 1].id);
        }
      });
    }

    if (api?.onProxyEntry) {
      cleanup = api.onProxyEntry((entry) => {
        setEntries((prev) => {
          const next = [...prev, entry];
          setSelectedId((current) => current ?? entry.id);
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
      });
    }

    if (api?.onClearTraffic) {
      offClearTraffic = api.onClearTraffic(() => {
        setEntries([]);
        setSelectedId(null);
      });
    }

    if (api?.onAddRule) {
      offAddRule = api.onAddRule((payload) => {
        if (!payload) return;
        const headersList = Object.entries(payload.headers || {}).map(([name, value]) => ({
          name,
          value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
        }));
        setRules((prev) => [
          ...prev,
          {
            ...createRule(),
            name: `Rule for ${payload.method || 'ANY'} ${payload.host || ''}`,
            match: {
              methods: payload.method ? [payload.method] : [],
              hosts: payload.host ? [payload.host] : [],
              urls: payload.url ? [payload.url] : [],
              headers: headersList,
            },
          },
        ]);
        setActiveTab('rules');
      });
    }

    if (api?.onRulesUpdated) {
      offRulesUpdated = api.onRulesUpdated((nextRules) => {
        setRules(Array.isArray(nextRules) ? nextRules : []);
      });
    }

    if (api?.getRules) {
      api.getRules().then((loadedRules) => {
        setRules(Array.isArray(loadedRules) ? loadedRules : []);
        rulesReadyRef.current = true;
      });
    }

    return () => {
      cleanup?.();
      offClearTraffic?.();
      offAddRule?.();
      offRulesUpdated?.();
    };
  }, []);

  useEffect(() => {
    if (!rulesReadyRef.current) return;
    window.electronAPI?.setRules?.(rules);
  }, [rules]);

  useLayoutEffect(() => {
    if (!autoScroll || activeTab !== 'intercept') return;
    const el = tableRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [entries, autoScroll, activeTab]);

  const handleTableScroll = () => {
    const el = tableRef.current;
    if (!el) return;
    const threshold = 40;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
    setAutoScroll(atBottom);
  };

  useEffect(() => {
    const api = window.electronAPI;
    let offCaReady;
    let offPortReady;

    if (api?.getCaCertificate) {
      api.getCaCertificate().then((info) => {
        if (info?.caCertPath) {
          setCaPath(info.caCertPath);
        }
      });
    }

    if (api?.getProxyPort) {
      api.getProxyPort().then((port) => {
        if (port) {
          setProxyPort(port);
        }
      });
    }

    if (api?.onCaReady) {
      offCaReady = api.onCaReady((path) => {
        setCaPath(path);
      });
    }

    if (api?.onProxyPortReady) {
      offPortReady = api.onProxyPortReady((port) => {
        if (port) {
          setProxyPort(port);
        }
      });
    }

    return () => {
      offCaReady?.();
      offPortReady?.();
    };
  }, []);

  useEffect(() => {
    setRequestCollapsed(false);
    setResponseCollapsed(false);
    setPerformanceCollapsed(false);
    setResponseBodyCollapsed(false);
  }, [selectedId]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (event) => {
      const state = resizeRef.current;
      if (!state) return;
      const delta = event.clientX - state.startX;
      const nextPx = state.startWidth + delta;
      const rawPercent = (nextPx / state.containerWidth) * 100;
      const clamped = Math.min(75, Math.max(25, rawPercent));
      setSplitPercent(clamped);
    };
    const onUp = () => {
      setIsResizing(false);
      resizeRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [isResizing]);

  const handleSplitterMouseDown = (event) => {
    event.preventDefault();
    const container = splitRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    resizeRef.current = {
      startX: event.clientX,
      startWidth: (splitPercent / 100) * rect.width,
      containerWidth: rect.width,
    };
    setIsResizing(true);
  };

  const handleRepeatRequest = async () => {
    if (!selected) return;
    await window.electronAPI?.repeatRequest?.({
      entryId: selected.id,
      url: requestUrlDraft,
      headers: requestHeadersDraft,
    });
  };

  const handleExportAllHar = async () => {
    await window.electronAPI?.exportAllHar?.();
  };

  const handleImportHar = async () => {
    await window.electronAPI?.importHar?.();
  };

  const handleClearTraffic = async () => {
    await window.electronAPI?.clearTraffic?.();
    setSelectedId(null);
  };

  const handleSaveRules = async () => {
    await window.electronAPI?.saveRules?.();
  };

  const handleLoadRules = async () => {
    await window.electronAPI?.loadRules?.();
  };

  const handleAddRule = () => {
    setRules((prev) => [...prev, createRule()]);
  };

  const handleUpdateRule = (index, updater) => {
    setRules((prev) => {
      const next = [...prev];
      next[index] = updater(next[index]);
      return next;
    });
  };

  const handleRemoveRule = (index) => {
    setRules((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleHeaderValueChange = (event, index) => {
    const next = [...requestHeadersDraft];
    next[index] = { ...next[index], value: event.target.value };
    setRequestHeadersDraft(next);
    resizeTextarea(event.target);
  };

  const selected = useMemo(() => entries.find((e) => e.id === selectedId), [entries, selectedId]);

  useEffect(() => {
    document.querySelectorAll('.header-value-input').forEach((el) => resizeTextarea(el));
  }, [requestHeadersDraft]);

  useEffect(() => {
    if (!selected) {
      setRequestUrlDraft('');
      setRequestHeadersDraft([]);
      return;
    }
    setRequestUrlDraft(buildEntryUrl(selected));
    setRequestHeadersDraft(
      headersToList(selected.requestHeaders).map(([name, value]) => ({
        name: String(name),
        value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
      }))
    );
  }, [selected]);

  const filteredEntries = useMemo(() => {
    if (!filterText.trim()) return entries;
    const q = filterText.toLowerCase();
    return entries.filter((e) => {
      const haystack = [
        e.method,
        e.host,
        e.path,
        e.query,
        String(e.status ?? ''),
        headersToText(e.requestHeaders),
        headersToText(e.responseHeaders),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [entries, filterText]);
  const requestLine = useMemo(() => {
    if (!selected) return '';
    const version = selected.requestHttpVersion || 'HTTP/1.1';
    return `${version} ${selected.method} ${selected.host}`;
  }, [selected]);
  const responseLine = useMemo(() => {
    if (!selected) return '';
    const prefix = selected.responseHttpVersion || 'HTTP/1.1';
    return `${prefix} ${selected.status ?? '—'}`;
  }, [selected]);
  const responseContentType = useMemo(() => {
    if (!selected) return '';
    return getHeaderValue(selected.responseHeaders || {}, 'content-type');
  }, [selected]);
  const isHtmlResponse = useMemo(() => {
    if (!selected?.responseBody) return false;
    return isHtmlContent(responseContentType) || isLikelyHtmlBody(selected.responseBody);
  }, [selected, responseContentType]);
  const isPrettyPrintableResponse = useMemo(() => {
    if (!selected?.responseBody) return false;
    return isJsonContent(responseContentType) || isHtmlResponse;
  }, [selected, responseContentType, isHtmlResponse]);
  const responseDisplayBody = useMemo(() => {
    if (!selected) return '';
    return selected.responseDecodedBody || selected.responseBody || '';
  }, [selected]);
  const requestDisplayBody = useMemo(() => {
    if (!selected) return '';
    return selected.requestDecodedBody || selected.requestBody || '';
  }, [selected]);
  const responsePrettyBody = useMemo(() => {
    if (!responseDisplayBody) return '';
    if (!prettyPrintResponse) return responseDisplayBody;
    if (isJsonContent(responseContentType)) {
      const pretty = tryPrettyJson(responseDisplayBody);
      return pretty ?? responseDisplayBody;
    }
    if (isHtmlResponse) {
      return prettyPrintHtml(responseDisplayBody);
    }
    return responseDisplayBody;
  }, [responseDisplayBody, prettyPrintResponse, responseContentType, isHtmlResponse]);
  const responseBodyText = useMemo(() => {
    if (isPrettyPrintableResponse && prettyPrintResponse) {
      return responsePrettyBody;
    }
    return bufferPreview(responsePrettyBody);
  }, [responsePrettyBody, responseContentType, prettyPrintResponse, isPrettyPrintableResponse]);
  const responseBodySaveText = useMemo(() => {
    if (!responseDisplayBody) return '';
    if (isPrettyPrintableResponse && prettyPrintResponse) {
      return responsePrettyBody;
    }
    return responseDisplayBody;
  }, [responseDisplayBody, responseContentType, prettyPrintResponse, responsePrettyBody, isPrettyPrintableResponse]);
  const prismLanguage = useMemo(() => {
    if (!prettyPrintResponse) return null;
    if (isJsonContent(responseContentType)) return 'json';
    if (isHtmlResponse) return 'markup';
    return null;
  }, [prettyPrintResponse, responseContentType, isHtmlResponse]);
  const prismHtml = useMemo(() => {
    if (!prismLanguage) return '';
    const language = Prism.languages[prismLanguage] || Prism.languages.markup;
    return Prism.highlight(responseBodyText, language, prismLanguage);
  }, [prismLanguage, responseBodyText]);

  const handleSaveResponseBody = () => {
    if (!selected?.responseBody) return;
    const api = window.electronAPI;
    if (!api?.saveResponseBody) return;
    const extension = isJsonContent(responseContentType) ? 'json' : isHtmlResponse ? 'html' : 'txt';
    api.saveResponseBody({
      body: responseBodySaveText,
      defaultPath: `response-body.${extension}`,
    });
  };
  const performanceData = useMemo(() => {
    if (!selected) return null;
    const responseHeaders = selected.responseHeaders || {};
    const requestHeaders = selected.requestHeaders || {};
    const requestContentLength = parseContentLength(requestHeaders);
    const responseContentLength = parseContentLength(responseHeaders);
    const responseSize =
      typeof selected.responseBodySize === 'number'
        ? selected.responseBodySize
        : selected.responseBody
          ? selected.responseBody.length
          : null;
    const responseDecodedSize =
      typeof selected.responseDecodedSize === 'number' ? selected.responseDecodedSize : null;
    const requestSize =
      typeof selected.requestBodySize === 'number'
        ? selected.requestBodySize
        : selected.requestBody
          ? selected.requestBody.length
          : null;
    const requestDecodedSize =
      typeof selected.requestDecodedSize === 'number' ? selected.requestDecodedSize : null;
    const requestSizeValue =
      requestSize && requestSize > 0 ? requestSize : requestContentLength ?? requestSize;
    const responseSizeValue =
      responseSize && responseSize > 0 ? responseSize : responseContentLength ?? responseSize;
    const requestSizeSource =
      requestSize && requestSize > 0 ? 'captured' : requestContentLength ? 'content-length' : '';
    const responseSizeSource =
      responseSize && responseSize > 0 ? 'captured' : responseContentLength ? 'content-length' : '';
    const responseEncoding = selected.responseEncoding || getHeaderValue(responseHeaders, 'content-encoding');
    const requestEncoding = selected.requestEncoding || getHeaderValue(requestHeaders, 'content-encoding');
    const contentType = getHeaderValue(responseHeaders, 'content-type');
    const compressionRatio =
      responseDecodedSize && responseSizeValue ? responseDecodedSize / responseSizeValue : null;
    const compressionSummary = responseEncoding
      ? `${responseEncoding}${compressionRatio ? ` (${compressionRatio.toFixed(2)}x)` : ''}`
      : 'None';
    const potentialCompression = responseEncoding
      ? 'N/A (already compressed)'
      : responseSizeValue && responseSizeValue > 1024 && isCompressibleType(contentType)
        ? 'Likely'
        : 'Low';
    return {
      capturedAt: selected.timestamp ? new Date(selected.timestamp).toLocaleString() : '—',
      durationMs: selected.durationMs,
      requestSize: requestSizeValue,
      requestSizeSource,
      requestDecodedSize,
      requestEncoding: requestEncoding || 'None',
      responseSize: responseSizeValue,
      responseSizeSource,
      responseDecodedSize,
      responseEncoding: responseEncoding || 'None',
      compressionSummary,
      potentialCompression,
      cacheable: summarizeCacheability(responseHeaders),
      cacheControl: getHeaderValue(responseHeaders, 'cache-control') || '—',
      expires: getHeaderValue(responseHeaders, 'expires') || '—',
      etag: getHeaderValue(responseHeaders, 'etag') || '—',
      lastModified: getHeaderValue(responseHeaders, 'last-modified') || '—',
      age: getHeaderValue(responseHeaders, 'age') || '—',
      contentType: contentType || '—',
    };
  }, [selected]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <img className="brand-logo" src={logo} alt="Hermes Proxy logo" />
        <button
          className={`nav-item ${activeTab === 'intercept' ? 'active' : ''}`}
          onClick={() => setActiveTab('intercept')}
        >
          <span className="icon" aria-hidden="true">
            <i className="fa-solid fa-satellite-dish"></i>
          </span>
          <span className="label">Intercept</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'setup' ? 'active' : ''}`}
          onClick={() => setActiveTab('setup')}
        >
          <span className="icon" aria-hidden="true">
            <i className="fa-solid fa-gear"></i>
          </span>
          <span className="label">Setup</span>
        </button>
        <button
          className={`nav-item ${activeTab === 'rules' ? 'active' : ''}`}
          onClick={() => setActiveTab('rules')}
        >
          <span className="icon" aria-hidden="true">
            <i className="fa-solid fa-arrow-down-1-9"></i>
          </span>
          <span className="label">Rules</span>
        </button>
      </aside>

      {activeTab === 'intercept' && (
        <div className="app intercept">
          <div
            className={`intercept-grid ${isResizing ? 'resizing' : ''}`}
            ref={splitRef}
            style={{ gridTemplateColumns: `${splitPercent}% 8px minmax(0, 1fr)` }}
          >
            <section className="panel traffic-panel">
              <div className="header">
                <h1>Traffic</h1>
                <span className="status-pill">Listening on :{proxyPort}</span>
              </div>
              <div className="table-wrapper" ref={tableRef} onScroll={handleTableScroll}>
                <table>
                  <thead>
                    <tr>
                      <th>Method</th>
                      <th>Status</th>
                      <th>Host</th>
                      <th>Path</th>
                      <th>Query</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredEntries.length === 0 && (
                      <tr>
                        <td colSpan="5" className="empty">
                          {entries.length === 0 ? 'Waiting for traffic…' : 'No matches for this filter.'}
                        </td>
                      </tr>
                    )}
                    {filteredEntries.map((entry) => (
                      <tr
                        key={entry.id}
                        className={selectedId === entry.id ? 'selected' : ''}
                        onClick={() => setSelectedId(entry.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          window.electronAPI?.showTrafficContextMenu?.(entry.id);
                        }}
                      >
                        <td>
                          <span className="pill method">{entry.method}</span>
                        </td>
                        <td>
                          <span className={`pill ${statusTone(entry.status)}`}>{entry.status ?? '—'}</span>
                        </td>
                        <td>{entry.host}</td>
                        <td>{entry.path}</td>
                        <td>{entry.query || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <div
              className="splitter"
              onMouseDown={handleSplitterMouseDown}
              role="separator"
              aria-label="Resize panels"
              aria-orientation="vertical"
            />

            <div className="detail-column">
              {!selected && <div className="empty">Select a request to see details.</div>}
              {selected && (
                <div className="details-grid">
                  <div className="detail-section">
                    <div className="detail-header-row">
                      <button
                        className="detail-header"
                        onClick={() => setRequestCollapsed((v) => !v)}
                        type="button"
                      >
                        <span className="icon">
                          <i className={`fa-solid fa-caret-${requestCollapsed ? 'right' : 'down'}`}></i>
                        </span>
                        <div className="detail-title">
                          <div className="detail-kicker">REQUEST</div>
                          <div className="detail-line">{requestLine}</div>
                        </div>
                      </button>
                      <button
                        className="icon-btn repeat-btn"
                        type="button"
                        aria-label="Repeat request"
                        onClick={handleRepeatRequest}
                      >
                        <i className="fa-solid fa-repeat"></i>
                      </button>
                    </div>
                    {!requestCollapsed && (
                      <div className="detail-body request-body">
                        <div className="plain-field" aria-label="Request method">
                          <div className="kv-title">METHOD</div>
                          <div className="plain-text">{selected.method}</div>
                        </div>
                        <div className="plain-field" aria-label="Request url">
                          <div className="kv-title">URL</div>
                          <input
                            className="plain-input"
                            type="text"
                            value={requestUrlDraft}
                            onChange={(event) => setRequestUrlDraft(event.target.value)}
                          />
                        </div>
                        <div className="plain-field" aria-label="Request headers">
                          <div className="kv-title">HEADERS</div>
                          <div className="headers-grid">
                            {requestHeadersDraft.length === 0 && <div className="empty">No headers</div>}
                            {requestHeadersDraft.map((header, index) => (
                              <div className="headers-row" key={`${header.name}-${index}`}>
                                <input
                                  className="header-input header-name-input"
                                  type="text"
                                  value={header.name}
                                  onChange={(event) => {
                                    const next = [...requestHeadersDraft];
                                    next[index] = { ...next[index], name: event.target.value };
                                    setRequestHeadersDraft(next);
                                  }}
                                />
                                <textarea
                                  className="header-input header-value-input"
                                  rows={1}
                                  value={header.value}
                                  onChange={(event) => handleHeaderValueChange(event, index)}
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                        {requestDisplayBody && requestDisplayBody.length > 0 && (
                          <div className="plain-field" aria-label="Request body">
                            <div className="kv-title">BODY</div>
                            <pre className="plain-pre">{bufferPreview(requestDisplayBody)}</pre>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="detail-section">
                    <button
                      className="detail-header"
                      onClick={() => setResponseCollapsed((v) => !v)}
                      type="button"
                    >
                      <span className="icon">
                        <i className={`fa-solid fa-caret-${responseCollapsed ? 'right' : 'down'}`}></i>
                      </span>
                      <div className="detail-title">
                        <div className="detail-kicker">RESPONSE</div>
                        <div className="detail-line">{responseLine}</div>
                        {selected.error && <div className="detail-sub error">Error: {selected.error}</div>}
                      </div>
                    </button>
                    {!responseCollapsed && (
                      <div className="detail-body request-body">
                        <div className="plain-field" aria-label="Response status">
                          <div className="kv-title">STATUS</div>
                          <div className="plain-text">{selected.status ?? '—'}</div>
                        </div>
                        <div className="plain-field" aria-label="Response headers">
                          <div className="kv-title">HEADERS</div>
                          <div className="headers-grid">
                            {headersToList(selected.responseHeaders).length === 0 && (
                              <div className="empty">No headers</div>
                            )}
                            {headersToList(selected.responseHeaders).map(([key, value]) => (
                              <div className="headers-row" key={key}>
                                <div className="header-name header-cell">{key}</div>
                                <div className="header-value header-cell">{String(value)}</div>
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                  {selected.responseBody && selected.responseBody.length > 0 && (
                    <div className="detail-section">
                      <button
                        className="detail-header"
                        onClick={() => setResponseBodyCollapsed((v) => !v)}
                        type="button"
                      >
                        <span className="icon" aria-hidden="true">
                          <i className={`fa-solid fa-caret-${responseBodyCollapsed ? 'right' : 'down'}`}></i>
                        </span>
                        <div className="detail-title">
                          <div className="detail-kicker">RESPONSE BODY</div>
                          <div className="detail-line">Payload</div>
                        </div>
                      </button>
                      {!responseBodyCollapsed && (
                        <div className="detail-body" aria-label="Response body">
                          <div className="plain-field">
                            <div className="kv-title kv-title-row">
                              <span>BODY</span>
                              <div className="kv-actions">
                                {isPrettyPrintableResponse && (
                                  <label className="toggle-field">
                                    <input
                                      type="checkbox"
                                      checked={prettyPrintResponse}
                                      onChange={(e) => setPrettyPrintResponse(e.target.checked)}
                                    />
                                    Pretty print
                                  </label>
                                )}
                                <button
                                  type="button"
                                  className="icon-btn"
                                  onClick={handleSaveResponseBody}
                                  title="Save this body as file"
                                  aria-label="Save this body as file"
                                >
                                  <i className="fa-solid fa-download"></i>
                                </button>
                              </div>
                            </div>
                            {prismLanguage ? (
                              <pre className={`plain-pre code-view prism-code language-${prismLanguage}`}>
                                <code dangerouslySetInnerHTML={{ __html: prismHtml || ' ' }} />
                              </pre>
                            ) : (
                              <pre className="plain-pre code-view">{responseBodyText}</pre>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                  <div className="detail-section">
                    <button
                      className="detail-header"
                      onClick={() => setPerformanceCollapsed((v) => !v)}
                      type="button"
                    >
                      <span className="icon" aria-hidden="true">
                        <i className={`fa-solid fa-caret-${performanceCollapsed ? 'right' : 'down'}`}></i>
                      </span>
                      <div className="detail-title">
                        <div className="detail-kicker">PERFORMANCE</div>
                        <div className="detail-line">Performance overview</div>
                      </div>
                    </button>
                    {!performanceCollapsed && (
                      <div className="detail-body performance-view" aria-label="Performance overview">
                        {performanceData && (
                          <div className="performance-metrics">
                            <div className="metric-row">
                              <div className="metric-label">Captured</div>
                              <div className="metric-value">{performanceData.capturedAt}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Duration</div>
                              <div className="metric-value">{formatMs(performanceData.durationMs)}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Request Size</div>
                              <div className="metric-value">
                                {formatBytes(performanceData.requestSize)}
                                {performanceData.requestDecodedSize
                                  ? ` (decoded ${formatBytes(performanceData.requestDecodedSize)})`
                                  : ''}
                                {performanceData.requestSizeSource ? ` (${performanceData.requestSizeSource})` : ''}
                              </div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Response Size</div>
                              <div className="metric-value">
                                {formatBytes(performanceData.responseSize)}
                                {performanceData.responseDecodedSize
                                  ? ` (decoded ${formatBytes(performanceData.responseDecodedSize)})`
                                  : ''}
                                {performanceData.responseSizeSource ? ` (${performanceData.responseSizeSource})` : ''}
                              </div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Encoding</div>
                              <div className="metric-value">
                                Req {performanceData.requestEncoding} · Res {performanceData.responseEncoding}
                              </div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Compression</div>
                              <div className="metric-value">
                                {performanceData.compressionSummary} · Potential {performanceData.potentialCompression}
                              </div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Cacheable</div>
                              <div className="metric-value">{performanceData.cacheable}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Cache-Control</div>
                              <div className="metric-value">{performanceData.cacheControl}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">ETag</div>
                              <div className="metric-value">{performanceData.etag}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Last-Modified</div>
                              <div className="metric-value">{performanceData.lastModified}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Expires</div>
                              <div className="metric-value">{performanceData.expires}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Age</div>
                              <div className="metric-value">{performanceData.age}</div>
                            </div>
                            <div className="metric-row">
                              <div className="metric-label">Content-Type</div>
                              <div className="metric-value">{performanceData.contentType}</div>
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
          <div className="bottom-menu">
            <div className="filter-row">
              <input
                className="filter-input"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
                placeholder="Filter by method, host, headers, status..."
              />
              <button
                className="icon-btn"
                type="button"
                aria-label="Export all traffic as HAR"
                title="Export all traffic as HAR"
                onClick={handleExportAllHar}
              >
                <i className="fa-solid fa-save"></i>
              </button>
              <button
                className="icon-btn"
                type="button"
                aria-label="Import HAR file"
                title="Import traffic from a HAR file"
                onClick={handleImportHar}
              >
                <i className="fa-solid fa-folder-open"></i>
              </button>
              <button
                className="icon-btn"
                type="button"
                aria-label="Clear traffic"
                title="Clear all traffic"
                onClick={handleClearTraffic}
              >
                <i className="fa-solid fa-trash"></i>
              </button>
            </div>
          </div>
        </div>
      )}

      {activeTab === 'setup' && (
        <div className="app single">
          <section className="panel">
            <div className="header">
              <h1>Setup</h1>
              <span className="status-pill">HTTPS intercept</span>
            </div>
            <div className="setup-text">
              <p>
                <strong>1. Send traffic via Hermes Proxy</strong>
                <br />
                To intercept an HTTP client on this machine, configure it to send traffic via{' '}
                <code>{`http://localhost:${proxyPort}`}</code>.
              </p>
              <p>
                Most tools can be configured to do so by using the above address as an HTTP or HTTPS proxy. You can also
                forcibly reroute traffic using networking tools like <code>iptables</code>.
              </p>
              <p>Remote clients (e.g. phones) should use this machine&apos;s IP address instead of localhost.</p>
              <p>
                <strong>2. Trust the certificate authority</strong>
                <br />
                Only required to intercept traffic that uses HTTPS.
              </p>
              <p>
                Hermes Proxy generated a certificate authority (CA) on your machine. All intercepted HTTPS uses
                certificates signed by this CA.
              </p>
              <p>
                <button
                  className="export-btn"
                  onClick={() => window.electronAPI?.exportCaCertificate?.()}
                  disabled={!caPath}
                  title={caPath || 'Still generating CA'}
                >
                  Export CA certificate
                </button>
              </p>
              <p>
                To intercept HTTPS traffic you need to configure your HTTP client to trust this certificate as a
                certificate authority, or temporarily disable certificate checks.
              </p>
              {caPath && (
                <div className="hint">
                  CA location: <code>{caPath}</code>
                </div>
              )}
            </div>
          </section>
        </div>
      )}

      {activeTab === 'rules' && (
        <div className="app single">
          <section className="panel">
            <div className="header">
              <h1>Rules</h1>
              <div className="header-actions">
                <button className="export-btn" type="button" onClick={handleAddRule}>
                  Add rule
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  title="Save rules to file"
                  aria-label="Save rules"
                  onClick={handleSaveRules}
                >
                  <i className="fa-solid fa-save"></i>
                </button>
                <button
                  className="icon-btn"
                  type="button"
                  title="Load rules from file"
                  aria-label="Load rules"
                  onClick={handleLoadRules}
                >
                  <i className="fa-solid fa-folder-open"></i>
                </button>
              </div>
            </div>
            <div className="rules-list">
              {rules.length === 0 && <div className="empty">No rules yet.</div>}
              {rules.map((rule, index) => (
                <div className="rule-card" key={rule.id}>
                  <div className="rule-header">
                    <input
                      className="rule-name"
                      type="text"
                      value={rule.name}
                      onChange={(event) =>
                        handleUpdateRule(index, (current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                    />
                    <label className="rule-toggle">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        onChange={(event) =>
                          handleUpdateRule(index, (current) => ({
                            ...current,
                            enabled: event.target.checked,
                          }))
                        }
                      />
                      Enabled
                    </label>
                    <button
                      className="icon-btn"
                      type="button"
                      aria-label="Remove rule"
                      title="Remove rule"
                      onClick={() => handleRemoveRule(index)}
                    >
                      <i className="fa-solid fa-xmark"></i>
                    </button>
                  </div>
                  <div className="rule-section">
                    <div className="kv-title">MATCH</div>
                    <div className="rule-grid">
                      <label className="rule-field">
                        <span>Methods</span>
                        <select
                          className="rule-methods-select"
                          value={rule.match.methods[0] || '*'}
                          onChange={(event) => {
                            const methods = [event.target.value.toUpperCase()];
                            handleUpdateRule(index, (current) => ({
                              ...current,
                              match: { ...current.match, methods },
                            }));
                          }}
                        >
                          {HTTP_METHODS.map((method) => (
                            <option value={method} key={method}>
                              {method}
                            </option>
                          ))}
                        </select>
                      </label>
                      <label className="rule-field">
                        <span>Hosts</span>
                        <input
                          type="text"
                          value={rule.match.hosts.join(', ')}
                          onChange={(event) => {
                            const hosts = parseListInput(event.target.value);
                            handleUpdateRule(index, (current) => ({
                              ...current,
                              match: { ...current.match, hosts },
                            }));
                          }}
                          placeholder="api.example.com"
                        />
                      </label>
                      <label className="rule-field">
                        <span>URL contains</span>
                        <input
                          type="text"
                          value={rule.match.urls.join(', ')}
                          onChange={(event) => {
                            const urls = parseListInput(event.target.value);
                            handleUpdateRule(index, (current) => ({
                              ...current,
                              match: { ...current.match, urls },
                            }));
                          }}
                          placeholder="/v1/orders"
                        />
                      </label>
                    </div>
                    <div className="rule-subsection">
                      <div className="rule-subheader">
                        <span>Header matchers</span>
                        <button
                          className="icon-btn rule-add-btn"
                          type="button"
                          aria-label="Add header matcher"
                          title="Add header matcher"
                          onClick={() =>
                            handleUpdateRule(index, (current) => ({
                              ...current,
                              match: {
                                ...current.match,
                                headers: [...current.match.headers, { name: '', value: '' }],
                              },
                            }))
                          }
                        >
                          <i className="fa-solid fa-plus"></i>
                        </button>
                      </div>
                      {rule.match.headers.length === 0 && <div className="empty">No header matchers</div>}
                      {rule.match.headers.map((matcher, matcherIndex) => (
                        <div className="headers-row rule-headers-row" key={`matcher-${matcherIndex}`}>
                          <input
                            className="header-input header-name-input"
                            type="text"
                            value={matcher.name}
                            placeholder="Header name"
                            onChange={(event) => {
                              const headers = [...rule.match.headers];
                              headers[matcherIndex] = { ...headers[matcherIndex], name: event.target.value };
                              handleUpdateRule(index, (current) => ({
                                ...current,
                                match: { ...current.match, headers },
                              }));
                            }}
                          />
                          <input
                            className="header-input header-value-input"
                            type="text"
                            value={matcher.value}
                            placeholder="Header value"
                            onChange={(event) => {
                              const headers = [...rule.match.headers];
                              headers[matcherIndex] = { ...headers[matcherIndex], value: event.target.value };
                              handleUpdateRule(index, (current) => ({
                                ...current,
                                match: { ...current.match, headers },
                              }));
                            }}
                          />
                          <button
                            className="icon-btn"
                            type="button"
                            aria-label="Remove header matcher"
                            title="Remove header matcher"
                            onClick={() => {
                              const headers = rule.match.headers.filter((_, idx) => idx !== matcherIndex);
                              handleUpdateRule(index, (current) => ({
                                ...current,
                                match: { ...current.match, headers },
                              }));
                            }}
                          >
                            <i className="fa-solid fa-xmark"></i>
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="rule-section">
                    <div className="rule-section-header">
                      <div className="kv-title">ACTIONS</div>
                      <label className="rule-action-label">
                        <select
                          className="rule-action-select"
                          value={rule.actions.type}
                          onChange={(event) => {
                            const type = event.target.value;
                            handleUpdateRule(index, (current) => ({
                              ...current,
                              actions: {
                                ...current.actions,
                                type,
                                delayMs: type === 'delay' ? current.actions.delayMs : 0,
                                overrideHeaders: type === 'overrideHeaders' ? current.actions.overrideHeaders : [],
                              },
                            }));
                          }}
                        >
                          <option value="none">None</option>
                          <option value="delay">Wait before continuing</option>
                          <option value="overrideHeaders">Override headers</option>
                          <option value="close">Close the connection</option>
                        </select>
                      </label>
                    </div>
                    <div className="rule-grid">
                      {rule.actions.type === 'delay' && (
                        <label className="rule-field">
                          <span>Wait (ms)</span>
                          <input
                            type="number"
                            min="0"
                            value={rule.actions.delayMs}
                            onChange={(event) => {
                              const delayMs = Number(event.target.value || 0);
                              handleUpdateRule(index, (current) => ({
                                ...current,
                                actions: { ...current.actions, delayMs },
                              }));
                            }}
                          />
                        </label>
                      )}
                    </div>
                    {rule.actions.type === 'overrideHeaders' && (
                      <div className="rule-subsection">
                        <div className="rule-subheader">
                          <span>Override headers</span>
                          <button
                            className="icon-btn rule-add-btn"
                            type="button"
                            aria-label="Add override header"
                            title="Add override header"
                            onClick={() =>
                              handleUpdateRule(index, (current) => ({
                                ...current,
                                actions: {
                                  ...current.actions,
                                  overrideHeaders: [...current.actions.overrideHeaders, { name: '', value: '' }],
                                },
                              }))
                            }
                          >
                            <i className="fa-solid fa-plus"></i>
                          </button>
                        </div>
                        {rule.actions.overrideHeaders.length === 0 && <div className="empty">No overrides</div>}
                        {rule.actions.overrideHeaders.map((override, overrideIndex) => (
                          <div className="headers-row rule-headers-row" key={`override-${overrideIndex}`}>
                            <input
                              className="header-input header-name-input"
                              type="text"
                              value={override.name}
                              placeholder="Header name"
                              onChange={(event) => {
                                const overrides = [...rule.actions.overrideHeaders];
                                overrides[overrideIndex] = { ...overrides[overrideIndex], name: event.target.value };
                                handleUpdateRule(index, (current) => ({
                                  ...current,
                                  actions: { ...current.actions, overrideHeaders: overrides },
                                }));
                              }}
                            />
                            <input
                              className="header-input header-value-input"
                              type="text"
                              value={override.value}
                              placeholder="Header value"
                              onChange={(event) => {
                                const overrides = [...rule.actions.overrideHeaders];
                                overrides[overrideIndex] = { ...overrides[overrideIndex], value: event.target.value };
                                handleUpdateRule(index, (current) => ({
                                  ...current,
                                  actions: { ...current.actions, overrideHeaders: overrides },
                                }));
                              }}
                            />
                            <button
                              className="icon-btn"
                              type="button"
                              aria-label="Remove override header"
                              title="Remove override header"
                              onClick={() => {
                                const overrides = rule.actions.overrideHeaders.filter((_, idx) => idx !== overrideIndex);
                                handleUpdateRule(index, (current) => ({
                                  ...current,
                                  actions: { ...current.actions, overrideHeaders: overrides },
                                }));
                              }}
                            >
                              <i className="fa-solid fa-xmark"></i>
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

export default App;
