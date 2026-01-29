import fs from 'fs';
import net from 'net';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import { app } from 'electron';
import { getMcpEnabled, getMcpService } from './index';
import { getEntryById } from '../state';
import { repeatEntryRequest } from '../replay';
import type { BridgeMethod, BridgeRequest, BridgeResponse } from './bridgeProtocol';
import type { AggregationGroupBy } from './types';

const SOCKET_NAME = 'hermes-mcp.sock';
const INFO_FILENAME = 'mcp-bridge.json';

type BridgeInfo = {
  socketPath: string;
  token: string;
  pid: number;
  appVersion: string;
  createdAt: string;
};

let server: net.Server | null = null;
let bridgeInfoPath: string | null = null;
let bridgeInfo: BridgeInfo | null = null;

const getSocketPath = () => {
  if (process.platform === 'win32') {
    return `\\\\.\\pipe\\hermes-mcp-${process.pid}`;
  }
  return path.join(app.getPath('userData'), SOCKET_NAME);
};

export const getBridgeInfoPath = () => {
  if (bridgeInfoPath) return bridgeInfoPath;
  bridgeInfoPath = path.join(app.getPath('userData'), INFO_FILENAME);
  return bridgeInfoPath;
};

const writeBridgeInfo = (info: BridgeInfo) => {
  const filePath = getBridgeInfoPath();
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const payload = JSON.stringify(info, null, 2);
  fs.writeFileSync(filePath, payload, { mode: 0o600 });
};

const removeSocketIfNeeded = (socketPath: string) => {
  if (process.platform === 'win32') return;
  if (fs.existsSync(socketPath)) {
    try {
      fs.unlinkSync(socketPath);
    } catch (err) {
      console.warn('Failed to remove existing MCP bridge socket', err);
    }
  }
};

const parseLines = (buffer: string) =>
  buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const buildResponse = (id: string, result?: unknown, error?: BridgeResponse['error']): BridgeResponse => ({
  id,
  result,
  error,
});

const handleMethod = async (method: BridgeMethod, params: unknown) => {
  if (method === 'ping') {
    return { ok: true, appVersion: app.getVersion(), platform: os.platform() };
  }

  if (!getMcpEnabled()) {
    throw new Error('MCP server is disabled');
  }

  const service = getMcpService();
  if (!service) {
    throw new Error('MCP service not initialized');
  }

  switch (method) {
    case 'listRequests':
      return service.listRequests(params as any);
    case 'getRequestDetails':
      return service.getRequestDetails((params as { id?: string })?.id || '');
    case 'aggregateRequests': {
      const { groupBy, filter } = (params as { groupBy: AggregationGroupBy; filter?: unknown }) || ({} as any);
      return service.aggregateRequests(groupBy as AggregationGroupBy, filter as any);
    }
    case 'addAnnotation':
      service.addAnnotation(params as any);
      return true;
    case 'listAnnotations':
      return service.listAnnotations((params as { requestId?: string })?.requestId || '');
    case 'replayRequest': {
      const payload = params as { requestId?: string; overrides?: any };
      const requestId = payload?.requestId;
      if (!requestId) throw new Error('Missing requestId');
      const entry = getEntryById(requestId);
      if (!entry) throw new Error('Request not found');
      await repeatEntryRequest(entry, payload?.overrides || {});
      return true;
    }
    default:
      throw new Error(`Unknown method: ${method}`);
  }
};

export const startBridgeServer = () => {
  if (server) return;
  const socketPath = getSocketPath();
  removeSocketIfNeeded(socketPath);
  const token = crypto.randomBytes(32).toString('hex');
  bridgeInfo = {
    socketPath,
    token,
    pid: process.pid,
    appVersion: app.getVersion(),
    createdAt: new Date().toISOString(),
  };
  writeBridgeInfo(bridgeInfo);

  server = net.createServer((socket) => {
    let buffer = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf8');
      const lines = parseLines(buffer);
      if (!buffer.endsWith('\n')) {
        buffer = buffer.slice(buffer.lastIndexOf('\n') + 1);
      } else {
        buffer = '';
      }

      lines.forEach(async (line) => {
        let request: BridgeRequest | null = null;
        try {
          request = JSON.parse(line) as BridgeRequest;
        } catch (err) {
          socket.write(`${JSON.stringify(buildResponse('unknown', undefined, { message: 'Invalid JSON' }))}\n`);
          return;
        }

        if (!request?.id) {
          socket.write(`${JSON.stringify(buildResponse('unknown', undefined, { message: 'Missing request id' }))}\n`);
          return;
        }

        if (!bridgeInfo || request.token !== bridgeInfo.token) {
          socket.write(
            `${JSON.stringify(buildResponse(request.id, undefined, { message: 'Unauthorized', code: 'UNAUTHORIZED' }))}\n`
          );
          return;
        }

        try {
          const result = await handleMethod(request.method, request.params);
          socket.write(`${JSON.stringify(buildResponse(request.id, result))}\n`);
        } catch (err) {
          socket.write(
            `${JSON.stringify(buildResponse(request.id, undefined, { message: String((err as Error).message || err) }))}\n`
          );
        }
      });
    });
  });

  server.listen(socketPath);
  server.on('error', (err) => {
    console.error('MCP bridge server error', err);
  });
};

export const stopBridgeServer = () => {
  if (!server) return;
  server.close();
  server = null;
  if (bridgeInfo?.socketPath) {
    removeSocketIfNeeded(bridgeInfo.socketPath);
  }
};
