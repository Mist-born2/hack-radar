import { QualifiedOpportunity, Priority } from './types';

const MAJOR_ORGS = [
  'solana foundation', 'ethereum foundation', 'gitcoin', 'a16z',
  'dorahacks', 'superteam', 'ethglobal', 'binance', 'coinbase',
  'polygon', 'avalanche', 'near', 'aptos', 'sui',
];

export function assignPriority(opp: QualifiedOpportunity): Priority {
  const prizeAmount = parsePrizeAmount(opp.prize);
  const daysUntilDeadline = getDaysUntilDeadline(opp);
  const isMajorOrg = checkMajorOrg(opp);

  if (prizeAmount > 1000 || (daysUntilDeadline !== null && daysUntilDeadline <= 3) || isMajorOrg) {
    return 'HIGH';
  }

  if (
    (prizeAmount >= 100 && prizeAmount <= 1000) ||
    (opp.type === 'bounty' && opp.prize && opp.prize !== 'Unknown' && opp.prize !== 'TBA')
  ) {
    return 'MEDIUM';
  }

  return 'LOW';
}

function parsePrizeAmount(prize?: string): number {
  if (!prize) return 0;

  const cleaned = prize.replace(/,/g, '').toLowerCase();

  const match = cleaned.match(/\$?([\d.]+)\s*([kmb])?/);
  if (!match) return 0;

  let amount = parseFloat(match[1]);
  if (isNaN(amount)) return 0;

  const suffix = match[2];
  if (suffix === 'k') amount *= 1000;
  else if (suffix === 'm') amount *= 1_000_000;
  else if (suffix === 'b') amount *= 1_000_000_000;

  return amount;
}

function getDaysUntilDeadline(opp: QualifiedOpportunity): number | null {
  if (opp.deadlineDate) {
    const now = new Date();
    const diff = opp.deadlineDate.getTime() - now.getTime();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  }

  if (opp.deadline) {
    try {
      const d = new Date(opp.deadline);
      if (!isNaN(d.getTime())) {
        const diff = d.getTime() - Date.now();
        return Math.ceil(diff / (1000 * 60 * 60 * 24));
      }
    } catch {
      return null;
    }
  }

  return null;
}

function checkMajorOrg(opp: QualifiedOpportunity): boolean {
  const combined = `${opp.organizer || ''} ${opp.source} ${opp.title}`.toLowerCase();
  return MAJOR_ORGS.some(org => combined.includes(org));
}

export function sortByPriority(opps: QualifiedOpportunity[]): QualifiedOpportunity[] {
  const order: Record<Priority, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  return [...opps].sort((a, b) => order[a.priority] - order[b.priority]);
}
