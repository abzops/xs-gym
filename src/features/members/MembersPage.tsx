import { useQueryClient } from '@tanstack/react-query';
import { Archive, Pencil, Plus, RotateCcw, Search, Trash2, Upload } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, PushLink, Segmented, Sheet, StatusBadge, initials, useToast } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { rpc } from '../../lib/supabase';
import type { MemberOverview } from '../../lib/types';
import { ReasonSheet } from './actions';
import { useMembers, type MemberFilter } from './api';
import { MemberForm } from './MemberForm';

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
  { value: 'dues', label: 'Dues' },
  { value: 'archived', label: 'Archived' },
];

export function MembersPage() {
  const { gym, can } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as MemberFilter) || 'all';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const deferred = useDeferredValue(search);
  const members = useMembers(gym.id, deferred, filter, gym.timezone);
  const [editing, setEditing] = useState<MemberOverview | null>(null);
  const [deleting, setDeleting] = useState<MemberOverview | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const base = `/g/${gym.slug}`;

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['members', gym.id] }),
      qc.invalidateQueries({ queryKey: ['member', gym.id] }),
      qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
      qc.invalidateQueries({ queryKey: ['analytics', gym.id] }),
    ]);
  };
  const restore = async (m: MemberOverview) => {
    if (restoring) return;
    setRestoring(m.id);
    try {
      await rpc('set_member_status', { p_gym: gym.id, p_member: m.id,
        p_status: 'active', p_reason: 'Restored from Archived members' });
      await refresh();
      toast(`${m.full_name} restored`);
    } catch (e) { toast(errorMessage(e), 'bad'); }
    finally { setRestoring(null); }
  };

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Members</h1>
        {can('members.export') && <Link className="btn" to={`${base}/members/import`} aria-label="Import">
          <Upload size={18} /> <span className="btn-text">Import</span>
        </Link>}
        {can('members.write') && (
          <Link className="btn primary" to={`${base}/members/new`} aria-label="Add member">
            <Plus size={18} /> <span className="btn-text">Add member</span>
          </Link>
        )}
      </div>

      <div className="row" style={{ justifyContent: 'space-between' }}>
        <p className="muted">{filter === 'archived'
          ? 'Archived members are kept here with their plans, payments and history. They can be restored.'
          : 'Edit or delete members below. Deleted members move to Archived; no history is lost.'}</p>
        <Link className="btn small" to={filter === 'archived' ? `${base}/members` : `${base}/members?filter=archived`}>
          <Archive size={16} /> {filter === 'archived' ? 'Active members' : 'Archived members'}
        </Link>
      </div>

      <div className="stack">
        <div className="search">
          <Search size={18} />
          <input className="input" type="search" placeholder="Name, phone or member number" value={search}
            onChange={(e) => setSearch(e.target.value)} aria-label="Search members" />
        </div>
        <div className="scroll-x">
          <Segmented label="Filter members" value={filter} options={FILTERS}
            onChange={(v) => setParams((p) => { p.set('filter', v); return p; }, { replace: true })} />
        </div>
      </div>

      {members.isPending ? <Loading /> : members.error ? (
        <Notice tone="bad">{errorMessage(members.error)}</Notice>
      ) : members.data.length === 0 ? (
        <div className="card">
          <Empty title={filter === 'archived' ? 'No archived members' : search ? 'No members match' : 'No members here yet'}>
            {!search && filter === 'all' && can('members.write') && (
              <Link className="btn primary" to={`${base}/members/new`}><Plus size={18} /> Add the first member</Link>
            )}
          </Empty>
        </div>
      ) : (
        <ul className="list card flush">
          {members.data.map((m) => (
            <li key={m.id}>
              <div className="item">
                <span className="avatar" aria-hidden>{initials(m.full_name)}</span>
                <PushLink className="main-col" to={`${base}/members/${m.id}`}>
                  <span className="title">{m.full_name}</span>
                  <span className="meta">
                    <span className="mono">{m.member_no}</span>
                    {m.valid_until && <span>Till {formatDate(m.valid_until)}</span>}
                  </span>
                </PushLink>
                <span className="end-col">
                  {m.status === 'archived' ? <span className="badge neutral">Archived</span> : (
                    <StatusBadge status={m.membership_status} />
                  )}
                  {m.due_paise > 0 && <span className="num amount-due">{formatINR(m.due_paise)} due</span>}
                  <span className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                    {can('members.write') && (
                      <button type="button" className="btn small ghost" onClick={() => setEditing(m)}
                        aria-label={`Edit member ${m.full_name}`}><Pencil size={15} /> Edit</button>
                    )}
                    {m.status === 'archived' ? can('members.archive') && (
                      <button type="button" className="btn small" disabled={restoring === m.id}
                        onClick={() => void restore(m)} aria-label={`Restore member ${m.full_name}`}>
                        <RotateCcw size={15} /> Restore</button>
                    ) : can('members.archive') && (
                      <button type="button" className="btn small ghost danger" onClick={() => setDeleting(m)}
                        aria-label={`Delete member ${m.full_name}`}>
                        <Trash2 size={15} /> Delete</button>
                    )}
                  </span>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
      {members.data && members.data.length === 100 &&
        <p className="muted">Showing the first 100. Search to narrow down.</p>}
      {editing && <Sheet title="Edit member" onClose={() => setEditing(null)}>
        <MemberForm member={editing} onDone={() => setEditing(null)} />
      </Sheet>}
      {deleting && <ReasonSheet title="Delete member (archive)" confirmLabel="Delete / archive member"
        warning="Deleting moves this member to Members → Archived. Their membership, payment history and receipts stay intact. You can restore them later."
        onClose={() => setDeleting(null)}
        onConfirm={(reason) => rpc('set_member_status', {
          p_gym: gym.id, p_member: deleting.id, p_status: 'archived', p_reason: reason,
        }).then(refresh).then(() => toast('Member moved to Archived members'))} />}
    </div>
  );
}
