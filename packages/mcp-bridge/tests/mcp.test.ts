import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpMessage } from '../src/stdioServer';

const fakeClient = {
  call: async (method: string, params?: unknown) => ({ method, params }),
} as any;

test('initialize handshake', async () => {
  const state = { initialized: false, ready: false, protocolVersion: '2025-03-26' };
  const response = await handleMcpMessage(
    fakeClient,
    state,
    JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })
  );
  const initResult = (response as any)?.result;
  assert.equal(initResult?.protocolVersion, '2025-03-26');
});

test('tools list', async () => {
  const state = { initialized: true, ready: true, protocolVersion: '2025-03-26' };
  const response = await handleMcpMessage(
    fakeClient,
    state,
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' })
  );
  const listResult = (response as any)?.result;
  assert.ok(Array.isArray(listResult?.tools));
});

test('tools call routes to bridge client', async () => {
  const state = { initialized: true, ready: true, protocolVersion: '2025-03-26' };
  const response = await handleMcpMessage(
    fakeClient,
    state,
    JSON.stringify({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'getRequestDetails', arguments: { id: 'abc' } },
    })
  );
  const callResult = (response as any)?.result;
  const payload = JSON.parse(callResult?.content?.[0]?.text || '{}');
  assert.equal(payload.method, 'getRequestDetails');
  assert.deepEqual(payload.params, { id: 'abc' });
});
