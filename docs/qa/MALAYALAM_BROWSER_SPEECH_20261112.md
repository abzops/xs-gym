# XS AI — Malayalam Web Speech diagnosis and browser-only repair

**Date:** 12 November 2026, IST  
**Branch:** `fix/browser-malayalam-speech-20261112`  
**Scope:** XS AI browser speech input only; **no model downloads, no audio recorder, no cloud STT integration, no data migrations**.

## What changed and what did not

Historical Git review:
- The original XS AI implementation (2026-11-05, commit `020fbeba1d5d`) already used `window.SpeechRecognition ?? window.webkitSpeechRecognition` with `lang = 'ml-IN'` and `interimResults = true`.
- The production code at `main@9b8da8b` still uses `ml-IN` and the same browser API. The change was **not** a Malayalam-to-English locale regression.
- Prior test `tests/ui/live-voice.mjs` created a fake `SpeechRecognition` and fed synthetic Malayalam strings. Its green results **did not verify recognition on a physical iPhone**.
- The user's screenshot shows a generic service-unavailable dialog. That dialog previously collapsed multiple distinct browser error codes into a single message, making it impossible to diagnose if the language, OS permission, or browser service caused the failure.

Browser-only changes:
1. Read the native `SpeechRecognition` constructor at each microphone tap, not at JS module initialization. Both standard and `webkitSpeechRecognition` remain supported.
2. Continue English **unmodified** using `en-IN`, immediate interim updates and auto-send at onend.
3. Start Malayalam with `ml-IN` as before; surface the exact browser error code and requested locale (including `language-not-supported`, `service-not-allowed`, `network`, and `not-allowed`).
4. For a failed `ml-IN` attempt, provide a second **explicit user-tap** option to try the alternate valid BCP-47 language tag `ml`, still using the same native browser API. No background retry after the user gesture, no model.
5. Keep keyboard text entry usable and label its language `ml-IN`. Do not assume an iPhone supports Malayalam *Dictation* just because it has Malayalam typing.
6. Do not invoke Supabase for speech recognition or transmit recorded microphone audio. Only final recognized text is sent as a user command, as before.

## Verification

- Unit: exact language tags; synchronous Web Speech constructor lookup; interim result; distinct errors with codes.
- Mocked browser: English and Malayalam interim text, one auto-send, proper error display, explicit alternate code retry, no app audio upload, mobile/PWA/desktop.
- GitHub Actions: build/typecheck/lint/unit, synthetic PostgreSQL, browser mocked speech tests.

**Critical limitation:** A fake recognizer cannot prove that an iPhone speech service actually supports Malayalam. Apple lists Malayalam keyboards but not Malayalam iOS Dictation in its currently published language availability. A Web Speech implementation may require vendor/OS language support. **No website can force an unsupported built-in language to become available.** The alternate `ml` tag is an experiment, not a guarantee.

## Physical-device acceptance checklist (required to claim fixed)

1. Open the latest deployed URL directly in iOS Safari, then test the installed Home Screen app separately.
2. Switch XS AI to Malayalam. Tap microphone; say **'ഇന്ന് എത്ര രൂപ കിട്ടി?'**. Verify live Malayalam interim text appears.
3. Let speech stop; verify the user text is submitted exactly once. Do not use real financial commands during testing.
4. Repeat using a mixed sentence with English words. Test silence, permission denial, retry, and a weak network.
5. If an error dialog appears, record the **browser error code + locale** shown (not the actual voice or customer data). Try the alternate `ml` tag once.
6. Test English again and confirm equivalent performance to before.

**If Safari fails for both `ml-IN` and `ml` with a language/service error, the operating system/browser recognition engine is the blocker.** A different recognition provider would then be required, contrary to the browser-only restriction. Do not silently switch to any transcription model or send raw audio elsewhere.

## Sources

- [Apple iOS language feature availability](https://www.apple.com/in/ios/feature-availability/)
- [MDN SpeechRecognition](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
