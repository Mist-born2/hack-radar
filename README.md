# HackathonRadar 🎯

Autonomous bot that scans hackathon/bounty/grant sources every 6 hours and sends qualifying alerts to a WhatsApp group.

## Sources (scan order)

1. **X/Twitter** — searches Nitter instances, syndication feeds, RSS bridges, and web-search-scoped X results for hackathon/bounty/grant announcements
2. **Devpost** — open and upcoming hackathons
3. **Superteam Earn** — Solana bounties, grants, and hackathons
4. **DoraHacks** — hackathons and bounties
5. **Gitcoin** — grant rounds and public goods funding
6. **Ethereum Foundation** — blog posts about grants, hackathons, devcon (date-filtered)
7. **Solana Foundation** — news and announcements (date-filtered)
8. **Web Search** — DuckDuckGo/Brave searches for general hackathon/bounty queries

X/Twitter is always scanned first. Each source is independent — if one fails, the rest continue.

## Quick Start

```bash
# Clone and install
git clone https://github.com/Mist-born2/hack-radar.git
cd hack-radar
npm install

# Configure
cp .env.example .env
# Edit .env — at minimum set WHATSAPP_GROUP_NAME or WHATSAPP_GROUP_ID

# Build and run
npm run build
npm start
```

On first run, a QR code appears in the terminal. Scan it with WhatsApp (Linked Devices). If hosted logs render the QR too large or distorted, the bot also prints a QR image link you can open in a browser and scan. The session persists in `./data/wwebjs_auth/` so you only need to scan once.

### Dry Run

Test without WhatsApp — logs messages to console instead:

```bash
DRY_RUN=true npm start
```

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `WHATSAPP_GROUP_ID` | _(empty)_ | WhatsApp group ID (takes precedence over name) |
| `WHATSAPP_GROUP_NAME` | `HackathonRadar` | Partial group name match (case-insensitive) |
| `SCAN_CRON` | `0 */6 * * *` | Cron schedule for scans |
| `SCAN_ON_START` | `true` | Run scan immediately on startup |
| `DRY_RUN` | `false` | Log messages instead of sending to WhatsApp |
| `MAX_ALERTS_PER_SCAN` | `10` | Cap alerts per scan cycle |
| `DATA_DIR` | `./data` | Directory for SQLite DB and WhatsApp session |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `NITTER_INSTANCES` | _(built-in list)_ | Comma-separated Nitter instance URLs for X scanning |
| `X_SEARCH_QUERIES` | _(built-in list)_ | Comma-separated custom X/Twitter search terms |

## Group Targeting

The bot resolves the target WhatsApp group at startup:

1. If `WHATSAPP_GROUP_ID` is set, uses that directly (e.g., `120363012345678@g.us`).
2. Otherwise searches your chats for a group whose name contains `WHATSAPP_GROUP_NAME`.

To find your group ID, set `LOG_LEVEL=debug` — it logs all groups on startup.

## Alert Format

Each opportunity is sent as an individual message:

```
🚨 NEW OPPORTUNITY DETECTED
🏆 Solana Radar Hackathon
💰 Prize: $50,000
⏰ Deadline: Jun 15, 2026
🏷️ Tags: [Solana] [Web3] [DeFi]
🌍 Open to: Global
🔗 https://example.com/hackathon
📌 Build DeFi tools on Solana. Open to developers worldwide.
---
Priority: 🔴 HIGH
```

When 3+ opportunities are found, an intro message is sent first:
```
🔍 HackathonRadar found 5 new opportunities:
```

## Priority Levels

| Priority | Criteria |
|---|---|
| 🔴 HIGH | Prize > $1,000 OR deadline ≤ 3 days OR from major org (Solana Foundation, Ethereum Foundation, Gitcoin, a16z, DoraHacks, Superteam) |
| 🟡 MEDIUM | Prize $100–$1,000 OR open bounty with clear reward |
| 🟢 LOW | Smaller prizes, vague scope, or no hard deadline |

HIGH priority alerts are sent immediately when found. MEDIUM and LOW are batched at end of scan.

## Qualification Rules

An opportunity must meet **all** criteria:
- Currently open or opening within 7 days
- Remote/global participation (or includes Africa/Nigeria)
- Has a real prize, reward, bounty, or grant
- Relevant to Web3, Solana, DeFi, AI, or general software dev

Rejected: expired events, in-person-only outside Africa, swag-only, duplicates.

## Deduplication

Opportunities are stored in SQLite with unique indexes on normalized URL and title. The DB uses `INSERT OR IGNORE` semantics so duplicate sends are prevented even across restarts or overlapping scan cycles. URL normalization strips tracking parameters, unwraps redirects (DuckDuckGo `uddg`, Superteam redirects), lowercases hosts, removes `www.`, and canonicalizes known domains (twitter.com → x.com, earn.superteam.fun → superteam.fun). Title normalization strips emoji, punctuation, and marketing prefixes. Within a single scan, fuzzy title matching (Jaccard token overlap ≥ 0.6) prevents the same event from multiple sources from sending twice.

In live mode, the bot reserves each alert in the DB before sending to WhatsApp. If a send fails after reservation, it stays reserved to prevent duplicate sends on retry. In dry-run mode, nothing is persisted to the DB.

## URL Validation

Before sending alerts, URLs are validated with a HEAD request (fallback to GET if HEAD is blocked). URLs returning 404 or 410 are dropped and do not consume the per-scan send cap. URLs returning 401/403/429 are treated as maybe-valid (kept) since some sites block bot traffic. This prevents sending alerts with broken links.

## X/Twitter Scanning

The X scanner uses public web-accessible methods (no API key required):

1. **Nitter instances** — searches open Nitter mirrors for tweets matching each query
2. **Twitter syndication** — fetches public timeline embeds for key accounts (DoraHacks, Solana, EthGlobal, Superteam, etc.)
3. **RSS bridges** — tries RSSHub and similar services for search-to-RSS conversion
4. **Web search fallback** — if Nitter/syndication/RSS return zero results, searches DuckDuckGo and Brave for `site:x.com` and `site:twitter.com` posts about hackathons, bounties, and grants. Parses results, unwraps redirects, filters to only x.com/twitter.com status URLs, and builds opportunities from titles and snippets.

**Logging:** Production logs show per-path result counts, e.g. `X/Twitter: found 5 opportunities across 11 queries (nitter: 0, syndication: 0, rss: 0, websearch: 5)`.

**Limitations:**
- Nitter instances frequently go offline or get rate-limited. The scanner rotates through multiple instances and falls back gracefully.
- Syndication endpoints only show recent tweets from specific accounts, not full search.
- RSS bridges may have limited availability.
- Web search fallback depends on DuckDuckGo/Brave indexing recent X posts; results may lag real-time.
- Results depend on which public endpoints are currently operational.
- To improve reliability, provide working Nitter instances via `NITTER_INSTANCES`.
- Search queries can be customized via `X_SEARCH_QUERIES`.

**Default search terms:** `hackathon`, `bounty`, `build competition`, `grant`, `$prize pool`, `win $`, `superteam`, `dorahacks`, `web3 hackathon`, `solana bounty`, `ai hackathon prize`

## Foundation Scanners

The Ethereum Foundation and Solana Foundation scanners parse RSS feeds and blog pages. To avoid flagging old/historical blog posts as open opportunities:
- Posts older than 60 days are only included if they contain explicit open/current language ("apply now", "accepting submissions", "deadline", etc.)
- Posts without clear open/current signals are skipped regardless of keyword matches
- When a deadline is detectable in the post content, it is extracted and used for qualification

## Docker

```bash
# Build and run
docker compose up -d

# Watch logs (look for QR code on first run)
docker compose logs -f

# Stop
docker compose down
```

Data persists in a Docker volume (`hackradar-data`). The container includes Chromium for whatsapp-web.js.

To scan the QR code on first run, you need to watch logs in real time:
```bash
docker compose up  # foreground, scan QR, then Ctrl+C and restart with -d
```

## PM2

```bash
npm run build
pm2 start dist/index.js --name hackradar
pm2 save
pm2 logs hackradar  # watch for QR on first run
```

## Project Structure

```
src/
├── index.ts          # Entry point, scheduler, graceful shutdown
├── config.ts         # Environment config and logging
├── types.ts          # TypeScript interfaces
├── http.ts           # HTTP fetch utilities
├── url.ts            # URL normalization, validation, redirect unwrapping
├── db.ts             # SQLite persistence with unique indexes and reserve-before-send
├── dedupe.ts         # Deduplication logic with fuzzy title matching
├── scanner.ts        # Scan orchestrator (source ordering, URL validation)
├── qualifier.ts      # Qualification rules
├── priority.ts       # Priority assignment
├── format.ts         # WhatsApp message formatting
├── whatsapp.ts       # WhatsApp client (QR login, session, sending)
└── sources/
    ├── index.ts      # Source exports
    ├── x.ts          # X/Twitter (Nitter/syndication/RSS/web-search)
    ├── devpost.ts    # Devpost hackathons
    ├── superteam.ts  # Superteam Earn
    ├── dorahacks.ts  # DoraHacks
    ├── gitcoin.ts    # Gitcoin Grants
    ├── ethfoundation.ts  # Ethereum Foundation blog (date-filtered)
    ├── solana.ts     # Solana Foundation (date-filtered)
    └── websearch.ts  # DuckDuckGo/Brave web search
```

## Caveats

- **WhatsApp Web sessions** can expire if WhatsApp mobile is offline for extended periods. Re-scan the QR if the session breaks. On container platforms, rapid restarts can leave stale Chromium `Singleton*` lock files in the session directory; the bot removes those on startup before launching WhatsApp Web.
- **Web scraping** is inherently fragile. Sites change their HTML structure. Scanners are written defensively and will log errors rather than crash.
- **X/Twitter access** depends on third-party Nitter instances and public endpoints which may be unreliable. The web search fallback provides more reliable X content discovery when Nitter is down.
- **Rate limiting** — the bot adds delays between requests. If you get blocked, increase delays or reduce query count.
- **WhatsApp ToS** — automated messaging may violate WhatsApp terms of service. Use at your own risk.
- **No paid APIs required** — all sources use free public endpoints, HTML scraping, or RSS feeds.
