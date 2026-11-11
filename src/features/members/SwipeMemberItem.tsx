import { Archive, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { PushLink, StatusBadge, initials } from '../../components/ui';
import { formatDate } from '../../lib/dates';
import { formatINR } from '../../lib/money';
import type { MemberOverview } from '../../lib/types';

type Props = {
  member: MemberOverview;
  base: string;
  open: boolean;
  onOpen: (id: string | null) => void;
  canEdit: boolean;
  canArchive: boolean;
  canDelete: boolean;
  restoring: boolean;
  onEdit: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onRestore: () => void;
};

type Gesture = { x: number; y: number; initial: number; horizontal: boolean };
const ACTION_WIDTH = 176;
const clamp = (value: number) => Math.max(-ACTION_WIDTH, Math.min(0, value));

/** iOS-style reveal, not a destructive swipe-to-delete gesture. Actions require a tap. */
export function SwipeMemberItem({
  member: m, base, open, onOpen, canEdit, canArchive, canDelete,
  restoring, onEdit, onArchive, onDelete, onRestore,
}: Props) {
  const [dragOffset, setDragOffset] = useState<number | null>(null);
  const gesture = useRef<Gesture | null>(null);
  const suppressClick = useRef(false);
  const visibleActions = (m.status === 'archived' ? canArchive : canArchive) || canDelete;
  const width = (canArchive ? 88 : 0) + (canDelete ? 88 : 0);
  const offset = dragOffset ?? (open ? -width : 0);

  useEffect(() => {
    if (!open) setDragOffset(null);
  }, [open]);

  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!visibleActions || event.pointerType !== 'touch' || !event.isPrimary ||
        !window.matchMedia('(max-width: 719px)').matches) return;
    gesture.current = { x: event.clientX, y: event.clientY, initial: open ? -width : 0, horizontal: false };
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = event.clientX - g.x, dy = event.clientY - g.y;
    if (!g.horizontal) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) {
        gesture.current = null; // vertical page scroll takes precedence
        return;
      }
      if (Math.abs(dx) < 10 || Math.abs(dx) <= Math.abs(dy)) return;
      g.horizontal = true;
    }
    suppressClick.current = true;
    setDragOffset(clamp(g.initial + dx));
  };
  const pointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (g.horizontal) {
      const next = clamp(g.initial + event.clientX - g.x);
      onOpen(next <= -width * 0.45 ? m.id : null);
      // A swipe must never accidentally navigate to the member or click a button.
      window.setTimeout(() => { suppressClick.current = false; }, 350);
    }
    setDragOffset(null);
  };
  const cancel = () => { gesture.current = null; setDragOffset(null); };

  return (
    <li className="member-swipe" data-member-no={m.member_no}>
      <div className="member-swipe-actions" role="group" aria-label={`Actions for ${m.full_name}`}
        aria-hidden={!open} style={{ width }}>
        {canArchive && (m.status === 'archived' ?
          <button type="button" className="member-swipe-restore" disabled={restoring}
            tabIndex={open ? 0 : -1} onClick={() => { onOpen(null); onRestore(); }}
            aria-label={`Restore member ${m.full_name}`}><RotateCcw size={19} />Restore</button>
          : <button type="button" className="member-swipe-archive" tabIndex={open ? 0 : -1}
            onClick={() => { onOpen(null); onArchive(); }} aria-label={`Archive member ${m.full_name}`}>
            <Archive size={19} />Archive</button>)}
        {canDelete && <button type="button" className="member-swipe-delete" tabIndex={open ? 0 : -1}
          onClick={() => { onOpen(null); onDelete(); }} aria-label={`Permanently delete member ${m.full_name}`}>
          <Trash2 size={19} />Delete</button>}
      </div>
      <div className="item member-swipe-foreground"
        style={{ transform: `translate3d(${offset}px,0,0)`, transition: dragOffset === null ? undefined : 'none' }}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp}
        onPointerCancel={cancel} onClickCapture={(event) => {
          if (suppressClick.current) {
            event.preventDefault();
            event.stopPropagation();
            suppressClick.current = false;
          }
        }}>
        <span className="avatar" aria-hidden>{initials(m.full_name)}</span>
        <PushLink className="main-col" to={`${base}/members/${m.id}`}>
          <span className="title">{m.full_name}</span>
          <span className="meta">
            <span className="mono">{m.member_no}</span>
            {m.valid_until && <span>Till {formatDate(m.valid_until)}</span>}
          </span>
        </PushLink>
        <span className="end-col">
          {m.status === 'archived' ? <span className="badge neutral">Archived</span>
            : <StatusBadge status={m.membership_status} />}
          {m.due_paise > 0 && <span className="num amount-due">{formatINR(m.due_paise)} due</span>}
          {visibleActions && <button type="button" className="member-swipe-more"
            aria-label={`Show actions for ${m.full_name}`} aria-expanded={open}
            onClick={() => onOpen(open ? null : m.id)}><MoreHorizontal size={19} /></button>}
          <span className="row member-desktop-actions" style={{ gap: 6, justifyContent: 'flex-end' }}>
            {canEdit && <button type="button" className="btn small ghost" onClick={onEdit}
              aria-label={`Edit member ${m.full_name}`}><Pencil size={15} /> Edit</button>}
            {canArchive && (m.status === 'archived'
              ? <button type="button" className="btn small" disabled={restoring} onClick={onRestore}
                  aria-label={`Restore member ${m.full_name}`}><RotateCcw size={15} /> Restore</button>
              : <button type="button" className="btn small ghost" onClick={onArchive}
                  aria-label={`Archive member ${m.full_name}`}><Archive size={15} /> Archive</button>)}
            {canDelete && <button type="button" className="btn small ghost danger" onClick={onDelete}
              aria-label={`Permanently delete member ${m.full_name}`}><Trash2 size={15} /> Delete</button>}
          </span>
        </span>
      </div>
    </li>
  );
}
