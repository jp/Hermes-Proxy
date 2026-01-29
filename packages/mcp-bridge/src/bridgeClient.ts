import fs from 'fs';
import net from 'net';
import { BridgeRequest, BridgeResponse, BridgeMethod } from './protocol';

export type BridgeInfo = {
  socketPath: string;
  token: string;
};

const parseLines = (buffer: string) =>
  buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

export class BridgeClient {
  private socket: net.Socket | null = null;
  private buffer = '';
  private pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();
  private info: BridgeInfo;
  private connectPromise: Promise<void> | null = null;

  constructor(info: BridgeInfo) {
    this.info = info;
  }

  static loadInfo(infoPath: string): BridgeInfo {
    const raw = fs.readFileSync(infoPath, 'utf8');
    const parsed = JSON.parse(raw);
    if (!parsed?.socketPath || !parsed?.token) {
      throw new Error('Invalid bridge info file');
    }
    return { socketPath: parsed.socketPath, token: parsed.token } as BridgeInfo;
  }

  connect(): Promise<void> {
    if (this.socket && !this.connectPromise) return Promise.resolve();
    if (this.connectPromise) return this.connectPromise;

    this.connectPromise = new Promise((resolve, reject) => {
      const socket = new net.Socket();
      this.socket = socket;
      socket.on('error', (err) => {
        this.connectPromise = null;
        this.socket = null;
        reject(err);
      });
      socket.connect(this.info.socketPath, () => resolve());
    });

    const socket = this.socket;
    if (!socket) return this.connectPromise as Promise<void>;

    socket.on('data', (chunk) => {
      this.buffer += chunk.toString('utf8');
      const lines = parseLines(this.buffer);
      if (!this.buffer.endsWith('\n')) {
        this.buffer = this.buffer.slice(this.buffer.lastIndexOf('\n') + 1);
      } else {
        this.buffer = '';
      }
      lines.forEach((line) => {
        try {
          const message = JSON.parse(line) as BridgeResponse;
          const pending = this.pending.get(message.id);
          if (!pending) return;
          this.pending.delete(message.id);
          if (message.error) {
            pending.reject(new Error(message.error.message));
          } else {
            pending.resolve(message.result);
          }
        } catch (err) {
          // ignore malformed responses
        }
      });
    });

    socket.on('close', () => {
      this.connectPromise = null;
      this.socket = null;
    });

    return this.connectPromise;
  }

  async call(method: BridgeMethod, params?: unknown): Promise<unknown> {
    await this.connect();
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload: BridgeRequest = { id, method, params, token: this.info.token };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket?.write(`${JSON.stringify(payload)}\n`);
    });
  }
}
