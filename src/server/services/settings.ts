import type { Db } from '../db/connection.js';
import { settingsPatchSchema, type Settings } from '../../shared/schemas.js';
import { ValidationError, zodToMessage } from './errors.js';

export interface SettingsRow {
  id: number;
  timezone: string;
  week_starts_on: 0 | 1;
  day_start: string;
  day_end: string;
}

export function getSettings(db: Db): SettingsRow {
  return db.prepare('SELECT * FROM settings WHERE id = 1').get() as SettingsRow;
}

export function updateSettings(db: Db, patch: unknown): SettingsRow {
  const result = settingsPatchSchema.safeParse(patch);
  if (!result.success) {
    throw new ValidationError(zodToMessage(result.error));
  }
  const p = result.data;
  // Whitelist: keys come from the zod schema only, so this is fixed SQL.
  const COLUMNS = ['timezone', 'week_starts_on', 'day_start', 'day_end'] as const;
  const sets = COLUMNS.filter((k) => p[k] !== undefined);
  if (sets.length === 0) return getSettings(db);

  // Validate against the merged row so day_end > day_start holds for halves.
  const current = getSettings(db);
  const merged: Settings = {
    timezone: p.timezone ?? current.timezone,
    week_starts_on: p.week_starts_on ?? current.week_starts_on,
    day_start: p.day_start ?? current.day_start,
    day_end: p.day_end ?? current.day_end,
  };
  if (merged.day_end <= merged.day_start) {
    throw new ValidationError('day_end must be after day_start');
  }
  // Extra safety: reject timezones Intl doesn't know.
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: merged.timezone });
  } catch {
    throw new ValidationError(`Unknown timezone: ${merged.timezone}`);
  }

  const stmt = db.prepare(
    `UPDATE settings SET ${sets.map((k) => `${k} = ?`).join(', ')} WHERE id = 1`,
  );
  stmt.run(...sets.map((k) => merged[k]));
  return getSettings(db);
}
