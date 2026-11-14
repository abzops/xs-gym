// XS AI in a real browser against mocked gym data: launcher, chat, approval
// cards (Approve / Cancel / Undo) and the microphone round trip. Chromium's
// fake microphone supplies audio; no customer database or AI provider is used.
//   node tests/ui/xs-ai.mjs <path to playwright index.js> <app base URL> [executablePath]
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { REF, gym, mockApi } from './mock.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const baseUrl = process.argv[3];
const browser = await chromium.launch({
  executablePath: process.argv[4] || undefined,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
});
const shots = '/tmp/xs-ai-screens';
await mkdir(shots, { recursive: true });
let failures = 0;
async function step(name, fn) {
  try { await fn(); console.log('ok   ' + name); }
  catch (e) { failures++; console.log('FAIL ' + name + ' — ' + (e?.message ?? e).split('\n')[0]); }
}

const card = (tool, title, titleMl, lines, danger = false) => ({ id: crypto.randomUUID(), tool, args: { member_id: 'm1', amount_paise: 150000, method: 'upi' }, title, titleMl, lines, danger });

for (const device of [
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true },
  { name: 'laptop', viewport: { width: 1280, height: 800 } },
]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch, colorScheme: scheme });
    await mockApi(ctx);
    await ctx.addInitScript((s) => { localStorage.setItem('xs-theme', s); localStorage.setItem('xs-ai-lang', 'en'); }, scheme);
    const calls = [];
    await ctx.route(`https://${REF}.supabase.co/functions/v1/xs-ai`, async (route) => {
      const req = route.request();
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204 });
      const b = JSON.parse(req.postData() ?? '{}');
      calls.push(b);
      await new Promise((r) => setTimeout(r, 150));
      let res;
      if (b.approve) res = { reply: 'Done ✓ ₹1,500 UPI recorded for Rahul Krishnan.', actions: b.approve.map(() => ({ tool: 'record_payment', ok: true, summary: '₹1,500 UPI recorded for Rahul Krishnan', undo: { rpc: 'reverse_payment', args: { p_gym: gym.id } } })), changed: ['payments'] };
      else if (b.audio) res = { heard: 'Rahul paid 1500 by UPI', reply: 'Shall I do this?', pending: [card('record_payment', 'Record payment', 'പേയ്മെന്റ് രേഖപ്പെടുത്തുക', ['Rahul Krishnan · XS-0001', '₹1,500 · UPI', 'Due now ₹500'])], actions: [], changed: [] };
      else if (/archive/i.test(b.messages.at(-1).content)) res = { reply: 'Shall I do this?', pending: [card('set_member_status', 'Archive member', 'മെമ്പറെ ആർക്കൈവ് ചെയ്യുക', ['Anjali Menon · XS-0002', 'Reason: moved away'], true)], actions: [], changed: [] };
      else if (/paid/i.test(b.messages.at(-1).content)) res = { reply: 'Shall I do this?', pending: [card('record_payment', 'Record payment', 'പേയ്മെന്റ് രേഖപ്പെടുത്തുക', ['Rahul Krishnan · XS-0001', '₹1,500 · UPI', 'Due now ₹500'])], actions: [], changed: [] };
      else res = { reply: '3 members owe ₹2,350:\nRahul Krishnan (XS-0001): ₹500', actions: [], changed: [] };
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(res) });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const tag = `${device.name}-${scheme}`;
    await page.goto(baseUrl + 'g/' + gym.slug, { waitUntil: 'networkidle' });

    await step(`${tag}: launcher opens a clean chat`, async () => {
      if (device.name === 'phone') await page.getByRole('button', { name: 'Open XS AI' }).tap();
      else await page.locator('.sidebar .xsai-side').click();
      const dialog = page.getByRole('dialog', { name: 'XS AI' });
      await dialog.waitFor();
      await page.getByText('I always ask before changing anything').waitFor();
      assert.equal(await page.locator('.xsai-chips button').count(), 4);
      await page.screenshot({ path: `${shots}/${tag}-01-hello.png` });
    });

    await step(`${tag}: a question is answered with no approval card`, async () => {
      await page.locator('.xsai-chips button', { hasText: 'Who has dues' }).click();
      await page.getByText('3 members owe ₹2,350').waitFor();
      assert.equal(await page.locator('.xsai-card').count(), 0);
    });

    await step(`${tag}: a change shows a card and waits for Approve`, async () => {
      await page.getByLabel('Message XS AI').fill('Rahul paid 1500 by UPI');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.getByText('₹1,500 · UPI').waitFor();
      const before = calls.filter((c) => c.approve).length;
      assert.equal(before, 0, 'nothing may be approved automatically');
      await page.screenshot({ path: `${shots}/${tag}-02-approval.png` });
      await page.getByRole('button', { name: 'Approve', exact: true }).click();
      await page.getByRole('button', { name: /Undo/ }).waitFor();
      const sent = calls.find((c) => c.approve);
      assert.equal(sent.approve.length, 1);
      assert.equal(sent.approve[0].tool, 'record_payment');
      assert.ok(sent.approve[0].id && sent.approve[0].args.member_id, 'approval carries id and prepared args');
      assert.equal(await page.getByRole('button', { name: 'Approve', exact: true }).count(), 0);
      await page.screenshot({ path: `${shots}/${tag}-03-done.png` });
    });

    await step(`${tag}: Cancel changes nothing`, async () => {
      const approvals = calls.filter((c) => c.approve).length;
      await page.getByLabel('Message XS AI').fill('archive Anjali, she moved away');
      await page.getByRole('button', { name: 'Send' }).click();
      await page.locator('.xsai-card.danger').waitFor();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
      await page.getByText('Cancelled').waitFor();
      assert.equal(calls.filter((c) => c.approve).length, approvals);
    });

    await step(`${tag}: microphone records and sends audio, then shows what was heard`, async () => {
      const mic = page.getByRole('button', { name: 'Talk to XS AI' });
      if (device.hasTouch) await mic.tap(); else await mic.click();
      await page.locator('.xsai-recbar').waitFor();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: `${shots}/${tag}-04-listening.png` });
      await page.getByRole('button', { name: 'Send voice' }).click();
      await page.locator('.xsai-msg.user .xsai-bubble:has(.xsai-voice-tag)', { hasText: 'Rahul paid 1500 by UPI' }).waitFor();
      const voice = calls.find((c) => c.audio);
      assert.ok(voice, 'a voice request was sent');
      assert.ok(voice.audio.data.length > 1000, 'audio was captured');
      assert.match(voice.audio.mime, /^audio\//);
      await page.locator('.xsai-card').last().waitFor();
      await page.screenshot({ path: `${shots}/${tag}-05-voice-card.png` });
    });

    await step(`${tag}: no page errors`, async () => { assert.deepEqual(errors, []); });
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `${failures} XS AI UI FAILURES` : 'XS AI UI OK');
process.exit(failures ? 1 : 0);
