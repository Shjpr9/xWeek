import { describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatCompletionMessageParam } from 'openai/resources/chat/completions';
import { openDb, openMemoryDb } from '../db/connection.js';
import { addDays, todayInTz } from '../../shared/time.js';
import { createTask, listTasks } from '../services/tasks.js';
import { chat, listMessages } from './chat.js';
import type { AIClient, ModelReply } from './client.js';

function call(name: string, args: object): ModelReply {
  return { content: null, tool_calls: [{
    id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) },
  }] };
}

class FakeClient implements AIClient {
  readonly requests: ChatCompletionMessageParam[][] = [];
  constructor(private readonly replies: Array<ModelReply | Error>) {}
  async complete(messages: ChatCompletionMessageParam[]): Promise<ModelReply> {
    this.requests.push([...messages]);
    const next = this.replies.shift();
    if (!next || next instanceof Error) throw next ?? new Error('No scripted response');
    return next;
  }
}

const answer = (content: string): ModelReply => ({ content });
const today = todayInTz('UTC');
const tomorrow = addDays(today, 1);

describe('chat loop with a scripted model', () => {
  it('works with the WAL database used by the server', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'xweek-chat-'));
    const db = openDb(join(dir, 'test.db'));
    try {
      const result = await chat(db, new FakeClient([answer('Hello!')]), 'Hi');
      expect(result.reply).toBe('Hello!');
      expect(listMessages(db).map(({ role }) => role)).toEqual(['user', 'assistant']);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('creates a daily gym recurrence', async () => {
    const db = openMemoryDb();
    const client = new FakeClient([
      call('add_recurring_task', {
        title: 'Gym', starts_on: tomorrow, start_time: '19:00', end_time: '21:00',
        recurrence_rule: 'FREQ=DAILY',
      }),
      answer('I added your daily gym time.'),
    ]);
    const result = await chat(db, client, 'I go to gym everyday from 19:00 to 21:00');
    expect(result.changes).toHaveLength(84);
    expect(listTasks(db, tomorrow, tomorrow)).toMatchObject([
      { title: 'Gym', start_time: '19:00', end_time: '21:00' },
    ]);
    expect(listMessages(db).map((message) => message.role)).toEqual(['user', 'assistant']);
  });

  it('splits a 20-hour goal over five days after reading free time', async () => {
    const db = openMemoryDb();
    const last = addDays(tomorrow, 4);
    const tasks = Array.from({ length: 5 }, (_, index) => ({
      title: 'Study', task_date: addDays(tomorrow, index), start_time: '09:00', end_time: '13:00',
    }));
    const client = new FakeClient([
      call('get_free_time', { from: tomorrow, to: last }),
      call('add_tasks', { group: { title: 'Study 20h', total_minutes: 1200 }, tasks }),
      answer('I scheduled five four-hour study blocks.'),
    ]);
    const result = await chat(db, client, 'I need to study 20h in 5 days');
    expect(result.changes).toHaveLength(5);
    expect(db.prepare('SELECT total_minutes FROM task_groups').get()).toEqual({ total_minutes: 1200 });
    expect(listTasks(db, tomorrow, last)).toHaveLength(5);
    expect(client.requests[1].at(-1)).toMatchObject({ role: 'tool' });
  });

  it('books a meeting in a free morning slot', async () => {
    const db = openMemoryDb();
    createTask(db, { title: 'Busy', task_date: tomorrow, start_time: '09:00', end_time: '10:00' });
    const client = new FakeClient([
      call('get_free_time', { from: tomorrow, to: tomorrow }),
      call('add_tasks', { tasks: [{
        title: 'Meeting with Josh', task_date: tomorrow, start_time: '10:00', end_time: '11:00',
      }] }),
      answer('Meeting with Josh is at 10:00.'),
    ]);
    const result = await chat(db, client, 'I need to make a meeting with Josh');
    expect(result.changes).toHaveLength(1);
    expect(listTasks(db, tomorrow, tomorrow).map((task) => task.title))
      .toEqual(['Busy', 'Meeting with Josh']);
  });

  it('answers a free-time question without changing tasks', async () => {
    const db = openMemoryDb();
    createTask(db, { title: 'Work', task_date: tomorrow, start_time: '09:00', end_time: '17:00' });
    const client = new FakeClient([
      call('get_free_time', { from: tomorrow, to: tomorrow }),
      answer('You have 8 hours free that day.'),
    ]);
    const result = await chat(db, client, 'How much free time do I have per day?');
    expect(result.changes).toEqual([]);
    expect(client.requests[1].at(-1)).toMatchObject({ role: 'tool' });
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 1 });
  });

  it('answers a part-time job feasibility question from free-time data only', async () => {
    const db = openMemoryDb();
    const client = new FakeClient([
      call('get_free_time', { from: tomorrow, to: addDays(tomorrow, 4) }),
      answer('Yes, five hours a day fits your open time.'),
    ]);
    const result = await chat(db, client, 'Can I afford a part-time job for 5h a day?');
    expect(result.changes).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) AS n FROM tasks').get()).toEqual({ n: 0 });
  });

  it('returns a conflict to the model so it can retry', async () => {
    const db = openMemoryDb();
    createTask(db, { title: 'Busy', task_date: tomorrow, start_time: '10:00', end_time: '11:00' });
    const client = new FakeClient([
      call('add_tasks', { tasks: [{
        title: 'Meeting', task_date: tomorrow, start_time: '10:00', end_time: '11:00',
      }] }),
      call('add_tasks', { tasks: [{
        title: 'Meeting', task_date: tomorrow, start_time: '11:00', end_time: '12:00',
      }] }),
      answer('I scheduled the meeting at 11:00.'),
    ]);
    const result = await chat(db, client, 'Schedule a meeting');
    expect(client.requests[1].at(-1)).toMatchObject({ role: 'tool', content: expect.stringContaining('Overlaps') });
    expect(result.changes).toHaveLength(1);
    expect(listTasks(db, tomorrow, tomorrow)).toHaveLength(2);
  });

  it('returns invalid tool arguments to the model without saving changes', async () => {
    const db = openMemoryDb();
    const client = new FakeClient([
      call('get_free_time', { from: '2026-02-30', to: '2026-03-01' }),
      answer('Please give me a valid date.'),
    ]);
    const result = await chat(db, client, 'How much time do I have on February 30?');
    expect(client.requests[1].at(-1)).toMatchObject({
      role: 'tool', content: expect.stringContaining('real calendar day'),
    });
    expect(result.changes).toEqual([]);
  });

  it('writes nothing if the provider fails after a staged change', async () => {
    const db = openMemoryDb();
    const client = new FakeClient([
      call('add_tasks', { tasks: [{
        title: 'Meeting', task_date: tomorrow, start_time: '11:00', end_time: '12:00',
      }] }),
      new Error('provider timeout'),
    ]);
    await expect(chat(db, client, 'Schedule a meeting')).rejects.toMatchObject({ name: 'ProviderError' });
    expect(listMessages(db)).toEqual([]);
    expect(listTasks(db, tomorrow, tomorrow)).toEqual([]);
  });
});
