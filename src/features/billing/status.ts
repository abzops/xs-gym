import { isComplimentary, type Entitlements } from '../../lib/billingApi';
import { formatDate } from '../../lib/dates';

const day = (iso: string | null | undefined) => (iso && iso !== 'infinity' ? formatDate(iso.slice(0, 10)) : '');
const daysLeft = (iso: string | null | undefined) => (iso ? Math.max(0, Math.ceil((Date.parse(iso) - Date.now()) / 86400_000)) : 0);

/** One plain sentence about where the subscription stands. */
export function statusLine(e: Entitlements): string {
  if (isComplimentary(e)) {
    return e.complimentary_until === 'infinity'
      ? (e.is_pilot ? 'Pilot gym: complimentary access. Xelorsoft will give you notice before this changes.' : 'Complimentary access from Xelorsoft.')
      : `Complimentary access until ${day(e.complimentary_until)}.`;
  }
  switch (e.effective_state) {
    case 'TRIALING': return `Free trial: ${daysLeft(e.trial_ends_at)} day${daysLeft(e.trial_ends_at) === 1 ? '' : 's'} left (ends ${day(e.trial_ends_at)}).`;
    case 'ACTIVE':
      return e.current_period_start && Date.parse(e.current_period_start) > Date.now()
        ? `Paid. Your paid period starts ${day(e.current_period_start)} and runs to ${day(e.current_period_end)}.`
        : `Paid until ${day(e.current_period_end)}.`;
    case 'PAST_DUE': return `Your period ended on ${day(e.current_period_end)}. Pay to continue — everything works until ${day(e.grace_ends_at)}.`;
    case 'GRACE_PERIOD': return `Grace period: pay by ${day(e.grace_ends_at)} to keep making changes.`;
    case 'CANCELED': return `Cancelled. Everything works until ${day(e.cancel_effective_at)}; then the gym becomes read-only.`;
    default: return e.trial_eligible === false && !e.current_period_end && !e.trial_ends_at
      ? 'This email or phone number already used its free trial. Choose a plan to start.'
      : 'Your subscription has ended. Your data is safe and readable; choose a plan to make changes again.';
  }
}

