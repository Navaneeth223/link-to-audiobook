import { describe, expect, it } from 'vitest';
import { parseDonationLinks } from './donationLinks';

describe('donation link configuration', () => {
  it('shows only configured links to approved HTTPS provider hosts', () => {
    expect(parseDonationLinks(JSON.stringify([
      { provider: 'ko-fi', label: 'Buy me a coffee', url: 'https://ko-fi.com/reader' },
      { provider: 'paypal', label: 'PayPal', url: 'https://paypal.me/reader' },
      { provider: 'ko-fi', label: 'Unsafe', url: 'https://evil.example/reader' },
      { provider: 'github-sponsors', label: 'Credentialed', url: 'https://user:pass@github.com/sponsors/reader' },
    ]))).toEqual([
      { provider: 'ko-fi', label: 'Buy me a coffee', url: 'https://ko-fi.com/reader' },
      { provider: 'paypal', label: 'PayPal', url: 'https://paypal.me/reader' },
    ]);
  });

  it('returns no links for empty, malformed, or non-array configuration', () => {
    expect(parseDonationLinks(undefined)).toEqual([]);
    expect(parseDonationLinks('{')).toEqual([]);
    expect(parseDonationLinks('{"url":"https://ko-fi.com/reader"}')).toEqual([]);
  });
});
