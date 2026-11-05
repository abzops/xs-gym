# XS AI

Voice and text assistant inside XS Gym. Speaks and understands **English and Malayalam**,
reads the gym's data and makes changes for the signed-in user.

## How it works

| Part | Where | Notes |
|---|---|---|
| Listening and speaking | Browser (Web Speech API) | Free. Chrome, Edge, Android and iOS Safari 14.5+ support voice; Firefox users type. Malayalam speech output needs a Malayalam voice on the device; otherwise replies are shown as text. |
| Thinking | Supabase Edge Function `xs-ai` | Any free OpenAI-compatible LLM. Default: Gemini (Google AI Studio free tier). |
| Data | Supabase, **as the signed-in user** | Every query and change uses the user's own access token, so row-level security and the command functions' permission checks apply exactly as in the app. The service role key is never used. |

Code: `supabase/functions/xs-ai/agent.ts` (agent, tools, limits), `index.ts` (HTTP wrapper),
`src/features/ai/` (panel, voice).

## Setup (owner)

1. Get a free key at Google AI Studio (aistudio.google.com → Get API key).
2. Supabase Dashboard → project `xs-gym` → **Edge Functions → Secrets** → add `LLM_API_KEY` with the key.
3. Optional: `LLM_MODEL` to pin a model (otherwise the newest Gemini Flash the key can use is picked),
   `LLM_BASE_URL` to use another provider, e.g. Groq `https://api.groq.com/openai/v1` or
   OpenRouter `https://openrouter.ai/api/v1`.

Until the key is set, XS AI replies "XS AI is not set up yet".

## What it can do

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
- Privacy: requests and the data needed to answer them (names, phone numbers, amounts) are sent to the
  LLM provider. Google's free tier may use prompts to improve its products; use a paid tier or another
  provider if that is not acceptable for your members' data.

## Tests

`tests/ai/agent.check.mjs` runs the agent against the local real-schema stack with a scripted model
(payments in paise, undo, role tool filtering, cross-gym refusal, limits, validation, untrusted data,
Malayalam). `tests/ui/ai.mjs` checks the panel with a simulated microphone and speaker on phone and laptop.
Both run in `tests/e2e/run.sh`.
