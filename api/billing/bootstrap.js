const { createClient } = require('@supabase/supabase-js');

const getSupabaseAdmin = () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

const buildTeamName = (email, name) => {
  if (name && name.trim()) return `${name.trim()} Studio`;
  if (email && email.includes('@')) return `${email.split('@')[0]} Studio`;
  return 'AI Video Production Editor';
};

const takeFirst = (value) => (Array.isArray(value) ? value[0] : value);

const getBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  const value = takeFirst(header);
  if (!value || typeof value !== 'string') return null;
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim();
};

const resolveAuthUser = async (supabase, req) => {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase service role not configured' });

  const authUser = await resolveAuthUser(supabase, req);
  if (!authUser) return res.status(401).json({ error: 'Missing or invalid session token' });

  const body = req.body || {};
  const userId = authUser.id;
  const email = authUser.email || body.email || null;
  const name = authUser.user_metadata?.name || authUser.user_metadata?.full_name || body.name || null;

  const { data: member } = await supabase
    .from('team_members')
    .select('team_id, role')
    .eq('user_id', userId)
    .maybeSingle();

  let teamId = member?.team_id || null;
  if (!teamId) {
    const { data: newTeam, error: teamError } = await supabase
      .from('teams')
      .insert({ name: buildTeamName(email, name), seats: 1 })
      .select('id')
      .single();
    if (teamError) return res.status(500).json({ error: teamError.message });
    teamId = newTeam.id;
    await supabase.from('team_members').insert({
      team_id: teamId,
      user_id: userId,
      role: 'owner',
    });
  }

  const { error: profileError } = await supabase
    .from('customer_profiles')
    .upsert({
      team_id: teamId,
      user_id: userId,
      name,
      email,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'team_id' });
  if (profileError && profileError.code !== '42P01') {
    console.error('customer_profiles upsert failed:', profileError.message);
  }

  const { data: billing } = await supabase
    .from('team_billing')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle();

  if (billing) {
    return res.status(200).json({ teamId, billing });
  }

  const trialStart = new Date();
  const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
  const { data: created } = await supabase
    .from('team_billing')
    .insert({
      team_id: teamId,
      mode: 'trial',
      plan_id: null,
      byo_entitled: true,
      credit_balance_cents: 0,
      trial_started_at: trialStart.toISOString(),
      trial_ends_at: trialEnd.toISOString(),
      trial_active: true,
      status: 'trial',
      updated_at: new Date().toISOString(),
    })
    .select('*')
    .single();

  return res.status(200).json({
    teamId,
    billing: created,
    user: {
      id: userId,
      email,
      name,
      provider: authUser.app_metadata?.provider || null,
    },
  });
};
