// Real Chromium pointer/keyboard UX checks against synthetic gym data only.
// No customer database, Sarvam credentials, paid model inference or physical mic.
import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { REF, gym, session, body } from './mock.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const baseUrl = process.argv[3];
const browser = await chromium.launch({ executablePath: process.argv[4] || undefined });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true,
});
await ctx.addInitScript(([key, value]) => {
  localStorage.setItem(key, value);
}, ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
const messages = [];
await ctx.route('https://' + REF + '.supabase.co/**', async (route) => {
  const req = route.request();
  const url = req.url();
  if (url.includes('/functions/v1/xs-ai')) {
    if (req.method() === 'GET') return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ configured: true }),
    });
    messages.push(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json',
      body: JSON.stringify({ reply: 'Ready to help', actions: [], changed: [] }) });
  }
  const accept = req.headers()['accept'] ?? '';
  let result = body(url);
  if (accept.includes('vnd.pgrst.object') && Array.isArray(result)) result = result[0] ?? null;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const home = baseUrl + 'g/' + gym.slug;
await page.goto(home, { waitUntil: 'networkidle' });
const float = page.getByRole('button', { name: 'Open XS AI' });
await float.waitFor();
const cdp = await ctx.newCDPSession(page);
async function touchDown(rect, id) {
  await cdp.send('Input.dispatchTouchEvent', {
    type: 'touchStart', touchPoints: [{ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, id }],
  });
}
async function touchMove(x, y, id) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y, id }] });
}
async function touchUp() {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}
const bounds = await float.boundingBox();
assert.ok(bounds && bounds.width >= 58 && bounds.height >= 58, 'Floating launcher must have a large touch target');
const tab = await page.locator('.tabbar').boundingBox();
assert.ok(tab && bounds.y + bounds.height < tab.y - 6, 'Floating launcher must not obscure navigation');
assert.equal(await page.locator('.topbar .xsai-entry').count(), 0, 'No duplicate XS AI button in top bar');
assert.equal(await float.evaluate((el) => getComputedStyle(el).touchAction), 'none');
assert.equal(await float.evaluate((el) => getComputedStyle(el).webkitUserSelect), 'none');
await mkdir('/tmp/xs-ai-floating-screens', { recursive: true });
await page.screenshot({ path: '/tmp/xs-ai-floating-screens/01-launcher-on-dashboard.png' });

// Drag to another edge: should dock and must NOT open the AI chat.
await touchDown(bounds, 11);
await touchMove(36, 360, 11);
await page.waitForTimeout(100);
await touchUp();
await page.waitForTimeout(270); // allow magnetic docking animation
const dragged = await float.boundingBox();
assert.ok(dragged && dragged.x < 25, 'Drag should dock to the left edge');
assert.equal(await page.getByRole('dialog', { name: 'XS AI' }).count(), 0,
  'Dragging must never trigger a chat open');
const saved = await page.evaluate((id) => localStorage.getItem('xs-ai-floating:' + id), gym.id);
assert.ok(saved?.includes('"x"'), 'Position must persist per gym');
await page.screenshot({ path: '/tmp/xs-ai-floating-screens/02-dragged-left.png' });

// The same launcher follows member/payment pages and survives reload.
await page.goto(home + '/members', { waitUntil: 'networkidle' });
await float.waitFor();
assert.ok((await float.boundingBox()).x < 25, 'Position should persist across member navigation');
await page.reload({ waitUntil: 'networkidle' });
await float.waitFor();
assert.ok((await float.boundingBox()).x < 25, 'Position should survive reload');
await page.goto(home + '/payments', { waitUntil: 'networkidle' });
await float.waitFor();
assert.ok((await float.boundingBox()).x < 25, 'Position should persist on Payments page');

// Keyboard/switch accessibility: arrows move, Enter opens, Escape closes.
await float.focus();
const beforeArrow = await float.boundingBox();
await page.keyboard.press('ArrowUp');
await page.waitForFunction((before) => {
  const y = document.querySelector('.xsai-floating-launcher')?.getBoundingClientRect().y;
  return typeof y === 'number' && y < before - 8;
}, beforeArrow.y, { timeout: 1200 }); // account for the magnetic position animation
const afterArrow = await float.boundingBox();
assert.ok(afterArrow.y < beforeArrow.y, 'Keyboard users can reposition the launcher');
await page.keyboard.press('Enter');
const dialog = page.getByRole('dialog', { name: 'XS AI' });
await dialog.waitFor();
assert.equal(await float.count(), 0, 'Floating button hides while its modal is open');
await page.keyboard.press('Escape');
await dialog.waitFor({ state: 'hidden' });
await float.waitFor({ state: 'visible' });

// Rotate viewport: saved normalized location must never move out of reach.
await page.setViewportSize({ width: 844, height: 390 });
await page.waitForTimeout(160);
const rotated = await float.boundingBox();
assert.ok(rotated && rotated.x >= 0 && rotated.y >= 0 &&
  rotated.x + rotated.width <= 844 && rotated.y + rotated.height <= 390,
  'Floating launcher must stay visible in landscape');
await page.setViewportSize({ width: 390, height: 844 });
await page.waitForTimeout(170);

// A short finger tap opens the chat; the chat itself is covered by tests/ui/xs-ai.mjs.
await float.tap();
await dialog.waitFor();
assert.equal(await dialog.getByRole('button', { name: 'Talk to XS AI' }).count(), 1);
assert.deepEqual(errors, []);
await browser.close();
console.log('XS AI FLOATING LAUNCHER OK');
