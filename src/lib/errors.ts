// Turns database and network errors into plain sentences for staff.
// Server messages look like "XS409: Rahul K (XS-0001) already uses this number".

type MaybeError = { message?: string; code?: string } | null | undefined;

export function errorMessage(error: unknown): string {
  const e = error as MaybeError;
  const raw = e?.message ?? (typeof error === 'string' ? error : '');

  const coded = raw.match(/^XS\d{3}:\s*(.+)$/s);
  if (coded) return capitalise(coded[1].trim());

  if (/Failed to fetch|NetworkError|Load failed/i.test(raw)) {
    return 'No connection. Check the internet and try again — nothing was saved.';
  }
  if (/Invalid login credentials/i.test(raw)) return 'Email or password is incorrect.';
  if (/Email not confirmed/i.test(raw)) return 'Confirm your email first — check your inbox for the link.';
  if (/User already registered/i.test(raw)) return 'An account with this email already exists. Sign in instead.';
  if (/Password should be/i.test(raw)) return 'Use a password of at least 8 characters.';
  if (/rate limit/i.test(raw)) return 'Too many attempts. Wait a minute and try again.';
  if (e?.code === '42501' || /permission denied/i.test(raw)) return 'You do not have permission to do this.';
  return 'Something went wrong. Please try again.';
}

function capitalise(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
