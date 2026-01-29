#!/usr/bin/env node
import path from 'path';
import { BridgeClient } from './bridgeClient';
import { runStdioServer } from './stdioServer';

const getArgValue = (flag: string) => {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return null;
  return process.argv[idx + 1] || null;
};

const infoPath = getArgValue('--info') || process.env.HERMES_MCP_INFO;

if (!infoPath) {
  process.stderr.write('Missing --info path (or HERMES_MCP_INFO env var).\n');
  process.exit(1);
}

const resolved = path.resolve(infoPath);

const main = () => {
  let client: BridgeClient;
  try {
    const info = BridgeClient.loadInfo(resolved);
    client = new BridgeClient(info);
  } catch (err) {
    process.stderr.write(`Failed to load bridge info: ${String((err as Error).message || err)}\n`);
    process.exit(1);
    return;
  }

  runStdioServer(client);
};

main();
