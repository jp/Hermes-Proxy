import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const buildEntry = (overrides = {}) => ({
  id: 'entry',
  method: 'GET',
  status: 200,
  protocol: 'https:',
  host: 'api.local',
  path: '/path',
  query: '',
  requestHeaders: {},
  responseHeaders: { 'content-type': 'application/json' },
  requestBody: '',
  responseBody: '',
  requestHttpVersion: 'HTTP/1.1',
  responseHttpVersion: 'HTTP/1.1',
  ...overrides,
});

const ENTRIES = [
  buildEntry({ id: 'a', path: '/alpha', status: 200, durationMs: 300 }),
  buildEntry({ id: 'b', path: '/beta', method: 'POST', status: 404, durationMs: 50 }),
  buildEntry({ id: 'c', path: '/logo.png', status: 200, responseHeaders: { 'content-type': 'image/png' } }),
];

const buildElectronApi = (overrides = {}) => ({
  // History is newest first, like the main process returns it.
  getHistory: () => Promise.resolve(ENTRIES.slice().reverse()),
  getCaCertificate: () => Promise.resolve({ caCertPath: '' }),
  getProxyPort: () => Promise.resolve(8000),
  getRules: () => Promise.resolve([]),
  setRules: () => Promise.resolve([]),
  onProxyEntry: () => () => {},
  onCaReady: () => () => {},
  onProxyPortReady: () => () => {},
  onClearTraffic: () => () => {},
  onAddRule: () => () => {},
  onRulesUpdated: () => () => {},
  ...overrides,
});

const rowPaths = () =>
  Array.from(document.querySelectorAll('tbody tr[data-entry-id]')).map((row) => row.dataset.entryId);

const renderApp = async (overrides) => {
  window.electronAPI = buildElectronApi(overrides);
  render(<App />);
  await screen.findByText('/alpha');
};

describe('traffic view', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('filters with structured terms and shows a count', async () => {
    await renderApp();
    expect(screen.getByText('3 requests')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.type(screen.getByLabelText('Filter traffic'), 'status:4xx');

    await waitFor(() => expect(rowPaths()).toEqual(['b']));
    expect(screen.getByText('1 of 3')).toBeInTheDocument();

    await user.keyboard('{Escape}');
    await waitFor(() => expect(rowPaths()).toEqual(['a', 'b', 'c']));
  });

  it('hides static assets and remembers the choice', async () => {
    await renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /hide assets/i }));

    await waitFor(() => expect(rowPaths()).toEqual(['a', 'b']));
    expect(JSON.parse(window.localStorage.getItem('hermes-proxy:hideStatic'))).toBe(true);
  });

  it('sorts by clicking a column header, cycling back to arrival order', async () => {
    await renderApp();
    const user = userEvent.setup();
    const durationHeader = screen.getByRole('columnheader', { name: /duration/i });

    await user.click(durationHeader);
    expect(rowPaths()).toEqual(['b', 'a', 'c']);
    expect(durationHeader).toHaveAttribute('aria-sort', 'ascending');

    await user.click(durationHeader);
    expect(rowPaths()).toEqual(['a', 'b', 'c']);
    expect(durationHeader).toHaveAttribute('aria-sort', 'descending');

    await user.click(durationHeader);
    expect(rowPaths()).toEqual(['a', 'b', 'c']);
    expect(durationHeader).toHaveAttribute('aria-sort', 'none');
  });

  it('persists hidden columns', async () => {
    await renderApp();
    fireEvent.contextMenu(screen.getByRole('columnheader', { name: /host/i }));
    const menu = document.querySelector('.header-context-menu');
    fireEvent.click(within(menu).getByLabelText('Host'));

    expect(screen.queryByRole('columnheader', { name: /host/i })).not.toBeInTheDocument();
    expect(JSON.parse(window.localStorage.getItem('hermes-proxy:visibleColumns')).host).toBe(false);
  });

  it('asks before clearing traffic', async () => {
    const clearTraffic = vi.fn();
    await renderApp({ clearTraffic });
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(/clear traffic/i));
    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('3 captured requests'));
    expect(clearTraffic).not.toHaveBeenCalled();

    await user.click(screen.getByLabelText(/clear traffic/i));
    expect(clearTraffic).toHaveBeenCalledTimes(1);
  });

  it('deletes selected rows with the Delete key and selects the next row', async () => {
    let emitRemoved;
    const deleteEntries = vi.fn((ids) => {
      emitRemoved(ids);
      return Promise.resolve(true);
    });
    await renderApp({
      deleteEntries,
      onEntriesRemoved: (cb) => {
        emitRemoved = cb;
        return () => {};
      },
    });
    const user = userEvent.setup();
    await user.click(screen.getByText('/alpha'));
    await user.keyboard('{Delete}');

    expect(deleteEntries).toHaveBeenCalledWith(['a']);
    await waitFor(() => expect(rowPaths()).toEqual(['b', 'c']));
    expect(document.querySelector('tr.selected')?.dataset.entryId).toBe('b');
  });

  it('clears the selection with Escape and keeps it cleared', async () => {
    await renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByText('/alpha'));
    await user.keyboard('{Escape}');

    expect(document.querySelector('tr.selected')).toBeNull();
    expect(screen.getByText('Select a request to see details.')).toBeInTheDocument();
  });

  it('jumps to first and last rows with Home and End', async () => {
    await renderApp();
    const user = userEvent.setup();
    await user.click(screen.getByText('/beta'));
    await user.keyboard('{End}');
    expect(document.querySelector('tr.selected')?.dataset.entryId).toBe('c');
    await user.keyboard('{Home}');
    expect(document.querySelector('tr.selected')?.dataset.entryId).toBe('a');
  });

  it('pauses and resumes capture', async () => {
    const setCapturePaused = vi.fn((paused) => Promise.resolve(paused));
    await renderApp({ setCapturePaused, getCapturePaused: () => Promise.resolve(false) });
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Pause capture' }));
    expect(setCapturePaused).toHaveBeenCalledWith(true);
    expect(await screen.findByText(/^Paused/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Resume capture' }));
    expect(setCapturePaused).toHaveBeenLastCalledWith(false);
    expect(await screen.findByText(/^Listening on/)).toBeInTheDocument();
  });

  it('reflects pause state pushed from the main process', async () => {
    let emitPaused;
    await renderApp({
      onCapturePaused: (cb) => {
        emitPaused = cb;
        return () => {};
      },
    });
    act(() => emitPaused(true));
    expect(screen.getByRole('button', { name: 'Resume capture' })).toBeInTheDocument();
  });

  it('shows binary bodies as a hex dump with a text toggle', async () => {
    const binary = buildEntry({
      id: 'bin',
      path: '/dns-query',
      method: 'POST',
      requestBody: '��example',
      requestBodySize: 4,
      requestBodyBinaryPreview: btoa('\x00\x01AB'),
    });
    await renderApp({ getHistory: () => Promise.resolve([binary, ...ENTRIES.slice().reverse()]) });
    const user = userEvent.setup();
    await user.click(screen.getByText('/dns-query'));
    await user.click(screen.getAllByRole('tab', { name: 'Body' })[0]);

    expect(screen.getByLabelText('Hex dump')).toHaveTextContent(/00000000\s+00 01 41 42/);
    await user.click(screen.getByRole('button', { name: 'Text' }));
    expect(screen.queryByLabelText('Hex dump')).not.toBeInTheDocument();
  });

  it('renders only a window of rows for large captures', async () => {
    const many = Array.from({ length: 1000 }, (_, index) =>
      buildEntry({ id: `row-${index}`, path: index === 999 ? '/alpha' : `/item-${index}` }),
    );
    const heightSpy = vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(330);
    await renderApp({ getHistory: () => Promise.resolve(many) });
    await waitFor(() => expect(rowPaths().length).toBeLessThan(100));
    expect(document.querySelectorAll('tr.spacer-row').length).toBeGreaterThan(0);
    expect(screen.getByText('1000 requests')).toBeInTheDocument();
    heightSpy.mockRestore();
  });
});

describe('browser launcher', () => {
  afterEach(() => {
    cleanup();
  });

  it('opens the native browser menu from the traffic header', async () => {
    const showBrowserMenu = vi.fn();
    await renderApp({ showBrowserMenu });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /open browser/i }));
    expect(showBrowserMenu).toHaveBeenCalledTimes(1);
  });

  it('lists installed browsers in Setup and launches the chosen one', async () => {
    const launchBrowser = vi.fn().mockResolvedValueOnce({ ok: false, error: 'Boom' }).mockResolvedValueOnce({ ok: true });
    await renderApp({
      getBrowsers: () =>
        Promise.resolve([
          { id: 'chrome', name: 'Google Chrome', family: 'chromium' },
          { id: 'firefox', name: 'Firefox', family: 'firefox' },
        ]),
      launchBrowser,
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Setup' }));

    await user.click(await screen.findByRole('button', { name: 'Open Firefox through Hermes' }));
    expect(launchBrowser).toHaveBeenCalledWith('firefox');
    expect(await screen.findByRole('status')).toHaveTextContent('Boom');

    await user.click(screen.getByRole('button', { name: 'Open Google Chrome through Hermes' }));
    expect(await screen.findByText(/Google Chrome is starting/)).toBeInTheDocument();
  });

  it('explains when no browser is found', async () => {
    await renderApp({ getBrowsers: () => Promise.resolve([]) });
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Setup' }));
    expect(await screen.findByText(/No supported browser found/)).toBeInTheDocument();
  });
});
