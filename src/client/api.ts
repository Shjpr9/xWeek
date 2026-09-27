import type { ChatChange, ChatMessage, Settings, Task, TaskInput, TaskUpdate } from '../shared/schemas.js';

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly conflicts: string[] = []) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: init?.body ? { 'Content-Type': 'application/json' } : undefined,
  });
  if (response.status === 204) return undefined as T;
  const data: unknown = await response.json().catch(() => {
    throw new ApiError('The server is unavailable. Please try again.', response.status);
  });
  if (!response.ok) {
    const body = data as { error?: string; conflicts?: string[] };
    throw new ApiError(body.error ?? `Request failed (${response.status})`, response.status, body.conflicts);
  }
  return data as T;
}

export const api = {
  settings: () => request<Settings>('/settings'),
  tasks: (from: string, to: string) => request<Task[]>(`/tasks?from=${from}&to=${to}`),
  messages: () => request<ChatMessage[]>('/chat/messages'),
  chat: (message: string) => request<{ reply: string; changes: ChatChange[] }>('/chat', {
    method: 'POST', body: JSON.stringify({ message }),
  }),
  createTask: (task: TaskInput, allowOverlap = false) => request<Task>('/tasks', {
    method: 'POST', body: JSON.stringify({ ...task, allowOverlap }),
  }),
  updateTask: (id: number, patch: TaskUpdate, allowOverlap = false) => request<Task>(`/tasks/${id}`, {
    method: 'PATCH', body: JSON.stringify({ ...patch, allowOverlap }),
  }),
  deleteTask: (id: number) => request<void>(`/tasks/${id}`, { method: 'DELETE' }),
};
