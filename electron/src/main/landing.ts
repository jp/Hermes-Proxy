import fs from 'fs';
import { HERMES_HOSTNAME } from './browsers';

/**
 * Responses for http(s)://hermes.proxy/, which the proxy answers itself.
 * Browsers launched from Hermes open this page first: it confirms traffic is
 * flowing through the proxy, checks whether HTTPS is trusted, and lets Firefox
 * users trust the CA in their dedicated profile with one click.
 */

type LandingResponse = { statusCode: number; headers: Record<string, string>; body: string };

const page = (proxyPort: number) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Hermes Proxy</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0f172a;
    color: #e2e8f0; font: 16px/1.55 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
  main { max-width: 560px; padding: 2.5rem 2rem; margin: 1rem; border-radius: 16px;
    background: #111a2e; border: 1px solid rgba(148, 163, 184, 0.2); box-shadow: 0 20px 60px rgba(0,0,0,.4); }
  h1 { margin: 0 0 .4rem; font-size: 1.5rem; }
  p { color: #cbd5e1; margin: .5rem 0; }
  .row { display: flex; align-items: center; gap: .6rem; margin: 1rem 0 .2rem; font-weight: 600; }
  .dot { width: 10px; height: 10px; border-radius: 50%; background: #64748b; flex: none; }
  .ok .dot { background: #4ade80; } .bad .dot { background: #facc15; }
  .btn { display: inline-block; margin-top: .8rem; padding: .6rem 1.1rem; border-radius: 10px; background: #38bdf8;
    color: #0f172a; font-weight: 700; text-decoration: none; }
  code { background: rgba(148,163,184,.15); padding: .1rem .35rem; border-radius: 6px; }
  .hidden { display: none; }
  small { color: #94a3b8; }
</style>
</head>
<body>
<main>
  <h1>You're connected through Hermes Proxy</h1>
  <p>This browser window uses its own profile and sends all traffic through Hermes on port <code>${proxyPort}</code>.
     Your system settings were not changed.</p>
  <div class="row ok"><span class="dot"></span>HTTP interception is working</div>
  <div class="row" id="https"><span class="dot"></span><span id="https-text">Checking HTTPS…</span></div>
  <div id="firefox-help" class="hidden">
    <p>Firefox needs to trust the Hermes certificate authority once for this profile. Click below, tick
       <strong>“Trust this CA to identify websites”</strong> and confirm, then reload this page.</p>
    <a class="btn" href="/ca.crt">Trust Hermes CA in this profile</a>
  </div>
  <p id="other-help" class="hidden">This browser doesn't trust the Hermes certificate authority yet.
     Export it from Hermes → Setup and trust it to intercept HTTPS.</p>
  <p><small>You can come back to this page any time at <code>http://${HERMES_HOSTNAME}</code>.</small></p>
</main>
<script>
  const row = document.getElementById('https');
  const text = document.getElementById('https-text');
  const isFirefox = /firefox/i.test(navigator.userAgent);
  fetch('https://${HERMES_HOSTNAME}/status', { cache: 'no-store' })
    .then((res) => res.ok ? res.json() : Promise.reject())
    .then(() => { row.classList.add('ok'); text.textContent = 'HTTPS interception is working'; })
    .catch(() => {
      row.classList.add('bad');
      text.textContent = 'HTTPS is not trusted yet';
      document.getElementById(isFirefox ? 'firefox-help' : 'other-help').classList.remove('hidden');
    });
</script>
</body>
</html>`;

export const isHermesHost = (hostname: string | undefined | null) =>
  (hostname || '').toLowerCase().split(':')[0] === HERMES_HOSTNAME;

export const buildLandingResponse = (
  pathname: string,
  options: { proxyPort: number; caCertPath: string | null },
): LandingResponse => {
  const noStore = { 'cache-control': 'no-store' };
  if (pathname === '/' || pathname === '') {
    return {
      statusCode: 200,
      headers: { ...noStore, 'content-type': 'text/html; charset=utf-8' },
      body: page(options.proxyPort),
    };
  }
  if (pathname === '/status') {
    return {
      statusCode: 200,
      headers: { ...noStore, 'content-type': 'application/json', 'access-control-allow-origin': '*' },
      body: JSON.stringify({ ok: true }),
    };
  }
  if (pathname === '/ca.crt' && options.caCertPath) {
    return {
      statusCode: 200,
      // This content type makes Firefox offer to trust the CA instead of downloading it.
      headers: { ...noStore, 'content-type': 'application/x-x509-ca-cert' },
      body: fs.readFileSync(options.caCertPath, 'utf8'),
    };
  }
  return { statusCode: 404, headers: { ...noStore, 'content-type': 'text/plain' }, body: 'Not found' };
};
