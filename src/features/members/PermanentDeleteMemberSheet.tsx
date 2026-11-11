import { useMutation } from '@tanstack/react-query';
import { useRef } from 'react';
import { useGym } from '../../app/gym';
import { Notice, Sheet } from '../../components/ui';
import { errorMessage } from '../../lib/errors';
import { rpc } from '../../lib/supabase';
import type { MemberOverview } from '../../lib/types';

/**
 * A single explicit warning replaces typing a member number and reason.
 * The server still checks gym ownership and protects financial/attendance
 * history. Confirmation is recorded in the immutable deletion audit log.
 */
export function PermanentDeleteMemberSheet({ member, onClose, onDeleted }: {
  member: MemberOverview;
  onClose: () => void;
  onDeleted: () => Promise<unknown>;
}) {
  const { gym } = useGym();
  const busy = useRef(false);
  const remove = useMutation({
    mutationFn: () => rpc('permanently_delete_member', {
      p_gym: gym.id,
      p_member: member.id,
      p_member_no: member.member_no,
      p_reason: 'Owner confirmed permanent deletion after warning',
    }),
    onSuccess: async () => {
      await onDeleted();
      onClose();
    },
    onSettled: () => { busy.current = false; },
  });

  const confirm = () => {
    if (busy.current) return;
    busy.current = true;
    remove.mutate();
  };

  return (
    <Sheet title="Delete member?" onClose={onClose}>
      <div className="stack lg">
        <Notice tone="bad">
          <strong>Delete {member.full_name} permanently?</strong> This cannot be undone.
          Members with payments, memberships, charges or check-ins must be archived
          instead so their history remains intact.
        </Notice>
        {remove.error && <Notice tone="bad">{errorMessage(remove.error)}</Notice>}
        <div className="row" style={{ justifyContent: 'flex-end' }}>
          <button type="button" className="btn" disabled={remove.isPending} onClick={onClose}>Cancel</button>
          <button type="button" className="btn danger" disabled={remove.isPending} onClick={confirm}>
            {remove.isPending ? 'Deleting…' : 'Delete permanently'}
          </button>
        </div>
      </div>
    </Sheet>
  );
}
