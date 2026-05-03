import { RawOpportunity, QualifiedOpportunity, ScanResult, Scanner } from './types';
import { config, log } from './config';
import {
  XScanner,
  DevpostScanner,
  SuperteamScanner,
  DoraHacksScanner,
  GitcoinScanner,
  EthFoundationScanner,
  SolanaFoundationScanner,
  WebSearchScanner,
} from './sources';
import { deduplicateWithinScan, normalizeUrl, normalizeTitle, filterAlreadyAlerted } from './dedupe';
import { qualifies } from './qualifier';
import { assignPriority, sortByPriority } from './priority';
import { validateUrl } from './url';

export function createScanners(): Scanner[] {
  return [
    new XScanner(),
    new DevpostScanner(),
    new SuperteamScanner(),
    new DoraHacksScanner(),
    new GitcoinScanner(),
    new EthFoundationScanner(),
    new SolanaFoundationScanner(),
    new WebSearchScanner(),
  ];
}

export async function runScan(scanners: Scanner[]): Promise<QualifiedOpportunity[]> {
  log.info(`Starting scan with ${scanners.length} sources`);
  const allRaw: RawOpportunity[] = [];
  const results: ScanResult[] = [];

  for (const scanner of scanners) {
    log.info(`Scanning: ${scanner.name}...`);
    try {
      const opps = await scanner.scan();
      results.push({ source: scanner.name, opportunities: opps });
      allRaw.push(...opps);
      log.info(`${scanner.name}: ${opps.length} raw opportunities`);
    } catch (e) {
      const msg = (e as Error).message || String(e);
      log.error(`${scanner.name} FAILED: ${msg}`);
      results.push({ source: scanner.name, opportunities: [], error: msg });
    }
  }

  log.info(`Total raw opportunities: ${allRaw.length}`);

  const deduped = deduplicateWithinScan(allRaw);
  log.info(`After intra-scan dedup: ${deduped.length}`);

  const qualified: QualifiedOpportunity[] = [];
  for (const opp of deduped) {
    if (qualifies(opp)) {
      const qOpp: QualifiedOpportunity = {
        ...opp,
        priority: 'LOW',
        normalizedUrl: normalizeUrl(opp.url),
        normalizedTitle: normalizeTitle(opp.title),
      };
      qOpp.priority = assignPriority(qOpp);
      qualified.push(qOpp);
    }
  }
  log.info(`After qualification: ${qualified.length}`);

  const fresh = filterAlreadyAlerted(qualified);
  log.info(`After cross-scan dedup: ${fresh.length}`);

  const sorted = sortByPriority(fresh);

  const max = config.scan.maxAlertsPerScan;
  const validated: QualifiedOpportunity[] = [];
  let invalidCount = 0;
  for (const opp of sorted) {
    if (validated.length >= max) break;
    const result = await validateUrl(opp.url);
    if (result === 'invalid') {
      log.warn(`Dropping invalid URL (404/410): ${opp.url} — "${opp.title}"`);
      invalidCount++;
      continue;
    }
    if (result === 'error') {
      log.debug(`URL validation error (keeping): ${opp.url}`);
    }
    validated.push(opp);
  }
  if (invalidCount > 0) {
    log.info(`URL validation dropped ${invalidCount} invalid links`);
  }

  const summary = results.map(r =>
    `  ${r.source}: ${r.opportunities.length} found${r.error ? ` (ERROR: ${r.error})` : ''}`
  ).join('\n');
  log.info(`Scan summary:\n${summary}`);

  return validated;
}
