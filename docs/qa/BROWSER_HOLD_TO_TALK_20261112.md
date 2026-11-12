# XS AI: browser-only Malayalam/English hold-to-talk audit

Date: 2026-11-12 (IST)
Branch: `feature/hold-to-talk-browser-voice-20261112`
Production baseline: `main@a6eabb1` / live Pages revision `e688009e` at investigation start
Scope: XS AI voice **only**; no production data, schema, providers, raw audio or separate speech models.

## User requirement

- Hold the microphone button: browser speech recognition starts immediately.
- While holding: display interim English / Malayalam transcript on the screen.
- Release the finger: stop recognition, collect the last words and send **exactly one** text message.
- Hold again: begin a fresh recognition session.
- No automatic submission on browser silence/onend **before** release.
- No uploading audio to XS Gym/Supabase, no third-party installed ML model.
- Malayalam with browser-provided language `ml-IN`; existing explicit fallback `ml` after browser error.

## Important browser limitation: verified WebKit regression report

[WebKit Bug 321436](https://bugs.webkit.org/show_bug.cgi?id=321436) includes public reproductions on iOS 27.0.1. After one `webkitSpeechRecognition` session is explicitly cut by `stop()` or `abort()`, later recognition instances can become **deaf** (no `onresult`) even after reloading the page. The bug has been reproduced in iOS Safari and installed PWA, including tests with English and Spanish locales. A late-2026 report notes that not using `stop()` / `abort()` may avoid the problem under certain circumstances, but that is incompatible with immediately ending the microphone capture on user release. The issue is external to XS Gym and cannot be reliably repaired by retyping the locale or creating a fresh recognizer.

[MDN Web Speech API](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition): speech recognition is implemented by the browser; supported languages differ, and browser speech can be server-based. Browser-level server recognition is distinct from XS Gym uploading audio files.

[Apple iOS feature availability](https://www.apple.com/in/ios/feature-availability/): Malayalam is offered as a keyboard language, but is not listed under the general iOS Dictation language support list. This does not prove an individual Web Speech backend can never recognize it, but it means English support is insufficient proof of Malayalam support.

## Implementation (feature branch)

1. Microphone event uses **PointerEvent** `pointerdown` → synchronously `SpeechRecognition.start()`; pointer capture and `touch-action: none` protect the release event.
2. `pointerup` → request recognizer `stop()`; the first valid recognized phrase is sent once, when `onend` resolves or after a bounded finalization grace period. Browser `onend` while finger is still down **never sends**.
3. `pointercancel`, sheet closing and document hiding → `abort()` and discard unsent text.
4. Keyboard Space/Enter down/up emulates holding; screen-reader click without pointer uses a toggle fallback.
5. Prevent duplicate sends from synthetic click and duplicate end events.
6. Silence does not send any message. English text, Malayalam text and language-error diagnostics remain available.
7. Existing `ml-IN` and manually selected `ml` locale retry are retained; same native Web Speech API, no standalone model download.
8. No Supabase Edge Function, database migration, customer record or payment touched by this feature branch.

## Isolated test matrix

`tests/ui/live-voice.mjs` exercises real Chromium TouchStart/TouchEnd via Chrome DevTools Protocol (CDP) and desktop mouse down/up. SpeechRecognition is mocked to inject both interim and final transcripts. Tests assert:

- English interim words appear before release; browser end while held does not send.
- English release sends exactly once.
- Malayalam interim characters appear before release; release sends exactly once.
- A second Malayalam hold begins a new recognition instance and sends its own text once.
- Cancelling an interrupted touch with a payment-like phrase sends **zero** commands.
- Short silent touch sends **zero** commands.
- `language-not-supported` exposes exact error with `ml-IN`; manually selected `ml` uses native Web Speech, no app audio upload.
- Service errors and missing browser speech result in text-only fallback.
- Build, typecheck, unit tests and synthetic database test gate the deploy workflow.

**Important:** Chromium TouchStart is **not iOS Safari**, and the recognizer is synthetic. These tests prove gesture/React logic, not real Malayalam microphone transcription or that the iOS 27 WebKit defect is fixed.

## Physical pilot acceptance gate

1. Verify Pages is deployed at the intended commit.
2. On a physical iPhone, test Safari in regular tab and installed PWA separately.
3. Press and hold microphone in English, speak, release, confirm one reply.
4. Repeat in Malayalam using a non-financial phrase; confirm interim text **before** release and single send **after** release.
5. Repeat Malayalam twice within same Safari session. A first-pass/second-fail is consistent with the WebKit regression; do not claim the code repaired the OS.
6. If an error is displayed, capture **only** `Browser error` and `language`, not recordings or customer data.
7. Do not trigger a real payment from uncertain voice input during UAT.

Status: **browser-only UX fix proposed; actual Malayalam language availability on this user's iPhone not provable by CI.**
