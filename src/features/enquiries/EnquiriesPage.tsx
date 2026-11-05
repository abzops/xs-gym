import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Phone, Plus, UserCheck } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useGym } from '../../app/gym';
import { WhatsAppButton } from '../../components/WhatsApp';
import { Empty, Field, Loading, Notice, Segmented, Sheet, useToast } from '../../components/ui';
import { addDays, formatDate, todayInGym } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { enquiriesQuery } from '../../lib/sections';
import { rpc } from '../../lib/supabase';
import type { Enquiry, EnquirySource, EnquiryStatus } from '../../lib/types';

export const SOURCE_LABEL: Record<EnquirySource, string> = {
  walk_in: 'Walk-in', phone: 'Phone call', whatsapp: 'WhatsApp', instagram: 'Instagram', referral: 'Referral', website: 'Website', other: 'Other',
};
const STATUS_LABEL: Record<EnquiryStatus, string> = { new: 'New', follow_up: 'Follow up', trial: 'Trial', joined: 'Joined', lost: 'Lost' };
type View = 'open' | 'joined' | 'lost';

export function EnquiriesPage() {
  const { gym, can } = useGym();
  const [view, setView] = useState<View>('open');
  const [editing, setEditing] = useState<Enquiry | 'new' | null>(null);
  const q = useQuery(enquiriesQuery(gym.id));
  const today = todayInGym(gym.timezone);
  const all = q.data ?? [];
  const open = all.filter((e) => !['joined', 'lost'].includes(e.status));
  const rows = view === 'open'
    ? [...open].sort((a, b) => (a.follow_up_date ?? '9999').localeCompare(b.follow_up_date ?? '9999'))
    : all.filter((e) => e.status === view);
  const due = open.filter((e) => e.follow_up_date && e.follow_up_date <= today).length;
  const closed = all.filter((e) => e.status === 'joined' || e.status === 'lost');
  const rate = closed.length ? Math.round((all.filter((e) => e.status === 'joined').length / closed.length) * 100) : null;

  return (
    <div className="stack lg">
      <div className="page-head">
        <h1>Enquiries</h1>
        {can('members.write') && <button className="btn primary" onClick={() => setEditing('new')} aria-label="Add enquiry"><Plus size={18} /> <span className="btn-text">Add enquiry</span></button>}
      </div>
      <div className="tiles">
        <div className="tile"><span className="label">Open</span><span className="value num">{open.length}</span><span className="sub">people to follow up</span></div>
        <div className="tile"><span className="label">Follow up today</span><span className="value num">{due}</span><span className="sub">due or overdue</span></div>
        <div className="tile"><span className="label">Joined</span><span className="value num">{all.filter((e) => e.status === 'joined').length}</span><span className="sub">became members</span></div>
        <div className="tile"><span className="label">Conversion</span><span className="value num">{rate === null ? '—' : `${rate}%`}</span><span className="sub">of closed enquiries</span></div>
      </div>
      <Segmented label="Show" value={view} onChange={setView}
        options={[{ value: 'open', label: `Open${open.length ? ` (${open.length})` : ''}` }, { value: 'joined', label: 'Joined' }, { value: 'lost', label: 'Lost' }]} />
      {q.isPending ? <Loading /> : q.error ? <Notice tone="bad">{errorMessage(q.error)}</Notice> : rows.length === 0 ? (
        <div className="card"><Empty title={view === 'open' ? 'No open enquiries' : `No ${view} enquiries`}>
          {view === 'open' && 'When someone asks about joining, save them here so nobody is forgotten.'}
        </Empty></div>
      ) : (
        <ul className="list card flush">
          {rows.map((e) => {
            const late = e.follow_up_date && e.follow_up_date <= today && view === 'open';
            return (
              <li key={e.id} className="item enquiry">
                <button type="button" className="main-col plain" onClick={() => can('members.write') && setEditing(e)} disabled={!can('members.write')}>
                  <span className="title">{e.full_name}</span>
                  <span className="meta">
                    <span className={`pill ${e.status}`}>{STATUS_LABEL[e.status]}</span>
                    <span>{SOURCE_LABEL[e.source]}{e.interest ? ` · ${e.interest}` : ''}</span>
                    {e.follow_up_date && view === 'open' && <span className={late ? 'late' : ''}>Follow up {e.follow_up_date === today ? 'today' : formatDate(e.follow_up_date)}</span>}
                    {view !== 'open' && e.closed_at && <span>{formatDate(e.closed_at.slice(0, 10))}</span>}
                  </span>
                </button>
                <span className="end-col">
                  <a className="btn small ghost" href={`tel:${e.phone}`} aria-label={`Call ${e.full_name}`}><Phone size={16} /></a>
                  {view === 'open' && <WhatsAppButton phone={e.phone} kind="enquiry" facts={{ name: e.full_name }} />}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {editing && <EnquirySheet enquiry={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function EnquirySheet({ enquiry, onClose }: { enquiry: Enquiry | null; onClose: () => void }) {
  const { gym, can } = useGym();
  const qc = useQueryClient();
  const toast = useToast();
  const navigate = useNavigate();
  const today = todayInGym(gym.timezone);
  const [name, setName] = useState(enquiry?.full_name ?? '');
  const [phone, setPhone] = useState(enquiry?.phone.replace(/^\+91/, '') ?? '');
  const [source, setSource] = useState<EnquirySource>(enquiry?.source ?? 'walk_in');
  const [interest, setInterest] = useState(enquiry?.interest ?? '');
  const [notes, setNotes] = useState(enquiry?.notes ?? '');
  const [follow, setFollow] = useState(enquiry?.follow_up_date ?? addDays(today, 1));
  const [status, setStatus] = useState<EnquiryStatus>(enquiry?.status === 'new' || !enquiry ? 'new' : enquiry.status);
  const digits = phone.replace(/\D/g, '');
  const valid = name.trim().length >= 2 && digits.length >= 10;
  const refresh = () => Promise.all(['enquiries', 'analytics', 'members', 'dashboard'].map((k) => qc.invalidateQueries({ queryKey: [k, gym.id] })));
  const args = (st: EnquiryStatus, memberId: string | null = null) => ({
    p_gym: gym.id, p_enquiry: enquiry?.id ?? null, p_full_name: name, p_phone: phone, p_source: source,
    p_interest: interest || null, p_notes: notes || null, p_follow_up_date: st === 'joined' || st === 'lost' ? null : follow || null,
    p_status: st, p_member_id: memberId,
  });
  const save = useMutation({
    mutationFn: (st: EnquiryStatus) => rpc<Enquiry>('save_enquiry', args(st)),
    onSuccess: async (_e, st) => { await refresh(); toast(st === 'lost' ? `${name} marked lost` : 'Enquiry saved'); onClose(); },
  });
  // Joined: create the member from the enquiry, link them, open the member.
  const join = useMutation({
    mutationFn: async () => {
      const m = await rpc<{ id: string; member_no: string }>('create_member', { p_gym: gym.id, p_full_name: name, p_phone: phone });
      await rpc('save_enquiry', args('joined', m.id));
      return m;
    },
    onSuccess: async (m) => { await refresh(); toast(`${name} is now member ${m.member_no}`); onClose(); navigate(`/g/${gym.slug}/members/${m.id}`); },
  });
  const busy = save.isPending || join.isPending;
  const error = save.error ?? join.error;
  const closedAlready = enquiry?.status === 'joined';

  return (
    <Sheet title={enquiry ? enquiry.full_name : 'New enquiry'} onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => { e.preventDefault(); if (valid && !busy) save.mutate(status); }}>
        <div className="grid-2">
          <Field label="Name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></Field>
          <Field label="Mobile"><input className="input" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 digits" /></Field>
        </div>
        <Field label="How did they find us">
          <select className="input" value={source} onChange={(e) => setSource(e.target.value as EnquirySource)}>
            {Object.entries(SOURCE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </Field>
        <div className="grid-2">
          <Field label="Interested in"><input className="input" value={interest} onChange={(e) => setInterest(e.target.value)} placeholder="e.g. Monthly, weight loss" /></Field>
          <Field label="Follow up on"><input className="input" type="date" value={follow} min={today} onChange={(e) => setFollow(e.target.value)} /></Field>
        </div>
        {enquiry && !closedAlready && (
          <Segmented label="Stage" value={status === 'joined' || status === 'lost' ? 'follow_up' : status} onChange={setStatus}
            options={[{ value: 'new', label: 'New' }, { value: 'follow_up', label: 'Follow up' }, { value: 'trial', label: 'Trial' }]} />
        )}
        <Field label="Notes"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
        {error && <Notice tone="bad">{errorMessage(error)}</Notice>}
        {!closedAlready && <button className="btn primary block xl" disabled={!valid || busy}>{save.isPending ? <span className="spinner" /> : 'Save enquiry'}</button>}
        {enquiry && !closedAlready && (
          <div className="grid-2">
            {can('members.write') && <button type="button" className="btn block" disabled={!valid || busy} onClick={() => join.mutate()}>
              {join.isPending ? <span className="spinner" /> : <><UserCheck size={18} /> Joined — add member</>}</button>}
            <button type="button" className="btn block ghost danger" disabled={busy} onClick={() => save.mutate('lost')}>Mark lost</button>
          </div>
        )}
      </form>
    </Sheet>
  );
}
