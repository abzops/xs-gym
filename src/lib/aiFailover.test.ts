import { describe, expect, it, vi } from 'vitest';
import { requestLlmWithFailover, type LlmProvider } from '../../supabase/functions/xs-ai/agent';

const providers: LlmProvider[] = [
  { name: 'NVIDIA NIM', apiKey: 'test-nvidia', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'mistralai/mistral-nemotron' },
  { name: 'xAI Grok', apiKey: 'test-xai', baseUrl: 'https://api.x.ai/v1', model: 'grok-4.3' },
];
const convo = [{ role: 'system', content: 'You are a gym assistant.' }, { role: 'user', content: 'Who has dues?' }];
const tools = [{ type: 'function', function: { name: 'get_overview', description: 'Get stats', parameters: { type: 'object', properties: {} } } }];
const ok = (message: unknown) => new Response(JSON.stringify({ choices: [{ message }] }), { status: 200, headers: { 'content-type': 'application/json' } });

describe('XS AI inference failover', () => {
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

  it('reports exhausted providers without revealing API keys', async () => {
    const fetcher = vi.fn(async () => new Response('forbidden', { status: 403 }));
    await expect(requestLlmWithFailover(providers, convo, tools, fetcher as typeof fetch))
      .rejects.toThrow(/NVIDIA NIM \(403\).*xAI Grok \(403\)/);
    expect(fetcher).toHaveBeenCalledTimes(2);
    await expect(requestLlmWithFailover([], convo, tools, fetcher as typeof fetch)).rejects.toThrow('NVIDIA_API_KEY');
  });
});
