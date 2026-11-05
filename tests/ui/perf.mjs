// Performance check on the production build, with the API mocked locally.
//   node tests/ui/perf.mjs <playwright-module-path> <base-url>
//
// 1. Cold load on a mid-range phone profile (4× CPU slowdown, "fast 4G"):
//    FCP, LCP, CLS, total blocking time, JS transferred.
// 2. Interaction: frame timing while hovering cards, scrolling, switching
//    theme and focusing inputs; event-to-paint latency (INP-style) for taps.
// Fails if a budget in BUDGET is exceeded.
import { createRequire } from 'node:module';
import { gym, mockApi } from './mock.mjs';

const [pwPath, baseUrl] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);

const BUDGET = { lcp: 2500, cls: 0.05, tbt: 300, inp: 200, jsKB: 200, p95Frame: 20, longFrames: 2 };
const browser = await chromium.launch();
let failures = 0;
const check = (label, ok, detail) => { if (!ok) failures++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${label.padEnd(26)} ${detail}`); };

/** Installs observers before any app code runs. */
const observe = () => {
  window.__perf = { lcp: 0, cls: 0, longTasks: [], events: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__perf.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__perf.longTasks.push(e.duration); }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.interactionId) window.__perf.events.push({ name: e.name, d: e.duration }); })
    .observe({ type: 'event', durationThreshold: 16, buffered: true });
};

/** Records rAF frame intervals while `action` runs in the page. */
async function frames(page, action) {
  await page.evaluate(() => {
    window.__frames = []; let last = performance.now(); window.__rec = true;
    const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__rec) requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  });
  await action();
  await page.waitForTimeout(250);
  const f = await page.evaluate(() => { window.__rec = false; return window.__frames.slice(1); });
  f.sort((a, b) => a - b);
  return { n: f.length, p95: f[Math.floor(f.length * 0.95)] ?? 0, long: f.filter((x) => x > 33.4).length };
}

async function context(viewport, { mobile = false, throttle = false } = {}) {
  const ctx = await browser.newContext({ viewport, hasTouch: mobile, isMobile: mobile, colorScheme: 'light' });
  await mockApi(ctx);
  await ctx.addInitScript(observe);
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  if (throttle) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await cdp.send('Network.enable');
    await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (9 * 1024 * 1024) / 8, uploadThroughput: (1.5 * 1024 * 1024) / 8 });
  }
  return { ctx, page, cdp };
}

// ---- 1. Cold load, phone profile ----
for (const [name, path] of [['landing', ''], ['sign-in', 'login'], ['dashboard', `g/${gym.slug}`], ['members', `g/${gym.slug}/members`]]) {
  const { ctx, page } = await context({ width: 390, height: 844 }, { mobile: true, throttle: true });
  if (name === 'landing' || name === 'sign-in') await ctx.clearCookies();
  if (name === 'landing' || name === 'sign-in') await page.addInitScript(() => localStorage.clear());
  let js = 0;
  page.on('response', async (r) => {
    if (r.url().endsWith('.js')) js += Number(r.headers()['content-length'] ?? (await r.body().catch(() => Buffer.alloc(0))).length);
  });
  await page.goto(`${baseUrl}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);
  const m = await page.evaluate(() => {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0;
    const tbt = window.__perf.longTasks.reduce((s, d) => s + Math.max(0, d - 50), 0);
    return { fcp, lcp: window.__perf.lcp, cls: window.__perf.cls, tbt };
  });
  const ok = m.lcp <= BUDGET.lcp && m.cls <= BUDGET.cls && m.tbt <= BUDGET.tbt;
  check(`load ${name}`, ok, `FCP ${m.fcp.toFixed(0)}ms  LCP ${m.lcp.toFixed(0)}ms  CLS ${m.cls.toFixed(3)}  TBT ${m.tbt.toFixed(0)}ms  JS ${(js / 1024).toFixed(0)}KB (wire, uncompressed preview)`);
  await ctx.close();
}

// ---- 2. Interaction smoothness, laptop ----
{
  const { ctx, page } = await context({ width: 1366, height: 900 });
  await page.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  const cards = await page.locator('a.stat, a.hero-card').all();
  const hover = await frames(page, async () => {
    for (let k = 0; k < 3; k++) for (const c of cards) { const b = await c.boundingBox(); await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 6 }); }
  });
  check('hover cards (laptop)', hover.p95 <= BUDGET.p95Frame && hover.long <= BUDGET.longFrames, `${hover.n} frames, p95 ${hover.p95.toFixed(1)}ms, >33ms: ${hover.long}`);

  const theme = await frames(page, async () => {
    for (let k = 0; k < 3; k++) { await page.locator('.sidebar button[aria-label^="Appearance"]').click(); await page.waitForTimeout(120); }
  });
  check('theme switch ×3', theme.long <= 3, `p95 ${theme.p95.toFixed(1)}ms, >33ms: ${theme.long}`);

  await page.goto(`${baseUrl}g/${gym.slug}/settings`, { waitUntil: 'networkidle' });
  const inputs = await page.locator('.input').all();
  const focus = await frames(page, async () => {
    for (const i of inputs.slice(0, 4)) { await i.hover(); await i.click(); await page.keyboard.type('ab', { delay: 20 }); }
  });
  check('hover + focus + type inputs', focus.p95 <= BUDGET.p95Frame && focus.long <= BUDGET.longFrames, `p95 ${focus.p95.toFixed(1)}ms, >33ms: ${focus.long}`);
  await ctx.close();
}

// ---- 3. Phone: scroll and tap latency on a throttled CPU ----
{
  const { ctx, page } = await context({ width: 390, height: 844 }, { mobile: true, throttle: true });
  await page.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(400);
  const scroll = await frames(page, async () => {
    for (let k = 0; k < 6; k++) { await page.mouse.wheel(0, k % 2 ? -500 : 500); await page.waitForTimeout(120); }
  });
  check('scroll dashboard (4× CPU)', scroll.long <= 4, `p95 ${scroll.p95.toFixed(1)}ms, >33ms: ${scroll.long}`);
  await page.evaluate(() => { window.__perf.events = []; });
  for (const tab of ['Members', 'Payments', 'Home']) {
    await page.locator('.tabbar').getByRole('link', { name: tab }).tap();
    await page.waitForTimeout(700);
  }
  await page.getByRole('button', { name: 'More' }).tap();
  await page.waitForTimeout(500);
  const ev = await page.evaluate(() => window.__perf.events);
  const inp = ev.reduce((m, e) => Math.max(m, e.d), 0);
  check('tap → next paint (4× CPU)', inp <= BUDGET.inp, `worst ${inp.toFixed(0)}ms over ${ev.length} slow-ish events (budget ${BUDGET.inp}ms)`);
  await ctx.close();
}

await browser.close();
console.log(failures ? `${failures} PERF FAILURES` : 'PERF OK');
process.exit(failures ? 1 : 0);
