export const randomSerialNumber = () => {
  let serial = '';
  for (let i = 0; i < 4; i += 1) {
    serial += `00000000${Math.floor(Math.random() * 256 ** 4).toString(16)}`.slice(-8);
  }
  return serial;
};

export const isTimeoutError = (err: unknown) => {
  if (!err || typeof err !== 'object') return false;
  const code = String((err as { code?: string }).code || '').toUpperCase();
  if (['ETIMEDOUT', 'ESOCKETTIMEDOUT', 'ECONNABORTED', 'ETIMEOUT'].includes(code)) return true;
  return /timeout/i.test(String((err as { message?: string }).message || ''));
};
