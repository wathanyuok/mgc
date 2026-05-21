// =====================================================================
//  Edge Function: ad-login
//  Validates email + password against Active Directory, then bridges the
//  user into a real Supabase session (without storing the AD password).
//
//  Flow:
//    1. Receive { email, password } from the login form.
//    2. Validate against Azure AD via ROPC (Resource Owner Password
//       Credentials) — see verifyAzureAD(). (On-prem AD via LDAP: see note.)
//    3. Ensure a Supabase auth user exists for that email (service role).
//    4. Generate a one-time magic-link token and return its token_hash.
//       The client exchanges it via supabase.auth.verifyOtp() → session.
//
//  Required secrets (supabase secrets set ...):
//    AZURE_TENANT_ID, AZURE_CLIENT_ID, AZURE_CLIENT_SECRET
//    (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY are injected automatically)
//
//  Deploy:  supabase functions deploy ad-login --no-verify-jwt
// =====================================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

/**
 * Validate AD credentials via Azure AD ROPC.
 * Returns true if Azure AD accepts the username/password.
 * NOTE: ROPC does not support MFA / Conditional Access. For on-prem AD,
 * replace this with an LDAP bind from a backend that can reach the DC
 * (Deno LDAP libs exist but the function host must have network line to AD).
 */
async function verifyAzureAD(email: string, password: string): Promise<boolean> {
  const tenant = Deno.env.get('AZURE_TENANT_ID');
  const clientId = Deno.env.get('AZURE_CLIENT_ID');
  const clientSecret = Deno.env.get('AZURE_CLIENT_SECRET');
  if (!tenant || !clientId) {
    throw new Error('AD ยังไม่ได้ตั้งค่า (AZURE_TENANT_ID / AZURE_CLIENT_ID)');
  }

  const form = new URLSearchParams({
    grant_type: 'password',
    client_id: clientId,
    scope: 'openid email profile',
    username: email,
    password,
  });
  if (clientSecret) form.set('client_secret', clientSecret);

  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  return res.ok; // 200 = credentials valid
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  try {
    const { email, password } = await req.json();
    if (!email || !password) return json({ error: 'กรอกอีเมลและรหัสผ่าน' }, 400);

    // 1) Validate against AD
    const ok = await verifyAzureAD(String(email), String(password));
    if (!ok) return json({ error: 'อีเมลหรือรหัสผ่านไม่ถูกต้อง (AD)' }, 401);

    // 2) Service-role client
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    // 3) Ensure the auth user exists (random password — never used; AD is source of truth)
    const { data: list } = await admin.auth.admin.listUsers();
    const exists = list?.users?.some((u) => (u.email ?? '').toLowerCase() === String(email).toLowerCase());
    if (!exists) {
      await admin.auth.admin.createUser({
        email: String(email),
        email_confirm: true,
        password: crypto.randomUUID() + crypto.randomUUID(),
      });
    }

    // 4) Generate a magic-link token → return token_hash for verifyOtp()
    const { data: link, error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: String(email),
    });
    if (linkErr) return json({ error: linkErr.message }, 500);

    const token_hash = (link as any)?.properties?.hashed_token;
    if (!token_hash) return json({ error: 'ไม่สามารถสร้าง session ได้' }, 500);

    return json({ token_hash });
  } catch (e) {
    return json({ error: (e as Error).message ?? 'server error' }, 500);
  }
});
