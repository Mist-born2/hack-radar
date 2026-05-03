import { RawOpportunity } from './types';
import { log } from './config';

const RELEVANT_TAGS = new Set([
  'web3', 'blockchain', 'crypto', 'solana', 'ethereum', 'defi',
  'ai', 'artificial intelligence', 'machine learning', 'nft', 'dao',
  'zk', 'fintech', 'open source', 'developer', 'software',
]);

const IN_PERSON_REJECT_REGIONS = [
  'usa only', 'us only', 'europe only', 'eu only', 'asia only',
  'china only', 'japan only', 'korea only', 'india only',
  'in-person', 'on-site', 'onsite',
];

const AFRICA_REGIONS = [
  'africa', 'nigeria', 'kenya', 'south africa', 'ghana', 'egypt',
  'lagos', 'nairobi', 'cape town', 'accra',
];

export function qualifies(opp: RawOpportunity): boolean {
  if (!isOpenOrUpcoming(opp)) {
    log.debug(`Rejected (closed/expired): ${opp.title}`);
    return false;
  }

  if (!isRegionOk(opp)) {
    log.debug(`Rejected (region): ${opp.title}`);
    return false;
  }

  if (!hasPrizeOrReward(opp)) {
    log.debug(`Rejected (no prize): ${opp.title}`);
    return false;
  }

  if (!isRelevantTopic(opp)) {
    log.debug(`Rejected (irrelevant topic): ${opp.title}`);
    return false;
  }

  return true;
}

function isOpenOrUpcoming(opp: RawOpportunity): boolean {
  if (opp.isOpen === false) return false;

  if (opp.deadlineDate) {
    const now = new Date();
    const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    if (opp.deadlineDate < now) return false;
    return true;
  }

  if (opp.deadline) {
    const lower = opp.deadline.toLowerCase();
    if (lower.includes('ended') || lower.includes('closed') || lower.includes('expired')) {
      return false;
    }
  }

  return true;
}

function isRegionOk(opp: RawOpportunity): boolean {
  const region = (opp.region || '').toLowerCase();
  const combined = `${region} ${(opp.summary || '').toLowerCase()} ${(opp.title || '').toLowerCase()}`;

  if (
    region.includes('global') ||
    region.includes('online') ||
    region.includes('remote') ||
    region.includes('virtual') ||
    opp.isRemote === true
  ) {
    return true;
  }

  if (AFRICA_REGIONS.some(r => combined.includes(r))) {
    return true;
  }

  for (const reject of IN_PERSON_REJECT_REGIONS) {
    if (combined.includes(reject)) {
      return false;
    }
  }

  return true;
}

function hasPrizeOrReward(opp: RawOpportunity): boolean {
  if (opp.prize && opp.prize !== 'Unknown') return true;

  const combined = `${opp.title} ${opp.summary || ''}`.toLowerCase();
  const prizeKeywords = [
    'prize', 'reward', 'bounty', 'grant', 'funding', 'pool',
    'usdc', 'usdt', 'sol', 'eth', '$',
  ];
  if (prizeKeywords.some(k => combined.includes(k))) return true;

  if (opp.type === 'grant' || opp.type === 'bounty') return true;

  if (opp.organizer) {
    const majorOrgs = [
      'solana', 'ethereum', 'gitcoin', 'dorahacks', 'superteam',
      'a16z', 'ethglobal', 'devpost',
    ];
    if (majorOrgs.some(o => opp.organizer!.toLowerCase().includes(o))) return true;
  }

  return false;
}

function isRelevantTopic(opp: RawOpportunity): boolean {
  if (opp.tags.length > 0) {
    const hasRelevant = opp.tags.some(t => RELEVANT_TAGS.has(t.toLowerCase()));
    if (hasRelevant) return true;
  }

  const combined = `${opp.title} ${opp.summary || ''} ${opp.tags.join(' ')}`.toLowerCase();
  const topicKeywords = [
    'web3', 'blockchain', 'crypto', 'solana', 'ethereum', 'defi',
    'ai', 'machine learning', 'nft', 'dao', 'zk', 'fintech',
    'developer', 'software', 'open source', 'hackathon', 'coding',
    'programming', 'startup', 'build',
  ];

  return topicKeywords.some(k => combined.includes(k));
}
