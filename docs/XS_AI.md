# XS AI

Voice and text assistant inside XS Gym. Speaks and understands **English and Malayalam**,
reads the gym's data and makes changes for the signed-in user.

## How it works

| Part | Where | Notes |
|---|---|---|
| Listening and speaking | Browser (Web Speech API) | Free. Chrome, Edge, Android and iOS Safari 14.5+ support voice; Firefox users type. Malayalam speech output needs a Malayalam voice on the device; otherwise replies are shown as text. |
| Thinking | Supabase Edge Function `xs-ai` | Inference failover: NVIDIA NIM → xAI Grok → optional OpenAI-compatible provider (Gemini, etc.). |
| Data | Supabase, **as the signed-in user** | Every query and change uses the user's own access token, so row-level security and the command functions' permission checks apply exactly as in the app. The service role key is never used. |

Code: `supabase/functions/xs-ai/agent.ts` (agent, tools, limits), `index.ts` (HTTP wrapper),
`src/features/ai/` (panel, voice).

## Setup (owner)

1. Supabase Dashboard → project `xs-gym` → **Edge Functions → Secrets**.
2. Add `NVIDIA_API_KEY` for NVIDIA NIM. Candidates: `openai/gpt-oss-20b`, `nvidia/nemotron-3.5-lightning-30b-a3b`,
   then `z-ai/glm-5.3-flash`; `NVIDIA_MODEL` overrides first choice.
3. Add `XAI_API_KEY` for xAI Grok. The existing secret name `Grok` is also supported
   (as is `GROK_API_KEY`), so no re-entry of the key is needed. Default model:
   `grok-4.3` at `https://api.x.ai/v1`; optional override: `XAI_MODEL`.
4. Optional third fallback: `LLM_API_KEY`, `LLM_BASE_URL` and `LLM_MODEL`.
   The defaults are the Gemini-compatible endpoint and `gemini-2.5-flash`.

Keys must remain **server-side Supabase secrets**, never in GitHub, Vite variables or
the browser. The authenticated `GET /functions/v1/xs-ai` endpoint reports configured
providers/models without exposing credentials.

The function tries the NVIDIA candidates first (410/404 means try another model),
 then Grok and the optional provider. Key-level 401/402/403 or rate-limit 429
 errors skip sibling models on that provider; network/5xx/invalid responses also fail over. **Only the inference call is retried**; completed gym writes are not
replayed. Their results remain in the conversation passed to the next model.
Usage may be charged by multiple providers. Grok API billing is separate
from a Grok web subscription. If every model fails, the UI shows which providers
were tried, without exposing their API keys.

## Microphone permissions in the installed app

XS AI's microphone button opens a short in-app permission explanation on the
first use in a page session. Tapping **Allow microphone** calls
`navigator.mediaDevices.getUserMedia({ audio: true })` so iOS/the browser can
show its native consent prompt. The temporary media tracks are stopped
immediately; XS AI then attempts to start speech recognition.

If permission is denied, the app presents an in-app **Try again** option and a
**Use keyboard instead** fallback (which focuses the message field and allows
iOS keyboard dictation where available). It does not automatically navigate to
browser settings. Users can switch to typing even while a native permission
prompt is unresolved. A previous *permanent* denial cannot be overridden by any
web app; iOS/browser controls whether it will prompt again.

Microphone permission and the Web Speech API's separate recognition service
are not the same thing. Recognition can fail even when the microphone is
allowed, especially in installed iOS Home Screen web apps. That failure has
its own explanation and direct Retry/keyboard fallback; it must never be
mislabelled as a microphone permission denial.

Tests: `src/features/ai/voice.test.ts` validates real permission-request logic
with simulated devices. `tests/ui/ai.mjs` covers phone/laptop light/dark
permission grant, denial, retry, recognition-service errors, and input focus.
A dedicated GitHub Actions workflow (`.github/workflows/voice-ui.yml`) runs
these mocked Chromium UI checks after relevant changes; 64/64 checks passed in
run 42067348450. A final installed iPhone test is still required.

## What it can do

The exact question **Who has dues?** reads the current gym's outstanding balances
via the signed-in user's permission checks, without requiring an AI provider.
The response lists up to 25 active members with dues.

Read: today's overview, member search and details, plans, payments by day, reports for a date range, expenses by month.
Change: check in (with override reason when needed), record payment, sell/renew plan (with discount reason and admission fee),
add member, record expense, reverse payment, remove check-in, archive/restore member, open any screen.

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
Both run in `tests/e2e/run.sh`.
