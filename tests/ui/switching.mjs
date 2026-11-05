// How long switching sections takes, from tap to finished content, with
// realistic delays: static files +90 ms (GitHub Pages CDN), API +140 ms
// (Supabase Mumbai from a phone). First visit and repeat visit per section.
//   node tests/ui/switching.mjs <playwright-module-path> <base-url> [budgetMs]
import { createRequire } from 'node:module';
import { REF, body, gym, session } from './mock.mjs';

const [pwPath, baseUrl, budgetArg] = process.argv.slice(2);
const BUDGET = Number(budgetArg ?? 450);
const { chromium } = createRequire(import.meta.url)(pwPath);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.launch();
let failures = 0;

for (const [name, viewport, mobile, navSel] of [['laptop', { width: 1366, height: 800 }, false, 'nav.sidebar'], ['phone', { width: 390, height: 844 }, true, 'nav.tabbar']]) {
  const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile });
  await ctx.addInitScript(([k, v]) => localStorage.setItem(k, v), [`sb-${REF}-auth-token`, JSON.stringify(session)]);
  await ctx.route(`https://${REF}.supabase.co/**`, async (route) => {
    await sleep(140);
    const accept = route.request().headers()['accept'] ?? '';
    let data = body(route.request().url());
    if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data = data[0] ?? null;
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  });
  await ctx.route(/\/assets\/.*\.(js|css)$/, async (route) => { await sleep(90); route.continue(); });
  const page = await ctx.newPage();
  await page.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500); // the user looks at the dashboard for a moment
  const sections = mobile ? ['Members', 'Payments', 'Plans', 'Home'] : ['Members', 'Payments', 'Plans', 'Expenses', 'Reports', 'Settings', 'Home'];
  const rows = [];
  for (const round of ['first', 'again']) {
    for (const label of sections) {
      const link = page.locator(navSel).getByRole('link', { name: label, exact: true });
      const t0 = Date.now();
      mobile ? await link.tap() : await link.click();
      // Done = the new section's heading is shown and nothing is still loading.
      await page.waitForFunction((want) => {
        const main = document.querySelector('main');
        const h1 = main?.querySelector('h1')?.textContent ?? '';
        const busy = main?.querySelector('[aria-busy="true"], .spinner');
        const vt = document.documentElement.classList.contains('vt-running');
        return !busy && !vt && h1 && (want === 'Home' ? /Good/.test(h1) : h1.startsWith(want));
      }, label, { timeout: 8000, polling: 'raf' });
      rows.push([round, label, Date.now() - t0]);
      await page.waitForTimeout(400);
    }
  }
  const worst = Math.max(...rows.map((r) => r[2]));
  const ok = worst <= BUDGET;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(7)} worst ${worst}ms (budget ${BUDGET}ms)`);
  for (const [round, label, ms] of rows) console.log(`       ${round.padEnd(6)} ${label.padEnd(9)} ${String(ms).padStart(5)}ms`);
  await ctx.close();
}
await browser.close();
console.log(failures ? 'SWITCHING SLOW' : 'SWITCHING OK');
process.exit(failures ? 1 : 0);
