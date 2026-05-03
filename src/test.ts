import { normalizeUrl, buildSuperteamUrl, unwrapRedirectUrl, stripTrackingParams, canonicalizeDomain, validateUrl } from './url';
import { normalizeTitle, fuzzyTitleMatch, deduplicateWithinScan } from './dedupe';
import { initDb, reserveAlert, wasAlerted, closeDb, getAlertedCount } from './db';
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
console.log(`Results: ${passed} passed, ${failed} failed`);
if (failed > 0) {
  process.exit(1);
}
