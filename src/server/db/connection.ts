import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const SCHEMA_PATH = join(dirname(fileURLToPath(import.meta.url)), '../../../schema.sql');
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../../migrations');

export type Db = Database.Database;

export function openDb(path: string): Db {
  const db = new Database(path);
  // Per connection, outside any transaction (CLAUDE.md database rules).
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');

  initSchema(db);
  applyMigrations(db);
  return db;
}

function initSchema(db: Db): void {
  const version = db.pragma('user_version', { simple: true }) as number;
  if (version > 0) return;
  const schema = readFileSync(SCHEMA_PATH, 'utf8');
  db.transaction(() => {
    db.exec(schema); // schema.sql itself runs PRAGMA foreign_keys = ON; harmless here
    db.pragma('user_version = 2');
  })();
}

function applyMigrations(db: Db): void {
  if (!existsSync(MIGRATIONS_DIR)) return;
  const version = db.pragma('user_version', { simple: true }) as number;
  const pending = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((file) => ({ file, n: Number(file.split('_')[0]) }))
    .filter(({ n }) => n > version);
  for (const { file, n } of pending) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.pragma(`user_version = ${n}`);
    })();
  }
}

/** Test helper: in-memory database built from the real schema. */
export function openMemoryDb(): Db {
  return openDb(':memory:');
}
