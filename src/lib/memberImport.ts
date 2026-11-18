import { phoneKey, type ImportRow } from './csvParse';

export type ExistingMember = {
  id: string;
  phone: string;
  member_no: string;
  status: string;
};

/**
 * Pure, non-mutating preview reconciliation. Never creates, modifies,
 * archives or deletes a member. An archived phone is a conflict too:
 * an operator must resolve it manually before using the live write command.
 */
export function reconcileMemberImport(source: ImportRow[], existing: ExistingMember[]): ImportRow[] {
  const byPhone = new Map<string, ExistingMember[]>();
  for (const member of existing) {
    const key = phoneKey(member.phone);
    if (!key) continue; // import never treats malformed stored phone as a match
    const found = byPhone.get(key) ?? [];
    found.push(member);
    byPhone.set(key, found);
  }

  return source.map((sourceRow) => {
    const row: ImportRow = { ...sourceRow, problems: [...sourceRow.problems] };
    const key = phoneKey(row.phone);
    if (!key) return row; // prior validation already reports invalid phone
    const matches = byPhone.get(key) ?? [];
    if (matches.length) {
      const detail = matches
        .map((m) => `${m.member_no} (${m.status === 'archived' ? 'archived' : 'existing'})`)
        .join(', ');
      row.problems.push(`phone already belongs to member ${detail}; review manually`);
    }
    return row;
  });
}

/** Detect a changed preview before any import RPC is sent. */
export function sameImportPreview(a: ImportRow[], b: ImportRow[]): boolean {
  return JSON.stringify(a.map((r) => ({ ...r, problems: [...r.problems].sort() }))) ===
    JSON.stringify(b.map((r) => ({ ...r, problems: [...r.problems].sort() })));
}
