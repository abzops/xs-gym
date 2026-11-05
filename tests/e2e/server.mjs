// Local stand-in for the hosted Supabase API, for end-to-end testing only.
//  /rest/v1/*  → PostgREST subset run against the real migrations, as role
//                anon/authenticated with RLS, auth.uid() from the JWT.
//  /auth/v1/*  → password sign-in, sign-up, refresh, user, logout, recover.
// Logs every request to calls.jsonl so tests can assert on what the app sent.
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import pg from 'pg';

const PORT = 54321;
const pool = new pg.Pool({ host: '127.0.0.1', port: 54330, user: 'postgres', database: 'postgres', max: 8 });
const LOG = new URL('./calls.jsonl', import.meta.url); // gitignored
fs.writeFileSync(LOG, '');
const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');

// ---------- JWT (HS256, local secret) ----------
const SECRET = 'local-e2e-secret';
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const sign = (payload) => { const h = b64({ alg: 'HS256', typ: 'JWT' }); const p = b64(payload);
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
const verify = (t) => { const [h, p, s] = (t ?? '').split('.'); if (!s) return null;
  if (crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url') !== s) return null;
  const c = JSON.parse(Buffer.from(p, 'base64url')); return c.exp && c.exp < Date.now() / 1000 ? null : c; };
export const ANON_KEY = sign({ role: 'anon', iss: 'local', exp: 4102444800 });

// ---------- schema cache (relationships, function shapes) ----------
let fks = []; let uniques = []; let fns = {};
async function loadSchema() {
  fks = (await pool.query(`select c.conrelid::regclass::text src, c.confrelid::regclass::text dst,
      array(select a.attname from unnest(c.conkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n order by o)::text[] src_cols,
      array(select a.attname from unnest(c.confkey) with ordinality k(n,o) join pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.n order by o)::text[] dst_cols
    from pg_constraint c where c.contype='f' and c.connamespace='public'::regnamespace`)).rows
    .map((r) => ({ ...r, src: r.src.replace(/^public\./, ''), dst: r.dst.replace(/^public\./, '') }));
  uniques = (await pool.query(`select c.conrelid::regclass::text rel, array(select a.attname from unnest(c.conkey) k(n) join pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.n order by 1)::text[] cols
    from pg_constraint c where c.contype in ('p','u') and c.connamespace='public'::regnamespace`)).rows.map((r) => ({ ...r, rel: r.rel.replace(/^public\./, '') }));
  for (const r of (await pool.query(`select p.proname, p.proretset, t.typtype, p.proargnames, p.pronargdefaults, p.pronargs
      from pg_proc p join pg_type t on t.oid=p.prorettype where p.pronamespace='public'::regnamespace`)).rows) fns[r.proname] = r;
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().join() === [...b].sort().join();
/** PostgREST relationship resolution for embedding `name` under `parent`. */
function rel(parent, name) {
  // many-to-one: parent has FK to name → object. Prefer the FK that isn't just gym_id.
  const m2o = fks.filter((f) => f.src === parent && f.dst === name);
  const o2m = fks.filter((f) => f.src === name && f.dst === parent);
  const pick = (list) => list.find((f) => f.src_cols.length > 1) ?? list[0];
  if (m2o.length) { const f = pick(m2o); return { kind: 'object', on: f.src_cols.map((c, i) => `t_child.${q(f.dst_cols[i])} = t_parent.${q(c)}`) }; }
  if (o2m.length) {
    const f = pick(o2m);
    const one = uniques.some((u) => u.rel === name && sameSet(u.cols, f.src_cols));
    return { kind: one ? 'object' : 'array', on: f.src_cols.map((c, i) => `t_child.${q(c)} = t_parent.${q(f.dst_cols[i])}`) };
  }
  throw Object.assign(new Error(`Could not find a relationship between '${parent}' and '${name}'`), { code: 'PGRST200', status: 400 });
}
const q = (id) => { if (!/^[a-z_][a-z0-9_]*$/.test(id)) throw Object.assign(new Error(`bad identifier ${id}`), { status: 400 }); return `"${id}"`; };

// ---------- select parser: "*, a(b, c(d)), e" ----------
function parseSelect(s) {
  const out = []; let i = 0;
  const read = () => { const items = []; let tok = '';
    while (i < s.length) { const ch = s[i++];
      if (ch === '(') { items.push({ name: tok.trim(), children: read() }); tok = ''; }
      else if (ch === ')') { break; }
      else if (ch === ',') { if (tok.trim()) items.push({ name: tok.trim() }); tok = ''; }
      else tok += ch; }
    if (tok.trim()) items.push({ name: tok.trim() });
    return items.filter((x) => x.name); };
  out.push(...read()); return out;
}
// Embeds support "alias:relation!hint(...)"; hint "inner" filters parents without a match.
const innerJoins = [];
function splitEmbed(raw) {
  let [alias, rest] = raw.includes(':') ? raw.split(':') : [null, raw];
  const [relName, hint] = rest.split('!');
  return { alias: alias ?? relName, relName, inner: hint === 'inner' };
}
function selectList(table, items, alias, depth) {
  return items.map((it) => {
    if (!it.children) { if (it.name === '*') return `${alias}.*`; const [a, c] = it.name.includes(':') ? it.name.split(':') : [it.name, it.name]; return `${alias}.${q(c.split('::')[0])} as ${q(a)}`; }
    const e = splitEmbed(it.name);
    const r = rel(table, e.relName);
    const child = `c${depth}`;
    const on = r.on.map((x) => x.replaceAll('t_child', child).replaceAll('t_parent', alias)).join(' and ');
    const inner = `select ${selectList(e.relName, it.children, child, depth + 1)} from public.${q(e.relName)} ${child} where ${on}`;
    if (e.inner && depth === 1) innerJoins.push(`exists (select 1 from public.${q(e.relName)} ${child} where ${on})`);
    return r.kind === 'object' ? `(select to_jsonb(s) from (${inner} limit 1) s) as ${q(e.alias)}`
      : `coalesce((select jsonb_agg(to_jsonb(s)) from (${inner}) s), '[]'::jsonb) as ${q(e.alias)}`;
  }).join(', ');
}

// ---------- filters ----------
function condition(col, expr, params) {
  const m = /^(not\.)?(eq|neq|gt|gte|lt|lte|like|ilike|is|in)\.(.*)$/s.exec(expr);
  if (!m) throw Object.assign(new Error(`unsupported filter ${col}=${expr}`), { status: 400 });
  const [, not, op, raw] = m; const c = `t0.${q(col)}`; let sql;
  const p = (v) => { params.push(v); return `$${params.length}`; };
  if (op === 'is') sql = `${c} is ${raw === 'null' ? 'null' : raw === 'true' ? 'true' : 'false'}`;
  else if (op === 'in') sql = `${c}::text = any(${p(raw.replace(/^\(|\)$/g, '').split(',').map((x) => x.replace(/^"|"$/g, '')))}::text[])`;
  else if (op === 'like' || op === 'ilike') sql = `${c}::text ${op} ${p(raw.replaceAll('*', '%'))}`;
  else sql = `${c} ${{ eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=' }[op]} ${p(raw)}`;
  return not ? `not (${sql})` : sql;
}
function splitTop(s) { const out = []; let d = 0, t = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && d === 0) { out.push(t); t = ''; } else t += ch; } if (t) out.push(t); return out; }
function orCondition(v, params) {
  const inner = v.replace(/^\(|\)$/g, '');
  return '(' + splitTop(inner).map((part) => { const i = part.indexOf('.'); return condition(part.slice(0, i), part.slice(i + 1), params); }).join(' or ') + ')';
}

// ---------- request handling ----------
async function withRole(claims, fn) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    await client.query(`select set_config('request.jwt.claim.sub', $1, true), set_config('request.jwt.claims', $2, true)`, [claims?.sub ?? '', JSON.stringify(claims ?? {})]);
    await client.query(`set local role ${claims?.role === 'authenticated' ? 'authenticated' : 'anon'}`);
    const r = await fn(client);
    await client.query('commit');
    return r;
  } catch (e) { await client.query('rollback').catch(() => {}); throw e; } finally { client.release(); }
}
const pgErr = (e) => ({ status: e.status ?? (e.code === '42501' ? 403 : e.code === 'P0002' ? 404 : e.code?.startsWith('23') ? 409 : 400),
  body: { code: e.code ?? 'PGRST000', message: e.message, details: e.detail ?? null, hint: e.hint ?? null } });

async function rest(req, url, body, claims) {
  const path = url.pathname.replace('/rest/v1/', '');
  if (path.startsWith('rpc/')) {
    const name = path.slice(4); const f = fns[name];
    if (!f) throw Object.assign(new Error(`Could not find the function public.${name}`), { code: 'PGRST202', status: 404 });
    const args = body ? JSON.parse(body) : {}; const params = []; const named = [];
    const known = f.proargnames ?? [];
    for (const [k, v] of Object.entries(args)) {
      if (!known.includes(k)) throw Object.assign(new Error(`Could not find the function public.${name}(${Object.keys(args).join(', ')}) in the schema cache`), { code: 'PGRST202', status: 404 });
      params.push(v === null || typeof v !== 'object' ? v : JSON.stringify(v)); named.push(`${q(k)} => $${params.length}`);
    }
    const required = known.slice(0, f.pronargs - f.pronargdefaults);
    const missing = required.filter((k) => !(k in args));
    if (missing.length) throw Object.assign(new Error(`Could not find the function public.${name}(${Object.keys(args).join(', ')}) in the schema cache`), { code: 'PGRST202', status: 404 });
    const call = `public.${q(name)}(${named.join(', ')})`;
    const sql = f.proretset ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) j from ${call} t`
      : f.typtype === 'c' ? `select to_jsonb(t) j from ${call} t` : `select to_jsonb(${call}) j`;
    return withRole(claims, async (c) => ({ status: 200, body: (await c.query(sql, params)).rows[0]?.j ?? null }));
  }
  if (req.method !== 'GET') throw Object.assign(new Error('table writes are not used by the app'), { status: 405 });
  const table = path; const params = []; const where = []; let order = ''; let limit = ''; let sel = '*';
  for (const [k, v] of url.searchParams) {
    if (k === 'select') sel = v;
    else if (k === 'order') order = ' order by ' + v.split(',').map((o) => { const [col, ...mods] = o.split('.'); return `t0.${q(col)} ${mods.includes('desc') ? 'desc' : 'asc'}${mods.includes('nullsfirst') ? ' nulls first' : mods.includes('nullslast') ? ' nulls last' : ''}`; }).join(', ');
    else if (k === 'limit') limit = ` limit ${Number(v)}`;
    else if (k === 'offset') limit += ` offset ${Number(v)}`;
    else if (k === 'or') where.push(orCondition(v, params));
    else where.push(condition(k, v, params));
  }
  innerJoins.length = 0;
  const cols = selectList(table, parseSelect(sel), 't0', 1);
  where.push(...innerJoins);
  const inner = `select ${cols} from public.${q(table)} t0${where.length ? ' where ' + where.join(' and ') : ''}${order}${limit}`;
  const rows = await withRole(claims, async (c) => (await c.query(`select coalesce(jsonb_agg(to_jsonb(s)), '[]'::jsonb) j from (${inner}) s`, params)).rows[0].j);
  if ((req.headers.accept ?? '').includes('vnd.pgrst.object')) {
    if (rows.length !== 1) return { status: 406, body: { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned', details: `The result contains ${rows.length} rows`, hint: null } };
    return { status: 200, body: rows[0] };
  }
  return { status: 200, body: rows };
}

// ---------- auth ----------
const users = async (where, v) => (await pool.query(`select u.id, u.email, u.raw_user_meta_data, p.password from auth.users u left join auth.passwords p on p.user_id=u.id where ${where}`, [v])).rows[0];
const userJson = (u) => ({ id: u.id, aud: 'authenticated', role: 'authenticated', email: u.email, email_confirmed_at: '2026-11-01T00:00:00Z',
  app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: u.raw_user_meta_data ?? {}, identities: [], created_at: '2026-11-01T00:00:00Z', updated_at: '2026-11-01T00:00:00Z' });
const refresh = new Map();
function session(u) {
  const exp = Math.floor(Date.now() / 1000) + 3600; const rt = crypto.randomBytes(16).toString('hex'); refresh.set(rt, u.id);
  return { access_token: sign({ sub: u.id, role: 'authenticated', aud: 'authenticated', email: u.email, exp }), token_type: 'bearer', expires_in: 3600, expires_at: exp, refresh_token: rt, user: userJson(u) };
}
async function auth(req, url, body, claims) {
  const path = url.pathname.replace('/auth/v1/', ''); const b = body ? JSON.parse(body) : {};
  const err = (status, code, msg) => ({ status, body: { code: status, error_code: code, msg } });
  if (path === 'token' && url.searchParams.get('grant_type') === 'password') {
    const u = await users('lower(u.email)=lower($1)', b.email ?? '');
    if (!u || u.password !== b.password) return err(400, 'invalid_credentials', 'Invalid login credentials');
    return { status: 200, body: session(u) };
  }
  if (path === 'token' && url.searchParams.get('grant_type') === 'refresh_token') {
    const id = refresh.get(b.refresh_token); if (!id) return err(400, 'refresh_token_not_found', 'Invalid Refresh Token: Refresh Token Not Found');
    return { status: 200, body: session(await users('u.id=$1', id)) };
  }
  if (path === 'signup') {
    if (!b.email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) return err(400, 'validation_failed', 'Unable to validate email address: invalid format');
    if ((b.password ?? '').length < 6) return err(422, 'weak_password', 'Password should be at least 6 characters.');
    if (await users('lower(u.email)=lower($1)', b.email)) return err(422, 'user_already_exists', 'User already registered');
    const id = crypto.randomUUID();
    await pool.query('insert into auth.users (id, email, raw_user_meta_data) values ($1, $2, $3)', [id, b.email, JSON.stringify(b.data ?? {})]);
    await pool.query('insert into auth.passwords values ($1, $2)', [id, b.password]);
    const u = await users('u.id=$1', id);
    return { status: 200, body: session(u) };
  }
  if (path === 'user' && req.method === 'GET') { if (!claims?.sub) return err(401, 'no_authorization', 'invalid JWT'); return { status: 200, body: userJson(await users('u.id=$1', claims.sub)) }; }
  if (path === 'user' && req.method === 'PUT') {
    if (!claims?.sub) return err(401, 'no_authorization', 'invalid JWT');
    if (b.password) { if (b.password.length < 6) return err(422, 'weak_password', 'Password should be at least 6 characters.'); await pool.query('update auth.passwords set password=$2 where user_id=$1', [claims.sub, b.password]); }
    return { status: 200, body: userJson(await users('u.id=$1', claims.sub)) };
  }
  if (path === 'logout') return { status: 204, body: null };
  if (path === 'recover') return { status: 200, body: {} };
  return err(404, 'not_found', `no route ${path}`);
}

await loadSchema();
http.createServer((req, res) => {
  let body = ''; req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    const cors = { 'access-control-allow-origin': req.headers.origin ?? '*', 'access-control-allow-headers': req.headers['access-control-request-headers'] ?? '*',
      'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-expose-headers': 'content-range' };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const token = (req.headers.authorization ?? '').replace(/^Bearer /, '');
    const claims = verify(token);
    const t0 = Date.now(); let out;
    try {
      if (token && !claims) out = { status: 401, body: { code: 'PGRST301', message: 'JWT expired or invalid' } };
      else if (url.pathname.startsWith('/rest/v1/')) out = await rest(req, url, body, claims);
      else if (url.pathname.startsWith('/auth/v1/')) out = await auth(req, url, body, claims);
      else out = { status: 404, body: { message: 'not found' } };
    } catch (e) { out = pgErr(e); }
    log({ t: new Date().toISOString(), ms: Date.now() - t0, method: req.method, path: url.pathname, query: url.search, body: body || undefined, user: claims?.sub ?? null, status: out.status,
      error: out.status >= 400 ? out.body : undefined });
    res.writeHead(out.status, { ...cors, 'content-type': 'application/json' });
    res.end(out.body === null ? (out.status === 204 ? '' : 'null') : JSON.stringify(out.body));
  });
}).listen(PORT, () => console.log(`devstack on :${PORT}`));
