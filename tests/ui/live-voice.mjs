// Synthetic browser-only XS AI regression. No real customer API/audio.
// node tests/ui/live-voice.mjs <playwright-module-path> <base-url>
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { REF, gym, session, body } from './mock.mjs';

const [pwPath, baseUrl] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
const screenshotDir = '/tmp/xs-ai-agent-screens';
await mkdir(screenshotDir, { recursive: true });
function check(name, condition, detail = '') {
  if (!condition) failures++;
  console.log((condition ? 'ok   ' : 'FAIL ') + name + (detail ? ' — ' + detail : ''));
}
async function waitValue(page, value) {
  try {
    await page.waitForFunction((expected) =>
      document.querySelector('.xsai-live-transcript')?.textContent?.trim() === expected,
    value, { timeout: 1800 });
    return true;
  } catch { return false; }
}
async function waitCount(page, count) {
  await page.waitForFunction((n) =>
    document.querySelectorAll('.xsai-turn.user').length >= n &&
    document.querySelectorAll('.xsai-turn.assistant .xsai-bubble:not(.xsai-dots)').length >= n &&
    !document.querySelector('.xsai-dots'),
  count, { timeout: 11000 });
}
function fakeSpeech({ noSpeech }) {
  // Dedicated native-WebSpeech regression. Other tests mock MediaRecorder.
  window.MediaRecorder = undefined;
  window.__micCaptureCalls = 0;
  window.__clipboard = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async (value) => { window.__clipboard.push(value); },
  } });
  if (navigator.mediaDevices) {
    navigator.mediaDevices.getUserMedia = () => {
      window.__micCaptureCalls++;
      return Promise.reject(new Error('Unexpected raw mic access'));
    };
  }
  window.__speech = { started: 0, stopped: 0, last: null, delayEnd: false };
  if (!noSpeech) {
    class FakeSpeech {
      lang = ''; continuous = false; interimResults = false; maxAlternatives = 1;
      onresult = null; onerror = null; onend = null;
      start() { window.__speech.started++; window.__speech.last = this; }
      stop() {
        window.__speech.stopped++;
        if (window.__speech.delayEnd) setTimeout(() => this.onend?.(), 250);
        else queueMicrotask(() => this.onend?.());
      }
      abort() { window.__speech.stopped++; queueMicrotask(() => this.onend?.()); }
    }
    window.SpeechRecognition = FakeSpeech;
    window.webkitSpeechRecognition = FakeSpeech;
  } else {
    window.SpeechRecognition = undefined;
    window.webkitSpeechRecognition = undefined;
  }
  window.__partial = (value) => window.__speech.last?.onresult?.({
    results: [[{ transcript: value }]],
  });
  window.__ended = () => window.__speech.last?.onend?.();
  window.__browserError = (code) => {
    window.__speech.last?.onerror?.({ error: code });
    window.__speech.last?.onend?.();
  };
  // Browser speech synthesis is mocked, so the test can assert that voice
  // responses are OFF unless enabled in Settings, without audible playback.
  window.__tts = { calls: [], cancels: 0 };
  const voices = [
    { name: 'Fake English', lang: 'en-IN' },
    { name: 'Fake Malayalam', lang: 'ml-IN' },
  ];
  const synth = {
    getVoices: () => voices,
    addEventListener: () => {},
    cancel: () => { window.__tts.cancels++; },
    speak: (utterance) => {
      window.__tts.calls.push(utterance.text);
      queueMicrotask(() => utterance.onend?.());
    },
  };
  Object.defineProperty(window, 'speechSynthesis', { configurable: true, value: synth });
  window.SpeechSynthesisUtterance = class {
    constructor(value) { this.text = value; this.onend = null; this.onerror = null; }
  };
}
async function setup({ mobile = true, noSpeech = false, delay = 0 } = {}) {
  const ctx = await browser.newContext({
    viewport: mobile ? { width: 393, height: 852 } : { width: 1366, height: 860 },
    isMobile: mobile, hasTouch: mobile,
  });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value),
    ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
  await ctx.addInitScript(fakeSpeech, { noSpeech });
  const logs = { agent: [], transcribe: [] };
  await ctx.route('https://' + REF + '.supabase.co/**', async (route) => {
    const request = route.request(), url = request.url();
    if (url.includes('/functions/v1/xs-ai')) {
      if (request.method() === 'GET') return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ configured: true, stt: false }),
      });
      const payload = JSON.parse(request.postData() ?? '{}');
      if (payload.transcribe) {
        logs.transcribe.push(payload);
        return route.fulfill({ status: 403, contentType: 'application/json',
          body: JSON.stringify({ error: 'Raw audio not allowed' }) });
      }
      logs.agent.push(payload);
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ reply: payload.lang === 'ml' ? 'ശരി, മനസ്സിലായി.' : 'I understood.',
          actions: [], changed: [] }),
      });
    }
    const accept = request.headers()['accept'] ?? '';
    let data = body(url);
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(baseUrl + 'g/' + gym.slug, { waitUntil: 'networkidle' });
  const tap = (item) => mobile ? item.tap() : item.click();
  async function open() {
    const entry = page.getByRole('button', { name: 'Open XS AI' });
    await tap(entry);
    const dialog = page.getByRole('dialog', { name: 'XS AI' });
    await dialog.waitFor();
    return dialog;
  }
  return { ctx, page, errors, logs, tap, open };
}
async function hold(page, orb, mobile = true) {
  const box = await orb.boundingBox();
  if (!box) throw new Error('XS AI microphone not visible');
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  if (mobile) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',
      { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    return {
      release: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
      cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
    };
  }
  await page.mouse.move(x, y);
  await page.mouse.down();
  return { release: () => page.mouse.up(), cancel: () => page.mouse.up() };
}
async function idleMic(page) {
  try {
    await page.waitForFunction(() => {
      const orb = document.querySelector('.xsai-orb');
      return orb?.getAttribute('aria-pressed') === 'false' &&
        !orb?.classList.contains('listening') &&
        !document.querySelector('.xsai-status');
    }, undefined, { timeout: 1200 });
    return true;
  } catch { return false; }
}

for (const [label, mobile] of [['phone touch', true], ['desktop mouse', false]]) {
  const { ctx, page, logs, tap, errors, open } = await setup({ mobile });
  const dialog = await open();
  const mic = dialog.locator('.xsai-orb');
  check(label + ': voice-first UI has keyboard icon and no unwanted text input',
    await dialog.getByRole('button', { name: 'Open keyboard' }).count() === 1 &&
    await dialog.getByRole('textbox', { name: 'Message XS AI' }).count() === 0 &&
    await dialog.getByRole('button', { name: 'Voice on' }).count() === 0 &&
    await dialog.locator('.xsai-empty').count() === 0 &&
    await dialog.locator('.xsai-mic-backdrop').count() === 0 &&
    await idleMic(page));

  if (mobile) {
    const rect = await mic.boundingBox();
    const actual = await page.evaluate(({x,y}) => document.elementFromPoint(x,y)?.closest('.xsai-orb') !== null,
      {x:rect.x + rect.width / 2, y:rect.y + rect.height / 2});
    check('iPhone: XS AI microphone is hit-testable on the first frame', actual);
  }
  const first = await hold(page, mic, mobile);
  const lang = await page.evaluate(() => window.__speech.last?.lang);
  check(label + ': press starts English browser recognition', lang === 'en-IN');
  await page.evaluate(() => window.__partial('How much'));
  check(label + ': interim words appear while held',
    await waitValue(page, 'How much') && logs.agent.length === 0);
  await page.evaluate(() => window.__partial('How much today?'));
  await first.release();
  check(label + ': release immediately restores neutral microphone', await idleMic(page));
  check(label + ': outgoing bubble appears on finger-up',
    await dialog.locator('.xsai-turn.user').count() === 1);
  await waitCount(page, 1);
  check(label + ': release sends one text message, without speaking by default',
    logs.agent.length === 1 && logs.agent[0].messages.at(-1).content === 'How much today?' &&
    await page.evaluate(() => window.__tts.calls.length === 0) && logs.transcribe.length === 0);

  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const second = await hold(page, mic, mobile);
  check(label + ': Malayalam uses native ml-IN', await page.evaluate(() => window.__speech.last?.lang === 'ml-IN'));
  await page.evaluate(() => window.__partial('ഇന്ന് എത്ര രൂപ കിട്ടി?'));
  check(label + ': Malayalam live text visible while held', await waitValue(page, 'ഇന്ന് എത്ര രൂപ കിട്ടി?'));
  await second.release();
  check(label + ': Malayalam mic resets immediately', await idleMic(page));
  await waitCount(page, 2);
  check(label + ': Malayalam submits once and keeps reply silent',
    logs.agent.length === 2 && logs.agent[1].lang === 'ml' &&
    logs.agent[1].messages.at(-1).content === 'ഇന്ന് എത്ര രൂപ കിട്ടി?' &&
    await page.evaluate(() => window.__tts.calls.length === 0));

  const third = await hold(page, mic, mobile);
  await page.evaluate(() => window.__partial('വീണ്ടും മലയാളം'));
  await third.release();
  await waitCount(page, 3);
  check(label + ': next hold starts a fresh listening session',
    logs.agent.length === 3 && logs.agent[2].messages.at(-1).content === 'വീണ്ടും മലയാളം' &&
    await idleMic(page) && errors.length === 0, errors.join(' | '));

  const silent = await hold(page, mic, mobile);
  await silent.release();
  await page.waitForTimeout(200);
  check(label + ': silence produces no toast, modal or empty command',
    logs.agent.length === 3 && await dialog.locator('.xsai-inline-issue').count() === 0 &&
    await idleMic(page));
  await ctx.close();
}

// New finger-down is allowed while the previous (possibly financial) command
// is pending, but HTTP calls must remain serialized, never overlap.
{
  const { ctx, page, logs, open } = await setup({ delay: 850 });
  const dialog = await open(), mic = dialog.locator('.xsai-orb');
  const one = await hold(page, mic);
  await page.evaluate(() => window.__partial('First question'));
  await one.release();
  await page.waitForFunction(() => document.querySelectorAll('.xsai-turn.user').length === 1);
  check('busy queue: mic returns to normal while first request runs', await idleMic(page));
  const two = await hold(page, mic);
  await page.evaluate(() => window.__partial('Second question'));
  await two.release();
  check('busy queue: second hold works while AI is processing', await idleMic(page) &&
    await dialog.locator('.xsai-turn.user').count() === 2);
  await waitCount(page, 2);
  check('busy queue: both requests are processed in order',
    logs.agent.length === 2 &&
    logs.agent[0].messages.at(-1).content === 'First question' &&
    logs.agent[1].messages.at(-1).content === 'Second question');
  await ctx.close();
}

{
  const { ctx, page, logs, open } = await setup();
  const dialog = await open();
  await dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }).tap();
  const contact = await hold(page, dialog.locator('.xsai-orb'));
  await page.evaluate(() => window.__partial('Rahul paid 1000'));
  await contact.cancel();
  await page.waitForTimeout(220);
  check('cancelled hold: payment-like phrase never sent', logs.agent.length === 0 && await idleMic(page));
  await ctx.close();
}

// Native Malayalam browser failure after a release is a real failure.
// The error UI is a compact hint + keyboard icon; users need no opt-in toggle.
{
  const { ctx, page, logs, open, tap } = await setup();
  const dialog = await open();
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const contact = await hold(page, dialog.locator('.xsai-orb'));
  await page.evaluate(() => { window.__speech.delayEnd = true; });
  await contact.release();
  await page.evaluate(() => window.__browserError('language-not-supported'));
  await dialog.locator('.xsai-inline-issue').waitFor({ timeout: 3500 });
  check('browser Malayalam error: keyboard icon offered, no extra settings prompt',
    await dialog.locator('.xsai-inline-issue').getByRole('button', { name: 'Type message' }).count() === 1 &&
    await dialog.getByRole('textbox', { name: 'Message XS AI' }).count() === 0 &&
    logs.agent.length === 0);
  await tap(dialog.locator('.xsai-inline-issue').getByRole('button', { name: 'Type message' }));
  check('keyboard icon opens a real editable text field',
    await dialog.getByRole('textbox', { name: 'Message XS AI' }).count() === 1);
  await ctx.close();
}

// Safari may end with an empty transcript and no error. Silently attempt the
// alternate native Malayalam locale on the next hold (no cloud or popups).
{
  const { ctx, page, logs, open, tap } = await setup();
  const dialog = await open();
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  const first = await hold(page, dialog.locator('.xsai-orb'));
  await first.release();
  await page.waitForTimeout(80);
  const next = await hold(page, dialog.locator('.xsai-orb'));
  check('silent Malayalam browser ending retries native short ml without error',
    await page.evaluate(() => window.__speech.last?.lang === 'ml') &&
    await dialog.locator('.xsai-inline-issue').count() === 0 &&
    logs.transcribe.length === 0);
  await next.release();
  await ctx.close();
}

{
  const { ctx, page, logs, open, tap } = await setup({ noSpeech: true });
  const dialog = await open();
  const contact = await hold(page, dialog.locator('.xsai-orb'));
  await contact.release();
  await dialog.locator('.xsai-inline-issue').waitFor({ timeout: 3500 });
  check('no browser recognition: compact fallback without sending audio',
    await dialog.locator('.xsai-mic-backdrop').count() === 0 && logs.transcribe.length === 0);
  await tap(dialog.locator('.xsai-inline-issue').getByRole('button', { name: 'Type message' }));
  await dialog.getByRole('textbox', { name: 'Message XS AI' }).fill('Typed message');
  await tap(dialog.getByRole('button', { name: 'Send' }));
  await waitCount(page, 1);
  check('text fallback still sends one command', logs.agent.length === 1);
  await ctx.close();
}

// Final words may arrive after release. Do not erase a draft typed while
// speech recognition is still finalizing its response.
{
  const { ctx, page, logs, open } = await setup();
  const dialog = await open();
  const contact = await hold(page, dialog.locator('.xsai-orb'));
  await page.evaluate(() => { window.__speech.delayEnd = true; window.__partial('Voice phrase'); });
  await contact.release();
  await dialog.getByRole('button', { name: 'Open keyboard' }).tap();
  const input = dialog.getByRole('textbox', { name: 'Message XS AI' });
  await input.fill('My typed draft');
  await waitCount(page, 1);
  check('late browser onend: typed draft is preserved and voice submits once',
    (await input.inputValue()) === 'My typed draft' &&
    logs.agent.length === 1 &&
    logs.agent[0].messages.at(-1).content === 'Voice phrase' &&
    await idleMic(page));
  await ctx.close();
}

// Spoken AI replies remain optional. Malayalam transcription has no switch.
// Test that changing TTS never controls microphone fallback.
{
  const { ctx, page, logs, open, tap } = await setup();
  const dialog = await open();
  check('settings: panel has no unnecessary spoken-reply toggle', await dialog.getByText('Voice on').count() === 0);
  await tap(dialog.getByRole('button', { name: 'Close' }));
  await dialog.waitFor({ state: 'hidden' });
  await page.goto(baseUrl + 'g/' + gym.slug + '/settings', { waitUntil: 'networkidle' });
  const sw = page.getByRole('switch', { name: 'XS AI spoken replies' });
  await sw.waitFor();
  check('Malayalam STT has no opt-in toggle, with a transparent privacy disclosure',
    await page.getByRole('switch', { name: 'Use Sarvam cloud speech for Malayalam' }).count() === 0 &&
    await page.getByText('Audio is captured only during your hold', { exact: false }).count() === 1);
  check('settings: spoken replies default OFF', !(await sw.isChecked()));
  await sw.check();
  check('settings: toggle ON is stored on this device',
    (await sw.isChecked()) &&
    await page.evaluate(() => localStorage.getItem('xs-ai-spoken-replies') === 'on'));
  await page.reload({ waitUntil: 'networkidle' });
  check('settings: ON survives reload', await page.getByRole('switch', { name: 'XS AI spoken replies' }).isChecked());
  await page.goto(baseUrl + 'g/' + gym.slug, { waitUntil: 'networkidle' });
  const again = await open();
  await again.getByRole('button', { name: 'Open keyboard' }).tap();
  await again.getByRole('textbox', { name: 'Message XS AI' }).fill('Please answer');
  await tap(again.getByRole('button', { name: 'Send' }));
  await waitCount(page, 1);
  check('settings: opted-in reply appears as text and speaks once',
    logs.agent.length === 1 && (await page.evaluate(() => window.__tts.calls.length)) === 1 &&
    (await again.getByText('I understood.').count()) === 1 && await idleMic(page));
  await tap(again.getByRole('button', { name: 'Close' }));
  await again.waitFor({ state: 'hidden' });
  await page.goto(baseUrl + 'g/' + gym.slug + '/settings', { waitUntil: 'networkidle' });
  const onSwitch = page.getByRole('switch', { name: 'XS AI spoken replies' });
  await onSwitch.uncheck();
  check('settings: OFF is persisted immediately',
    !(await onSwitch.isChecked()) &&
    await page.evaluate(() => localStorage.getItem('xs-ai-spoken-replies') === 'off'));
  await ctx.close();
}

// Real browser-rendered visuals and real interactive controls, but synthetic
// gym data/replies. Never capture any live member or payment information.
{
  const { ctx, page, logs, open, tap, errors } = await setup();
  const dialog = await open();
  const welcome = dialog.locator('.xsai-welcome');
  await welcome.waitFor();
  check('agent welcome: no duplicate copilot/ready box and three shortcuts',
    await dialog.locator('.xsai-agent-bar').count() === 0 &&
    await dialog.getByText('Gym copilot').count() === 0 &&
    await dialog.getByText('Ready', { exact: true }).count() === 0 &&
    await dialog.locator('.xsai-shortcut').count() === 3);
  check('agent welcome: no horizontal overflow on iPhone',
    await page.evaluate(() => {
      const el = document.querySelector('.xsai');
      return !!el && el.scrollWidth <= el.clientWidth + 2 &&
        document.documentElement.scrollWidth <= window.innerWidth + 2;
    }));
  await page.waitForTimeout(350);
  await page.screenshot({ path: screenshotDir + '/01-mobile-agent-welcome.png' });
  await tap(dialog.getByRole('button', { name: "Today's collections" }));
  await waitCount(page, 1);
  check('quick question: collections sends only the read-only question',
    logs.agent.length === 1 &&
    logs.agent[0].messages.at(-1).content === 'How much did we collect today?' &&
    logs.transcribe.length === 0 &&
    await dialog.locator('.xsai-welcome').count() === 0);
  await page.waitForTimeout(450); // capture the finished animation, not a faded frame
  await page.screenshot({ path: screenshotDir + '/02-mobile-agent-conversation.png' });
  await tap(dialog.getByRole('button', { name: 'Copy reply' }));
  check('agent response: copy button copies the visible reply',
    await page.evaluate(() => window.__clipboard.at(-1) === 'I understood.') &&
    await dialog.getByRole('button', { name: 'Reply copied' }).count() === 1);
  await tap(dialog.getByRole('button', { name: 'New conversation' }));
  check('agent new conversation: resets only session UI, never backend data',
    await dialog.locator('.xsai-welcome').count() === 1 &&
    await dialog.locator('.xsai-turn.user').count() === 0 &&
    logs.agent.length === 1 &&
    await dialog.locator('.xsai-orb').getAttribute('aria-pressed') === 'false');
  await tap(dialog.getByRole('button', { name: 'Pending dues' }));
  await waitCount(page, 1);
  check('agent new conversation: follow-up uses new isolated conversation history',
    logs.agent.length === 2 && logs.agent[1].messages.length === 1 &&
    logs.agent[1].messages[0].content === 'Who has pending membership dues?');
  await tap(dialog.getByRole('button', { name: 'New conversation' }));
  await dialog.locator('.xsai-welcome').waitFor();
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await page.waitForTimeout(500); // wait for segmented control/color transitions
  await page.screenshot({ path: screenshotDir + '/03-mobile-agent-dark.png' });
  check('agent dark appearance: designed hero and composer remain visible',
    await dialog.locator('.xsai-welcome-visual').isVisible() &&
    await dialog.locator('.xsai-composer').isVisible() && errors.length === 0, errors.join(' | '));
  await ctx.close();
}
{
  const { ctx, page, logs, open, tap, errors } = await setup({ mobile: false });
  const dialog = await open();
  await page.waitForTimeout(350);
  await page.screenshot({ path: screenshotDir + '/04-desktop-agent-welcome.png' });
  await tap(dialog.getByRole('button', { name: 'Upcoming renewals' }));
  await waitCount(page, 1);
  await page.waitForTimeout(450);
  await page.screenshot({ path: screenshotDir + '/05-desktop-agent-conversation.png' });
  check('agent desktop: shortcut and copy controls fit the wider workspace',
    logs.agent.length === 1 &&
    await dialog.locator('.xsai-locale-row').isVisible() &&
    await dialog.getByRole('button', { name: 'Copy reply' }).isVisible() &&
    await page.evaluate(() => {
      const el = document.querySelector('.xsai');
      return !!el && el.scrollWidth <= el.clientWidth + 2;
    }) && errors.length === 0, errors.join(' | '));
  await ctx.close();
}

await browser.close();
console.log(failures ? failures + ' XS AI MINIMAL VOICE FAILURES' : 'XS AI MINIMAL VOICE OK');
process.exit(failures ? 1 : 0);
