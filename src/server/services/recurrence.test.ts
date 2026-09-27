import { expect, it } from 'vitest';
import { openMemoryDb } from '../db/connection.js';
import { addDays, todayInTz } from '../../shared/time.js';
import { createRecurringTask } from './recurrence.js';
import { createTask, deleteTask, listTasks, updateTask } from './tasks.js';
import { ConflictError, ValidationError } from './errors.js';

it('materializes 12 weeks and extends a series without repeating edited or deleted dates', () => {
  const db = openMemoryDb();
  const today = todayInTz('UTC');
  const through = addDays(today, 83);
  const group = createRecurringTask(db, {
    title: 'Gym', starts_on: today, start_time: '19:00', end_time: '20:00',
    recurrence_rule: 'FREQ=DAILY',
  });
  expect(group.tasks).toHaveLength(84);
  expect(group.tasks[0].task_date).toBe(today);
  expect(group.tasks.at(-1)?.task_date).toBe(through);

  updateTask(db, group.tasks[0].id, { start_time: '18:00', end_time: '19:00' });
  deleteTask(db, group.tasks[1].id);
  const next = addDays(through, 1);
  expect(listTasks(db, next, next)).toMatchObject([
    { title: 'Gym', task_date: next, start_time: '19:00', end_time: '20:00' },
  ]);
  expect(listTasks(db, today, next)).toHaveLength(84);
  expect(listTasks(db, next, next)).toHaveLength(1);
});

it('keeps a failed expansion atomic and rejects invalid rules', () => {
  const db = openMemoryDb();
  const today = todayInTz('UTC');
  expect(() => createRecurringTask(db, {
    title: 'Bad', starts_on: today, start_time: '09:00', end_time: '10:00',
    recurrence_rule: 'FREQ=HOURLY',
  })).toThrow(ValidationError);
  expect(db.prepare('SELECT COUNT(*) AS n FROM task_groups').get()).toEqual({ n: 0 });

  const group = createRecurringTask(db, {
    title: 'Gym', starts_on: today, start_time: '19:00', end_time: '20:00',
    recurrence_rule: 'FREQ=DAILY',
  });
  const next = addDays(today, 84);
  createTask(db, { title: 'Busy', task_date: next, start_time: '19:30', end_time: '20:30' });
  expect(() => listTasks(db, next, addDays(next, 1))).toThrow(ConflictError);
  expect(db.prepare('SELECT materialized_until FROM task_groups WHERE id = ?').get(group.id))
    .toEqual({ materialized_until: addDays(today, 83) });
  expect(db.prepare('SELECT COUNT(*) AS n FROM tasks WHERE group_id = ?').get(group.id))
    .toEqual({ n: 84 });
});

it('respects RRULE day selection and COUNT', () => {
  const db = openMemoryDb();
  const start = addDays(todayInTz('UTC'), 1);
  const group = createRecurringTask(db, {
    title: 'Class', starts_on: start, start_time: '10:00', end_time: '11:00',
    recurrence_rule: 'FREQ=WEEKLY;BYDAY=MO,WE;COUNT=3',
  });
  expect(group.tasks).toHaveLength(3);
  expect(group.tasks.every((task) => [1, 3].includes(new Date(`${task.task_date}T00:00:00Z`).getUTCDay()))).toBe(true);
});
