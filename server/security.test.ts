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
    for (const ip of ['127.0.0.1', '10.0.0.1', '172.20.0.1', '192.168.1.3', '169.254.10.2', '::1', 'fd00::1', '::ffff:127.0.0.1']) expect(publicAddress(ip)).toBe(false);
    expect(publicAddress('8.8.8.8')).toBe(true);
  });
});
