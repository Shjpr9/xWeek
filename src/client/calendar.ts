import { addDays, weekRange } from '../shared/time.js';
import { DoranDate } from '@doranjs/core';

export type CalendarMode = 'persian' | 'gregorian';

function doran(date: string): DoranDate {
  return DoranDate.fromGregorianParts({
    year: Number(date.slice(0, 4)), month: Number(date.slice(5, 7)), day: Number(date.slice(8, 10)),
  }, { timeZone: 'UTC' });
}

function iso(date: DoranDate): string {
  const { year, month, day } = date.toGregorianParts();
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function shiftMonth(date: string, amount: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const index = year * 12 + month - 1 + amount;
  return `${Math.floor(index / 12)}-${String(((index % 12) + 12) % 12 + 1).padStart(2, '0')}-01`;
}

export function monthRange(date: string, weekStartsOn: 0 | 1 | 6, mode: CalendarMode = 'gregorian'): { start: string; end: string } {
  if (mode === 'persian') {
    const first = doran(date).with({ day: 1 });
    const last = first.addMonths(1).addDays(-1);
    return { start: weekRange(iso(first), weekStartsOn).start, end: weekRange(iso(last), weekStartsOn).end };
  }
  const first = `${date.slice(0, 7)}-01`;
  const last = addDays(shiftMonth(first, 1), -1);
  return { start: weekRange(first, weekStartsOn).start, end: weekRange(last, weekStartsOn).end };
}

export function shiftCalendarMonth(date: string, amount: number, mode: CalendarMode): string {
  return mode === 'persian' ? iso(doran(date).with({ day: 1 }).addMonths(amount)) : shiftMonth(date, amount);
}

export function daysInRange(start: string, end: string): string[] {
  const days: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) days.push(date);
  return days;
}

export function dateLabel(date: string, mode: CalendarMode, kind: 'month' | 'day' | 'weekday' | 'full'): string {
  if (mode === 'persian') {
    const pattern = { month: 'MMMM YYYY', day: 'D', weekday: 'ddd', full: 'dddd D MMMM YYYY' }[kind];
    return doran(date).format(pattern);
  }
  const options: Record<typeof kind, Intl.DateTimeFormatOptions> = {
    month: { month: 'long', year: 'numeric' }, day: { day: 'numeric' },
    weekday: { weekday: 'short' }, full: { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' },
  };
  return new Intl.DateTimeFormat(undefined, { timeZone: 'UTC', ...options[kind] })
    .format(new Date(`${date}T12:00:00Z`));
}
