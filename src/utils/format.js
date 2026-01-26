const bufferPreview = (text = '') => (text.length > 4000 ? `${text.slice(0, 4000)}\n…truncated…` : text);

const formatBytes = (bytes) => {
  if (bytes === null || typeof bytes === 'undefined') return '—';
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(2)} MB`;
};

const formatMs = (ms) => (typeof ms === 'number' ? `${ms} ms` : '—');

export { bufferPreview, formatBytes, formatMs };
