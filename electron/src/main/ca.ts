import fs from 'fs';
import path from 'path';
import forge from 'node-forge';
import { CA_EXTENSIONS, CA_SUBJECT } from './constants';
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

export const ensureHermesCa = async (caDir: string) => {
  const certsDir = path.join(caDir, 'certs');
  const keysDir = path.join(caDir, 'keys');
  const certPath = path.join(certsDir, 'ca.pem');
  const privateKeyPath = path.join(keysDir, 'ca.private.key');
  const publicKeyPath = path.join(keysDir, 'ca.public.key');
  fs.mkdirSync(certsDir, { recursive: true });
  fs.mkdirSync(keysDir, { recursive: true });

  if (fs.existsSync(certPath)) {
    const pemText = fs.readFileSync(certPath, 'utf8');
    const commonName = getCertCommonName(pemText);
    if (commonName === 'HermesProxyCA') {
      return;
    }
  }

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
  fs.writeFileSync(privateKeyPath, forge.pki.privateKeyToPem(keys.privateKey));
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
