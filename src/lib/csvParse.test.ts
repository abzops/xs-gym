import { describe, expect, it } from 'vitest';
import { normaliseDate, parseCSV, phoneKey, toImportRows } from './csvParse';

describe('parseCSV', () => {
  it('handles quotes, commas, CRLF and blank lines', () => {
    expect(parseCSV('name,phone\r\n"Nair, Priya",98765\r\n\r\n"Say ""hi""",1\n')).toEqual([
      ['name', 'phone'], ['Nair, Priya', '98765'], ['Say "hi"', '1'],
    ]);
  });
});

describe('normaliseDate', () => {
  it.each([['2026-11-05', '2026-11-05'], ['05/11/2026', '2026-11-05'], ['5-1-2026', '2026-01-05'], ['', '']])('%s', (a, b) => {
    expect(normaliseDate(a)).toBe(b);
  });
  it.each(['31/02/2026', '2026/11/05', 'tomorrow'])('rejects %s', (a) => expect(normaliseDate(a)).toBeNull());
});

describe('toImportRows', () => {
  it('maps headers and flags problems per line', () => {
    const { rows, missing } = toImportRows(parseCSV(
      'Name,Mobile,Gender,Joined\nRahul,+91 98765 43210,M,01/10/2026\nAnjali,98765 43210,f,\n,123,,\nArjun,9876500000,,32/1/2026'));
    expect(missing).toEqual([]);
    expect(rows[0]).toMatchObject({ full_name: 'Rahul', gender: 'male', join_date: '2026-10-01', problems: [] });
    expect(rows[1].problems).toEqual(['same phone as line 2']);
    expect(rows[2].problems).toEqual(['name missing', 'phone must be a valid 10-digit Indian number']);
    expect(rows[3].problems).toEqual(['join date not a date']);
  });
  it('reports missing required columns', () => {
    expect(toImportRows([['email']]).missing).toEqual(['name', 'phone']);
  });
});

describe('Indian phone validation and duplicate key', () => {
  it.each([
    ['9847000031', '9847000031'],
    ['+91 9847000031', '9847000031'],
    ['09847000031', '9847000031'],
    ['(9847) 000-031', '9847000031'],
    ['+1 9847000031', null],
    ['9198470000311', null],
    ['12345', null],
    ['98470000311', null],
    ['x9847000031', null],
  ])('%s canonicalizes to %s', (value, expected) => {
    expect(phoneKey(value)).toBe(expected);
  });
  it('rejects duplicates in two different international/India notation formats', () => {
    const rows = toImportRows(parseCSV('name,phone\nFirst,+91 9847000031\nSecond,09847000031\n')).rows;
    expect(rows[0].problems).toEqual([]);
    expect(rows[1].problems).toContain('same phone as line 2');
  });
  it('blocks an unterminated quoted CSV row', () => {
    expect(() => parseCSV('name,phone\n"First,9847000031')).toThrow('unclosed quoted field');
  });
});
