import { RawOpportunity, QualifiedOpportunity } from './types';
import { wasAlerted } from './db';
import { normalizeUrl } from './url';
import { log } from './config';

export { normalizeUrl } from './url';

const MARKETING_PREFIXES = [
  'announcing', 'introducing', 'just launched', 'new', 'apply now',
  'register now', 'dont miss', 'do not miss', 'reminder', 'last chance',
  'final call', 'update', 'join us', 'we are excited', 'excited to announce',
];

const EMOJI_RE = /[\u{1F000}-\u{1FFFF}]|[\u{2600}-\u{27BF}]|[\u{FE00}-\u{FE0F}]|[\u{1F900}-\u{1F9FF}]|[\u{200D}]|[\u{20E3}]|[\u{E0020}-\u{E007F}]/gu;

export function normalizeTitle(title: string): string {
  let t = title
    .replace(EMOJI_RE, '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  for (const prefix of MARKETING_PREFIXES) {
    if (t.startsWith(prefix + ' ')) {
      t = t.slice(prefix.length).trim();
    }
  }

  return t;
}

export function titleWords(normalized: string): string[] {
  const stops = new Set([
    'the', 'a', 'an', 'and', 'or', 'for', 'to', 'in', 'on', 'at', 'of',
    'is', 'are', 'was', 'be', 'by', 'with', 'from', 'this', 'that', 'your',
    'our', 'its', 'has', 'have', 'had',
  ]);
  return normalized.split(' ').filter(w => w.length > 1 && !stops.has(w));
}

export function fuzzyTitleMatch(a: string, b: string): boolean {
  if (a === b) return true;

  const wordsA = titleWords(a);
  const wordsB = titleWords(b);

  if (wordsA.length === 0 || wordsB.length === 0) return false;

  if (wordsA.length >= 4 && wordsB.length >= 4) {
    const prefixLen = Math.min(8, wordsA.length, wordsB.length);
    const prefixA = wordsA.slice(0, prefixLen).join(' ');
    const prefixB = wordsB.slice(0, prefixLen).join(' ');
    if (prefixA === prefixB) return true;
  }

  const setA = new Set(wordsA);
  const setB = new Set(wordsB);
  const intersection = new Set([...setA].filter(w => setB.has(w)));
  const union = new Set([...setA, ...setB]);
  const jaccard = intersection.size / union.size;

  return jaccard >= 0.6;
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
    if (existingUrl === normUrl) return key;
    if (existingTitle === normTitle) return key;
    if (fuzzyTitleMatch(existingTitle, normTitle)) return key;
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
