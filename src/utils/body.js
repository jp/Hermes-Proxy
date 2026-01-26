const HTML_VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

const tryPrettyJson = (text) => {
  try {
    const parsed = JSON.parse(text);
    return JSON.stringify(parsed, null, 2);
  } catch (err) {
    return null;
  }
};

const prettyPrintHtml = (input = '') => {
  if (!input) return '';
  const normalized = input.replace(/\r\n/g, '\n').trim();
  const collapsed = normalized.replace(/>\s+</g, '><');
  const tokens = [];
  let index = 0;
  while (index < collapsed.length) {
    const lt = collapsed.indexOf('<', index);
    if (lt === -1) {
      tokens.push(collapsed.slice(index));
      break;
    }
    if (lt > index) {
      tokens.push(collapsed.slice(index, lt));
    }
    const gt = collapsed.indexOf('>', lt);
    if (gt === -1) {
      tokens.push(collapsed.slice(lt));
      break;
    }
    tokens.push(collapsed.slice(lt, gt + 1));
    index = gt + 1;
  }

  let indent = 0;
  const lines = [];
  tokens.forEach((token) => {
    const trimmed = token.trim();
    if (!trimmed) return;
    if (trimmed.startsWith('<!--') || /^<!DOCTYPE/i.test(trimmed)) {
      lines.push(`${'  '.repeat(indent)}${trimmed}`);
      return;
    }
    if (trimmed.startsWith('</')) {
      indent = Math.max(indent - 1, 0);
      lines.push(`${'  '.repeat(indent)}${trimmed}`);
      return;
    }
    if (trimmed.startsWith('<')) {
      const tagMatch = trimmed.match(/^<\s*([a-z0-9-]+)/i);
      const tagName = tagMatch ? tagMatch[1].toLowerCase() : '';
      const selfClosing = trimmed.endsWith('/>') || HTML_VOID_TAGS.has(tagName);
      lines.push(`${'  '.repeat(indent)}${trimmed}`);
      if (!selfClosing) {
        indent += 1;
      }
      return;
    }
    lines.push(`${'  '.repeat(indent)}${trimmed}`);
  });
  return lines.join('\n');
};

export { tryPrettyJson, prettyPrintHtml };
