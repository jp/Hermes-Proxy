import React, { useCallback, useEffect, useMemo, useRef, useState, useLayoutEffect } from 'react';
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
import type { CaCertificateDetails, PerformanceData, ProxyEntry, ProxySettings, RequestHeaderDraft, Rule } from './types';

const MAX_ENTRIES = 20000;

function App() {
  const [entries, setEntries] = useState<ProxyEntry[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const lastSelectedIdRef = useRef<string | null>(null);
  const [caPath, setCaPath] = useState('');
  const [caDetails, setCaDetails] = useState<CaCertificateDetails | null>(null);
  const [activeTab, setActiveTab] = useState('intercept');
  const [autoScroll, setAutoScroll] = useState(true);
  const [requestCollapsed, setRequestCollapsed] = useState(false);
  const [responseCollapsed, setResponseCollapsed] = useState(false);
  const [requestView, setRequestView] = useState<'headers' | 'query' | 'body' | 'raw' | 'summary' | 'chart'>(
    'headers'
  );
  const [responseView, setResponseView] = useState<'headers' | 'body' | 'raw' | 'summary' | 'messages'>('headers');
  const [filterText, setFilterText] = useState('');
  const [prettyPrintResponse, setPrettyPrintResponse] = useState(true);
  const [requestUrlDraft, setRequestUrlDraft] = useState('');
  const [requestHeadersDraft, setRequestHeadersDraft] = useState<RequestHeaderDraft[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [proxyHost, setProxyHost] = useState('localhost');
  const [proxyPort, setProxyPort] = useState(8000);
  const [listenOnAllInterfaces, setListenOnAllInterfaces] = useState(true);
  const [maxCaptureBodySizeMb, setMaxCaptureBodySizeMb] = useState(5);
  const [settingsBusy, setSettingsBusy] = useState(false);
  const [splitPercent, setSplitPercent] = useState(55);
  const [isResizing, setIsResizing] = useState(false);
  const tableRef = useRef<HTMLDivElement | null>(null);
  const splitRef = useRef<HTMLDivElement | null>(null);
  const resizeRef = useRef<{ startX: number; startWidth: number; containerWidth: number } | null>(null);
  const rulesReadyRef = useRef(false);
  const scrollTrafficEntryIntoView = useCallback((entryId: string) => {
    const maxAttempts = 6;
    const tryScroll = (attempt: number) => {
      const container = tableRef.current;
      if (!container) {
        if (attempt < maxAttempts) {
          window.requestAnimationFrame(() => tryScroll(attempt + 1));
        }
        return;
      }

      const row = Array.from(container.querySelectorAll<HTMLTableRowElement>('tbody tr[data-entry-id]')).find(
        (candidate) => candidate.dataset.entryId === entryId
      );
      if (!row) {
        if (attempt < maxAttempts) {
          window.requestAnimationFrame(() => tryScroll(attempt + 1));
        }
        return;
      }

      const rowTop = row.offsetTop;
      const rowBottom = rowTop + row.offsetHeight;
      const viewTop = container.scrollTop;
      const viewBottom = viewTop + container.clientHeight;
      if (rowTop >= viewTop && rowBottom <= viewBottom) return;

      const centeredTop = Math.max(0, rowTop - (container.clientHeight - row.offsetHeight) / 2);
      container.scrollTo({ top: centeredTop, behavior: 'smooth' });
    };

    tryScroll(0);
  }, []);
  const handleInspectEntry = useCallback((entryId: string) => {
    if (!entryId) return;
    setActiveTab('intercept');
    setSelectedIds([entryId]);
    setSelectedId(entryId);
    lastSelectedIdRef.current = entryId;
    setRequestCollapsed(false);
    setResponseCollapsed(false);
    scrollTrafficEntryIntoView(entryId);
  }, [scrollTrafficEntryIntoView]);

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
          const firstId = normalized[normalized.length - 1].id;
          setSelectedId(firstId);
          setSelectedIds([firstId]);
          lastSelectedIdRef.current = firstId;
        }
      });
    }

    if (api?.onProxyEntry) {
      cleanup = api.onProxyEntry((entry) => {
        setEntries((prev) => {
          const existingIndex = prev.findIndex((candidate) => candidate.id === entry.id);
          const next =
            existingIndex === -1
              ? [...prev, entry]
              : prev.map((candidate, index) => (index === existingIndex ? entry : candidate));
          if (existingIndex === -1) {
            setSelectedId((current) => current ?? entry.id);
            setSelectedIds((current) => (current.length ? current : [entry.id]));
            if (!lastSelectedIdRef.current) {
              lastSelectedIdRef.current = entry.id;
            }
          }
          return next.length > MAX_ENTRIES ? next.slice(next.length - MAX_ENTRIES) : next;
        });
      });
    }

    if (api?.onClearTraffic) {
      offClearTraffic = api.onClearTraffic(() => {
        setEntries([]);
        setSelectedId(null);
        setSelectedIds([]);
        lastSelectedIdRef.current = null;
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
  }, [handleInspectEntry]);

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
    let offEndpointReady;

    if (api?.getCaCertificate) {
      api.getCaCertificate().then((info) => {
        if (info?.caCertPath) {
          setCaPath(info.caCertPath);
        }
      });
    }
    if (api?.getCaCertificateDetails) {
      api.getCaCertificateDetails().then((details) => {
        setCaDetails(details || null);
      });
    }

    if (api?.getProxyPort) {
      api.getProxyPort().then((port) => {
        if (port) {
          setProxyPort(port);
        }
      });
    }
    if (api?.getProxyEndpoint) {
      api.getProxyEndpoint().then((endpoint) => {
        if (endpoint?.host) {
          setProxyHost(endpoint.host);
        }
        if (endpoint?.port) {
          setProxyPort(endpoint.port);
        }
      });
    }
    if (api?.getProxySettings) {
      api.getProxySettings().then((settings) => {
        if (typeof settings?.listenOnAllInterfaces === 'boolean') {
          setListenOnAllInterfaces(settings.listenOnAllInterfaces);
        }
        if (typeof settings?.maxCaptureBodySizeMb === 'number' && Number.isFinite(settings.maxCaptureBodySizeMb)) {
          setMaxCaptureBodySizeMb(settings.maxCaptureBodySizeMb);
        }
      });
    }

    if (api?.onCaReady) {
      offCaReady = api.onCaReady((path) => {
        setCaPath(path);
        api.getCaCertificateDetails?.().then((details) => {
          setCaDetails(details || null);
        });
      });
    }

    if (api?.onProxyPortReady) {
      offPortReady = api.onProxyPortReady((port) => {
        if (port) {
          setProxyPort(port);
        }
      });
    }
    if (api?.onProxyEndpointReady) {
      offEndpointReady = api.onProxyEndpointReady((endpoint) => {
        if (endpoint?.host) {
          setProxyHost(endpoint.host);
        }
        if (endpoint?.port) {
          setProxyPort(endpoint.port);
        }
      });
    }

    return () => {
      offCaReady?.();
      offPortReady?.();
      offEndpointReady?.();
    };
  }, []);

  const selected = useMemo(() => entries.find((e) => e.id === selectedId) ?? null, [entries, selectedId]);

  useEffect(() => {
    setRequestCollapsed(false);
    setResponseCollapsed(false);
    setResponseView((current) => {
      if (selected?.kind === 'websocket') {
        return current === 'body' ? 'messages' : current;
      }
      return current === 'messages' ? 'headers' : current;
    });
  }, [selectedId, selected?.kind]);

  useEffect(() => {
    setSelectedIds((prev) => {
      const entryIds = new Set(entries.map((entry) => entry.id));
      const next = prev.filter((id) => entryIds.has(id));
      return next;
    });
  }, [entries]);

  useEffect(() => {
    setSelectedId((prev) => {
      if (prev && selectedIds.includes(prev)) return prev;
      return selectedIds[0] ?? null;
    });
  }, [selectedIds]);

  useEffect(() => {
    if (selectedIds.length > 0 || entries.length === 0) return;
    const firstId = entries[0]?.id;
    if (!firstId) return;
    setSelectedIds([firstId]);
    setSelectedId(firstId);
    lastSelectedIdRef.current = firstId;
  }, [entries, selectedIds]);

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
    if (!selected || selected.kind === 'websocket') return;
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
    setSelectedIds([]);
    lastSelectedIdRef.current = null;
  };

  const handleSaveRules = async () => {
    await window.electronAPI?.saveRules?.();
  };

  const handleSelectEntry = (
    entryId: string,
    modifiers: { ctrl: boolean; shift: boolean; meta: boolean },
    orderedIds: string[],
  ) => {
    const hasToggle = modifiers.ctrl || modifiers.meta;
    setSelectedIds((prev) => {
      let next = prev.slice();
      if (modifiers.shift && orderedIds.length) {
        const anchor = lastSelectedIdRef.current ?? entryId;
        const startIndex = orderedIds.indexOf(anchor);
        const endIndex = orderedIds.indexOf(entryId);
        if (startIndex !== -1 && endIndex !== -1) {
          const [from, to] = startIndex < endIndex ? [startIndex, endIndex] : [endIndex, startIndex];
          const range = orderedIds.slice(from, to + 1);
          next = hasToggle ? Array.from(new Set([...next, ...range])) : range;
        } else {
          next = hasToggle
            ? next.includes(entryId)
              ? next.filter((id) => id !== entryId)
              : [...next, entryId]
            : [entryId];
        }
      } else if (hasToggle) {
        next = next.includes(entryId) ? next.filter((id) => id !== entryId) : [...next, entryId];
      } else {
        next = [entryId];
      }

      if (next.length === 0) {
        setSelectedId(null);
      } else if (next.includes(entryId)) {
        setSelectedId(entryId);
      } else {
        setSelectedId(next[0] ?? null);
      }
      lastSelectedIdRef.current = entryId;
      return next;
    });
  };

  const handleSelectAll = (ids: string[]) => {
    const next = ids.slice();
    setSelectedIds(next);
    setSelectedId(next[0] ?? null);
    lastSelectedIdRef.current = next[0] ?? null;
  };

  const handleLoadRules = async () => {
    await window.electronAPI?.loadRules?.();
  };

  const applyProxySettingsUpdate = async (nextSettings: Partial<ProxySettings>, onError: () => void) => {
    const api = window.electronAPI;
    if (!api?.setProxySettings) return;

    setSettingsBusy(true);
    try {
      const result = await api.setProxySettings(nextSettings);
      if (typeof result?.settings?.listenOnAllInterfaces === 'boolean') {
        setListenOnAllInterfaces(result.settings.listenOnAllInterfaces);
      }
      if (typeof result?.settings?.maxCaptureBodySizeMb === 'number') {
        setMaxCaptureBodySizeMb(result.settings.maxCaptureBodySizeMb);
      }
      if (typeof result?.proxyPort === 'number' && result.proxyPort > 0) {
        setProxyPort(result.proxyPort);
      }
      const endpoint = await api.getProxyEndpoint?.();
      if (endpoint?.host) {
        setProxyHost(endpoint.host);
      }
      if (typeof endpoint?.port === 'number' && endpoint.port > 0) {
        setProxyPort(endpoint.port);
      }
      const details = await api.getCaCertificateDetails?.();
      setCaDetails(details || null);
    } catch {
      onError();
    } finally {
      setSettingsBusy(false);
    }
  };

  const handleListenOnAllInterfacesChange = async (enabled: boolean) => {
    const previousValue = listenOnAllInterfaces;
    setListenOnAllInterfaces(enabled);
    await applyProxySettingsUpdate({ listenOnAllInterfaces: enabled }, () => {
      setListenOnAllInterfaces(previousValue);
    });
  };

  const handleMaxCaptureBodySizeChange = async (sizeMb: number) => {
    const previousValue = maxCaptureBodySizeMb;
    setMaxCaptureBodySizeMb(sizeMb);
    await applyProxySettingsUpdate({ maxCaptureBodySizeMb: sizeMb }, () => {
      setMaxCaptureBodySizeMb(previousValue);
    });
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
      const webSocketPayload = (e.webSocketMessages || [])
        .map((message) => message.content)
        .join(' ');
      const haystack = [
        e.kind,
        e.method,
        e.host,
        e.path,
        e.query,
        String(e.status ?? ''),
        e.webSocketState,
        String(e.webSocketCloseCode ?? ''),
        e.webSocketCloseReason,
        webSocketPayload,
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
    const version = selected.kind === 'websocket' ? 'WS' : selected.requestHttpVersion || 'HTTP/1.1';
    return `${version} ${selected.method} ${selected.host}`;
  }, [selected]);
  const requestTarget = useMemo(() => {
    if (!selected) return '';
    return `${selected.path}${selected.query || ''}`;
  }, [selected]);
  const responseLine = useMemo(() => {
    if (!selected) return '';
    if (selected.kind === 'websocket') {
      const state = selected.webSocketState || 'connecting';
      return `${selected.protocol?.replace(':', '').toUpperCase() || 'WS'} ${state}${selected.status ? ` (${selected.status})` : ''}`;
    }
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
    if (selected.kind === 'websocket') {
      return [
        { label: 'Protocol', value: selected.protocol?.replace(':', '').toUpperCase() || 'WS' },
        { label: 'Host', value: selected.host },
        { label: 'Path', value: requestTarget || '/' },
        { label: 'State', value: selected.webSocketState || 'connecting' },
        { label: 'Messages', value: String(selected.webSocketMessageCount ?? 0) },
        { label: 'Headers', value: `${Object.keys(selected.requestHeaders || {}).length} headers` },
      ];
    }
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
    if (!selected?.responseBody || selected.kind === 'websocket') return;
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
    if (selected.kind === 'websocket') {
      return [
        { label: 'Handshake', value: String(selected.status ?? 'Pending') },
        { label: 'State', value: selected.webSocketState || 'connecting' },
        { label: 'Messages', value: String(selected.webSocketMessageCount ?? 0) },
        {
          label: 'Close',
          value:
            selected.webSocketState === 'closed'
              ? `${selected.webSocketCloseCode ?? '—'}${selected.webSocketCloseReason ? ` ${selected.webSocketCloseReason}` : ''}`
              : 'Open',
        },
        { label: 'Duration', value: selected.durationMs !== null && typeof selected.durationMs !== 'undefined' ? `${selected.durationMs} ms` : '—' },
      ];
    }
    return [
      { label: 'Status', value: String(selected.status ?? '—') },
      { label: 'Duration', value: performanceData ? `${performanceData.durationMs ?? '—'} ms` : '—' },
      { label: 'Size', value: performanceData?.responseSize ? `${performanceData.responseSize} bytes` : '—' },
      { label: 'Encoding', value: performanceData?.responseEncoding ?? 'None' },
      { label: 'Cacheable', value: performanceData?.cacheable ?? '—' },
    ];
  }, [selected, performanceData]);
  const webSocketMessages = useMemo(() => selected?.webSocketMessages ?? [], [selected]);

  return (
    <div className="shell">
      <Sidebar activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === 'intercept' && (
        <InterceptView
          entries={entries}
          filteredEntries={filteredEntries}
          selected={selected}
          selectedIds={selectedIds}
          onSelectEntry={handleSelectEntry}
          onSelectAll={handleSelectAll}
          onShowContextMenu={(entryIds) => window.electronAPI?.showTrafficContextMenu?.(entryIds)}
          onInspectEntry={handleInspectEntry}
          proxyHost={proxyHost}
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
          isWebSocketSelected={selected?.kind === 'websocket'}
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
          webSocketMessages={webSocketMessages}
          filterText={filterText}
          onFilterTextChange={setFilterText}
          onExportAllHar={handleExportAllHar}
          onImportHar={handleImportHar}
          onClearTraffic={handleClearTraffic}
          onRepeatRequest={handleRepeatRequest}
          onOpenRequestEditor={() => {
            if (!selected || selected.kind === 'websocket') return;
            window.electronAPI?.openRequestEditor?.(selected.id);
          }}
        />
      )}

      {activeTab === 'setup' && (
        <SetupView
          proxyPort={proxyPort}
          caPath={caPath}
          caDetails={caDetails}
          onExportCa={() => window.electronAPI?.exportCaCertificate?.()}
          listenOnAllInterfaces={listenOnAllInterfaces}
          onListenOnAllInterfacesChange={handleListenOnAllInterfacesChange}
          maxCaptureBodySizeMb={maxCaptureBodySizeMb}
          onMaxCaptureBodySizeChange={handleMaxCaptureBodySizeChange}
          settingsBusy={settingsBusy}
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
