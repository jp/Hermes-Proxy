import React, { useEffect, useMemo, useState } from 'react';
import { resizeTextarea } from '../../utils/dom';
import {
  buildEntryUrl,
  headersToList,
  headersToText,
  parseQueryParams,
} from '../../utils/http';
import { HTTP_METHODS } from '../../utils/rules';
import type { ProxyEntry } from '../../types';

type RequestView = 'headers' | 'query' | 'body' | 'raw';

const tabs = [
  { id: 'headers', label: 'Header' },
  { id: 'query', label: 'Query' },
  { id: 'body', label: 'Body' },
  { id: 'raw', label: 'Raw' },
] as const;

function RequestEditorWindow() {
  const [entry, setEntry] = useState<ProxyEntry | null>(null);
  const [requestView, setRequestView] = useState<RequestView>('headers');
  const [method, setMethod] = useState('');
  const [urlDraft, setUrlDraft] = useState('');
  const [headersDraft, setHeadersDraft] = useState<Array<{ name: string; value: string }>>([]);
  const [queryDraft, setQueryDraft] = useState<Array<{ name: string; value: string }>>([]);
  const [bodyDraft, setBodyDraft] = useState('');
  const [rawDraft, setRawDraft] = useState('');
  const entryId = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get('entryId');
  }, []);

  useEffect(() => {
    if (!entryId) return;
    window.electronAPI
      ?.getHistory?.()
      .then((history) => {
        const found = history.find((item) => item.id === entryId);
        setEntry(found ?? null);
        if (found) {
          const methodValue = found.method ?? '';
          const urlValue = buildEntryUrl(found);
          setMethod(methodValue);
          setUrlDraft(urlValue);
          const initialHeaders = headersToList(found.requestHeaders || {}).map(([name, value]) => ({
            name: String(name),
            value: Array.isArray(value) ? value.join(', ') : String(value ?? ''),
          }));
          setHeadersDraft(ensureTrailingEmpty(initialHeaders, false));
          const initialQuery = parseQueryParams(found.query || '');
          setQueryDraft(ensureTrailingEmpty(initialQuery, true));
          const bodyText = found.requestDecodedBody || found.requestBody || '';
          setBodyDraft(bodyText);
          const version = found.requestHttpVersion || 'HTTP/1.1';
          const startLine = `${methodValue} ${found.path || '/'}${found.query || ''} ${version}`;
          const headerText = headersToText(found.requestHeaders || {});
          const segments = [startLine, headerText];
          if (bodyText) {
            segments.push('', bodyText);
          }
          setRawDraft(segments.filter((segment) => segment !== '').join('\n'));
        }
      })
      .catch(() => {
        setEntry(null);
      });
  }, [entryId]);

  useEffect(() => {
    document.querySelectorAll('.header-value-input').forEach((el) => resizeTextarea(el as HTMLTextAreaElement));
  }, [headersDraft]);

  const buildRawFromDrafts = (
    nextMethod: string,
    nextUrl: string,
    nextHeaders: Array<{ name: string; value: string }>,
    nextBody: string
  ) => {
    let target = nextUrl || '/';
    try {
      const parsed = new URL(nextUrl, 'http://placeholder');
      if (nextUrl.startsWith('http://') || nextUrl.startsWith('https://')) {
        target = `${parsed.pathname}${parsed.search || ''}${parsed.hash || ''}` || '/';
      } else {
        target = parsed.pathname + (parsed.search || '') + (parsed.hash || '');
      }
    } catch (err) {
      target = nextUrl || '/';
    }
    const startLine = `${nextMethod || 'GET'} ${target || '/'} HTTP/1.1`;
    const headerLines = nextHeaders
      .filter((header) => header.name || header.value)
      .map((header) => `${header.name}: ${header.value}`);
    const segments = [startLine, ...headerLines];
    if (nextBody) {
      segments.push('', nextBody);
    }
    return segments.join('\n');
  };

  const updateUrlWithQuery = (baseUrl: string, params: Array<{ name: string; value: string }>) => {
    try {
      const url = new URL(baseUrl, 'http://placeholder');
      const search = new URLSearchParams();
      params.forEach((pair) => {
        if (!pair.name) return;
        search.append(pair.name, pair.value ?? '');
      });
      const query = search.toString();
      const path = `${url.pathname}${query ? `?${query}` : ''}${url.hash || ''}`;
      return baseUrl.startsWith('http://') || baseUrl.startsWith('https://') ? `${url.origin}${path}` : path;
    } catch (err) {
      return baseUrl;
    }
  };

  const ensureTrailingEmpty = (
    list: Array<{ name: string; value: string }>,
    allowEmptyList: boolean
  ) => {
    if (!list.length) {
      return allowEmptyList ? [] : [{ name: '', value: '' }];
    }
    const normalized = [...list];
    const last = normalized[normalized.length - 1];
    if (!last || last.name || last.value) {
      normalized.push({ name: '', value: '' });
    }
    return normalized;
  };

  const parseRawText = (text: string) => {
    const normalized = text.replace(/\r\n/g, '\n');
    const [headPart, bodyPart = ''] = normalized.split(/\n\n/);
    const lines = headPart.split('\n').filter((line) => line.length > 0);
    const startLine = lines.shift() || '';
    const startMatch = startLine.match(/^(\S+)\s+(\S+)\s+HTTP\/\d(?:\.\d)?/i);
    const nextMethod = startMatch?.[1]?.toUpperCase() || method || 'GET';
    let nextUrl = startMatch?.[2] || urlDraft || '/';
    const parsedHeaders = lines.map((line) => {
      const idx = line.indexOf(':');
      if (idx === -1) {
        return { name: line.trim(), value: '' };
      }
      return {
        name: line.slice(0, idx).trim(),
        value: line.slice(idx + 1).trim(),
      };
    });
    let nextQuery = [];
    try {
      const isAbsolute = nextUrl.startsWith('http://') || nextUrl.startsWith('https://');
      const hostHeader = parsedHeaders.find((header) => header.name.toLowerCase() === 'host')?.value;
      const hasDraftBase = urlDraft && (urlDraft.startsWith('http://') || urlDraft.startsWith('https://'));
      const draftProtocol = hasDraftBase ? new URL(urlDraft).protocol : 'http:';
      const base = hostHeader
        ? `${draftProtocol}//${hostHeader}`
        : hasDraftBase
          ? urlDraft
          : 'http://placeholder';
      const parsedUrl = new URL(nextUrl, base);
      if (isAbsolute) {
        nextUrl = parsedUrl.toString();
      } else if (hostHeader || hasDraftBase) {
        nextUrl = `${parsedUrl.origin}${parsedUrl.pathname}${parsedUrl.search || ''}${parsedUrl.hash || ''}`;
      } else {
        nextUrl = parsedUrl.pathname + (parsedUrl.search || '') + (parsedUrl.hash || '');
      }
      nextQuery = parseQueryParams(parsedUrl.search || '');
    } catch (err) {
      nextQuery = [];
    }
    return {
      method: nextMethod,
      url: nextUrl,
      headers: parsedHeaders,
      body: bodyPart,
      query: nextQuery,
    };
  };

  const handleMethodChange = (value: string) => {
    setMethod(value);
    setRawDraft(buildRawFromDrafts(value, urlDraft, headersDraft, bodyDraft));
  };

  const handleUrlChange = (value: string) => {
    setUrlDraft(value);
    try {
      const parsed = new URL(value, 'http://placeholder');
      setQueryDraft(parseQueryParams(parsed.search || ''));
      if (parsed.host) {
        const normalized = headersDraft.filter((item) => item.name || item.value);
        const hostIndex = normalized.findIndex((item) => item.name.toLowerCase() === 'host');
        if (hostIndex >= 0) {
          normalized[hostIndex] = { ...normalized[hostIndex], value: parsed.host };
        } else {
          normalized.push({ name: 'Host', value: parsed.host });
        }
        const nextHeaders = ensureTrailingEmpty(normalized, false);
        setHeadersDraft(nextHeaders);
        setRawDraft(buildRawFromDrafts(method, value, nextHeaders.filter((item) => item.name || item.value), bodyDraft));
        return;
      }
    } catch (err) {
      setQueryDraft([]);
    }
    setRawDraft(buildRawFromDrafts(method, value, headersDraft, bodyDraft));
  };


  const handleHeadersChange = (nextHeaders: Array<{ name: string; value: string }>) => {
    const normalized = ensureTrailingEmpty(nextHeaders, false);
    setHeadersDraft(normalized);
    setRawDraft(buildRawFromDrafts(method, urlDraft, normalized.filter((item) => item.name || item.value), bodyDraft));
  };

  const handleHeaderRemove = (index: number) => {
    const next = headersDraft.filter((_, idx) => idx !== index);
    handleHeadersChange(next);
  };

  const handleQueryChange = (nextQuery: Array<{ name: string; value: string }>) => {
    const normalized = ensureTrailingEmpty(nextQuery, true);
    setQueryDraft(normalized);
    const nextUrl = updateUrlWithQuery(urlDraft || '/', normalized.filter((item) => item.name || item.value));
    setUrlDraft(nextUrl);
    setRawDraft(buildRawFromDrafts(method, nextUrl, headersDraft, bodyDraft));
  };

  const handleQueryRemove = (index: number) => {
    const next = queryDraft.filter((_, idx) => idx !== index);
    handleQueryChange(next);
  };

  const handleBodyChange = (value: string) => {
    setBodyDraft(value);
    setRawDraft(buildRawFromDrafts(method, urlDraft, headersDraft, value));
  };

  const handleRawChange = (value: string) => {
    setRawDraft(value);
    const parsed = parseRawText(value);
    setMethod(parsed.method);
    setUrlDraft(parsed.url);
    setHeadersDraft(ensureTrailingEmpty(parsed.headers, false));
    setBodyDraft(parsed.body);
    setQueryDraft(ensureTrailingEmpty(parsed.query, true));
  };

  const handleSendEditedRequest = async () => {
    if (!entry?.id) return;
    await window.electronAPI?.repeatRequest?.({
      entryId: entry.id,
      url: urlDraft,
      headers: headersDraft,
      method,
      body: bodyDraft,
    });
    window.close();
  };

  return (
    <div className="app single">
      <section className="panel">
        <div className="header">
          <h1>Request Editor</h1>
          {entry && (
            <button className="send-btn" type="button" onClick={handleSendEditedRequest}>
              <span>Send</span>
              <i className="fa-solid fa-paper-plane" aria-hidden="true"></i>
            </button>
          )}
        </div>
        {!entry && <div className="empty">Request not found.</div>}
        {entry && (
          <div className="detail-body request-body">
            <div className="plain-field" aria-label="Request method and url">
              <div className="kv-title">REQUEST</div>
              <div className="editor-request-line">
                <select
                  className="plain-select"
                  value={method}
                  onChange={(event) => handleMethodChange(event.currentTarget.value)}
                >
                  {HTTP_METHODS.filter((item) => item !== '*').map((item) => (
                    <option key={item} value={item}>
                      {item}
                    </option>
                  ))}
                </select>
                <input
                  className="plain-input url-hostpath"
                  type="text"
                  value={urlDraft}
                  onChange={(event) => handleUrlChange(event.currentTarget.value)}
                  placeholder="scheme://host/path"
                />
              </div>
            </div>
            <div className="view-tabs" role="tablist" aria-label="Request view tabs">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`view-tab ${requestView === tab.id ? 'active' : ''}`}
                  onClick={() => setRequestView(tab.id)}
                  role="tab"
                  aria-selected={requestView === tab.id}
                >
                  {tab.label}
                </button>
              ))}
            </div>
            {requestView === 'headers' && (
              <>
                <div className="plain-field" aria-label="Request headers">
                  <div className="kv-title">HEADERS</div>
                  <div className="headers-grid">
                    {headersDraft.map((header, index) => {
                      const isEmpty = !header.name && !header.value;
                      return (
                      <div className="headers-row editor-headers-row" key={index}>
                        <input
                          className="header-input header-name-input"
                          type="text"
                          placeholder="Header name"
                          value={header.name}
                          onChange={(event) => {
                            const next = [...headersDraft];
                            next[index] = { ...next[index], name: event.currentTarget.value };
                            handleHeadersChange(next);
                          }}
                        />
                        <textarea
                          className="header-input header-value-input"
                          rows={1}
                          placeholder="Header value"
                          value={header.value}
                          onChange={(event) => {
                            const next = [...headersDraft];
                            next[index] = { ...next[index], value: event.currentTarget.value };
                            handleHeadersChange(next);
                            resizeTextarea(event.currentTarget);
                          }}
                        />
                        <button
                          type="button"
                          className="icon-btn row-delete-btn"
                          aria-label="Remove header"
                          title="Remove header"
                          onClick={() => handleHeaderRemove(index)}
                          disabled={isEmpty}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    );})}
                  </div>
                </div>
              </>
            )}
            {requestView === 'query' && (
              <div className="plain-field" aria-label="Request query">
                <div className="headers-grid">
                  {queryDraft.map((pair, index) => {
                    const isEmpty = !pair.name && !pair.value;
                    return (
                    <div className="headers-row editor-headers-row" key={index}>
                      <input
                        className="header-input header-name-input"
                        type="text"
                        placeholder="Query key"
                        value={pair.name}
                        onChange={(event) => {
                          const next = [...queryDraft];
                          next[index] = { ...next[index], name: event.currentTarget.value };
                          handleQueryChange(next);
                        }}
                      />
                      <input
                        className="header-input header-value-input"
                        type="text"
                        placeholder="Query value"
                        value={pair.value}
                        onChange={(event) => {
                          const next = [...queryDraft];
                          next[index] = { ...next[index], value: event.currentTarget.value };
                          handleQueryChange(next);
                        }}
                      />
                      <button
                        type="button"
                        className="icon-btn row-delete-btn"
                        aria-label="Remove query parameter"
                        title="Remove query parameter"
                        onClick={() => handleQueryRemove(index)}
                        disabled={isEmpty}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  );})}
                  {queryDraft.length === 0 && (
                    <input
                      className="plain-input"
                      type="text"
                      placeholder="No query parameters"
                      onFocus={() => handleQueryChange([{ name: '', value: '' }])}
                    />
                  )}
                </div>
              </div>
            )}
            {requestView === 'body' && (
              <div className="plain-field" aria-label="Request body">
                <textarea
                  className="plain-textarea"
                  placeholder="No body"
                  value={bodyDraft}
                  onChange={(event) => handleBodyChange(event.currentTarget.value)}
                />
              </div>
            )}
            {requestView === 'raw' && (
              <div className="plain-field" aria-label="Request raw">
                <textarea
                  className="plain-textarea"
                  value={rawDraft}
                  onChange={(event) => handleRawChange(event.currentTarget.value)}
                />
              </div>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

export default RequestEditorWindow;
