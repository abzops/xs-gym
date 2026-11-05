# XS AI

Voice and text assistant inside XS Gym. Speaks and understands **English and Malayalam**,
reads the gym's data and makes changes for the signed-in user.

## How it works

| Part | Where | Notes |
|---|---|---|
| Listening | The app records the microphone itself (Web Audio), detects the end of speech, sends 16 kHz WAV to the `xs-ai` function for **speech-to-text** | Works in installed iPhone home-screen apps, where the browser's own speech recognition is blocked. Speech-to-text: Groq Whisper (`GROQ_API_KEY`), xAI Grok STT (`XAI_API_KEY` / `Grok`), then Gemini (`GEMINI_API_KEY` / `LLM_API_KEY`). Without a speech key, browsers that have built-in recognition (Chrome, Android, Safari in a tab) use it; the installed iPhone app explains in-app that voice is not set up and offers the keyboard. |
| Speaking | Browser speech synthesis | Free. Malayalam needs a Malayalam voice on the device; otherwise replies are shown as text. |
| Thinking | Supabase Edge Function `xs-ai` | Providers fastest first: Groq → Gemini → NVIDIA NIM → xAI Grok. **Hedged**: if one has not answered in 5 s a different provider starts in parallel and the first answer wins; a timeout or key error skips that provider's other models; the user never waits more than 30 s. |
| Data | Supabase, **as the signed-in user** | Every query and change uses the user's own access token, so row-level security and the command functions' permission checks apply exactly as in the app. The service role key is never used. |

Speed: tools take members and plans **by name** ("Rahul", "XS-0012", phone digits, "Monthly"),
so a command like "Rahul paid 1500 by UPI" needs **one** model call; when every change in a step
succeeds the confirmation is written directly, without another model call.

Code: `supabase/functions/xs-ai/agent.ts` (agent, tools, failover), `stt.ts` (speech-to-text),
`index.ts` (HTTP), `src/features/ai/` (panel, recorder, voice).

## Setup (owner)

Supabase Dashboard → project `xs-gym` → **Edge Functions → Secrets**. Keys stay server-side only.

| Secret | Gives | Notes |
|---|---|---|
| `GROQ_API_KEY` | **Voice (speech-to-text) and the fastest replies** | Free at console.groq.com. Recommended first key. `GROQ_MODEL` optional. |
| `GEMINI_API_KEY` (or `LLM_API_KEY`) | Voice fallback and replies | Google AI Studio key. `GEMINI_MODEL` optional. If `LLM_BASE_URL` is set, `LLM_API_KEY` is used for that OpenAI-compatible service instead. |
| `NVIDIA_API_KEY` | Replies | Free endpoints were timing out (25 s) in testing; kept as a fallback. |
| `XAI_API_KEY` / `GROK_API_KEY` / `Grok` | Replies **and cloud speech-to-text** | Uses xAI's documented `/v1/stt` endpoint with `grok-voice-transcribe-2.0`. Chat returned 403 earlier (check API permissions, credits). Malayalam is **not explicitly included in xAI's formatting-language list**; automatic detection is attempted, not guaranteed. `XAI_MODEL` optionally selects the chat model. |

`GET /functions/v1/xs-ai` reports which providers and whether speech-to-text are configured,
without exposing keys. Provider failures are written to the function log for the owner;
users only see a plain message.

## Microphone

One tap on the orb starts local recording in a home-screen iPhone app; the phone
can show its own Allow microphone dialog. A short WAV is uploaded only to the
authenticated Supabase Edge Function, and transcription requires **active gym
staff membership**, not just an arbitrary signed-in account. The voice API key
never reaches the browser. If cloud transcription is rejected (e.g. xAI 403) an
in-app explanation provides a retry and keyboard fallback.

A permanently denied iOS microphone permission cannot be overridden by any
website. The keyboard (including its dictation key) remains usable. This is a
real recorded-audio path, not a simulated Web Speech permission dialog.

For reliable Malayalam recognition, prefer Groq Whisper or a separate Gemini
key if available. xAI's speech model may transcribe Malayalam using automatic
language detection but its published formatting-language table does not list
Malayalam. Do not promise Malayalam transcription accuracy without field testing.

## What it can do

The exact question **Who has dues?** reads the current gym's outstanding balances
via the signed-in user's permission checks, without requiring an AI provider.
The response lists up to 25 active members with dues.

Read: today's overview, member search and details, plans, payments by day, totals for a date range, expenses by month,
analytics by month (revenue, profit, members joined/lost, renewals, plans, methods, dues by age, enquiries).
Change: record payment, sell/renew plan (with discount reason and admission fee), add member, record expense,
save an enquiry (lead), reverse payment, archive/restore member, open any screen including Analytics and Enquiries.
(Check-in was removed from the web app.)

Each role only gets the tools its permissions allow (reception has no reversals or financial reports).

## Safety

- **No confirmation step** (owner's choice). Instead every change appears as a card with **Undo**,
  payments are marked "Recorded by XS AI", and every change is in the audit log under the user.
- At most **6 changes per request**; requests to change many members at once are refused.
- Amounts are validated (positive, ≤ ₹1 crore, 2 decimals); methods and dates are checked; future expenses refused.
- Database contents are passed to the model labelled as untrusted data, so a member name or note
  cannot instruct the assistant.
- Privacy: requests and gym data necessary for answers may be sent to more than one configured AI
  provider when failover occurs. Verify providers' data-use terms before using real member data.

## Tests

`tests/ai/agent.check.mjs` runs the agent against the local real-schema stack with a scripted model
(payments in paise, undo, role tool filtering, cross-gym refusal, limits, validation, untrusted data,
Malayalam). `tests/ui/ai.mjs` checks the panel with a simulated microphone and speaker on phone and laptop.
Both run in `tests/e2e/run.sh`. `src/lib/sttFallback.test.ts` also checks
xAI STT form upload, authentication headers, Malayalam auto-detection,
provider failover and malformed input locally with mocked providers.
