import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage } from '../http';
import Parser from 'rss-parser';

export class SolanaFoundationScanner implements Scanner {
  name = 'SolanaFoundation';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const parser = new Parser();

    const feedUrls = [
      'https://solana.com/news/feed.xml',
      'https://solana.com/feed.xml',
      'https://solana.com/rss.xml',
    ];

    for (const feedUrl of feedUrls) {
      try {
        const feed = await parser.parseURL(feedUrl);
        for (const item of feed.items || []) {
          const title = item.title || '';
          const link = item.link || '';
          const content = (item.contentSnippet || item.content || '').toLowerCase();
          const combined = `${title.toLowerCase()} ${content}`;

          if (isRelevant(combined)) {
            const prizeMatch = content.match(/\$[\d,.]+[kKmM]?\s*(?:in prizes|prize pool|bounty|grant|funding)?/i);
            const tags = ['Solana', 'Web3'];
            if (combined.includes('defi')) tags.push('DeFi');
            if (combined.includes('ai')) tags.push('AI');
            if (combined.includes('nft')) tags.push('NFT');

            const type = combined.includes('bounty') ? 'bounty' as const
              : combined.includes('grant') ? 'grant' as const
              : 'hackathon' as const;

            opportunities.push({
              title,
              url: link,
              source: 'SolanaFoundation',
              type,
              prize: prizeMatch ? prizeMatch[0].trim() : 'Unknown',
              tags,
              region: 'Global',
              isRemote: true,
              isOpen: true,
              summary: (item.contentSnippet || '').slice(0, 200),
              organizer: 'Solana Foundation',
            });
          }
        }
        if (opportunities.length > 0) break;
      } catch (e) {
        log.debug(`SolanaFoundation: feed failed for ${feedUrl}`, e);
      }
    }

    if (opportunities.length === 0) {
      const pages = [
        'https://solana.com/news',
        'https://solana.com/developers',
        'https://solana.com/ecosystem',
      ];

      for (const pageUrl of pages) {
        try {
          const html = await fetchPage(pageUrl);
          if (!html) continue;
          const $ = cheerio.load(html);

          $('a').each((_, el) => {
            try {
              const $a = $(el);
              let href = $a.attr('href') || '';
              if (!href.startsWith('http')) href = `https://solana.com${href}`;

              const text = $a.text().trim();
              const parentText = $a.closest('article, div, li, section').text().toLowerCase();
              const combined = `${text.toLowerCase()} ${parentText}`;

              if (text.length > 5 && text.length < 200 && isRelevant(combined)) {
                const prizeMatch = parentText.match(/\$[\d,.]+[kKmM]?/);

                opportunities.push({
                  title: text,
                  url: href,
                  source: 'SolanaFoundation',
                  type: combined.includes('grant') ? 'grant' : 'hackathon',
                  prize: prizeMatch ? prizeMatch[0] : undefined,
                  tags: ['Solana', 'Web3'],
                  region: 'Global',
                  isRemote: true,
                  isOpen: true,
                  organizer: 'Solana Foundation',
                });
              }
            } catch (e) {
              log.debug('SolanaFoundation: error parsing link', e);
            }
          });
        } catch (e) {
          log.warn(`SolanaFoundation: page failed for ${pageUrl}`, e);
        }
      }
    }

    log.info(`SolanaFoundation: found ${opportunities.length} opportunities`);
    return opportunities;
  }
}

function isRelevant(text: string): boolean {
  const keywords = [
    'hackathon', 'bounty', 'grant', 'prize', 'reward', 'funding',
    'competition', 'challenge', 'build', 'developer', 'breakpoint',
    'grizzlython', 'hyperdrive', 'radar',
  ];
  return keywords.some(k => text.includes(k));
}
