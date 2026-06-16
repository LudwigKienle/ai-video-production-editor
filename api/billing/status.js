const { createClient } = require('@supabase/supabase-js');

const getSupabaseAdmin = () => {
  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false } });
};

const takeFirst = (value) => (Array.isArray(value) ? value[0] : value);

const getBearerToken = (req) => {
  const header = req.headers?.authorization || req.headers?.Authorization;
  const value = takeFirst(header);
  if (!value || typeof value !== 'string') return null;
  if (!value.toLowerCase().startsWith('bearer ')) return null;
  return value.slice(7).trim();
};

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase service role not configured' });

  const token = getBearerToken(req);
  if (!token) return res.status(401).json({ error: 'Missing authorization token' });

  const { data: authData, error: authError } = await supabase.auth.getUser(token);
  if (authError || !authData?.user) return res.status(401).json({ error: 'Invalid session token' });

  const { teamId } = req.query || {};
  if (!teamId) return res.status(400).json({ error: 'Missing teamId' });

  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', authData.user.id)
    .maybeSingle();
  if (memberError) return res.status(500).json({ error: memberError.message });
  if (!member) return res.status(403).json({ error: 'No access to this team' });

  const { data, error } = await supabase
    .from('team_billing')
    .select('*')
    .eq('team_id', teamId)
    .maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ billing: data });
};
