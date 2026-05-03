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

  log.info('Database initialized at', config.dbPath);
}

export function wasAlerted(normalizedUrl: string, normalizedTitle: string): boolean {
  const row = db.prepare(
    `SELECT id FROM alerted WHERE normalized_url = ? OR normalized_title = ? LIMIT 1`
  ).get(normalizedUrl, normalizedTitle);
  return !!row;
}

export function markAlerted(record: AlertRecord): void {
  db.prepare(
    `INSERT INTO alerted (normalized_url, normalized_title, title, url, source, priority, alerted_at)
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
