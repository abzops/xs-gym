import { describe, expect, it, vi } from 'vitest';
import { runAgent, type AgentEnv } from '../../supabase/functions/xs-ai/agent';

// A fake Supabase + fake model. Every database write goes through /rpc/<name>,
// so `rpcCalls` shows exactly what would have changed.
const GYM = '22222222-2222-4222-8222-222222222222';
const USER = '11111111-1111-4111-8111-111111111111';
const RAHUL = { id: '33333333-3333-4333-8333-333333333331', full_name: 'Rahul Krishnan', member_no: 'XS-0001', status: 'active', due_paise: 50000, phone: '+919876500011' };
const RAHUL2 = { ...RAHUL, id: '33333333-3333-4333-8333-333333333332', full_name: 'Rahul Menon', member_no: 'XS-0002', due_paise: 0 };
const OWNER = ['members.read', 'members.write', 'payments.read', 'payments.record', 'payments.reverse', 'reports.financial', 'reports.operational'];

function harness(opts: { perms?: string[]; members?: unknown[]; model?: (body: { messages: { role: string; content: string }[] }) => unknown; signedIn?: boolean } = {}) {
  const rpcCalls: { fn: string; args: Record<string, unknown> }[] = [];
  const modelCalls: unknown[] = [];
  const json = (v: unknown, status = 200) => new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });
  const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/auth/v1/user')) return opts.signedIn === false ? json({}, 401) : json({ id: USER });
    if (url.includes('/chat/completions')) {
      const body = JSON.parse(String(init?.body));
      modelCalls.push(body);
      return json({ choices: [{ message: opts.model?.(body) ?? { role: 'assistant', content: 'ok' } }] });
    }
    if (url.includes('/rest/v1/rpc/')) {
      const fn = url.split('/rpc/')[1];
      const args = JSON.parse(String(init?.body));
      rpcCalls.push({ fn, args });
      if (fn === 'record_payment') return json({ id: '44444444-4444-4444-8444-444444444444', amount_paise: args.p_amount_paise, method: args.p_method });
      if (fn === 'dashboard_summary') return json({ financial: { collections_today: 250000, reversals_today: 0, cash_today: 100000, upi_today: 150000 } });
      return json({});
    }
    if (url.includes('/rest/v1/gyms')) return json([{ id: GYM, name: 'Iron Temple', slug: 'iron', timezone: 'Asia/Kolkata', grace_days: 3 }]);
    if (url.includes('/rest/v1/gym_staff')) return json([{ role: 'owner', status: 'active' }]);
    if (url.includes('/rest/v1/role_permissions')) return json((opts.perms ?? OWNER).map((permission) => ({ permission })));
    if (url.includes('/rest/v1/member_overview')) return json(opts.members ?? [RAHUL]);
    return json([]);
  });
  const env: AgentEnv = { supabaseUrl: 'https://db.test', anonKey: 'anon', userToken: 'user-jwt', fetch: fetcher as typeof fetch,
    providers: [{ name: 'Fake', baseUrl: 'https://llm.test/v1', apiKey: 'k', model: 'fake' }], now: () => new Date('2026-11-14T10:00:00Z') };
  return { env, rpcCalls, modelCalls, fetcher };
}
const toolCall = (name: string, args: unknown, id = 'call_1') => ({ role: 'assistant', content: '', tool_calls: [{ id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });

describe('XS AI approval flow', () => {
  it('turns a payment request into an approval card without changing anything', async () => {
    const h = harness({ model: () => toolCall('record_payment', { member: 'Rahul', amount: 1500, method: 'upi' }) });
    const out = await runAgent({ gym_id: GYM, lang: 'en', messages: [{ role: 'user', content: 'Rahul paid 1500 by UPI' }] }, h.env);
    expect(out.pending).toHaveLength(1);
    expect(out.pending![0].tool).toBe('record_payment');
    expect(out.pending![0].lines).toContain('Rahul Krishnan · XS-0001');
    expect(out.pending![0].lines).toContain('₹1,500 · UPI');
    expect(h.rpcCalls.filter((c) => c.fn === 'record_payment')).toHaveLength(0);
    expect(h.modelCalls).toHaveLength(1); // no second model round trip
  });

  it('records the payment only on approve, with the card id as idempotency key', async () => {
    const h = harness({ model: () => toolCall('record_payment', { member: 'Rahul', amount: 1500, method: 'upi' }) });
    const first = await runAgent({ gym_id: GYM, messages: [{ role: 'user', content: 'Rahul paid 1500 by UPI' }] }, h.env);
    const card = first.pending![0];
    const out = await runAgent({ gym_id: GYM, lang: 'en', approve: [{ id: card.id, tool: card.tool, args: card.args }] }, h.env);
    const pay = h.rpcCalls.find((c) => c.fn === 'record_payment')!;
    expect(pay.args).toMatchObject({ p_gym: GYM, p_member: RAHUL.id, p_amount_paise: 150000, p_method: 'upi', p_idempotency_key: card.id });
    expect(out.actions[0]).toMatchObject({ ok: true, tool: 'record_payment' });
    expect(out.actions[0].undo?.rpc).toBe('reverse_payment');
    expect(out.reply).toMatch(/^Done ✓/);
    expect(h.modelCalls).toHaveLength(1); // approval itself never calls the model
  });

  it('refuses an approved action the role is not allowed to do', async () => {
    const h = harness({ perms: ['members.read'] });
    const out = await runAgent({ gym_id: GYM, approve: [{ id: crypto.randomUUID(), tool: 'record_payment', args: { member_id: RAHUL.id, amount_paise: 100, method: 'cash' } }] }, h.env);
    expect(out.actions[0].ok).toBe(false);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('rejects unknown or read-only tools sent as approvals', async () => {
    const h = harness();
    const out = await runAgent({ gym_id: GYM, approve: [{ id: crypto.randomUUID(), tool: 'find_members', args: {} }] }, h.env);
    expect(out.actions[0].ok).toBe(false);
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('asks which member when a name matches two people, and shows no card', async () => {
    let n = 0;
    const h = harness({ members: [RAHUL, RAHUL2], model: (body) => {
      n++;
      if (n === 1) return toolCall('record_payment', { member: 'Rahul', amount: 1000, method: 'cash' });
      expect(body.messages.at(-1)!.content).toContain('more than one member');
      return { role: 'assistant', content: 'Which Rahul: Rahul Krishnan or Rahul Menon?' };
    } });
    const out = await runAgent({ gym_id: GYM, messages: [{ role: 'user', content: 'Rahul paid 1000 cash' }] }, h.env);
    expect(out.pending).toBeUndefined();
    expect(out.reply).toContain('Which Rahul');
    expect(h.rpcCalls).toHaveLength(0);
  });

  it('transcribes voice after sign-in and answers common questions without the model', async () => {
    const h = harness();
    const transcribe = vi.fn(async () => 'ഇന്നത്തെ കളക്ഷൻ');
    const out = await runAgent({ gym_id: GYM, lang: 'ml', messages: [], audio: { data: 'AAAA', mime: 'audio/webm' } }, { ...h.env, transcribe });
    expect(transcribe).toHaveBeenCalledOnce();
    expect(out.heard).toBe('ഇന്നത്തെ കളക്ഷൻ');
    expect(out.reply).toContain('₹2,500');
    expect(h.modelCalls).toHaveLength(0);
  });

  it('never sends audio to speech-to-text for a signed-out caller', async () => {
    const h = harness({ signedIn: false });
    const transcribe = vi.fn(async () => 'hello');
    await expect(runAgent({ gym_id: GYM, messages: [], audio: { data: 'AAAA', mime: 'audio/webm' } }, { ...h.env, transcribe })).rejects.toThrow('not signed in');
    expect(transcribe).not.toHaveBeenCalled();
  });
});
