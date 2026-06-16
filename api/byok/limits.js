const { getSupabaseAdmin, authorizeTeamMember, cleanText, takeFirst } = require('../../server/byok/common');
const {
  toUsdNumber,
  loadUsageTodayUsd,
  loadTeamSpendLimit,
} = require('../../server/byok/limits');

const readTeamId = (req) => cleanText(takeFirst(req.query?.teamId || req.body?.teamId), 64);

module.exports = async (req, res) => {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase service role not configured' });
  }

  const method = req.method || 'GET';
  if (!['GET', 'PUT'].includes(method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const teamId = readTeamId(req);
  if (!teamId) return res.status(400).json({ error: 'Missing teamId' });

  const auth = await authorizeTeamMember(supabase, req, teamId, {
    roles: method === 'GET' ? undefined : ['owner', 'admin'],
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (method === 'PUT') {
    const dailyCapUsd = toUsdNumber(req.body?.dailyCapUsd, 0);
    const hardStopEnabled = req.body?.hardStopEnabled === undefined
      ? true
      : Boolean(req.body.hardStopEnabled);

    if (dailyCapUsd > 100000) {
      return res.status(400).json({ error: 'dailyCapUsd is too large' });
    }

    const now = new Date().toISOString();
    const { error } = await supabase
      .from('byok_spend_limits')
      .upsert({
        team_id: teamId,
        daily_cap_usd: dailyCapUsd,
        hard_stop_enabled: hardStopEnabled,
        updated_by: auth.user.id,
        updated_at: now,
      }, { onConflict: 'team_id' });
    if (error) return res.status(500).json({ error: error.message });
  }

  const [limit, usage] = await Promise.all([
    loadTeamSpendLimit(supabase, teamId),
    loadUsageTodayUsd(supabase, teamId),
  ]);
  if (!limit.ok) return res.status(500).json({ error: limit.error });
  if (!usage.ok) return res.status(500).json({ error: usage.error });

  const usageTodayUsd = toUsdNumber(usage.usageTodayUsd, 0);
  const remainingUsd = limit.dailyCapUsd > 0
    ? Math.max(0, toUsdNumber(limit.dailyCapUsd - usageTodayUsd, 0))
    : null;

  return res.status(200).json({
    limit: {
      dailyCapUsd: limit.dailyCapUsd,
      hardStopEnabled: limit.hardStopEnabled,
      updatedAt: limit.updatedAt || null,
      source: limit.source || 'table',
    },
    usage: {
      usageTodayUsd,
      remainingUsd,
      dayStartUtc: usage.fromIso,
    },
  });
};
