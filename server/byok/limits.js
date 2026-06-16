const { startOfUtcDayIso } = require('./common');

const toUsdNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, Math.round(parsed * 100000) / 100000);
};

const getDefaultDailyCapUsd = () => {
  return toUsdNumber(process.env.BYOK_DAILY_CAP_DEFAULT_USD, 25);
};

const getDefaultHardStopEnabled = () => {
  const raw = (process.env.BYOK_HARD_STOP_DEFAULT || 'true').toString().trim().toLowerCase();
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return true;
};

const sumEstimatedUsd = (rows) => {
  if (!Array.isArray(rows)) return 0;
  return rows.reduce((sum, row) => sum + toUsdNumber(row?.estimated_usd, 0), 0);
};

const loadUsageTodayUsd = async (supabase, teamId) => {
  const fromIso = startOfUtcDayIso();
  const { data, error } = await supabase
    .from('byok_spend_ledger')
    .select('estimated_usd')
    .eq('team_id', teamId)
    .gte('created_at', fromIso);

  if (error) {
    return { ok: false, error: error.message, usageTodayUsd: 0 };
  }

  return {
    ok: true,
    usageTodayUsd: Math.round(sumEstimatedUsd(data) * 100000) / 100000,
    fromIso,
  };
};

const loadTeamSpendLimit = async (supabase, teamId) => {
  const fallback = {
    dailyCapUsd: getDefaultDailyCapUsd(),
    hardStopEnabled: getDefaultHardStopEnabled(),
  };
  const { data, error } = await supabase
    .from('byok_spend_limits')
    .select('daily_cap_usd, hard_stop_enabled, updated_at')
    .eq('team_id', teamId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, ...fallback };
  }

  if (!data) {
    return { ok: true, ...fallback, updatedAt: null, source: 'default' };
  }

  return {
    ok: true,
    dailyCapUsd: toUsdNumber(data.daily_cap_usd, fallback.dailyCapUsd),
    hardStopEnabled: data.hard_stop_enabled === null || data.hard_stop_enabled === undefined
      ? fallback.hardStopEnabled
      : Boolean(data.hard_stop_enabled),
    updatedAt: data.updated_at || null,
    source: 'table',
  };
};

const ensureWithinDailyCap = async (supabase, teamId, estimatedUsd) => {
  const limit = await loadTeamSpendLimit(supabase, teamId);
  if (!limit.ok) return { ok: false, status: 500, error: limit.error };

  const usage = await loadUsageTodayUsd(supabase, teamId);
  if (!usage.ok) return { ok: false, status: 500, error: usage.error };

  const pending = toUsdNumber(estimatedUsd, 0);
  const usageTodayUsd = toUsdNumber(usage.usageTodayUsd, 0);
  const projectedUsd = toUsdNumber(usageTodayUsd + pending, 0);

  if (
    limit.hardStopEnabled &&
    limit.dailyCapUsd > 0 &&
    pending > 0 &&
    projectedUsd > limit.dailyCapUsd + 0.000001
  ) {
    return {
      ok: false,
      status: 402,
      error: 'BYOK daily spend limit reached',
      usageTodayUsd,
      projectedUsd,
      dailyCapUsd: limit.dailyCapUsd,
      hardStopEnabled: limit.hardStopEnabled,
    };
  }

  return {
    ok: true,
    usageTodayUsd,
    projectedUsd,
    dailyCapUsd: limit.dailyCapUsd,
    hardStopEnabled: limit.hardStopEnabled,
  };
};

module.exports = {
  toUsdNumber,
  getDefaultDailyCapUsd,
  getDefaultHardStopEnabled,
  loadUsageTodayUsd,
  loadTeamSpendLimit,
  ensureWithinDailyCap,
};
