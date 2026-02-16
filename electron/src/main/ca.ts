import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import forge from 'node-forge';
import { CA_EXTENSIONS, CA_SUBJECT } from './constants';
import type {
  CaCertificateDetails,
  CertificateAttribute,
  CertificateExtensionDetail,
  CertificateExtensionSummary,
} from './types';
import { randomSerialNumber } from './utils';

const getCertCommonName = (pemText: string) => {
  try {
    const cert = forge.pki.certificateFromPem(pemText);
    const field = cert.subject.getField('CN');
    return field?.value || null;
  } catch (err) {
    return null;
  }
};

const toHexPairs = (value: string) => {
  const normalized = value.replace(/[^0-9a-f]/gi, '').toUpperCase();
  if (!normalized) return '';
  const pairs = normalized.match(/.{1,2}/g);
  return pairs ? pairs.join(':') : normalized;
};

const stringToHexPairs = (value: string) => {
  try {
    return toHexPairs(forge.util.bytesToHex(value));
  } catch (err) {
    return '';
  }
};

const formatFingerprint = (buffer: Buffer, algorithm: 'sha1' | 'sha256') =>
  toHexPairs(crypto.createHash(algorithm).update(buffer).digest('hex'));

const isPrintableText = (value: string) => /^[\x20-\x7E]+$/.test(value);

const truncate = (value: string, max = 240) => (value.length > max ? `${value.slice(0, max)}...` : value);

const stringifyValue = (value: unknown): string => {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (/^[0-9a-f]+$/i.test(trimmed) && trimmed.length % 2 === 0) {
      return toHexPairs(trimmed);
    }
    if (isPrintableText(trimmed)) {
      return truncate(trimmed);
    }
    const asHex = stringToHexPairs(trimmed);
    return asHex || truncate(trimmed);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => stringifyValue(item)).filter(Boolean).join(', ');
  }
  if (typeof value === 'object') {
    try {
      return truncate(JSON.stringify(value));
    } catch (err) {
      return '[unserializable]';
    }
  }
  return String(value);
};

const mapAttributes = (attributes: any[]): CertificateAttribute[] =>
  (attributes || [])
    .map((attribute) => ({
      name: String(attribute?.name || ''),
      shortName: String(attribute?.shortName || ''),
      oid: String(attribute?.type || ''),
      value: String(attribute?.value || ''),
    }))
    .filter((attribute) => Boolean(attribute.value));

const getExtensionDetails = (extension: any): CertificateExtensionDetail[] => {
  if (!extension || typeof extension !== 'object') return [];
  const details: CertificateExtensionDetail[] = [];
  const ignored = new Set(['id', 'name', 'critical']);

  Object.entries(extension).forEach(([key, value]) => {
    if (ignored.has(key)) return;
    const displayValue = stringifyValue(value);
    if (!displayValue) return;
    details.push({ key, value: displayValue });
  });

  return details;
};

const mapExtensions = (extensions: any[]): CertificateExtensionSummary[] =>
  (extensions || []).map((extension) => ({
    name: String(extension?.name || 'unknown'),
    oid: String(extension?.id || ''),
    critical: Boolean(extension?.critical),
    details: getExtensionDetails(extension),
  }));

const toDecimalSerial = (serialHex: string) => {
  if (!serialHex) return '';
  try {
    return BigInt(`0x${serialHex.replace(/[^0-9a-f]/gi, '')}`).toString(10);
  } catch (err) {
    return '';
  }
};

const parseSignatureAlgorithm = (cert: any) => {
  const oid = String(cert?.siginfo?.algorithmOid || cert?.signatureOid || '');
  if (!oid) return '';
  const name = (forge.pki.oids as Record<string, string | undefined>)[oid];
  return name ? `${name} (${oid})` : oid;
};

const parsePublicKeyInfo = (cert: any) => {
  const publicKey = cert?.publicKey;
  let publicKeyAlgorithm = 'Unknown';
  let publicKeyBits: number | null = null;
  if (publicKey?.n && typeof publicKey.n.bitLength === 'function') {
    publicKeyAlgorithm = 'RSA';
    publicKeyBits = publicKey.n.bitLength();
  }

  let publicKeyFingerprintSha256 = '';
  try {
    const publicKeyAsn1 = forge.pki.publicKeyToAsn1(publicKey);
    const publicKeyDer = forge.asn1.toDer(publicKeyAsn1).getBytes();
    const publicKeyBuffer = Buffer.from(publicKeyDer, 'binary');
    publicKeyFingerprintSha256 = formatFingerprint(publicKeyBuffer, 'sha256');
  } catch (err) {
    publicKeyFingerprintSha256 = '';
  }

  return {
    publicKeyAlgorithm,
    publicKeyBits,
    publicKeyFingerprintSha256,
  };
};

const parseIdentifierExtension = (cert: any, extensionName: string, fieldName: string) => {
  const extension = cert?.getExtension?.(extensionName);
  if (!extension) return '';
  const rawValue = extension[fieldName];
  if (typeof rawValue === 'string') {
    if (/^[0-9a-f:]+$/i.test(rawValue)) return toHexPairs(rawValue);
    return stringToHexPairs(rawValue) || rawValue;
  }
  return stringifyValue(rawValue);
};

const toPkcs8Pem = (pemText: string) =>
  crypto.createPrivateKey(pemText).export({ type: 'pkcs8', format: 'pem' }).toString();

const getCertPublicKeyDigest = (certPem: string) => {
  const publicKeyDer = crypto.createPublicKey(certPem).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(publicKeyDer).digest('hex');
};

const getPrivateKeyPublicDigest = (privateKeyPem: string) => {
  const privateKey = crypto.createPrivateKey(privateKeyPem);
  const publicKeyDer = crypto.createPublicKey(privateKey).export({ type: 'spki', format: 'der' });
  return crypto.createHash('sha256').update(publicKeyDer).digest('hex');
};

const isCaKeyPairValid = (certPem: string, privateKeyPem: string) => {
  try {
    return getCertPublicKeyDigest(certPem) === getPrivateKeyPublicDigest(privateKeyPem);
  } catch (err) {
    return false;
  }
};

const purgeLeafCertificates = (certsDir: string, keysDir: string) => {
  const certs = fs.readdirSync(certsDir);
  certs.forEach((fileName) => {
    if (!fileName.endsWith('.pem')) return;
    if (fileName === 'ca.pem') return;
    try {
      fs.unlinkSync(path.join(certsDir, fileName));
    } catch (err) {
      // Keep startup resilient even if a stale file can't be removed.
    }
  });

  const keys = fs.readdirSync(keysDir);
  keys.forEach((fileName) => {
    if (fileName === 'ca.private.key' || fileName === 'ca.public.key') return;
    try {
      fs.unlinkSync(path.join(keysDir, fileName));
    } catch (err) {
      // Keep startup resilient even if a stale file can't be removed.
    }
  });
};

export const ensureHermesCa = async (caDir: string) => {
  const certsDir = path.join(caDir, 'certs');
  const keysDir = path.join(caDir, 'keys');
  const certPath = path.join(certsDir, 'ca.pem');
  const privateKeyPath = path.join(keysDir, 'ca.private.key');
  const publicKeyPath = path.join(keysDir, 'ca.public.key');
  fs.mkdirSync(certsDir, { recursive: true });
  fs.mkdirSync(keysDir, { recursive: true });

  if (fs.existsSync(certPath) && fs.existsSync(privateKeyPath)) {
    const pemText = fs.readFileSync(certPath, 'utf8');
    const commonName = getCertCommonName(pemText);
    if (commonName === 'HermesProxyCA') {
      const keyPem = fs.readFileSync(privateKeyPath, 'utf8');
      try {
        const pkcs8Pem = toPkcs8Pem(keyPem);
        if (isCaKeyPairValid(pemText, pkcs8Pem)) {
          if (pkcs8Pem !== keyPem) {
            fs.writeFileSync(privateKeyPath, pkcs8Pem);
          }
          const publicKeyPem = crypto.createPublicKey(crypto.createPrivateKey(pkcs8Pem)).export({
            type: 'spki',
            format: 'pem',
          });
          fs.writeFileSync(publicKeyPath, publicKeyPem);
          return;
        }
      } catch (err) {
        // Re-generate if key format or key pair is invalid.
      }
    }
  }

  purgeLeafCertificates(certsDir, keysDir);

  const keys = await new Promise<{ publicKey: unknown; privateKey: unknown }>((resolve, reject) => {
    forge.pki.rsa.generateKeyPair({ bits: 2048 }, (err: Error | null, keyPair: any) => {
      if (err) {
        reject(err);
        return;
      }
      resolve(keyPair);
    });
  });
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = randomSerialNumber();
  cert.validity.notBefore = new Date();
  cert.validity.notBefore.setDate(cert.validity.notBefore.getDate() - 1);
  cert.validity.notAfter = new Date();
  cert.validity.notAfter.setFullYear(cert.validity.notBefore.getFullYear() + 10);
  cert.setSubject(CA_SUBJECT);
  cert.setIssuer(CA_SUBJECT);
  cert.setExtensions(CA_EXTENSIONS);
  cert.sign(keys.privateKey, forge.md.sha256.create());

  fs.writeFileSync(certPath, forge.pki.certificateToPem(cert));
  const pkcs8Pem = toPkcs8Pem(forge.pki.privateKeyToPem(keys.privateKey));
  fs.writeFileSync(privateKeyPath, pkcs8Pem);
  fs.writeFileSync(publicKeyPath, forge.pki.publicKeyToPem(keys.publicKey));
};

export const pemToDer = (pemText: string) => {
  if (!pemText) return null;
  const match = pemText.match(/-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/);
  if (!match) return null;
  const b64 = match[1].replace(/\s+/g, '');
  try {
    return Buffer.from(b64, 'base64');
  } catch (err) {
    return null;
  }
};

export const getCaCertificateDetails = (caCertPath: string): CaCertificateDetails | null => {
  if (!caCertPath || !fs.existsSync(caCertPath)) return null;
  try {
    const pemText = fs.readFileSync(caCertPath, 'utf8');
    const cert = forge.pki.certificateFromPem(pemText);
    const derBuffer = pemToDer(pemText);
    if (!derBuffer) return null;

    const serialNumberHex = String(cert?.serialNumber || '').toUpperCase();
    const { publicKeyAlgorithm, publicKeyBits, publicKeyFingerprintSha256 } = parsePublicKeyInfo(cert);

    return {
      subject: mapAttributes(cert?.subject?.attributes || []),
      issuer: mapAttributes(cert?.issuer?.attributes || []),
      serialNumberHex,
      serialNumberDecimal: toDecimalSerial(serialNumberHex),
      version: typeof cert?.version === 'number' ? cert.version + 1 : null,
      validFrom: cert?.validity?.notBefore ? new Date(cert.validity.notBefore).toISOString() : '',
      validTo: cert?.validity?.notAfter ? new Date(cert.validity.notAfter).toISOString() : '',
      signatureAlgorithm: parseSignatureAlgorithm(cert),
      fingerprintSha256: formatFingerprint(derBuffer, 'sha256'),
      fingerprintSha1: formatFingerprint(derBuffer, 'sha1'),
      publicKeyAlgorithm,
      publicKeyBits,
      publicKeyFingerprintSha256,
      subjectKeyIdentifier: parseIdentifierExtension(cert, 'subjectKeyIdentifier', 'subjectKeyIdentifier'),
      authorityKeyIdentifier: parseIdentifierExtension(cert, 'authorityKeyIdentifier', 'keyIdentifier'),
      extensions: mapExtensions(cert?.extensions || []),
    };
  } catch (err) {
    return null;
  }
};
