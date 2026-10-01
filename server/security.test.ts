import { describe, expect, it } from 'vitest';
import { graphShareId, publicAddress, validShareUrl } from './security.mjs';

describe('Microsoft link and redirect security', () => {
  it('allows HTTPS Microsoft sharing hosts and rejects lookalikes', () => {
    expect(validShareUrl('https://1drv.ms/u/s!abc')).toBe(true);
    expect(validShareUrl('https://tenant.sharepoint.com/:w:/s/team/file')).toBe(true);
    expect(validShareUrl('https://sharepoint.com.attacker.example/file')).toBe(false);
    expect(validShareUrl('http://tenant.sharepoint.com/file')).toBe(false);
    expect(validShareUrl('https://user:pass@tenant.sharepoint.com/file')).toBe(false);
  });
  it('encodes a shared link as a Graph share reference', () => {
    const url = 'https://1drv.ms/u/s!abc';
    expect(graphShareId(url)).toBe(`u!${Buffer.from(url).toString('base64url')}`);
  });
  it('rejects private, local, mapped, and reserved destination IPs', () => {
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.20.0.1', '192.168.1.3', '169.254.10.2', '192.0.2.1', '198.51.100.5', '203.0.113.5', '::1', 'fd00::1', 'fe80::1', 'ff02::1', '2002::1', '2001:db8::1', '64:ff9b::7f00:1', '::ffff:127.0.0.1']) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
  });
});
