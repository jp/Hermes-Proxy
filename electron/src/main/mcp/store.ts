import { DatabaseSync } from 'node:sqlite';
import type {
  AggregationGroupBy,
  AggregationResult,
  Annotation,
  RequestDetails,
  RequestEvent,
  RequestListFilter,
  RequestSummary,
  ResponseEvent,
  TimingEvent,
} from './types';
import type { HeaderMap } from '../types';

const parseJson = <T>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch (_err) {
    return fallback;
  }
};

const toIso = (value: number) => new Date(value).toISOString();

export class HermesMcpStore {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS requests (
        id TEXT PRIMARY KEY,
        timestamp_iso TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        scheme TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER,
        method TEXT NOT NULL,
        path TEXT NOT NULL,
        query TEXT NOT NULL,
        headers_json TEXT NOT NULL,
        body TEXT,
        size INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS responses (
        request_id TEXT PRIMARY KEY,
        timestamp_iso TEXT NOT NULL,
        timestamp_ms INTEGER NOT NULL,
        status INTEGER,
        headers_json TEXT NOT NULL,
        body TEXT,
        size INTEGER NOT NULL,
        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS timings (
        request_id TEXT PRIMARY KEY,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        duration_ms INTEGER NOT NULL,
        dns_ms INTEGER,
        connect_ms INTEGER,
        tls_ms INTEGER,
        ttfb_ms INTEGER,
        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS annotations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        tags_json TEXT NOT NULL,
        note TEXT NOT NULL,
        created_at TEXT NOT NULL,
        FOREIGN KEY (request_id) REFERENCES requests(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp_ms);
      CREATE INDEX IF NOT EXISTS idx_requests_host ON requests(host);
      CREATE INDEX IF NOT EXISTS idx_requests_path ON requests(path);
      CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
      CREATE INDEX IF NOT EXISTS idx_responses_status ON responses(status);
      CREATE INDEX IF NOT EXISTS idx_annotations_request_id ON annotations(request_id);
    `);
  }

  insertRequest(event: RequestEvent) {
    const timestampMs = Date.parse(event.timestamp) || Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO requests (
        id, timestamp_iso, timestamp_ms, scheme, host, port, method, path, query, headers_json, body, size
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.id,
      event.timestamp,
      timestampMs,
      event.scheme,
      event.host,
      event.port,
      event.method,
      event.path,
      event.query,
      JSON.stringify(event.headers || {}),
      event.body ?? null,
      event.size
    );
  }

  insertResponse(event: ResponseEvent) {
    const timestampMs = Date.parse(event.timestamp) || Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO responses (
        request_id, timestamp_iso, timestamp_ms, status, headers_json, body, size
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.request_id,
      event.timestamp,
      timestampMs,
      event.status,
      JSON.stringify(event.headers || {}),
      event.body ?? null,
      event.size
    );
  }

  insertTiming(event: TimingEvent) {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO timings (
        request_id, start_ms, end_ms, duration_ms, dns_ms, connect_ms, tls_ms, ttfb_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      event.request_id,
      event.start,
      event.end,
      event.duration,
      event.dns ?? null,
      event.connect ?? null,
      event.tls ?? null,
      event.ttfb ?? null
    );
  }

  addAnnotation(annotation: Annotation) {
    const stmt = this.db.prepare(`
      INSERT INTO annotations (request_id, tags_json, note, created_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(annotation.request_id, JSON.stringify(annotation.tags || []), annotation.note, annotation.created_at);
  }

  listAnnotations(requestId: string): Annotation[] {
    const rows = this.db
      .prepare(
        `SELECT request_id, tags_json, note, created_at FROM annotations WHERE request_id = ? ORDER BY id ASC`
      )
      .all(requestId) as Array<{ request_id: string; tags_json: string; note: string; created_at: string }>;

    return rows.map((row) => ({
      request_id: row.request_id,
      tags: parseJson<string[]>(row.tags_json, []),
      note: row.note,
      created_at: row.created_at,
    }));
  }

  listRequests(filter: RequestListFilter = {}): RequestSummary[] {
    const where: string[] = [];
    const params: Array<string | number> = [];

    if (typeof filter.fromMs === 'number') {
      where.push('r.timestamp_ms >= ?');
      params.push(filter.fromMs);
    }
    if (typeof filter.toMs === 'number') {
      where.push('r.timestamp_ms <= ?');
      params.push(filter.toMs);
    }
    if (filter.host) {
      where.push('r.host = ?');
      params.push(filter.host);
    }
    if (filter.method) {
      where.push('r.method = ?');
      params.push(filter.method);
    }
    if (filter.pathContains) {
      where.push('r.path LIKE ?');
      params.push(`%${filter.pathContains}%`);
    }
    if (typeof filter.status === 'number') {
      where.push('resp.status = ?');
      params.push(filter.status);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const limit = typeof filter.limit === 'number' ? filter.limit : 500;
    const offset = typeof filter.offset === 'number' ? filter.offset : 0;

    const rows = this.db
      .prepare(
        `
        SELECT
          r.id,
          r.timestamp_iso as timestamp,
          r.scheme,
          r.host,
          r.port,
          r.method,
          r.path,
          r.query,
          resp.status as status,
          t.duration_ms as durationMs,
          r.size as requestSize,
          resp.size as responseSize
        FROM requests r
        LEFT JOIN responses resp ON resp.request_id = r.id
        LEFT JOIN timings t ON t.request_id = r.id
        ${whereSql}
        ORDER BY r.timestamp_ms DESC
        LIMIT ? OFFSET ?
      `
      )
      .all(...params, limit, offset) as Array<{
      id: string;
      timestamp: string;
      scheme: string;
      host: string;
      port: number | null;
      method: string;
      path: string;
      query: string;
      status: number | null;
      durationMs: number | null;
      requestSize: number;
      responseSize: number | null;
    }>;

    return rows;
  }

  getRequestDetails(requestId: string): RequestDetails | null {
    const request = this.db
      .prepare(
        `SELECT id, timestamp_iso as timestamp, scheme, host, port, method, path, query, headers_json, body, size FROM requests WHERE id = ?`
      )
      .get(requestId) as
      | {
          id: string;
          timestamp: string;
          scheme: string;
          host: string;
          port: number | null;
          method: string;
          path: string;
          query: string;
          headers_json: string;
          body: string | null;
          size: number;
        }
      | undefined;

    if (!request) return null;

    const response = this.db
      .prepare(
        `SELECT request_id, timestamp_iso as timestamp, status, headers_json, body, size FROM responses WHERE request_id = ?`
      )
      .get(requestId) as
      | {
          request_id: string;
          timestamp: string;
          status: number | null;
          headers_json: string;
          body: string | null;
          size: number;
        }
      | undefined;

    const timing = this.db
      .prepare(
        `SELECT request_id, start_ms, end_ms, duration_ms, dns_ms, connect_ms, tls_ms, ttfb_ms FROM timings WHERE request_id = ?`
      )
      .get(requestId) as
      | {
          request_id: string;
          start_ms: number;
          end_ms: number;
          duration_ms: number;
          dns_ms: number | null;
          connect_ms: number | null;
          tls_ms: number | null;
          ttfb_ms: number | null;
        }
      | undefined;

    return {
      request: {
        id: request.id,
        timestamp: request.timestamp,
        scheme: request.scheme,
        host: request.host,
        port: request.port,
        method: request.method,
        path: request.path,
        query: request.query,
        headers: parseJson<HeaderMap>(request.headers_json, {}),
        body: request.body,
        size: request.size,
      },
      response: response
        ? {
            request_id: response.request_id,
            timestamp: response.timestamp,
            status: response.status ?? null,
            headers: parseJson<HeaderMap>(response.headers_json, {}),
            body: response.body,
            size: response.size,
          }
        : null,
      timing: timing
        ? {
            request_id: timing.request_id,
            start: timing.start_ms,
            end: timing.end_ms,
            duration: timing.duration_ms,
            dns: timing.dns_ms,
            connect: timing.connect_ms,
            tls: timing.tls_ms,
            ttfb: timing.ttfb_ms,
          }
        : null,
      annotations: this.listAnnotations(requestId),
    };
  }

  aggregate(groupBy: AggregationGroupBy, filter: RequestListFilter = {}): AggregationResult[] {
    const fieldMap: Record<AggregationGroupBy, string> = {
      host: 'r.host',
      status: 'resp.status',
      method: 'r.method',
      path: 'r.path',
    };

    const where: string[] = [];
    const params: Array<string | number> = [];

    if (typeof filter.fromMs === 'number') {
      where.push('r.timestamp_ms >= ?');
      params.push(filter.fromMs);
    }
    if (typeof filter.toMs === 'number') {
      where.push('r.timestamp_ms <= ?');
      params.push(filter.toMs);
    }
    if (filter.host) {
      where.push('r.host = ?');
      params.push(filter.host);
    }
    if (filter.method) {
      where.push('r.method = ?');
      params.push(filter.method);
    }
    if (filter.pathContains) {
      where.push('r.path LIKE ?');
      params.push(`%${filter.pathContains}%`);
    }
    if (typeof filter.status === 'number') {
      where.push('resp.status = ?');
      params.push(filter.status);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const rows = this.db
      .prepare(
        `
        SELECT ${fieldMap[groupBy]} as key, COUNT(1) as count, AVG(t.duration_ms) as avgDurationMs
        FROM requests r
        LEFT JOIN responses resp ON resp.request_id = r.id
        LEFT JOIN timings t ON t.request_id = r.id
        ${whereSql}
        GROUP BY ${fieldMap[groupBy]}
        ORDER BY count DESC
      `
      )
      .all(...params) as Array<{ key: string | number | null; count: number; avgDurationMs: number | null }>;

    return rows.map((row) => ({
      key: row.key === null ? 'unknown' : String(row.key),
      count: row.count,
      avgDurationMs: row.avgDurationMs === null ? null : Math.round(row.avgDurationMs),
    }));
  }

  clearAll() {
    this.db.exec('DELETE FROM annotations; DELETE FROM timings; DELETE FROM responses; DELETE FROM requests;');
  }

  close() {
    this.db.close();
  }
}

export const buildTimingFromTimestamp = (timestampMs: number, durationMs: number | null) => {
  const end = timestampMs;
  const duration = typeof durationMs === 'number' && durationMs >= 0 ? durationMs : 0;
  const start = end - duration;
  return { start, end, duration };
};

export const timestampMsFromIso = (timestamp: string) => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
};

export const ensureIsoTimestamp = (timestamp: string) => {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? timestamp : toIso(Date.now());
};
