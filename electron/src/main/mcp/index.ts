import path from 'path';
import { app } from 'electron';
import { HermesMcpStore } from './store';
import { HermesMcpService } from './service';

let mcpService: HermesMcpService | null = null;
let mcpEnabled = true;

export const initMcpService = (dbPath?: string) => {
  if (!mcpEnabled) return null;
  if (mcpService) return mcpService;
  const resolvedPath = dbPath || path.join(app.getPath('userData'), 'hermes-mcp.sqlite');
  const store = new HermesMcpStore(resolvedPath);
  mcpService = new HermesMcpService(store);
  return mcpService;
};

export const getMcpService = () => mcpService;

export const getMcpEnabled = () => mcpEnabled;

export const setMcpEnabled = (nextEnabled: boolean) => {
  mcpEnabled = Boolean(nextEnabled);
  if (mcpEnabled) {
    initMcpService();
  } else if (mcpService) {
    mcpService.close();
    mcpService = null;
  }
  return mcpEnabled;
};
