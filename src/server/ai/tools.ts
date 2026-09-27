import { z } from 'zod';
import type { ChatCompletionTool } from 'openai/resources/chat/completions';
import type { Db } from '../db/connection.js';
import {
  addTasksToolSchema, deleteGroupToolSchema, deleteTasksToolSchema,
  recurringTaskInputSchema, taskQuerySchema, updateTaskToolSchema,
} from '../../shared/schemas.js';
import { createTaskGroup } from '../services/groups.js';
import { createRecurringTask } from '../services/recurrence.js';
import { freeTime } from '../services/free-time.js';
import { createTask, deleteGroup, deleteTask, listTasks, updateTask } from '../services/tasks.js';

function parameters(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { target: 'draft-7' });
  delete json.$schema;
  return json;
}

const specs = [
  ['get_tasks', 'Read scheduled tasks in an inclusive date range.', taskQuerySchema],
  ['get_free_time', 'Read free minutes and windows per day in an inclusive date range.', taskQuerySchema],
  ['add_tasks', 'Create one or more tasks. Use group for a split goal with total_minutes.', addTasksToolSchema],
  ['add_recurring_task', 'Create a recurring task from an RRULE such as FREQ=DAILY.', recurringTaskInputSchema],
  ['update_task', 'Change one task occurrence.', updateTaskToolSchema],
  ['delete_tasks', 'Delete one or more task occurrences.', deleteTasksToolSchema],
  ['delete_group', 'Delete a whole task group and its tasks.', deleteGroupToolSchema],
] as const;

export const toolDefinitions: ChatCompletionTool[] = specs.map(([name, description, schema]) => ({
  type: 'function',
  function: { name, description, parameters: parameters(schema) },
}));

export function runTool(db: Db, name: string, raw: unknown, messageId: number): unknown {
  const options = { createdBy: 'ai' as const, messageId };
  switch (name) {
    case 'get_tasks': {
      const { from, to } = taskQuerySchema.parse(raw);
      return listTasks(db, from, to);
    }
    case 'get_free_time': {
      const { from, to } = taskQuerySchema.parse(raw);
      return freeTime(db, from, to);
    }
    case 'add_tasks': {
      const { tasks, group } = addTasksToolSchema.parse(raw);
      if (group) return createTaskGroup(db, { ...group, tasks }, options);
      return db.transaction(() => tasks.map((task) => createTask(db, task, options)))();
    }
    case 'add_recurring_task':
      return createRecurringTask(db, recurringTaskInputSchema.parse(raw), options);
    case 'update_task': {
      const { id, patch } = updateTaskToolSchema.parse(raw);
      return updateTask(db, id, patch, options);
    }
    case 'delete_tasks': {
      const { ids } = deleteTasksToolSchema.parse(raw);
      db.transaction(() => ids.forEach((id) => deleteTask(db, id, options)))();
      return { deleted: ids.length };
    }
    case 'delete_group': {
      const { id } = deleteGroupToolSchema.parse(raw);
      return { deleted: deleteGroup(db, id, options) };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
