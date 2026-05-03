import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage } from '../http';
import Parser from 'rss-parser';

export class EthFoundationScanner implements Scanner {
  name = 'EthFoundation';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const parser = new Parser();

    const feedUrls = [
      'https://blog.ethereum.org/feed.xml',
      'https://blog.ethereum.org/feed',
      'https://blog.ethereum.org/rss.xml',
    ];

    for (const feedUrl of feedUrls) {
      try {
        const feed = await parser.parseURL(feedUrl);
        for (const item of feed.items || []) {
          const title = item.title || '';
          const link = item.link || '';
          const content = (item.contentSnippet || item.content || '').toLowerCase();
          const combined = `${title.toLowerCase()} ${content}`;

          if (isRelevantPost(combined)) {
            const prizeMatch = content.match(/\$[\d,.]+[kKmM]?\s*(?:in prizes|prize pool|bounty|grant|funding)?/i);
            const tags = ['Ethereum', 'Web3'];
            if (combined.includes('defi')) tags.push('DeFi');
            if (combined.includes('ai') || combined.includes('machine learning')) tags.push('AI');
            if (combined.includes('zk') || combined.includes('zero knowledge')) tags.push('ZK');

            const type = combined.includes('bounty') ? 'bounty' as const
              : combined.includes('grant') ? 'grant' as const
              : 'hackathon' as const;

            opportunities.push({
              title,
              url: link,
              source: 'EthFoundation',
              type,
              prize: prizeMatch ? prizeMatch[0].trim() : 'Unknown',
              tags,
              region: 'Global',
              isRemote: true,
              isOpen: true,
              summary: (item.contentSnippet || '').slice(0, 200),
              organizer: 'Ethereum Foundation',
            });
          }
        }
        if (opportunities.length > 0) break;
      } catch (e) {
        log.debug(`EthFoundation: feed failed for ${feedUrl}`, e);
      }
    }

    if (opportunities.length === 0) {
      try {
        const html = await fetchPage('https://blog.ethereum.org');
        if (html) {
          const $ = cheerio.load(html);
          $('a[href*="/blog/"], article a, .post a').each((_, el) => {
            try {
              const $a = $(el);
              let href = $a.attr('href') || '';
              if (!href.startsWith('http')) href = `https://blog.ethereum.org${href}`;

              const text = $a.text().trim();
              const parentText = $a.closest('article, div, li').text().toLowerCase();
              const combined = `${text.toLowerCase()} ${parentText}`;

              if (text.length > 5 && isRelevantPost(combined)) {
                opportunities.push({
                  title: text,
                  url: href,
                  source: 'EthFoundation',
                  type: combined.includes('grant') ? 'grant' : 'hackathon',
                  tags: ['Ethereum', 'Web3'],
                  region: 'Global',
                  isRemote: true,
                  isOpen: true,
                  organizer: 'Ethereum Foundation',
                });
              }
            } catch (e) {
              log.debug('EthFoundation: error parsing blog entry', e);
            }
          });
        }
      } catch (e) {
        log.warn('EthFoundation: blog page failed', e);
      }
    }

    log.info(`EthFoundation: found ${opportunities.length} opportunities`);
    return opportunities;
  }
}

function isRelevantPost(text: string): boolean {
  const keywords = [
    'hackathon', 'bounty', 'grant', 'prize', 'reward', 'funding',
    'competition', 'challenge', 'build', 'developer', 'devcon',
  ];
  return keywords.some(k => text.includes(k));
}
