import type { Db } from '../db/connection.js';
import { taskGroupInputSchema } from '../../shared/schemas.js';
import { ValidationError, zodToMessage } from './errors.js';
import { createTask, type CreateTaskOptions, type TaskRow } from './tasks.js';

export function createTaskGroup(
  db: Db,
  input: unknown,
  options: CreateTaskOptions = {},
): { id: number; tasks: TaskRow[] } {
  const parsed = taskGroupInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodToMessage(parsed.error));
  const { title, total_minutes, tasks } = parsed.data;

  return db.transaction(() => {
    const info = db.prepare(
      'INSERT INTO task_groups (title, total_minutes, created_by) VALUES (?, ?, ?)',
    ).run(title, total_minutes ?? null, options.createdBy ?? 'user');
    const id = Number(info.lastInsertRowid);
    return {
      id,
      tasks: tasks.map((task) => createTask(db, { ...task, group_id: id }, options)),
    };
  })();
}
