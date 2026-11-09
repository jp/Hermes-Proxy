import React from 'react';
import type { InstalledBrowser } from '../../types';

const BROWSER_ICONS: Record<string, string> = {
  chrome: 'fa-brands fa-chrome',
  'chrome-canary': 'fa-brands fa-chrome',
  chromium: 'fa-brands fa-chrome',
  edge: 'fa-brands fa-edge',
  brave: 'fa-brands fa-brave',
  opera: 'fa-brands fa-opera',
  firefox: 'fa-brands fa-firefox-browser',
  'firefox-developer': 'fa-brands fa-firefox-browser',
  'firefox-nightly': 'fa-brands fa-firefox-browser',
};

/** Lists installed browsers and starts one pre-configured to use the proxy. */
function BrowserLauncher() {
  const [browsers, setBrowsers] = React.useState<InstalledBrowser[] | null>(null);
  const [launching, setLaunching] = React.useState<string | null>(null);
  const [message, setMessage] = React.useState<{ tone: 'ok' | 'error'; text: string } | null>(null);

  const refresh = React.useCallback((force = false) => {
    const api = window.electronAPI;
    if (!api?.getBrowsers) {
      setBrowsers([]);
      return;
    }
    api
      .getBrowsers(force)
      .then((list) => setBrowsers(Array.isArray(list) ? list : []))
      .catch(() => setBrowsers([]));
  }, []);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  const launch = async (browser: InstalledBrowser) => {
    const api = window.electronAPI;
    if (!api?.launchBrowser) return;
    setLaunching(browser.id);
    setMessage(null);
    try {
      const result = await api.launchBrowser(browser.id);
      setMessage(
        result?.ok
          ? { tone: 'ok', text: `${browser.name} is starting. Its traffic will appear in Intercept.` }
          : { tone: 'error', text: result?.error || `Could not start ${browser.name}.` },
      );
    } catch {
      setMessage({ tone: 'error', text: `Could not start ${browser.name}.` });
    } finally {
      setLaunching(null);
    }
  };

  return (
    <div className="browser-launcher">
      <p>
        <strong>Quickest way: open a browser through Hermes</strong>
        <br />
        Starts a browser in its own profile, already using the proxy and trusting the Hermes CA. Your system settings
        and your normal browser profile are not touched.
      </p>
      {browsers === null && <div className="hint">Looking for installed browsers…</div>}
      {browsers !== null && browsers.length === 0 && (
        <div className="hint">
          No supported browser found (Chrome, Edge, Brave, Chromium, Vivaldi, Opera or Firefox).{' '}
          <button type="button" className="link-btn" onClick={() => refresh(true)}>
            Search again
          </button>
        </div>
      )}
      {browsers !== null && browsers.length > 0 && (
        <div className="browser-buttons">
          {browsers.map((browser) => (
            <button
              key={browser.id}
              type="button"
              className="browser-btn"
              onClick={() => launch(browser)}
              disabled={launching !== null}
              aria-label={`Open ${browser.name} through Hermes`}
            >
              <i className={BROWSER_ICONS[browser.id] || 'fa-solid fa-globe'} aria-hidden="true"></i>
              <span>{launching === browser.id ? 'Starting…' : browser.name}</span>
            </button>
          ))}
        </div>
      )}
      {message && (
        <div className={`launch-message ${message.tone}`} role="status">
          {message.text}
        </div>
      )}
      <div className="hint">
        Firefox asks once per profile to trust the Hermes CA. The page it opens walks you through it.
      </div>
    </div>
  );
}

export default BrowserLauncher;
