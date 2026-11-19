// Staff logins made by the owner: a username + password instead of an email.
// Behind the scenes the username maps to an internal address that is never mailed.
import { ROLE_LABEL, type Role } from './types';

export const STAFF_LOGIN_DOMAIN = 'staff.xelorsoft.com';

/** What the sign-in form sends to Supabase: an email as typed, or a username mapped to its login address. */
export function loginEmail(input: string): string {
  const v = input.trim();
  return v.includes('@') ? v : `${v.toLowerCase()}@${STAFF_LOGIN_DOMAIN}`;
}

export const isUsername = (input: string) => !!input.trim() && !input.includes('@');

export type Credentials = { username: string; password: string; name: string; phone: string | null; role: Role };
export type CredentialLang = 'en' | 'ml';

export function loginUrl(username: string): string {
  const base = new URL(import.meta.env.BASE_URL ?? '/', window.location.origin);
  const url = new URL('login', base);
  url.searchParams.set('u', username);
  return url.toString();
}

/** The WhatsApp message with the login details, in English or Malayalam. */
export function credentialsText(lang: CredentialLang, c: Credentials, gym: string, url: string, reset = false): string {
  const first = c.name.split(' ')[0];
  const role = ROLE_LABEL[c.role];
  if (lang === 'ml') {
    const head = reset
      ? `ഹായ് ${first}, ${gym}-ന്റെ XS Gym ലോഗിൻ പാസ്‌വേഡ് മാറ്റി. പുതിയ വിവരങ്ങൾ:`
      : `ഹായ് ${first}, ${gym}-ന്റെ XS Gym-ൽ നിങ്ങളെ ${role} ആയി ചേർത്തു. ലോഗിൻ വിവരങ്ങൾ:`;
    return `${head}\n\nസൈൻ ഇൻ: ${url}\nUsername: ${c.username}\nPassword: ${c.password}\n\nഈ പാസ്‌വേഡ് ആരുമായും പങ്കിടരുത്.`;
  }
  const head = reset
    ? `Hi ${first}, your XS Gym password for ${gym} has been reset. Your new login:`
    : `Hi ${first}, you've been added to ${gym} on XS Gym as ${role}. Your login:`;
  return `${head}\n\nSign in: ${url}\nUsername: ${c.username}\nPassword: ${c.password}\n\nPlease don't share this password.`;
}

/** Plain-language summary of what each role can do (matches role_permissions). */
export const ROLE_ACCESS: Record<Exclude<Role, 'owner'>, string> = {
  reception: 'Members, check-in, selling plans and taking payments. No expenses, analytics or staff.',
  trainer: 'View members and check them in. No payments or money.',
  manager: 'Day-to-day running, money included. No staff, gym settings or billing.',
};
