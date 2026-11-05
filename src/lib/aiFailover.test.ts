import { describe, expect, it, vi } from 'vitest';
import { requestLlmWithFailover, type LlmProvider } from '../../supabase/functions/xs-ai/agent';

const providers: LlmProvider[] = [
  { name: 'NVIDIA NIM', group: 'nvidia', apiKey: 'test-nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'openai/gpt-oss-20b' },
  { name: 'xAI Grok', group: 'xai', apiKey: 'test-xai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.3' },
];
const convo = [{ role: 'system', content: 'You are a gym assistant.' }, { role: 'user', content: 'Who has dues?' }];
const tools = [{ type: 'function', function: { name: 'get_overview', description: 'Get stats', parameters: { type: 'object', properties: {} } } }];
const ok = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('XS AI inference failover', () => {
  it('tries another NVIDIA model on 410 before Grok', async () => {
    const backup = { ...providers[0], name: 'NVIDIA NIM backup', model: 'nvidia/nemotron-3.5-lightning-30b-a3b' };
    let tries = 0;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => ++tries === 1 ? new Response('gone', { status: 410 }) : ok({ role: 'assistant', content: 'Success.' }));
    const out = await requestLlmWithFailover([providers[0], backup, providers[1]], convo, tools, fetcher as typeof fetch);
    expect(out.content).toBe('Success.');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).model).toBe(backup.model);
  });

  it('skips NVIDIA sibling models for a 403 key permission error', async () => {
    const backup = { ...providers[0], name: 'NVIDIA backup', model: 'z-ai/glm-5.3-flash' };
    const fetcher = vi.fn(async (url: RequestInfo | URL) => String(url).includes('nvidia.com')
      ? new Response('forbidden', { status: 403 }) : ok({ role: 'assistant', content: 'Grok responded.' }));
    const out = await requestLlmWithFailover([providers[0], backup, providers[1]], convo, tools, fetcher as typeof fetch);
    expect(out.content).toBe('Grok responded.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('tries Grok after NVIDIA returns 403, without changing conversation or tools', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      ++attempts === 1 ? new Response('denied', { status: 403 }) : ok({ role: 'assistant', content: 'Two members have dues.' }));
    const result = await requestLlmWithFailover(providers, convo, tools, fetcher as typeof fetch);
    expect(result.content).toBe('Two members have dues.');
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(String(fetcher.mock.calls[0][0])).toContain('integrate.api.nvidia.com');
    expect(String(fetcher.mock.calls[1][0])).toContain('api.x.ai');
    for (const [index, call] of fetcher.mock.calls.entries()) {
      const body = JSON.parse(String(call[1]?.body));
      expect(body.messages).toEqual(convo);
      expect(body.tools).toEqual(tools);
      expect(call[1]?.headers).toMatchObject({ authorization: `Bearer ${providers[index].apiKey}` });
    }
  });

  it('switches on 429 and accepts an assistant tool call', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async () => ++attempts === 1
      ? new Response('rate limited', { status: 429 })
      : ok({ role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_overview', arguments: '{}' } }] }));
    const result = await requestLlmWithFailover(providers, convo, tools, fetcher as typeof fetch);
    expect(Array.isArray(result.tool_calls)).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('switches after a malformed successful model response', async () => {
    let attempts = 0;
    const fetcher = vi.fn(async () => ++attempts === 1
      ? ok({ role: 'assistant', content: '', tool_calls: [{ id: 'broken' }] })
      : ok({ role: 'assistant', content: 'Ready.' }));
    expect((await requestLlmWithFailover(providers, convo, tools, fetcher as typeof fetch)).content).toBe('Ready.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('passes already executed tool results to the next provider', async () => {
    const prior = { role: 'tool', tool_call_id: 'c1', content: '<gym-data untrusted="true">{"ok":true}</gym-data>' };
    const history = [...convo, { role: 'assistant', content: '', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'check_in', arguments: '{}' } }] }, prior];
    let attempts = 0;
    const fetcher = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
      ++attempts === 1 ? new Response('', { status: 503 }) : ok({ role: 'assistant', content: 'Checked in.' }));
    const result = await requestLlmWithFailover(providers, history, tools, fetcher as typeof fetch);
    expect(result.content).toBe('Checked in.');
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body)).messages).toContainEqual(prior);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('gives the user a plain message and logs the provider chain for the owner', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async () => new Response('forbidden', { status: 403 }));
    const err = await requestLlmWithFailover(providers, convo, tools, fetcher as typeof fetch).catch((e) => e);
    expect(err.message).toMatch(/can't reach its AI service/);
    expect(err.message).not.toMatch(/test-nvidia|test-xai|403/);
    expect(String(log.mock.calls[0][0])).toMatch(/NVIDIA NIM \(403.*xAI Grok \(403/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(requestLlmWithFailover([], convo, tools, fetcher as typeof fetch)).rejects.toThrow(/not set up/);
    log.mockRestore();
  });

  // Never-answering endpoint: resolves only when aborted.
  const hang = (init?: RequestInit) => new Promise<Response>((_, reject) =>
    init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));

  it('starts a backup from another provider when the first is slow, and takes the first answer', async () => {
    const slowSibling = { ...providers[0], name: 'NVIDIA sibling', model: 'other' };
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes('nvidia.com') ? hang(init) : ok({ role: 'assistant', content: 'Grok was faster.' }));
    const t = Date.now();
    const out = await requestLlmWithFailover([providers[0], slowSibling, providers[1]], convo, tools, fetcher as typeof fetch, { hedgeMs: 50, perMs: 2_000, totalMs: 3_000 });
    expect(out.content).toBe('Grok was faster.');
    expect(Date.now() - t).toBeLessThan(1_000);
    // The hedge skipped NVIDIA's sibling model (same endpoint) and went to Grok.
    expect(fetcher.mock.calls.map((c) => String(c[0]))).toEqual([expect.stringContaining('nvidia.com'), expect.stringContaining('x.ai')]);
  });

  it('after a timeout skips sibling models of the same provider', async () => {
    const sibling = { ...providers[0], name: 'NVIDIA sibling', model: 'other' };
    const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) =>
      String(url).includes('nvidia.com') ? hang(init) : ok({ role: 'assistant', content: 'Fallback.' }));
    const out = await requestLlmWithFailover([providers[0], sibling, providers[1]], convo, tools, fetcher as typeof fetch, { hedgeMs: 10_000, perMs: 100, totalMs: 3_000 });
    expect(out.content).toBe('Fallback.');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('never waits past the overall time limit', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const fetcher = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => hang(init));
    const t = Date.now();
    await expect(requestLlmWithFailover(providers, convo, tools, fetcher as typeof fetch, { hedgeMs: 50, perMs: 5_000, totalMs: 300 })).rejects.toThrow(/can't reach/);
    expect(Date.now() - t).toBeLessThan(1_000);
  });
});
