// XS AI live interim transcription on browser SpeechRecognition, including
// installed iPhone PWA when its engine exists. No real gym data/API calls.
// node tests/ui/live-voice.mjs <playwright-module-path> <base-url>
import { createRequire } from 'node:module';
import { REF, gym, session, body } from './mock.mjs';

const [pwPath, baseUrl] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
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

const fakeSpeech = ({ standalone }) => {
  if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
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
async function setup({ standalone, stt = false, mobile = true, scheme = 'light' }) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 393, height: 852 } : { width: 1366, height: 860 },
    isMobile: mobile, hasTouch: mobile, colorScheme: scheme,
  });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value),
    ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
  await ctx.addInitScript(fakeSpeech, { standalone });
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
    log.transcribe.length === 0 && (await input.inputValue()) === '');

  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(orb());
  const ml = await page.evaluate(() => ({ lang: window.__speech.last?.lang, interim: window.__speech.last?.interimResults }));
  check(name + ': Malayalam uses live ml-IN recognition', ml.lang === 'ml-IN' && ml.interim === true);
  await page.evaluate(() => window.__partial('ഇന്ന് എത്ര'));
  check(name + ': Malayalam letters appear as they are spoken',
    (await liveValue(page, 'ഇന്ന് എത്ര')) && log.agent.length === 1);
  await page.evaluate(() => window.__partial('ഇന്ന് എത്ര രൂപ കിട്ടി?'));
  check(name + ': Malayalam interim text updates immediately',
    (await liveValue(page, 'ഇന്ന് എത്ര രൂപ കിട്ടി?')) && log.agent.length === 1);
  await tap(orb()); // User presses stop; browser onend triggers auto-send.
  await dialog.getByText('ശരി, മനസ്സിലായി.').waitFor({ timeout: 5000 });
  check(name + ': Malayalam sends once with selected language',
    log.agent.length === 2 && log.agent[1].lang === 'ml' &&
    log.agent[1].messages.at(-1).content === 'ഇന്ന് എത്ര രൂപ കിട്ടി?' &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// Service is unavailable, not the microphone. Offer WAV recording as a separate
// opt-in fallback, rather than silently replacing live speech for everyone.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({ standalone: true, mobile: true, scheme: 'light', stt: true });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
  await page.evaluate(() => window.__serviceError());
  const help = dialog.getByRole('dialog', { name: 'ലൈവ് വോയ്സ് ലഭ്യമല്ല' });
  await help.waitFor({ timeout: 3000 });
  check('installed iPhone: real-time engine failure offers recorded fallback',
    await help.getByRole('button', { name: 'റെക്കോർഡ് ചെയ്ത് ശ്രമിക്കുക' }).isVisible() &&
    log.agent.length === 0 && errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? failures + ' LIVE VOICE FAILURES' : 'LIVE VOICE OK');
process.exit(failures ? 1 : 0);
