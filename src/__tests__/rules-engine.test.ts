import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  app: {
    getPath: () => '/tmp',
  },
}));

import { buildRuleShortCircuitResponse, matchRule } from '../../electron/src/main/rules';
import type { Rule } from '../../electron/src/main/types';

const createRule = (overrides: Partial<Rule> = {}): Rule => ({
  id: 'rule-1',
  name: 'Test rule',
  enabled: true,
  match: {
    methods: [],
    hosts: [],
    urls: [],
    headers: [],
    ...(overrides.match || {}),
  },
  actions: {
    type: 'none',
    delayMs: 0,
    overrideHeaders: [],
    overrideResponse: {
      statusCode: 200,
      headers: [],
      body: '',
    },
    ...(overrides.actions || {}),
  },
  ...overrides,
});

describe('rules engine', () => {
  it('keeps evaluating host and url when methods contains *', () => {
    const rule = createRule({
      match: {
        methods: ['*'],
        hosts: ['google.fr'],
        urls: ['/search'],
        headers: [],
      },
    });

    expect(
      matchRule(rule, {
        method: 'GET',
        host: 'example.com',
        url: 'https://example.com/search',
        headers: {},
      })
    ).toBe(false);

    expect(
      matchRule(rule, {
        method: 'GET',
        host: 'google.fr',
        url: 'https://google.fr/search',
        headers: {},
      })
    ).toBe(true);
  });

  it('wraps override responses in the mockttp short-circuit response shape', () => {
    const rule = createRule({
      actions: {
        type: 'overrideResponse',
        delayMs: 0,
        overrideHeaders: [],
        overrideResponse: {
          statusCode: 500,
          headers: [{ name: 'content-type', value: 'text/plain' }],
          body: 'boom',
        },
      },
    });

    expect(buildRuleShortCircuitResponse(rule)).toEqual({
      response: {
        statusCode: 500,
        headers: {
          'content-type': 'text/plain',
        },
        body: 'boom',
      },
    });
  });

  it('returns a real close instruction for close actions', () => {
    const rule = createRule({
      actions: {
        type: 'close',
        delayMs: 0,
        overrideHeaders: [],
        overrideResponse: {
          statusCode: 200,
          headers: [],
          body: '',
        },
      },
    });

    expect(buildRuleShortCircuitResponse(rule)).toEqual({
      response: 'close',
    });
  });
});
