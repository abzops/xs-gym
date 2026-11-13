import { describe, expect, it } from 'vitest';
import { parseCSV, toImportRows } from './csvParse';
import { reconcileMemberImport, sameImportPreview } from './memberImport';

const source = () => toImportRows(parseCSV(
  'name,phone,join date\nNew Member,9847000031,01/11/2026\nArchived Profile,+91 9847000032,02/11/2026\nAlready Active,09847000033,03/11/2026\n'
)).rows;

describe('member-import dry-run reconciliation (synthetic only)', () => {
  it('flags archived and active existing phones without changing source records', () => {
    const raw = source();
    const snapshot = JSON.stringify(raw);
    const out = reconcileMemberImport(raw, [
      { id: 'archived-test', phone: '9847000032', member_no: 'TEST-0002', status: 'archived' },
      { id: 'active-test', phone: '+919847000033', member_no: 'TEST-0003', status: 'active' },
    ]);
    expect(JSON.stringify(raw)).toBe(snapshot);
    expect(out[0].problems).toEqual([]);
    expect(out[1].problems.join(' ')).toContain('archived');
    expect(out[1].problems.join(' ')).toContain('TEST-0002');
    expect(out[2].problems.join(' ')).toContain('existing');
    expect(out[2].problems.join(' ')).toContain('TEST-0003');
  });

  it('flags a newly created concurrent member when preview is rechecked', () => {
    const initial = reconcileMemberImport(source(), []);
    const changed = reconcileMemberImport(source(), [
      { id: 'race-test', phone: '9847000031', member_no: 'TEST-0001', status: 'active' },
    ]);
    expect(sameImportPreview(initial, changed)).toBe(false);
    expect(sameImportPreview(initial, reconcileMemberImport(source(), []))).toBe(true);
  });

  it('never clears invalid input errors while checking for existing members', () => {
    const invalid = toImportRows(parseCSV('name,phone\nMissing Number,12345\n')).rows;
    expect(reconcileMemberImport(invalid, [])[0].problems).toContain('phone must be a valid 10-digit Indian number');
  });

  it('rejects malformed existing-phone formats rather than assuming a match', () => {
    const out = reconcileMemberImport(source(), [{ id: 'junk', phone: '999', member_no: 'TEST-X', status: 'active' }]);
    expect(out.every((row) => row.problems.length === 0)).toBe(true);
  });
});
