import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import { RULES_FILENAME } from './constants';
import type { HeaderMap, Rule, RuleHeaderMatcher, RuleHeaderOverride, RuleRequestInfo } from './types';
import { normalizeHeaderValue, toLower } from './http';
import { getRulesFilePath, setRulesFilePath } from './state';

const normalizeHeaderList = (list: unknown) =>
  (Array.isArray(list) ? list : [])
    .map((item) => ({
      name: String((item as RuleHeaderMatcher | RuleHeaderOverride | undefined)?.name || '').trim(),
      value: String((item as RuleHeaderMatcher | RuleHeaderOverride | undefined)?.value || '').trim(),
    }))
    .filter((item) => item.name || item.value);

export const normalizeRule = (rule: Partial<Rule> | undefined, index: number): Rule => {
  const match = rule?.match || ({} as Rule['match']);
  const actions = rule?.actions || ({} as Rule['actions']);
  const normalizeList = (list: unknown) =>
    (Array.isArray(list) ? list : [])
      .map((item) => String(item || '').trim())
      .filter(Boolean);
  const legacyType = actions.delayMs
    ? 'delay'
    : Array.isArray(actions.overrideHeaders) && actions.overrideHeaders.length
      ? 'overrideHeaders'
      : 'none';
  const normalizedType = ['none', 'delay', 'overrideHeaders', 'close'].includes(actions.type as string)
    ? (actions.type as Rule['actions']['type'])
    : legacyType;

  return {
    id: rule?.id || `rule-${Date.now()}-${index}`,
    name: String(rule?.name || `Rule ${index + 1}`),
    enabled: rule?.enabled !== false,
    match: {
      methods: normalizeList(match.methods).map((value) => value.toUpperCase()),
      hosts: normalizeList(match.hosts),
      urls: normalizeList(match.urls),
      headers: normalizeHeaderList(match.headers),
    },
    actions: {
      type: normalizedType,
      delayMs: Number.isFinite(Number(actions.delayMs)) ? Math.max(0, Number(actions.delayMs)) : 0,
      overrideHeaders: normalizeHeaderList(actions.overrideHeaders),
    },
  };
};

export const normalizeRules = (list: unknown) => (Array.isArray(list) ? list : []).map(normalizeRule);

export const getDefaultRulesPath = () => path.join(app.getPath('userData'), RULES_FILENAME);

export const persistRules = (rulesList: Rule[], targetPath?: string | null) => {
  const filePath = targetPath || getRulesFilePath() || getDefaultRulesPath();
  const payload = JSON.stringify({ rules: rulesList }, null, 2);
  fs.writeFileSync(filePath, payload, 'utf-8');
  setRulesFilePath(filePath);
};

export const loadRulesFromFile = (filePath: string) => {
  if (!filePath || !fs.existsSync(filePath)) return [] as Rule[];
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
  const loadedRules = normalizeRules((payload as { rules?: Rule[] })?.rules || payload);
  setRulesFilePath(filePath);
  return loadedRules;
};

const matchesSubstringList = (value: string, list: string[]) => {
  if (!list.length) return true;
  const haystack = toLower(value);
  return list.some((pattern) => haystack.includes(toLower(pattern)));
};

const headerMatchesRule = (headers: HeaderMap, matcher: RuleHeaderMatcher) => {
  const nameNeedle = toLower(matcher.name);
  const valueNeedle = toLower(matcher.value);
  return Object.entries(headers).some(([name, value]) => {
    const headerName = toLower(name);
    const headerValue = toLower(normalizeHeaderValue(value));
    if (nameNeedle && !headerName.includes(nameNeedle)) return false;
    if (valueNeedle && !headerValue.includes(valueNeedle)) return false;
    return true;
  });
};

export const matchRule = (rule: Rule, requestInfo: RuleRequestInfo) => {
  if (!rule.enabled) return false;
  if (rule.match.methods.length) {
    const method = String(requestInfo.method || '').toUpperCase();
    if (rule.match.methods.includes('*')) return true;
    if (!rule.match.methods.includes(method)) return false;
  }
  if (!matchesSubstringList(requestInfo.host, rule.match.hosts)) return false;
  if (!matchesSubstringList(requestInfo.url, rule.match.urls)) return false;
  if (rule.match.headers.length) {
    const headers = requestInfo.headers || {};
    const matchesAll = rule.match.headers.every((matcher) => headerMatchesRule(headers, matcher));
    if (!matchesAll) return false;
  }
  return true;
};

export const buildRuleRequestInfo = (ctx: any, targetUrl: URL): RuleRequestInfo => ({
  method: ctx.clientToProxyRequest?.method || '',
  host: targetUrl?.host || '',
  url: targetUrl?.toString?.() || '',
  headers: ctx.clientToProxyRequest?.headers || {},
});
