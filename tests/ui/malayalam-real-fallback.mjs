// Real browser flow, simulated speech recognizer/provider. NOT a real Sarvam audio inference.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { REF, gym, session, body } from './mock.mjs';

const { chromium } = createRequire(import.meta.url)(process.argv[2]);
const url = process.argv[3];
const browser = await chromium.launch();
async function scenario({ failed }) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await ctx.addInitScript(([key,value]) => {
    localStorage.setItem(key, value);
    localStorage.setItem('xs-ai-voice-input-mode','browser'); // legacy preference is ignored
  }, ['sb-'+REF+'-auth-token',JSON.stringify(session)]);
  await ctx.addInitScript(() => {
    window.__malayalam = { micStarts: 0, trackStops: 0, uploads: 0, recorder: null, recognizer: null };
    const track = () => ({ stop: () => { window.__malayalam.trackStops++; } });
    Object.defineProperty(navigator,'mediaDevices',{ configurable: true, value: {
      getUserMedia: async () => {
        window.__malayalam.micStarts++;
        return { getTracks: () => [track()] };
      },
    } });
    window.MediaRecorder = class {
      static isTypeSupported(type) { return type === 'audio/mp4'; }
      mimeType = 'audio/mp4';
      state = 'inactive'; ondataavailable = null; onstop = null; onerror = null;
      constructor() { window.__malayalam.recorder = this; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(1000).fill(55)], { type: 'audio/mp4' }) });
        this.onstop?.();
      }
    };
    window.SpeechRecognition = class {
      lang = ''; interimResults = false; continuous = false; maxAlternatives = 1;
      onresult = null; onerror = null; onend = null;
      start() { window.__malayalam.recognizer = this; }
      stop() { queueMicrotask(() => this.onend?.()); }
      abort() { queueMicrotask(() => this.onend?.()); }
    };
    window.webkitSpeechRecognition = window.SpeechRecognition;
    window.__nativeFailed = () => {
      window.__malayalam.recognizer.onerror?.({ error: 'no-speech' });
      window.__malayalam.recognizer.onend?.();
    };
    window.__nativeSuccess = (s) => {
      window.__malayalam.recognizer.onresult?.({
        results: [[{ transcript: s }]],
      });
      window.__malayalam.recognizer.onend?.();
    };
  });
  const uploads = [], agentCalls = [];
  await ctx.route('https://'+REF+'.supabase.co/**', async (route) => {
    const req = route.request(), endpoint = req.url(), accept = req.headers()['accept']??'';
    if (endpoint.includes('/functions/v1/xs-ai-sarvam')) {
      if (req.method() === 'POST') {
        const payload = JSON.parse(req.postData()??'{}');
        uploads.push({ payload, headers:req.headers() });
        return route.fulfill({ status:200, contentType:'application/json',
          body:JSON.stringify({ text:'ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?', lang:'ml-IN', model:'saaras:v4', request_id:'mock-id' }) });
      }
      return route.fulfill({ status:200, contentType:'application/json',
        body:JSON.stringify({ ready:true, enabled:true, key_configured:true }) });
    }
    if (endpoint.includes('/functions/v1/xs-ai')) {
      if (req.method()==='GET') return route.fulfill({ status:200, contentType:'application/json',
        body:JSON.stringify({configured:true}) });
      agentCalls.push(JSON.parse(req.postData()??'{}'));
      return route.fulfill({status:200,contentType:'application/json',
        body:JSON.stringify({reply:'അതെ, കേൾക്കുന്നുണ്ട്.',actions:[],changed:[]})});
    }
    let v=body(endpoint);
    if (accept.includes('vnd.pgrst.object') && Array.isArray(v)) v=v[0]??null;
    return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(v)});
  });
  const page=await ctx.newPage(),errors=[];
  page.on('pageerror',(e)=>errors.push(e.message));
  await page.goto(url+'g/'+gym.slug,{waitUntil:'networkidle'});
  await page.getByRole('button',{name:'Open XS AI'}).tap();
  const dialog=page.getByRole('dialog',{name:'XS AI'});
  await dialog.getByRole('group',{name:'Language'}).getByRole('button',{name:'മലയാളം'}).tap();
  const mic=dialog.locator('.xsai-orb'),box=await mic.boundingBox(),cdp=await ctx.newCDPSession(page);
  const x=box.x+box.width/2, y=box.y+box.height/2;
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x,y,id:11}]});
  await page.waitForFunction(()=>window.__malayalam.recorder?.state==='recording');
  assert.equal(uploads.length,0,'Native browser attempt must never upload raw audio pre-failure');
  if (failed) await page.evaluate(()=>window.__nativeFailed());
  else await page.evaluate(()=>window.__nativeSuccess('ഇന്ന് എത്ര കളക്ഷൻ?'));
  assert.equal(uploads.length,0,'Still no raw cloud audio before finger-up');
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  await page.waitForFunction(()=>document.querySelector('.xsai-orb')?.getAttribute('aria-pressed')==='false');
  await page.waitForFunction(()=>document.querySelectorAll('.xsai-turn.user').length===1);
  await page.waitForFunction(()=>document.querySelectorAll('.xsai-turn.assistant .xsai-bubble:not(.xsai-dots)').length===1);
  if (failed) {
    assert.equal(uploads.length,1,'Original locally captured audio must upload ONCE only after failure and release');
    assert.equal(uploads[0].payload.lang,'ml-IN');
    assert.equal(uploads[0].payload.mime,'audio/mp4');
    assert.ok(uploads[0].payload.audio.length>=1000);
    assert.equal(uploads[0].payload.duration_ms>=100,true);
    assert.ok(uploads[0].headers.authorization.startsWith('Bearer '),'JWT required');
    assert.equal(agentCalls[0].cloudVoice,true,'Speech-derived financial tools remain read-only');
    assert.equal(agentCalls[0].messages.at(-1).content,'ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?');
    assert.equal(await dialog.locator('.xsai-turn.user .xsai-bubble').textContent(),'ഞാൻ പറയുന്നത് കേൾക്കുന്നുണ്ടോ?');
    assert.equal(await page.evaluate(()=>localStorage.getItem('xs-ai-native-ml-unavailable')),null,
      'Do not persist a broken WebSocket-only mode after a failed browser session');
  } else {
    assert.equal(uploads.length,0,'Successful native Malayalam must NEVER send audio to Sarvam');
    assert.equal(agentCalls[0].cloudVoice,false);
    assert.equal(agentCalls[0].messages.at(-1).content,'ഇന്ന് എത്ര കളക്ഷൻ?');
  }
  assert.equal(await page.evaluate(()=>window.__malayalam.trackStops>0),true,'Microphone track is closed after release');
  assert.deepEqual(errors,[],'No client exceptions');
  await ctx.close();
}
await scenario({failed:true});
await scenario({failed:false});
await browser.close();
console.log('PASS: Malayalam failed-native fallback preserves audio and transcribes once; success remains browser-only');
