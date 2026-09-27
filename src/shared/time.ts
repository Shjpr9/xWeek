// Date/time helpers for the YYYY-MM-DD / HH:MM string formats.
// Never use JS Date for arithmetic on these: dates are the user's local time,
// so we do pure calendar math on UTC-midnight Dates (immune to DST) and read
// "now" through Intl in the user's timezone.

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

function parseDate(date: string): { y: number; m: number; d: number } {
  const match = DATE_RE.exec(date);
  if (!match) throw new Error(`Invalid date: ${date}`);
  const y = Number(match[1]);
  const m = Number(match[2]);
  const d = Number(match[3]);
  // Reject impossible dates like 2026-02-30 (Date.UTC would silently roll over).
  const check = new Date(Date.UTC(y, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) {
    throw new Error(`Invalid date: ${date}`);
  }
  return { y, m, d };
}

function formatDate(t: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** 'HH:MM' -> minutes since midnight. */
export function toMinutes(time: string): number {
  const match = TIME_RE.exec(time);
  if (!match) throw new Error(`Invalid time: ${time}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** Minutes since midnight -> 'HH:MM'. */
export function fromMinutes(minutes: number): string {
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 1439) {
    throw new Error(`Minutes out of range: ${minutes}`);
  }
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' + n days -> 'YYYY-MM-DD' (pure UTC math, DST cannot shift a day). */
export function addDays(date: string, days: number): string {
  const { y, m, d } = parseDate(date);
  return formatDate(new Date(Date.UTC(y, m - 1, d + days)));
}

/** The {start, end} (inclusive) of the week containing `date`. */
export function weekRange(date: string, weekStartsOn: 0 | 1 | 6): { start: string; end: string } {
  const { y, m, d } = parseDate(date);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const diff = (weekday - weekStartsOn + 7) % 7;
  const start = addDays(date, -diff);
  return { start, end: addDays(start, 6) };
}

/** Current date in the given IANA timezone as 'YYYY-MM-DD'. */
export function todayInTz(timezone: string): string {
  return nowInTz(timezone).date;
}

/** Current local date/time in the timezone, as {date, time, minutes}. */
export function nowInTz(timezone: string): { date: string; time: string; minutes: number } {
  // en-GB gives zero-padded 24h parts; formatToParts avoids locale-string parsing.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  // Some ICU versions emit hour '24' at midnight; normalize.
  const hour = get('hour') === '24' ? '00' : get('hour');
  const time = `${hour}:${get('minute')}`;
  return { date: `${get('year')}-${get('month')}-${get('day')}`, time, minutes: toMinutes(time) };
}
