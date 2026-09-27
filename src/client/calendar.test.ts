import { expect, it } from 'vitest';
import { monthRange, shiftMonth, shiftCalendarMonth, daysInRange, dateLabel } from './calendar.js';

it('navigates month boundaries and aligns month grids to the selected week start', () => {
  expect(shiftMonth('2026-12-15', 1)).toBe('2027-01-01');
  expect(shiftMonth('2027-01-15', -1)).toBe('2026-12-01');
  expect(monthRange('2026-09-15', 1)).toEqual({ start: '2026-08-31', end: '2026-10-04' });
  expect(monthRange('2026-09-15', 0)).toEqual({ start: '2026-08-30', end: '2026-10-03' });
  expect(daysInRange('2026-09-29', '2026-10-02')).toEqual([
    '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02',
  ]);
});

it('uses Doran for Persian month boundaries and labels while keeping Gregorian API dates', () => {
  expect(monthRange('2026-03-21', 6, 'persian')).toEqual({ start: '2026-03-21', end: '2026-04-24' });
  expect(shiftCalendarMonth('2026-03-21', 1, 'persian')).toBe('2026-04-21');
  expect(dateLabel('2026-03-21', 'persian', 'month')).toContain('فروردین');
});
