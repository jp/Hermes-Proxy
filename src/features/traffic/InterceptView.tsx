import React from 'react';
import { headersToList, statusTone } from '../../utils/http';
import type { ProxyEntry, RequestHeaderDraft } from '../../types';

type InterceptViewProps = {
  entries: ProxyEntry[];
  filteredEntries: ProxyEntry[];
  selected: ProxyEntry | null;
  selectedIds: string[];
  onSelectEntry: (
    id: string,
    modifiers: { ctrl: boolean; shift: boolean; meta: boolean },
    orderedIds: string[],
  ) => void;
  onSelectAll: (ids: string[]) => void;
  onShowContextMenu: (entryIds: string[]) => void;
  proxyHost: string;
  proxyPort: number;
  isResizing: boolean;
  splitPercent: number;
  splitRef: React.RefObject<HTMLDivElement>;
  tableRef: React.RefObject<HTMLDivElement>;
  onTableScroll: () => void;
  onSplitterMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
  requestCollapsed: boolean;
  responseCollapsed: boolean;
  onToggleRequest: () => void;
  onToggleResponse: () => void;
  requestView: 'headers' | 'query' | 'body' | 'raw' | 'summary' | 'chart';
  responseView: 'headers' | 'query' | 'body' | 'raw' | 'summary';
  onRequestViewChange: (view: 'headers' | 'query' | 'body' | 'raw' | 'summary' | 'chart') => void;
  onResponseViewChange: (view: 'headers' | 'query' | 'body' | 'raw' | 'summary') => void;
  requestLine: string;
  responseLine: string;
  requestUrlDraft: string;
  onRequestUrlChange: (value: string) => void;
  requestHeadersDraft: RequestHeaderDraft[];
  onRequestHeaderNameChange: (index: number, value: string) => void;
  onRequestHeaderValueChange: (index: number, value: string, element: HTMLTextAreaElement) => void;
  requestDisplayBody: string;
  requestBodyText: string;
  responseBodyText: string;
  prismLanguage: string | null;
  prismHtml: string;
  isPrettyPrintableResponse: boolean;
  prettyPrintResponse: boolean;
  onPrettyPrintResponseChange: (value: boolean) => void;
  onSaveResponseBody: () => void;
  requestQueryEntries: Array<{ name: string; value: string }>;
  requestRawText: string;
  responseRawText: string;
  requestSummaryItems: Array<{ label: string; value: string }>;
  responseSummaryItems: Array<{ label: string; value: string }>;
  filterText: string;
  onFilterTextChange: (value: string) => void;
  onExportAllHar: () => void;
  onImportHar: () => void;
  onClearTraffic: () => void;
  onRepeatRequest: () => void;
  onOpenRequestEditor: () => void;
};

function InterceptView({
  entries,
  filteredEntries,
  selected,
  selectedIds,
  onSelectEntry,
  onSelectAll,
  onShowContextMenu,
  proxyHost,
  proxyPort,
  isResizing,
  splitPercent,
  splitRef,
  tableRef,
  onTableScroll,
  onSplitterMouseDown,
  requestCollapsed,
  responseCollapsed,
  onToggleRequest,
  onToggleResponse,
  requestView,
  responseView,
  onRequestViewChange,
  onResponseViewChange,
  requestLine,
  responseLine,
  requestUrlDraft,
  onRequestUrlChange,
  requestHeadersDraft,
  onRequestHeaderNameChange,
  onRequestHeaderValueChange,
  requestDisplayBody,
  requestBodyText,
  responseBodyText,
  prismLanguage,
  prismHtml,
  isPrettyPrintableResponse,
  prettyPrintResponse,
  onPrettyPrintResponseChange,
  onSaveResponseBody,
  requestQueryEntries,
  requestRawText,
  responseRawText,
  requestSummaryItems,
  responseSummaryItems,
  filterText,
  onFilterTextChange,
  onExportAllHar,
  onImportHar,
  onClearTraffic,
  onRepeatRequest,
  onOpenRequestEditor,
}: InterceptViewProps) {
  type ColumnKey = 'time' | 'method' | 'status' | 'host' | 'path' | 'query';
  const columnOrder: ColumnKey[] = ['time', 'method', 'status', 'host', 'path', 'query'];
  const columnLabels: Record<ColumnKey, string> = {
    time: 'Time',
    method: 'Method',
    status: 'Status',
    host: 'Host',
    path: 'Path',
    query: 'Query',
  };
  const [visibleColumns, setVisibleColumns] = React.useState<Record<ColumnKey, boolean>>({
    time: false,
    method: true,
    status: true,
    host: true,
    path: true,
    query: true,
  });
  const [headerMenu, setHeaderMenu] = React.useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const headerMenuRef = React.useRef<HTMLDivElement>(null);
  const trafficPanelRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!headerMenu.open) return undefined;
    const handleOutsideClick = (event: MouseEvent) => {
      if (headerMenuRef.current && headerMenuRef.current.contains(event.target as Node)) {
        return;
      }
      setHeaderMenu((prev) => ({ ...prev, open: false }));
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setHeaderMenu((prev) => ({ ...prev, open: false }));
      }
    };
    window.addEventListener('mousedown', handleOutsideClick);
    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('mousedown', handleOutsideClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [headerMenu.open]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'a') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      event.preventDefault();
      onSelectAll(filteredEntries.map((entry) => entry.id));
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [filteredEntries, onSelectAll]);

  const visibleColumnCount = columnOrder.reduce(
    (count, key) => count + (visibleColumns[key] ? 1 : 0),
    0,
  );

  const handleHeaderContextMenu = (event: React.MouseEvent<HTMLTableRowElement>) => {
    event.preventDefault();
    const panelRect = trafficPanelRef.current?.getBoundingClientRect();
    const x = panelRect ? event.clientX - panelRect.left : event.clientX;
    const y = panelRect ? event.clientY - panelRect.top : event.clientY;
    setHeaderMenu({
      open: true,
      x,
      y,
    });
  };

  const toggleColumn = (key: ColumnKey) => {
    setVisibleColumns((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      return Object.values(next).some(Boolean) ? next : prev;
    });
  };

  const requestTabs = [
    { id: 'headers', label: 'Header' },
    { id: 'query', label: 'Query' },
    { id: 'body', label: 'Body' },
    { id: 'raw', label: 'Raw' },
    { id: 'summary', label: 'Summary' },
    { id: 'chart', label: 'Chart' },
  ] as const;
  const responseTabs = [
    { id: 'headers', label: 'Header' },
    { id: 'query', label: 'Query' },
    { id: 'body', label: 'Body' },
    { id: 'raw', label: 'Raw' },
    { id: 'summary', label: 'Summary' },
  ] as const;

  const chartData = React.useMemo(() => {
    if (!selected) {
      return { rows: [], minStart: 0, rangeMs: 0 };
    }
    const byId = new Map(entries.map((entry) => [entry.id, entry]));
    const selectedId = selected.id;
    const isRelated = (entry: ProxyEntry) => {
      if (entry.id === selectedId) return true;
      let current = entry;
      while (current?.parentId) {
        if (current.parentId === selectedId) return true;
        const parent = byId.get(current.parentId);
        if (!parent) break;
        current = parent;
      }
      return false;
    };
    const toTimestampMs = (entry: ProxyEntry) => {
      if (typeof entry.requestStartAt === 'number') return entry.requestStartAt;
      if (typeof entry.timestamp === 'number') return entry.timestamp;
      if (typeof entry.timestamp === 'string') {
        const parsed = Date.parse(entry.timestamp);
        return Number.isFinite(parsed) ? parsed : null;
      }
      return null;
    };
    const rows = entries
      .filter(isRelated)
      .map((entry) => {
        const startMs = toTimestampMs(entry);
        if (startMs === null) return null;
        const sendMs = entry.timingSendMs ?? 0;
        const waitMs = entry.timingWaitMs ?? 0;
        let receiveMs = entry.timingReceiveMs ?? 0;
        if (sendMs + waitMs + receiveMs <= 0 && typeof entry.durationMs === 'number') {
          receiveMs = entry.durationMs;
        }
        const totalMs = sendMs + waitMs + receiveMs;
        if (totalMs <= 0) return null;
        return {
          entry,
          startMs,
          sendMs,
          waitMs,
          receiveMs,
          endMs: startMs + totalMs,
        };
      })
      .filter((row): row is NonNullable<typeof row> => Boolean(row))
      .sort((a, b) => a.startMs - b.startMs);

    if (rows.length === 0) {
      return { rows: [], minStart: 0, rangeMs: 0 };
    }
    const minStart = Math.min(...rows.map((row) => row.startMs));
    const maxEnd = Math.max(...rows.map((row) => row.endMs));
    const rangeMs = Math.max(1, maxEnd - minStart);
    return { rows, minStart, rangeMs };
  }, [entries, selected]);
  return (
    <div className="app intercept">
      <div
        className={`intercept-grid ${isResizing ? 'resizing' : ''}`}
        ref={splitRef}
        style={{ gridTemplateColumns: `${splitPercent}% 8px minmax(0, 1fr)` }}
      >
        <section className="panel traffic-panel" ref={trafficPanelRef}>
          <div className="header">
            <h1>Traffic</h1>
            <span className="status-pill">{`Listening on ${proxyHost}:${proxyPort}`}</span>
          </div>
          <div className="table-wrapper" ref={tableRef} onScroll={onTableScroll}>
            <table>
              <thead>
                <tr onContextMenu={handleHeaderContextMenu}>
                  {columnOrder.map((key) =>
                    visibleColumns[key] ? (
                      <th key={key} className={key === 'time' ? 'col-time' : undefined}>
                        {columnLabels[key]}
                      </th>
                    ) : null,
                  )}
                </tr>
              </thead>
              <tbody>
                {filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumnCount} className="empty">
                      {entries.length === 0 ? 'Waiting for traffic…' : 'No matches for this filter.'}
                    </td>
                  </tr>
                )}
                {filteredEntries.map((entry) => (
                  <tr
                    key={entry.id}
                    className={selectedIds.includes(entry.id) ? 'selected' : ''}
                    onClick={(event) =>
                      onSelectEntry(
                        entry.id,
                        { ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey },
                        filteredEntries.map((row) => row.id),
                      )
                    }
                    onContextMenu={(e) => {
                      e.preventDefault();
                      const isSelected = selectedIds.includes(entry.id);
                      if (!isSelected) {
                        onSelectEntry(
                          entry.id,
                          { ctrl: false, shift: false, meta: false },
                          filteredEntries.map((row) => row.id),
                        );
                      }
                      onShowContextMenu(isSelected ? selectedIds : [entry.id]);
                    }}
                  >
                    {visibleColumns.time && (
                      <td className="col-time">
                        {entry.timestamp
                          ? new Date(entry.timestamp).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                              second: '2-digit',
                              fractionalSecondDigits: 3,
                              hour12: false,
                            })
                          : '—'}
                      </td>
                    )}
                    {visibleColumns.method && (
                      <td>
                        <span className={`pill method method-${(entry.method || 'unknown').toLowerCase()}`}>
                          {entry.method}
                        </span>
                      </td>
                    )}
                    {visibleColumns.status && (
                      <td>
                        <span className={`pill ${statusTone(entry.status)}`}>{entry.status ?? '—'}</span>
                      </td>
                    )}
                    {visibleColumns.host && <td>{entry.host}</td>}
                    {visibleColumns.path && <td>{entry.path}</td>}
                    {visibleColumns.query && <td>{entry.query || '—'}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {headerMenu.open && (
            <div
              className="header-context-menu"
              ref={headerMenuRef}
              style={{ left: headerMenu.x, top: headerMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="menu-title">Columns</div>
              {columnOrder.map((key) => (
                <label key={key} className="menu-item">
                  <input
                    type="checkbox"
                    checked={visibleColumns[key]}
                    onChange={() => toggleColumn(key)}
                  />
                  <span>{columnLabels[key]}</span>
                </label>
              ))}
            </div>
          )}
        </section>

        <div
          className="splitter"
          onMouseDown={onSplitterMouseDown}
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
                  <button className="detail-header" onClick={onToggleRequest} type="button">
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
                    onClick={onRepeatRequest}
                  >
                    <i className="fa-solid fa-repeat"></i>
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label="Edit request"
                    title="Edit request in new window"
                    onClick={onOpenRequestEditor}
                  >
                    <i className="fa-solid fa-pen-to-square"></i>
                  </button>
                </div>
                {!requestCollapsed && (
                  <div className="detail-body request-body">
                    <div className="view-tabs" role="tablist" aria-label="Request view tabs">
                      {requestTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`view-tab ${requestView === tab.id ? 'active' : ''}`}
                          onClick={() => onRequestViewChange(tab.id)}
                          role="tab"
                          aria-selected={requestView === tab.id}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    {requestView === 'headers' && (
                      <>
                        <div className="plain-field" aria-label="Request url">
                          <div className="kv-title">URL</div>
                          <input
                            className="plain-input url-hostpath"
                            type="text"
                            value={requestUrlDraft}
                            onChange={(event) => onRequestUrlChange(event.currentTarget.value)}
                            placeholder="scheme://host/path"
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
                                  placeholder="Header name"
                                  value={header.name}
                                  onChange={(event) => onRequestHeaderNameChange(index, event.currentTarget.value)}
                                />
                                <textarea
                                  className="header-input header-value-input"
                                  rows={1}
                                  placeholder="Header value"
                                  value={header.value}
                                  onChange={(event) =>
                                    onRequestHeaderValueChange(index, event.currentTarget.value, event.currentTarget)
                                  }
                                />
                              </div>
                            ))}
                          </div>
                        </div>
                      </>
                    )}
                    {requestView === 'query' && (
                      <div className="plain-field" aria-label="Request query">
                        <div className="headers-grid">
                          {requestQueryEntries.length === 0 && <div className="empty">No query parameters</div>}
                          {requestQueryEntries.map((pair, index) => (
                            <div className="headers-row" key={`${pair.name}-${index}`}>
                              <div className="header-name header-cell">{pair.name}</div>
                              <div className="header-value header-cell">{pair.value || '—'}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {requestView === 'body' && (
                      <div className="plain-field" aria-label="Request body">
                        {requestDisplayBody && requestDisplayBody.length > 0 ? (
                          <pre className="plain-pre">{requestBodyText}</pre>
                        ) : (
                          <div className="empty">No body</div>
                        )}
                      </div>
                    )}
                    {requestView === 'raw' && (
                      <div className="plain-field" aria-label="Request raw">
                        <pre className="plain-pre">{requestRawText || '—'}</pre>
                      </div>
                    )}
                    {requestView === 'summary' && (
                      <div className="plain-field" aria-label="Request summary">
                        <div className="performance-metrics">
                          {requestSummaryItems.map((item) => (
                            <div className="metric-row" key={item.label}>
                              <div className="metric-label">{item.label}</div>
                              <div className="metric-value">{item.value}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {requestView === 'chart' && (
                      <div className="plain-field chart-view" aria-label="Request chart">
                        {chartData.rows.length === 0 ? (
                          <div className="empty">No timing data for this request yet.</div>
                        ) : (
                          <>
                            <div className="chart-legend">
                              <span className="legend-item">
                                <span className="legend-swatch request"></span>
                                Request
                              </span>
                              <span className="legend-item">
                                <span className="legend-swatch latency"></span>
                                Latency
                              </span>
                              <span className="legend-item">
                                <span className="legend-swatch response"></span>
                                Response
                              </span>
                              <span className="legend-meta">{Math.round(chartData.rangeMs)} ms window</span>
                            </div>
                            <div className="chart-list">
                              {chartData.rows.map((row) => {
                                const startOffset = ((row.startMs - chartData.minStart) / chartData.rangeMs) * 100;
                                const sendWidth = (row.sendMs / chartData.rangeMs) * 100;
                                const waitWidth = (row.waitMs / chartData.rangeMs) * 100;
                                const receiveWidth = (row.receiveMs / chartData.rangeMs) * 100;
                                const waitOffset = startOffset + sendWidth;
                                const receiveOffset = waitOffset + waitWidth;
                                return (
                                  <div className="chart-row" key={row.entry.id}>
                                    <div className="chart-label">
                                      <span className="chart-method">{row.entry.method}</span>
                                      <span className="chart-path">
                                        {row.entry.path}
                                        {row.entry.query || ''}
                                      </span>
                                    </div>
                                    <div className="chart-track">
                                      <div className="chart-bar">
                                        <span
                                          className="chart-seg request"
                                          style={{ left: `${startOffset}%`, width: `${sendWidth}%` }}
                                        />
                                        <span
                                          className="chart-seg latency"
                                          style={{ left: `${waitOffset}%`, width: `${waitWidth}%` }}
                                        />
                                        <span
                                          className="chart-seg response"
                                          style={{ left: `${receiveOffset}%`, width: `${receiveWidth}%` }}
                                        />
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              <div className="detail-section">
                <button className="detail-header" onClick={onToggleResponse} type="button">
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
                    <div className="view-tabs" role="tablist" aria-label="Response view tabs">
                      {responseTabs.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className={`view-tab ${responseView === tab.id ? 'active' : ''}`}
                          onClick={() => onResponseViewChange(tab.id)}
                          role="tab"
                          aria-selected={responseView === tab.id}
                        >
                          {tab.label}
                        </button>
                      ))}
                    </div>
                    {responseView === 'headers' && (
                      <>
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
                      </>
                    )}
                    {responseView === 'query' && (
                      <div className="plain-field" aria-label="Response query">
                        <div className="empty">No query parameters</div>
                      </div>
                    )}
                    {responseView === 'body' && (
                      <div className="plain-field" aria-label="Response body">
                        <div className="kv-title-row">
                          <span className="kv-title">BODY</span>
                          <div className="kv-actions">
                            {isPrettyPrintableResponse && (
                              <label className="toggle-field">
                                <input
                                  type="checkbox"
                                  checked={prettyPrintResponse}
                                  onChange={(e) => onPrettyPrintResponseChange(e.target.checked)}
                                />
                                Pretty print
                              </label>
                            )}
                            <button
                              type="button"
                              className="icon-btn"
                              onClick={onSaveResponseBody}
                              title="Save this body as file"
                              aria-label="Save this body as file"
                            >
                              <i className="fa-solid fa-download"></i>
                            </button>
                          </div>
                        </div>
                        {responseBodyText ? (
                          prismLanguage ? (
                            <pre className={`plain-pre code-view prism-code language-${prismLanguage}`}>
                              <code dangerouslySetInnerHTML={{ __html: prismHtml || ' ' }} />
                            </pre>
                          ) : (
                            <pre className="plain-pre code-view">{responseBodyText}</pre>
                          )
                        ) : (
                          <div className="empty">No body</div>
                        )}
                      </div>
                    )}
                    {responseView === 'raw' && (
                      <div className="plain-field" aria-label="Response raw">
                        <pre className="plain-pre">{responseRawText || '—'}</pre>
                      </div>
                    )}
                    {responseView === 'summary' && (
                      <div className="plain-field" aria-label="Response summary">
                        <div className="performance-metrics">
                          {responseSummaryItems.map((item) => (
                            <div className="metric-row" key={item.label}>
                              <div className="metric-label">{item.label}</div>
                              <div className="metric-value">{item.value}</div>
                            </div>
                          ))}
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
            onChange={(e) => onFilterTextChange(e.target.value)}
            placeholder="Filter by method, host, headers, status..."
          />
          <button
            className="icon-btn"
            type="button"
            aria-label="Export all traffic as HAR"
            title="Export all traffic as HAR"
            onClick={onExportAllHar}
          >
            <i className="fa-solid fa-save"></i>
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Import HAR file"
            title="Import traffic from a HAR file"
            onClick={onImportHar}
          >
            <i className="fa-solid fa-folder-open"></i>
          </button>
          <button
            className="icon-btn"
            type="button"
            aria-label="Clear traffic"
            title="Clear all traffic"
            onClick={onClearTraffic}
          >
            <i className="fa-solid fa-trash"></i>
          </button>
        </div>
      </div>
    </div>
  );
}

export default InterceptView;
