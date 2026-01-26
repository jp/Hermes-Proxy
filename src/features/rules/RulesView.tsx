import React from 'react';
import { HTTP_METHODS, parseListInput } from '../../utils/rules';
import type { Rule } from '../../types';

type RulesViewProps = {
  rules: Rule[];
  onAddRule: () => void;
  onUpdateRule: (index: number, updater: (current: Rule) => Rule) => void;
  onRemoveRule: (index: number) => void;
  onSaveRules: () => void;
  onLoadRules: () => void;
};

function RulesView({
  rules,
  onAddRule,
  onUpdateRule,
  onRemoveRule,
  onSaveRules,
  onLoadRules,
}: RulesViewProps) {
  return (
    <div className="app single">
      <section className="panel">
        <div className="header">
          <h1>Rules</h1>
          <div className="header-actions">
            <button className="export-btn" type="button" onClick={onAddRule}>
              Add rule
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Save rules to file"
              aria-label="Save rules"
              onClick={onSaveRules}
            >
              <i className="fa-solid fa-save"></i>
            </button>
            <button
              className="icon-btn"
              type="button"
              title="Load rules from file"
              aria-label="Load rules"
              onClick={onLoadRules}
            >
              <i className="fa-solid fa-folder-open"></i>
            </button>
          </div>
        </div>
        <div className="rules-list">
          {rules.length === 0 && <div className="empty">No rules yet.</div>}
          {rules.map((rule, index) => (
            <div className="rule-card" key={rule.id}>
              <div className="rule-header">
                <input
                  className="rule-name"
                  type="text"
                  value={rule.name}
                  onChange={(event) =>
                    onUpdateRule(index, (current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                />
                <label className="rule-toggle">
                  <input
                    type="checkbox"
                    checked={rule.enabled}
                    onChange={(event) =>
                      onUpdateRule(index, (current) => ({
                        ...current,
                        enabled: event.target.checked,
                      }))
                    }
                  />
                  Enabled
                </label>
                <button
                  className="icon-btn"
                  type="button"
                  aria-label="Remove rule"
                  title="Remove rule"
                  onClick={() => onRemoveRule(index)}
                >
                  <i className="fa-solid fa-xmark"></i>
                </button>
              </div>
              <div className="rule-section">
                <div className="kv-title">MATCH</div>
                <div className="rule-grid">
                  <label className="rule-field">
                    <span>Methods</span>
                    <select
                      className="rule-methods-select"
                      value={rule.match.methods[0] || '*'}
                      onChange={(event) => {
                        const methods = [event.target.value.toUpperCase()];
                        onUpdateRule(index, (current) => ({
                          ...current,
                          match: { ...current.match, methods },
                        }));
                      }}
                    >
                      {HTTP_METHODS.map((method) => (
                        <option value={method} key={method}>
                          {method}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="rule-field">
                    <span>Hosts</span>
                    <input
                      type="text"
                      value={rule.match.hosts.join(', ')}
                      onChange={(event) => {
                        const hosts = parseListInput(event.target.value);
                        onUpdateRule(index, (current) => ({
                          ...current,
                          match: { ...current.match, hosts },
                        }));
                      }}
                      placeholder="api.example.com"
                    />
                  </label>
                  <label className="rule-field">
                    <span>URL contains</span>
                    <input
                      type="text"
                      value={rule.match.urls.join(', ')}
                      onChange={(event) => {
                        const urls = parseListInput(event.target.value);
                        onUpdateRule(index, (current) => ({
                          ...current,
                          match: { ...current.match, urls },
                        }));
                      }}
                      placeholder="/v1/orders"
                    />
                  </label>
                </div>
                <div className="rule-subsection">
                  <div className="rule-subheader">
                    <span>Header matchers</span>
                    <button
                      className="icon-btn rule-add-btn"
                      type="button"
                      aria-label="Add header matcher"
                      title="Add header matcher"
                      onClick={() =>
                        onUpdateRule(index, (current) => ({
                          ...current,
                          match: {
                            ...current.match,
                            headers: [...current.match.headers, { name: '', value: '' }],
                          },
                        }))
                      }
                    >
                      <i className="fa-solid fa-plus"></i>
                    </button>
                  </div>
                  {rule.match.headers.length === 0 && <div className="empty">No header matchers</div>}
                  {rule.match.headers.map((matcher, matcherIndex) => (
                    <div className="headers-row rule-headers-row" key={`matcher-${matcherIndex}`}>
                      <input
                        className="header-input header-name-input"
                        type="text"
                        value={matcher.name}
                        placeholder="Header name"
                        onChange={(event) => {
                          const headers = [...rule.match.headers];
                          headers[matcherIndex] = { ...headers[matcherIndex], name: event.target.value };
                          onUpdateRule(index, (current) => ({
                            ...current,
                            match: { ...current.match, headers },
                          }));
                        }}
                      />
                      <input
                        className="header-input header-value-input"
                        type="text"
                        value={matcher.value}
                        placeholder="Header value"
                        onChange={(event) => {
                          const headers = [...rule.match.headers];
                          headers[matcherIndex] = { ...headers[matcherIndex], value: event.target.value };
                          onUpdateRule(index, (current) => ({
                            ...current,
                            match: { ...current.match, headers },
                          }));
                        }}
                      />
                      <button
                        className="icon-btn"
                        type="button"
                        aria-label="Remove header matcher"
                        title="Remove header matcher"
                        onClick={() => {
                          const headers = rule.match.headers.filter((_, idx) => idx !== matcherIndex);
                          onUpdateRule(index, (current) => ({
                            ...current,
                            match: { ...current.match, headers },
                          }));
                        }}
                      >
                        <i className="fa-solid fa-xmark"></i>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rule-section">
                <div className="rule-section-header">
                  <div className="kv-title">ACTIONS</div>
                  <label className="rule-action-label">
                    <select
                      className="rule-action-select"
                      value={rule.actions.type}
                      onChange={(event) => {
                        const type = event.target.value;
                        onUpdateRule(index, (current) => ({
                          ...current,
                          actions: {
                            ...current.actions,
                            type,
                            delayMs: type === 'delay' ? current.actions.delayMs : 0,
                            overrideHeaders: type === 'overrideHeaders' ? current.actions.overrideHeaders : [],
                          },
                        }));
                      }}
                    >
                      <option value="none">None</option>
                      <option value="delay">Wait before continuing</option>
                      <option value="overrideHeaders">Override headers</option>
                      <option value="close">Close the connection</option>
                    </select>
                  </label>
                </div>
                <div className="rule-grid">
                  {rule.actions.type === 'delay' && (
                    <label className="rule-field">
                      <span>Wait (ms)</span>
                      <input
                        type="number"
                        min="0"
                        value={rule.actions.delayMs}
                        onChange={(event) => {
                          const delayMs = Number(event.target.value || 0);
                          onUpdateRule(index, (current) => ({
                            ...current,
                            actions: { ...current.actions, delayMs },
                          }));
                        }}
                      />
                    </label>
                  )}
                </div>
                {rule.actions.type === 'overrideHeaders' && (
                  <div className="rule-subsection">
                    <div className="rule-subheader">
                      <span>Override headers</span>
                      <button
                        className="icon-btn rule-add-btn"
                        type="button"
                        aria-label="Add override header"
                        title="Add override header"
                        onClick={() =>
                          onUpdateRule(index, (current) => ({
                            ...current,
                            actions: {
                              ...current.actions,
                              overrideHeaders: [...current.actions.overrideHeaders, { name: '', value: '' }],
                            },
                          }))
                        }
                      >
                        <i className="fa-solid fa-plus"></i>
                      </button>
                    </div>
                    {rule.actions.overrideHeaders.length === 0 && <div className="empty">No overrides</div>}
                    {rule.actions.overrideHeaders.map((override, overrideIndex) => (
                      <div className="headers-row rule-headers-row" key={`override-${overrideIndex}`}>
                        <input
                          className="header-input header-name-input"
                          type="text"
                          value={override.name}
                          placeholder="Header name"
                          onChange={(event) => {
                            const overrides = [...rule.actions.overrideHeaders];
                            overrides[overrideIndex] = { ...overrides[overrideIndex], name: event.target.value };
                            onUpdateRule(index, (current) => ({
                              ...current,
                              actions: { ...current.actions, overrideHeaders: overrides },
                            }));
                          }}
                        />
                        <input
                          className="header-input header-value-input"
                          type="text"
                          value={override.value}
                          placeholder="Header value"
                          onChange={(event) => {
                            const overrides = [...rule.actions.overrideHeaders];
                            overrides[overrideIndex] = { ...overrides[overrideIndex], value: event.target.value };
                            onUpdateRule(index, (current) => ({
                              ...current,
                              actions: { ...current.actions, overrideHeaders: overrides },
                            }));
                          }}
                        />
                        <button
                          className="icon-btn"
                          type="button"
                          aria-label="Remove override header"
                          title="Remove override header"
                          onClick={() => {
                            const overrides = rule.actions.overrideHeaders.filter((_, idx) => idx !== overrideIndex);
                            onUpdateRule(index, (current) => ({
                              ...current,
                              actions: { ...current.actions, overrideHeaders: overrides },
                            }));
                          }}
                        >
                          <i className="fa-solid fa-xmark"></i>
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

export default RulesView;
