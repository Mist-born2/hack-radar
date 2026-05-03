import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage } from '../http';
import Parser from 'rss-parser';

const MAX_AGE_DAYS = 60;

const OPEN_LANGUAGE = [
  'apply now', 'register now', 'submit', 'accepting submissions',
  'applications open', 'sign up', 'deadline', 'open call',
  'currently open', 'ongoing', 'rolling', 'live now',
];

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

          if (!isRelevantPost(combined)) continue;

          const pubDate = item.pubDate || item.isoDate;
          const itemDate = pubDate ? new Date(pubDate) : null;

          if (itemDate && !isRecent(itemDate)) {
            if (!hasOpenLanguage(combined)) {
              log.debug(`EthFoundation: skipping old post (${itemDate.toISOString()}): ${title}`);
              continue;
            }
          }

          const isOpen = hasOpenLanguage(combined) || (itemDate != null && isRecent(itemDate));
          if (!isOpen) {
            log.debug(`EthFoundation: skipping post without open/current language: ${title}`);
            continue;
          }

          const prizeMatch = content.match(/\$[\d,.]+[kKmM]?\s*(?:in prizes|prize pool|bounty|grant|funding)?/i);
          const tags = ['Ethereum', 'Web3'];
          if (combined.includes('defi')) tags.push('DeFi');
          if (combined.includes('ai') || combined.includes('machine learning')) tags.push('AI');
          if (combined.includes('zk') || combined.includes('zero knowledge')) tags.push('ZK');

          const type = combined.includes('bounty') ? 'bounty' as const
            : combined.includes('grant') ? 'grant' as const
            : 'hackathon' as const;

          const deadlineDate = extractDeadline(content);

          opportunities.push({
            title,
            url: link,
            source: 'EthFoundation',
            type,
            prize: prizeMatch ? prizeMatch[0].trim() : 'Unknown',
            deadline: deadlineDate ? deadlineDate.toLocaleDateString('en-US', {
              year: 'numeric', month: 'short', day: 'numeric'
            }) : undefined,
            deadlineDate: deadlineDate || undefined,
            tags,
            region: 'Global',
            isRemote: true,
            isOpen: true,
            summary: (item.contentSnippet || '').slice(0, 200),
            organizer: 'Ethereum Foundation',
          });
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

              if (text.length > 5 && isRelevantPost(combined) && hasOpenLanguage(combined)) {
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

function hasOpenLanguage(text: string): boolean {
  return OPEN_LANGUAGE.some(phrase => text.includes(phrase));
}

function isRecent(date: Date): boolean {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return diffMs < MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
}

function extractDeadline(text: string): Date | null {
  const patterns = [
    /(?:deadline|due|ends?|closing|submit\s+by|closes?)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:deadline|due|ends?|closing)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      const d = new Date(m[1]);
      if (!isNaN(d.getTime())) return d;
    }
  }
  return null;
}
