export type Priority = 'HIGH' | 'MEDIUM' | 'LOW';

export type OpportunityType = 'hackathon' | 'bounty' | 'grant';

export interface RawOpportunity {
  title: string;
  url: string;
  source: string;
  type: OpportunityType;
  prize?: string;
  deadline?: string;
  deadlineDate?: Date;
  startDate?: Date;
  tags: string[];
  region?: string;
  summary?: string;
  organizer?: string;
  isRemote?: boolean;
  isOpen?: boolean;
}

export interface QualifiedOpportunity extends RawOpportunity {
  priority: Priority;
  normalizedUrl: string;
  normalizedTitle: string;
}

export interface ScanResult {
  source: string;
  opportunities: RawOpportunity[];
  error?: string;
}

export interface Scanner {
  name: string;
  scan(): Promise<RawOpportunity[]>;
}

export interface AlertRecord {
  id?: number;
  normalizedUrl: string;
  normalizedTitle: string;
  title: string;
  url: string;
  source: string;
  priority: Priority;
  alertedAt: string;
}
