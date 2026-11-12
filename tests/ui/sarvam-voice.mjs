// Synthetic XS AI Sarvam path: no live API keys, no real microphone or customer data.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { REF, gym, session, body } from './mock.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const baseUrl = process.argv[3];
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
await context.addInitScript(([key, sessionJson]) => {
  window.localStorage.setItem(key, sessionJson);
  window.localStorage.setItem('xs-ai-voice-input-mode', 'sarvam');
}, ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
await context.addInitScript(() => {
  window.__sarvam = { microphoneCalls: 0, stopCalls: 0, ws: null, messages: [], processor: null };
  const fakeTrack = () => ({ stop() { window.__sarvam.stopCalls++; } });
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => {
      window.__sarvam.microphoneCalls++;
      return { getTracks: () => [fakeTrack()] };
    },
  } });
  window.AudioContext = class {
    sampleRate = 16000;
    resume() { return Promise.resolve(); }
    close() { return Promise.resolve(); }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    createScriptProcessor() {
      const proc = { onaudioprocess: null, connect() {}, disconnect() {} };
      window.__sarvam.processor = proc;
      return proc;
    }
    createGain() { return { gain: { value: 1 }, connect() {}, disconnect() {} }; }
    get destination() { return {}; }
  };
  window.WebSocket = class {
    static OPEN = 1;
    readyState = 1;
    constructor(url, protocols) {
      this.url = url; this.protocols = protocols;
      window.__sarvam.ws = this;
      queueMicrotask(() => this.onopen?.());
    }
    send(payload) { window.__sarvam.messages.push(JSON.parse(payload)); }
    emit(payload) { this.onmessage?.({ data: JSON.stringify(payload) }); }
    close() { this.readyState = 3; this.onclose?.(); }
  };
});
const agentCalls = [];
await context.route('https://' + REF + '.supabase.co/**', async (route) => {
  const url = route.request().url(), accept = route.request().headers()['accept'] ?? '';
  if (url.includes('/functions/v1/xs-ai')) {
    if (route.request().method() === 'GET')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ configured: true }) });
    agentCalls.push(JSON.parse(route.request().postData() ?? '{}'));
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      reply: 'ശരി', changed: [], actions: [],
    }) });
  }
  let value = body(url);
  if (accept.includes('vnd.pgrst.object') && Array.isArray(value)) value = value[0] ?? null;
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(value) });
});
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto(baseUrl + 'g/' + gym.slug, { waitUntil: 'networkidle' });
await page.locator('.topbar .xsai-entry').tap();
const dialog = page.getByRole('dialog', { name: 'XS AI' });
await dialog.getByRole('group', { name: 'Language' }).getByRole('button', { name: 'മലയാളം' }).tap();
const orb = dialog.locator('.xsai-orb');
async function down() {
  const rect = await orb.boundingBox();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{
    x: rect.x + rect.width/2, y: rect.y + rect.height/2, id: 3,
  }] });
  return {
    up: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] }),
    cancel: () => cdp.send('Input.dispatchTouchEvent', { type: 'touchCancel', touchPoints: [] }),
  };
}
const gesture = await down();
await page.waitForFunction(() => window.__sarvam.ws !== null);
const protocol = await page.evaluate(() => ({ url: window.__sarvam.ws.url, protocols: window.__sarvam.ws.protocols }));
assert.ok(protocol.url.includes('/functions/v1/xs-ai-sarvam?gym_id='));
assert.ok(!protocol.url.includes('jwt.') && !protocol.url.includes('SARVAM_API_KEY'));
assert.equal(protocol.protocols[0], 'xsai-sarvam-v1');
assert.ok(protocol.protocols[1].startsWith('jwt.'));
await page.evaluate(() => window.__sarvam.ws.emit({ event: 'ready' }));
await page.evaluate(() => window.__sarvam.processor?.onaudioprocess?.({
  inputBuffer: { getChannelData: () => new Float32Array(2048) },
}));
await page.waitForFunction(() => window.__sarvam.messages.some(m => m.event === 'audio_input'));
await page.evaluate(() => window.__sarvam.ws.emit({ event: 'transcript.partial', text: 'ഇന്ന് എത്ര' }));
await page.waitForFunction(() => document.querySelector('input[aria-label="Message XS AI"]')?.value === 'ഇന്ന് എത്ര');
assert.equal(agentCalls.length, 0, 'partials must never trigger AI');
await gesture.up();
await page.waitForFunction(() => window.__sarvam.stopCalls > 0);
await page.evaluate(() => window.__sarvam.ws.emit({ event: 'transcript.final', text: 'ഇന്ന് എത്ര കളക്ഷൻ?' }));
await page.waitForFunction(() => document.querySelector('input[aria-label="Message XS AI"]')?.value === 'ഇന്ന് എത്ര കളക്ഷൻ?');
assert.equal(agentCalls.length, 0, 'cloud final must require human review');
await dialog.getByRole('button', { name: 'Send' }).tap();
await page.waitForFunction(() => document.querySelectorAll('.xsai-turn.user').length === 1);
assert.equal(agentCalls.length, 1);
assert.equal(agentCalls[0].messages.at(-1).content, 'ഇന്ന് എത്ര കളക്ഷൻ?');
assert.ok(!errors.length, errors.join(' | '));
console.log('Sarvam POC synthetic iPhone: 13/13 critical assertions passed');
await context.close();
await browser.close();
