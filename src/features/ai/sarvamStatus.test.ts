import { afterEach, describe, expect, it, vi } from 'vitest';
import { sarvamReadiness } from './sarvamStatus';

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });
describe('XS AI truthfully reports Sarvam production readiness', () => {
  it('returns not ready if deployed but no key or enablement', async () => {
    vi.stubEnv('VITE_SUPABASE_URL','https://fake.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','public-test-key');
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({
      ready:false, enabled:false, key_configured:false, model:'saaras:v4',
    }),{status:200}));
    expect(await sarvamReadiness()).toEqual({ready:false,enabled:false,key_configured:false});
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url,init] = fetcher.mock.calls[0];
    expect(url).toContain('/functions/v1/xs-ai-sarvam');
    expect((init as RequestInit)?.cache).toBe('no-store');
  });
  it('returns true only for all flags explicitly true', async () => {
    vi.stubEnv('VITE_SUPABASE_URL','https://fake.supabase.co');
    vi.spyOn(globalThis,'fetch').mockResolvedValue(new Response(JSON.stringify({
      ready:true,enabled:true,key_configured:true,
    }),{status:200}));
    expect(await sarvamReadiness()).toEqual({ready:true,enabled:true,key_configured:true});
  });
  it('never claims readiness on gateway errors or network failures', async () => {
    vi.stubEnv('VITE_SUPABASE_URL','https://fake.supabase.co');
    const fetcher=vi.spyOn(globalThis,'fetch').mockResolvedValueOnce(new Response('Forbidden',{status:403}))
      .mockRejectedValueOnce(new Error('offline'));
    const failed = {ready:false,enabled:false,key_configured:false};
    expect(await sarvamReadiness()).toEqual(failed);
    expect(await sarvamReadiness()).toEqual(failed);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
