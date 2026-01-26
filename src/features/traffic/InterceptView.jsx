import React from 'react';
import { formatBytes, formatMs } from '../../utils/format';
import { headersToList, statusTone } from '../../utils/http';

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
  responseBodyCollapsed,
  performanceCollapsed,
  onToggleRequest,
  onToggleResponse,
  onToggleResponseBody,
  onTogglePerformance,
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
  performanceData,
  filterText,
  onFilterTextChange,
  onExportAllHar,
  onImportHar,
  onClearTraffic,
  onRepeatRequest,
}) {
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
                        onChange={(event) => onRequestUrlChange(event.target.value)}
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
                              onChange={(event) => onRequestHeaderNameChange(index, event.target.value)}
                            />
                            <textarea
                              className="header-input header-value-input"
                              rows={1}
                              value={header.value}
                              onChange={(event) => onRequestHeaderValueChange(index, event.target.value, event.target)}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    {requestDisplayBody && requestDisplayBody.length > 0 && (
                      <div className="plain-field" aria-label="Request body">
                        <div className="kv-title">BODY</div>
                        <pre className="plain-pre">{requestBodyText}</pre>
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
                    <div className="plain-field" aria-label="Response status">
                      <div className="kv-title">STATUS</div>
                      <div className="plain-text">{selected.status ?? '—'}</div>
                    </div>
                    <div className="plain-field" aria-label="Response headers">
                      <div className="kv-title">HEADERS</div>
                      <div className="headers-grid">
                        {headersToList(selected.responseHeaders).length === 0 && <div className="empty">No headers</div>}
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
                  <button className="detail-header" onClick={onToggleResponseBody} type="button">
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
                <button className="detail-header" onClick={onTogglePerformance} type="button">
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
