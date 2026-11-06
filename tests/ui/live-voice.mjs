// XS AI live interim transcription on browser SpeechRecognition, including
// installed iPhone PWA when its engine exists. No real gym data/API calls.
// node tests/ui/live-voice.mjs <playwright-module-path> <base-url>
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { REF, gym, session, body } from './mock.mjs';

const [pwPath, baseUrl, proofDir] = process.argv.slice(2);
if (proofDir) mkdirSync(proofDir, { recursive: true });
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
const assertions = [];
const check = (label, ok, detail = '') => {
  assertions.push({ test: label, pass: !!ok, detail });
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
    // This browser proof never sends recorded microphone data to any API.
    // Keep the normal gym Data API mock for authenticated screen rendering.
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
  if (proofDir && name === 'installed iPhone') {
    await page.screenshot({ path: proofDir + '/01-english-live-interim.png', fullPage: true });
  }
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
  if (proofDir && name === 'installed iPhone') {
    await page.screenshot({ path: proofDir + '/02-malayalam-live-interim.png', fullPage: true });
  }
  await tap(orb()); // User presses stop; browser onend triggers auto-send.
  await dialog.getByText('ശരി, മനസ്സിലായി.').waitFor({ timeout: 5000 });
  check(name + ': Malayalam sends once with selected language',
    log.agent.length === 2 && log.agent[1].lang === 'ml' &&
    log.agent[1].messages.at(-1).content === 'ഇന്ന് എത്ര രൂപ കിട്ടി?' &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  check(name + ': audio payload prohibited in all AI requests',
    log.agent.every((item) => !('audio' in item) && !('transcribe' in item) &&
      Array.isArray(item.messages) && item.messages.every((turn) =>
        !('audio' in turn) && typeof turn.content === 'string')));
  if (proofDir && name === 'installed iPhone') {
    await page.screenshot({ path: proofDir + '/03-malayalam-text-sent.png', fullPage: true });
  }
  await ctx.close();
}

// Browser recognition may be unavailable or blocked. The user is directed to
// keyboard dictation; there must never be an opt-in WAV/cloud recording path.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({
    standalone: true, mobile: true, scheme: 'light', stt: true,
  });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
  await page.evaluate(() => window.__serviceError());
  const help = dialog.getByRole('dialog', { name: 'ലൈവ് വോയ്സ് ലഭ്യമല്ല' });
  await help.waitFor({ timeout: 3000 });
  check('iPhone: speech service failure offers keyboard, never a cloud recording',
    await help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }).isVisible() &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  if (proofDir) await page.screenshot({ path: proofDir + '/04-voice-unavailable-keyboard.png', fullPage: true });
  await tap(help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  check('iPhone: fallback focuses the original text field',
    await dialog.getByRole('textbox', { name: 'Message XS AI' })
      .evaluate((el) => document.activeElement === el));
  await ctx.close();
}
if (proofDir) {
  writeFileSync(proofDir + '/test-results.json', JSON.stringify({
    source: baseUrl, simulatedRecognition: true,
    explanation: 'Actual application/browser rendering with simulated Web Speech results and mocked gym API. No raw audio was captured. Physical iPhone not tested.',
    total: assertions.length, passed: assertions.filter((x) => x.pass).length,
    failed: failures, assertions,
  }, null, 2));
}
await browser.close();
console.log(failures ? failures + ' LIVE VOICE FAILURES' : 'LIVE VOICE OK');
process.exit(failures ? 1 : 0);
