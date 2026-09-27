import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createApp } from './app.js';
import { openMemoryDb, type Db } from './db/connection.js';
import { createRecurringTask } from './services/recurrence.js';
import { addDays, todayInTz } from '../shared/time.js';
import type { AIClient } from './ai/client.js';

let db: Db;
let server: Server;
let base: string;

beforeAll(async () => {
  db = openMemoryDb();
  server = createApp(db).listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  base = `http://127.0.0.1:${port}`;
});

afterAll(() => {
  server.close();
  db.close();
});

interface Task {
  id: number;
  title: string;
  task_date: string;
  start_time: string;
  end_time: string;
  status: string;
}

interface ConflictBody extends Partial<Task> {
  error: string;
  conflicts: string[];
}

async function createTask(body: object, expected = 201): Promise<Task> {
  const res = await fetch(`${base}/api/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(expected);
  return (await res.json()) as Task;
}

const MONDAY = { task_date: '2026-09-21', start_time: '10:00', end_time: '11:00' };

describe('hello', () => {
  it('greets', async () => {
    const res = await fetch(`${base}/api/hello`);
    expect(res.status).toBe(200);
  });
});

describe('tasks routes', () => {
  it('creates, lists, updates and deletes a task', async () => {
    const task = await createTask({ ...MONDAY, title: 'Study' });
    expect(task.title).toBe('Study');
    expect(task.status).toBe('planned');

    const list = (await (await fetch(`${base}/api/tasks?from=2026-09-21&to=2026-09-27`)).json()) as Task[];
    expect(list.map((t) => t.id)).toContain(task.id);

    const patchRes = await fetch(`${base}/api/tasks/${task.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Deep work' }),
    });
    expect(patchRes.status).toBe(200);
    expect(((await patchRes.json()) as Task).title).toBe('Deep work');

    const delRes = await fetch(`${base}/api/tasks/${task.id}`, { method: 'DELETE' });
    expect(delRes.status).toBe(204);
    const after = await fetch(`${base}/api/tasks/${task.id}`);
    expect(after.status).toBe(404);
  });

  it('validates input: 400 with message', async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...MONDAY, title: '' }),
    });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toMatch(/title/);
  });

  it('rejects overlap: 409 with conflict list, allowOverlap bypasses', async () => {
    await createTask({ ...MONDAY, title: 'A' });
    const conflict = (await createTask({ ...MONDAY, title: 'B' }, 409)) as unknown as ConflictBody;
    expect(conflict.conflicts[0]).toContain('A');

    const ok = await createTask(
      { ...MONDAY, title: 'B', allowOverlap: true },
    );
    expect(ok.title).toBe('B');
  });

  it('404 for unknown task and 400 for bad query params', async () => {
    expect((await fetch(`${base}/api/tasks/9999`)).status).toBe(404);
    expect(
      (await fetch(`${base}/api/tasks?from=nope&to=2026-09-21`)).status,
    ).toBe(400);
  });
});

describe('groups routes', () => {
  it('extends recurring tasks through a requested date', async () => {
    const start = todayInTz('UTC');
    const future = addDays(start, 84);
    createRecurringTask(db, {
      title: 'Walk', starts_on: start, start_time: '06:00', end_time: '06:30',
      recurrence_rule: 'FREQ=DAILY',
    });
    const res = await fetch(`${base}/api/tasks?from=${future}&to=${future}`);
    expect(res.status).toBe(200);
    expect((await res.json()) as Task[]).toMatchObject([
      { title: 'Walk', task_date: future },
    ]);
  });

  it('deletes a group and its tasks', async () => {
    const g = db
      .prepare("INSERT INTO task_groups (title, total_minutes) VALUES ('Study 20h', 1200)")
      .run();
    const gid = Number(g.lastInsertRowid);
    const t = await createTask({
      title: 'block',
      task_date: '2026-10-05',
      start_time: '10:00',
      end_time: '11:00',
      group_id: gid,
    });

    const res = await fetch(`${base}/api/groups/${gid}`, { method: 'DELETE' });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { deleted: number }).deleted).toBe(1);
    expect((await fetch(`${base}/api/tasks/${t.id}`)).status).toBe(404);
  });

  it('404 for unknown group', async () => {
    expect((await fetch(`${base}/api/groups/999`, { method: 'DELETE' })).status).toBe(404);
  });
});

describe('settings routes', () => {
  it('gets defaults and patches', async () => {
    const before = (await (await fetch(`${base}/api/settings`)).json()) as Record<string, unknown>;
    expect(before.day_start).toBe('07:00');

    const res = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timezone: 'Asia/Tehran' }),
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { timezone: string }).timezone).toBe('Asia/Tehran');
  });

  it('400 on invalid patch', async () => {
    const res = await fetch(`${base}/api/settings`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ day_start: '99:99' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('free-time route', () => {
  it('subtracts tasks from waking hours', async () => {
    // Fresh window: 2026-09-28 (Mon) to 2026-09-28.
    const day = await createTask({
      title: 'Gym',
      task_date: '2026-09-28',
      start_time: '10:00',
      end_time: '12:00',
    });
    void day;

    const res = await fetch(`${base}/api/free-time?from=2026-09-28&to=2026-09-28`);
    expect(res.status).toBe(200);
    const days = (await res.json()) as Array<{ date: string; free_minutes: number; windows: Array<{ start: string; end: string }> }>;
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe('2026-09-28');
    // 07:00-23:00 waking = 960min minus 120min gym = 840.
    expect(days[0].free_minutes).toBe(840);
    expect(days[0].windows).toEqual([
      { start: '07:00', end: '10:00' },
      { start: '12:00', end: '23:00' },
    ]);
  });

  it('clamps tasks outside waking hours and merges overlaps', async () => {
    // Task ending before waking hours (05:00-06:00) is clamped away entirely;
    // overlapping pair 13:00-15:30 over 14:00-15:00 counts once.
    await createTask({ title: 'early', task_date: '2026-09-29', start_time: '05:00', end_time: '06:00' });
    await createTask({ title: 'a', task_date: '2026-09-29', start_time: '13:00', end_time: '15:30' });
    await createTask({ title: 'b', task_date: '2026-09-29', start_time: '14:00', end_time: '15:00', allowOverlap: true });

    const res = await fetch(`${base}/api/free-time?from=2026-09-29&to=2026-09-29`);
    const days = (await res.json()) as Array<{ free_minutes: number }>;
    expect(days[0].free_minutes).toBe(960 - 150); // only the merged 2.5h counts
  });

  it('400 on missing params', async () => {
    expect((await fetch(`${base}/api/free-time?from=2026-09-28`)).status).toBe(400);
  });
});

describe('error middleware', () => {
  it('handles malformed JSON body with 400', async () => {
    const res = await fetch(`${base}/api/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    });
    expect(res.status).toBe(400);
  });
});

describe('chat routes', () => {
  it('validates input and returns 502 when AI is not configured', async () => {
    const invalid = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '' }),
    });
    expect(invalid.status).toBe(400);
    const unavailable = await fetch(`${base}/api/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hi' }),
    });
    expect(unavailable.status).toBe(502);
  });

  it('saves a successful reply and exposes message history', async () => {
    const isolated = openMemoryDb();
    const client: AIClient = { async complete() { return { content: 'Hello!' }; } };
    const localServer = createApp(isolated, client).listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => localServer.once('listening', resolve));
    const url = `http://127.0.0.1:${(localServer.address() as AddressInfo).port}`;
    try {
      const response = await fetch(`${url}/api/chat`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hi' }),
      });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ reply: 'Hello!', changes: [] });
      const history = await fetch(`${url}/api/chat/messages`);
      expect((await history.json()) as Array<{ role: string; content: string }>).toMatchObject([
        { role: 'user', content: 'Hi' }, { role: 'assistant', content: 'Hello!' },
      ]);
    } finally {
      localServer.close();
      isolated.close();
    }
  });
});
