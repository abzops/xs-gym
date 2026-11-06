# XS AI — live text-only speech

XS AI is the English/Malayalam assistant in XS Gym. This document describes
the restored **text-only** voice-input flow.

## Voice input (current behavior)

1. The user taps the microphone orb while in English or Malayalam mode.
2. The browser's Web Speech recognition engine starts with `en-IN` or `ml-IN`,
   `interimResults = true`. Partial words update the message field immediately.
3. When recognition ends (silence or tapping Stop), the complete transcript is
   submitted **once**, as a regular text message, to the authenticated
   `xs-ai` Supabase Edge Function.
4. The assistant uses the signed-in gym user's permissions to read information
   and perform authorized commands; replies are displayed as text and can be
   spoken by the browser when a suitable voice is installed.

**The XS Gym app does not record WAV files, use `getUserMedia` or
`MediaRecorder`, or upload raw audio to Supabase.** The old recorder file and
the server-side speech transcription endpoint have been deleted. Legacy
`transcribe` or `audio` requests to the server return **HTTP 400**, rather
than invoking any speech API.

Important privacy distinction: the *browser's own* Web Speech recognition
implementation may perform recognition using a browser-vendor service.
XS Gym cannot guarantee that the browser recognizes speech completely on
the device. However, the XS Gym frontend sends **only the resulting text**
to its own Supabase backend, never microphone recordings.

The recognition engine is browser-dependent. Its presence and Malayalam
interim-result quality can differ between iOS Safari, iOS Chrome, Android,
installed iPhone web apps and desktop browsers. If Web Speech is not supported
or is blocked, there is **no automatic cloud-audio fallback**. XS AI instead
offers the message field and the operating-system keyboard microphone.
Apple's keyboard dictation is managed by iOS, not by XS Gym. No website can
force a permanently denied system microphone prompt to reappear.

## Architecture

| Component | Technology | Data transmitted to XS AI |
|---|---|---|
| Live listening | Browser `SpeechRecognition` / `webkitSpeechRecognition` | Only completed transcript text |
| Interim display | React-controlled message field | None |
| Completed command | `POST /functions/v1/xs-ai` with `gym_id`, `lang`, and text `messages` | JSON text |
| Replies | Edge Function text response; optional browser `speechSynthesis` | No speech recordings |
| Gym data | Supabase under caller JWT, RLS and command-specific permissions | Authorized application data |

The endpoint also supports `GET` to list configured **reply-model** providers
without exposing keys. The optional model keys (`GROQ_API_KEY`,
`GEMINI_API_KEY`, `NVIDIA_API_KEY`, `XAI_API_KEY` or `Grok`) are used
for AI **text reasoning**, not speech-to-text. Never put these keys into
frontend JavaScript.

Model inference uses fast provider failover in
`supabase/functions/xs-ai/agent.ts`; a failed model attempt does not replay
a completed database command. XS AI answers the exact “Who has dues?”
question directly from authorized gym data when possible.

## Tests and verification

- `src/features/ai/voice.test.ts` tests Malayalam/English live recognition,
  interim transcription, end-of-speech, browser error handling, and that
  `getUserMedia` is never invoked by XS Gym.
- `tests/ui/live-voice.mjs` uses a real Chromium browser rendering XS Gym
  with simulated Web Speech recognition, mocked authentication and gym data,
  and asserts that **no audio/transcribe payloads** reach Supabase. It tests
  English, Malayalam, installed-iPhone emulation, browser errors and
  automatic one-time text submission.
- `.github/workflows/voice-ui.yml` runs the local browser tests and uploads
  actual browser screenshots and test logs as GitHub Actions artifacts.
- `.github/workflows/live-voice-proof.yml` runs the same assertions against
  the **published GitHub Pages URL** after a successful main release and
  uploads browser screenshots as proof of what was actually deployed.

The browser captures are **not generated illustrations**. They depict the
real application rendering, but recognition events and gym API replies are
simulated to prevent using real microphone recordings or personal data.
A real iPhone voice-permission and recognition test is still necessary to
verify which speech APIs that specific browser exposes.

## Other capabilities and safety

XS AI can read members and dues, summarize Analytics, record authorized
payments/renewals, manage enquiries and navigate the gym app. Every data
command follows gym permissions. Action cards show Undo where supported;
repeated taps are guarded. Gym transactions and RLS are unchanged by the
text-only voice release.
