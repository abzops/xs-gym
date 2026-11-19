import { describe, expect, it } from 'vitest';
import { credentialsText, isUsername, loginEmail } from './staffLogin';

describe('staff login', () => {
  it('maps a username to its login address and leaves emails alone', () => {
    expect(loginEmail(' Ravi.Chaos ')).toBe('ravi.chaos@staff.xelorsoft.com');
    expect(loginEmail(' owner@gmail.com ')).toBe('owner@gmail.com');
    expect(isUsername('ravi.chaos')).toBe(true);
    expect(isUsername('owner@gmail.com')).toBe(false);
    expect(isUsername('  ')).toBe(false);
  });
  const c = { username: 'ravi.chaos', password: 'k7Qm-x3Fp', name: 'Ravi Kumar', phone: '+919876522222', role: 'reception' as const };
  it('writes the WhatsApp message with everything needed to sign in', () => {
    const en = credentialsText('en', c, 'CHAOS COMBAT', 'https://gym.xelorsoft.com/login?u=ravi.chaos');
    expect(en).toContain('Hi Ravi,');
    expect(en).toContain('as Reception');
    expect(en).toContain('Username: ravi.chaos');
    expect(en).toContain('Password: k7Qm-x3Fp');
    expect(en).toContain('https://gym.xelorsoft.com/login?u=ravi.chaos');
    const ml = credentialsText('ml', c, 'CHAOS COMBAT', 'https://gym.xelorsoft.com/login', true);
    expect(ml).toContain('പാസ്‌വേഡ് മാറ്റി');
    expect(ml).toContain('Password: k7Qm-x3Fp');
  });
});
