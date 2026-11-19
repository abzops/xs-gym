// Subscription screens in a real browser against the production build, with
// the Supabase API mocked (synthetic data; no request leaves the machine).
// Checks each screen at phone and laptop sizes: right content, no horizontal
// overflow, no console errors. Saves screenshots to OUT_DIR.
//   node tests/ui/billing.mjs <playwright-module-path> <base-url> <out-dir>
// Set CHROME=/path/to/chrome to use an installed browser.
import { createRequire } from 'node:module';
import { ENTITLEMENTS, gym, mockApi, state } from './mock.mjs';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);
const browser = await chromium.launch(process.env.CHROME ? { executablePath: process.env.CHROME } : {});
const g = `g/${gym.slug}`;
let failures = 0;

const cases = [
  // name, path, entitlements, admin role, check(page) → true when right
  ['pricing', 'pricing', 'trial', null, async (p) => {
    await p.getByText('Compare plans').waitFor();
    const cards = await p.locator('.plan-card').count();
    await p.getByRole('button', { name: /Yearly/ }).click();
    const yearly = await p.getByText('/ year').count();
    return cards === 3 && yearly === 3 && (await p.getByText('Provisional price').count()) === 3;
  }],
  ['billing-trial', `${g}/billing`, 'trial', null, async (p) => {
    await p.getByText('Choose a plan').waitFor();
    await p.getByRole('button', { name: 'Choose Growth' }).click();
    await p.getByRole('button', { name: /Pay ₹999 with Razorpay/ }).waitFor();
    const ok = (await p.getByText('no trial days are lost').count()) === 1 && (await p.getByText(/Provisional price\. Online payment opens/).count()) === 1;
    await p.screenshot({ path: `${outDir}/${p.vp}-billing-checkout.png` });
    return ok;
  }],
  ['billing-growth', `${g}/billing`, 'growth', null, async (p) => {
    await p.getByText('Change or renew').waitFor();
    return (await p.getByRole('button', { name: 'Pay for next period' }).count()) === 1
      && (await p.getByRole('button', { name: 'Switch at period end' }).count()) === 1
      && (await p.getByRole('button', { name: 'Upgrade to Pro' }).count()) === 1;
  }],
  ['analytics-starter', `${g}/analytics`, 'starter', null, async (p) => {
    await p.getByText('Net collected').first().waitFor();        // Daily report stays on every plan
    await p.getByRole('button', { name: 'Overview' }).click();
    await p.getByText('See how your gym is doing').waitFor();
    return (await p.locator('.xsai-floating-launcher').count()) === 0;
  }],
  ['enquiries-starter', `${g}/enquiries`, 'starter', null, async (p) => {
    await p.getByText('Never lose a walk-in or Instagram lead').waitFor();
    return (await p.getByRole('button', { name: 'Add enquiry' }).count()) === 0 && (await p.getByText('Sneha Pillai').count()) > 0;
  }],
  ['expired', `${g}/billing`, 'expired', null, async (p) => {
    await p.getByText(/Subscription ended\. You can view and export/).waitFor();
    return (await p.getByRole('button', { name: /Download CSV/ }).count()) === 1;
  }],
  ['past-due', `${g}/members`, 'pastdue', null, async (p) => {
    await p.getByText(/Everything keeps working until/).waitFor();
    return true;
  }],
  ['pilot-settings', `${g}/settings`, 'pilot', null, async (p) => {
    await p.getByText(/Pilot gym: complimentary access/).waitFor();
    return true;
  }],
  ['invoice', `${g}/billing/invoice/inv1`, 'growth', null, async (p) => {
    await p.getByText('TEST — NOT A REAL PAYMENT').waitFor();
    return (await p.getByText('TEST/2026-27/0003').count()) === 1;
  }],
  ['admin-overview', 'admin', 'trial', 'owner', async (p) => {
    await p.getByText('Profitability').waitFor();
    return (await p.getByText('₹999').count()) > 0 && (await p.getByText(/test payment\(s\) this month — not counted as revenue/).count()) === 1;
  }],
  ['admin-customers', 'admin', 'trial', 'owner', async (p) => {
    await p.getByRole('button', { name: 'Customers' }).click();
    await p.getByText('CHAOS COMBAT').waitFor();
    await p.getByText('CHAOS COMBAT').click();
    await p.getByRole('button', { name: 'Extend trial' }).waitFor();
    return true;
  }],
  ['admin-pricing', 'admin', 'trial', 'owner', async (p) => {
    await p.getByRole('button', { name: 'Pricing' }).click();
    await p.getByRole('button', { name: 'Activate' }).first().waitFor();
    return (await p.getByRole('button', { name: 'Activate' }).count()) === 3;
  }],
  ['admin-refused', 'admin', 'trial', null, async (p) => {
    await p.getByText('This page is for the Xelorsoft team.').waitFor();
    return true;
  }],
];

for (const [vp, w, h] of [['phone', 390, 844], ['laptop', 1366, 768]]) {
  for (const [name, path, entKey, admin, check] of cases) {
    state.entitlements = ENTITLEMENTS[entKey];
    state.admin = admin;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await mockApi(ctx);
    const page = await ctx.newPage();
    page.vp = vp;
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    let ok = false, why = '';
    try {
      await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
      ok = await check(page);
      if (!ok) why = 'content check failed';
    } catch (e) { why = String(e.message).split('\n')[0]; }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    if (overflow) { ok = false; why += ' OVERFLOW'; }
    if (errors.length) { ok = false; why += ' errors=' + errors.join(' | ').slice(0, 300); }
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${vp.padEnd(7)} ${name.padEnd(18)} ${why}`);
    await page.screenshot({ path: `${outDir}/${vp}-${name}.png`, fullPage: true });
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `${failures} FAILED` : 'ALL BILLING SCREENS OK');
process.exit(failures ? 1 : 0);
