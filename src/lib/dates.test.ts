import { describe, expect, it } from 'vitest';
import { addDays, daysBetween, formatDate, membershipEndDate } from './dates';

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

describe('membershipEndDate matches the database rule', () => {
  it.each([
    ['2027-01-15', 'month', 1, '2027-02-14'], ['2027-01-29', 'month', 1, '2027-02-28'], ['2027-01-31', 'month', 1, '2027-02-28'],
    ['2028-01-31', 'month', 1, '2028-02-29'], ['2027-03-01', 'month', 1, '2027-03-31'], ['2027-03-31', 'month', 1, '2027-04-30'],
    ['2027-08-31', 'month', 3, '2027-11-30'], ['2026-12-31', 'month', 2, '2027-02-28'], ['2027-01-01', 'month', 12, '2027-12-31'],
    ['2028-02-29', 'month', 12, '2029-02-28'], ['2026-11-05', 'day', 15, '2026-11-19'], ['2026-11-02', 'month', 1, '2026-12-01'],
  ] as const)('%s + %s %s → %s', (s, u, n, e) => expect(membershipEndDate(s, u, n)).toBe(e));
});
