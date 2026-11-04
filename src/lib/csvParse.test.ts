import { describe, expect, it } from 'vitest';
import { normaliseDate, parseCSV, toImportRows } from './csvParse';

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
    expect(rows[2].problems).toEqual(['name missing', 'phone needs 10 digits']);
    expect(rows[3].problems).toEqual(['join date not a date']);
  });
  it('reports missing required columns', () => {
    expect(toImportRows([['email']]).missing).toEqual(['name', 'phone']);
  });
});
