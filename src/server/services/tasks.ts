import type { Db } from '../db/connection.js';
import { taskInputSchema, taskUpdateSchema, type TaskStatus } from '../../shared/schemas.js';
import { ConflictError, NotFoundError, ValidationError, zodToMessage } from './errors.js';
import { logChanges } from './change-log.js';
import { extendRecurringGroups } from './recurrence.js';

export interface TaskRow {
  id: number;
  group_id: number | null;
  title: string;
  notes: string | null;
  task_date: string;
  start_time: string;
  end_time: string;
  status: TaskStatus;
  created_by: 'user' | 'ai';
  created_at: string;
  updated_at: string;
}

export interface CreateTaskOptions {
  /** REST "add anyway" only. AI tools never set it. */
  allowOverlap?: boolean;
  createdBy?: 'user' | 'ai';
  /** Set for AI-made changes: logged in the same transaction. */
  messageId?: number | null;
}

interface CreateTaskData {
  group_id?: number | null;
  title: string;
  notes?: string | null;
  task_date: string;
  start_time: string;
  end_time: string;
  status?: TaskStatus;
}

const TASK_COLUMNS = 'id, group_id, title, notes, task_date, start_time, end_time, status, created_by, created_at, updated_at';

export function getTask(db: Db, id: number): TaskRow {
  const row = db.prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE id = ?`).get(id) as
    | TaskRow
    | undefined;
  if (!row) throw new NotFoundError(`Task ${id} not found`);
  return row;
}

export function listTasks(db: Db, from: string, to: string): TaskRow[] {
  extendRecurringGroups(db, to);
  return db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE task_date >= ? AND task_date <= ? AND status != 'cancelled'
       ORDER BY task_date, start_time`,
    )
    .all(from, to) as TaskRow[];
}

/** Overlapping non-cancelled tasks on the same day. */
function findConflicts(
  db: Db,
  taskDate: string,
  startTime: string,
  endTime: string,
  excludeId?: number,
): TaskRow[] {
  return db
    .prepare(
      `SELECT ${TASK_COLUMNS} FROM tasks
       WHERE task_date = ? AND status != 'cancelled' AND id != ?
         AND start_time < ? AND end_time > ?`,
    )
    .all(taskDate, excludeId ?? -1, endTime, startTime) as TaskRow[];
}

function conflictError(conflicts: TaskRow[]): ConflictError {
  const list = conflicts.map(
    (c) => `#${c.id} "${c.title}" ${c.start_time}-${c.end_time}`,
  );
  return new ConflictError(
    `Overlaps ${conflicts.length} task(s): ${list.join(', ')}`,
    list,
  );
}

/** Zod-parse + validate invariants. Shared by create and update. */
function validateInput(input: unknown, schema: typeof taskInputSchema | typeof taskUpdateSchema) {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new ValidationError(zodToMessage(result.error));
  }
  return result.data;
}

export function createTask(
  db: Db,
  input: unknown,
  options: CreateTaskOptions = {},
): TaskRow {
  const data = validateInput(input, taskInputSchema) as CreateTaskData;
  if (data.end_time <= data.start_time) {
    throw new ValidationError('end_time must be after start_time');
  }
  const createdBy = options.createdBy ?? 'user';
  const conflicts = findConflicts(db, data.task_date, data.start_time, data.end_time);
  if (conflicts.length > 0 && !options.allowOverlap) throw conflictError(conflicts);

  const createdAt = new Date().toISOString();
  const info = db
    .prepare(
      `INSERT INTO tasks (group_id, title, notes, task_date, start_time, end_time, status, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      data.group_id ?? null,
      data.title,
      data.notes ?? null,
      data.task_date,
      data.start_time,
      data.end_time,
      data.status ?? 'planned',
      createdBy,
      createdAt,
      createdAt,
    );
  const task = getTask(db, Number(info.lastInsertRowid));

  if (createdBy === 'ai') {
    logChanges(db, options.messageId ?? null, [
      { task_id: task.id, action: 'create', before: null, after: task },
    ]);
  }
  return task;
}

export function updateTask(
  db: Db,
  id: number,
  input: unknown,
  options: CreateTaskOptions = {},
): TaskRow {
  const patch = validateInput(input, taskUpdateSchema);
  const current = getTask(db, id);
  const merged: TaskRow = { ...current, ...patch };

  if (merged.end_time <= merged.start_time) {
    throw new ValidationError('end_time must be after start_time');
  }
  if (
    merged.task_date !== current.task_date ||
    merged.start_time !== current.start_time ||
    merged.end_time !== current.end_time
  ) {
    const conflicts = findConflicts(db, merged.task_date, merged.start_time, merged.end_time, id);
    if (conflicts.length > 0 && !options.allowOverlap) throw conflictError(conflicts);
  }

  db.prepare(
    `UPDATE tasks SET group_id = ?, title = ?, notes = ?, task_date = ?, start_time = ?, end_time = ?, status = ?, updated_at = ? WHERE id = ?`,
  ).run(
    merged.group_id,
    merged.title,
    merged.notes,
    merged.task_date,
    merged.start_time,
    merged.end_time,
    merged.status,
    new Date().toISOString(),
    id,
  );
  const task = getTask(db, id);

  if (options.createdBy === 'ai') {
    logChanges(db, options.messageId ?? null, [
      { task_id: id, action: 'update', before: current, after: task },
    ]);
  }
  return task;
}

export function deleteTask(
  db: Db,
  id: number,
  options: CreateTaskOptions = {},
): void {
  const current = getTask(db, id);
  db.prepare('DELETE FROM tasks WHERE id = ?').run(id);
  if (options.createdBy === 'ai') {
    logChanges(db, options.messageId ?? null, [
      { task_id: id, action: 'delete', before: current, after: null },
    ]);
  }
}

/** Deletes a group and all its tasks, logging each deleted task. */
export function deleteGroup(
  db: Db,
  groupId: number,
  options: CreateTaskOptions = {},
): number {
  return db.transaction(() => {
    const group = db.prepare('SELECT id FROM task_groups WHERE id = ?').get(groupId);
    if (!group) throw new NotFoundError(`Group ${groupId} not found`);

    const tasks = db
      .prepare(`SELECT ${TASK_COLUMNS} FROM tasks WHERE group_id = ? ORDER BY task_date, start_time`)
      .all(groupId) as TaskRow[];

    db.prepare('DELETE FROM task_groups WHERE id = ?').run(groupId); // cascades to tasks
    if (options.createdBy === 'ai') {
      logChanges(
        db,
        options.messageId ?? null,
        tasks.map((t) => ({ task_id: t.id, action: 'delete' as const, before: t, after: null })),
      );
    }
    return tasks.length;
  })();
}
