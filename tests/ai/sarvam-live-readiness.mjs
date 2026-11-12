// NON-MOCKED production service gate. Reports readiness only, no audio,
// customer data, API secrets or user sessions. It cannot prove accuracy.
const url = process.env.XS_PRODUCTION_SUPABASE_URL;
const publishable = process.env.XS_PRODUCTION_PUBLISHABLE_KEY;
if (!url || !publishable) throw Error('Missing public project details');
const endpoint = url.replace(/\/$/, '') + '/functions/v1/xs-ai-sarvam';
const response = await fetch(endpoint, {
  headers: { apikey: publishable, origin: 'https://abzops.github.io' },
  signal: AbortSignal.timeout(12000),
});
let result = {};
try { result = await response.json(); } catch { /* may be old 426 relay */ }
const state = {
  real_production_http: response.status,
  server_key_present: result.key_configured === true,
  server_enabled: result.enabled === true,
  speech_ready: result.ready === true,
  declared_language: result.language || null,
  model: result.model || null,
  test: 'Production availability only, not live audio transcription',
};
console.log('XS AI REAL LIVE MALAYALAM SERVICE CHECK:', JSON.stringify(state));
if (process.env.XS_REQUIRE_MALAYALAM_READY === 'true' &&
    (!response.ok || !state.speech_ready)) {
  console.error('Production Malayalam is NOT ready. Do not claim live recognition works.');
  process.exitCode = 1;
}
