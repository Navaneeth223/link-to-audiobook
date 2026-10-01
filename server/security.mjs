import net from 'node:net';

const allowedShareHosts = ['1drv.ms', 'onedrive.live.com', 'sharepoint.com'];
export function validShareUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && !url.username && !url.password && !url.port && allowedShareHosts.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`));
}
export function graphShareId(url) { return `u!${Buffer.from(url, 'utf8').toString('base64url')}`; }
export function publicAddress(address) {
  if (net.isIPv4(address)) {
    const [a,b] = address.split('.').map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19)));
  }
  if (net.isIPv6(address)) {
    const ip = address.toLowerCase();
    return !(ip === '::' || ip === '::1' || ip.startsWith('fc') || ip.startsWith('fd') || ip.startsWith('fe8') || ip.startsWith('fe9') || ip.startsWith('fea') || ip.startsWith('feb') || ip.startsWith('::ffff:'));
  }
  return false;
}
