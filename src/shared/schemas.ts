import { z } from 'zod';
import { addDays } from './time.js';

export const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD')
  .refine((date) => {
    try { addDays(date, 0); return true; } catch { return false; }
  }, 'date must be a real calendar day');
export const timeSchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (00:00-23:59)');

export const taskStatusSchema = z.enum(['planned', 'done', 'cancelled']);
export type TaskStatus = z.infer<typeof taskStatusSchema>;

export interface Task {
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

export interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface ChatChange {
  task_id: number;
  action: 'create' | 'update' | 'delete';
  before: Task | null;
  after: Task | null;
}

const taskInputObject = z.object({
  group_id: z.number().int().positive().nullish(),
  title: z.string().min(1).max(200),
  notes: z.string().max(5000).nullish(),
  task_date: dateSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  status: taskStatusSchema.default('planned'),
});

export const taskInputSchema = taskInputObject.refine((t) => t.end_time > t.start_time, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});
export type TaskInput = z.infer<typeof taskInputSchema>;

// Partial patch; end > start is validated against the merged row in the service.
export const taskUpdateSchema = taskInputObject.partial();
export type TaskUpdate = z.infer<typeof taskUpdateSchema>;

export const taskGroupInputSchema = z.object({
  title: z.string().min(1).max(200),
  total_minutes: z.number().int().positive().optional(),
  tasks: z.array(taskInputObject.omit({ group_id: true })).min(1),
});
export type TaskGroupInput = z.infer<typeof taskGroupInputSchema>;

export const recurringTaskInputSchema = z.object({
  title: z.string().min(1).max(200),
  notes: z.string().max(5000).nullish(),
  starts_on: dateSchema,
  start_time: timeSchema,
  end_time: timeSchema,
  recurrence_rule: z.string().min(1),
}).refine((task) => task.end_time > task.start_time, {
  message: 'end_time must be after start_time',
  path: ['end_time'],
});
export type RecurringTaskInput = z.infer<typeof recurringTaskInputSchema>;

const settingsObject = z.object({
  timezone: z.string().min(1).max(64),
  week_starts_on: z.union([z.literal(0), z.literal(1)]),
  day_start: timeSchema,
  day_end: timeSchema,
});

export const settingsSchema = settingsObject.refine((s) => s.day_end > s.day_start, {
  message: 'day_end must be after day_start',
  path: ['day_end'],
});
export type Settings = z.infer<typeof settingsSchema>;

// Partial patch; day_end > day_start is validated against the merged row in the service.
export const settingsPatchSchema = settingsObject.partial();
export type SettingsPatch = z.infer<typeof settingsPatchSchema>;

export const taskQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
}).refine((range) => range.to >= range.from, {
  message: 'to must be on or after from', path: ['to'],
});

export const chatInputSchema = z.object({ message: z.string().trim().min(1).max(10000) });

export const addTasksToolSchema = z.object({
  tasks: taskGroupInputSchema.shape.tasks,
  group: taskGroupInputSchema.pick({ title: true, total_minutes: true }).optional(),
});
export const updateTaskToolSchema = z.object({
  id: z.number().int().positive(),
  patch: taskUpdateSchema,
});
export const deleteTasksToolSchema = z.object({
  ids: z.array(z.number().int().positive()).min(1),
});
export const deleteGroupToolSchema = z.object({ id: z.number().int().positive() });
