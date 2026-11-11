import { useQueryClient } from '@tanstack/react-query';
import { Archive, Plus, Search, Upload } from 'lucide-react';
import { useDeferredValue, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc } from '../../lib/supabase';
import type { MemberOverview } from '../../lib/types';
import { ReasonSheet } from './actions';
import { useMembers, type MemberFilter } from './api';
import { MemberForm } from './MemberForm';
import { PermanentDeleteMemberSheet } from './PermanentDeleteMemberSheet';
import { SwipeMemberItem } from './SwipeMemberItem';

const FILTERS: { value: MemberFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'expiring', label: 'Expiring' },
  { value: 'expired', label: 'Expired' },
  { value: 'dues', label: 'Dues' },
  { value: 'archived', label: 'Archived' },
];

export function MembersPage() {
  const { gym, can, role } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as MemberFilter) || 'all';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const deferred = useDeferredValue(search);
  const members = useMembers(gym.id, deferred, filter, gym.timezone);
  const [editing, setEditing] = useState<MemberOverview | null>(null);
  const [archiving, setArchiving] = useState<MemberOverview | null>(null);
  const [permanentlyDeleting, setPermanentlyDeleting] = useState<MemberOverview | null>(null);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);
  const base = `/g/${gym.slug}`;
  useEffect(() => { setOpenRowId(null); }, [filter, search]);

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['members', gym.id] }),
      qc.invalidateQueries({ queryKey: ['member', gym.id] }),
      qc.invalidateQueries({ queryKey: ['dashboard', gym.id] }),
      qc.invalidateQueries({ queryKey: ['analytics', gym.id] }),
      qc.invalidateQueries({ queryKey: ['enquiries', gym.id] }),
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
          : 'Swipe left for Archive or permanent Delete. Archiving preserves all history and can be undone.'}</p>
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
        <ul className="list card flush member-list">
          {members.data.map((m) => (
            <SwipeMemberItem key={m.id} member={m} base={base}
              open={openRowId === m.id} onOpen={setOpenRowId}
              canEdit={can('members.write')} canArchive={can('members.archive')}
              canDelete={role === 'owner' && can('members.archive')}
              restoring={restoring === m.id}
              onEdit={() => setEditing(m)}
              onArchive={() => setArchiving(m)}
              onDelete={() => setPermanentlyDeleting(m)}
              onRestore={() => void restore(m)} />
          ))}
        </ul>
      )}
      {members.data && members.data.length === 100 &&
        <p className="muted">Showing the first 100. Search to narrow down.</p>}
      {editing && <Sheet title="Edit member" onClose={() => setEditing(null)}>
        <MemberForm member={editing} onDone={() => setEditing(null)} />
      </Sheet>}
      {archiving && <ReasonSheet title="Archive member" confirmLabel="Archive member"
        warning="Archiving hides this member from the active list. Memberships, payments and receipts are preserved, and the member can be restored."
        onClose={() => setArchiving(null)}
        onConfirm={(reason) => rpc('set_member_status', {
          p_gym: gym.id, p_member: archiving.id, p_status: 'archived', p_reason: reason,
        }).then(refresh).then(() => toast('Member archived'))} />}
      {permanentlyDeleting && (
        <PermanentDeleteMemberSheet member={permanentlyDeleting}
          onClose={() => setPermanentlyDeleting(null)}
          onDeleted={async () => { await refresh(); toast('Member profile permanently deleted'); }} />
      )}
    </div>
  );
}
