import React from 'react';
import type { CaCertificateDetails } from '../../types';

type SetupViewProps = {
  proxyPort: number;
  caPath: string;
  caDetails: CaCertificateDetails | null;
  onExportCa: () => void;
  listenOnAllInterfaces: boolean;
  onListenOnAllInterfacesChange: (enabled: boolean) => void;
  maxCaptureBodySizeMb: number;
  onMaxCaptureBodySizeChange: (value: number) => void;
  settingsBusy: boolean;
};

function SetupView({
  proxyPort,
  caPath,
  caDetails,
  onExportCa,
  listenOnAllInterfaces,
  onListenOnAllInterfacesChange,
  maxCaptureBodySizeMb,
  onMaxCaptureBodySizeChange,
  settingsBusy,
}: SetupViewProps) {
  const proxyHost = listenOnAllInterfaces ? '0.0.0.0' : 'localhost';
  const [maxCaptureBodySizeDraft, setMaxCaptureBodySizeDraft] = React.useState(String(maxCaptureBodySizeMb));
  React.useEffect(() => {
    setMaxCaptureBodySizeDraft(String(maxCaptureBodySizeMb));
  }, [maxCaptureBodySizeMb]);

  const commitMaxCaptureBodySize = () => {
    const parsed = Number(maxCaptureBodySizeDraft);
    if (!Number.isFinite(parsed)) {
      setMaxCaptureBodySizeDraft(String(maxCaptureBodySizeMb));
      return;
    }
    const normalized = Math.max(1, Math.round(parsed));
    setMaxCaptureBodySizeDraft(String(normalized));
    if (normalized !== maxCaptureBodySizeMb) {
      onMaxCaptureBodySizeChange(normalized);
    }
  };

  const formatIdentity = (items: CaCertificateDetails['subject']) =>
    items.map((item) => `${item.shortName || item.name || item.oid}=${item.value}`).join(', ');
  const subjectIdentity = caDetails ? formatIdentity(caDetails.subject) : '';
  const issuerIdentity = caDetails ? formatIdentity(caDetails.issuer) : '';

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
            <code>{`http://${proxyHost}:${proxyPort}`}</code>.
          </p>
          <label className="setup-checkbox">
            <input
              type="checkbox"
              checked={listenOnAllInterfaces}
              disabled={settingsBusy}
              onChange={(event) => onListenOnAllInterfacesChange(event.target.checked)}
            />
            <span>
              Listen on all interfaces (<code>0.0.0.0</code>) for remote clients
            </span>
          </label>
          <label className="setup-field">
            <span>Max captured request/response body size (MB)</span>
            <input
              className="plain-input setup-number-input"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={maxCaptureBodySizeDraft}
              disabled={settingsBusy}
              onChange={(event) => setMaxCaptureBodySizeDraft(event.target.value)}
              onBlur={commitMaxCaptureBodySize}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitMaxCaptureBodySize();
                }
              }}
            />
          </label>
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
          {caDetails && (
            <details className="cert-details">
              <summary>Certificate details</summary>
              <div className="cert-grid">
                <div className="cert-row">
                  <div className="cert-label">Subject</div>
                  <div className="cert-value">{subjectIdentity || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Issuer</div>
                  <div className="cert-value">{issuerIdentity || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Serial (hex)</div>
                  <div className="cert-value">{caDetails.serialNumberHex || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Serial (decimal)</div>
                  <div className="cert-value">{caDetails.serialNumberDecimal || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Version</div>
                  <div className="cert-value">{caDetails.version ?? '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Valid from</div>
                  <div className="cert-value">{caDetails.validFrom || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Valid to</div>
                  <div className="cert-value">{caDetails.validTo || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Signature algorithm</div>
                  <div className="cert-value">{caDetails.signatureAlgorithm || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Fingerprint SHA-256</div>
                  <div className="cert-value">{caDetails.fingerprintSha256 || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Fingerprint SHA-1</div>
                  <div className="cert-value">{caDetails.fingerprintSha1 || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Public key</div>
                  <div className="cert-value">
                    {caDetails.publicKeyAlgorithm}
                    {caDetails.publicKeyBits ? ` ${caDetails.publicKeyBits}-bit` : ''}
                  </div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Public key fingerprint SHA-256</div>
                  <div className="cert-value">{caDetails.publicKeyFingerprintSha256 || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Subject key identifier</div>
                  <div className="cert-value">{caDetails.subjectKeyIdentifier || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Authority key identifier</div>
                  <div className="cert-value">{caDetails.authorityKeyIdentifier || '—'}</div>
                </div>
                <div className="cert-row">
                  <div className="cert-label">Extensions</div>
                  <div className="cert-value">
                    {caDetails.extensions.length ? (
                      <ul className="cert-extension-list">
                        {caDetails.extensions.map((extension) => (
                          <li key={`${extension.oid}-${extension.name}`}>
                            <strong>{extension.name}</strong>
                            {extension.oid ? ` (${extension.oid})` : ''}
                            {extension.critical ? ' [critical]' : ''}
                            {extension.details.length
                              ? `: ${extension.details.map((detail) => `${detail.key}=${detail.value}`).join(', ')}`
                              : ''}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      '—'
                    )}
                  </div>
                </div>
              </div>
            </details>
          )}
        </div>
      </section>
    </div>
  );
}

export default SetupView;
