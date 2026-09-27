import rrule from 'rrule';
import type { Db } from '../db/connection.js';
import { recurringTaskInputSchema } from '../../shared/schemas.js';
import { addDays, todayInTz } from '../../shared/time.js';
import { ValidationError, zodToMessage } from './errors.js';
import { getSettings } from './settings.js';
import { createTask, type CreateTaskOptions, type TaskRow } from './tasks.js';

const { RRule } = rrule;

interface RecurringGroup {
  id: number;
  title: string;
  description: string | null;
  recurrence_rule: string;
  starts_on: string;
  start_time: string;
  end_time: string;
  materialized_until: string | null;
  created_by: 'user' | 'ai';
}

function utcDate(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function parseRule(rule: string, startsOn: string): InstanceType<typeof RRule> {
  try {
    addDays(startsOn, 0);
    if (!rule.startsWith('FREQ=')) throw new Error('RRULE must start with FREQ=');
    const parsed = RRule.parseString(rule);
    if (parsed.freq === undefined || parsed.freq > RRule.DAILY ||
        parsed.byhour !== undefined || parsed.byminute !== undefined || parsed.bysecond !== undefined) {
      throw new Error('RRULE must repeat by whole days');
    }
    return new RRule({ ...parsed, dtstart: utcDate(startsOn) });
  } catch (error) {
    throw new ValidationError(`Invalid recurrence_rule: ${error instanceof Error ? error.message : 'unknown rule'}`);
  }
}

function materialize(db: Db, group: RecurringGroup, to: string, options: CreateTaskOptions, firstDay = group.starts_on): TaskRow[] {
  const from = group.materialized_until ? addDays(group.materialized_until, 1) : firstDay;
  if (from > to) return [];
  const rule = parseRule(group.recurrence_rule, group.starts_on);
  const tasks = rule.between(utcDate(from), utcDate(to), true).map((date) => createTask(db, {
    group_id: group.id,
    title: group.title,
    notes: group.description,
    task_date: date.toISOString().slice(0, 10),
    start_time: group.start_time,
    end_time: group.end_time,
  }, options));
  db.prepare('UPDATE task_groups SET materialized_until = ? WHERE id = ?').run(to, group.id);
  return tasks;
}

export function createRecurringTask(
  db: Db,
  input: unknown,
  options: CreateTaskOptions = {},
): { id: number; tasks: TaskRow[] } {
  const parsed = recurringTaskInputSchema.safeParse(input);
  if (!parsed.success) throw new ValidationError(zodToMessage(parsed.error));
  const data = parsed.data;
  parseRule(data.recurrence_rule, data.starts_on);
  const today = todayInTz(getSettings(db).timezone);
  const through = addDays(data.starts_on > today ? data.starts_on : today, 83);

  return db.transaction(() => {
    const info = db.prepare(
      `INSERT INTO task_groups (title, description, recurrence_rule, starts_on, start_time, end_time, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(data.title, data.notes ?? null, data.recurrence_rule, data.starts_on,
      data.start_time, data.end_time, options.createdBy ?? 'user');
    const group: RecurringGroup = {
      id: Number(info.lastInsertRowid), title: data.title, description: data.notes ?? null,
      recurrence_rule: data.recurrence_rule, starts_on: data.starts_on,
      start_time: data.start_time, end_time: data.end_time,
      materialized_until: null, created_by: options.createdBy ?? 'user',
    };
    return { id: group.id, tasks: materialize(db, group, through, options,
      data.starts_on > today ? data.starts_on : today) };
  })();
}

export function extendRecurringGroups(db: Db, to: string): void {
  const groups = db.prepare(
    `SELECT id, title, description, recurrence_rule, starts_on, start_time, end_time,
            materialized_until, created_by FROM task_groups
     WHERE recurrence_rule IS NOT NULL AND starts_on <= ?
       AND (materialized_until IS NULL OR materialized_until < ?)`,
  ).all(to, to) as RecurringGroup[];
  for (const group of groups) {
    db.transaction(() => materialize(db, group, to, { createdBy: group.created_by }))();
  }
}
