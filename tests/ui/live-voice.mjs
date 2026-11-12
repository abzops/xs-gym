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

const fakeSpeech = ({ standalone, noSpeech }) => {
  if (standalone) Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  window.__micCaptureCalls = 0;
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

// Genuine pointer sequences on Chromium: CDP TouchStart/TouchEnd for mobile,
// mouse down/up for desktop. Real iOS WebKit behavior needs physical-device UAT.
async function holdOrb(page, orb, mobile) {
  const box = await orb.boundingBox();
  if (!box) throw new Error('Microphone button did not render');
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    return {
      release: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
    };
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { release: () => page.mouse.up(), cancel: () => page.mouse.up() };
}
async function waitAgents(page, count) {
  await page.waitForFunction((n) => document.querySelectorAll('.xsai-turn.user').length >= n,
    count, { timeout: 6500 });
}

for (const [name, mobile, standalone, scheme] of [
  ['installed iPhone (Chromium touch simulation)', true, true, 'light'],
  ['mobile browser (Chromium touch simulation)', true, false, 'dark'],
  ['desktop browser', false, false, 'light'],
]) {
  const { ctx, page, dialog, log, errors, tap } = await setup({ standalone, mobile, scheme, stt: false });
  const input = dialog.getByRole('textbox', { name: 'Message XS AI' });
  const orb = () => dialog.locator('.xsai-orb');

  const first = await holdOrb(page, orb(), mobile);
  const en = await page.evaluate(() => ({ lang: window.__speech.last?.lang, interim: window.__speech.last?.interimResults }));
  check(name + ': pressing starts native browser en-IN recognition immediately',
    en.lang === 'en-IN' && en.interim === true);
  await page.evaluate(() => window.__partial('Who has'));
  check(name + ': English interim text appears before release',
    (await liveValue(page, 'Who has')) && log.agent.length === 0);
  await page.evaluate(() => window.__partial('Who has dues?'));
  check(name + ': English text updates while the finger is down',
    (await liveValue(page, 'Who has dues?')) && log.agent.length === 0);
  await page.evaluate(() => { window.__ended(); window.__ended(); });
  check(name + ': an early browser onend cannot send while still held', log.agent.length === 0);
  await first.release();
  await waitAgents(page, 1);
  check(name + ': lifting finger submits exactly once',
    log.agent.length === 1 && log.agent[0].messages.at(-1).content === 'Who has dues?');
  check(name + ': English uses no raw recording or XS Gym STT endpoint',
    log.transcribe.length === 0 && (await input.inputValue()) === '' &&
    (await page.evaluate(() => window.__micCaptureCalls)) === 0);

  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const second = await holdOrb(page, orb(), mobile);
  const ml = await page.evaluate(() => ({ lang: window.__speech.last?.lang, interim: window.__speech.last?.interimResults }));
  check(name + ': a new hold uses native ml-IN recognition',
    ml.lang === 'ml-IN' && ml.interim === true);
  await page.evaluate(() => window.__partial('ഇന്ന് എത്ര'));
  check(name + ': Malayalam interim letters appear before release',
    (await liveValue(page, 'ഇന്ന് എത്ര')) && log.agent.length === 1);
  await page.evaluate(() => window.__partial('ഇന്ന് എത്ര രൂപ കിട്ടി?'));
  check(name + ': Malayalam interim text updates while held',
    (await liveValue(page, 'ഇന്ന് എത്ര രൂപ കിട്ടി?')) && log.agent.length === 1);
  await second.release();
  await waitAgents(page, 2);
  check(name + ': Malayalam release auto-sends once, text only',
    log.agent.length === 2 && log.agent[1].lang === 'ml' &&
    log.agent[1].messages.at(-1).content === 'ഇന്ന് എത്ര രൂപ കിട്ടി?' &&
    log.transcribe.length === 0 && (await page.evaluate(() => window.__micCaptureCalls)) === 0);

  const third = await holdOrb(page, orb(), mobile);
  await page.evaluate(() => window.__partial('വീണ്ടും മലയാളം'));
  await third.release();
  await waitAgents(page, 3);
  check(name + ': second Malayalam hold works and does not duplicate prior request',
    log.agent.length === 3 && log.agent[2].messages.at(-1).content === 'വീണ്ടും മലയാളം' &&
    errors.length === 0, errors.join(' | '));

  // Silence should never produce a payment command.
  const fourth = await holdOrb(page, orb(), mobile);
  await fourth.release();
  await page.waitForTimeout(110);
  check(name + ': silent quick release does not submit an empty command',
    log.agent.length === 3);
  await ctx.close();
}

// Aborted iPhone touches (e.g. finger pulled away / OS interruption) MUST
// discard the entire phrase and not run any protected XS AI action.
{
  const { ctx, page, dialog, log, errors, tap } = await setup({ standalone: true });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const contact = await holdOrb(page, dialog.locator('.xsai-orb'), true);
  await page.evaluate(() => window.__partial('രാഹുൽ 1500 UPI ആയി അടച്ചു'));
  await contact.cancel();
  await page.waitForTimeout(130);
  check('iPhone: interrupted touch cancels Malayalam financial command, never sends',
    log.agent.length === 0 && log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// A language-service error is not a microphone-permission failure. Keep
// the exact browser error and allow a manually selected alternate locale.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({ standalone: true });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const contact = await holdOrb(page, dialog.locator('.xsai-orb'), true);
  await page.evaluate(() => {
    window.__speech.last?.onerror?.({ error: 'language-not-supported' });
    window.__speech.last?.onend?.();
  });
  await contact.release();
  const warning = dialog.getByRole('dialog', { name: 'മലയാളം വോയ്സ് ഈ ബ്രൗസറിൽ പിന്തുണയ്ക്കുന്നില്ല' });
  await warning.waitFor({ timeout: 4000 });
  const firstError = await warning.getByRole('status').innerText();
  check('iPhone: exact ml-IN browser language failure is shown',
    firstError.includes('language-not-supported') && firstError.includes('ml-IN'));
  await tap(warning.getByRole('button', { name: 'മലയാളം (ml) കോഡ് പരീക്ഷിക്കുക' }));
  const retry = await holdOrb(page, dialog.locator('.xsai-orb'), true);
  const ml = await page.evaluate(() => window.__speech.last?.lang);
  check('iPhone: next finger hold uses alternative browser-only ml tag', ml === 'ml');
  await page.evaluate(() => window.__partial('എത്ര രൂപ കിട്ടി?'));
  await retry.release();
  await waitAgents(page, 1);
  check('iPhone: locale retry sends only recognized text',
    log.agent.length === 1 && log.agent[0].messages.at(-1).content === 'എത്ര രൂപ കിട്ടി?' &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  await ctx.close();
}

// A service-not-allowed error must not be represented as a permission grant
// or falsely claimed to have been repaired by changing the language tag.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({ standalone: true });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const contact = await holdOrb(page, dialog.locator('.xsai-orb'), true);
  await page.evaluate(() => window.__serviceError());
  await contact.release();
  const help = dialog.getByRole('dialog', { name: 'ലൈവ് വോയ്സ് ലഭ്യമല്ല' });
  await help.waitFor({ timeout: 4000 });
  const detail = await help.getByRole('status').innerText();
  check('iPhone: service-not-allowed reports actual code without recording/upload',
    detail.includes('service-not-allowed') && detail.includes('ml-IN') &&
    log.agent.length === 0 && log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  await tap(help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  check('iPhone: keyboard fallback retains focus',
    await dialog.getByRole('textbox', { name: 'Message XS AI' }).evaluate((el) => document.activeElement === el));
  await ctx.close();
}

// Some installed browser contexts expose no SpeechRecognition API whatsoever.
{
  const { ctx, page, dialog, log, tap, errors } = await setup({
    standalone: true, mobile: true, noSpeech: true, stt: true,
  });
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const contact = await holdOrb(page, dialog.locator('.xsai-orb'), true);
  await contact.release();
  const help = dialog.getByRole('dialog', { name: 'ബ്രൗസർ വോയ്സ് ലഭ്യമല്ല' });
  await help.waitFor({ timeout: 4000 });
  check('iPhone without recognition API: safe text-only guidance',
    await help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }).isVisible() &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  await tap(help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  const input = dialog.getByRole('textbox', { name: 'Message XS AI' });
  await input.fill('ഹലോ, ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?');
  await tap(dialog.getByRole('button', { name: 'Send' }));
  await waitAgents(page, 1);
  check('iPhone text fallback: typed Malayalam sends without audio',
    log.agent.length === 1 && log.agent[0].messages.at(-1).content === 'ഹലോ, ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?' &&
    log.transcribe.length === 0 && errors.length === 0, errors.join(' | '));
  await ctx.close();
}
await browser.close();
console.log(failures ? failures + ' LIVE VOICE FAILURES' : 'TEXT-ONLY VOICE OK');
process.exit(failures ? 1 : 0);
