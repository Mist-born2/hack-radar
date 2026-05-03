import { QualifiedOpportunity } from './types';

const PRIORITY_ICON: Record<string, string> = {
  HIGH: '🔴 HIGH',
  MEDIUM: '🟡 MEDIUM',
  LOW: '🟢 LOW',
};

export function formatAlert(opp: QualifiedOpportunity): string {
  const tags = opp.tags.length > 0
    ? opp.tags.map(t => `[${t}]`).join(' ')
    : '[General]';

  const prize = opp.prize || 'Unknown';
  const deadline = opp.deadline || 'Ongoing';
  const region = opp.region || 'Global';
  const summary = opp.summary || buildDefaultSummary(opp);
  const priority = PRIORITY_ICON[opp.priority] || `🟢 ${opp.priority}`;

  return [
    `🚨 NEW OPPORTUNITY DETECTED`,
    `🏆 ${opp.title}`,
    `💰 Prize: ${prize}`,
    `⏰ Deadline: ${deadline}`,
    `🏷️ Tags: ${tags}`,
    `🌍 Open to: ${region}`,
    `🔗 ${opp.url}`,
    `📌 ${summary}`,
    `---`,
    `Priority: ${priority}`,
  ].join('\n');
}

export function formatIntroMessage(count: number): string {
  return `🔍 HackathonRadar found ${count} new opportunities:`;
}

function buildDefaultSummary(opp: QualifiedOpportunity): string {
  const type = opp.type === 'bounty' ? 'bounty' : opp.type === 'grant' ? 'grant program' : 'hackathon';
  const org = opp.organizer ? ` by ${opp.organizer}` : ` on ${opp.source}`;
  const topic = opp.tags.length > 0 ? ` focused on ${opp.tags.slice(0, 2).join(' and ')}` : '';
  return `${capitalize(type)}${org}${topic}. Open to developers worldwide.`;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
