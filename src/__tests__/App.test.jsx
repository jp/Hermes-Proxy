import React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../App';

const buildElectronApi = (overrides = {}) => ({
  getHistory: () => Promise.resolve([]),
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

describe('App rules UI', () => {
  beforeEach(() => {
    window.electronAPI = buildElectronApi();
  });

  afterEach(() => {
    cleanup();
  });

  it('shows rules tab and adds a rule card', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^rules$/i }));
    await user.click(screen.getByRole('button', { name: /add rule/i }));

    expect(screen.getByDisplayValue('New rule')).toBeInTheDocument();
    expect(document.querySelector('.rule-action-select')).toBeInTheDocument();
  });

  it('reveals action-specific fields', async () => {
    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /^rules$/i }));
    await user.click(screen.getByRole('button', { name: /add rule/i }));

    const actionSelect = document.querySelector('.rule-action-select');
    await user.selectOptions(actionSelect, 'delay');
    expect(screen.getByLabelText(/wait/i)).toBeInTheDocument();

    await user.selectOptions(actionSelect, 'overrideHeaders');
    await user.click(screen.getByTitle(/add override header/i));
    expect(screen.getAllByPlaceholderText(/header name/i).length).toBeGreaterThan(0);
  });
});

describe('App traffic actions', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders traffic table from history', async () => {
    const entry = {
      id: 'entry-1',
      method: 'GET',
      status: 200,
      protocol: 'http:',
      host: 'localhost:9090',
      path: '/',
      query: '',
      requestHeaders: { accept: '*/*' },
      responseHeaders: {},
      requestBody: '',
      responseBody: '',
      requestHttpVersion: 'HTTP/1.1',
      responseHttpVersion: 'HTTP/1.1',
    };
    window.electronAPI = buildElectronApi({
      getHistory: () => Promise.resolve([entry]),
    });

    render(<App />);

    expect(await screen.findByText('localhost:9090')).toBeInTheDocument();
    expect(screen.getByText('/')).toBeInTheDocument();
  });

  it('fires HAR export/import actions', async () => {
    const exportAllHar = vi.fn();
    const importHar = vi.fn();
    window.electronAPI = buildElectronApi({ exportAllHar, importHar });

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText(/export all traffic as har/i));
    expect(exportAllHar).toHaveBeenCalledTimes(1);

    await user.click(screen.getByLabelText(/import har file/i));
    expect(importHar).toHaveBeenCalledTimes(1);
  });

  it('replays a selected request', async () => {
    const repeatRequest = vi.fn();
    const entry = {
      id: 'entry-2',
      method: 'POST',
      status: 201,
      protocol: 'http:',
      host: 'localhost:9090',
      path: '/orders',
      query: '',
      requestHeaders: { 'titi': 'toto' },
      responseHeaders: {},
      requestBody: '',
      responseBody: '',
      requestHttpVersion: 'HTTP/1.1',
      responseHttpVersion: 'HTTP/1.1',
    };
    window.electronAPI = buildElectronApi({
      getHistory: () => Promise.resolve([entry]),
      repeatRequest,
    });

    render(<App />);
    const user = userEvent.setup();

    await screen.findByText('/orders');
    await user.click(screen.getByLabelText(/repeat request/i));

    expect(repeatRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-2',
        url: 'http://localhost:9090/orders',
        headers: [{ name: 'titi', value: 'toto' }],
      })
    );
  });

  it('replays with edited url and headers', async () => {
    const repeatRequest = vi.fn();
    const entry = {
      id: 'entry-4',
      method: 'PUT',
      status: 204,
      protocol: 'http:',
      host: 'api.local',
      path: '/items',
      query: '',
      requestHeaders: { 'titi': 'toto' },
      responseHeaders: {},
      requestBody: '',
      responseBody: '',
      requestHttpVersion: 'HTTP/1.1',
      responseHttpVersion: 'HTTP/1.1',
    };
    window.electronAPI = buildElectronApi({
      getHistory: () => Promise.resolve([entry]),
      repeatRequest,
    });

    render(<App />);
    const user = userEvent.setup();

    await screen.findByText('/items');
    await user.click(screen.getByText('/items'));

    const urlInput = screen.getByDisplayValue('http://api.local/items');
    await user.clear(urlInput);
    await user.type(urlInput, 'http://api.local/items/42');

    const headerValueInput = document.querySelector('.header-value-input');
    await user.clear(headerValueInput);
    await user.type(headerValueInput, 'updated');

    await user.click(screen.getByLabelText(/repeat request/i));

    expect(repeatRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        entryId: 'entry-4',
        url: 'http://api.local/items/42',
        headers: [{ name: 'titi', value: 'updated' }],
      })
    );
  });

  it('filters traffic rows by input', async () => {
    const entries = [
      {
        id: 'entry-1',
        method: 'GET',
        status: 200,
        protocol: 'http:',
        host: 'api.local',
        path: '/alpha',
        query: '',
        requestHeaders: {},
        responseHeaders: {},
        requestBody: '',
        responseBody: '',
        requestHttpVersion: 'HTTP/1.1',
        responseHttpVersion: 'HTTP/1.1',
      },
      {
        id: 'entry-2',
        method: 'POST',
        status: 201,
        protocol: 'http:',
        host: 'api.local',
        path: '/beta',
        query: '',
        requestHeaders: {},
        responseHeaders: {},
        requestBody: '',
        responseBody: '',
        requestHttpVersion: 'HTTP/1.1',
        responseHttpVersion: 'HTTP/1.1',
      },
    ];
    window.electronAPI = buildElectronApi({
      getHistory: () => Promise.resolve(entries),
    });

    render(<App />);
    await screen.findByText('/alpha');

    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText(/filter by method/i), 'beta');

    expect(screen.queryByText('/alpha')).not.toBeInTheDocument();
    expect(screen.getByText('/beta')).toBeInTheDocument();
  });

  it('saves response body for a selected entry', async () => {
    const saveResponseBody = vi.fn();
    const entry = {
      id: 'entry-3',
      method: 'GET',
      status: 200,
      protocol: 'http:',
      host: 'localhost:9090',
      path: '/page',
      query: '',
      requestHeaders: {},
      responseHeaders: { 'content-type': 'text/plain' },
      requestBody: '',
      responseBody: 'hello',
      requestHttpVersion: 'HTTP/1.1',
      responseHttpVersion: 'HTTP/1.1',
    };
    window.electronAPI = buildElectronApi({
      getHistory: () => Promise.resolve([entry]),
      saveResponseBody,
    });

    render(<App />);
    const user = userEvent.setup();

    await screen.findByText('/page');
    await user.click(screen.getByText('/page'));

    const bodyTabs = screen.getAllByRole('button', { name: 'Body' });
    await user.click(bodyTabs[1]);

    await user.click(screen.getByTitle(/save this body as file/i));
    expect(saveResponseBody).toHaveBeenCalledWith(
      expect.objectContaining({
        body: 'hello',
        defaultPath: 'response-body.txt',
      })
    );
  });

  it('clears traffic from the menu button', async () => {
    const clearTraffic = vi.fn();
    window.electronAPI = buildElectronApi({ clearTraffic });

    render(<App />);
    const user = userEvent.setup();
    await user.click(screen.getByLabelText(/clear traffic/i));
    expect(clearTraffic).toHaveBeenCalledTimes(1);
  });
});

describe('App rules interactions', () => {
  afterEach(() => {
    cleanup();
  });

  it('adds a rule from the context menu event payload', async () => {
    let onAddRuleHandler;
    window.electronAPI = buildElectronApi({
      onAddRule: (cb) => {
        onAddRuleHandler = cb;
        return () => {};
      },
    });

    render(<App />);

    await waitFor(() => {
      expect(onAddRuleHandler).toBeDefined();
    });

    onAddRuleHandler({
      method: 'PUT',
      host: 'api.local',
      url: '/items',
      headers: { 'x-test': '1' },
    });

    expect(await screen.findByDisplayValue('Rule for PUT api.local')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Rules' })).toBeInTheDocument();
  });

  it('calls save/load rules actions', async () => {
    const saveRules = vi.fn();
    const loadRules = vi.fn();
    window.electronAPI = buildElectronApi({ saveRules, loadRules });

    render(<App />);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: /^rules$/i }));
    await user.click(screen.getByLabelText(/save rules/i));
    await user.click(screen.getByLabelText(/load rules/i));

    expect(saveRules).toHaveBeenCalledTimes(1);
    expect(loadRules).toHaveBeenCalledTimes(1);
  });
});
