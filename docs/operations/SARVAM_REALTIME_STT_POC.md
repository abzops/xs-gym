# XS AI — Sarvam realtime Malayalam pilot (ISOLATED)

**Status:** unapproved proof of concept. **No production deployment.** Branch: \`feature/sarvam-realtime-malayalam-poc-20261112\`. See the live XS Gym pilot protection guide before release.

## Why this experiment exists

Apple/browser speech recognition may reject \`ml-IN\` even when English works. Sarvam **Saaras v4 Realtime** supports \`ml-IN\`, \`en-IN\` and true \`transcript.partial\` updates on \`/speech-to-text-realtime/ws\`. Unlike the local Whisper experiment, Sarvam **streams microphone audio to a cloud processor**, so the user's previous browser-only privacy condition cannot be met with this provider. The browser voice remains the default. Cloud voice requires explicit opt-in under Settings.

### Architecture
1. Finger-down triggers \`getUserMedia\` under the user gesture; audio is captured as mono PCM and resampled to 16 kHz.
2. The browser sends PCM chunks to a **separate** Supabase Edge Function over WebSocket. It sends a signed-in Supabase user JWT in the WebSocket **subprotocol**, not in the URL; no vendor API key ever enters browser JS.
3. The server, **disabled by default**, checks origin, Supabase Auth JWT and current active staff for the requested gym via caller's RLS-protected queries. Only then may it establish a WebSocket connection with the server-side \`SARVAM_API_KEY\` header.
4. Sarvam Realtime \`saaras:v4\` uses \`ml-IN\` or \`en-IN\`, \`linear16\`, \`16000\`, \`stream_type=fast\`, \`endpointing=manual\`, \`mode=codemix\`. Partial transcripts appear in the composer.
5. Releasing the button stops microphone tracks immediately. A temporary chat bubble is replaced with the final transcript, which is automatically sent as text. Cloud-transcribed turns carry `cloudVoice=true`; the **AI server exposes only read-only tools** for those turns, so payments, membership sales, changes and deletions require explicit confirmation by typing. Browser-based recognition continues to work without this cloud restriction.
6. Server session limit is 35 seconds, audio limit 25 seconds; errors and cancellation disconnect; no audio files or raw transcripts are persisted by the app. Vendor processing/retention remains governed by Sarvam's terms.

### Secret/setup (after revoking previously shared credential)

In Supabase Edge Function Secrets, set **exact environment variable names**:
- \`SARVAM_API_KEY\`: a newly rotated Sarvam credential, never one pasted in a conversation or repository.
- \`SARVAM_STT_ENABLED\`: \`true\` **only** on an approved staging project for a short, monitored pilot. Omit/false in production.

Set \`[functions.xs-ai-sarvam] verify_jwt = false\` **only for this new WebSocket function**, because browser WebSockets cannot send an Authorization header. The function must validate the user's JWT itself. Do not change the existing \`xs-ai\` function.

### Release blockers
- No real Sarvam calls have been made. Test the account model entitlement, concurrency, quota and region.
- Backend outgoing custom WebSocket headers and secure incoming subprotocol handling must be tested on an **isolated Supabase staging project**.
- Test authentic vs expired JWT, non-staff and cross-gym access; origin spoofing, rate limiting, per-user concurrency, rejection and quota exhaustion.
- Test real Safari and installed PWA microphone gesture, Web Audio sample rate and resampling, dropped connections, immediate finger-up, long press and cancellation.
- Benchmark Malayalam / English / Manglish, proper names, rupee amounts, background noise, partial latency and correction; never use live customer data in test recordings.
- Confirm vendor privacy, data-processing terms and spending cap. No replay of audio, automatic cloud fallback, or storing transcripts.
- Restore-tested production backups and an approved deployment window are required before affecting CHAOS COMBAT.

Official references:
- https://docs.sarvam.ai/api/api-guides-tutorials/speech-to-text/realtime-streaming
- https://supabase.com/docs/guides/functions/websockets
- https://docs.deno.com/api/web/websockets/
