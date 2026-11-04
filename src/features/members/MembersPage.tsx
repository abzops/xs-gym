import { Plus, Search, Upload } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, PushLink, Segmented, StatusBadge, initials } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { useMembers, type MemberFilter } from './api';

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
  const [params, setParams] = useSearchParams();
  const filter = (params.get('filter') as MemberFilter) || 'all';
  const [search, setSearch] = useState(params.get('q') ?? '');
  const deferred = useDeferredValue(search);
  const members = useMembers(gym.id, deferred, filter, gym.timezone);
  const base = `/g/${gym.slug}`;

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Members</h1>
        {can('members.export') && <Link className="btn" to={`${base}/members/import`} aria-label="Import"><Upload size={18} /> <span className="btn-text">Import</span></Link>}
        {can('members.write') && (
          <Link className="btn primary" to={`${base}/members/new`} aria-label="Add member"><Plus size={18} /> <span className="btn-text">Add member</span></Link>
        )}
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
          <Empty title={search ? 'No members match' : 'No members here yet'}>
            {!search && filter === 'all' && can('members.write') && (
              <Link className="btn primary" to={`${base}/members/new`}><Plus size={18} /> Add the first member</Link>
            )}
          </Empty>
        </div>
      ) : (
        <ul className="list card flush">
          {members.data.map((m) => (
            <li key={m.id}>
              <PushLink className="item" to={`${base}/members/${m.id}`}>
                <span className="avatar" aria-hidden>{initials(m.full_name)}</span>
                <span className="main-col">
                  <span className="title">{m.full_name}</span>
                  <span className="meta">
                    <span className="mono">{m.member_no}</span>
                    {m.valid_until && <span>Till {formatDate(m.valid_until)}</span>}
                  </span>
                </span>
                <span className="end-col">
                  <StatusBadge status={m.membership_status} />
                  {m.due_paise > 0 && <span className="num amount-due">{formatINR(m.due_paise)} due</span>}
                </span>
              </PushLink>
            </li>
          ))}
        </ul>
      )}
      {members.data && members.data.length === 100 && <p className="muted">Showing the first 100. Search to narrow down.</p>}
    </div>
  );
}
