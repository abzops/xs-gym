// XS AI live interim transcription on browser SpeechRecognition, including
// installed iPhone PWA when its engine exists. No real gym data/API calls.
// node tests/ui/live-voice.mjs <playwright-module-path> <base-url>
import { createRequire } from 'node:module';
import { REF, gym, session, body } from './mock.mjs';

const [pwPath, baseUrl] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] });
let failures = 0;
const check = (label, ok, detail = '') => {
  if (!ok) failures++;
  console.log((ok ? 'ok   ' : 'FAIL ') + label + (detail ? ' — ' + detail : ''));
};

// React commits state updates asynchronously after the speech event handler.
// Allow one render tick, but never wait for the recording to finish.
async function liveValue(page, expected) {
  try {
    await page.waitForFunction((value) =>
      document.querySelector('input[aria-label="Message XS AI"]')?.value === value,
      expected, { timeout: 1500 });
    return true;
  } catch { return false; }
}

const fakeSpeech = ({ standalone, noSpeech }) => {
  if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  window.__micCaptureCalls = 0;
  // Mock only the local model worker. Real CI exercises the integration
  // hand-off and browser microphone path, not the 90 MB model download.
  window.__offlineWorker = { loads: 0, transcribes: 0, lastLanguage: null };
  const NativeWorker = window.Worker;
  window.Worker = class MockLocalWorker {
    onmessage = null; onerror = null;
    constructor(url, options) {
      if (!String(url).includes('malayalam.worker')) return new NativeWorker(url, options);
    }
    postMessage(data) {
      if (data.type === 'load') {
        window.__offlineWorker.loads++;
        queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
      } else if (data.type === 'transcribe') {
        window.__offlineWorker.transcribes++;
        queueMicrotask(() => this.onmessage?.({ data: { type: 'result', id: data.id, text: 'ഇന്ന് എത്ര രൂപ കിട്ടി?' } }));
      }
    }
    terminate() {}
  };

  if (navigator.mediaDevices) {
    const original = navigator.mediaDevices.getUserMedia?.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = (...args) => {
      window.__micCaptureCalls++;
      if (original) return original(...args);
      return Promise.reject(new Error('Unexpected microphone capture'));
    };
  }
  if (noSpeech) {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
    return;
  }
  window.__speech = { started: 0, stopped: 0, last: null };
  class FakeSpeechRecognition {
    lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
    onresult = null; onerror = null; onend = null;
    start() { window.__speech.started++; window.__speech.last = this; }
    stop() { window.__speech.stopped++; queueMicrotask(() => this.onend?.()); }
    abort() { window.__speech.stopped++; queueMicrotask(() => this.onend?.()); }
  }
  window.SpeechRecognition = FakeSpeechRecognition;
  window.webkitSpeechRecognition = FakeSpeechRecognition;
  window.__partial = (text) => window.__speech.last?.onresult?.({ results: [[{ transcript: text }]] });
  window.__ended = () => window.__speech.last?.onend?.();
  window.__serviceError = () => {
    window.__speech.last?.onerror?.({ error: 'service-not-allowed' });
    window.__speech.last?.onend?.();
  };
};
async function setup({ standalone, stt = false, mobile = true, scheme = 'light', noSpeech = false }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 393, height: 852 } : { width: 1366, height: 860 },
    isMobile: mobile, hasTouch: mobile, colorScheme: scheme,
  });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value),
    ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
  await ctx.addInitScript(fakeSpeech, { standalone, noSpeech });
  const log = { agent: [], transcribe: [] };
  await ctx.route('https://' + REF + '.supabase.co/**', async (route) => {
    const req = route.request(), url = req.url();
    if (url.includes('/functions/v1/xs-ai')) {
      if (req.method() === 'GET') return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ configured: true, stt, stt_languages: { en: stt, ml: stt } }),
      });
      const payload = JSON.parse(req.postData() ?? '{}');
      if (payload.transcribe) {
        log.transcribe.push(payload);
        return route.fulfill({ status: 503, contentType: 'application/json',
          body: JSON.stringify({ error: 'No cloud key in this test' }) });
      }
      log.agent.push(payload);
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ reply: payload.lang === 'ml' ? 'ശരി, മനസ്സിലായി.' : 'I understood.', actions: [], changed: [] }),
      });
    }
    const accept = req.headers()['accept'] ?? '';
    let data = body(url);
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baseUrl + 'g/' + gym.slug, { waitUntil: 'networkidle' });
  const tap = (target) => mobile ? target.tap() : target.click();
  const entry = mobile ? page.locator('.topbar .xsai-entry') : page.locator('.sidebar .xsai-side');
  await tap(entry);
  const dialog = page.getByRole('dialog', { name: 'XS AI' });
  await dialog.waitFor();
  await tap(dialog.getByRole('button', { name: 'Voice on' })); // no speech synthesis delays
  return { ctx, page, dialog, log, errors, tap };
}

for (const [name, mobile, standalone, scheme] of [
  ['installed iPhone', true, true, 'light'],
  ['mobile browser', true, false, 'dark'],
  ['desktop browser', false, false, 'light'],
]) {
  const { ctx, page, dialog, log, errors, tap } = await setup({ standalone, mobile, scheme, stt: false });
  const input = dialog.getByRole('textbox', { name: 'Message XS AI' });
  const orb = () => dialog.getByRole('button', { name: /Talk to XS AI|Stop listening/ });
  await tap(orb());
  const en = await page.evaluate(() => ({ lang: window.__speech.last?.lang, interim: window.__speech.last?.interimResults }));
  check(name + ': English uses live en-IN interim recognition', en.lang === 'en-IN' && en.interim === true);
  await page.evaluate(() => window.__partial('Who has'));
  check(name + ': English words appear in the composer before stopping',
    (await liveValue(page, 'Who has')) && log.agent.length === 0);
  await page.evaluate(() => window.__partial('Who has dues?'));
  check(name + ': English interim text updates on every result',
    (await liveValue(page, 'Who has dues?')) && log.agent.length === 0);
  await page.evaluate(() => { window.__ended(); window.__ended(); });
  await dialog.getByText('I understood.').waitFor({ timeout: 5000 });
  check(name + ': stops and automatically sends exactly once',
    log.agent.length === 1 && log.agent[0].messages.at(-1).content === 'Who has dues?');
  check(name + ': no whole-recording upload or cloud STT dependency',
    log.transcribe.length === 0 && (await input.inputValue()) === '' &&
    (await page.evaluate(() => window.__micCaptureCalls)) === 0);

  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(orb());
  const offer = dialog.getByRole('dialog', { name: 'ഫോണിൽ തന്നെ മലയാളം വോയ്സ്' });
  await offer.waitFor({ timeout: 3000 });
  check(name + ': Malayalam requires consent for on-device engine, never the browser cloud service',
    await offer.getByRole('button', { name: 'മലയാളം മോഡൽ ലോഡ് ചെയ്യുക' }).isVisible() &&
    await page.evaluate(() => window.__speech.started === 1 && window.__offlineWorker.loads === 0) &&
    log.transcribe.length === 0);
  await tap(offer.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  check(name + ': offline setup can be declined without microphone capture',
    await input.evaluate((el) => document.activeElement === el) &&
    await page.evaluate(() => window.__micCaptureCalls === 0));
  await ctx.close();
}

// The engine can reject the request even after exposing its API. Never
// switch to capturing WAV/audio or uploading it to Supabase.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({ standalone: true, mobile: true, stt: true });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
  const help = dialog.getByRole('dialog', { name: 'ഫോണിൽ തന്നെ മലയാളം വോയ്സ്' });
  await help.waitFor({ timeout: 3000 });
  check('iPhone: Malayalam offers local model without trying a remote speech service',
    await help.getByRole('button', { name: 'മലയാളം മോഡൽ ലോഡ് ചെയ്യുക' }).isVisible() &&
    await help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }).isVisible() &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  // Explicit user opt-in must be required before any model download.
  check('iPhone: model is not downloaded on microphone or language selection',
    await page.evaluate(() => window.__offlineWorker.loads === 0));
  await tap(help.getByRole('button', { name: 'മലയാളം മോഡൽ ലോഡ് ചെയ്യുക' }));
  await help.waitFor({ state: 'hidden', timeout: 3000 });
  check('iPhone: one deliberate opt-in loads only browser-local worker',
    await page.evaluate(() => window.__offlineWorker.loads === 1) &&
    log.transcribe.length === 0);
  await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
  await dialog.getByRole('button', { name: 'Stop listening' }).waitFor({ timeout: 6000 });
  await page.waitForTimeout(850); // local microphone must collect >0.2s of PCM
  await tap(dialog.getByRole('button', { name: 'Stop listening' }));
  await dialog.getByText('ശരി, മനസ്സിലായി.').waitFor({ timeout: 12000 });
  check('iPhone: local Malayalam text is submitted once; no audio upload',
    log.agent.length === 1 && log.agent[0].lang === 'ml' &&
    log.agent[0].messages.at(-1).content === 'ഇന്ന് എത്ര രൂപ കിട്ടി?' &&
    log.transcribe.length === 0 &&
    await page.evaluate(() => window.__offlineWorker.transcribes === 1 &&
      window.__micCaptureCalls === 1) && errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// An iOS Home Screen app without the browser SpeechRecognition API must
// never silently record and upload to a different server-side speech service.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({
    standalone: true, mobile: true, noSpeech: true, stt: true,
  });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
  const help = dialog.getByRole('dialog', { name: 'ഫോണിൽ തന്നെ മലയാളം വോയ്സ്' });
  await help.waitFor({ timeout: 3000 });
  check('iPhone without live recognizer: offers local model and keyboard rather than audio upload',
    await help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }).isVisible() &&
    log.transcribe.length === 0);
  await tap(help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  const input = dialog.getByRole('textbox', { name: 'Message XS AI' });
  check('iPhone without live recognizer: keyboard is focused',
    await input.evaluate((el) => document.activeElement === el));
  await input.fill('ഹലോ, ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?');
  await tap(dialog.getByRole('button', { name: 'Send' }));
  await dialog.getByText('ശരി, മനസ്സിലായി.').waitFor({ timeout: 5000 });
  check('iPhone text-only: sends the dictated text, never an audio blob',
    log.agent.length === 1 && log.agent[0].messages.at(-1).content === 'ഹലോ, ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?' &&
    log.transcribe.length === 0 && await page.evaluate(() => window.__micCaptureCalls === 0) &&
    errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? failures + ' LIVE VOICE FAILURES' : 'TEXT-ONLY VOICE OK');
process.exit(failures ? 1 : 0);
