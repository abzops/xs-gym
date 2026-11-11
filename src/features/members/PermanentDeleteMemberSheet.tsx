import { useMutation } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { useGym } from '../../app/gym';
import { Field, Notice, Sheet } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc } from '../../lib/supabase';
import type { MemberOverview } from '../../lib/types';

/** A profile can be hard-deleted only when no protected activity or ledger exists. */
export function PermanentDeleteMemberSheet({ member, onClose, onDeleted }: {
  member: MemberOverview;
  onClose: () => void;
  onDeleted: () => Promise<unknown>;
}) {
  const { gym } = useGym();
  const [memberNo, setMemberNo] = useState('');
  const [reason, setReason] = useState('');
  const busy = useRef(false);
  const remove = useMutation({
    mutationFn: () => rpc('permanently_delete_member', {
      p_gym: gym.id, p_member: member.id, p_member_no: memberNo.trim(), p_reason: reason.trim(),
    }),
    onSuccess: async () => {
      await onDeleted();
      onClose();
    },
    onSettled: () => { busy.current = false; },
  });
  const valid = memberNo.trim() === member.member_no && reason.trim().length >= 3;
  return (
    <Sheet title="Permanently delete member" onClose={onClose}>
      <form className="stack lg" onSubmit={(e) => {
        e.preventDefault();
        if (!valid || busy.current) return;
        busy.current = true;
        remove.mutate();
      }}>
        <Notice tone="bad">
          <strong>Delete is permanent, not Archive.</strong> This permanently removes {member.full_name}'s
          member profile and any linked enquiry. It cannot be restored. For members with
          payments, charges, memberships or check-ins, deletion is blocked to protect the
          financial and activity history. Archive those members instead.
        </Notice>
        <p>To confirm, type member number <strong className="mono">{member.member_no}</strong>.</p>
        <Field label="Member number (required)">
          <input className="input" autoComplete="off" value={memberNo} onChange={(e) => setMemberNo(e.target.value)} />
        </Field>
        <Field label="Reason for permanent deletion (required)">
          <input className="input" autoComplete="off" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. Duplicate profile entered by mistake" />
        </Field>
        {remove.error && <Notice tone="bad">{errorMessage(remove.error)}</Notice>}
        <button type="submit" className="btn danger block" disabled={!valid || remove.isPending}>
          {remove.isPending ? 'Deleting…' : 'Delete member permanently'}
        </button>
      </form>
    </Sheet>
  );
}
