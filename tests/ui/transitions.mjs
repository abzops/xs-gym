// Captures frames in the middle of page transitions and checks they stay inside
// the content area: the sidebar (laptop) and icon rail (tablet) may only crossfade
// between their start and end states (the active item moves); any other pixel
// there means page content is being drawn over the navigation.
//   node tests/ui/transitions.mjs <playwright-module-path> <base-url> <out-dir>
import { createRequire } from 'node:module';
import { gym, mockApi } from './mock.mjs';

const [pwPath, baseUrl, outDir] = process.argv.slice(2);
const { chromium } = createRequire(import.meta.url)(pwPath);
const browser = await chromium.launch();
let failures = 0;

/** Share of pixels in `mid` that are not a blend of `a` and `b` (per channel, ±12). */
async function foreign(page, a, b, mid) {
  return page.evaluate(async (urls) => {
    const load = (u) => new Promise((r) => { const i = new Image(); i.onload = () => r(i); i.src = u; });
    const imgs = await Promise.all(urls.map(load));
    const c = new OffscreenCanvas(imgs[0].width, imgs[0].height); const g = c.getContext('2d');
    const px = imgs.map((im) => { g.clearRect(0, 0, c.width, c.height); g.drawImage(im, 0, 0); return g.getImageData(0, 0, c.width, c.height).data; });
    let bad = 0;
    for (let i = 0; i < px[0].length; i += 4) {
      for (let k = 0; k < 3; k++) {
        const lo = Math.min(px[0][i + k], px[1][i + k]) - 12, hi = Math.max(px[0][i + k], px[1][i + k]) + 12;
        if (px[2][i + k] < lo || px[2][i + k] > hi) { bad++; break; }
      }
    }
    return bad / (px[0].length / 4);
  }, [a, b, mid].map((x) => `data:image/png;base64,${x.toString('base64')}`));
}

for (const [name, viewport, mobile, chrome] of [
  ['laptop', { width: 1366, height: 800 }, false, '.sidebar'],
  // Tablet portrait uses the icon rail. (The phone tab bar is frosted glass, so
  // content moving behind it is expected; its stacking is covered by screens.mjs.)
  ['tablet', { width: 820, height: 1180 }, true, '.sidebar'],
]) {
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport, isMobile: mobile, hasTouch: mobile, colorScheme: scheme });
    await mockApi(ctx);
    const page = await ctx.newPage();
    await page.goto(`${baseUrl}g/${gym.slug}/payments`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const box = await page.locator(chrome).boundingBox();
    const clip = { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, viewport.height - box.y) };
    const end = await page.screenshot({ clip });
    await page.goto(`${baseUrl}g/${gym.slug}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(500);
    const start = await page.screenshot({ clip });
    // Slow animations 4× so frames land mid-transition reliably.
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Animation.enable');
    await cdp.send('Animation.setPlaybackRate', { playbackRate: 0.25 });
    const hero = page.locator('a.hero-card');
    mobile ? await hero.tap() : await hero.click();
    let worst = 0;
    for (const t of [60, 160, 320, 600]) {
      await page.waitForTimeout(t === 60 ? 60 : 100);
      const mid = await page.screenshot({ clip });
      worst = Math.max(worst, await foreign(page, start, end, mid));
      await page.screenshot({ path: `${outDir}/vt-${name}-${scheme}-${t}ms.png` });
    }
    const ok = worst < 0.01;
    if (!ok) failures++;
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name.padEnd(7)} ${scheme.padEnd(5)} ${chrome}: ${(worst * 100).toFixed(2)}% foreign pixels mid-transition`);
    await ctx.close();
  }
}
await browser.close();
console.log(failures ? `${failures} TRANSITION FAILURES` : 'TRANSITIONS OK');
process.exit(failures ? 1 : 0);
