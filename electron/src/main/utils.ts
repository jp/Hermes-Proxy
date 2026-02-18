import crypto from 'crypto';

export const randomSerialNumber = () => {
  // X.509 serials are signed INTEGERs in ASN.1. Keep MSB clear to ensure positive values.
  const bytes = crypto.randomBytes(16);
  bytes[0] &= 0x7f;
  if (bytes[0] === 0) {
    bytes[0] = 0x01;
  }
  return bytes.toString('hex');
};

export const isTimeoutError = (err: unknown) => {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: string }).code || '').toUpperCase();
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ETIMEOUT'].includes(code)) return true;
  return /timeout/i.test(String((err as { message?: string }).message || ''));
};
