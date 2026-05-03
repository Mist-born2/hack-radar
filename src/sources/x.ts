import * as cheerio from 'cheerio';
import type { AnyNode } from 'domhandler';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage } from '../http';
import { unwrapRedirectUrl } from '../url';

const DEFAULT_QUERIES = [
  'hackathon',
  'bounty',
  'build competition',
  'grant',
  '$prize pool',
  'win $',
  'superteam',
  'dorahacks',
  'web3 hackathon',
  'solana bounty',
  'ai hackathon prize',
];

const WEB_SEARCH_QUERIES = [
  'site:x.com hackathon bounty prize',
  'site:x.com solana bounty',
  'site:x.com dorahacks hackathon',
  'site:x.com web3 grant',
  'site:twitter.com hackathon prize 2025 OR 2026',
  'site:x.com superteam bounty',
  'site:x.com ethglobal hackathon',
  'site:x.com ai hackathon prize',
];

export class XScanner implements Scanner {
  name = 'X/Twitter';

  private queries: string[];
  private stats = { nitter: 0, syndication: 0, rss: 0, websearch: 0 };

  constructor() {
    const custom = process.env.X_SEARCH_QUERIES?.trim();
    this.queries = custom ? custom.split(',').map(q => q.trim()).filter(Boolean) : DEFAULT_QUERIES;
  }

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const seenUrls = new Set<string>();
    this.stats = { nitter: 0, syndication: 0, rss: 0, websearch: 0 };

    for (const query of this.queries) {
      try {
        const results = await this.searchQuery(query);
        for (const opp of results) {
          if (!seenUrls.has(opp.url)) {
            seenUrls.add(opp.url);
            opportunities.push(opp);
          }
        }
        await sleep(1500 + Math.random() * 1500);
      } catch (e) {
        log.warn(`X: query "${query}" failed:`, (e as Error).message);
      }
    }

    if (opportunities.length === 0) {
      log.info('X/Twitter: Nitter/syndication/RSS found 0 results, trying web search fallback');
      const webResults = await this.webSearchFallback();
      for (const opp of webResults) {
        if (!seenUrls.has(opp.url)) {
          seenUrls.add(opp.url);
          opportunities.push(opp);
        }
      }
    }

    log.info(`X/Twitter: found ${opportunities.length} opportunities across ${this.queries.length} queries ` +
      `(nitter: ${this.stats.nitter}, syndication: ${this.stats.syndication}, ` +
      `rss: ${this.stats.rss}, websearch: ${this.stats.websearch})`);
    return opportunities;
  }

  private async searchQuery(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];

    const nitterInstances = this.getNitterInstances();
    for (const instance of nitterInstances) {
      try {
        const found = await this.searchNitter(instance, query);
        if (found.length > 0) {
          this.stats.nitter += found.length;
          results.push(...found);
          break;
        }
      } catch (e) {
        log.debug(`X: Nitter instance ${instance} failed for "${query}":`, (e as Error).message);
      }
    }

    if (results.length === 0) {
      try {
        const found = await this.searchSyndex(query);
        if (found.length > 0) this.stats.syndication += found.length;
        results.push(...found);
      } catch (e) {
        log.debug(`X: syndication fallback failed for "${query}":`, (e as Error).message);
      }
    }

    if (results.length === 0) {
      try {
        const found = await this.searchRss(query);
        if (found.length > 0) this.stats.rss += found.length;
        results.push(...found);
      } catch (e) {
        log.debug(`X: RSS fallback failed for "${query}":`, (e as Error).message);
      }
    }

    return results;
  }

  private getNitterInstances(): string[] {
    const custom = process.env.NITTER_INSTANCES?.trim();
    if (custom) {
      return custom.split(',').map(s => s.trim()).filter(Boolean);
    }
    return [
      'https://nitter.privacydev.net',
      'https://nitter.poast.org',
      'https://nitter.woodland.cafe',
      'https://nitter.1d4.us',
      'https://nitter.kavin.rocks',
    ];
  }

  private async searchNitter(instance: string, query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];
    const encoded = encodeURIComponent(query);
    const url = `${instance}/search?f=tweets&q=${encoded}`;

    const html = await fetchPage(url, 12_000);
    if (!html) return results;

    const $ = cheerio.load(html);

    $('.timeline-item, .tweet-body, [class*="timeline"] .tweet, article').each((_, el) => {
      try {
        const $el = $(el);
        const tweetText = $el.find('.tweet-content, .tweet-body, .content, p').text().trim();
        if (!tweetText || tweetText.length < 20) return;

        if (!isOpportunityTweet(tweetText)) return;

        const linkEl = $el.find('a[href*="/status/"]').first();
        let tweetLink = linkEl.attr('href') || '';
        if (tweetLink && !tweetLink.startsWith('http')) {
          tweetLink = `${instance}${tweetLink}`;
        }
        const twitterUrl = nitterToTwitter(tweetLink, instance);

        const externalLinks = extractExternalLinks($el, $, instance);
        const primaryUrl = externalLinks[0] || twitterUrl;
        if (!primaryUrl) return;

        const userEl = $el.find('.username, .tweet-header a, a[href^="/"]').first();
        const username = userEl.text().trim().replace(/^@/, '');

        const parsed = parseTweetContent(tweetText, username);

        results.push({
          title: parsed.title,
          url: primaryUrl,
          source: 'X/Twitter',
          type: parsed.type,
          prize: parsed.prize,
          deadline: parsed.deadline,
          tags: parsed.tags,
          region: 'Global',
          isRemote: true,
          isOpen: true,
          summary: tweetText.slice(0, 200),
          organizer: username || undefined,
        });
      } catch (e) {
        log.debug('X: error parsing Nitter tweet', e);
      }
    });

    return results;
  }

  private async searchSyndex(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];
    const accounts = [
      'superaborty', 'DoraHacks', 'gitaborin', 'solana', 'ethereum',
      'ethglobal', 'buildonsol', 'superteamearn',
    ];

    for (const account of accounts.slice(0, 4)) {
      try {
        const url = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${account}`;
        const html = await fetchPage(url, 10_000);
        if (!html) continue;

        const $ = cheerio.load(html);
        $('[data-tweet-id], .timeline-Tweet, article').each((_, el) => {
          try {
            const $el = $(el);
            const text = $el.find('.timeline-Tweet-text, .tweet-text, p').text().trim();
            if (!text || text.length < 20) return;

            const lower = `${text.toLowerCase()} ${query.toLowerCase()}`;
            if (!isOpportunityTweet(text)) return;
            if (!lower.includes(query.toLowerCase().split(' ')[0])) return;

            const tweetId = $el.attr('data-tweet-id') || '';
            const tweetUrl = tweetId
              ? `https://x.com/${account}/status/${tweetId}`
              : `https://x.com/${account}`;

            const externalLinks = extractExternalLinksFromText(text);
            const primaryUrl = externalLinks[0] || tweetUrl;

            const parsed = parseTweetContent(text, account);

            results.push({
              title: parsed.title,
              url: primaryUrl,
              source: 'X/Twitter',
              type: parsed.type,
              prize: parsed.prize,
              deadline: parsed.deadline,
              tags: parsed.tags,
              region: 'Global',
              isRemote: true,
              isOpen: true,
              summary: text.slice(0, 200),
              organizer: account,
            });
          } catch (e) {
            log.debug('X: error parsing syndication tweet', e);
          }
        });

        await sleep(1000);
      } catch (e) {
        log.debug(`X: syndication failed for @${account}`, e);
      }
    }

    return results;
  }

  private async searchRss(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];

    const rssBridges = [
      `https://rsshub.app/twitter/search/${encodeURIComponent(query)}`,
      `https://rss.app/feeds/twitter/search/${encodeURIComponent(query)}`,
    ];

    for (const feedUrl of rssBridges) {
      try {
        const xml = await fetchPage(feedUrl, 10_000);
        if (!xml) continue;

        const $ = cheerio.load(xml, { xmlMode: true });
        $('item, entry').each((_, el) => {
          try {
            const $el = $(el);
            const title = $el.find('title').text().trim();
            const link = $el.find('link').text().trim() || $el.find('link').attr('href') || '';
            const description = $el.find('description, content, summary').text().trim();
            const combined = `${title} ${description}`;

            if (!isOpportunityTweet(combined)) return;
            if (!link) return;

            const parsed = parseTweetContent(combined, '');

            results.push({
              title: parsed.title,
              url: link,
              source: 'X/Twitter',
              type: parsed.type,
              prize: parsed.prize,
              deadline: parsed.deadline,
              tags: parsed.tags,
              region: 'Global',
              isRemote: true,
              isOpen: true,
              summary: description.replace(/<[^>]*>/g, '').slice(0, 200),
            });
          } catch (e) {
            log.debug('X: error parsing RSS item', e);
          }
        });

        if (results.length > 0) break;
      } catch (e) {
        log.debug(`X: RSS bridge failed for ${feedUrl}`, e);
      }
    }

    return results;
  }

  private async webSearchFallback(): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];
    const seenUrls = new Set<string>();

    for (const query of WEB_SEARCH_QUERIES) {
      try {
        const found = await this.searchWebForXPosts(query);
        for (const opp of found) {
          if (!seenUrls.has(opp.url)) {
            seenUrls.add(opp.url);
            results.push(opp);
          }
        }
        await sleep(2000 + Math.random() * 2000);
      } catch (e) {
        log.debug(`X: web search fallback failed for "${query}":`, (e as Error).message);
      }
    }

    this.stats.websearch += results.length;
    log.info(`X/Twitter web search fallback: found ${results.length} results from ${WEB_SEARCH_QUERIES.length} queries`);
    return results;
  }

  private async searchWebForXPosts(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];

    const ddgUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchPage(ddgUrl);
    if (!html) return results;

    const $ = cheerio.load(html);

    $('.result, .web-result, .results_links').each((_, el) => {
      try {
        const $el = $(el);
        const titleEl = $el.find('.result__title, .result__a, a.result__url, h2 a').first();
        const title = titleEl.text().trim();
        let href = titleEl.attr('href') || $el.find('a').first().attr('href') || '';

        if (href.includes('duckduckgo.com/l/?')) {
          href = unwrapRedirectUrl(href.startsWith('http') ? href : `https://duckduckgo.com${href}`);
        }
        if (!href || !href.startsWith('http')) return;

        href = canonicalizeXUrl(href);

        if (!isXUrl(href)) return;

        const snippet = $el.find('.result__snippet, .result__body, .snippet').text().trim();
        const combined = `${title} ${snippet}`.toLowerCase();

        if (!isOpportunityTweet(`${title} ${snippet}`)) return;

        const parsed = parseTweetContent(`${title} ${snippet}`, '');

        results.push({
          title: parsed.title || title || 'X/Twitter Post',
          url: href,
          source: 'X/Twitter',
          type: parsed.type,
          prize: parsed.prize,
          deadline: parsed.deadline,
          tags: parsed.tags,
          region: 'Global',
          isRemote: true,
          isOpen: true,
          summary: snippet.slice(0, 200) || undefined,
        });
      } catch (e) {
        log.debug('X: error parsing web search result', e);
      }
    });

    if (results.length === 0) {
      try {
        const braveUrl = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
        const braveHtml = await fetchPage(braveUrl);
        if (braveHtml) {
          const $b = cheerio.load(braveHtml);
          $b('#results .snippet, .fdb, [data-type="web"]').each((_, el) => {
            try {
              const $el = $b(el);
              const titleEl = $el.find('.snippet-title, .title, h3, a').first();
              const title = titleEl.text().trim();
              let href = $el.find('a').first().attr('href') || titleEl.attr('href') || '';
              if (!href || !href.startsWith('http')) return;

              href = canonicalizeXUrl(href);
              if (!isXUrl(href)) return;

              const snippet = $el.find('.snippet-description, .snippet-content, p').text().trim();
              if (!isOpportunityTweet(`${title} ${snippet}`)) return;

              const parsed = parseTweetContent(`${title} ${snippet}`, '');

              results.push({
                title: parsed.title || title || 'X/Twitter Post',
                url: href,
                source: 'X/Twitter',
                type: parsed.type,
                prize: parsed.prize,
                deadline: parsed.deadline,
                tags: parsed.tags,
                region: 'Global',
                isRemote: true,
                isOpen: true,
                summary: snippet.slice(0, 200) || undefined,
              });
            } catch (e) {
              log.debug('X: error parsing Brave web search result', e);
            }
          });
        }
      } catch (e) {
        log.debug('X: Brave web search fallback failed:', (e as Error).message);
      }
    }

    return results;
  }
}

function isXUrl(url: string): boolean {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').toLowerCase();
    return host === 'x.com' || host === 'twitter.com';
  } catch {
    return false;
  }
}

function canonicalizeXUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '').replace(/^mobile\./, '').toLowerCase();
    if (host === 'twitter.com' || host === 'x.com') {
      u.hostname = 'x.com';
      u.search = '';
      u.hash = '';
      return u.toString();
    }
    return url;
  } catch {
    return url;
  }
}

function isOpportunityTweet(text: string): boolean {
  const lower = text.toLowerCase();
  const mustHaveOne = [
    'hackathon', 'bounty', 'bount', 'grant', 'prize', 'reward',
    'competition', 'challenge', 'build', 'ship', 'submit',
    'winner', 'funding', 'hack', 'devpost', 'dorahacks',
  ];
  const hasKeyword = mustHaveOne.some(k => lower.includes(k));
  if (!hasKeyword) return false;

  const rejectPatterns = [
    /^rt @/i,
    /follow.*retweet.*win/i,
    /giveaway.*follow/i,
  ];
  if (rejectPatterns.some(p => p.test(text))) return false;

  return true;
}

function nitterToTwitter(nitterUrl: string, instance: string): string {
  if (!nitterUrl) return '';
  try {
    const u = new URL(nitterUrl);
    return `https://x.com${u.pathname}`;
  } catch {
    return nitterUrl.replace(instance, 'https://x.com');
  }
}

function extractExternalLinks($el: cheerio.Cheerio<AnyNode>, $: cheerio.CheerioAPI, instance: string): string[] {
  const links: string[] = [];
  $el.find('a[href]').each((_, a) => {
    const href = $(a).attr('href') || '';
    if (
      href.startsWith('http') &&
      !href.includes('twitter.com') &&
      !href.includes('x.com') &&
      !href.includes(instance) &&
      !href.includes('t.co')
    ) {
      links.push(href);
    }
  });
  return links;
}

function extractExternalLinksFromText(text: string): string[] {
  const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g;
  const matches = text.match(urlRegex) || [];
  return matches.filter(u =>
    !u.includes('twitter.com') &&
    !u.includes('x.com') &&
    !u.includes('t.co')
  );
}

interface ParsedTweet {
  title: string;
  type: 'hackathon' | 'bounty' | 'grant';
  prize?: string;
  deadline?: string;
  tags: string[];
}

function parseTweetContent(text: string, username: string): ParsedTweet {
  const lower = text.toLowerCase();

  let title = '';
  const titlePatterns = [
    /(?:announcing|introducing|join|enter|apply|register)\s+(?:the\s+)?(.{10,80}?)(?:\.|!|\n|$)/i,
    /🏆\s*(.{10,80}?)(?:\.|!|\n|$)/i,
    /(.{10,60}?)\s+(?:hackathon|bounty|grant|competition|challenge)/i,
  ];
  for (const pattern of titlePatterns) {
    const match = text.match(pattern);
    if (match) {
      title = match[1].trim().replace(/[#@]\w+/g, '').trim();
      break;
    }
  }
  if (!title) {
    const firstLine = text.split(/\n/)[0].trim();
    title = firstLine.slice(0, 80).replace(/https?:\/\/\S+/g, '').replace(/[#@]\w+/g, '').trim();
  }
  if (!title || title.length < 5) {
    title = `${username ? `@${username}` : 'X/Twitter'}: ${lower.includes('hackathon') ? 'Hackathon' : lower.includes('bounty') ? 'Bounty' : 'Opportunity'}`;
  }

  let type: 'hackathon' | 'bounty' | 'grant' = 'hackathon';
  if (lower.includes('bounty') || lower.includes('bount')) type = 'bounty';
  else if (lower.includes('grant') || lower.includes('funding')) type = 'grant';

  let prize: string | undefined;
  const prizePatterns = [
    /\$[\d,.]+[kKmM]?\s*(?:\+\s*)?(?:in\s+)?(?:prizes?|pool|reward|bounty|grant|funding|usd[ct]?)?/i,
    /(?:prize|reward|bounty|pool|grant)[:\s]*\$[\d,.]+[kKmM]?/i,
    /([\d,.]+)\s*(?:USDC|USDT|SOL|ETH|USD)\s*(?:in\s+)?(?:prizes?|pool|reward|bounty)?/i,
  ];
  for (const pattern of prizePatterns) {
    const match = text.match(pattern);
    if (match) {
      prize = match[0].trim();
      break;
    }
  }

  let deadline: string | undefined;
  const datePatterns = [
    /(?:deadline|due|ends?|closing|submit\s+by|closes?)[:\s]*([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
    /(?:deadline|due|ends?|closing)[:\s]*(\d{1,2}\/\d{1,2}\/\d{2,4})/i,
    /(?:by|before|until)\s+([A-Za-z]+\s+\d{1,2},?\s*\d{4})/i,
  ];
  for (const pattern of datePatterns) {
    const match = text.match(pattern);
    if (match) {
      deadline = match[1].trim();
      break;
    }
  }

  const tags: string[] = [];
  const tagMap: Record<string, string> = {
    'web3': 'Web3', 'blockchain': 'Web3', 'crypto': 'Web3',
    'solana': 'Solana', 'ethereum': 'Ethereum', 'defi': 'DeFi',
    'ai': 'AI', 'artificial intelligence': 'AI', 'machine learning': 'AI',
    'nft': 'NFT', 'dao': 'DAO', 'zk': 'ZK',
  };
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (lower.includes(keyword) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }

  return { title, type, prize, deadline, tags };
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
