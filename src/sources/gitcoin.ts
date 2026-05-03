import * as cheerio from 'cheerio';
import { RawOpportunity, Scanner } from '../types';
import { log } from '../config';
import { fetchPage, fetchJson } from '../http';

export class GitcoinScanner implements Scanner {
  name = 'Gitcoin';

  async scan(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];

    try {
      const data = await this.tryApi();
      if (data.length > 0) return data;
    } catch (e) {
      log.debug('Gitcoin: API failed, trying HTML', e);
    }

    const urls = [
      'https://grants.gitcoin.co',
      'https://gitcoin.co/grants',
      'https://explorer.gitcoin.co',
    ];

    for (const url of urls) {
      try {
        const html = await fetchPage(url);
        if (!html) continue;
        const $ = cheerio.load(html);

        $('a[href*="/round/"], a[href*="/grant/"], a[href*="/grants/"]').each((_, el) => {
          try {
            const $a = $(el);
            let href = $a.attr('href') || '';
            if (!href.startsWith('http')) {
              const base = new URL(url);
              href = `${base.origin}${href}`;
            }

            const container = $a.closest('[class*="card"], [class*="item"], div, article');
            const title = container.find('h2, h3, h4, [class*="title"], [class*="name"]').first().text().trim()
              || $a.text().trim();
            if (!title || title.length < 3 || title.length > 300) return;

            const text = container.text();
            const prizeMatch = text.match(/\$[\d,.]+[kKmM]?\s*(?:matching|pool|fund)?/i);
            const prize = prizeMatch ? prizeMatch[0].trim() : undefined;

            const tags = ['Web3', 'Ethereum'];
            const lower = text.toLowerCase();
            if (lower.includes('defi')) tags.push('DeFi');
            if (lower.includes('ai')) tags.push('AI');
            if (lower.includes('climate')) tags.push('Climate');
            if (lower.includes('public good')) tags.push('Public Goods');

            opportunities.push({
              title,
              url: href,
              source: 'Gitcoin',
              type: 'grant',
              prize,
              tags,
              region: 'Global',
              isRemote: true,
              isOpen: true,
              organizer: 'Gitcoin',
            });
          } catch (e) {
            log.debug('Gitcoin: error parsing element', e);
          }
        });
      } catch (e) {
        log.warn(`Gitcoin: failed to fetch ${url}`, e);
      }
    }

    log.info(`Gitcoin: found ${opportunities.length} opportunities`);
    return opportunities;
  }

  private async tryApi(): Promise<RawOpportunity[]> {
    const opportunities: RawOpportunity[] = [];
    const apiUrls = [
      'https://grants-stack-indexer.gitcoin.co/data/rounds.json',
      'https://indexer-grants-stack.gitcoin.co/data/1/rounds.json',
    ];

    for (const apiUrl of apiUrls) {
      try {
        const data = await fetchJson(apiUrl);
        if (!Array.isArray(data)) continue;

        for (const round of data as Record<string, unknown>[]) {
          const name = (round.metadata as Record<string, unknown>)?.name as string
            || (round.roundMetadata as Record<string, unknown>)?.name as string
            || '';
          if (!name) continue;

          const id = (round.id as string) || '';
          const chainId = (round.chainId as number) || 1;
          const url = id
            ? `https://explorer.gitcoin.co/#/round/${chainId}/${id}`
            : 'https://grants.gitcoin.co';

          const matchAmount = round.matchAmount || round.matchingFunds;
          let prize: string | undefined;
          if (matchAmount) {
            const amount = Number(matchAmount);
            if (!isNaN(amount) && amount > 0) {
              prize = `$${amount.toLocaleString()} matching pool`;
            }
          }

          const endStr = (round.roundEndTime as string) || (round.applicationsEndTime as string);
          let deadline: string | undefined;
          let deadlineDate: Date | undefined;
          let isOpen = true;
          if (endStr) {
            deadlineDate = new Date(typeof endStr === 'number' ? endStr * 1000 : endStr);
            if (deadlineDate < new Date()) {
              isOpen = false;
            }
            deadline = deadlineDate.toLocaleDateString('en-US', {
              year: 'numeric', month: 'short', day: 'numeric'
            });
          }

          opportunities.push({
            title: name,
            url,
            source: 'Gitcoin',
            type: 'grant',
            prize,
            deadline,
            deadlineDate,
            tags: ['Web3', 'Ethereum', 'Public Goods'],
            region: 'Global',
            isRemote: true,
            isOpen,
            organizer: 'Gitcoin',
          });
        }
      } catch (e) {
        log.debug(`Gitcoin: API call failed for ${apiUrl}`, e);
      }
    }

    return opportunities;
  }
}
