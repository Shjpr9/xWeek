import type { Db } from '../db/connection.js';

export interface TaskRow {
  id: number;
  group_id: number | null;
  title: string;
  notes: string | null;
  task_date: string;
  start_time: string;
  end_time: string;
  status: 'planned' | 'done' | 'cancelled';
  created_by: 'user' | 'ai';
  created_at: string;
  updated_at: string;
}

export interface ChangeLogEntry {
  task_id: number;
  action: 'create' | 'update' | 'delete';
  before: TaskRow | null;
  after: TaskRow | null;
}

/** Call inside the same transaction as an AI-made change. No-op for user/REST changes. */
export function logChanges(
  db: Db,
  messageId: number | null,
  entries: ChangeLogEntry[],
): void {
  if (entries.length === 0) return;
  const insert = db.prepare(
    `INSERT INTO task_changes (message_id, task_id, action, before_json, after_json)
     VALUES (?, ?, ?, ?, ?)`,
  );
  for (const e of entries) {
    insert.run(
      messageId,
      e.task_id,
      e.action,
      e.before ? JSON.stringify(e.before) : null,
      e.after ? JSON.stringify(e.after) : null,
    );
  }
}
