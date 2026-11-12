// Synthetic safety-contract checks for the Sarvam proof of concept.
// Does NOT connect to production or make paid Sarvam calls.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const read = (path) => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const relay = read('supabase/functions/xs-ai-sarvam/index.ts');
const ui = read('src/features/ai/XsAi.tsx');
const pref = read('src/features/ai/sttPreferences.ts');
const capture = read('src/features/ai/sarvamRealtime.ts');
assert.match(relay, /env\('SARVAM_STT_ENABLED'\) !== 'true'/);
assert.match(relay, /env\('SARVAM_API_KEY'\)/);
assert.match(relay, /authorizedUser\(token, gymId\)/);
assert.match(relay, /Sec-WebSocket|sec-websocket-protocol/i);
assert.match(relay, /request\.headers\.get\('origin'\)/);
assert.match(relay, /MAX_AUDIO_BYTES/);
assert.doesNotMatch(capture, /api[.]sarvam[.]ai|SARVAM_API_KEY|api-subscription-key/);
assert.match(pref, /return value === 'sarvam' \? 'sarvam' : 'browser'/);
assert.match(ui, /sttInputMode/);
assert.match(ui, /session\.cloud/);
console.log('Sarvam isolated security contract passed (no real voice inference)');
