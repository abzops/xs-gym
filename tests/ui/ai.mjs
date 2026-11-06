// XS AI panel on phone and laptop, light and dark, with a fake microphone that
// produces real audio through Web Audio (silence → ~0.7 s of "speech" → silence),
// so the app's own recorder, end-of-speech detection and WAV encoding all run.
// The xs-ai endpoint is mocked (transcription + agent); the agent itself is
// tested against the real schema in tests/ai/agent.check.mjs.
//   node tests/ui/ai.mjs <playwright-module-path> <base-url> <out-dir>
import { createRequire } from 'node:module';
import { REF, body, gym, session } from './mock.mjs';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch({ args: ['--autoplay-policy=no-user-gesture-required'] });
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

const fakeDevice = ({ standalone }) => {
  window.__mic = { allow: true, speakMs: 700, opened: 0, stopped: 0 };
  window.__spoken = [];
  if (standalone) {
    Object.defineProperty(navigator, 'standalone', { value: true });
    Object.defineProperty(navigator, 'userAgent', { value: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148' });
    // The installed iPhone app has no working speech recognition.
    delete window.SpeechRecognition; delete window.webkitSpeechRecognition;
  }
  navigator.mediaDevices.getUserMedia = async () => {
    if (!window.__mic.allow) throw new DOMException('Permission denied', 'NotAllowedError');
    const ctx = new AudioContext();
    const osc = ctx.createOscillator(); osc.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0;
    const dst = ctx.createMediaStreamDestination();
    osc.connect(g); g.connect(dst); osc.start();
    if (window.__mic.speakMs) {
      const t = ctx.currentTime + 0.5;
      g.gain.setValueAtTime(0.4, t); g.gain.setValueAtTime(0, t + window.__mic.speakMs / 1000);
    }
    window.__mic.opened++;
    const stream = dst.stream;
    for (const track of stream.getTracks()) { const stop = track.stop.bind(track); track.stop = () => { window.__mic.stopped++; stop(); }; }
    return stream;
  };
  const voices = [{ name: 'Google English India', lang: 'en-IN' }];
  Object.defineProperty(window, 'speechSynthesis', { value: {
    getVoices: () => voices, cancel() {}, addEventListener() {},
    speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 300); },
  } });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
};

/** Header of a base64 WAV: RIFF/WAVE, mono, 16 kHz, 16-bit, and its duration. */
function wavInfo(b64) {
  const b = Buffer.from(b64, 'base64');
  return { riff: b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE', channels: b.readUInt16LE(22), rate: b.readUInt32LE(24), bits: b.readUInt16LE(34), seconds: b.readUInt32LE(40) / 32000 };
}

async function setup({ viewport, mobile, scheme, standalone = false, stt = true, sttErrorCode = null }) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.addInitScript(fakeDevice, { standalone });
  const log = { transcribe: [], agent: [], rpcs: [], say: 'Rahul paid 1500 by UPI' };
  await ctx.route(`https://${REF}.supabase.co/**`, async (route) => {
    const req = route.request(); const url = req.url();
    if (url.includes('/functions/v1/xs-ai')) {
      if (req.method() === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true, stt, providers: [] }) });
      const b = JSON.parse(req.postData() ?? '{}');
      if (b.transcribe) {
        log.transcribe.push(b.transcribe);
        if (!stt) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Voice needs a speech key. The gym owner can add GROQ_API_KEY in Supabase. You can type instead.' }) });
        if (sttErrorCode && b.transcribe.lang === 'ml') {
          await new Promise((r) => setTimeout(r, 130));
          return route.fulfill({
            status: 503, contentType: 'application/json',
            body: JSON.stringify({ error: 'Malayalam speech provider denied API access (403).', code: sttErrorCode, language: 'ml', retryable: false }),
          });
        }
        await new Promise((r) => setTimeout(r, 200));
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: log.say }) });
      }
      log.agent.push(b);
      const q = b.messages.at(-1).content;
      await new Promise((r) => setTimeout(r, 300));
      const pay = /paid|അടച്ചു/.test(q);
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pay
        ? { reply: b.lang === 'ml' ? 'ശരി. രാഹുൽ: ₹1,500 UPI രേഖപ്പെടുത്തി.' : 'Done. ₹1,500 UPI recorded for Rahul Krishnan.', changed: ['payments', 'dashboard'],
            actions: [{ tool: 'record_payment', ok: true, summary: '₹1,500 UPI recorded for Rahul Krishnan', undo: { rpc: 'reverse_payment', args: { p_gym: gym.id, p_payment: 'p-1', p_reason: 'Undone in XS AI' } } }] }
        : { reply: 'You collected ₹18,500 today: ₹11,000 cash and ₹7,500 UPI.', actions: [], changed: [] }) });
    }
    if (url.includes('/rpc/reverse_payment')) log.rpcs.push(JSON.parse(req.postData()));
    const accept = req.headers()['accept'] ?? '';
    let data = body(url);
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
  const tap = (l) => (mobile ? l.tap() : l.click());
  const entry = mobile ? page.locator('.topbar .xsai-entry') : page.locator('.sidebar .xsai-side');
  return { ctx, page, log, errors, tap, entry, dialog: page.getByRole('dialog', { name: 'XS AI' }) };
}
const orb = (d) => d.getByRole('button', { name: /Talk to XS AI|Stop listening/ });

for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['laptop', { width: 1366, height: 860 }, false]]) {
  for (const scheme of ['light', 'dark']) {
    const t = `${name} ${scheme}`;
    const { ctx, page, log, errors, tap, entry, dialog } = await setup({ viewport, mobile, scheme });
    check(`${t}: entry point visible`, await entry.isVisible());
    await tap(entry); await dialog.waitFor(); await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-empty.png` });

    // One tap → recording starts (no extra permission screen), stops by itself after speech.
    await tap(orb(dialog));
    await page.waitForTimeout(900);
    const listening = await dialog.locator('.xsai-orb.listening').count();
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-listening.png` });
    await dialog.locator('.xsai-action').first().waitFor({ timeout: 10_000 });
    const w = wavInfo(log.transcribe[0]?.audio ?? '');
    const mic = await page.evaluate(() => window.__mic);
    check(`${t}: one tap records; no extra permission screen`, listening === 1 && (await dialog.locator('.xsai-mic-dialog').count()) === 0);
    check(`${t}: stops by itself and sends 16 kHz mono WAV`, w.riff && w.channels === 1 && w.rate === 16000 && w.bits === 16 && w.seconds > 0.5 && w.seconds < 6, JSON.stringify(w));
    check(`${t}: microphone released after recording`, mic.opened === 1 && mic.stopped === mic.opened);
    check(`${t}: transcript goes to the agent with gym and language`, log.transcribe[0]?.lang === 'en' && log.agent[0]?.messages.at(-1).content === 'Rahul paid 1500 by UPI' && log.agent[0].gym_id === gym.id && log.agent[0].lang === 'en');
    await page.waitForTimeout(400);
    const spoken = await page.evaluate(() => window.__spoken);
    check(`${t}: reply shown and spoken`, (await dialog.innerText()).includes('₹1,500 UPI recorded') && spoken[0]?.lang === 'en-IN');
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-action.png` });
    const undo = dialog.getByRole('button', { name: 'Undo' });
    await Promise.all([tap(undo), tap(undo).catch(() => {})]);
    await page.waitForTimeout(500);
    check(`${t}: Undo runs once under a double tap`, log.rpcs.length === 1 && log.rpcs[0].p_payment === 'p-1' && (await dialog.locator('.xsai-action.undone').count()) === 1);

    // Typing still works and keeps the conversation.
    const box = dialog.getByRole('textbox', { name: 'Message XS AI' });
    await box.fill('How much did we collect today?'); await box.press('Enter');
    await dialog.getByText('You collected ₹18,500').waitFor({ timeout: 6000 });
    check(`${t}: typed follow-up carries history`, log.agent[1]?.messages.length === 3);

    // Malayalam: transcription and replies in Malayalam.
    await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
    log.say = 'രാഹുൽ 1500 UPI ആയി അടച്ചു';
    await tap(orb(dialog));
    await dialog.getByText('ശരി. രാഹുൽ').waitFor({ timeout: 10_000 });
    check(`${t}: Malayalam transcribes as ml and replies in Malayalam`, log.transcribe.at(-1).lang === 'ml' && log.agent.at(-1).lang === 'ml');
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-malayalam.png` });

    // Denied microphone: explained inside XS AI, retry works, keyboard offered.
    await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'English' }));
    await page.evaluate(() => { window.__mic.allow = false; });
    const before = log.transcribe.length;
    await tap(orb(dialog));
    const help = dialog.locator('.xsai-mic-dialog');
    await help.waitFor({ timeout: 4000 });
    check(`${t}: denied microphone shows in-app help, sends nothing`, /permission/i.test(await help.innerText()) && log.transcribe.length === before && (await help.getByRole('button', { name: /keyboard/i }).count()) === 1);
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-denied.png` });
    await page.evaluate(() => { window.__mic.allow = true; });
    log.say = 'Rahul paid 1500 by UPI';
    await tap(help.getByRole('button', { name: 'Try again' }));
    await page.waitForFunction((n) => window.__mic.opened > n, mic.opened, { timeout: 4000 }).catch(() => {});
    await page.waitForTimeout(3500);
    check(`${t}: Try again records without leaving the app`, log.transcribe.length === before + 1);

    // Closing mid-recording sends nothing and releases the microphone.
    const n = log.transcribe.length;
    await tap(orb(dialog)); await page.waitForTimeout(300);
    await tap(dialog.getByRole('button', { name: 'Close' }));
    await page.waitForTimeout(2500);
    const m2 = await page.evaluate(() => window.__mic);
    check(`${t}: closing while recording sends nothing, mic released`, log.transcribe.length === n && m2.stopped === m2.opened);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`${t}: no overflow, no errors`, !overflow && errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}

// Installed iPhone app with no speech key on the server: explained in the app, nothing breaks.
{
  const { ctx, page, log, tap, entry, dialog, errors } = await setup({ viewport: { width: 393, height: 852 }, mobile: true, scheme: 'light', standalone: true, stt: false });
  await tap(entry); await dialog.waitFor(); await page.waitForTimeout(500);
  await tap(orb(dialog));
  const help = dialog.locator('.xsai-mic-dialog');
  await help.waitFor({ timeout: 4000 });
  check('iPhone app, no speech key: in-app "not set up" help, no recording, keyboard offered',
    /needs a transcription service|not set up/i.test(await help.innerText()) && log.transcribe.length === 0 && (await page.evaluate(() => window.__mic.opened)) === 0);
  await tap(help.getByRole('button', { name: /keyboard/i }));
  await page.waitForTimeout(300);
  check('iPhone app, no speech key: keyboard fallback focuses the message box', await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Message XS AI') && errors.length === 0);
  await page.screenshot({ path: `${outDir}/ai-iphone-app-setup.png` });
  await ctx.close();
}

// Installed iPhone app with the speech key: records and works.
{
  const { ctx, page, log, tap, entry, dialog } = await setup({ viewport: { width: 393, height: 852 }, mobile: true, scheme: 'dark', standalone: true, stt: true });
  await tap(entry); await dialog.waitFor(); await page.waitForTimeout(500);
  await tap(orb(dialog));
  await dialog.locator('.xsai-action').first().waitFor({ timeout: 10_000 });
  check('iPhone app with speech key: voice command works end to end', log.transcribe.length === 1 && log.agent.length === 1);
  await ctx.close();
}

// Real incident: installed iPhone recorded Malayalam successfully, but its
// only configured Malayalam cloud transcription provider returned HTTP 403.
// Show permission diagnosis without trying the same doomed recording again.
{
  const { ctx, page, log, tap, entry, dialog, errors } = await setup({
    viewport: { width: 393, height: 852 }, mobile: true, scheme: 'light',
    standalone: true, stt: true, sttErrorCode: 'speech_access_denied',
  });
  await tap(entry); await dialog.waitFor(); await page.waitForTimeout(500);
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
  await tap(orb(dialog));
  const help = dialog.locator('.xsai-mic-dialog');
  await help.waitFor({ timeout: 10_000 });
  check('iPhone Malayalam 403: identifies rejected cloud API, not denied microphone',
    /API.*403/.test(await help.innerText()) && log.transcribe.length === 1 && log.agent.length === 0);
  check('iPhone Malayalam 403: keyboard dictation is the primary recovery action',
    await help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }).getAttribute('class')?.then((c) => c.includes('primary')));
  await tap(help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  // React removes the overlay after the tap, then the fallback focus lands in
  // the next animation frame. Assert the settled state, not a mid-render race.
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Message XS AI',
    { timeout: 1000 });
  check('iPhone Malayalam 403: keyboard fallback receives focus on the user tap',
    await page.evaluate(() => document.activeElement?.getAttribute('aria-label') === 'Message XS AI'));
  await tap(orb(dialog));
  await help.waitFor();
  check('iPhone Malayalam 403: repeated microphone tap does not upload another doomed recording',
    log.transcribe.length === 1 && /API.*403/.test(await help.innerText()));
  await tap(help.getByRole('button', { name: 'കീബോർഡ് ഉപയോഗിക്കുക' }));
  await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'English' }));
  await tap(orb(dialog));
  await dialog.locator('.xsai-action').first().waitFor({ timeout: 10_000 });
  check('iPhone Malayalam 403: English remains available through its independent provider',
    log.transcribe.length === 2 && log.transcribe.at(-1).lang === 'en' && log.agent.length === 1 && errors.length === 0);
  await page.screenshot({ path: `${outDir}/ai-iphone-malayalam-api-403.png` });
  await ctx.close();
}

// Silence: nothing is sent.
{
  const { ctx, page, log, tap, entry, dialog } = await setup({ viewport: { width: 1366, height: 860 }, mobile: false, scheme: 'light' });
  await page.evaluate(() => { window.__mic.speakMs = 0; });
  await tap(entry); await dialog.waitFor();
  await tap(orb(dialog));
  await page.waitForTimeout(8500);
  check('silence: stops after a few seconds, sends nothing, says so', log.transcribe.length === 0 && /hear anything/i.test(await page.locator('.toasts').innerText()));
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} AI UI FAILURES` : 'AI UI OK');
process.exit(failures ? 1 : 0);
