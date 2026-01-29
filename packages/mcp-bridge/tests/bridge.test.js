"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_net_1 = __importDefault(require("node:net"));
const bridgeClient_1 = require("../src/bridgeClient");
const createMockServer = (handler) => new Promise((resolve) => {
    const socketPath = process.platform === 'win32' ? `\\\\.\\pipe\\hermes-mcp-test-${Date.now()}` : `/tmp/hermes-mcp-test-${Date.now()}.sock`;
    const server = node_net_1.default.createServer((socket) => {
        socket.on('data', (chunk) => handler(chunk.toString('utf8'), socket));
    });
    server.listen(socketPath, () => resolve({ server, path: socketPath }));
});
(0, node_test_1.test)('bridge client translates calls', async () => {
    const { server, path } = await createMockServer((data, socket) => {
        const msg = JSON.parse(data.trim());
        socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);
    });
    const client = new bridgeClient_1.BridgeClient({ socketPath: path, token: 'token' });
    client.connect();
    const result = await client.call('ping');
    strict_1.default.deepEqual(result, { ok: true });
    server.close();
});
(0, node_test_1.test)('bridge client rejects on error response', async () => {
    const { server, path } = await createMockServer((data, socket) => {
        const msg = JSON.parse(data.trim());
        socket.write(`${JSON.stringify({ id: msg.id, error: { message: 'Unauthorized' } })}\n`);
    });
    const client = new bridgeClient_1.BridgeClient({ socketPath: path, token: 'bad' });
    client.connect();
    await strict_1.default.rejects(() => client.call('ping'), /Unauthorized/);
    server.close();
});
