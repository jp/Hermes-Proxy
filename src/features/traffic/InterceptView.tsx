import React from 'react';
import { headersToList, statusTone } from '../../utils/http';
import type { ProxyEntry, RequestHeaderDraft } from '../../types';

type InterceptViewProps = {
  entries: ProxyEntry[];
  filteredEntries: ProxyEntry[];
  selected: ProxyEntry | null;
  selectedId: string | null;
  onSelectEntry: (id: string) => void;
  onShowContextMenu: (entryId: string) => void;
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
  requestView: 'headers' | 'query' | 'body' | 'raw' | 'summary';
  responseView: 'headers' | 'query' | 'body' | 'raw' | 'summary';
  onRequestViewChange: (view: 'headers' | 'query' | 'body' | 'raw' | 'summary') => void;
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
  selectedId,
  onSelectEntry,
  onShowContextMenu,
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
  const requestTabs = [
    { id: 'headers', label: 'Header' },
    { id: 'query', label: 'Query' },
    { id: 'body', label: 'Body' },
    { id: 'raw', label: 'Raw' },
    { id: 'summary', label: 'Summary' },
  ] as const;
  const responseTabs = [
    { id: 'headers', label: 'Header' },
    { id: 'query', label: 'Query' },
    { id: 'body', label: 'Body' },
    { id: 'raw', label: 'Raw' },
    { id: 'summary', label: 'Summary' },
  ] as const;
  return (
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
          <div className="table-wrapper" ref={tableRef} onScroll={onTableScroll}>
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
                    onClick={() => onSelectEntry(entry.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      onShowContextMenu(entry.id);
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
                        <div className="plain-field" aria-label="Request headers">
                          <div className="kv-title">HEADERS</div>
                          <div className="headers-grid">
                            {requestHeadersDraft.length === 0 && <div className="empty">No headers</div>}
                            {requestHeadersDraft.map((header, index) => (
                              <div className="headers-row" key={`${header.name}-${index}`}>
                                <div className="header-name header-cell">{header.name}</div>
                                <div className="header-value header-cell">{header.value || '—'}</div>
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
