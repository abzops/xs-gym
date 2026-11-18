import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { BackLink, Notice } from '../../components/ui';
import { downloadCSV } from '../../lib/csv';
import { parseCSV, toImportRows, type ImportRow } from '../../lib/csvParse';
import { reconcileMemberImport, sameImportPreview, type ExistingMember } from '../../lib/memberImport';
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
  const [checking, setChecking] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [confirmed, setConfirmed] = useState(false);
  const uploadToken = useRef(0);
  const inFlight = useRef(false);
  const source = useRef<ImportRow[]>([]);
  const good = rows?.filter((r) => r.problems.length === 0) ?? [];
  const bad = rows?.filter((r) => r.problems.length > 0) ?? [];

  /** Fail-closed and paginated: the Supabase REST API can cap large queries. */
  async function lookupExisting(): Promise<ExistingMember[]> {
    const pageSize = 500;
    const all: ExistingMember[] = [];
    for (let offset = 0; offset < 20_000; offset += pageSize) {
      const { data, error } = await supabase.from('members')
        .select('id, phone, member_no, status').eq('gym_id', gym.id)
        .order('id', { ascending: true }).range(offset, offset + pageSize - 1);
      if (error || !data) {
        throw new Error('Cannot verify existing gym members. Import is blocked; retry the preview.');
      }
      all.push(...data as ExistingMember[]);
      if (data.length < pageSize) return all;
    }
    throw new Error('More than 20,000 members: unable to verify duplicate records safely.');
  }

  /** Read-only preview. No create_member RPC runs when a file is selected. */
  async function onFile(file: File) {
    if (inFlight.current) return;
    const token = ++uploadToken.current;
    setRows(null);
    setResults(null);
    setPreviewError(null);
    setConfirmed(false);
    setMissing([]);
    setFileName(file.name);
    setChecking(true);
    source.current = [];
    try {
      if (file.size > 2_000_000) throw new Error('CSV is larger than 2 MB.');
      const parsed = toImportRows(parseCSV(await file.text()));
      if (parsed.missing.length) {
        if (token === uploadToken.current) setMissing(parsed.missing);
        return;
      }
      if (!parsed.rows.length) throw new Error('CSV contains no members.');
      if (parsed.rows.length > 2000) {
        throw new Error('CSV exceeds 2,000 members. Split into smaller batches; no rows were imported.');
      }
      const existing = await lookupExisting();
      if (token !== uploadToken.current) return;
      source.current = parsed.rows;
      setRows(reconcileMemberImport(parsed.rows, existing));
    } catch (error) {
      if (token === uploadToken.current) {
        setPreviewError(error instanceof Error ? error.message : 'Unable to validate member import. Please try again.');
        setRows(null);
      }
    } finally {
      if (token === uploadToken.current) setChecking(false);
    }
  }

  /** Refresh the read-only reconciliation immediately before the first write. */
  async function run() {
    if (inFlight.current || !confirmed || !rows || checking || previewError || good.length === 0) return;
    inFlight.current = true; // blocks a fast double-tap before React can render
    setProgress(0);
    setPreviewError(null);
    try {
      const refreshed = reconcileMemberImport(source.current, await lookupExisting());
      if (!sameImportPreview(rows, refreshed)) {
        setRows(refreshed);
        setConfirmed(false);
        setPreviewError('Member records changed since the preview. Review the updated conflicts and confirm again.');
        return;
      }

      const out: Result[] = [];
      for (let i = 0; i < good.length; i++) {
        const r = good[i];
        setProgress(i + 1);
        try {
          await rpc('create_member', {
            p_gym: gym.id, p_full_name: r.full_name, p_phone: r.phone, p_email: r.email || null, p_gender: r.gender || null,
            p_date_of_birth: r.date_of_birth || null, p_join_date: r.join_date || null,
          });
          out.push({ line: r.line, name: r.full_name, ok: true, message: 'Added' });
        } catch (error) {
          out.push({ line: r.line, name: r.full_name, ok: false, message: errorMessage(error) });
        }
      }

      setResults(out);
      setRows(null);
      setConfirmed(false);
      // A refresh failure must not hide the per-row results of successful writes.
      await Promise.allSettled([
        qc.invalidateQueries({ queryKey: ['members', gym.id] }),
        qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
      ]);
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Unable to validate member import. Please try again.');
      setConfirmed(false);
    } finally {
      setProgress(null);
      inFlight.current = false;
    }
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
            <input type="file" accept=".csv,text/csv" className="sr-only" disabled={checking || progress !== null}
              onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ''; if (file) void onFile(file); }} />
          </label>
          <button className="btn" type="button" onClick={() => downloadCSV('xs-gym-import-template.csv', ['name', 'phone', 'email', 'gender', 'date of birth', 'join date'],
            [['Rahul Krishnan', '9876543210', '', 'male', '15/08/1995', '01/10/2026']])}>Download template</button>
        </div>
      </div>

      {checking && <Notice tone="warn">Checking existing members… No data is being imported.</Notice>}
      {previewError && <Notice tone="bad">{previewError}</Notice>}
      {missing.length > 0 && <Notice tone="bad">{fileName}: missing {missing.join(' and ')} column.</Notice>}

      {rows && missing.length === 0 && !results && (
        <div className="card stack">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2>{fileName}</h2>
            <span className="muted">{good.length} ready · {bad.length} with problems · dry-run preview</span>
          </div>
          <Notice tone="warn">Dry-run only. Existing and archived members are never overwritten, deleted or restored by this import.</Notice>
          {bad.length > 0 && <Notice tone="warn">Rows with problems will be skipped. Review them before adding new members.</Notice>}
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
          <label className="row" style={{ alignItems: 'flex-start' }}>
            <input type="checkbox" checked={confirmed} disabled={progress !== null || good.length === 0}
              onChange={(e) => setConfirmed(e.target.checked)} />
            <span>I reviewed this dry-run preview and confirm adding only the {good.length} ready new members.</span>
          </label>
          <div className="row end">
            <button className="btn primary" disabled={!confirmed || good.length === 0 || progress !== null || checking || !!previewError}
              onClick={() => void run()}>
              {progress !== null ? `Adding ${progress} of ${good.length}…` : `Add ${good.length} member${good.length === 1 ? '' : 's'}`}
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
