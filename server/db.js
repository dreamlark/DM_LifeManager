/**
 * Modul: Datenbank
 * Zweck: Singleton better-sqlite3-Verbindung, WAL-Pragmas, Migrations-Tracking.
 * Yuvomi-Stil: eine native SQLite-Datei, eine Verbindung, synchrone API.
 *
 * Alle Module erhalten diese Verbindung über ctx.db und führen ihr
 * CREATE TABLE IF NOT EXISTS in mod.migrate(db) aus.
 */

import Database from 'better-sqlite3';
import path from 'node:path';
import fs from 'node:fs';
import { createLogger } from './logger.js';

const log = createLogger('DB');

// Datenverzeichnis: via ENV oder Standard unter cwd/data.
const DATA_DIR = process.env.DATA_DIR
  || (process.env.DB_PATH ? path.dirname(process.env.DB_PATH) : path.join(process.cwd(), 'data'));

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'dm-life.db');

log.info(`Opening database at ${DB_PATH}`);

const db = new Database(DB_PATH);

// Pragmas für Sicherheit + Concurrency (Yuvomi-Konvention).
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('synchronous = NORMAL');

// Core-Tabellen (immer vorhanden, unabhängig von Modulen).
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE,
    display_name  TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    avatar_color  TEXT NOT NULL DEFAULT '#6366f1',
    role          TEXT NOT NULL DEFAULT 'admin',
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ','now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    sid        TEXT PRIMARY KEY,
    sess       TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_config (
    key   TEXT PRIMARY KEY,
    value TEXT
  );
`);

// App-Name Default (wird ggf. vom Installer überschrieben).
db.prepare(`INSERT OR IGNORE INTO sync_config (key, value) VALUES (?, ?)`).run('app_name', 'DM Life');

/**
 * Zentrale Zugriffsfunktion für Module.
 * @returns {import('better-sqlite3').Database}
 */
export function getDb() {
  return db;
}

/**
 * Führt ein Modul-Migration-Skript idempotent aus.
 * Module rufen dies in ihrer migrate()-Funktion auf.
 * @param {string} name - Modulname (für Tracking)
 * @param {string} sql  - DDL (CREATE TABLE IF NOT EXISTS …)
 */
export function migrateModule(name, sql) {
  try {
    db.exec(sql);
    log.info(`Migration applied: ${name}`);
  } catch (err) {
    log.error(`Migration failed: ${name}`, err.message);
    throw err;
  }
}

export { DATA_DIR, DB_PATH };
export default db;
