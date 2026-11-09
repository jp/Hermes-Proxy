import React from 'react';
import { headersToList, statusTone } from '../../utils/http';
import { formatBytes, formatDuration, hexDump } from '../../utils/format';
import {
  COLUMN_LABELS,
  COLUMN_ORDER,
  DEFAULT_VISIBLE_COLUMNS,
  getEntrySize,
  getEntryStartMs,
  getEntryShortType,
  type ColumnKey,
  type SortState,
} from '../../utils/columns';
import { loadPreference, savePreference } from '../../utils/storage';
import type { ProxyEntry, RequestHeaderDraft, WebSocketFrame } from '../../types';

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
  onClearSelection: () => void;
  onDeleteSelected: () => void;
  onShowContextMenu: (entryIds: string[]) => void;
  onInspectEntry: (entryId: string) => void;
  revealRequest: { id: string; nonce: number } | null;
  proxyHost: string;
  proxyPort: number;
  capturePaused: boolean;
  onToggleCapturePaused: () => void;
  onOpenBrowserMenu: () => void;
  autoScroll: boolean;
  onJumpToLatest: () => void;
  sort: SortState | null;
  onSortChange: (key: ColumnKey) => void;
  hideStatic: boolean;
  onHideStaticChange: (value: boolean) => void;
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
  responseView: 'headers' | 'body' | 'raw' | 'summary' | 'messages';
  onRequestViewChange: (view: 'headers' | 'query' | 'body' | 'raw' | 'summary' | 'chart') => void;
  onResponseViewChange: (view: 'headers' | 'body' | 'raw' | 'summary' | 'messages') => void;
  isWebSocketSelected: boolean;
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
  webSocketMessages: WebSocketFrame[];
  filterText: string;
  onFilterTextChange: (value: string) => void;
  onExportAllHar: () => void;
  onImportHar: () => void;
  onClearTraffic: () => void;
  onRepeatRequest: () => void;
  onOpenRequestEditor: () => void;
};

// Above this many rows, only the rows in (or near) the viewport are rendered.
const VIRTUALIZE_THRESHOLD = 150;
const OVERSCAN_ROWS = 12;
const DEFAULT_ROW_HEIGHT = 33;

const FILTER_HELP = [
  'Filter syntax (all terms must match):',
  '  text            search URL, headers, status, WebSocket payloads',
  '  method:POST     HTTP method (WS for WebSockets)',
  '  status:4xx      also 404, >=400, <300',
  '  host:*.api.com  host, * as wildcard',
  '  path:/v1/       path and query',
  '  type:json       response content type',
  '  -term           exclude, e.g. -host:gstatic.com',
].join('\n');

const isVisibleColumns = (value: unknown): value is Record<ColumnKey, boolean> =>
  Boolean(value) &&
  typeof value === 'object' &&
  COLUMN_ORDER.some((key) => (value as Record<string, unknown>)[key] === true);

const formatTime = (timestamp: ProxyEntry['timestamp']) =>
  timestamp
    ? new Date(timestamp).toLocaleTimeString([], {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        fractionalSecondDigits: 3,
        hour12: false,
      })
    : '—';

const TrafficRow = React.memo(function TrafficRow({
  entry,
  isSelected,
  visibleColumns,
}: {
  entry: ProxyEntry;
  isSelected: boolean;
  visibleColumns: Record<ColumnKey, boolean>;
}) {
  const size = visibleColumns.size ? getEntrySize(entry) : null;
  const type = visibleColumns.type ? getEntryShortType(entry) : '';
  return (
    <tr data-entry-id={entry.id} className={isSelected ? 'selected' : ''} aria-selected={isSelected}>
      {visibleColumns.time && <td className="col-time">{formatTime(entry.timestamp)}</td>}
      {visibleColumns.method && (
        <td>
          <span
            className={`pill method method-${(entry.kind === 'websocket' ? 'ws' : entry.method || 'unknown').toLowerCase()}`}
          >
            {entry.kind === 'websocket' ? 'WS' : entry.method}
          </span>
        </td>
      )}
      {visibleColumns.status && (
        <td>
          <span className={`pill ${statusTone(entry.status)}`} title={entry.error || undefined}>
            {entry.status ?? (entry.error ? 'ERR' : '—')}
          </span>
        </td>
      )}
      {visibleColumns.host && <td title={entry.host}>{entry.host}</td>}
      {visibleColumns.path && <td title={entry.path}>{entry.path}</td>}
      {visibleColumns.query && <td title={entry.query || undefined}>{entry.query || '—'}</td>}
      {visibleColumns.type && <td className="col-muted">{type || '—'}</td>}
      {visibleColumns.size && <td className="col-num">{size === null ? '—' : formatBytes(size)}</td>}
      {visibleColumns.duration && (
        <td className="col-num">{formatDuration(entry.kind === 'websocket' ? null : entry.durationMs)}</td>
      )}
    </tr>
  );
});

type BodyMode = 'auto' | 'text' | 'hex';

function BodyModeToggle({
  mode,
  onChange,
}: {
  mode: 'text' | 'hex';
  onChange: (mode: 'text' | 'hex') => void;
}) {
  return (
    <div className="segmented" role="group" aria-label="Body display mode">
      {(['text', 'hex'] as const).map((value) => (
        <button
          key={value}
          type="button"
          className={mode === value ? 'active' : ''}
          aria-pressed={mode === value}
          onClick={() => onChange(value)}
        >
          {value === 'text' ? 'Text' : 'Hex'}
        </button>
      ))}
    </div>
  );
}

function HexView({ base64, totalSize }: { base64: string; totalSize?: number | null }) {
  const dump = React.useMemo(() => hexDump(base64), [base64]);
  const previewBytes = Math.floor((base64.length * 3) / 4);
  return (
    <>
      {typeof totalSize === 'number' && totalSize > previewBytes && (
        <div className="detail-sub">{`Showing first ${formatBytes(previewBytes)} of ${formatBytes(totalSize)}`}</div>
      )}
      <pre className="plain-pre hex-view" aria-label="Hex dump">
        {dump}
      </pre>
    </>
  );
}

function InterceptView({
  entries,
  filteredEntries,
  selected,
  selectedIds,
  onSelectEntry,
  onSelectAll,
  onClearSelection,
  onDeleteSelected,
  onShowContextMenu,
  onInspectEntry,
  revealRequest,
  proxyHost,
  proxyPort,
  capturePaused,
  onToggleCapturePaused,
  onOpenBrowserMenu,
  autoScroll,
  onJumpToLatest,
  sort,
  onSortChange,
  hideStatic,
  onHideStaticChange,
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
  isWebSocketSelected,
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
  webSocketMessages,
  filterText,
  onFilterTextChange,
  onExportAllHar,
  onImportHar,
  onClearTraffic,
  onRepeatRequest,
  onOpenRequestEditor,
}: InterceptViewProps) {
  const [visibleColumns, setVisibleColumns] = React.useState<Record<ColumnKey, boolean>>(() => ({
    ...DEFAULT_VISIBLE_COLUMNS,
    ...loadPreference('visibleColumns', DEFAULT_VISIBLE_COLUMNS, isVisibleColumns),
  }));
  const [headerMenu, setHeaderMenu] = React.useState<{ open: boolean; x: number; y: number }>({
    open: false,
    x: 0,
    y: 0,
  });
  const headerMenuRef = React.useRef<HTMLDivElement>(null);
  const trafficPanelRef = React.useRef<HTMLElement>(null);
  const filterInputRef = React.useRef<HTMLInputElement>(null);
  const [viewport, setViewport] = React.useState({ scrollTop: 0, height: 0 });
  const [rowHeight, setRowHeight] = React.useState(DEFAULT_ROW_HEIGHT);
  const scrollFrameRef = React.useRef<number | null>(null);
  const [requestBodyMode, setRequestBodyMode] = React.useState<BodyMode>('auto');
  const [responseBodyMode, setResponseBodyMode] = React.useState<BodyMode>('auto');

  React.useEffect(() => {
    savePreference('visibleColumns', visibleColumns);
  }, [visibleColumns]);

  React.useEffect(() => {
    setRequestBodyMode('auto');
    setResponseBodyMode('auto');
  }, [selected?.id]);

  const selectedIdSet = React.useMemo(() => new Set(selectedIds), [selectedIds]);
  const orderedIds = React.useMemo(() => filteredEntries.map((entry) => entry.id), [filteredEntries]);

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
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === 'f') {
        event.preventDefault();
        filterInputRef.current?.focus();
        filterInputRef.current?.select();
        return;
      }
      if (key !== 'a') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || target?.isContentEditable) return;
      event.preventDefault();
      onSelectAll(orderedIds);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [orderedIds, onSelectAll]);

  // Track the table viewport so we know which rows to render.
  React.useLayoutEffect(() => {
    const el = tableRef.current;
    if (!el) return undefined;
    const update = () => setViewport({ scrollTop: el.scrollTop, height: el.clientHeight });
    update();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tableRef]);

  React.useEffect(
    () => () => {
      if (scrollFrameRef.current !== null) window.cancelAnimationFrame(scrollFrameRef.current);
    },
    [],
  );

  const handleScroll = () => {
    onTableScroll();
    if (scrollFrameRef.current !== null) return;
    scrollFrameRef.current = window.requestAnimationFrame(() => {
      scrollFrameRef.current = null;
      const el = tableRef.current;
      if (el) setViewport({ scrollTop: el.scrollTop, height: el.clientHeight });
    });
  };

  // Measure the real row height once rows exist (rows are single-line, so all rows match).
  React.useLayoutEffect(() => {
    const row = tableRef.current?.querySelector<HTMLTableRowElement>('tbody tr[data-entry-id]');
    const measured = row?.offsetHeight ?? 0;
    if (measured > 0 && Math.abs(measured - rowHeight) > 0.5) setRowHeight(measured);
  });

  const getHeaderHeight = () => tableRef.current?.querySelector('thead')?.getBoundingClientRect().height ?? 0;

  const virtualize = filteredEntries.length > VIRTUALIZE_THRESHOLD && viewport.height > 0;
  const headerHeight = virtualize ? getHeaderHeight() : 0;
  const windowStart = virtualize
    ? Math.max(0, Math.floor((viewport.scrollTop - headerHeight) / rowHeight) - OVERSCAN_ROWS)
    : 0;
  const windowEnd = virtualize
    ? Math.min(filteredEntries.length, Math.ceil((viewport.scrollTop + viewport.height) / rowHeight) + OVERSCAN_ROWS)
    : filteredEntries.length;
  const renderedEntries = virtualize ? filteredEntries.slice(windowStart, windowEnd) : filteredEntries;

  const scrollToIndex = React.useCallback(
    (index: number, mode: 'nearest' | 'center') => {
      const el = tableRef.current;
      if (!el || index < 0) return;
      const header = getHeaderHeight();
      const rowTop = header + index * rowHeight;
      const rowBottom = rowTop + rowHeight;
      const viewTop = el.scrollTop + header;
      const viewBottom = el.scrollTop + el.clientHeight;
      if (rowTop >= viewTop && rowBottom <= viewBottom) return;
      let nextTop: number;
      if (mode === 'center') {
        nextTop = rowTop - (el.clientHeight - rowHeight) / 2;
      } else {
        nextTop = rowTop < viewTop ? rowTop - header : rowBottom - el.clientHeight;
      }
      el.scrollTo?.({ top: Math.max(0, nextTop), behavior: mode === 'center' ? 'smooth' : 'auto' });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rowHeight, tableRef],
  );

  React.useEffect(() => {
    if (!revealRequest) return;
    window.requestAnimationFrame(() => scrollToIndex(orderedIds.indexOf(revealRequest.id), 'center'));
    // Only react to new reveal requests.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revealRequest]);

  const visibleColumnCount = COLUMN_ORDER.reduce((count, key) => count + (visibleColumns[key] ? 1 : 0), 0);

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

  const selectByIndex = (index: number) => {
    const nextId = orderedIds[index];
    if (!nextId) return;
    onSelectEntry(nextId, { ctrl: false, shift: false, meta: false }, orderedIds);
    scrollToIndex(index, 'nearest');
  };

  const handleTableKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      onClearSelection();
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      if (selectedIds.length === 0) return;
      event.preventDefault();
      onDeleteSelected();
      return;
    }
    if (orderedIds.length === 0) return;
    const lastIndex = orderedIds.length - 1;
    const currentIndex = selected ? orderedIds.indexOf(selected.id) : -1;
    const pageSize = Math.max(1, Math.floor((tableRef.current?.clientHeight ?? 0) / rowHeight) - 1);
    let nextIndex: number;
    switch (event.key) {
      case 'ArrowDown':
        nextIndex = currentIndex === -1 ? 0 : Math.min(lastIndex, currentIndex + 1);
        break;
      case 'ArrowUp':
        nextIndex = currentIndex === -1 ? lastIndex : Math.max(0, currentIndex - 1);
        break;
      case 'PageDown':
        nextIndex = Math.min(lastIndex, Math.max(0, currentIndex) + pageSize);
        break;
      case 'PageUp':
        nextIndex = Math.max(0, (currentIndex === -1 ? lastIndex : currentIndex) - pageSize);
        break;
      case 'Home':
        nextIndex = 0;
        break;
      case 'End':
        nextIndex = lastIndex;
        break;
      default:
        return;
    }
    event.preventDefault();
    selectByIndex(nextIndex);
  };

  const getRowEntryId = (event: React.MouseEvent) =>
    (event.target as HTMLElement).closest<HTMLTableRowElement>('tr[data-entry-id]')?.dataset.entryId ?? null;

  const handleRowClick = (event: React.MouseEvent<HTMLTableSectionElement>) => {
    const entryId = getRowEntryId(event);
    if (!entryId) return;
    onSelectEntry(entryId, { ctrl: event.ctrlKey, shift: event.shiftKey, meta: event.metaKey }, orderedIds);
  };

  const handleRowContextMenu = (event: React.MouseEvent<HTMLTableSectionElement>) => {
    const entryId = getRowEntryId(event);
    if (!entryId) return;
    event.preventDefault();
    const isSelected = selectedIdSet.has(entryId);
    if (!isSelected) {
      onSelectEntry(entryId, { ctrl: false, shift: false, meta: false }, orderedIds);
    }
    onShowContextMenu(isSelected ? selectedIds : [entryId]);
  };

  const requestBinaryPreview = selected?.requestBodyBinaryPreview || null;
  const responseBinaryPreview = selected?.responseBodyBinaryPreview || null;
  const effectiveRequestBodyMode =
    requestBodyMode === 'auto' ? (requestBinaryPreview ? 'hex' : 'text') : requestBodyMode;
  const effectiveResponseBodyMode =
    responseBodyMode === 'auto' ? (responseBinaryPreview ? 'hex' : 'text') : responseBodyMode;
  const showJumpToLatest = !autoScroll && !sort && filteredEntries.length > 0;

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
    { id: 'body', label: 'Body' },
    { id: 'raw', label: 'Raw' },
    { id: 'summary', label: 'Summary' },
  ] as const;
  const responseTabsToRender = isWebSocketSelected
    ? [
        { id: 'messages', label: 'Messages' },
        { id: 'headers', label: 'Header' },
        { id: 'raw', label: 'Raw' },
        { id: 'summary', label: 'Summary' },
      ]
    : responseTabs;
  const formatMessageTimestamp = (timestamp: number | null | undefined) => {
    if (typeof timestamp !== 'number') return '—';
    return new Date(timestamp).toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
      hour12: false,
    });
  };

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
    const rows = entries
      .filter(isRelated)
      .map((entry) => {
        const startMs = getEntryStartMs(entry);
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
  const selectedParent = React.useMemo(() => {
    if (!selected?.parentId) return null;
    return entries.find((entry) => entry.id === selected.parentId) ?? null;
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
            <div className="header-actions">
              <button
                type="button"
                className="open-browser-btn"
                onClick={onOpenBrowserMenu}
                title="Open a browser that is already set up to use Hermes, without changing system settings"
              >
                <i className="fa-solid fa-globe" aria-hidden="true"></i>
                Open browser
                <i className="fa-solid fa-caret-down" aria-hidden="true"></i>
              </button>
              <span className={`status-pill ${capturePaused ? 'paused' : ''}`}>
                {capturePaused ? `Paused · ${proxyHost}:${proxyPort}` : `Listening on ${proxyHost}:${proxyPort}`}
              </span>
              <button
                type="button"
                className={`icon-btn ${capturePaused ? 'active' : ''}`}
                onClick={onToggleCapturePaused}
                aria-label={capturePaused ? 'Resume capture' : 'Pause capture'}
                title={
                  capturePaused
                    ? 'Resume capture'
                    : 'Pause capture (traffic still flows through the proxy, it just is not recorded)'
                }
              >
                <i className={`fa-solid ${capturePaused ? 'fa-play' : 'fa-pause'}`}></i>
              </button>
            </div>
          </div>
          <div
            className="table-wrapper"
            ref={tableRef}
            onScroll={handleScroll}
            onKeyDown={handleTableKeyDown}
            onMouseDown={(event) => event.currentTarget.focus()}
            tabIndex={0}
            aria-label="Traffic list"
          >
            <table className="traffic-table">
              <colgroup>
                {COLUMN_ORDER.map((key) => (visibleColumns[key] ? <col key={key} className={`col-w-${key}`} /> : null))}
              </colgroup>
              <thead>
                <tr onContextMenu={handleHeaderContextMenu} title="Click to sort · right-click to choose columns">
                  {COLUMN_ORDER.map((key) =>
                    visibleColumns[key] ? (
                      <th
                        key={key}
                        className={`sortable ${key === 'time' ? 'col-time' : ''} ${sort?.key === key ? 'sorted' : ''}`}
                        aria-sort={sort?.key === key ? (sort.direction === 'asc' ? 'ascending' : 'descending') : 'none'}
                        onClick={() => onSortChange(key)}
                      >
                        {COLUMN_LABELS[key]}
                        {sort?.key === key && (
                          <i
                            className={`fa-solid fa-caret-${sort.direction === 'asc' ? 'up' : 'down'} sort-indicator`}
                            aria-hidden="true"
                          ></i>
                        )}
                      </th>
                    ) : null,
                  )}
                </tr>
              </thead>
              <tbody onClick={handleRowClick} onContextMenu={handleRowContextMenu}>
                {filteredEntries.length === 0 && (
                  <tr>
                    <td colSpan={visibleColumnCount} className="empty">
                      {entries.length === 0
                        ? capturePaused
                          ? 'Capture is paused.'
                          : 'Waiting for traffic…'
                        : 'No matches for this filter.'}
                    </td>
                  </tr>
                )}
                {virtualize && windowStart > 0 && (
                  <tr className="spacer-row" aria-hidden="true" style={{ height: windowStart * rowHeight }}>
                    <td colSpan={visibleColumnCount} />
                  </tr>
                )}
                {renderedEntries.map((entry) => (
                  <TrafficRow
                    key={entry.id}
                    entry={entry}
                    isSelected={selectedIdSet.has(entry.id)}
                    visibleColumns={visibleColumns}
                  />
                ))}
                {virtualize && windowEnd < filteredEntries.length && (
                  <tr
                    className="spacer-row"
                    aria-hidden="true"
                    style={{ height: (filteredEntries.length - windowEnd) * rowHeight }}
                  >
                    <td colSpan={visibleColumnCount} />
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {showJumpToLatest && (
            <button type="button" className="jump-latest" onClick={onJumpToLatest}>
              <i className="fa-solid fa-arrow-down" aria-hidden="true"></i>
              Jump to latest
            </button>
          )}
          {headerMenu.open && (
            <div
              className="header-context-menu"
              ref={headerMenuRef}
              style={{ left: headerMenu.x, top: headerMenu.y }}
              onMouseDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => event.preventDefault()}
            >
              <div className="menu-title">Columns</div>
              {COLUMN_ORDER.map((key) => (
                <label key={key} className="menu-item">
                  <input type="checkbox" checked={visibleColumns[key]} onChange={() => toggleColumn(key)} />
                  <span>{COLUMN_LABELS[key]}</span>
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
                    disabled={isWebSocketSelected}
                    title={isWebSocketSelected ? 'Replay is only available for HTTP requests' : 'Repeat request'}
                  >
                    <i className="fa-solid fa-repeat"></i>
                  </button>
                  <button
                    className="icon-btn"
                    type="button"
                    aria-label="Edit request"
                    title="Edit request in new window"
                    onClick={onOpenRequestEditor}
                    disabled={isWebSocketSelected}
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
                            readOnly={isWebSocketSelected}
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
                                  readOnly={isWebSocketSelected}
                                />
                                <textarea
                                  className="header-input header-value-input"
                                  rows={1}
                                  placeholder="Header value"
                                  value={header.value}
                                  onChange={(event) =>
                                    onRequestHeaderValueChange(index, event.currentTarget.value, event.currentTarget)
                                  }
                                  readOnly={isWebSocketSelected}
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
                        {requestBinaryPreview && (
                          <div className="kv-title-row">
                            <span className="kv-title">BODY</span>
                            <div className="kv-actions">
                              <BodyModeToggle mode={effectiveRequestBodyMode} onChange={setRequestBodyMode} />
                            </div>
                          </div>
                        )}
                        {requestBinaryPreview && effectiveRequestBodyMode === 'hex' ? (
                          <HexView
                            base64={requestBinaryPreview}
                            totalSize={selected.requestDecodedSize ?? selected.requestBodySize}
                          />
                        ) : requestDisplayBody && requestDisplayBody.length > 0 ? (
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
                            {selectedParent && (
                              <button
                                type="button"
                                className="chart-parent-return"
                                onClick={() => onInspectEntry(selectedParent.id)}
                              >
                                <i className="fa-solid fa-reply" aria-hidden="true"></i>
                                <span>
                                  Back to parent request
                                </span>
                              </button>
                            )}
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
                                  <div
                                    className={`chart-row ${selected?.id === row.entry.id ? 'active' : ''}`}
                                    key={row.entry.id}
                                    onClick={() => onInspectEntry(row.entry.id)}
                                  >
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
                      {responseTabsToRender.map((tab) => (
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
                    {responseView === 'messages' && isWebSocketSelected && (
                      <div className="plain-field" aria-label="WebSocket messages">
                        <div className="kv-title-row">
                          <span className="kv-title">MESSAGES</span>
                          <span className="detail-sub">{`${webSocketMessages.length} frame${webSocketMessages.length === 1 ? '' : 's'}`}</span>
                        </div>
                        {webSocketMessages.length === 0 ? (
                          <div className="empty">No WebSocket messages captured yet.</div>
                        ) : (
                          <div className="websocket-messages">
                            {webSocketMessages.map((message) => (
                              <div className={`websocket-message ${message.direction}`} key={message.id}>
                                <div className="websocket-message-meta">
                                  <span className={`pill websocket-direction ${message.direction}`}>
                                    {message.direction === 'received' ? 'IN' : 'OUT'}
                                  </span>
                                  <span className="websocket-type">{message.isBinary ? 'Binary' : 'Text'}</span>
                                  <span className="websocket-size">{`${message.size} B`}</span>
                                  <span className="websocket-time">{formatMessageTimestamp(message.timestamp)}</span>
                                </div>
                                <pre className="plain-pre websocket-message-body">{message.content || ' '}</pre>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
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
                    {responseView === 'body' && (
                      <div className="plain-field" aria-label="Response body">
                        <div className="kv-title-row">
                          <span className="kv-title">BODY</span>
                          <div className="kv-actions">
                            {responseBinaryPreview && (
                              <BodyModeToggle mode={effectiveResponseBodyMode} onChange={setResponseBodyMode} />
                            )}
                            {isPrettyPrintableResponse && effectiveResponseBodyMode === 'text' && (
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
                              disabled={isWebSocketSelected}
                            >
                              <i className="fa-solid fa-download"></i>
                            </button>
                          </div>
                        </div>
                        {responseBinaryPreview && effectiveResponseBodyMode === 'hex' ? (
                          <HexView
                            base64={responseBinaryPreview}
                            totalSize={selected.responseDecodedSize ?? selected.responseBodySize}
                          />
                        ) : responseBodyText ? (
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
          <div className="filter-field">
            <i className="fa-solid fa-magnifying-glass filter-icon" aria-hidden="true"></i>
            <input
              ref={filterInputRef}
              className="filter-input"
              value={filterText}
              onChange={(e) => onFilterTextChange(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Escape' && filterText) {
                  event.preventDefault();
                  onFilterTextChange('');
                }
              }}
              placeholder="Filter…  e.g. status:4xx method:POST -host:*.gstatic.com"
              title={FILTER_HELP}
              aria-label="Filter traffic"
              spellCheck={false}
            />
            {filterText && (
              <button
                type="button"
                className="filter-clear"
                onClick={() => onFilterTextChange('')}
                aria-label="Clear filter"
                title="Clear filter (Esc)"
              >
                <i className="fa-solid fa-xmark"></i>
              </button>
            )}
          </div>
          <span className="traffic-count" aria-live="polite">
            {filteredEntries.length === entries.length
              ? `${entries.length} request${entries.length === 1 ? '' : 's'}`
              : `${filteredEntries.length} of ${entries.length}`}
          </span>
          <button
            type="button"
            className={`chip-toggle ${hideStatic ? 'active' : ''}`}
            onClick={() => onHideStaticChange(!hideStatic)}
            aria-pressed={hideStatic}
            title="Hide images, fonts, stylesheets, scripts and media"
          >
            <i className="fa-solid fa-image" aria-hidden="true"></i>
            Hide assets
          </button>
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
