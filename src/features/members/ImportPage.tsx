import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Upload } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { BackLink, Notice } from '../../components/ui';
import { downloadCSV } from '../../lib/csv';
import { parseCSV, toImportRows, type ImportRow } from '../../lib/csvParse';
import { errorMessage } from '../../lib/errors';
import { rpc, supabase } from '../../lib/supabase';

type Result = { line: number; name: string; ok: boolean; message: string };

/** Import members from a spreadsheet: preview → confirm → per-row result. */
export function ImportPage() {
  const { gym } = useGym();
  const qc = useQueryClient();
  const [rows, setRows] = useState<ImportRow[] | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [fileName, setFileName] = useState('');
  const [results, setResults] = useState<Result[] | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const good = rows?.filter((r) => r.problems.length === 0) ?? [];
  const bad = rows?.filter((r) => r.problems.length > 0) ?? [];

  async function onFile(file: File) {
    setResults(null);
    setFileName(file.name);
    if (file.size > 2_000_000) { setRows([]); setMissing(['file is larger than 2 MB']); return; }
    const parsed = toImportRows(parseCSV(await file.text()));
    // Flag numbers that already belong to a member, so the preview matches the result.
    const { data: existing } = await supabase.from('members').select('phone, member_no').eq('gym_id', gym.id).limit(20000);
    const taken = new Map((existing ?? []).map((m) => [String(m.phone).replace(/\D/g, '').slice(-10), m.member_no as string]));
    for (const r of parsed.rows) {
      const no = taken.get(r.phone.replace(/\D/g, '').slice(-10));
      if (no && r.problems.length === 0) r.problems.push(`already a member (${no})`);
    }
    setRows(parsed.rows.slice(0, 2000));
    setMissing(parsed.missing);
  }

  async function run() {
    const out: Result[] = [];
    for (let i = 0; i < good.length; i++) {
      const r = good[i];
      setProgress(i);
      try {
        await rpc('create_member', {
          p_gym: gym.id, p_full_name: r.full_name, p_phone: r.phone, p_email: r.email || null, p_gender: r.gender || null,
          p_date_of_birth: r.date_of_birth || null, p_join_date: r.join_date || null,
        });
        out.push({ line: r.line, name: r.full_name, ok: true, message: 'Added' });
      } catch (e) {
        out.push({ line: r.line, name: r.full_name, ok: false, message: errorMessage(e) });
      }
    }
    setProgress(null);
    setResults(out);
    await qc.invalidateQueries({ queryKey: ['members', gym.id] });
    await qc.invalidateQueries({ queryKey: ['dashboard', gym.id] });
  }

  const added = results?.filter((r) => r.ok).length ?? 0;

  return (
    <div className="stack lg" style={{ maxWidth: 880 }}>
      <BackLink to={`/g/${gym.slug}/members`} className="btn ghost small" style={{ justifySelf: 'start' }}><ArrowLeft size={16} /> Members</BackLink>
      <div className="page-head"><h1>Import members</h1></div>

      <div className="card stack">
        <p>CSV with <strong>name</strong> and <strong>phone</strong> columns. Optional: email, gender, date of birth, join date.</p>
        <div className="row">
          <label className="btn primary">
            <Upload size={18} /> Choose CSV file
            <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          </label>
          <button className="btn" type="button" onClick={() => downloadCSV('xs-gym-import-template.csv', ['name', 'phone', 'email', 'gender', 'date of birth', 'join date'],
            [['Rahul Krishnan', '9876543210', '', 'male', '15/08/1995', '01/10/2026']])}>Download template</button>
        </div>
      </div>

      {missing.length > 0 && <Notice tone="bad">{fileName}: missing {missing.join(' and ')} column.</Notice>}

      {rows && missing.length === 0 && !results && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{fileName}</h2>
            <span className="muted">{good.length} ready · {bad.length} with problems</span>
          </div>
          {bad.length > 0 && <Notice tone="warn">Rows with problems are skipped. Fix them in the file and import again.</Notice>}
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Line</th><th>Name</th><th>Phone</th><th>Join date</th><th>Check</th></tr></thead>
              <tbody>
                {rows.slice(0, 200).map((r) => (
                  <tr key={r.line}>
                    <td className="num">{r.line}</td><td>{r.full_name}</td><td>{r.phone}</td><td>{r.join_date || 'today'}</td>
                    <td>{r.problems.length ? <span className="badge bad">{r.problems.join('; ')}</span> : <span className="badge ok">Ready</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > 200 && <p className="muted">Showing the first 200 of {rows.length} rows.</p>}
          <div className="row end">
            <button className="btn primary" disabled={good.length === 0 || progress !== null} onClick={run}>
              {progress !== null ? `Adding ${progress + 1} of ${good.length}…` : `Add ${good.length} member${good.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {results && (
        <div className="card stack">
          <Notice tone={added === results.length ? 'ok' : 'warn'}>
            Added {added} of {results.length}. {results.length - added > 0 ? 'The rows below were not added.' : ''}
          </Notice>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>Line</th><th>Name</th><th>Result</th></tr></thead>
              <tbody>{results.filter((r) => !r.ok).map((r) => (
                <tr key={r.line}><td className="num">{r.line}</td><td>{r.name}</td><td style={{ whiteSpace: 'normal' }}>{r.message}</td></tr>
              ))}</tbody>
            </table>
          </div>
          <Link className="btn" to={`/g/${gym.slug}/members`} style={{ justifySelf: 'start' }}>Go to members</Link>
        </div>
      )}
    </div>
  );
}
