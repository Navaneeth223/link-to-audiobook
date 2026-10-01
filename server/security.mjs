import net from 'node:net';

const allowedShareHosts = ['1drv.ms', 'onedrive.live.com', 'sharepoint.com'];
export function validShareUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowedShareHosts.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}
export function graphShareId(url) { return `u!${Buffer.from(url, 'utf8').toString('base64url')}`; }
export async function readJsonResponse(response, message = 'Microsoft returned an unreadable document response.') {
  let body = '';
  try { body = await response.text(); } catch { /* Surface a safe provider error below. */ }
  try {
    const value = JSON.parse(body);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid JSON shape');
    return value;
  } catch { throw Object.assign(new Error(message), { status: 502, publicMessage: message }); }
}
export function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a,b] = address.split('.').map(Number);
    const [c] = address.split('.').slice(2).map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19 || b === 51)) || (a === 203 && b === 0 && c === 113));
  }
  if (net.isIPv6(address)) {
    const ip = address.toLowerCase();
    const firstHextet = Number.parseInt(ip.split(':')[0] || '0', 16);
    const secondHextet = Number.parseInt(ip.split(':')[1] || '0', 16);
    return firstHextet >= 0x2000 && firstHextet < 0x4000 && firstHextet !== 0x2002 && !(firstHextet === 0x2001 && (secondHextet <= 0x01ff || ip.startsWith('2001:db8')));
  }
  return false;
}
