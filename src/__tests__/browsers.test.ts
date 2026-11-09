// @vitest-environment node
import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { generateCACertificate, generateSPKIFingerprint } from 'mockttp';
import {
  buildChromiumArgs,
  buildFirefoxPrefs,
  closeLaunchedBrowsers,
  detectBrowsers,
  expandCandidatePath,
  HERMES_LANDING_URL,
  launchBrowser,
  type DetectionEnv,
} from '../../electron/src/main/browsers';
import { buildLandingResponse, isHermesHost } from '../../electron/src/main/landing';

const envFor = (platform: NodeJS.Platform, existing: string[], env: Record<string, string> = {}): DetectionEnv => ({
  platform,
  env,
  homeDir: '/Users/me',
  isExecutable: (filePath) => existing.includes(filePath),
});

describe('detectBrowsers', () => {
  it('finds macOS app bundles in /Applications and ~/Applications', () => {
    const found = detectBrowsers(
      envFor('darwin', [
        '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
        '/Users/me/Applications/Firefox.app/Contents/MacOS/firefox',
      ]),
    );
    expect(found).toEqual([
      {
        id: 'chrome',
        name: 'Google Chrome',
        family: 'chromium',
        executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      },
      {
        id: 'firefox',
        name: 'Firefox',
        family: 'firefox',
        executablePath: '/Users/me/Applications/Firefox.app/Contents/MacOS/firefox',
      },
    ]);
  });

  it('expands Windows program folders, including per-user installs', () => {
    const found = detectBrowsers(
      envFor('win32', ['C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'], {
        PROGRAMFILES: 'C:\\Program Files',
        LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local',
      }),
    );
    expect(found.map((browser) => [browser.id, browser.executablePath])).toEqual([
      ['chrome', 'C:\\Users\\me\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe'],
    ]);
  });

  it('searches PATH on Linux and returns each browser once', () => {
    const found = detectBrowsers(
      envFor('linux', ['/usr/bin/chromium', '/snap/bin/firefox', '/usr/local/bin/chromium'], {
        PATH: '/usr/local/bin:/usr/bin:/snap/bin',
      }),
    );
    expect(found.map((browser) => [browser.id, browser.executablePath])).toEqual([
      ['chromium', '/usr/local/bin/chromium'],
      ['firefox', '/snap/bin/firefox'],
    ]);
  });

  it('returns nothing when no browser is installed', () => {
    expect(detectBrowsers(envFor('darwin', []))).toEqual([]);
  });

  it('skips Windows paths whose environment variable is missing', () => {
    expect(expandCandidatePath('%PROGRAMFILES(X86)%\\Foo\\foo.exe', envFor('win32', []))).toEqual([]);
  });
});

describe('launch configuration', () => {
  it('points Chromium at the proxy, a private profile and the Hermes CA', () => {
    const args = buildChromiumArgs({ profileDir: '/tmp/p', proxyPort: 8123, spkiFingerprint: 'abc=', startUrl: 'http://x/' });
    expect(args).toEqual(
      expect.arrayContaining([
        '--user-data-dir=/tmp/p',
        '--proxy-server=http://127.0.0.1:8123',
        '--proxy-bypass-list=<-loopback>',
        '--ignore-certificate-errors-spki-list=abc=',
      ]),
    );
    expect(args[args.length - 1]).toBe('http://x/');
  });

  it('writes Firefox proxy prefs for HTTP and HTTPS, including localhost', () => {
    const prefs = buildFirefoxPrefs(8123);
    expect(prefs).toContain('user_pref("network.proxy.type", 1);');
    expect(prefs).toContain('user_pref("network.proxy.http_port", 8123);');
    expect(prefs).toContain('user_pref("network.proxy.ssl_port", 8123);');
    expect(prefs).toContain('user_pref("network.proxy.allow_hijacking_localhost", true);');
    expect(prefs).toContain('user_pref("network.proxy.no_proxies_on", "");');
  });
});

describe('launchBrowser', () => {
  let workDir: string;
  let caCertPath: string;
  let fingerprint: string;

  beforeEach(async () => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-browser-test-'));
    const ca = await generateCACertificate();
    caCertPath = path.join(workDir, 'ca.pem');
    fs.writeFileSync(caCertPath, ca.cert);
    fingerprint = await generateSPKIFingerprint(ca.cert);
  });

  afterEach(() => {
    closeLaunchedBrowsers();
    fs.rmSync(workDir, { recursive: true, force: true });
  });

  // A fake "browser" that records the arguments it was started with.
  const fakeBrowser = (family: 'chromium' | 'firefox') => {
    const argsFile = path.join(workDir, `${family}-args.txt`);
    const executablePath = path.join(workDir, `${family}.sh`);
    fs.writeFileSync(executablePath, `#!/bin/sh\nprintf '%s\\n' "$@" > '${argsFile}'\n`, { mode: 0o755 });
    return { browser: { id: family, name: family, family, executablePath }, argsFile };
  };

  const readArgs = async (argsFile: string) => {
    for (let attempt = 0; attempt < 50 && !fs.existsSync(argsFile); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    return fs.readFileSync(argsFile, 'utf8').trim().split('\n');
  };

  it.skipIf(process.platform === 'win32')('starts Chromium with the CA fingerprint and the landing page once', async () => {
    const { browser, argsFile } = fakeBrowser('chromium');
    const profilesRoot = path.join(workDir, 'profiles');

    await launchBrowser({ browser, proxyPort: 8123, caCertPath, profilesRoot });
    const firstArgs = await readArgs(argsFile);
    expect(firstArgs).toContain(`--ignore-certificate-errors-spki-list=${fingerprint}`);
    expect(firstArgs).toContain(`--user-data-dir=${path.join(profilesRoot, 'chromium')}`);
    expect(firstArgs[firstArgs.length - 1]).toBe(HERMES_LANDING_URL);

    fs.rmSync(argsFile);
    await launchBrowser({ browser, proxyPort: 8123, caCertPath, profilesRoot });
    const secondArgs = await readArgs(argsFile);
    expect(secondArgs).not.toContain(HERMES_LANDING_URL);
  });

  it.skipIf(process.platform === 'win32')('starts Firefox with a profile containing proxy prefs', async () => {
    const { browser, argsFile } = fakeBrowser('firefox');
    const profilesRoot = path.join(workDir, 'profiles');

    await launchBrowser({ browser, proxyPort: 9001, caCertPath, profilesRoot });
    const args = await readArgs(argsFile);
    const profileDir = path.join(profilesRoot, 'firefox');
    expect(args.slice(0, 2)).toEqual(['-profile', profileDir]);
    expect(args).toContain(HERMES_LANDING_URL);
    expect(fs.readFileSync(path.join(profileDir, 'user.js'), 'utf8')).toContain('"network.proxy.http_port", 9001');
  });

  it('rejects when the executable cannot be started', async () => {
    await expect(
      launchBrowser({
        browser: { id: 'ghost', name: 'Ghost', family: 'chromium', executablePath: path.join(workDir, 'missing') },
        proxyPort: 8000,
        caCertPath,
        profilesRoot: path.join(workDir, 'profiles'),
      }),
    ).rejects.toThrow();
  });
});

describe('hermes.proxy landing page', () => {
  it('recognises the hermes.proxy host', () => {
    expect(isHermesHost('hermes.proxy')).toBe(true);
    expect(isHermesHost('HERMES.PROXY:443')).toBe(true);
    expect(isHermesHost('example.com')).toBe(false);
  });

  it('serves the landing page, a CORS status check and the CA', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hermes-landing-'));
    const caCertPath = path.join(dir, 'ca.pem');
    fs.writeFileSync(caCertPath, '-----BEGIN CERTIFICATE-----\nabc\n-----END CERTIFICATE-----\n');
    try {
      const landing = buildLandingResponse('/', { proxyPort: 8123, caCertPath });
      expect(landing.statusCode).toBe(200);
      expect(landing.body).toContain('8123');

      const status = buildLandingResponse('/status', { proxyPort: 8123, caCertPath });
      expect(status.headers['access-control-allow-origin']).toBe('*');

      const ca = buildLandingResponse('/ca.crt', { proxyPort: 8123, caCertPath });
      expect(ca.headers['content-type']).toBe('application/x-x509-ca-cert');
      expect(ca.body).toContain('BEGIN CERTIFICATE');

      expect(buildLandingResponse('/nope', { proxyPort: 8123, caCertPath }).statusCode).toBe(404);
      expect(buildLandingResponse('/ca.crt', { proxyPort: 8123, caCertPath: null }).statusCode).toBe(404);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
