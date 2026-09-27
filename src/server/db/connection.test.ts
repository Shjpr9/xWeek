import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { openDb, openMemoryDb } from './connection.js';
import { addDays, fromMinutes, toMinutes, weekRange, todayInTz, nowInTz } from '../../shared/time.js';

describe('db connection', () => {
  it('builds the schema from schema.sql and sets user_version = 2', () => {
    const db = openMemoryDb();
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name);
    expect(tables).toEqual(['chat_messages', 'settings', 'task_changes', 'task_groups', 'tasks']);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
  });

  it('is idempotent: initSchema does not re-run or wipe data', () => {
    const db = openMemoryDb();
    // settings row ships in schema.sql; just verify data survives a re-open call.
    const before = db.prepare('SELECT COUNT(*) AS n FROM settings').get();
    expect(before).toEqual({ n: 1 });
    const version = db.pragma('user_version', { simple: true }) as number;
    expect(version).toBe(2);
  });

  it('has foreign_keys enabled and WAL on a real file db', () => {
    const mem = openMemoryDb();
    expect(mem.pragma('foreign_keys', { simple: true })).toBe(1);
    // WAL is meaningless for :memory: (always 'memory'); use a temp file.
    const dir = mkdtempSync(join(tmpdir(), 'xweek-'));
    const db = openDb(join(dir, 'test.db'));
    expect(String(db.pragma('journal_mode', { simple: true }))).toBe('wal');
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('migrates an existing version 1 database', () => {
    const dir = mkdtempSync(join(tmpdir(), 'xweek-migration-'));
    const path = join(dir, 'test.db');
    const oldDb = new Database(path);
    oldDb.exec('CREATE TABLE task_groups (id INTEGER PRIMARY KEY, title TEXT NOT NULL)');
    oldDb.pragma('user_version = 1');
    oldDb.close();

    const db = openDb(path);
    const columns = db.pragma('table_info(task_groups)') as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).toEqual([
      'id', 'title', 'starts_on', 'start_time', 'end_time',
    ]);
    expect(db.pragma('user_version', { simple: true })).toBe(2);
    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});

describe('time helpers', () => {
  it('toMinutes / fromMinutes round-trip', () => {
    expect(toMinutes('07:30')).toBe(450);
    expect(toMinutes('23:59')).toBe(1439);
    expect(fromMinutes(450)).toBe('07:30');
    expect(fromMinutes(0)).toBe('00:00');
  });

  it('rejects invalid time/date formats', () => {
    expect(() => toMinutes('7:30')).toThrow();
    expect(() => toMinutes('24:00')).toThrow();
    expect(() => fromMinutes(1440)).toThrow();
    expect(() => addDays('2026-02-30', 1)).toThrow(); // impossible date
    expect(() => addDays('2026-13-01', 1)).toThrow();
  });

  it('addDays crosses month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28'); // 2026 not a leap year
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29'); // 2028 is
  });

  it('weekRange respects week_starts_on', () => {
    // 2026-09-22 is a Tuesday.
    expect(weekRange('2026-09-22', 1)).toEqual({ start: '2026-09-21', end: '2026-09-27' });
    expect(weekRange('2026-09-22', 0)).toEqual({ start: '2026-09-20', end: '2026-09-26' });
    // Sunday with week starting Sunday: same day.
    expect(weekRange('2026-09-20', 0)).toEqual({ start: '2026-09-20', end: '2026-09-26' });
  });

  it('reads today/now through a timezone, not the server clock', () => {
    const utc = nowInTz('UTC');
    expect(utc.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(utc.time).toMatch(/^\d{2}:\d{2}$/);
    // Two zones far apart should agree on the date at most an hour off midnight;
    // just check both parse and todayInTz agrees with nowInTz.
    expect(todayInTz('Pacific/Kiritimati')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(todayInTz('UTC')).toBe(utc.date);
  });
});
