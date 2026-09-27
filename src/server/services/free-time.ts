import type { Db } from '../db/connection.js';
import { addDays, fromMinutes, toMinutes } from '../../shared/time.js';
import { listTasks } from './tasks.js';
import { getSettings } from './settings.js';

export interface FreeWindow {
  start: string; // 'HH:MM'
  end: string;
}

export interface FreeDay {
  date: string;
  free_minutes: number;
  windows: FreeWindow[];
}

/**
 * Free time per day in [from, to]: clamp non-cancelled tasks to the waking
 * window, merge overlaps, subtract from day_start..day_end. TypeScript, not SQL.
 */
export function freeTime(db: Db, from: string, to: string): FreeDay[] {
  const settings = getSettings(db);
  const wakeStart = toMinutes(settings.day_start);
  const wakeEnd = toMinutes(settings.day_end);

  const days: FreeDay[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    // Clamp each task into the waking window; drop what falls outside it.
    const busy = listTasks(db, date, date)
      .map(
        (t) =>
          [
            Math.max(toMinutes(t.start_time), wakeStart),
            Math.min(toMinutes(t.end_time), wakeEnd),
          ] as const,
      )
      .filter(([s, e]) => s < e)
      .sort((a, b) => a[0] - b[0]);

    const windows: FreeWindow[] = [];
    let cursor = wakeStart;
    for (const [s, e] of busy) {
      if (e <= cursor) continue; // fully seen already
      if (s > cursor) {
        windows.push({ start: fromMinutes(cursor), end: fromMinutes(s) });
      }
      cursor = Math.max(cursor, e);
    }
    if (cursor < wakeEnd) {
      windows.push({ start: fromMinutes(cursor), end: fromMinutes(wakeEnd) });
    }

    days.push({
      date,
      free_minutes: windows.reduce(
        (sum, w) => sum + toMinutes(w.end) - toMinutes(w.start),
        0,
      ),
      windows,
    });
  }
  return days;
}
