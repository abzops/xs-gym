// Owner-only staff provisioning. Never expose service-role credentials to the browser.
import { createClient } from 'npm:@supabase/supabase-js@2.119.0';

const origins = new Set(['https://abzops.github.io', 'http://localhost:5173', 'http://localhost:4173']);
const baseUrl = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin') || '';
  const cors = { 'access-control-allow-origin': origins.has(origin) ? origin : 'https://abzops.github.io',
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS', 'vary': 'Origin' };
  const respond = (code: number, data: unknown) => new Response(JSON.stringify(data), {
    status: code, headers: {...cors, 'content-type': 'application/json'} });
  if (req.method === 'OPTIONS') return new Response(null, {status: 204, headers: cors});
  if (req.method !== 'POST') return respond(405, {error:'Method not allowed'});
  if (!origins.has(origin)) return respond(403, {error:'Origin not allowed'});
  const jwt = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!jwt) return respond(401, {error:'Sign in required'});
  const caller = createClient(baseUrl, anonKey, {global:{headers:{Authorization:'Bearer '+jwt}},auth:{persistSession:false}});
  const {data:{user},error:authError} = await caller.auth.getUser(jwt);
  if (authError || !user) return respond(401,{error:'Sign in required'});
  let input: {gym_id?:string;email?:string;role?:string;mode?:string;password?:string};
  try {input = await req.json();} catch {return respond(400,{error:'Invalid request'});}
  const gym = input?.gym_id ?? '';
  const email = input?.email?.trim().toLowerCase() ?? '';
  const role = input?.role ?? '';
  const mode = input?.mode ?? 'invite';
  if (!/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(gym) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      email.length>254 || !['manager','reception','trainer'].includes(role) ||
      !['invite','password'].includes(mode)) return respond(400,{error:'Check staff email, role and action'});
  if (mode==='password' && (!input.password || input.password.length < 14 || input.password.length > 128))
    return respond(400,{error:'Generate a strong temporary password (14+ characters)'});
  const admin = createClient(baseUrl, serviceKey, {auth:{autoRefreshToken:false,persistSession:false}});
  const {data:owner,error:ownerError} = await admin.from('gym_staff').select('id')
    .eq('gym_id',gym).eq('user_id',user.id).eq('role','owner').eq('status','active').maybeSingle();
  if (ownerError || !owner) return respond(403,{error:'Only an active gym owner can add staff'});
  const {data:gymRow,error:gymError} = await admin.from('gyms').select('id').eq('id',gym).eq('status','active').maybeSingle();
  if (gymError || !gymRow) return respond(403,{error:'Gym is not active'});
  let accountId: string | undefined;
  let created = false;
  if (mode === 'invite') {
    const result = await admin.auth.admin.inviteUserByEmail(email, {
      redirectTo:'https://abzops.github.io/xs-gym/', data:{display_name:email.split('@')[0]} });
    if (result.error) return respond(400,{error:result.error.message.includes('already') ?
      'This email already has an XS Gym account. Ask the user to sign in, then add them using their existing account.' :
      'Invitation email could not be sent. Check Supabase Auth email delivery.'});
    accountId=result.data.user?.id; created=true;
  } else {
    const result = await admin.auth.admin.createUser({email,password:input.password,
      email_confirm:false,user_metadata:{display_name:email.split('@')[0]}});
    if (result.error) return respond(400,{error:result.error.message.includes('already') ?
      'This email already has an account. Do not reset their password; add their existing account.' :
      'Could not create staff login.'});
    accountId=result.data.user?.id; created=true;
  }
  if (!accountId) return respond(500,{error:'Unable to provision account'});
  // The existing audited, permission-checked RPC is retained for membership
  // assignment, instead of writing gym_staff using service-role bypass.
  const {error:staffError}=await caller.rpc('save_staff',{p_gym:gym,p_email:email,p_role:role,p_status:'active'});
  if (staffError) {
    if (created) await admin.auth.admin.deleteUser(accountId);
    return respond(400,{error:'Account could not be assigned to this gym. No access was granted.'});
  }
  return respond(200,{ok:true,delivery:mode==='invite'?'invitation-email':'owner-share-required'});
});
