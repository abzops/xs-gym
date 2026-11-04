import { Search } from 'lucide-react';
import { useDeferredValue, useState } from 'react';
import { Link } from 'react-router';
import { useGym } from '../../app/gym';
import { Empty, Loading, Notice, PushLink, StatusBadge, initials } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { formatINR } from '../../lib/money';
import { CheckInButton } from '../members/actions';
import { useMembers } from '../members/api';

/** Front-desk check-in: type a few letters or digits, tap Check in. */
export function CheckInPage() {
  const { gym } = useGym();
  const [q, setQ] = useState('');
  const deferred = useDeferredValue(q.trim());
  const results = useMembers(gym.id, deferred, 'all', gym.timezone);
  const base = `/g/${gym.slug}`;

  return (
    <div className="stack lg" style={{ maxWidth: 760 }}>
      <div className="page-head"><h1>Check in</h1></div>
      <div className="search">
        <Search size={18} />
        <input className="input" type="search" placeholder="Name, last digits of phone, or XS number" value={q}
          onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Find member to check in"
          style={{ minHeight: 56, fontSize: '1.0625rem' }} />
      </div>

      {deferred.length < 2 ? (
        null
      ) : results.isPending ? <Loading rows={3} /> : results.error ? (
        <Notice tone="bad">{errorMessage(results.error)}</Notice>
      ) : results.data.length === 0 ? (
        <div className="card"><Empty title="No member found">
          <Link className="btn" to={`${base}/members/new`}>Add a new member</Link>
        </Empty></div>
      ) : (
        <ul className="list card flush">
          {results.data.slice(0, 12).map((m) => (
            <li key={m.id} className="item" style={{ cursor: 'default' }}>
              <span className="avatar" aria-hidden>{initials(m.full_name)}</span>
              <PushLink to={`${base}/members/${m.id}`} className="main-col" style={{ textDecoration: 'none' }}>
                <span className="title">{m.full_name}</span>
                <span className="meta">
                  <span className="mono">{m.member_no}</span>
                  <span>{m.valid_until ? `Till ${formatDate(m.valid_until)}` : 'No plan yet'}</span>
                  {m.due_paise > 0 && <span className="amount-due">{formatINR(m.due_paise)} due</span>}
                </span>
                <span><StatusBadge status={m.membership_status} /></span>
              </PushLink>
              <CheckInButton member={m} compact />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
