# XS AI — text-only voice input

XS AI is the English/Malayalam gym assistant inside XS Gym. It can answer questions,
perform permission-checked actions, and optionally speak responses on devices that
provide a suitable synthetic voice.

## Voice: one tap, words appear while speaking

- **Live input:** The client calls the browser's `SpeechRecognition` /
  `webkitSpeechRecognition` with `interimResults = true`. English is `en-IN`;
  Malayalam is `ml-IN`. As the recognition service produces interim words,
  the same words appear immediately in the message input field.
- **Automatic send:** When the recognizer ends, the app submits **only the
  recognized text**, exactly once. Manual Stop also completes recognition.
- **No WAV/audio uploads:** The client no longer records audio, encodes WAV,
  or calls a transcription API. Obsolete `recorder.ts` and server `stt.ts`
  have been deleted. The Supabase `xs-ai` function rejects legacy audio
  requests with **HTTP 410**, even when an older PWA bundle submits them.
  The API accepts text-based conversations only.
- **When unsupported:** If the browser or installed iPhone app lacks working
  live recognition, XS AI offers an in-app **Use keyboard instead** action,
  focusing the message input. The user can tap their phone keyboard's own
  microphone to dictate in Malayalam or English, then send the text.
  Web applications cannot programmatically start iOS keyboard dictation.
- **Important privacy boundary:** Although XS Gym itself uploads no audio, a
  browser/platform's built-in Web Speech recognition may send audio to its own
  speech service. It is not guaranteed to be offline or device-only. The
  app never has raw audio bytes and cannot control the browser vendor's
  recognition processing.

**Do not reintroduce an automatic recorder fallback.** If live browser speech
fails, disclose that and offer keyboard dictation without uploading audio.

## AI and backend

| Part | Implementation |
|---|---|
| Live recognition | Browser SpeechRecognition; words appear as interim text |
| Voice replies | Browser speechSynthesis where a suitable voice is installed |
| AI reasoning | Supabase Edge Function `xs-ai`, with Groq / Gemini / NVIDIA / Grok model failover |
| Database | Supabase requests as the **signed-in user**, governed by RLS and command permissions |
| Audio API | Disabled; `transcribe` and raw `audio` requests return HTTP 410 |

Supabase secrets (`GROQ_API_KEY`, `GEMINI_API_KEY`, `NVIDIA_API_KEY`,
`XAI_API_KEY` / `Grok`) are used for **text AI inference only**. Speech
input needs no special XS AI server key. A model provider may still receive
the recognized text and relevant gym records needed to process the request.

## Operations

The assistant can read overview, members, plans, payments, expenses, Analytics
and Enquiries, and can carry out permission-checked member, billing, enquiry
and navigation actions. Successful reversible changes show an Undo action.
The exact "Who has dues?" question uses an authorized direct database read.

A command such as “Rahul paid 1500 by UPI” is recognized as text, then sent
to the AI along with the signed-in gym context; no browser audio recording
is submitted. Backend operations retain their original validation,
permission checks, and idempotency safeguards.

## QA

- `tests/ui/live-voice.mjs`: simulated installed iPhone, phone browser and
  desktop; English/Malayalam interim text, automatic single send, and the
  absence of audio recording/uploads.
- The same test covers recognition-service failures, unsupported live speech,
  keyboard focus and text-only requests.
- GitHub Action `.github/workflows/voice-ui.yml` runs the browser tests.
- `tests/ai/agent.check.mjs` covers real-schema operations and permissions,
  while the application build and PostgreSQL tests run in the release pipeline.

These tests simulate Web Speech support. **A real installed-iPhone test remains
necessary**, because Apple and individual browsers decide whether live
SpeechRecognition works. A browser that lacks recognition cannot be made to
provide instant interim transcription by JavaScript alone.

## Release safety

Production builds deploy to GitHub Pages from `main`. Edge Function `xs-ai`
must also be deployed without the deleted audio module to reject stale-client
audio uploads. No changes to gyms, memberships, payments, or other database
schema are needed for this voice-only release.
