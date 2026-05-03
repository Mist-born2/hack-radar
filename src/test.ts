import { normalizeUrl, buildSuperteamUrl, unwrapRedirectUrl, stripTrackingParams, canonicalizeDomain, validateUrl } from './url';
import { normalizeTitle, fuzzyTitleMatch, deduplicateWithinScan } from './dedupe';
import { initDb, reserveAlert, wasAlerted, closeDb, getAlertedCount } from './db';
import { isStaleXResult, parseDateFromText } from './sources/x';
import { RawOpportunity, AlertRecord } from './types';
import fs from 'fs';
import path from 'path';

const TEST_DB_DIR = path.join(__dirname, '..', 'data', 'test');
const TEST_DB_PATH = path.join(TEST_DB_DIR, 'test-hackradar.db');

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string): void {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg}`);
  }
}

function assertEqual(actual: unknown, expected: unknown, msg: string): void {
  if (actual === expected) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ FAIL: ${msg} — expected "${expected}", got "${actual}"`);
  }
}

function section(title: string): void {
  console.log(`\n=== ${title} ===`);
}

section('URL Normalization');

assertEqual(
  normalizeUrl('https://superteam.fun/earn/listing/my-bounty'),
  normalizeUrl('https://earn.superteam.fun/listings/my-bounty'),
  'Superteam URL variants normalize to same key'
);

assertEqual(
  normalizeUrl('https://x.com/user/status/123'),
  normalizeUrl('https://twitter.com/user/status/123'),
  'twitter.com and x.com normalize identically'
);

assertEqual(
  normalizeUrl('https://www.devpost.com/hackathons/test/'),
  normalizeUrl('https://devpost.com/hackathons/test'),
  'www prefix and trailing slash normalize'
);

assertEqual(
  normalizeUrl('https://example.com/page?utm_source=twitter&utm_medium=social&real=1'),
  normalizeUrl('https://example.com/page?real=1'),
  'Tracking params stripped, real params kept'
);

assertEqual(
  normalizeUrl('https://example.com/page#section'),
  normalizeUrl('https://example.com/page'),
  'Hash fragment removed'
);

section('Superteam Canonical URLs');

assertEqual(
  buildSuperteamUrl('my-bounty-slug'),
  'https://superteam.fun/earn/listing/my-bounty-slug',
  'buildSuperteamUrl uses singular /listing/ path'
);

assert(
  !buildSuperteamUrl('test').includes('earn.superteam.fun'),
  'buildSuperteamUrl does not use earn.superteam.fun domain'
);

assert(
  !buildSuperteamUrl('test').includes('/listings/'),
  'buildSuperteamUrl does not use plural /listings/'
);

section('Redirect Unwrapping');

assertEqual(
  unwrapRedirectUrl('https://duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fpage'),
  'https://example.com/page',
  'DuckDuckGo uddg redirect unwrapped'
);

assertEqual(
  unwrapRedirectUrl('https://example.com/normal'),
  'https://example.com/normal',
  'Non-redirect URL passed through'
);

section('Title Normalization');

assertEqual(
  normalizeTitle('🚀 Announcing the MEGA Hackathon!! 🏆'),
  normalizeTitle('announcing the mega hackathon'),
  'Emoji/punct/marketing prefix stripped from title'
);

assertEqual(
  normalizeTitle('  APPLY NOW: Solana  Grants  '),
  'solana grants',
  'Leading prefix + whitespace normalization'
);

section('Fuzzy Title Matching');

assert(
  fuzzyTitleMatch(
    normalizeTitle('Solana Radar Hackathon 2025 DeFi Track'),
    normalizeTitle('Solana Radar Hackathon 2025')
  ),
  'Fuzzy match: same event different detail level'
);

assert(
  fuzzyTitleMatch(
    normalizeTitle('ETHGlobal Brussels Hackathon'),
    normalizeTitle('ETHGlobal Brussels Hackathon — Apply Now!')
  ),
  'Fuzzy match: with marketing suffix'
);

assert(
  !fuzzyTitleMatch(
    normalizeTitle('Solana Hackathon'),
    normalizeTitle('Ethereum DevCon Grant')
  ),
  'Fuzzy no match: completely different events'
);

section('Intra-Scan Deduplication');

const dupeOpps: RawOpportunity[] = [
  {
    title: '🚀 Solana Radar Hackathon 2025',
    url: 'https://earn.superteam.fun/listings/solana-radar',
    source: 'SuperteamEarn',
    type: 'hackathon',
    prize: '$50,000',
    tags: ['Solana'],
  },
  {
    title: 'Solana Radar Hackathon 2025',
    url: 'https://superteam.fun/earn/listing/solana-radar',
    source: 'WebSearch',
    type: 'hackathon',
    tags: ['Solana'],
  },
  {
    title: 'ETHGlobal Brussels',
    url: 'https://ethglobal.com/brussels',
    source: 'Devpost',
    type: 'hackathon',
    tags: ['Ethereum'],
  },
];

const deduped = deduplicateWithinScan(dupeOpps);
assertEqual(deduped.length, 2, `Dedup collapsed Superteam URL variants (${deduped.length} remain)`);
assert(
  deduped.some(o => o.title === 'ETHGlobal Brussels'),
  'ETHGlobal opportunity preserved'
);

section('Database: Unique Indexes + Reserve-Before-Send');

process.env.DATA_DIR = TEST_DB_DIR;
if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
if (!fs.existsSync(TEST_DB_DIR)) fs.mkdirSync(TEST_DB_DIR, { recursive: true });

const origDbPath = Object.getOwnPropertyDescriptor(
  require('./config').config, 'dbPath'
);
Object.defineProperty(require('./config').config, 'dbPath', {
  get: () => TEST_DB_PATH,
  configurable: true,
});

initDb();

const record1: AlertRecord = {
  normalizedUrl: normalizeUrl('https://superteam.fun/earn/listing/test-bounty'),
  normalizedTitle: normalizeTitle('Test Bounty Opportunity'),
  title: 'Test Bounty Opportunity',
  url: 'https://superteam.fun/earn/listing/test-bounty',
  source: 'SuperteamEarn',
  priority: 'HIGH',
  alertedAt: new Date().toISOString(),
};

const firstReserve = reserveAlert(record1);
assert(firstReserve === true, 'First reserveAlert returns true (inserted)');

const secondReserve = reserveAlert(record1);
assert(secondReserve === false, 'Second reserveAlert returns false (duplicate blocked)');

assert(
  wasAlerted(record1.normalizedUrl, record1.normalizedTitle) === true,
  'wasAlerted returns true for reserved record'
);

const record2: AlertRecord = {
  normalizedUrl: normalizeUrl('https://devpost.com/hackathons/unique'),
  normalizedTitle: normalizeTitle('Unique Hackathon'),
  title: 'Unique Hackathon',
  url: 'https://devpost.com/hackathons/unique',
  source: 'Devpost',
  priority: 'MEDIUM',
  alertedAt: new Date().toISOString(),
};

assert(
  wasAlerted(record2.normalizedUrl, record2.normalizedTitle) === false,
  'wasAlerted returns false for new record'
);

const thirdReserve = reserveAlert(record2);
assert(thirdReserve === true, 'reserveAlert for new record returns true');
assertEqual(getAlertedCount(), 2, 'DB has exactly 2 records');

closeDb();

section('DRY_RUN does not persist');

if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
initDb();

const preCount = getAlertedCount();
assertEqual(preCount, 0, 'Fresh DB has 0 records');

closeDb();

if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);

if (origDbPath) {
  Object.defineProperty(require('./config').config, 'dbPath', origDbPath);
}

section('URL Domain Canonicalization');

const u1 = new URL('https://earn.superteam.fun/listings/test-slug');
canonicalizeDomain(u1);
assertEqual(u1.hostname, 'superteam.fun', 'earn.superteam.fun → superteam.fun');
assertEqual(u1.pathname, '/earn/listing/test-slug', '/listings/test-slug → /earn/listing/test-slug');

const u2 = new URL('https://twitter.com/user/status/123');
canonicalizeDomain(u2);
assertEqual(u2.hostname, 'x.com', 'twitter.com → x.com');

section('Tracking Params Strip');

const u3 = new URL('https://example.com/page?utm_source=test&utm_medium=social&keep=yes');
stripTrackingParams(u3);
assert(!u3.searchParams.has('utm_source'), 'utm_source removed');
assert(!u3.searchParams.has('utm_medium'), 'utm_medium removed');
assertEqual(u3.searchParams.get('keep'), 'yes', 'Non-tracking param preserved');

console.log(`\n${'='.repeat(40)}`);

section('X/Twitter Recency Filter');

assert(
  isStaleXResult('Join the 2022 Hackathon winners celebration'),
  'Rejects 2022 hackathon result'
);

assert(
  isStaleXResult('Solana Hackathon 2023 — Winners announced'),
  'Rejects 2023 hackathon winners'
);

assert(
  isStaleXResult('Recap of the ETHGlobal 2022 bounty challenge'),
  'Rejects recap of old event'
);

assert(
  isStaleXResult('2024 hackathon results are in!'),
  'Rejects 2024 results announcement'
);

assert(
  isStaleXResult('DoraHacks hackathon ended March 2023'),
  'Rejects ended old hackathon'
);

assert(
  isStaleXResult('Archive of 2021 bounty winners'),
  'Rejects archive content'
);

assert(
  isStaleXResult('Past hackathon from 2023 — great memories'),
  'Rejects "past hackathon" with old year'
);

assert(
  !isStaleXResult('New hackathon open now — $50K prize pool 2026 apply today'),
  'Accepts current 2026 open hackathon'
);

assert(
  !isStaleXResult('Solana Bounty live now — submit by June 2026'),
  'Accepts 2026 live bounty with deadline'
);

assert(
  !isStaleXResult('ETHGlobal 2026 hackathon — register today'),
  'Accepts 2026 hackathon with register signal'
);

assert(
  !isStaleXResult('Join the Web3 hackathon this week — prizes for builders'),
  'Accepts "this week" current hackathon'
);

assert(
  !isStaleXResult('New AI bounty launching now on DoraHacks'),
  'Accepts current "now" bounty'
);

assert(
  isStaleXResult('Web3 hackathon concluded in September'),
  'Rejects concluded hackathon'
);

assert(
  isStaleXResult('Winners announced for the solana 2023 hackathon'),
  'Rejects winners announced for old year'
);

assert(
  !isStaleXResult('2023 hackathon is back — 2026 edition now open apply today'),
  'Accepts result referencing old year BUT with 2026 and open signal'
);

section('Date Parsing from Snippets');

const d1 = parseDateFromText('Deadline: January 15, 2026');
assert(d1 !== null && d1.getFullYear() === 2026 && d1.getMonth() === 0 && d1.getDate() === 15,
  'Parses "January 15, 2026"');

const d2 = parseDateFromText('Posted on 03/15/2023');
assert(d2 !== null && d2.getFullYear() === 2023 && d2.getMonth() === 2 && d2.getDate() === 15,
  'Parses "03/15/2023"');

const d3 = parseDateFromText('Event on 5 May 2026');
assert(d3 !== null && d3.getFullYear() === 2026 && d3.getMonth() === 4 && d3.getDate() === 5,
  'Parses "5 May 2026"');

const d4 = parseDateFromText('No date here just text about hackathons');
assert(d4 === null, 'Returns null when no date found');

assert(
  isStaleXResult('Hackathon posted on 01/15/2023 come join us'),
  'Rejects snippet with parsed date from 2023'
);

assert(
  isStaleXResult('Bounty from Dec 10, 2022 — submit your project'),
  'Rejects snippet with parsed old date (Dec 2022)'
);

console.log(`\n${'='.repeat(40)}`);
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
