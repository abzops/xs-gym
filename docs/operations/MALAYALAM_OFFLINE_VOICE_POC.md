# XS Gym Malayalam speech — local-model development experiment

**Status:** isolated feature prototype, **NOT production-ready**  
**Date:** 12 November 2026  
**Branch:** `feature/malayalam-offline-speech`  
**Production:** `main` unchanged; no migrations, no member/payment changes, no live deployment

## Observed failure / root cause

The iPhone screenshot shows XS AI's "Live speech unavailable" dialog with Malayalam selected. Existing `voice.ts` sends `ml-IN` to the browser's Web Speech API, but merely exposing `webkitSpeechRecognition` does **not** mean that iOS supports Malayalam. Safari/iOS may reject the speech service or language. Apple's iOS feature availability lists Malayalam keyboards but not Malayalam Dictation. Browser speech recognition can also use remote vendor servers unless local processing is explicitly enabled.

It is **not** correct to claim that changing `ml-IN`, microphone permission or iOS Chrome settings will resolve unsupported Malayalam speech.

## Proposed implementation (feature branch only)

- Keep the existing fast English Web Speech path unchanged.
- For Malayalam, bypass Web Speech (which might upload microphone audio to browser-vendor servers).
- On the first Malayalam microphone tap, ask explicit permission to download a local multilingual speech model (approx. 90 MB; may be more after runtime assets).
- Download pinned browser ES modules from `cdn.jsdelivr.net` and a pinned `onnx-community/whisper-tiny` model from Hugging Face. No microphone audio is part of these requests.
- In a browser Web Worker, load multilingual Whisper with `language: malayalam`, `task: transcribe`, quantized WASM and low thread count. Model artifacts are cached by the browser when supported.
- Following a separate microphone tap, capture up to 12 seconds of microphone PCM in Web Audio, resample locally to 16 kHz, stop and release the microphone, then pass only the PCM array to the same-origin Worker.
- On completion, place recognized Malayalam text into the editable XS AI composer. User explicitly taps **Send** after checking names/amounts: **no speech-generated financial tool action without confirmation**.
- On failure, show a Malayalam error and retain the text-only UI; never switch to cloud STT, never upload audio files or recordings to Supabase.

**Limitations:** This does NOT provide English-equivalent interim words or guaranteed subsecond latency. Tiny multilingual recognition can be inaccurate with Malayalam, Manglish, proper names and numerical amounts. The iPhone 12/A13 memory budget may cause tab reloads; audio processing happens after a short phrase, not continuously. Browser caching, WebAssembly availability and first-run network access are device-dependent.

## Security and privacy before any production release

1. **Self-host pinned and reviewed JS/WASM binaries and model weights** rather than dynamically importing executable CDN code. Current third-party imports are POC-only and a *release blocker*. Review model license, provenance, revision, CSP and content hashes.
2. Run actual offline inference on at least two iPhone variants, Safari and Home Screen PWA, including permission denial, low memory, suspended apps and tab reloads.
3. Use a representative Malayalam/Manglish synthetic voice benchmark with voluntary licensed audio; record word-error rate, time-to-first-text, cold download, warm latency, memory, and model failure rate.
4. Verify that the only network requests during transcription are text-only XS AI requests after a deliberate Send tap (also check service workers, browser requests and model download flows).
5. Ensure fallback does not mislead iPhone users: Apple does not list Malayalam under native Dictation, although Malayalam keyboard text entry is supported.
6. Test cancellation, closing sheet mid-recording, model timeouts, double-tap, silent/no-speech and financial confirmation invariants. Never turn automatic action execution on for lower-confidence transcripts without approval.
7. Get owner approval for large downloads on cellular, bundle size, storage budget and model supply chain before deployment.

## Test evidence

`.github/workflows/malayalam-offline-voice.yml` runs build, types, lint, unit, and Chromium UI tests on synthetic data and a nonproduction Supabase host. The UI test uses a **fake Worker** that returns known Malayalam text, and a **fake microphone device**; it tests wiring, opt-in, release of microphone capture and no app audio-upload calls. **It does not download Whisper, evaluate accuracy or run physical iPhone hardware.**

The existing `tests/ui/live-voice.mjs` tests English interim transcription/auto-send as a regression. Its Malayalam branch tests opt-in, opt-out and human confirmation before sending.

## Release / approval gate

Keep branch and PR in **draft**. No merge, deploy, production configuration/data changes, or production audio experiments without explicit owner approval. Actual performance must be validated before calling Malayalam voice usable on the pilot.

### Technical references

- [Apple feature availability](https://www.apple.com/in/ios/feature-availability/)
- [MDN Web Speech API and cloud/privacy behavior](https://developer.mozilla.org/en-US/docs/Web/API/SpeechRecognition)
- [Whisper browser WASM performance caveats](https://github.com/ggml-org/whisper.cpp/blob/master/examples/whisper.wasm/README.md)
- [Transformers.js CDN installation](https://huggingface.co/docs/transformers.js/v3.8.1/en/installation)
- [Whisper-tiny multilingual ONNX](https://huggingface.co/onnx-community/whisper-tiny)
