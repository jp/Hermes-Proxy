import type { Rule } from '../types';

const HTTP_METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS', 'TRACE', 'CONNECT'] as const;

const createRule = (): Rule => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  name: 'New rule',
  enabled: true,
  match: {
    methods: [],
    hosts: [],
    urls: [],
    headers: [],
  },
  actions: {
    type: 'none',
    delayMs: 0,
    overrideHeaders: [],
  },
});

const parseListInput = (value: string, options: { uppercase?: boolean } = {}) => {
  const entries = String(value || '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (options.uppercase) {
    return entries.map((item) => item.toUpperCase());
  }
  return entries;
};

export { HTTP_METHODS, createRule, parseListInput };
