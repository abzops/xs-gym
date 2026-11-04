// Business dates come from the database as 'YYYY-MM-DD' strings in the gym's
// timezone. Format them without converting through Date to avoid UTC shifts.

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const GYM_TZ = 'Asia/Kolkata';

/** '2027-02-14' → '14 Feb 2027' */
export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return '—';
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** ISO timestamp → '5 Nov 2026, 7:42 pm' in the gym's timezone. */
export function formatDateTime(iso: string | null | undefined, timeZone = GYM_TZ): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone,
  }).format(new Date(iso));
}

export function formatTime(iso: string, timeZone = GYM_TZ): string {
  return new Intl.DateTimeFormat('en-IN', { hour: 'numeric', minute: '2-digit', timeZone }).format(new Date(iso));
}

/** Today's date in the gym's timezone as 'YYYY-MM-DD' (display/defaults only; the server decides). */
export function todayInGym(timeZone = GYM_TZ): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone }).format(new Date());
}

export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return t.toISOString().slice(0, 10);
}

/** Whole days from `from` to `to` (both 'YYYY-MM-DD'). */
export function daysBetween(from: string, to: string): number {
  const a = Date.UTC(...(from.split('-').map(Number) as [number, number, number]));
  const b = Date.UTC(...(to.split('-').map(Number) as [number, number, number]));
  return Math.round((b - a) / 86_400_000) + 0;
}
