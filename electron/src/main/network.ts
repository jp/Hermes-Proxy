import os from 'os';

const isPrivateIpv4 = (ip: string) => {
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('192.168.')) return true;
  const [first, second] = ip.split('.').map((segment) => Number(segment));
  return first === 172 && second >= 16 && second <= 31;
};

export const getLocalNetworkIp = () => {
  type NetworkEntry = {
    address: string;
    family: string | number;
    internal: boolean;
  };
  const interfaceValues = Object.values(os.networkInterfaces()) as Array<NetworkEntry[] | undefined>;
  const externalIpv4: string[] = [];

  for (const records of interfaceValues) {
    if (!records?.length) continue;
    for (const entry of records) {
      const family = typeof entry.family === 'string' ? entry.family : String(entry.family);
      if (family !== 'IPv4') continue;
      if (entry.internal) continue;
      externalIpv4.push(entry.address);
    }
  }

  if (!externalIpv4.length) return null;
  return externalIpv4.find(isPrivateIpv4) || externalIpv4[0];
};
