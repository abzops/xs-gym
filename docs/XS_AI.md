# XS AI — approval-first gym assistant

XS AI is the Malayalam/English assistant inside XS Gym. It can read everything
in the gym and prepare any change a staff member's role allows. **Nothing
changes until the user taps Approve.** Rebuilt on 14 Nov 2026 (owner request):
the previous browser-speech/hold-to-talk stack was removed.

## How a request flows

```text
user types or taps the mic
  → POST /functions/v1/xs-ai { gym_id, lang, messages[, audio] }
      1. verify the signed-in user (auth/v1/user)                ─┐ audio is sent to
      2. gym, staff role, permissions (RLS, user's own token)     │ Sarvam only after
         + Sarvam speech-to-text in parallel when audio is given ─┘ step 1 succeeds
      3. common questions answered directly (dues, today's collection, greetings)
      4. otherwise one model call with the role's tools
         - read tools run immediately; the model may loop (max 6 turns)
         - change tools run `prepare` only: resolve member/plan by name, validate,
           build a preview → response `pending: [card…]`, no database change
  ← { reply, heard?, pending?, navigate?, changed }

user taps Approve
  → POST /functions/v1/xs-ai { gym_id, approve: [{ id, tool, args }] }
      each card is re-validated and executed with the user's token through the
      command functions (permission checks, audit log). The card id is the
      idempotency key, so a double tap or retry never records a payment twice.
  ← { reply, actions: [{ ok, summary, undo? }] }

user taps Cancel → nothing is sent; the chat notes it for the model.
```

Approving needs no model call, so it is as fast as using the normal screens.
A forged approval can do nothing the same user could not already do through the
app: every write still goes through RLS and `private.require(permission)`.

## Tools

Read (instant): `get_overview`, `find_members`, `get_member`, `list_plans`,
`list_payments`, `report`, `get_analytics`, `list_expenses`, `list_enquiries`,
`list_staff`, `open_screen`.

Change (approval card): `record_payment`, `sell_plan`, `add_member`,
`update_member`, `set_member_status` (archive/restore), `cancel_membership`,
`reverse_payment`, `void_charge`, `record_expense`, `reverse_expense`,
`add_enquiry`, `save_plan`, `update_gym_settings`, `save_staff`.

Tools the role lacks are never offered to the model. At most 6 cards per
request. Risky ones (archive, cancel, reverse, void, remove staff) are shown as
warning cards. Payments, sales, members, expenses, enquiries and archive have
**Undo** after approval.

## Voice

The client records one command with `MediaRecorder` (WebM/Opus on Android and
Chrome, MP4/AAC on iPhone), shows a live level meter, and stops by itself after
~1.3 s of silence (or the user taps send, or holds the mic and releases). The
clip goes to `xs-ai` with the message, is sent to **Sarvam `saaras:v3`**
(`language_code` ml-IN or en-IN, `mode=transcribe`) and is never stored or
logged. The heard text appears as the user's message. Member names are stored in
English letters; the model is told to transliterate Malayalam names
(രാഹുൽ → Rahul), and the member lookup tells it to retry when it does not.

## Models (Supabase Edge Function secrets)

| Secret | Used for | Notes |
|---|---|---|
| `SARVAM_API_KEY` | speech-to-text and chat (`sarvam-105b`, then v2 models) | required for voice; legacy names `SARVAM_AI`, `Sarvam AI` also read |
| `GROQ_API_KEY` | chat, tried first | fastest; free tier at console.groq.com |
| `GEMINI_API_KEY` | chat | free key at aistudio.google.com |
| `NVIDIA_API_KEY`, `XAI_API_KEY` | chat fallbacks | on 13 Nov the xAI key returned 403 and NVIDIA timed out |

Providers are tried in that order with hedging: if one has not answered in
2.5 s the next starts and the first answer wins. `GET /functions/v1/xs-ai`
lists configured providers (names only).

## Files

- `supabase/functions/xs-ai/agent.ts` — tools, prepare/approve, provider failover
- `supabase/functions/xs-ai/index.ts` — HTTP entry, provider list, Sarvam STT
- `src/features/ai/XsAi.tsx`, `ai.css` — chat, approval cards, mic
- `src/features/ai/recorder.ts` — microphone capture and silence detection
- Tests: `src/lib/xsAiApproval.test.ts` (unit), `tests/ai/agent.check.mjs`
  (real schema), `tests/ai/http.check.mjs`, `tests/ui/xs-ai.mjs` (browser)
