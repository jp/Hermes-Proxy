// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { HermesMcpStore } from '../store';
import { HermesMcpService } from '../service';
import type { ProxyEntry } from '../../types';

const createService = () => new HermesMcpService(new HermesMcpStore(':memory:'));

const sampleEntry = (): ProxyEntry => ({
  id: 'req-1',
  timestamp: new Date('2026-01-28T10:00:00.000Z').toISOString(),
  method: 'POST',
  status: 200,
  protocol: 'https:',
  host: 'api.example.com',
  path: '/v1/test',
  query: '?q=1',
  requestHeaders: {
    Authorization: 'Bearer secret-token',
    'content-type': 'application/json',
  },
  responseHeaders: {
    'content-type': 'application/json',
    'set-cookie': 'session=secret',
  },
  requestBody: JSON.stringify({ access_token: 'abc', nested: { token: 'def' } }),
  responseBody: JSON.stringify({ ok: true }),
  requestBodySize: 42,
  responseBodySize: 17,
  durationMs: 120,
});

describe('HermesMcpService', () => {
  it('ingests and redacts traffic events', () => {
    const service = createService();
    const entry = sampleEntry();
    service.ingestProxyEntry(entry);

    const list = service.listRequests({ limit: 10 });
    expect(list).toHaveLength(1);

    const details = service.getRequestDetails(entry.id);
    expect(details).not.toBeNull();
    expect(details?.request.headers.Authorization).toBe('[REDACTED]');
    expect(details?.response?.headers['set-cookie']).toBe('[REDACTED]');
    expect(details?.request.body).toContain('[REDACTED]');
  });

  it('supports annotations and aggregation', () => {
    const service = createService();
    const entry = sampleEntry();
    service.ingestProxyEntry(entry);

    service.addAnnotation({
      request_id: entry.id,
      tags: ['login', 'api'],
      note: 'Sensitive login flow',
      created_at: new Date('2026-01-28T10:01:00.000Z').toISOString(),
    });

    const annotations = service.listAnnotations(entry.id);
    expect(annotations).toHaveLength(1);
    expect(annotations[0].tags).toEqual(['login', 'api']);

    const aggregates = service.aggregateRequests('host');
    expect(aggregates[0].key).toBe('api.example.com');
    expect(aggregates[0].count).toBe(1);
  });
});
