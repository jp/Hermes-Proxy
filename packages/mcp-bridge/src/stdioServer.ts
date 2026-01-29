import { BridgeClient } from './bridgeClient';

type JsonRpcId = string | number;

type JsonRpcRequest = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  method: string;
  params?: unknown;
};

type JsonRpcNotification = {
  jsonrpc: '2.0';
  method: string;
  params?: unknown;
};

type JsonRpcResponse = {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

type McpState = {
  initialized: boolean;
  ready: boolean;
  protocolVersion: string;
};

const SERVER_INFO = {
  name: 'Hermes MCP Bridge',
  version: '0.1.0',
};

const SUPPORTED_PROTOCOL = '2025-03-26';

type FramingState = {
  useContentLength: boolean;
};

const writeResponse = (payload: unknown, framing: FramingState) => {
  const body = JSON.stringify(payload);
  if (framing.useContentLength) {
    const header = `Content-Length: ${Buffer.byteLength(body, 'utf8')}\r\n\r\n`;
    process.stdout.write(header + body);
  } else {
    process.stdout.write(`${body}\n`);
  }
};

const extractContentLength = (headerText: string) => {
  const lines = headerText.split(/\r\n/);
  for (const line of lines) {
    const match = line.match(/^content-length:\s*(\d+)/i);
    if (match) return Number(match[1]);
  }
  return null;
};

const buildError = (id: JsonRpcId, message: string, code = -32603, data?: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  error: { code, message, data },
});

const buildResult = (id: JsonRpcId, result: unknown): JsonRpcResponse => ({
  jsonrpc: '2.0',
  id,
  result,
});

const toolList = () => [
  {
    name: 'ping',
    title: 'Ping Hermes MCP',
    description: 'Check connectivity to the Hermes MCP bridge server.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'listRequests',
    description: 'List captured requests with optional filters.',
    inputSchema: { type: 'object', properties: { filter: { type: 'object' } }, additionalProperties: false },
  },
  {
    name: 'getRequestDetails',
    description: 'Fetch full request/response details by request id.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string' } },
      required: ['id'],
      additionalProperties: false,
    },
  },
  {
    name: 'aggregateRequests',
    description: 'Group requests by host/status/method/path with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        groupBy: { type: 'string', enum: ['host', 'status', 'method', 'path'] },
        filter: { type: 'object' },
      },
      required: ['groupBy'],
      additionalProperties: false,
    },
  },
  {
    name: 'addAnnotation',
    description: 'Add a tag/note annotation to a request.',
    inputSchema: {
      type: 'object',
      properties: {
        request_id: { type: 'string' },
        tags: { type: 'array', items: { type: 'string' } },
        note: { type: 'string' },
        created_at: { type: 'string' },
      },
      required: ['request_id', 'tags', 'note', 'created_at'],
      additionalProperties: false,
    },
  },
  {
    name: 'listAnnotations',
    description: 'List annotations for a request.',
    inputSchema: {
      type: 'object',
      properties: { requestId: { type: 'string' } },
      required: ['requestId'],
      additionalProperties: false,
    },
  },
  {
    name: 'replayRequest',
    description: 'Replay a captured request with optional overrides.',
    inputSchema: {
      type: 'object',
      properties: {
        requestId: { type: 'string' },
        overrides: {
          type: 'object',
          properties: {
            url: { type: 'string' },
            method: { type: 'string' },
            body: { type: 'string' },
            headers: {
              type: 'array',
              items: {
                type: 'object',
                properties: { name: { type: 'string' }, value: { type: 'string' } },
                required: ['name', 'value'],
                additionalProperties: false,
              },
            },
          },
          additionalProperties: false,
        },
      },
      required: ['requestId'],
      additionalProperties: false,
    },
  },
];

const toToolResult = (result: unknown, isError = false) => ({
  content: [
    {
      type: 'text',
      text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
    },
  ],
  isError,
});

export const handleMcpMessage = async (client: BridgeClient, state: McpState, raw: string) => {
  let message: JsonRpcRequest | JsonRpcNotification | null = null;
  try {
    message = JSON.parse(raw);
  } catch (_err) {
    return buildError('unknown', 'Invalid JSON', -32700);
  }

  if (!message || (message as any).jsonrpc !== '2.0' || !('method' in message)) {
    return buildError('unknown', 'Invalid JSON-RPC message', -32600);
  }

  if (!('id' in message)) {
    // notification
    if (message.method === 'notifications/initialized') {
      state.ready = true;
    }
    return null;
  }

  const request = message as JsonRpcRequest;

  if (request.method === 'initialize') {
    state.initialized = true;
    state.protocolVersion = SUPPORTED_PROTOCOL;
    return buildResult(request.id, {
      protocolVersion: SUPPORTED_PROTOCOL,
      capabilities: { tools: {} },
      serverInfo: SERVER_INFO,
    });
  }

  if (request.method === 'ping') {
    return buildResult(request.id, {});
  }

  if (!state.initialized) {
    return buildError(request.id, 'Server not initialized', -32002);
  }

  if (request.method === 'tools/list') {
    return buildResult(request.id, { tools: toolList() });
  }

  if (request.method === 'tools/call') {
    const params = request.params as { name?: string; arguments?: any } | undefined;
    const name = params?.name;
    try {
      if (!name) {
        return buildResult(request.id, toToolResult('Missing tool name', true));
      }

      if (name === 'ping') {
        const result = await client.call('ping');
        return buildResult(request.id, toToolResult(result));
      }

      if (name === 'listRequests') {
        const result = await client.call('listRequests', params?.arguments?.filter);
        return buildResult(request.id, toToolResult(result));
      }

      if (name === 'getRequestDetails') {
        const result = await client.call('getRequestDetails', { id: params?.arguments?.id });
        return buildResult(request.id, toToolResult(result));
      }

      if (name === 'aggregateRequests') {
        const result = await client.call('aggregateRequests', {
          groupBy: params?.arguments?.groupBy,
          filter: params?.arguments?.filter,
        });
        return buildResult(request.id, toToolResult(result));
      }

      if (name === 'addAnnotation') {
        const result = await client.call('addAnnotation', params?.arguments);
        return buildResult(request.id, toToolResult(result));
      }

      if (name === 'listAnnotations') {
        const result = await client.call('listAnnotations', { requestId: params?.arguments?.requestId });
        return buildResult(request.id, toToolResult(result));
      }

      if (name === 'replayRequest') {
        const result = await client.call('replayRequest', {
          requestId: params?.arguments?.requestId,
          overrides: params?.arguments?.overrides,
        });
        return buildResult(request.id, toToolResult(result));
      }

      return buildResult(request.id, toToolResult(`Unknown tool: ${name}`, true));
    } catch (err) {
      return buildResult(request.id, toToolResult(String((err as Error).message || err), true));
    }
  }

  return buildError(request.id, `Unknown method: ${request.method}`, -32601);
};

export const runStdioServer = (client: BridgeClient) => {
  let buffer = Buffer.alloc(0);
  const state: McpState = { initialized: false, ready: false, protocolVersion: SUPPORTED_PROTOCOL };
  const framing: FramingState = { useContentLength: false };
  process.stdin.on('data', async (chunk) => {
    buffer = Buffer.concat([buffer, Buffer.from(chunk)]);
    while (buffer.length > 0) {
      const text = buffer.toString('utf8');
      const headerIndex = text.indexOf('\r\n\r\n');
      if (headerIndex !== -1) {
        const headerText = text.slice(0, headerIndex);
        const length = extractContentLength(headerText);
        if (typeof length === 'number') {
          const bodyStart = headerIndex + 4;
          if (buffer.length < bodyStart + length) break;
          const body = buffer.slice(bodyStart, bodyStart + length).toString('utf8');
          buffer = buffer.slice(bodyStart + length);
          framing.useContentLength = true;
          const response = await handleMcpMessage(client, state, body);
          if (response) writeResponse(response, framing);
          continue;
        }
      }

      const headerStart = text.slice(0, 16).toLowerCase();
      if (headerIndex === -1 && (headerStart.startsWith('content-') || headerStart.startsWith('content-length'))) {
        break;
      }

      const newlineIndex = text.indexOf('\n');
      if (newlineIndex === -1) break;
      const line = text.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      const response = await handleMcpMessage(client, state, line);
      if (response) writeResponse(response, framing);
    }
  });

  process.stdin.resume();
};
