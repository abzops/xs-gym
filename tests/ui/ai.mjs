// XS AI panel: entry points, voice (simulated microphone and speaker), typing,
// action cards with Undo, Malayalam mode, light/dark. The agent endpoint is
// mocked; the agent itself is tested in tests/ai/agent.test.mjs.
//   node tests/ui/ai.mjs <playwright-module-path> <base-url> <out-dir>
import { createRequire } from 'node:module';
import { REF, body, gym, session } from './mock.mjs';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch();
let failures = 0;
const check = (name, ok, detail = '') => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`); };

// A fake microphone that "hears" window.__say, and a speaker that records what it said.
const fakeSpeech = () => {
  window.__spoken = [];
  class FakeRecognition {
    start() { this.lang_used = this.lang; window.__recLang = this.lang; setTimeout(() => {
      const t = window.__say ?? '';
      this.onresult?.({ results: [Object.assign([{ transcript: t.slice(0, 8) }], { isFinal: false })] });
      setTimeout(() => { this.onresult?.({ results: [Object.assign([{ transcript: t }], { isFinal: true })] }); this.onend?.(); }, 250);
    }, 200); }
    stop() { this.onend?.(); } abort() {}
  }
  window.SpeechRecognition = FakeRecognition;
  const voices = [{ name: 'Google English India', lang: 'en-IN' }];
  Object.defineProperty(window, 'speechSynthesis', { value: {
    getVoices: () => voices, cancel() {}, addEventListener() {},
    speak(u) { window.__spoken.push({ text: u.text, lang: u.lang }); setTimeout(() => u.onend?.(), 300); },
  } });
  window.SpeechSynthesisUtterance = class { constructor(t) { this.text = t; } };
};

for (const [name, viewport, mobile] of [['phone', { width: 390, height: 844 }, true], ['laptop', { width: 1366, height: 860 }, false]]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
    await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
    await ctx.addInitScript(fakeSpeech);
    const sent = []; const rpcs = [];
    await ctx.route(`https://${REF}.supabase.co/**`, async (route) => {
      const req = route.request(); const url = req.url();
      if (url.includes('/functions/v1/xs-ai')) {
        const b = JSON.parse(req.postData() ?? '{}'); sent.push(b);
        const q = b.messages.at(-1).content;
        await new Promise((r) => setTimeout(r, 500));
        const pay = /paid|അടച്ചു/.test(q);
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(pay
          ? { reply: b.lang === 'ml' ? 'രാഹുലിന്റെ ₹1,500 UPI രേഖപ്പെടുത്തി.' : 'Recorded ₹1,500 UPI from Rahul Krishnan.', changed: ['payments', 'dashboard'],
              actions: [{ tool: 'record_payment', ok: true, summary: '₹1,500 UPI recorded', undo: { rpc: 'reverse_payment', args: { p_gym: gym.id, p_payment: 'p-1', p_reason: 'Undone in XS AI' } } }] }
          : { reply: 'You collected ₹18,500 today: ₹11,000 cash and ₹7,500 UPI.', actions: [], changed: [] }) });
      }
      if (url.includes('/rpc/reverse_payment')) rpcs.push(JSON.parse(req.postData()));
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
    check(`${name} ${scheme}: entry point visible`, await entry.isVisible());
    await tap(entry);
    const dialog = page.getByRole('dialog', { name: 'XS AI' });
    await dialog.waitFor();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-empty.png` });

    // Voice: tap the orb, the fake mic hears a payment.
    await page.evaluate(() => { window.__say = 'Rahul paid 1500 by UPI'; });
    await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
    await page.waitForTimeout(350);
    const listening = await dialog.locator('.xsai-orb.listening').count();
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-listening.png` });
    await dialog.locator('.xsai-action').first().waitFor({ timeout: 6000 });
    await page.waitForTimeout(150);
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-action.png` });
    const spoken = await page.evaluate(() => window.__spoken);
    check(`${name} ${scheme}: voice → transcript sent with gym and language`, listening === 1 && sent[0]?.messages.at(-1).content === 'Rahul paid 1500 by UPI' && sent[0].gym_id === gym.id && sent[0].lang === 'en');
    check(`${name} ${scheme}: reply shown and spoken in en-IN`, (await dialog.innerText()).includes('Recorded ₹1,500') && spoken[0]?.lang === 'en-IN');
    await tap(dialog.getByRole('button', { name: 'Undo' }));
    await page.waitForTimeout(500);
    check(`${name} ${scheme}: Undo calls reverse_payment`, rpcs[0]?.p_payment === 'p-1' && (await dialog.locator('.xsai-action.undone').count()) === 1);

    // Typing, follow-up keeps the conversation.
    await dialog.getByRole('textbox', { name: 'Message XS AI' }).fill('How much did we collect today?');
    await dialog.getByRole('textbox', { name: 'Message XS AI' }).press('Enter');
    await dialog.getByText('You collected ₹18,500').waitFor({ timeout: 6000 });
    check(`${name} ${scheme}: typed follow-up carries history`, sent[1]?.messages.length === 3);

    // Malayalam: recognition in ml-IN; no Malayalam voice → text-only note.
    await tap(dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }));
    await page.evaluate(() => { window.__say = 'രാഹുൽ 1500 UPI ആയി അടച്ചു'; });
    await tap(dialog.getByRole('button', { name: 'Talk to XS AI' }));
    await dialog.getByText('രാഹുലിന്റെ').waitFor({ timeout: 6000 });
    const recLang = await page.evaluate(() => window.__recLang);
    await page.waitForTimeout(300);
    check(`${name} ${scheme}: Malayalam listens in ml-IN and asks for Malayalam`, recLang === 'ml-IN' && sent.at(-1).lang === 'ml' && (await dialog.innerText()).includes('replies shown as text'));
    await page.screenshot({ path: `${outDir}/ai-${name}-${scheme}-malayalam.png` });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    check(`${name} ${scheme}: no overflow, no errors`, !overflow && errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `${failures} AI UI FAILURES` : 'AI UI OK');
process.exit(failures ? 1 : 0);
