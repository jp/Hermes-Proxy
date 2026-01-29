import type { HeaderMap } from '../types';

export interface RequestEvent {
  id: string;
  timestamp: string; // ISO8601
  scheme: string;
  host: string;
  port: number | null;
  method: string;
  path: string;
  query: string;
  headers: HeaderMap;
  body?: string | null;
  size: number;
}

export interface ResponseEvent {
  request_id: string;
  timestamp: string; // ISO8601
  status: number | null;
  headers: HeaderMap;
  body?: string | null;
  size: number;
}

export interface TimingEvent {
  request_id: string;
  start: number;
  end: number;
  duration: number;
  dns?: number | null;
  connect?: number | null;
  tls?: number | null;
  ttfb?: number | null;
}

export interface Annotation {
  request_id: string;
  tags: string[];
  note: string;
  created_at: string; // ISO8601
}

export interface RequestListFilter {
  fromMs?: number;
  toMs?: number;
  host?: string;
  method?: string;
  pathContains?: string;
  status?: number;
  limit?: number;
  offset?: number;
}

export interface RequestSummary {
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
}

export interface RequestDetails {
  request: RequestEvent;
  response: ResponseEvent | null;
  timing: TimingEvent | null;
  annotations: Annotation[];
}

export type AggregationGroupBy = 'host' | 'status' | 'method' | 'path';

export interface AggregationResult {
  key: string;
  count: number;
  avgDurationMs: number | null;
}
