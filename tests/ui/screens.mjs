// Renders the production build with mocked API responses and checks every
// main screen at phone, tablet and laptop sizes: no horizontal overflow, no
// console errors, primary content present. Saves screenshots to OUT_DIR.
//   node tests/ui/screens.mjs <playwright-module-path> <base-url> <out-dir>
import { createRequire } from 'node:module';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);

import { REF, body, gym, members, session } from './mock.mjs';

const ALL_VIEWPORTS = [['phone', 390, 844], ['phone-max', 440, 956], ['tablet', 768, 1024], ['ipad', 820, 1180], ['ipad-pro', 1032, 1376],
  ['tablet-land', 1024, 768], ['ipad-land', 1180, 820], ['laptop', 1366, 768], ['desktop', 1536, 864]];
// Optional filters: SIZES=phone-max,ipad-pro  SCHEME=dark
const only = process.env.SIZES ? process.env.SIZES.split(',') : null;
const viewports = only ? ALL_VIEWPORTS.filter(([n]) => only.includes(n)) : ALL_VIEWPORTS;
const colorScheme = process.env.SCHEME === 'dark' ? 'dark' : 'light';
const screens = [['dashboard', ''], ['members', '/members'], ['import', '/members/import'], ['member', `/members/${members[0].id}`],
  ['payments', '/payments'], ['receipt', '/receipts/py1'], ['plans', '/plans'], ['expenses', '/expenses'], ['analytics', '/analytics'], ['enquiries', '/enquiries'], ['settings', '/settings']];

const browser = await chromium.launch();
let failures = 0;
for (const [vpName, w, h] of viewports) {
  for (const [name, path, needle] of [['landing', '', 'Start free trial'], ['login', 'login', 'Sign in']]) {
    const page = await browser.newPage({ viewport: { width: w, height: h }, colorScheme });
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const ok = !overflow && errors.length === 0 && (await page.getByRole('link', { name: needle }).or(page.getByRole('button', { name: needle })).count()) > 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${vpName.padEnd(11)} ${name.padEnd(9)}${overflow ? ' OVERFLOW' : ''}${errors.length ? ' errors=' + errors.join(' | ') : ''}`);
    await page.screenshot({ path: `${outDir}/${colorScheme === 'dark' ? 'dark-' : ''}${vpName}-${name}.png`, fullPage: true });
    await page.close();
  }
}
for (const [vpName, w, h] of viewports) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, colorScheme });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.route(`https://${REF}.supabase.co/**`, (route) => {
    const accept = route.request().headers()['accept'] ?? '';
    let data = body(route.request().url());
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  for (const [name, path] of screens) {
    const page = await ctx.newPage();
    const errors = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${baseUrl}g/${gym.slug}${path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(150);
    const r = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
      h1: document.querySelector('main h1')?.textContent ?? '',
    }));
    const ok = !r.overflow && errors.length === 0 && r.h1.length > 0;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${vpName.padEnd(11)} ${name.padEnd(9)} h1="${r.h1}"${r.overflow ? ' OVERFLOW' : ''}${errors.length ? ' errors=' + errors.slice(0, 2).join(' | ') : ''}`);
    await page.screenshot({ path: `${outDir}/${colorScheme === 'dark' ? 'dark-' : ''}${vpName}-${name}.png`, fullPage: true });
    await page.close();
  }
  await ctx.close();
}
// Interaction flow on a phone: push into a member, open and close a sheet, go back.
{
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.route(`https://${REF}.supabase.co/**`, (route) => {
    const accept = route.request().headers()['accept'] ?? '';
    let data = body(route.request().url());
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${baseUrl}g/${gym.slug}/members`, { waitUntil: 'networkidle' });
  await page.locator('.list .item').first().tap();
  await page.waitForURL(/\/members\/[0-9a-f-]{36}/);
  const vt = await page.evaluate(() => document.documentElement.dataset.vt);
  await page.getByRole('button', { name: 'Payment' }).tap();
  const sheetOpen = await page.getByRole('dialog', { name: 'Record payment' }).isVisible();
  // Real touch gestures through Chrome's touch input.
  const cdp = await ctx.newCDPSession(page);
  const touch = async (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
  const sheetY = () => page.evaluate(() => { const m = getComputedStyle(document.querySelector('.sheet')).transform; return m === 'none' ? 0 : new DOMMatrix(m).m42; });
  await page.waitForTimeout(700);
  const grab = await page.locator('.sheet .handle').boundingBox();
  const gx = grab.x + grab.width / 2, gy = grab.y + 2;
  // 1. Pull up: rubber-bands (moves far less than the finger)
  await touch('touchStart', gx, gy);
  for (let i = 1; i <= 10; i++) { await touch('touchMove', gx, gy - i * 20); await page.waitForTimeout(16); }
  const pulledUp = await sheetY();
  await touch('touchEnd');
  await page.waitForTimeout(900);
  const settledAfterUp = Math.abs(await sheetY()) < 1;
  // 2. Short slow drag down: springs back
  await touch('touchStart', gx, gy);
  for (let i = 1; i <= 6; i++) { await touch('touchMove', gx, gy + i * 10); await page.waitForTimeout(60); }
  await page.waitForTimeout(200);
  await touch('touchEnd');
  await page.waitForTimeout(900);
  const springBack = (await page.getByRole('dialog').count()) === 1 && Math.abs(await sheetY()) < 1;
  // 3. Quick flick down: dismisses
  await touch('touchStart', gx, gy);
  for (let i = 1; i <= 4; i++) { await touch('touchMove', gx, gy + i * 30); await page.waitForTimeout(12); }
  await touch('touchEnd');
  await page.waitForTimeout(1000);
  const sheetClosed = (await page.getByRole('dialog').count()) === 0;
  const rubber = pulledUp < 0 && pulledUp > -200;
  console.log(`     gestures    pull-up moved ${pulledUp.toFixed(0)}px for a 200px drag (rubber-band ${rubber}), settled=${settledAfterUp}, slow drag springs back=${springBack}, flick dismisses=${sheetClosed}`);
  if (!rubber || !settledAfterUp || !springBack) failures++;
  await page.getByRole('link', { name: 'Members' }).first().tap();
  await page.waitForURL(/\/members$/);
  const ok = vt === 'push' && sheetOpen && sheetClosed && errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} flow        push=${vt} sheetOpen=${sheetOpen} sheetClosed=${sheetClosed}${errors.length ? ' errors=' + errors.join(' | ') : ''}`);
  await ctx.close();
}
// Appearance: the sidebar button cycles Auto → Light → Dark, the choice survives a reload
// (applied before first paint), and the phone "More" sheet switches it too.
{
  const mock = async (ctx) => {
    await ctx.addInitScript(([key, value]) => localStorage.setItem(key, value), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
    await ctx.route(`https://${REF}.supabase.co/**`, (route) => {
      const accept = route.request().headers()['accept'] ?? '';
      let data = body(route.request().url());
      if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
    });
  };
  const state = (page) => page.evaluate(() => ({
    theme: document.documentElement.dataset.theme,
    bg: getComputedStyle(document.body).backgroundColor,
    logo: [...document.querySelectorAll('.topbar .brand-mark, .sidebar .logo')].filter((e) => e.offsetParent).length,
  }));
  const desk = await browser.newContext({ viewport: { width: 1366, height: 900 }, colorScheme: 'light' });
  await mock(desk);
  const page = await desk.newPage();
  await page.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
  const start = await state(page);
  await page.getByRole('button', { name: /Appearance: Auto/ }).click();
  const light = await state(page);
  await page.getByRole('button', { name: /Appearance: Light/ }).click();
  const dark = await state(page);
  await page.screenshot({ path: `${outDir}/appearance-desktop-dark.png` });
  await page.reload({ waitUntil: 'domcontentloaded' });
  const early = await page.evaluate(() => document.documentElement.dataset.theme);
  await desk.close();

  const phone = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true, isMobile: true });
  await mock(phone);
  const p2 = await phone.newPage();
  await p2.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
  const before = await state(p2);
  await p2.getByRole('button', { name: 'More' }).tap();
  await p2.getByRole('group', { name: 'Appearance' }).getByRole('button', { name: 'Light' }).tap();
  await p2.waitForTimeout(300);
  const after = await state(p2);
  await p2.screenshot({ path: `${outDir}/appearance-phone-sheet.png` });
  await phone.close();

  const ok = start.theme === 'light' && light.theme === 'light' && dark.theme === 'dark' && dark.bg === 'rgb(0, 0, 0)'
    && early === 'dark' && before.theme === 'dark' && after.theme === 'light' && after.bg !== 'rgb(0, 0, 0)';
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} appearance  desktop ${start.theme}→${light.theme}→${dark.theme} (bg ${dark.bg}), after reload ${early}; phone sheet ${before.theme}→${after.theme}`);
}
await browser.close();
console.log(failures ? `${failures} FAILURES` : 'ALL SCREENS OK');
process.exit(failures ? 1 : 0);
