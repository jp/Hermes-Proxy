import React, { useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
import Prism from 'prismjs';
import 'prismjs/components/prism-json';
import 'prismjs/components/prism-markup';
import InterceptView from './features/traffic/InterceptView';
import RulesView from './features/rules/RulesView';
import SetupView from './features/setup/SetupView';
import Sidebar from './features/sidebar/Sidebar';
import { tryPrettyJson, prettyPrintHtml } from './utils/body';
import { bufferPreview } from './utils/format';
import { resizeTextarea } from './utils/dom';
import {
  buildEntryUrl,
  getHeaderValue,
  headersToList,
  headersToText,
  isCompressibleType,
  isHtmlContent,
  isJsonContent,
  isLikelyHtmlBody,
  parseContentLength,
  parseQueryParams,
  summarizeCacheability,
} from './utils/http';
import { createRule } from './utils/rules';
import type { PerformanceData, ProxyEntry, RequestHeaderDraft, Rule } from './types';

const MAX_ENTRIES = 20000;

function App() {
  const [entries, setEntries] = useState<ProxyEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [caPath, setCaPath] = useState('');
  const [activeTab, setActiveTab] = useState('intercept');
  const [autoScroll, setAutoScroll] = useState(true);
  const [requestCollapsed, setRequestCollapsed] = useState(false);
  const [responseCollapsed, setResponseCollapsed] = useState(false);
  const [requestView, setRequestView] = useState<'headers' | 'query' | 'body' | 'raw' | 'summary'>('headers');
  const [responseView, setResponseView] = useState<'headers' | 'query' | 'body' | 'raw' | 'summary'>('headers');
  const [filterText, setFilterText] = useState('');
  const [prettyPrintResponse, setPrettyPrintResponse] = useState(true);
  const [requestUrlDraft, setRequestUrlDraft] = useState('');
  const [requestHeadersDraft, setRequestHeadersDraft] = useState<RequestHeaderDraft[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [proxyPort, setProxyPort] = useState(8000);
  const [splitPercent, setSplitPercent] = useState(55);
  const [isResizing, setIsResizing] = useState(false);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; containerWidth: number } | null>(null);
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
  }, [selectedId]);

  useEffect(() => {
    if (!isResizing) return;
    const onMove = (event: MouseEvent) => {
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

  const handleSplitterMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
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

  const handleHeaderNameChange = (index: number, value: string) => {
    const next = [...requestHeadersDraft];
    next[index] = { ...next[index], name: value };
    setRequestHeadersDraft(next);
  };

  const handleHeaderValueChange = (index: number, value: string, element: HTMLTextAreaElement) => {
    const next = [...requestHeadersDraft];
    next[index] = { ...next[index], value };
    setRequestHeadersDraft(next);
    resizeTextarea(element);
  };

  const selected = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  useEffect(() => {
    document
      .querySelectorAll('.header-value-input')
      .forEach((el) => resizeTextarea(el as HTMLTextAreaElement));
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
  const requestTarget = useMemo(() => {
    if (!selected) return '';
    return `${selected.path}${selected.query || ''}`;
  }, [selected]);
  const responseLine = useMemo(() => {
    if (!selected) return '';
    const prefix = selected.responseHttpVersion || 'HTTP/1.1';
    return `${prefix} ${selected.status ?? '—'}`;
  }, [selected]);
  const requestQueryEntries = useMemo(() => {
    if (!selected) return [];
    return parseQueryParams(selected.query || '');
  }, [selected]);
  const responseContentType = useMemo(() => {
    if (!selected) return '';
    return getHeaderValue(selected.responseHeaders || {}, 'content-type');
  }, [selected]);
  const requestContentType = useMemo(() => {
    if (!selected) return '';
    return getHeaderValue(selected.requestHeaders || {}, 'content-type');
  }, [selected]);
  const isHtmlResponse = useMemo(() => {
    if (!selected?.responseBody) return false;
    return isHtmlContent(responseContentType) || isLikelyHtmlBody(selected.responseBody);
  }, [selected, responseContentType]);
  const isHtmlRequest = useMemo(() => {
    if (!selected?.requestBody) return false;
    return isHtmlContent(requestContentType) || isLikelyHtmlBody(selected.requestBody);
  }, [selected, requestContentType]);
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
  const isPrettyPrintableRequest = useMemo(() => {
    if (!selected?.requestBody) return false;
    if (isJsonContent(requestContentType)) return true;
    if (isHtmlRequest) return true;
    return Boolean(tryPrettyJson(requestDisplayBody));
  }, [selected, requestContentType, isHtmlRequest, requestDisplayBody]);
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
  const requestPrettyBody = useMemo(() => {
    if (!requestDisplayBody) return '';
    const prettyJson = tryPrettyJson(requestDisplayBody);
    if (isJsonContent(requestContentType) || prettyJson) {
      return prettyJson ?? requestDisplayBody;
    }
    if (isHtmlRequest) {
      return prettyPrintHtml(requestDisplayBody);
    }
    return requestDisplayBody;
  }, [requestDisplayBody, requestContentType, isHtmlRequest]);
  const responseBodyText = useMemo(() => {
    if (isPrettyPrintableResponse && prettyPrintResponse) {
      return responsePrettyBody;
    }
    return bufferPreview(responsePrettyBody);
  }, [responsePrettyBody, responseContentType, prettyPrintResponse, isPrettyPrintableResponse]);
  const requestBodyText = useMemo(() => {
    if (isPrettyPrintableRequest) {
      return requestPrettyBody;
    }
    return bufferPreview(requestPrettyBody);
  }, [requestPrettyBody, isPrettyPrintableRequest]);
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
  const requestRawText = useMemo(() => {
    if (!selected) return '';
    const version = selected.requestHttpVersion || 'HTTP/1.1';
    const startLine = `${selected.method} ${requestTarget || '/'} ${version}`;
    const headerText = headersToText(selected.requestHeaders || {});
    const segments = [startLine, headerText];
    if (requestDisplayBody) {
      segments.push('', requestDisplayBody);
    }
    return segments.filter((segment) => segment !== '').join('\n');
  }, [selected, requestTarget, requestDisplayBody]);
  const responseRawText = useMemo(() => {
    if (!selected) return '';
    const version = selected.responseHttpVersion || 'HTTP/1.1';
    const startLine = `${version} ${selected.status ?? '—'}`;
    const headerText = headersToText(selected.responseHeaders || {});
    const segments = [startLine, headerText];
    if (responseDisplayBody) {
      segments.push('', responseDisplayBody);
    }
    return segments.filter((segment) => segment !== '').join('\n');
  }, [selected, responseDisplayBody]);
  const requestSummaryItems = useMemo(() => {
    if (!selected) return [];
    return [
      { label: 'Method', value: selected.method },
      { label: 'Host', value: selected.host },
      { label: 'Path', value: requestTarget || '/' },
      { label: 'Query', value: requestQueryEntries.length ? `${requestQueryEntries.length} params` : 'None' },
      {
        label: 'Headers',
        value: selected.requestHeaders ? `${Object.keys(selected.requestHeaders).length} headers` : '0 headers',
      },
      { label: 'Body', value: selected.requestBody ? `${selected.requestBody.length} bytes` : '—' },
    ];
  }, [selected, requestTarget, requestQueryEntries]);

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
  const performanceData = useMemo<PerformanceData | null>(() => {
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
  const responseSummaryItems = useMemo(() => {
    if (!selected) return [];
    return [
      { label: 'Status', value: String(selected.status ?? '—') },
      { label: 'Duration', value: performanceData ? `${performanceData.durationMs ?? '—'} ms` : '—' },
      { label: 'Size', value: performanceData?.responseSize ? `${performanceData.responseSize} bytes` : '—' },
      { label: 'Encoding', value: performanceData?.responseEncoding ?? 'None' },
      { label: 'Cacheable', value: performanceData?.cacheable ?? '—' },
    ];
  }, [selected, performanceData]);

  return (
    <div className="shell">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'intercept' && (
        <InterceptView
          entries={entries}
          filteredEntries={filteredEntries}
          selected={selected}
          selectedId={selectedId}
          onSelectEntry={setSelectedId}
          onShowContextMenu={(entryId) => window.electronAPI?.showTrafficContextMenu?.(entryId)}
          proxyPort={proxyPort}
          isResizing={isResizing}
          splitPercent={splitPercent}
          splitRef={splitRef}
          tableRef={tableRef}
          onTableScroll={handleTableScroll}
          onSplitterMouseDown={handleSplitterMouseDown}
          requestCollapsed={requestCollapsed}
          responseCollapsed={responseCollapsed}
          onToggleRequest={() => setRequestCollapsed((v) => !v)}
          onToggleResponse={() => setResponseCollapsed((v) => !v)}
          requestView={requestView}
          responseView={responseView}
          onRequestViewChange={setRequestView}
          onResponseViewChange={setResponseView}
          requestLine={requestLine}
          responseLine={responseLine}
          requestUrlDraft={requestUrlDraft}
          onRequestUrlChange={setRequestUrlDraft}
          requestHeadersDraft={requestHeadersDraft}
          onRequestHeaderNameChange={handleHeaderNameChange}
          onRequestHeaderValueChange={handleHeaderValueChange}
          requestDisplayBody={requestDisplayBody}
          requestBodyText={requestBodyText}
          responseBodyText={responseBodyText}
          prismLanguage={prismLanguage}
          prismHtml={prismHtml}
          isPrettyPrintableResponse={isPrettyPrintableResponse}
          prettyPrintResponse={prettyPrintResponse}
          onPrettyPrintResponseChange={setPrettyPrintResponse}
          onSaveResponseBody={handleSaveResponseBody}
          requestQueryEntries={requestQueryEntries}
          requestRawText={requestRawText}
          responseRawText={responseRawText}
          requestSummaryItems={requestSummaryItems}
          responseSummaryItems={responseSummaryItems}
          filterText={filterText}
          onFilterTextChange={setFilterText}
          onExportAllHar={handleExportAllHar}
          onImportHar={handleImportHar}
          onClearTraffic={handleClearTraffic}
          onRepeatRequest={handleRepeatRequest}
          onOpenRequestEditor={() => {
            if (!selected) return;
            window.electronAPI?.openRequestEditor?.(selected.id);
          }}
        />
      )}

      {activeTab === 'setup' && (
        <SetupView
          proxyPort={proxyPort}
          caPath={caPath}
          onExportCa={() => window.electronAPI?.exportCaCertificate?.()}
        />
      )}

      {activeTab === 'rules' && (
        <RulesView
          rules={rules}
          onAddRule={handleAddRule}
          onUpdateRule={handleUpdateRule}
          onRemoveRule={handleRemoveRule}
          onSaveRules={handleSaveRules}
          onLoadRules={handleLoadRules}
        />
      )}
    </div>
  );
}

export default App;
