const bufferPreview = (text = '') => (text.length > 4000 ? `${text.slice(0, 4000)}\n…truncated…` : text);

const formatBytes = (bytes: number | null | undefined) => {
  if (bytes === null || typeof bytes === 'undefined') return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const formatMs = (ms: number | undefined) => (typeof ms === 'number' ? `${ms} ms` : '—');

const formatDuration = (ms: number | null | undefined) => {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
};

const base64ToBytes = (base64: string) => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
};

/** Classic hex dump: `00000000  48 65 6c 6c 6f 20 77 6f  72 6c 64 0a           |Hello world.|` */
const hexDump = (base64: string) => {
  let bytes: Uint8Array;
  try {
    bytes = base64ToBytes(base64);
  } catch {
    return '';
  }
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const chunk = bytes.subarray(offset, offset + 16);
    const hex: string[] = [];
    let ascii = '';
    for (let index = 0; index < 16; index += 1) {
      if (index < chunk.length) {
        const byte = chunk[index];
        hex.push(byte.toString(16).padStart(2, '0'));
        ascii += byte >= 0x20 && byte < 0x7f ? String.fromCharCode(byte) : '.';
      } else {
        hex.push('  ');
      }
    }
    lines.push(
      `${offset.toString(16).padStart(8, '0')}  ${hex.slice(0, 8).join(' ')}  ${hex.slice(8).join(' ')}  |${ascii}|`,
    );
  }
  return lines.join('\n');
};

export { bufferPreview, formatBytes, formatMs, formatDuration, hexDump };
