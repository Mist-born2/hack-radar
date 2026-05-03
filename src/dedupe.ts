import { RawOpportunity, QualifiedOpportunity } from './types';
import { wasAlerted } from './db';
import { log } from './config';

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    let normalized = u.hostname.replace(/^www\./, '') + u.pathname.replace(/\/+$/, '').toLowerCase();
    normalized = normalized.replace(/[^a-z0-9/.-]/g, '');
    return normalized;
  } catch {
    return url.toLowerCase().replace(/[^a-z0-9]/g, '');
  }
}

export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function deduplicateWithinScan(opportunities: RawOpportunity[]): RawOpportunity[] {
  const seen = new Map<string, RawOpportunity>();

  for (const opp of opportunities) {
    const normUrl = normalizeUrl(opp.url);
    const normTitle = normalizeTitle(opp.title);
    const key = `${normUrl}||${normTitle}`;

    const existing = seen.get(key);
    if (!existing) {
      const altKey = findSimilarKey(seen, normUrl, normTitle);
      if (altKey) {
        const alt = seen.get(altKey)!;
        if (detailScore(opp) > detailScore(alt)) {
          seen.delete(altKey);
          seen.set(key, opp);
        }
      } else {
        seen.set(key, opp);
      }
    } else {
      if (detailScore(opp) > detailScore(existing)) {
        seen.set(key, opp);
      }
    }
  }

  return Array.from(seen.values());
}

function findSimilarKey(map: Map<string, RawOpportunity>, normUrl: string, normTitle: string): string | undefined {
  for (const [key, opp] of map.entries()) {
    const existingUrl = normalizeUrl(opp.url);
    const existingTitle = normalizeTitle(opp.title);
    if (existingUrl === normUrl || existingTitle === normTitle) {
      return key;
    }
  }
  return undefined;
}

function detailScore(opp: RawOpportunity): number {
  let score = 0;
  if (opp.prize && opp.prize !== 'Unknown' && opp.prize !== 'TBA') score += 3;
  if (opp.deadline && opp.deadline !== 'Ongoing' && opp.deadline !== 'Unknown') score += 2;
  if (opp.summary) score += 2;
  if (opp.tags.length > 0) score += 1;
  if (opp.region) score += 1;
  if (opp.organizer) score += 1;
  return score;
}

export function filterAlreadyAlerted(opportunities: QualifiedOpportunity[]): QualifiedOpportunity[] {
  return opportunities.filter(opp => {
    const alerted = wasAlerted(opp.normalizedUrl, opp.normalizedTitle);
    if (alerted) {
      log.debug(`Already alerted: ${opp.title}`);
    }
    return !alerted;
  });
}
