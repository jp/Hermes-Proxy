import React from 'react';

function SetupView({ proxyPort, caPath, onExportCa }) {
  return (
    <div className="app single">
      <section className="panel">
        <div className="header">
          <h1>Setup</h1>
          <span className="status-pill">HTTPS intercept</span>
        </div>
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
      </section>
    </div>
  );
}

export default SetupView;
