import type { ProxyEntry } from './types';
import { buildEntryUrl } from './entries';
import { normalizeHeaderValue } from './http';

const escapeSingleQuotes = (value: string) => String(value).replace(/'/g, `'"'"'`);
const escapePowerShell = (value: string) => String(value).replace(/'/g, "''");

export const buildCurlCommand = (entry: ProxyEntry) => {
  const url = buildEntryUrl(entry);
  const parts = [`curl -X ${entry.method || 'GET'}`];
  parts.push(`'${escapeSingleQuotes(url)}'`);

  const headers = entry.requestHeaders || {};
  Object.entries(headers).forEach(([name, value]) => {
    if (typeof value === 'undefined') return;
    const headerValue = Array.isArray(value) ? value.join(', ') : normalizeHeaderValue(value);
    parts.push(`-H '${escapeSingleQuotes(`${name}: ${headerValue}`)}'`);
  });

  if (entry.requestBody) {
    parts.push(`--data-raw '${escapeSingleQuotes(entry.requestBody)}'`);
  }

  return parts.join(' ');
};

export const buildPowerShellCommand = (entry: ProxyEntry) => {
  const url = buildEntryUrl(entry);
  const method = entry.method || 'GET';
  const headers = entry.requestHeaders || {};
  const headerEntries = Object.entries(headers)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([name, value]) => {
      const headerValue = Array.isArray(value) ? value.join(', ') : normalizeHeaderValue(value);
      return `'${escapePowerShell(name)}'='${escapePowerShell(headerValue)}'`;
    });
  const headerBlock = headerEntries.length ? `-Headers @{ ${headerEntries.join('; ')} }` : '';
  const bodyBlock = entry.requestBody ? `-Body '${escapePowerShell(entry.requestBody)}'` : '';
  const parts = [
    'Invoke-WebRequest',
    `-Uri '${escapePowerShell(url)}'`,
    `-Method ${method}`,
    headerBlock,
    bodyBlock,
  ].filter(Boolean);
  return parts.join(' ');
};

export const buildFetchCommand = (entry: ProxyEntry) => {
  const url = buildEntryUrl(entry);
  const method = entry.method || 'GET';
  const headers = entry.requestHeaders || {};
  const headerEntries = Object.entries(headers)
    .filter(([, value]) => typeof value !== 'undefined')
    .map(([name, value]) => {
      const headerValue = Array.isArray(value) ? value.join(', ') : normalizeHeaderValue(value);
      return `    '${String(name)}': '${escapeSingleQuotes(headerValue)}'`;
    });
  const bodyBlock = entry.requestBody ? `  body: '${escapeSingleQuotes(entry.requestBody)}',\n` : '';
  const headerBlock = headerEntries.length ? `  headers: {\n${headerEntries.join(',\n')}\n  },\n` : '';
  return `fetch('${escapeSingleQuotes(url)}', {\n  method: '${method}',\n${headerBlock}${bodyBlock}});`;
};
