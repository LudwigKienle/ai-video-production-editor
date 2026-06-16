const { getSupabaseAdmin, authorizeTeamMember, cleanText, takeFirst } = require('../../server/byok/common');
const { normalizeProvider, maskSecret, encryptSecret } = require('../../server/byok/vault');

const MAX_SECRET_LENGTH = 2048;

const readTeamId = (req) => {
  return cleanText(takeFirst(req.query?.teamId || req.body?.teamId), 64);
};

const parsePayload = (req) => {
  const provider = normalizeProvider(cleanText(req.body?.provider, 40));
  const secret = cleanText(req.body?.apiKey || req.body?.key || '', MAX_SECRET_LENGTH);
  return { provider, secret };
};

module.exports = async (req, res) => {
  const supabase = getSupabaseAdmin();
  if (!supabase) {
    return res.status(500).json({ error: 'Supabase service role not configured' });
  }

  const method = req.method || 'GET';
  if (!['GET', 'POST', 'PUT', 'DELETE'].includes(method)) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const teamId = readTeamId(req);
  if (!teamId) return res.status(400).json({ error: 'Missing teamId' });

  const auth = await authorizeTeamMember(supabase, req, teamId, {
    roles: method === 'GET' ? undefined : ['owner', 'admin'],
  });
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  if (method === 'GET') {
    const { data, error } = await supabase
      .from('byok_provider_keys')
      .select('provider, key_mask, updated_at, updated_by')
      .eq('team_id', teamId)
      .order('provider', { ascending: true });

    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ keys: data || [] });
  }

  const { provider, secret } = parsePayload(req);
  if (!provider) return res.status(400).json({ error: 'Unsupported or missing provider' });

  if (method === 'DELETE') {
    const { error } = await supabase
      .from('byok_provider_keys')
      .delete()
      .eq('team_id', teamId)
      .eq('provider', provider);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true, removed: provider });
  }

  if (!secret) return res.status(400).json({ error: 'Missing API key value' });

  let encrypted;
  try {
    encrypted = encryptSecret(secret);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to encrypt key' });
  }

  const keyMask = maskSecret(secret);
  const payload = {
    team_id: teamId,
    provider,
    encrypted_key: encrypted,
    key_mask: keyMask,
    updated_by: auth.user.id,
    updated_at: new Date().toISOString(),
  };

  const { error } = await supabase
    .from('byok_provider_keys')
    .upsert(payload, { onConflict: 'team_id,provider' });
  if (error) return res.status(500).json({ error: error.message });

  return res.status(200).json({
    ok: true,
    provider,
    key: {
      provider,
      key_mask: keyMask,
      updated_at: payload.updated_at,
      updated_by: payload.updated_by,
    },
  });
};
