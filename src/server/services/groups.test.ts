import { expect, it } from 'vitest';
import { openMemoryDb } from '../db/connection.js';
import { createTaskGroup } from './groups.js';
import { listTasks } from './tasks.js';

it('creates a split group atomically', () => {
  const db = openMemoryDb();
  const first = { title: 'Study', task_date: '2026-09-25', start_time: '09:00', end_time: '10:00' };
  expect(() => createTaskGroup(db, {
    title: 'Study 2h', total_minutes: 120,
    tasks: [first, { ...first, title: 'Overlap' }],
  })).toThrow();
  expect(db.prepare('SELECT COUNT(*) AS n FROM task_groups').get()).toEqual({ n: 0 });

  const group = createTaskGroup(db, {
    title: 'Study 2h', total_minutes: 120,
    tasks: [first, { ...first, task_date: '2026-09-26' }],
  });
  expect(group.tasks).toHaveLength(2);
  expect(group.tasks.every((task) => task.group_id === group.id)).toBe(true);
  expect(listTasks(db, '2026-09-25', '2026-09-26')).toHaveLength(2);
});
