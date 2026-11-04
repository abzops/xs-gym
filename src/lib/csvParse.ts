// Small RFC 4180 CSV parser: quoted fields, escaped quotes, CRLF or LF.

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

export type ImportRow = {
  line: number; full_name: string; phone: string; email: string; gender: string;
  date_of_birth: string; join_date: string; problems: string[];
};

const HEADERS: Record<string, keyof Omit<ImportRow, 'line' | 'problems'>> = {
  name: 'full_name', 'full name': 'full_name', 'member name': 'full_name',
  phone: 'phone', mobile: 'phone', 'phone number': 'phone', 'mobile number': 'phone', contact: 'phone',
  email: 'email', 'e-mail': 'email', gender: 'gender', sex: 'gender',
  dob: 'date_of_birth', 'date of birth': 'date_of_birth', birthday: 'date_of_birth',
  'join date': 'join_date', joined: 'join_date', 'joining date': 'join_date', 'date joined': 'join_date',
};

/** Accepts 2026-11-05, 05/11/2026 or 5-11-2026 (day first, as written in India). */
export function normaliseDate(value: string): string | null {
  const v = value.trim();
  if (!v) return '';
  let m = v.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  let y: number, mo: number, d: number;
  if (m) { y = +m[1]; mo = +m[2]; d = +m[3]; }
  else if ((m = v.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/))) { d = +m[1]; mo = +m[2]; y = +m[3]; }
  else return null;
  const t = new Date(Date.UTC(y, mo - 1, d));
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== mo - 1 || t.getUTCDate() !== d) return null;
  return t.toISOString().slice(0, 10);
}

export function toImportRows(table: string[][]): { rows: ImportRow[]; missing: string[] } {
  const [head = [], ...body] = table;
  const map = head.map((h) => HEADERS[h.trim().toLowerCase()]);
  const missing = (['full_name', 'phone'] as const).filter((k) => !map.includes(k)).map((k) => (k === 'full_name' ? 'name' : 'phone'));
  const seen = new Map<string, number>();
  const rows = body.map((cells, i) => {
    const r: ImportRow = { line: i + 2, full_name: '', phone: '', email: '', gender: '', date_of_birth: '', join_date: '', problems: [] };
    cells.forEach((value, c) => { const k = map[c]; if (k) r[k] = value.trim(); });
    const digits = r.phone.replace(/\D/g, '').replace(/^(91|0)(?=\d{10}$)/, '');
    if (!r.full_name) r.problems.push('name missing');
    if (digits.length < 10) r.problems.push('phone needs 10 digits');
    else if (seen.has(digits)) r.problems.push(`same phone as line ${seen.get(digits)}`);
    else seen.set(digits, r.line);
    const g = r.gender.toLowerCase();
    r.gender = ['m', 'male'].includes(g) ? 'male' : ['f', 'female'].includes(g) ? 'female' : g ? 'other' : '';
    for (const k of ['date_of_birth', 'join_date'] as const) {
      const n = normaliseDate(r[k]);
      if (n === null) r.problems.push(`${k === 'join_date' ? 'join date' : 'date of birth'} not a date`);
      else r[k] = n;
    }
    if (r.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(r.email)) r.problems.push('email looks wrong');
    return r;
  });
  return { rows, missing };
}
