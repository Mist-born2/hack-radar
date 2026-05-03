import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage } from '../http';

const SEARCH_QUERIES = [
  'new hackathon 2025',
  'new hackathon 2026',
  'crypto bounty open now',
  'Solana hackathon prize',
  'AI hackathon prize',
  'DoraHacks bounty',
  'web3 grant open',
];

export class WebSearchScanner implements Scanner {
  name = 'WebSearch';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const seenUrls = new Set<string>();

    for (const query of SEARCH_QUERIES) {
      try {
        const results = await this.search(query);
        for (const opp of results) {
          if (!seenUrls.has(opp.url)) {
            seenUrls.add(opp.url);
            opportunities.push(opp);
          }
        }
        await sleep(2000 + Math.random() * 2000);
      } catch (e) {
        log.warn(`WebSearch: query "${query}" failed:`, (e as Error).message);
      }
    }

    log.info(`WebSearch: found ${opportunities.length} opportunities`);
    return opportunities;
  }

  private async search(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];

    const engines = [
      () => this.searchDuckDuckGo(query),
      () => this.searchBrave(query),
    ];

    for (const engine of engines) {
      try {
        const found = await engine();
        if (found.length > 0) {
          results.push(...found);
          break;
        }
      } catch (e) {
        log.debug(`WebSearch: engine failed for "${query}"`, e);
      }
    }

    return results;
  }

  private async searchDuckDuckGo(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    const html = await fetchPage(url);
    if (!html) return results;

    const $ = cheerio.load(html);

    $('.result, .web-result, .results_links').each((_, el) => {
      try {
        const $el = $(el);
        const titleEl = $el.find('.result__title, .result__a, a.result__url, h2 a').first();
        const title = titleEl.text().trim();
        let href = titleEl.attr('href') || $el.find('a').first().attr('href') || '';

        if (href.includes('duckduckgo.com/l/?')) {
          const uddg = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg');
          if (uddg) href = uddg;
        }
        if (!href || !href.startsWith('http')) return;

        const snippet = $el.find('.result__snippet, .result__body, .snippet').text().trim();
        const combined = `${title} ${snippet}`.toLowerCase();

        if (!isRelevantResult(combined)) return;

        if (isSpamDomain(href)) return;

        const tags = extractTags(combined);
        const prizeMatch = combined.match(/\$[\d,.]+[kKmM]?/);

        const type = combined.includes('bounty') ? 'bounty' as const
          : combined.includes('grant') ? 'grant' as const
          : 'hackathon' as const;

        results.push({
          title: title || 'Web Search Result',
          url: href,
          source: 'WebSearch',
          type,
          prize: prizeMatch ? prizeMatch[0] : undefined,
          tags,
          region: 'Global',
          isRemote: true,
          isOpen: true,
          summary: snippet.slice(0, 200) || undefined,
        });
      } catch (e) {
        log.debug('WebSearch: error parsing DDG result', e);
      }
    });

    return results;
  }

  private async searchBrave(query: string): Promise<RawOpportunity[]> {
    const results: RawOpportunity[] = [];
    const url = `https://search.brave.com/search?q=${encodeURIComponent(query)}&source=web`;
    const html = await fetchPage(url);
    if (!html) return results;

    const $ = cheerio.load(html);

    $('#results .snippet, .fdb, [data-type="web"]').each((_, el) => {
      try {
        const $el = $(el);
        const titleEl = $el.find('.snippet-title, .title, h3, a').first();
        const title = titleEl.text().trim();
        const href = $el.find('a').first().attr('href') || titleEl.attr('href') || '';
        if (!href || !href.startsWith('http')) return;

        const snippet = $el.find('.snippet-description, .snippet-content, p').text().trim();
        const combined = `${title} ${snippet}`.toLowerCase();

        if (!isRelevantResult(combined)) return;
        if (isSpamDomain(href)) return;

        const tags = extractTags(combined);
        const prizeMatch = combined.match(/\$[\d,.]+[kKmM]?/);

        results.push({
          title: title || 'Web Search Result',
          url: href,
          source: 'WebSearch',
          type: combined.includes('bounty') ? 'bounty' : combined.includes('grant') ? 'grant' : 'hackathon',
          prize: prizeMatch ? prizeMatch[0] : undefined,
          tags,
          region: 'Global',
          isRemote: true,
          isOpen: true,
          summary: snippet.slice(0, 200) || undefined,
        });
      } catch (e) {
        log.debug('WebSearch: error parsing Brave result', e);
      }
    });

    return results;
  }
}

function isRelevantResult(text: string): boolean {
  const mustHaveOne = [
    'hackathon', 'bounty', 'grant', 'prize', 'competition',
    'challenge', 'reward', 'funding', 'hack',
  ];
  return mustHaveOne.some(k => text.includes(k));
}

function isSpamDomain(url: string): boolean {
  const spam = ['pinterest.com', 'facebook.com', 'instagram.com', 'youtube.com', 'tiktok.com'];
  return spam.some(d => url.includes(d));
}

function extractTags(text: string): string[] {
  const tags: string[] = [];
  const tagMap: Record<string, string> = {
    'web3': 'Web3', 'blockchain': 'Web3', 'crypto': 'Web3',
    'solana': 'Solana', 'ethereum': 'Ethereum', 'defi': 'DeFi',
    'ai': 'AI', 'artificial intelligence': 'AI',
    'nft': 'NFT', 'dao': 'DAO',
  };
  for (const [keyword, tag] of Object.entries(tagMap)) {
    if (text.includes(keyword) && !tags.includes(tag)) {
      tags.push(tag);
    }
  }
  return tags;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
