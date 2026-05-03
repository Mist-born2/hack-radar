import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage, fetchJson } from '../http';
import { buildSuperteamUrl } from '../url';

export class SuperteamScanner implements Scanner {
  name = 'SuperteamEarn';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];

    try {
      const data = await this.tryApi();
      if (data.length > 0) return data;
    } catch (e) {
      log.debug('Superteam: API approach failed, trying HTML', e);
    }

    try {
      const html = await fetchPage('https://earn.superteam.fun/all/');
      if (!html) return opportunities;

      const $ = cheerio.load(html);

      $('a[href*="/listing"]').each((_, el) => {
        try {
          const $a = $(el);
          let href = $a.attr('href') || '';
          if (!href.startsWith('http')) href = `https://earn.superteam.fun${href}`;

          const slug = extractSlugFromHref(href);
          const url = slug ? buildSuperteamUrl(slug) : href;

          const container = $a.closest('div').parent();
          const title = container.find('p, h3, h4, [class*="title"]').first().text().trim()
            || $a.text().trim();
          if (!title || title.length < 3) return;

          const text = container.text();
          const prizeMatch = text.match(/\$[\d,.]+[kKmM]?/) || text.match(/[\d,.]+\s*(?:USDC|SOL|USD)/);
          const prize = prizeMatch ? prizeMatch[0].trim() : undefined;

          const tags = extractSuperteamTags(text);
          if (!tags.includes('Solana')) tags.unshift('Solana');

          const typeText = text.toLowerCase();
          const type = typeText.includes('bounty') ? 'bounty' as const
            : typeText.includes('grant') ? 'grant' as const
            : 'hackathon' as const;

          const deadlineMatch = text.match(/(?:deadline|due|ends?|closing)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i);
          const deadline = deadlineMatch ? deadlineMatch[1] : undefined;

          opportunities.push({
            title,
            url,
            source: 'SuperteamEarn',
            type,
            prize,
            deadline,
            tags,
            region: 'Global',
            isRemote: true,
            isOpen: true,
            organizer: 'Superteam',
          });
        } catch (e) {
          log.debug('Superteam: error parsing listing', e);
        }
      });
    } catch (e) {
      log.warn('Superteam: HTML parse failed', e);
    }

    log.info(`SuperteamEarn: found ${opportunities.length} opportunities`);
    return opportunities;
  }

  private async tryApi(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const apiUrls = [
      'https://earn.superteam.fun/api/listings/?filter=open&take=30',
      'https://earn.superteam.fun/api/hackathon/?take=20',
    ];

    for (const apiUrl of apiUrls) {
      try {
        const data = await fetchJson(apiUrl);
        if (!data) continue;

        const listings = Array.isArray(data) ? data : (data as Record<string, unknown>).listings || (data as Record<string, unknown>).bounties || [];
        if (!Array.isArray(listings)) continue;

        for (const item of listings as Record<string, unknown>[]) {
          const title = (item.title as string) || '';
          const slug = (item.slug as string) || '';
          if (!title) continue;

          const url = slug ? buildSuperteamUrl(slug) : 'https://superteam.fun/earn';

          let prize: string | undefined;
          if (item.usdValue) prize = `$${Number(item.usdValue).toLocaleString()}`;
          else if (item.rewardAmount) prize = `$${Number(item.rewardAmount).toLocaleString()}`;
          else if (item.compensationType === 'fixed') prize = item.maxRewardAsk ? `$${item.maxRewardAsk}` : 'Unknown';

          const tags = ['Solana'];
          const skills = (item.skills as string[]) || [];
          if (Array.isArray(skills)) {
            for (const s of skills) {
              const sl = typeof s === 'string' ? s.toLowerCase() : '';
              if (sl.includes('web3') || sl.includes('blockchain')) tags.push('Web3');
              if (sl.includes('ai') || sl.includes('machine learning')) tags.push('AI');
              if (sl.includes('defi')) tags.push('DeFi');
            }
          }

          const typeStr = ((item.type as string) || '').toLowerCase();
          const type = typeStr.includes('bounty') ? 'bounty' as const
            : typeStr.includes('grant') ? 'grant' as const
            : 'hackathon' as const;

          const deadline = item.deadline ? new Date(item.deadline as string).toLocaleDateString('en-US', {
            year: 'numeric', month: 'short', day: 'numeric'
          }) : undefined;

          opportunities.push({
            title,
            url,
            source: 'SuperteamEarn',
            type,
            prize,
            deadline,
            deadlineDate: item.deadline ? new Date(item.deadline as string) : undefined,
            startDate: (item.publishedAt || item.startDate) ? new Date((item.publishedAt || item.startDate) as string) : undefined,
            tags: [...new Set(tags)],
            region: 'Global',
            isRemote: true,
            isOpen: (item.status as string) !== 'closed',
            summary: ((item.description as string) || '').replace(/<[^>]*>/g, '').slice(0, 200) || undefined,
            organizer: 'Superteam',
          });
        }
      } catch (e) {
        log.debug(`Superteam: API call failed for ${apiUrl}`, e);
      }
    }

    return opportunities;
  }
}

function extractSlugFromHref(href: string): string | null {
  const patterns = [
    /\/listings?\/([\w-]+)/,
    /\/earn\/listings?\/([\w-]+)/,
  ];
  for (const p of patterns) {
    const m = href.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractSuperteamTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  if (lower.includes('web3') || lower.includes('blockchain')) tags.push('Web3');
  if (lower.includes('defi')) tags.push('DeFi');
  if (lower.includes('ai') || lower.includes('machine learning')) tags.push('AI');
  if (lower.includes('nft')) tags.push('NFT');
  if (lower.includes('dao')) tags.push('DAO');
  return tags;
}
