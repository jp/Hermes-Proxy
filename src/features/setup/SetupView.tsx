import React, { useState } from 'react';

type SetupViewProps = {
  proxyPort: number;
  caPath: string;
  onExportCa: () => void;
  mcpEnabled: boolean;
  mcpAgentConfig: string;
  onToggleMcp: (enabled: boolean) => void;
};

function SetupView({ proxyPort, caPath, onExportCa, mcpEnabled, mcpAgentConfig, onToggleMcp }: SetupViewProps) {
  const [activeTab, setActiveTab] = useState<'ca' | 'mcp'>('ca');
  const [copyStatus, setCopyStatus] = useState('');
  return (
    <div className="app single">
      <section className="panel">
        <div className="header">
          <h1>Setup</h1>
          <span className="status-pill">HTTPS intercept</span>
        </div>
        <div className="view-tabs" role="tablist" aria-label="Setup tabs">
          <button
            className={`view-tab ${activeTab === 'ca' ? 'active' : ''}`}
            onClick={() => setActiveTab('ca')}
            role="tab"
            aria-selected={activeTab === 'ca'}
          >
            HTTPS CA
          </button>
          <button
            className={`view-tab ${activeTab === 'mcp' ? 'active' : ''}`}
            onClick={() => setActiveTab('mcp')}
            role="tab"
            aria-selected={activeTab === 'mcp'}
          >
            MCP Server
          </button>
        </div>
        {activeTab === 'ca' ? (
          <div className="setup-text">
            <p>
              <strong>1. Send traffic via Hermes Proxy</strong>
              <br />
              To intercept an HTTP client on this machine, configure it to send traffic via{' '}
              <code>{`http://localhost:${proxyPort}`}</code>.
            </p>
            <p>
              Most tools can be configured to do so by using the above address as an HTTP or HTTPS proxy. You can also
              forcibly reroute traffic using networking tools like <code>iptables</code>.
            </p>
            <p>Remote clients (e.g. phones) should use this machine&apos;s IP address instead of localhost.</p>
            <p>
              <strong>2. Trust the certificate authority</strong>
              <br />
              Only required to intercept traffic that uses HTTPS.
            </p>
            <p>
              Hermes Proxy generated a certificate authority (CA) on your machine. All intercepted HTTPS uses
              certificates signed by this CA.
            </p>
            <p>
              <button
                className="export-btn"
                onClick={onExportCa}
                disabled={!caPath}
                title={caPath || 'Still generating CA'}
              >
                Export CA certificate
              </button>
            </p>
            <p>
              To intercept HTTPS traffic you need to configure your HTTP client to trust this certificate as a
              certificate authority, or temporarily disable certificate checks.
            </p>
            {caPath && (
              <div className="hint">
                CA location: <code>{caPath}</code>
              </div>
            )}
          </div>
        ) : (
          <div className="setup-text">
            <p>
              <strong>MCP server status</strong>
              <br />
              Toggle the in-process MCP server on or off. When disabled, traffic is no longer indexed or queryable.
            </p>
            <p>
              <label className="toggle-field">
                <input type="checkbox" checked={mcpEnabled} onChange={(e) => onToggleMcp(e.target.checked)} />
                Enable MCP server
              </label>
            </p>
            <p>
              <strong>AI agent config</strong>
              <br />
              Use the bridge CLI so external agents can query Hermes without running inside Electron.
            </p>
            <pre className="plain-pre">{mcpAgentConfig || '{ }'}</pre>
            <p>
              <button
                className="export-btn"
                type="button"
                onClick={() => {
                  if (!mcpAgentConfig) return;
                  navigator.clipboard?.writeText(mcpAgentConfig).then(
                    () => {
                      setCopyStatus('Copied.');
                      setTimeout(() => setCopyStatus(''), 1500);
                    },
                    () => {
                      setCopyStatus('Copy failed.');
                      setTimeout(() => setCopyStatus(''), 2000);
                    }
                  );
                }}
                disabled={!mcpAgentConfig}
              >
                Copy config
              </button>
            </p>
            {copyStatus && <div className="hint">{copyStatus}</div>}
          </div>
        )}
      </section>
    </div>
  );
}

export default SetupView;
