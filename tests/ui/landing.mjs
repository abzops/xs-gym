// Landing page check: scrolls like a person at phone, tablet and laptop sizes,
// confirms every section reveals, no overflow, no console errors, and records
// frame times during scroll (target: 60fps → ~16.7ms frames).
//   node tests/ui/landing.mjs <playwright-module-path> <base-url> <out-dir>
import { createRequire } from 'node:module';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const require = createRequire(import.meta.url);
const { chromium } = require(pwPath);

const sizes = [['phone', 390, 844], ['tablet', 820, 1180], ['laptop', 1440, 900]];
const browser = await chromium.launch();
let failures = 0;

for (const [name, w, h] of sizes) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  const errors = [];
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(baseUrl, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1300); // hero load sequence
  await page.screenshot({ path: `${outDir}/landing-${name}-hero.png` });

  // Record frame deltas while scrolling the whole page in small steps.
  await page.evaluate(() => {
    window.__frames = [];
    let last = performance.now();
    const tick = (t) => { window.__frames.push(t - last); last = t; if (window.__rec) requestAnimationFrame(tick); };
    window.__rec = true;
    requestAnimationFrame(tick);
  });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y <= height; y += 120) {
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(16);
  }
  await page.waitForTimeout(1200);
  const stats = await page.evaluate(() => {
    window.__rec = false;
    const f = window.__frames.slice(5).sort((a, b) => a - b);
    const p = (q) => f[Math.min(f.length - 1, Math.floor(f.length * q))];
    return { frames: f.length, median: +p(0.5).toFixed(1), p95: +p(0.95).toFixed(1), over33: f.filter((x) => x > 33.4).length };
  });
  const r = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    hidden: [...document.querySelectorAll('.reveal')].filter((e) => !e.classList.contains('in')).length,
    total: document.querySelectorAll('.reveal').length,
  }));
  await page.screenshot({ path: `${outDir}/landing-${name}-full.png`, fullPage: true });
  const ok = !r.overflow && r.hidden === 0 && errors.length === 0;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(7)} revealed ${r.total - r.hidden}/${r.total}${r.overflow ? ' OVERFLOW' : ''}`
    + ` frames=${stats.frames} median=${stats.median}ms p95=${stats.p95}ms long(>33ms)=${stats.over33}`
    + (errors.length ? ` errors=${errors.join(' | ')}` : ''));
  await page.close();
}
await browser.close();
console.log(failures ? `${failures} FAILURES` : 'LANDING OK');
process.exit(failures ? 1 : 0);
