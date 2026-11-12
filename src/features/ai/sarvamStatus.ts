/** Public readiness only; never exposes or stores provider credentials. */
export type SarvamReadiness = {
  ready: boolean;
  enabled: boolean;
  key_configured: boolean;
};
export async function sarvamReadiness(): Promise<SarvamReadiness> {
  const url = String(import.meta.env.VITE_SUPABASE_URL).replace(/\/$/, '') + '/functions/v1/xs-ai-sarvam';
  try {
    const response = await fetch(url, {
      headers: { apikey: String(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY) },
      signal: AbortSignal.timeout(6000),
      cache: 'no-store',
    });
    if (!response.ok) return { ready: false, enabled: false, key_configured: false };
    const value = await response.json() as Partial<SarvamReadiness>;
    return { ready: value.ready === true, enabled: value.enabled === true,
      key_configured: value.key_configured === true };
  } catch {
    return { ready: false, enabled: false, key_configured: false };
  }
}
