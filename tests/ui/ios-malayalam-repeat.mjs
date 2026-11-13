// Simulated iPhone WebKit device, synthetic microphone/media and Sarvam REST.
// Exercises repeated *real browser pointer gestures*, but is NOT a physical
// iPhone or genuine speech recognition. No customer data/audio is used.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { REF, gym, session, body } from './mock.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const url = process.argv[3];
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  isMobile: true, hasTouch: true,
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/27.0 Mobile/15E148 Safari/604.1',
});
await ctx.addInitScript(([key, value]) => {
  localStorage.setItem(key, value);
  localStorage.setItem('xs-ai-voice-input-mode', 'browser'); // legacy OFF does NOT break auto fallback
  localStorage.setItem('xs-ai-native-ml-unavailable', '1'); // stale prior mode is ignored
}, ['sb-' + REF + '-auth-token', JSON.stringify(session)]);
await ctx.addInitScript(() => {
  window.__iosVoice = { started: 0, stopped: 0, nativeStarts: 0, recorderStarts: 0 };
  class MockRecognition {
    lang = ''; onresult = null; onerror = null; onend = null;
    start() { window.__iosVoice.nativeStarts++; }
    stop() { this.onend?.(); }
    abort() { this.onend?.(); }
  }
  window.SpeechRecognition = MockRecognition;
  window.webkitSpeechRecognition = MockRecognition;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
    getUserMedia: async () => {
      window.__iosVoice.started++;
      return { getTracks: () => [{
        stop: () => { window.__iosVoice.stopped++; },
      }] };
    },
  } });
  let recordingNum = 0;
  window.MediaRecorder = class {
    static isTypeSupported(type) { return type === 'audio/mp4'; }
    state = 'inactive'; mimeType = 'audio/mp4';
    ondataavailable = null; onstop = null; onerror = null;
    constructor() { this.id = ++recordingNum; }
    start() { this.state = 'recording'; window.__iosVoice.recorderStarts++; }
    stop() {
      if (this.state !== 'recording') return;
      this.state = 'inactive';
      this.ondataavailable?.({data: new Blob([new Uint8Array(1200).fill(this.id)], {type:'audio/mp4'})});
      this.onstop?.();
    }
  };
});
const uploads = [], agentCalls = [], errors = [];
const phrases = ['ഒന്നാമത്തെ ചോദ്യം', 'രണ്ടാമത്തെ ചോദ്യം', 'മൂന്നാമത്തെ ചോദ്യം'];
await ctx.route('https://' + REF + '.supabase.co/**', async (route) => {
  const req = route.request(), endpoint = req.url(), accept = req.headers()['accept'] ?? '';
  if (endpoint.includes('/functions/v1/xs-ai-sarvam')) {
    if (req.method() === 'POST') {
      const data = JSON.parse(req.postData() ?? '{}');
      uploads.push({data, auth:req.headers().authorization});
      const index = uploads.length - 1;
      if (index === 0) await new Promise(resolve => setTimeout(resolve, 500));
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({text:phrases[index],lang:'ml-IN',model:'saaras:v4'})});
    }
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({ready:true, enabled:true, key_configured:true})});
  }
  if (endpoint.includes('/functions/v1/xs-ai')) {
    if (req.method() === 'GET') return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({configured:true})});
    agentCalls.push(JSON.parse(req.postData() ?? '{}'));
    return route.fulfill({status:200,contentType:'application/json',
      body:JSON.stringify({reply:'ശരി.',actions:[],changed:[]})});
  }
  let data = body(endpoint);
  if (accept.includes('vnd.pgrst.object') && Array.isArray(data)) data=data[0] ?? null;
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(data)});
});
const page = await ctx.newPage();
page.on('pageerror', (error) => errors.push(error.message));
await page.goto(url + 'g/' + gym.slug, {waitUntil:'networkidle'});
await page.getByRole('button', {name:'Open XS AI'}).tap();
const dialog = page.getByRole('dialog', {name:'XS AI'});
await dialog.getByRole('group', {name:'Language'}).getByRole('button',{name:'മലയാളം'}).tap();
assert.equal(await dialog.getByRole('textbox',{name:'Message XS AI'}).count(),0,
  'Voice-first AI must not display an unwanted typing box by default');
assert.equal(await dialog.getByRole('button',{name:'Open keyboard'}).count(),1);
await dialog.getByRole('button',{name:'Open keyboard'}).tap();
const input = dialog.getByRole('textbox',{name:'Message XS AI'});
await input.waitFor();
assert.equal(await input.evaluate(el => document.activeElement === el), true,
  'iPhone keyboard icon must synchronously focus the input on the tap');
assert.ok(Number(await input.evaluate(el => parseFloat(getComputedStyle(el).fontSize)))>=16,
  'iPhone keyboard must not trigger focus zoom');
await dialog.getByRole('button',{name:'Hide keyboard'}).tap();
assert.equal(await input.count(),0,'Keyboard can close and return to voice mode');

// Regression for a real iPhone screenshot: hold caption and waveform must
// never paint over each other or the keyboard toggle at narrow widths.
const assertDockLayout = async () => {
  const layout = await dialog.evaluate((el) => {
    const box = (selector) => {
      const r = el.querySelector(selector)?.getBoundingClientRect();
      return r ? {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width} : null;
    };
    return {mic:box('.xsai-orb'),caption:box('.xsai-voice-caption'),
      keyboard:box('.xsai-keyboard-toggle'),waves:box('.xsai-hold-waves')};
  });
  const {mic,caption,keyboard,waves}=layout;
  assert.ok(mic && caption && keyboard && waves, 'Voice dock controls must exist');
  assert.ok(mic.right + 3 <= caption.left, 'Mic must not overlap caption');
  assert.ok(caption.right + 3 <= keyboard.left, 'Caption must not overlap keyboard');
  assert.ok(waves.left >= mic.left && waves.right <= mic.right, 'Waveform must remain inside microphone');
};

const cdp=await ctx.newCDPSession(page);
for (let i=0; i<3; i++) {
  const mic=dialog.locator('.xsai-orb'), rect=await mic.boundingBox();
  const x=rect.x+rect.width/2, y=rect.y+rect.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:30+i}]});
  await page.waitForFunction(() => document.querySelector('.xsai-orb')?.getAttribute('aria-pressed') === 'true');
  await page.waitForFunction(n => window.__iosVoice.recorderStarts>=n, i+1);
  assert.equal(uploads.length<=i,true, 'No upload until mic release');
  await assertDockLayout();
  assert.equal(await page.evaluate(() => window.__iosVoice.nativeStarts),0,
    'iOS must not run browser speech concurrently with MediaRecorder');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(() => document.querySelector('.xsai-orb')?.getAttribute('aria-pressed') === 'false');
  await page.waitForFunction(n => document.querySelectorAll('.xsai-turn.user').length === n, i+1);
  // Deliberately start next recording before the previous Sarvam request ends.
}
await page.waitForFunction(() => document.querySelectorAll('.xsai-turn.user .xsai-bubble:not(.xsai-voice-pending)').length===3,
  undefined, {timeout:15000});
await page.waitForFunction(() => document.querySelectorAll('.xsai-turn.assistant .xsai-bubble:not(.xsai-dots)').length===3,
  undefined, {timeout:15000});
assert.equal(uploads.length,3, 'Exactly one REST upload per release');
assert.equal(agentCalls.length,3, 'Exactly one chat message per release');
assert.deepEqual(agentCalls.map(x=>x.messages.at(-1).content),phrases,
  'Responses must remain in physical release order even when Sarvam returns out of order');
assert.ok(agentCalls.every(x=>x.cloudVoice===true),'Cloud transcript actions must remain read-only');
assert.ok(uploads.every(x=>x.data.mime==='audio/mp4' && x.data.lang==='ml-IN' && x.auth?.startsWith('Bearer ')),
  'Use iPhone M4A audio, explicit Malayalam locale and authenticated relay');
const state=await page.evaluate(()=>window.__iosVoice);
assert.equal(state.recorderStarts,3);
assert.equal(state.started,state.stopped,'Every microphone stream must be closed');
assert.equal(state.nativeStarts,0);
assert.deepEqual(errors,[]);
await page.screenshot({path:'/tmp/xs-ai-ios-repeat-voice.png'});
console.log('PASS: iOS 3x consecutive hold/release, no conflicting native mic, auto Sarvam, serial replies, keyboard icon, safe cleanup');
await ctx.close();
await browser.close();
