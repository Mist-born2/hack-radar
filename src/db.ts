import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { config, log } from './config';
import { AlertRecord } from './types';

let db: Database.Database;

export function initDb(): void {
  const dir = path.dirname(config.dbPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(config.dbPath);
  db.pragma('journal_mode = WAL');

  db.exec(`
    CREATE TABLE IF NOT EXISTS alerted (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      normalized_url TEXT NOT NULL,
      normalized_title TEXT NOT NULL,
      title TEXT NOT NULL,
      url TEXT NOT NULL,
      source TEXT NOT NULL,
      priority TEXT NOT NULL,
      alerted_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_alerted_url ON alerted(normalized_url);
    CREATE INDEX IF NOT EXISTS idx_alerted_title ON alerted(normalized_title);
  `);

  migrateUniqueIndexes();

  log.info('Database initialized at', config.dbPath);
}

function migrateUniqueIndexes(): void {
  try {
    const dupeUrls = db.prepare(`
      SELECT normalized_url, MIN(id) as keep_id
      FROM alerted
      GROUP BY normalized_url
      HAVING COUNT(*) > 1
    `).all() as { normalized_url: string; keep_id: number }[];

    for (const row of dupeUrls) {
      db.prepare(`DELETE FROM alerted WHERE normalized_url = ? AND id != ?`)
        .run(row.normalized_url, row.keep_id);
      log.debug(`Deduplicated existing rows for URL: ${row.normalized_url}`);
    }

    const dupeTitles = db.prepare(`
      SELECT normalized_title, MIN(id) as keep_id
      FROM alerted
      WHERE normalized_title != ''
      GROUP BY normalized_title
      HAVING COUNT(*) > 1
    `).all() as { normalized_title: string; keep_id: number }[];

    for (const row of dupeTitles) {
      db.prepare(`DELETE FROM alerted WHERE normalized_title = ? AND id != ?`)
        .run(row.normalized_title, row.keep_id);
      log.debug(`Deduplicated existing rows for title: ${row.normalized_title}`);
    }
  } catch (e) {
    log.warn('Dedup of existing rows during migration:', (e as Error).message);
  }

  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alerted_url_unique ON alerted(normalized_url)`);
  } catch (e) {
    log.warn('Could not create unique URL index (may have residual dupes):', (e as Error).message);
  }

  try {
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_alerted_title_unique ON alerted(normalized_title) WHERE normalized_title != ''`);
  } catch (e) {
    log.warn('Could not create unique title index:', (e as Error).message);
  }
}

export function wasAlerted(normalizedUrl: string, normalizedTitle: string): boolean {
  const row = db.prepare(
    `SELECT id FROM alerted WHERE normalized_url = ? OR normalized_title = ? LIMIT 1`
  ).get(normalizedUrl, normalizedTitle);
  return !!row;
}

export function reserveAlert(record: AlertRecord): boolean {
  try {
    const result = db.prepare(
      `INSERT OR IGNORE INTO alerted (normalized_url, normalized_title, title, url, source, priority, alerted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      record.normalizedUrl,
      record.normalizedTitle,
      record.title,
      record.url,
      record.source,
      record.priority,
      record.alertedAt || new Date().toISOString()
    );
    return result.changes > 0;
  } catch (e) {
    log.debug(`reserveAlert INSERT OR IGNORE failed: ${(e as Error).message}`);
    return false;
  }
}

export function markAlerted(record: AlertRecord): boolean {
  return reserveAlert(record);
}

export function getAlertedCount(): number {
  const row = db.prepare('SELECT COUNT(*) as cnt FROM alerted').get() as { cnt: number };
  return row.cnt;
}

export function closeDb(): void {
  if (db) {
    db.close();
    log.info('Database closed');
  }
}
