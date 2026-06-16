const { createClient } = require('@supabase/supabase-js');

const getSupabaseAdmin = () => {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
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

const resolveAuthUser = async (supabase, req) => {
  const token = getBearerToken(req);
  if (!token) return { user: null, token: null };
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return { user: null, token: null };
  return { user: data.user, token };
};

const authorizeTeamMember = async (supabase, req, teamId, opts = {}) => {
  const roles = Array.isArray(opts.roles) ? opts.roles : null;
  if (!teamId) return { ok: false, status: 400, error: 'Missing teamId' };

  const { user } = await resolveAuthUser(supabase, req);
  if (!user) {
    return { ok: false, status: 401, error: 'Missing or invalid session token' };
  }

  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', user.id)
    .maybeSingle();

  if (memberError) {
    return { ok: false, status: 500, error: memberError.message };
  }
  if (!member) {
    return { ok: false, status: 403, error: 'No access to this team' };
  }
  if (roles && roles.length > 0 && !roles.includes(member.role)) {
    return { ok: false, status: 403, error: 'Insufficient role for this action' };
  }

  return { ok: true, user, role: member.role };
};

const startOfUtcDayIso = () => {
  const now = new Date();
  now.setUTCHours(0, 0, 0, 0);
  return now.toISOString();
};

const cleanText = (value, max = 255) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.slice(0, max);
};

module.exports = {
  getSupabaseAdmin,
  takeFirst,
  getBearerToken,
  resolveAuthUser,
  authorizeTeamMember,
  startOfUtcDayIso,
  cleanText,
};
