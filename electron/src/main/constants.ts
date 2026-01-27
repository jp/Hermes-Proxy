export const HISTORY_LIMIT = 500;
export const PROXY_PORT_START = 8000;
export const RULE_TIMEOUT_MS = 30000;
export const RULES_FILENAME = 'rules.json';

export const CA_SUBJECT = [
  { name: 'commonName', value: 'HermesProxyCA' },
  { name: 'countryName', value: 'Internet' },
  { shortName: 'ST', value: 'Internet' },
  { name: 'localityName', value: 'Internet' },
  { name: 'organizationName', value: 'Hermes Proxy' },
  { shortName: 'OU', value: 'CA' },
];

export const CA_EXTENSIONS = [
  { name: 'basicConstraints', cA: true },
  {
    name: 'keyUsage',
    keyCertSign: true,
    digitalSignature: true,
    nonRepudiation: true,
    keyEncipherment: true,
    dataEncipherment: true,
  },
  {
    name: 'extKeyUsage',
    serverAuth: true,
    clientAuth: true,
    codeSigning: true,
    emailProtection: true,
    timeStamping: true,
  },
  {
    name: 'nsCertType',
    client: true,
    server: true,
    email: true,
    objs: true,
    sslCA: true,
    emailCA: true,
    objCA: true,
  },
  { name: 'subjectKeyIdentifier' },
];
