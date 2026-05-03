import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage } from '../http';

export class DevpostScanner implements Scanner {
  name = 'Devpost';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const urls = [
      'https://devpost.com/hackathons?status[]=upcoming&status[]=open',
      'https://devpost.com/hackathons?status[]=open',
    ];

    for (const url of urls) {
      try {
        const html = await fetchPage(url);
        if (!html) continue;
        const $ = cheerio.load(html);

        $('.hackathon-tile, [data-hackathon-tile], .hackathons-container .challenge-listing, .hackathon-listing').each((_, el) => {
          try {
            const $el = $(el);
            const titleEl = $el.find('h2, h3, .title, [class*="title"]').first();
            const title = titleEl.text().trim() || $el.find('a').first().text().trim();
            if (!title) return;

            const linkEl = $el.find('a[href*="/hackathons/"]').first() || $el.find('a').first();
            let href = linkEl.attr('href') || '';
            if (href && !href.startsWith('http')) {
              href = `https://devpost.com${href}`;
            }
            if (!href) return;

            const prizeText = $el.find('.prize, [class*="prize"], .money, [class*="amount"]').text().trim();
            const prize = extractPrize(prizeText);

            const dateText = $el.find('.date, [class*="date"], .deadline, [class*="deadline"], time').text().trim();
            const deadline = dateText || undefined;

            const tags = extractTags($el.text());
            const summary = $el.find('.tagline, .description, p').first().text().trim().slice(0, 200) || undefined;

            const statusText = $el.text().toLowerCase();
            const isOpen = !statusText.includes('ended') && !statusText.includes('closed');

            opportunities.push({
              title,
              url: href,
              source: 'Devpost',
              type: 'hackathon',
              prize,
              deadline,
              tags,
              region: 'Global',
              isRemote: true,
              isOpen,
              summary,
            });
          } catch (e) {
            log.debug('Devpost: error parsing tile', e);
          }
        });

        if (opportunities.length === 0) {
          $('a[href*="/hackathons/"]').each((_, el) => {
            try {
              const $a = $(el);
              let href = $a.attr('href') || '';
              if (!href.includes('/hackathons/')) return;
              if (!href.startsWith('http')) href = `https://devpost.com${href}`;

              const text = $a.text().trim();
              if (!text || text.length < 5 || text.length > 200) return;

              const parent = $a.closest('div, li, article, section');
              const parentText = parent.text();
              const prizeText = parentText.match(/\$[\d,]+[kKmM]?/)?.[0] || '';
              const prize = prizeText || undefined;
              const tags = extractTags(parentText);

              opportunities.push({
                title: text,
                url: href,
                source: 'Devpost',
                type: 'hackathon',
                prize,
                tags,
                region: 'Global',
                isRemote: true,
                isOpen: true,
              });
            } catch (e) {
              log.debug('Devpost: error parsing link', e);
            }
          });
        }
      } catch (e) {
        log.warn(`Devpost: failed to fetch ${url}`, e);
      }
    }

    log.info(`Devpost: found ${opportunities.length} opportunities`);
    return opportunities;
  }
}

function extractPrize(text: string): string | undefined {
  if (!text) return undefined;
  const match = text.match(/\$[\d,.]+[kKmM]?\s*(?:USD|in prizes|in rewards)?/);
  if (match) return match[0].trim();
  if (text.toLowerCase().includes('tba')) return 'TBA';
  if (text.toLowerCase().includes('prize') || text.toLowerCase().includes('reward')) return 'Unknown';
  return undefined;
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  const lower = text.toLowerCase();
  const tagMap: Record<string, string> = {
    'web3': 'Web3', 'blockchain': 'Web3', 'crypto': 'Web3',
    'solana': 'Solana', 'ethereum': 'Ethereum', 'defi': 'DeFi',
    'ai': 'AI', 'artificial intelligence': 'AI', 'machine learning': 'AI', 'ml': 'AI',
    'nft': 'NFT', 'dao': 'DAO', 'fintech': 'Fintech',
    'mobile': 'Mobile', 'iot': 'IoT', 'gaming': 'Gaming',
    'health': 'Health', 'climate': 'Climate', 'education': 'Education',
    'social impact': 'Social Impact', 'open source': 'Open Source',
  };
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (lower.includes(keyword) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}
