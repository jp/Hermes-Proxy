import fs from 'fs';
import path from 'path';
import { spawn, type ChildProcess } from 'child_process';
import { generateSPKIFingerprint } from 'mockttp';

/**
 * Finds browsers installed on this machine and launches them pre-configured to
 * use Hermes Proxy, in a dedicated profile, so the system proxy settings and
 * certificate store are never touched.
 */

export type BrowserFamily = 'chromium' | 'firefox';

export interface BrowserCandidate {
  id: string;
  name: string;
  family: BrowserFamily;
  paths: {
    darwin?: string[];
    win32?: string[];
    linux?: string[];
  };
}

export interface DetectedBrowser {
  id: string;
  name: string;
  family: BrowserFamily;
  executablePath: string;
}

// Hostname answered by the proxy itself (landing page + CA download), see proxy.ts.
export const HERMES_HOSTNAME = 'hermes.proxy';
export const HERMES_LANDING_URL = `http://${HERMES_HOSTNAME}/`;

const mac = (app: string, binary: string) => [
  `/Applications/${app}.app/Contents/MacOS/${binary}`,
  `~/Applications/${app}.app/Contents/MacOS/${binary}`,
];
const win = (...relative: string[]) =>
  relative.flatMap((rel) => [`%PROGRAMFILES%\\${rel}`, `%PROGRAMFILES(X86)%\\${rel}`, `%LOCALAPPDATA%\\${rel}`]);
const linux = (...binaries: string[]) => binaries.map((binary) => `$PATH/${binary}`);

export const BROWSER_CANDIDATES: BrowserCandidate[] = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    family: 'chromium',
    paths: {
      darwin: mac('Google Chrome', 'Google Chrome'),
      win32: win('Google\\Chrome\\Application\\chrome.exe'),
      linux: linux('google-chrome', 'google-chrome-stable'),
    },
  },
  {
    id: 'chrome-canary',
    name: 'Chrome Canary',
    family: 'chromium',
    paths: {
      darwin: mac('Google Chrome Canary', 'Google Chrome Canary'),
      win32: win('Google\\Chrome SxS\\Application\\chrome.exe'),
    },
  },
  {
    id: 'chromium',
    name: 'Chromium',
    family: 'chromium',
    paths: {
      darwin: mac('Chromium', 'Chromium'),
      win32: win('Chromium\\Application\\chrome.exe'),
      linux: linux('chromium', 'chromium-browser'),
    },
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    family: 'chromium',
    paths: {
      darwin: mac('Microsoft Edge', 'Microsoft Edge'),
      win32: win('Microsoft\\Edge\\Application\\msedge.exe'),
      linux: linux('microsoft-edge', 'microsoft-edge-stable'),
    },
  },
  {
    id: 'brave',
    name: 'Brave',
    family: 'chromium',
    paths: {
      darwin: mac('Brave Browser', 'Brave Browser'),
      win32: win('BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      linux: linux('brave-browser', 'brave'),
    },
  },
  {
    id: 'vivaldi',
    name: 'Vivaldi',
    family: 'chromium',
    paths: {
      darwin: mac('Vivaldi', 'Vivaldi'),
      win32: win('Vivaldi\\Application\\vivaldi.exe'),
      linux: linux('vivaldi', 'vivaldi-stable'),
    },
  },
  {
    id: 'opera',
    name: 'Opera',
    family: 'chromium',
    paths: {
      darwin: mac('Opera', 'Opera'),
      win32: win('Programs\\Opera\\opera.exe'),
      linux: linux('opera'),
    },
  },
  {
    id: 'firefox',
    name: 'Firefox',
    family: 'firefox',
    paths: {
      darwin: mac('Firefox', 'firefox'),
      win32: win('Mozilla Firefox\\firefox.exe'),
      linux: linux('firefox'),
    },
  },
  {
    id: 'firefox-developer',
    name: 'Firefox Developer Edition',
    family: 'firefox',
    paths: {
      darwin: mac('Firefox Developer Edition', 'firefox'),
      win32: win('Firefox Developer Edition\\firefox.exe'),
      linux: linux('firefox-developer-edition'),
    },
  },
  {
    id: 'firefox-nightly',
    name: 'Firefox Nightly',
    family: 'firefox',
    paths: {
      darwin: mac('Firefox Nightly', 'firefox'),
      win32: win('Firefox Nightly\\firefox.exe'),
      linux: linux('firefox-nightly'),
    },
  },
];

export interface DetectionEnv {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeDir: string;
  isExecutable: (filePath: string) => boolean;
}

/** Expands `~`, `%VAR%` and `$PATH/` placeholders into concrete candidate paths. */
export const expandCandidatePath = (pattern: string, detection: DetectionEnv): string[] => {
  if (pattern.startsWith('$PATH/')) {
    const binary = pattern.slice('$PATH/'.length);
    const separator = detection.platform === 'win32' ? ';' : ':';
    return (detection.env.PATH || '')
      .split(separator)
      .filter(Boolean)
      .map((dir) => path.join(dir, binary));
  }
  if (pattern.startsWith('~/')) {
    return [path.join(detection.homeDir, pattern.slice(2))];
  }
  const match = /^%([^%]+)%\\(.*)$/.exec(pattern);
  if (match) {
    const base = detection.env[match[1]] ?? detection.env[match[1].toUpperCase()];
    return base ? [path.win32.join(base, match[2])] : [];
  }
  return [pattern];
};

export const detectBrowsers = (detection: DetectionEnv): DetectedBrowser[] => {
  const platform = detection.platform as keyof BrowserCandidate['paths'];
  const detected: DetectedBrowser[] = [];
  for (const candidate of BROWSER_CANDIDATES) {
    const patterns = candidate.paths[platform] || [];
    const executablePath = patterns
      .flatMap((pattern) => expandCandidatePath(pattern, detection))
      .find((candidatePath) => detection.isExecutable(candidatePath));
    if (executablePath) {
      detected.push({ id: candidate.id, name: candidate.name, family: candidate.family, executablePath });
    }
  }
  return detected;
};

export const isExecutableFile = (filePath: string) => {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return false;
    if (process.platform === 'win32') return true;
    fs.accessSync(filePath, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
};

export const buildChromiumArgs = (options: {
  profileDir: string;
  proxyPort: number;
  spkiFingerprint: string;
  startUrl?: string;
}) => [
  `--user-data-dir=${options.profileDir}`,
  `--proxy-server=http://127.0.0.1:${options.proxyPort}`,
  // Chromium skips the proxy for localhost unless told otherwise.
  '--proxy-bypass-list=<-loopback>',
  // Trust certificates signed by the Hermes CA in this browser only.
  `--ignore-certificate-errors-spki-list=${options.spkiFingerprint}`,
  // Hides the "unsupported command-line flag" warning bar caused by the flag above.
  '--test-type',
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-background-mode',
  ...(options.startUrl ? [options.startUrl] : []),
];

export const buildFirefoxPrefs = (proxyPort: number) => {
  const prefs: Record<string, string | number | boolean> = {
    'network.proxy.type': 1,
    'network.proxy.http': '127.0.0.1',
    'network.proxy.http_port': proxyPort,
    'network.proxy.ssl': '127.0.0.1',
    'network.proxy.ssl_port': proxyPort,
    'network.proxy.share_proxy_settings': true,
    'network.proxy.no_proxies_on': '',
    'network.proxy.allow_hijacking_localhost': true,
    // DNS-over-HTTPS would bypass the proxy for name resolution.
    'network.trr.mode': 5,
    'browser.shell.checkDefaultBrowser': false,
    'browser.aboutwelcome.enabled': false,
    'datareporting.policy.dataSubmissionPolicyBypassNotification': true,
    'trailhead.firstrun.didSeeAboutWelcome': true,
    'browser.startup.homepage_override.mstone': 'ignore',
  };
  return `${Object.entries(prefs)
    .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
    .join('\n')}\n`;
};

export const buildFirefoxArgs = (options: { profileDir: string; startUrl?: string }) => [
  '-profile',
  options.profileDir,
  '-no-remote',
  '-new-instance',
  ...(options.startUrl ? [options.startUrl] : []),
];

const launched = new Set<ChildProcess>();

export interface LaunchOptions {
  browser: DetectedBrowser;
  proxyPort: number;
  caCertPath: string;
  profilesRoot: string;
}

/** Starts the browser; resolves once the process has spawned, rejects if it could not start. */
export const launchBrowser = async ({ browser, proxyPort, caCertPath, profilesRoot }: LaunchOptions) => {
  const profileDir = path.join(profilesRoot, browser.id);
  fs.mkdirSync(profileDir, { recursive: true });

  const caPem = fs.readFileSync(caCertPath, 'utf8');
  const spkiFingerprint = await generateSPKIFingerprint(caPem);

  // Show the Hermes landing page the first time a profile is used with this CA.
  // For Firefox it is also where the CA gets trusted.
  const markerPath = path.join(profileDir, `.hermes-ca-${spkiFingerprint.replace(/[^a-z0-9]/gi, '').slice(0, 24)}`);
  const firstRunWithCa = !fs.existsSync(markerPath);
  const startUrl = firstRunWithCa ? HERMES_LANDING_URL : undefined;

  let args: string[];
  if (browser.family === 'firefox') {
    fs.writeFileSync(path.join(profileDir, 'user.js'), buildFirefoxPrefs(proxyPort), 'utf8');
    args = buildFirefoxArgs({ profileDir, startUrl });
  } else {
    args = buildChromiumArgs({ profileDir, proxyPort, spkiFingerprint, startUrl });
  }

  const child = spawn(browser.executablePath, args, { stdio: 'ignore', detached: false });
  await new Promise<void>((resolve, reject) => {
    child.once('spawn', () => resolve());
    child.once('error', reject);
  });
  launched.add(child);
  child.once('exit', () => launched.delete(child));
  if (firstRunWithCa) fs.writeFileSync(markerPath, new Date().toISOString(), 'utf8');
  return { pid: child.pid };
};

/** Browsers launched by Hermes can't reach anything once the proxy is gone, so close them with the app. */
export const closeLaunchedBrowsers = () => {
  for (const child of launched) {
    try {
      child.kill();
    } catch {
      // Already gone.
    }
  }
  launched.clear();
};
