import { test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { BridgeClient } from '../src/bridgeClient';

const createMockServer = (handler: (data: string, socket: net.Socket) => void) =>
  new Promise<{ server: net.Server; path: string }>((resolve) => {
    const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\hermes-mcp-test-${Date.now()}` : `/tmp/hermes-mcp-test-${Date.now()}.sock`;
    const server = net.createServer((socket) => {
      socket.on('data', (chunk) => handler(chunk.toString('utf8'), socket));
    });
    server.listen(socketPath, () => resolve({ server, path: socketPath }));
  });

test('bridge client translates calls', async () => {
  const { server, path } = await createMockServer((data, socket) => {
    const msg = JSON.parse(data.trim());
    socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
  });

  const client = new BridgeClient({ socketPath: path, token: 'token' });
  await client.connect();
  const result = await client.call('ping');
  assert.deepEqual(result, { ok: true });
  server.close();
});

test('bridge client rejects on error response', async () => {
  const { server, path } = await createMockServer((data, socket) => {
    const msg = JSON.parse(data.trim());
    socket.write(`${JSON.stringify({ id: msg.id, error: { message: 'Unauthorized' } })}\n`);
  });

  const client = new BridgeClient({ socketPath: path, token: 'bad' });
  await client.connect();
  await assert.rejects(() => client.call('ping'), /Unauthorized/);
  server.close();
});
