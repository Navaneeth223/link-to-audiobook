export type DonationProvider = 'github-sponsors' | 'ko-fi' | 'buy-me-a-coffee' | 'open-collective' | 'paypal' | 'upi';
export type DonationLink = { provider: DonationProvider; label: string; url: string };

const providerHosts: Record<Exclude<DonationProvider, 'upi'>, string[]> = {
  'github-sponsors': ['github.com'],
  'ko-fi': ['ko-fi.com'],
  'buy-me-a-coffee': ['buymeacoffee.com'],
  'open-collective': ['opencollective.com'],
  paypal: ['paypal.me'],
};

function isProvider(value: unknown): value is DonationProvider {
  return typeof value === 'string' && [...Object.keys(providerHosts), 'upi'].includes(value);
}

export function parseDonationLinks(raw: string | undefined): DonationLink[] {
  if (!raw?.trim()) return [];
  let value: unknown;
  try { value = JSON.parse(raw); } catch { return []; }
  if (!Array.isArray(value)) return [];
  const links: DonationLink[] = [];
  for (const entry of value) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = entry as { provider?: unknown; label?: unknown; url?: unknown };
    if (!isProvider(candidate.provider) || typeof candidate.label !== 'string' || typeof candidate.url !== 'string') continue;
    try {
      const url = new URL(candidate.url);
      const allowed = candidate.provider === 'upi'
        ? url.protocol === 'upi:' && url.hostname === 'pay'
        : url.protocol === 'https:' && !url.username && !url.password && providerHosts[candidate.provider].some(host => url.hostname === host || url.hostname.endsWith(`.${host}`));
      if (allowed) links.push({ provider: candidate.provider, label: candidate.label.slice(0, 50), url: url.href });
    } catch { /* Ignore invalid maintainer configuration. */ }
  }
  return links;
}
