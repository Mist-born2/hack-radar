import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage, fetchJson } from '../http';

export class DoraHacksScanner implements Scanner {
  name = 'DoraHacks';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];

    try {
      const data = await this.tryApi();
      if (data.length > 0) return data;
    } catch (e) {
      log.debug('DoraHacks: API failed, trying HTML', e);
    }

    try {
      const html = await fetchPage('https://dorahacks.io/hackathon');
      if (!html) return opportunities;
      const $ = cheerio.load(html);

      $('a[href*="/hackathon/"], a[href*="/buidl/"]').each((_, el) => {
        try {
          const $a = $(el);
          let href = $a.attr('href') || '';
          if (!href.startsWith('http')) href = `https://dorahacks.io${href}`;

          const container = $a.closest('[class*="card"], [class*="item"], div').first();
          const title = container.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim()
            || $a.text().trim();
          if (!title || title.length < 3) return;

          const text = container.text();
          const prizeMatch = text.match(/\$[\d,.]+[kKmM]?/) || text.match(/[\d,.]+\s*(?:USDC|USD|DORA)/);
          const prize = prizeMatch ? prizeMatch[0].trim() : undefined;

          const tags = extractDoraTags(text);
          const deadlineMatch = text.match(/(?:deadline|ends?|closing)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i);

          opportunities.push({
            title,
            url: href,
            source: 'DoraHacks',
            type: href.includes('buidl') ? 'bounty' : 'hackathon',
            prize,
            deadline: deadlineMatch?.[1],
            tags,
            region: 'Global',
            isRemote: true,
            isOpen: true,
            organizer: 'DoraHacks',
          });
        } catch (e) {
          log.debug('DoraHacks: error parsing element', e);
        }
      });
    } catch (e) {
      log.warn('DoraHacks: HTML parse failed', e);
    }

    log.info(`DoraHacks: found ${opportunities.length} opportunities`);
    return opportunities;
  }

  private async tryApi(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const apiUrls = [
      'https://dorahacks.io/api/hackathon/list?status=active&page=1&limit=20',
      'https://dorahacks.io/api/bounty/list?status=active&page=1&limit=20',
    ];

    for (const apiUrl of apiUrls) {
      try {
        const data = await fetchJson(apiUrl) as Record<string, unknown>;
        if (!data) continue;

        const items = (data.data || data.list || data.results || data) as Record<string, unknown>[];
        if (!Array.isArray(items)) continue;

        for (const item of items) {
          const title = (item.title as string) || (item.name as string) || '';
          if (!title) continue;

          const slug = (item.slug as string) || (item.id as string) || '';
          const isBounty = apiUrl.includes('bounty');
          const url = slug
            ? `https://dorahacks.io/${isBounty ? 'bounty' : 'hackathon'}/${slug}`
            : 'https://dorahacks.io/hackathon';

          let prize: string | undefined;
          if (item.totalPrize) prize = `$${Number(item.totalPrize).toLocaleString()}`;
          else if (item.prize_pool) prize = `$${Number(item.prize_pool).toLocaleString()}`;

          const deadline = item.endTime
            ? new Date(item.endTime as string).toLocaleDateString('en-US', {
              year: 'numeric', month: 'short', day: 'numeric'
            })
            : undefined;

          const tags = extractDoraTags((item.description as string) || title);

          opportunities.push({
            title,
            url,
            source: 'DoraHacks',
            type: isBounty ? 'bounty' : 'hackathon',
            prize,
            deadline,
            deadlineDate: item.endTime ? new Date(item.endTime as string) : undefined,
            tags,
            region: 'Global',
            isRemote: true,
            isOpen: true,
            summary: ((item.description as string) || '').replace(/<[^>]*>/g, '').slice(0, 200) || undefined,
            organizer: 'DoraHacks',
          });
        }
      } catch (e) {
        log.debug(`DoraHacks: API call failed for ${apiUrl}`, e);
      }
    }

    return opportunities;
  }
}

function extractDoraTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  if (lower.includes('web3') || lower.includes('blockchain')) tags.push('Web3');
  if (lower.includes('solana')) tags.push('Solana');
  if (lower.includes('ethereum')) tags.push('Ethereum');
  if (lower.includes('defi')) tags.push('DeFi');
  if (lower.includes('ai') || lower.includes('machine learning')) tags.push('AI');
  if (lower.includes('nft')) tags.push('NFT');
  if (lower.includes('dao')) tags.push('DAO');
  if (lower.includes('zk') || lower.includes('zero knowledge')) tags.push('ZK');
  if (tags.length === 0) tags.push('Web3');
  return tags;
}
