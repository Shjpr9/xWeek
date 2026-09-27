import { describe, expect, it } from 'vitest';
import { openMemoryDb, type Db } from '../db/connection.js';
import { createTask, deleteGroup, deleteTask, getTask, listTasks, updateTask } from './tasks.js';
import { getSettings, updateSettings } from './settings.js';
import { ConflictError, NotFoundError, ValidationError } from './errors.js';
import { logChanges } from './change-log.js';

function setup(): Db {
  return openMemoryDb();
}
function at(db: Db, n: number): number {
  // Helper: create a simple task, return its id.
  return createTask(db, {
    title: `Task ${n}`,
    task_date: '2026-09-22',
    start_time: '10:00',
    end_time: '11:00',
  }).id;
}

describe('tasks service', () => {
  it('creates a task with defaults', () => {
    const db = setup();
    const t = createTask(db, {
      title: 'Study',
      task_date: '2026-09-22',
      start_time: '09:00',
      end_time: '11:00',
    });
    expect(t.status).toBe('planned');
    expect(t.created_by).toBe('user');
    expect(t.group_id).toBeNull();
  });

  it('rejects invalid input and end <= start', () => {
    const db = setup();
    expect(() =>
      createTask(db, { title: '', task_date: '2026-09-22', start_time: '10:00', end_time: '11:00' }),
    ).toThrow(ValidationError);
    expect(() =>
      createTask(db, { title: 'x', task_date: '2026-09-22', start_time: '11:00', end_time: '10:00' }),
    ).toThrow(ValidationError);
    expect(() =>
      createTask(db, { title: 'x', task_date: '2026-09-22', start_time: '10:00', end_time: '10:00' }),
    ).toThrow(ValidationError);
  });

  it('rejects overlap with a ConflictError listing conflicts', () => {
    const db = setup();
    const a = at(db, 1); // 10:00-11:00
    expect(() =>
      createTask(db, {
        title: 'B',
        task_date: '2026-09-22',
        start_time: '10:30',
        end_time: '11:30',
      }),
    ).toThrow(ConflictError);
    try {
      createTask(db, { title: 'B', task_date: '2026-09-22', start_time: '10:30', end_time: '11:30' });
    } catch (e) {
      expect((e as ConflictError).conflicts).toHaveLength(1);
      expect((e as ConflictError).conflicts[0]).toContain('Task 1');
    }
    // Touching edges is fine (end == start).
    expect(() =>
      createTask(db, { title: 'B', task_date: '2026-09-22', start_time: '11:00', end_time: '12:00' }),
    ).not.toThrow();
    // allowOverlap bypasses.
    const c = createTask(
      db,
      { title: 'C', task_date: '2026-09-22', start_time: '10:30', end_time: '11:30' },
      { allowOverlap: true },
    );
    expect(c.id).toBeGreaterThan(a);
  });

  it('ignores cancelled tasks in overlap checks', () => {
    const db = setup();
    const a = at(db, 1);
    updateTask(db, a, { status: 'cancelled' });
    expect(() =>
      createTask(db, { title: 'B', task_date: '2026-09-22', start_time: '10:00', end_time: '11:00' }),
    ).not.toThrow();
  });

  it('updates a task and re-checks conflicts on time changes', () => {
    const db = setup();
    at(db, 1); // 10:00-11:00
    const b = createTask(db, {
      title: 'B',
      task_date: '2026-09-22',
      start_time: '12:00',
      end_time: '13:00',
    });
    const updated = updateTask(db, b.id, { start_time: '09:00', end_time: '09:30' });
    expect(updated.start_time).toBe('09:00');
    // Now 09:00-09:30 vs 10:00-11:00 doesn't conflict, but moving onto it does.
    expect(() => updateTask(db, b.id, { start_time: '10:30', end_time: '10:45' })).toThrow(
      ConflictError,
    );
    // Title-only change doesn't trigger a conflict check against itself.
    expect(updateTask(db, b.id, { title: 'Renamed' }).title).toBe('Renamed');
  });

  it('update rejects end <= start after merging partial patch', () => {
    const db = setup();
    const id = at(db, 1); // 10:00-11:00
    expect(() => updateTask(db, id, { start_time: '12:00' })).toThrow(ValidationError);
    expect(() => updateTask(db, id, { end_time: '09:00' })).toThrow(ValidationError);
  });

  it('deletes a task and throws NotFoundError for unknown ids', () => {
    const db = setup();
    const id = at(db, 1);
    deleteTask(db, id);
    expect(() => getTask(db, id)).toThrow(NotFoundError);
    expect(() => deleteTask(db, 9999)).toThrow(NotFoundError);
  });

  it('lists tasks in a date range ordered by date and time', () => {
    const db = setup();
    createTask(db, { title: 'late', task_date: '2026-09-22', start_time: '18:00', end_time: '19:00' });
    createTask(db, { title: 'early', task_date: '2026-09-22', start_time: '08:00', end_time: '09:00' });
    createTask(db, { title: 'nextday', task_date: '2026-09-23', start_time: '08:00', end_time: '09:00' });
    const rows = listTasks(db, '2026-09-22', '2026-09-22');
    expect(rows.map((r) => r.title)).toEqual(['early', 'late']);
    const all = listTasks(db, '2026-09-22', '2026-09-23');
    expect(all.map((r) => r.title)).toEqual(['early', 'late', 'nextday']);
  });
});

describe('groups (split-goal deletion)', () => {
  it('deleteGroup cascades and returns the number of tasks removed', () => {
    const db = setup();
    const g = db
      .prepare("INSERT INTO task_groups (title, total_minutes, created_by) VALUES ('Study', 120, 'user')")
      .run();
    const gid = Number(g.lastInsertRowid);
    createTask(db, { title: 'a', group_id: gid, task_date: '2026-09-22', start_time: '09:00', end_time: '09:30' });
    createTask(db, { title: 'b', group_id: gid, task_date: '2026-09-23', start_time: '09:00', end_time: '09:30' });
    expect(deleteGroup(db, gid)).toBe(2);
    expect(listTasks(db, '2026-09-01', '2026-09-30')).toHaveLength(0);
    expect(() => deleteGroup(db, gid)).toThrow(NotFoundError);
  });
});

describe('change log', () => {
  it('logs AI creates/updates/deletes when messageId is given', () => {
    const db = setup();
    const msg = db
      .prepare("INSERT INTO chat_messages (role, content) VALUES ('user', 'hi')")
      .run();
    const messageId = Number(msg.lastInsertRowid);

    const t = createTask(
      db,
      { title: 'AI task', task_date: '2026-09-22', start_time: '09:00', end_time: '10:00' },
      { createdBy: 'ai', messageId },
    );
    updateTask(db, t.id, { title: 'AI task renamed' }, { createdBy: 'ai', messageId });
    deleteTask(db, t.id, { createdBy: 'ai', messageId });

    const rows = db.prepare('SELECT * FROM task_changes ORDER BY id').all() as Array<{
      message_id: number | null;
      task_id: number;
      action: string;
      before_json: string | null;
      after_json: string | null;
    }>;
    expect(rows.map((r) => r.action)).toEqual(['create', 'update', 'delete']);
    expect(JSON.parse(rows[0].after_json!).title).toBe('AI task');
    expect(JSON.parse(rows[1].before_json!).title).toBe('AI task');
    expect(JSON.parse(rows[1].after_json!).title).toBe('AI task renamed');
    expect(JSON.parse(rows[2].before_json!).title).toBe('AI task renamed');
    expect(rows[2].after_json).toBeNull();
    expect(rows[0].message_id).toBe(messageId);
  });

  it('does not log user/REST changes', () => {
    const db = setup();
    const t = createTask(db, {
      title: 'user task',
      task_date: '2026-09-22',
      start_time: '09:00',
      end_time: '10:00',
    });
    updateTask(db, t.id, { title: 'renamed' });
    deleteTask(db, t.id);
    expect(db.prepare('SELECT COUNT(*) AS n FROM task_changes').get()).toEqual({ n: 0 });
  });

  it('logChanges writes arbitrary entries (used by group deletes)', () => {
    const db = setup();
    logChanges(db, null, []);
    expect(db.prepare('SELECT COUNT(*) AS n FROM task_changes').get()).toEqual({ n: 0 });
  });
});

describe('settings service', () => {
  it('returns defaults on first read', () => {
    const db = setup();
    const s = getSettings(db);
    expect(s.timezone).toBe('UTC');
    expect(s.week_starts_on).toBe(1);
    expect(s.day_start).toBe('07:00');
    expect(s.day_end).toBe('23:00');
  });

  it('patches individual fields and validates the merge', () => {
    const db = setup();
    updateSettings(db, { timezone: 'Europe/Berlin' });
    updateSettings(db, { day_start: '08:00' });
    const s = getSettings(db);
    expect(s.timezone).toBe('Europe/Berlin');
    expect(s.day_start).toBe('08:00');
    expect(s.day_end).toBe('23:00'); // untouched
  });

  it('rejects bad patches', () => {
    const db = setup();
    expect(() => updateSettings(db, { day_start: '25:00' })).toThrow(ValidationError);
    expect(() => updateSettings(db, { timezone: 'Not/AZone' })).toThrow(ValidationError);
    expect(() => updateSettings(db, { week_starts_on: 2 })).toThrow(ValidationError);
    // merged day_end > day_start
    expect(() => updateSettings(db, { day_start: '23:30' })).toThrow(ValidationError);
  });
});
