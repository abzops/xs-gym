// Cloudflare Worker `xs-gym`: serves XS Gym at https://gym.xelorsoft.com.
// The app is built by CI (.github/workflows/pages.yml) with base "/" and
// pushed to branch cf-deploy; this worker serves that branch with caching.
// Upload changes to this file through the Cloudflare API (script name xs-gym).
const ORIGIN = 'https://raw.githubusercontent.com/abzops/xs-gym/cf-deploy';
const TYPES = {
  js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', html: 'text/html; charset=utf-8', svg: 'image/svg+xml',
  png: 'image/png', woff2: 'font/woff2', woff: 'font/woff', webmanifest: 'application/manifest+json', json: 'application/json', txt: 'text/plain',
};
const SEC = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'DENY',
  // XS AI voice needs the microphone on this site only.
  'permissions-policy': 'camera=(), microphone=(self), geolocation=()', 'strict-transport-security': 'max-age=31536000; includeSubDomains',
};
async function fromOrigin(path, ttl) {
  const r = await fetch(ORIGIN + path, { cf: { cacheTtl: ttl, cacheEverything: true } });
  return r.ok ? r : null;
}
export default {
  async fetch(req) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return new Response('Method not allowed', { status: 405 });
    const { pathname } = new URL(req.url);
    if (pathname === '/healthz') return new Response('ok');
    if (pathname === '/robots.txt') return new Response('User-agent: *\nDisallow: /\n', { headers: { 'content-type': TYPES.txt } });
    const ext = (pathname.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase();
    if (ext && TYPES[ext]) {
      if (!/^\/(assets|brand)\/[\w.@-]+$|^\/(theme\.js|manifest\.webmanifest)$/.test(pathname)) return new Response('Not found', { status: 404 });
      const immutable = pathname.startsWith('/assets/');
      const r = await fromOrigin(pathname, immutable ? 31536000 : 300);
      if (!r) return new Response('Not found', { status: 404 });
      return new Response(r.body, { headers: { ...SEC, 'content-type': TYPES[ext], 'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=300' } });
    }
    const r = await fromOrigin('/index.html?v=' + Math.floor(Date.now() / 30000), 30);
    if (!r) return new Response('XS Gym is updating. Please refresh in a moment.', { status: 503 });
    return new Response(r.body, { headers: { ...SEC, 'content-type': TYPES.html, 'cache-control': 'no-cache', 'content-security-policy': "frame-ancestors 'none'" } });
  },
};
