# XS Gym — AI Assistant and Voice (Phases 6–7)

Not started until core operations pass their gate (blueprint §17 step 6). This
fixes the boundaries now so earlier phases are built to support them.

## 1. What the AI may do

Answer questions and perform actions **only through typed tools** that call the
same command functions the UI uses, as the signed-in user. The model never gets
database credentials, SQL access or the service-role key. Money, dates and counts
always come from tool results, never from the model.

Order of delivery: read-only reports → draft preparation → confirmed writes.

## 2. Confirm-then-execute

Every write tool has two steps:

1. `prepare_*` validates the request server-side and returns a summary plus a
   **confirmation token** bound to user, gym, tool, arguments hash and a short
   expiry.
2. The UI shows a confirmation card (amount, member, dates read back). Only the
   user's tap — not the model — calls `execute` with the token and an idempotency
   key.

If the response fails after execution, the action is never re-run; status is
looked up by idempotency key. Low-confidence transcripts cannot reach step 2.

## 3. Privacy boundary

- Tool results reach the model as **opaque references** (`m_1`, `m_2`) and counts;
  the UI renders names, phones and amounts locally from the same result.
- Names go to the model only for disambiguation ("two members named Rahul"),
  with phone last-4 at most. Restricted notes, health data and full phone numbers
  never go.
- Each provider's current data-use terms (free tiers may allow training on
  prompts) are reviewed before any tenant data is sent. Logged: provider, model,
  tokens, latency, tool name — not prompts by default.

## 4. Gateway (blueprint §9, option C)

One Supabase Edge Function with provider adapters (Gemini → Groq → OpenRouter,
configurable). Retry only on 429/5xx/timeouts with backoff and jitter, respect
`Retry-After`, circuit breaker per provider, per-gym and per-user quotas, schema
validation of every tool call. No parallel fan-out. A fallback model is used only
if it supports the required tools and privacy level. Model IDs, quotas and
tool-calling support are re-verified at implementation time.

## 5. Voice

Push-to-talk only (no always-listening). States: idle, connecting, listening,
processing, speaking, confirming, error — each visible. Transcript editable
before any write. Browser Web Speech API used as the no-cost prototype; Malayalam
(`ml-IN`) support differs by browser, so one managed STT + TTS pipeline is
compared in a proof of concept on Malayalam, English and Manglish samples before
choosing. No raw audio retained. Text input always available.

## 6. Exit criteria

Phase 6: approved queries correct against DB fixtures; unauthorised tools rejected;
injection set (malicious notes, crafted names) causes no unconfirmed write.
Phase 7: blueprint §24 AI and voice checklist complete on target devices.
