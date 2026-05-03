import { log } from './config';

const TRACKING_PARAMS = new Set([
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content',
  'utm_id', 'utm_cid', 'utm_reader', 'utm_name', 'utm_social', 'utm_social-type',
  'ref', 'src', 'source', 'fbclid', 'gclid', 'gclsrc', 'dclid', 'gbraid',
  'wbraid', 'msclkid', 'twclid', 'ttclid', 'igshid', 'mc_cid', 'mc_eid',
  '_ga', '_gl', '_hsenc', '_hsmi', '__hstc', '__hsfp', 'hsa_cam', 'hsa_grp',
  'hsa_mt', 'hsa_src', 'hsa_ad', 'hsa_acc', 'hsa_net', 'hsa_ver', 'hsa_kw',
  'oly_anon_id', 'oly_enc_id', 'vero_id', 'nr_email_referer',
  'sref', 'smid', 'smtyp',
]);

export function stripTrackingParams(u: URL): void {
  const toDelete: string[] = [];
  for (const key of u.searchParams.keys()) {
    if (TRACKING_PARAMS.has(key.toLowerCase())) {
      toDelete.push(key);
    }
  }
  for (const key of toDelete) {
    u.searchParams.delete(key);
  }
}

export function unwrapRedirectUrl(url: string): string {
  try {
    const u = new URL(url);

    if (u.hostname.includes('duckduckgo.com') && u.pathname.startsWith('/l/')) {
      const uddg = u.searchParams.get('uddg');
      if (uddg) return unwrapRedirectUrl(uddg);
    }

    if (
      (u.hostname === 'earn.superteam.fun' || u.hostname === 'superteam.fun') &&
      u.pathname.startsWith('/api/redirect') &&
      u.searchParams.get('url')
    ) {
      return unwrapRedirectUrl(u.searchParams.get('url')!);
    }

    if (u.hostname === 't.co') {
      return url;
    }

    return url;
  } catch {
    return url;
  }
}

export function canonicalizeDomain(u: URL): void {
  const host = u.hostname.toLowerCase();

  if (host === 'twitter.com' || host === 'www.twitter.com' || host === 'mobile.twitter.com') {
    u.hostname = 'x.com';
  }

  if (host === 'earn.superteam.fun' || host === 'www.superteam.fun') {
    u.hostname = 'superteam.fun';
    const listingsMatch = u.pathname.match(/^\/(?:earn\/)?listings\/(.+)/);
    if (listingsMatch) {
      u.pathname = `/earn/listing/${listingsMatch[1]}`;
    }
  }

  if (host === 'www.devpost.com') {
    u.hostname = 'devpost.com';
  }

  if (host === 'www.dorahacks.io') {
    u.hostname = 'dorahacks.io';
  }
}

export function normalizeUrl(url: string): string {
  try {
    let unwrapped = unwrapRedirectUrl(url);
    const u = new URL(unwrapped);

    u.hostname = u.hostname.replace(/^www\./, '').toLowerCase();

    canonicalizeDomain(u);

    stripTrackingParams(u);

    u.hash = '';

    u.pathname = u.pathname.replace(/\/+$/, '').toLowerCase() || '/';

    const search = u.searchParams.toString();
    let normalized = u.hostname + u.pathname;
    if (search) normalized += '?' + search;

    normalized = normalized.replace(/[^a-z0-9/?&=._-]/g, '');
    return normalized;
  } catch {
    return url.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

export function buildSuperteamUrl(slug: string): string {
  return `https://superteam.fun/earn/listing/${slug}`;
}

export type UrlValidationResult = 'valid' | 'maybe-valid' | 'invalid' | 'error';

export async function validateUrl(url: string, timeoutMs = 10_000): Promise<UrlValidationResult> {
  if (!url || !url.startsWith('http')) return 'invalid';

  try {
    const u = new URL(url);
    if (!u.hostname.includes('.')) return 'invalid';
  } catch {
    return 'invalid';
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let res: Response;
    try {
      res = await fetch(url, {
        method: 'HEAD',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    } catch {
      res = await fetch(url, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/125.0.0.0 Safari/537.36',
        },
        signal: controller.signal,
        redirect: 'follow',
      });
    }

    clearTimeout(timer);

    if (res.status >= 200 && res.status < 400) return 'valid';
    if (res.status === 401 || res.status === 403 || res.status === 429) return 'maybe-valid';
    if (res.status === 404 || res.status === 410) return 'invalid';

    return 'maybe-valid';
  } catch (e) {
    clearTimeout(timer);
    log.debug(`URL validation error for ${url}: ${(e as Error).message}`);
    return 'error';
  }
}
