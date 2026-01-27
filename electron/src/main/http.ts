import zlib from 'zlib';
import type { HeaderMap, HeaderValue } from './types';

export const bodyToText = (buffer: Buffer | null | undefined) => {
  if (!buffer || buffer.length === 0) return '';
  try {
    return buffer.toString('utf8');
  } catch (err) {
    return `<non-text payload: ${buffer.length} bytes>`;
  }
};

export const normalizeHeaderValue = (value: HeaderValue) => {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'undefined' || value === null) return '';
  return String(value);
};

export const getHeaderValue = (headers: HeaderMap | undefined, name: string) => {
  if (!headers) return '';
  const match = Object.keys(headers).find((key) => key.toLowerCase() === name);
  return normalizeHeaderValue(match ? headers[match] : undefined);
};

export const normalizeEncoding = (value: string | null | undefined) => {
  if (!value) return '';
  return String(value).split(',')[0].trim().toLowerCase();
};

export const decodeBody = (buffer: Buffer | null | undefined, encoding: string | null | undefined) => {
  if (!buffer || buffer.length === 0) return null;
  const normalized = normalizeEncoding(encoding);
  if (!normalized) return null;
  try {
    if (normalized === 'gzip' || normalized === 'x-gzip') {
      return zlib.gunzipSync(buffer);
    }
    if (normalized === 'deflate') {
      return zlib.inflateSync(buffer);
    }
    if (normalized === 'br') {
      return zlib.brotliDecompressSync(buffer);
    }
  } catch (err) {
    return null;
  }
  return null;
};

export const normalizeHttpVersion = (version?: string, major?: number, minor?: number) => {
  if (version) return `HTTP/${version}`;
  if (typeof major !== 'undefined' && typeof minor !== 'undefined') return `HTTP/${major}.${minor}`;
  return 'HTTP/1.1';
};

export const normalizeHarHttpVersion = (version?: string) => {
  if (!version) return 'HTTP/1.1';
  const trimmed = String(version).trim();
  return /^HTTP\//i.test(trimmed) ? trimmed : `HTTP/${trimmed}`;
};

export const headersListToObject = (headers: Array<{ name?: string; value?: HeaderValue }> = []) =>
  headers.reduce<HeaderMap>((acc, header) => {
    if (!header) return acc;
    const name = String(header.name || '').trim();
    if (!name) return acc;
    const value = normalizeHeaderValue(header.value as HeaderValue);
    if (acc[name]) {
      acc[name] = `${acc[name]}, ${value}`;
    } else {
      acc[name] = value;
    }
    return acc;
  }, {});

export const decodeHarBody = (content: { text?: string; encoding?: string } = {}) => {
  if (!content?.text) return Buffer.alloc(0);
  if (content.encoding === 'base64') {
    return Buffer.from(content.text, 'base64');
  }
  return Buffer.from(content.text, 'utf8');
};

export const toLower = (value: string) => String(value || '').toLowerCase();
