import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDate } from './dates';

describe('dates', () => {
  it('formats a business date without timezone shifts', () => {
    expect(formatDate('2027-02-14')).toBe('14 Feb 2027');
    expect(formatDate('2028-02-29')).toBe('29 Feb 2028');
    expect(formatDate(null)).toBe('—');
  });

  it('adds days across month and leap-year boundaries', () => {
    expect(addDays('2027-01-31', 1)).toBe('2027-02-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-11-05', -5)).toBe('2026-10-31');
  });

  it('counts days between dates', () => {
    expect(daysBetween('2026-11-05', '2026-11-12')).toBe(7);
    expect(daysBetween('2026-11-05', '2026-11-05')).toBe(0);
    expect(daysBetween('2026-11-05', '2026-11-01')).toBe(-4);
  });
});
