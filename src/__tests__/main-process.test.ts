// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { binaryPreview, isBinaryBuffer } from '../../electron/src/main/http';
import { addEntry, clearEntries, getEntries, hasEntry, removeEntries } from '../../electron/src/main/state';

describe('binary body detection', () => {
  it('treats text, JSON and multi-byte UTF-8 as text', () => {
    expect(isBinaryBuffer(Buffer.from('{"hello":"world"}\n'))).toBe(false);
    expect(isBinaryBuffer(Buffer.from('héllo wörld — 日本語'))).toBe(false);
    expect(isBinaryBuffer(Buffer.alloc(0))).toBe(false);
    expect(binaryPreview(Buffer.from('plain text'))).toBeNull();
  });

  it('flags NUL bytes, invalid UTF-8 and control-heavy payloads as binary', () => {
    expect(isBinaryBuffer(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00]))).toBe(true);
    expect(isBinaryBuffer(Buffer.from([0xff, 0xfe, 0x41]))).toBe(true);
    expect(isBinaryBuffer(Buffer.from([1, 2, 3, 4, 5, 65, 66]))).toBe(true);
  });

  it('caps the preview at 64 KB', () => {
    const big = Buffer.alloc(200 * 1024, 0);
    const preview = binaryPreview(big);
    expect(Buffer.from(preview!, 'base64').length).toBe(64 * 1024);
  });
});

describe('entry state', () => {
  it('removes entries by id', () => {
    clearEntries();
    ['1', '2', '3'].forEach((id) =>
      addEntry({ id, method: 'GET', host: 'h', path: `/${id}`, url: `http://h/${id}`, requestHeaders: {}, responseHeaders: {} }),
    );
    removeEntries(['1', '3']);
    expect(getEntries().map((entry) => entry.id)).toEqual(['2']);
    expect(hasEntry('1')).toBe(false);
    expect(hasEntry('2')).toBe(true);
    clearEntries();
  });
});
