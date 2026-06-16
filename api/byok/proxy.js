const { getSupabaseAdmin, authorizeTeamMember, cleanText } = require('../../server/byok/common');
const { estimateCostUsd } = require('../../server/byok/pricing');
const {
  normalizeProvider,
  decryptSecret,
  isAllowedProviderUrl,
  applyProviderAuthHeaders,
} = require('../../server/byok/vault');
const { ensureWithinDailyCap, toUsdNumber } = require('../../server/byok/limits');

const JSON_CONTENT_TYPES = [
  'application/json',
  'application/problem+json',
  'application/vnd.api+json',
];

const MAX_TIMEOUT_MS = 180000;
const DEFAULT_TIMEOUT_MS = 90000;

const parseMethod = (raw) => {
  const value = (raw || 'POST').toString().trim().toUpperCase();
  const allowed = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
  return allowed.includes(value) ? value : 'POST';
};

const toRequestHeaders = (rawHeaders) => {
  if (!rawHeaders || typeof rawHeaders !== 'object') return {};
  const entries = Object.entries(rawHeaders);
  const next = {};
  entries.forEach(([key, value]) => {
    if (!key) return;
    if (value === null || value === undefined) return;
    const headerName = String(key).trim();
    if (!headerName) return;
    if (Array.isArray(value)) {
      next[headerName] = value.map((item) => String(item)).join(', ');
      return;
    }
    next[headerName] = String(value);
  });
  return next;
};

const buildBody = (method, body, headers) => {
  if (method === 'GET' || method === 'HEAD') return undefined;
  if (body === null || body === undefined) return undefined;
  if (typeof body === 'string') return body;

  if (typeof body === 'object' && typeof body.base64 === 'string') {
    const contentType = cleanText(body.contentType || body.mimeType || '', 120);
    if (contentType) headers['Content-Type'] = contentType;
    return Buffer.from(body.base64, 'base64');
  }

  if (typeof body === 'object') {
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    return JSON.stringify(body);
  }

  return String(body);
};

const shouldParseJson = (contentType) => {
  if (!contentType) return false;
  const lowered = contentType.toLowerCase();
  return JSON_CONTENT_TYPES.some((kind) => lowered.includes(kind)) || lowered.includes('+json');
};

const sanitizeErrorBody = (text) => cleanText(text, 1200);

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase service role not configured' });

  const body = req.body || {};
  const teamId = cleanText(body.teamId, 64);
  const provider = normalizeProvider(cleanText(body.provider, 40));
  const requestConfig = body.request || {};

  if (!teamId) return res.status(400).json({ error: 'Missing teamId' });
  if (!provider) return res.status(400).json({ error: 'Unsupported provider' });

  const auth = await authorizeTeamMember(supabase, req, teamId);
  if (!auth.ok) return res.status(auth.status).json({ error: auth.error });

  const url = cleanText(requestConfig.url || body.url, 2000);
  if (!url) return res.status(400).json({ error: 'Missing request.url' });
  if (!isAllowedProviderUrl(provider, url)) {
    return res.status(400).json({ error: 'Target URL not allowed for provider' });
  }

  const { data: keyRow, error: keyError } = await supabase
    .from('byok_provider_keys')
    .select('encrypted_key, key_mask')
    .eq('team_id', teamId)
    .eq('provider', provider)
    .maybeSingle();
  if (keyError) return res.status(500).json({ error: keyError.message });
  if (!keyRow?.encrypted_key) {
    return res.status(404).json({ error: `No stored key found for provider "${provider}"` });
  }

  let providerSecret = '';
  try {
    providerSecret = decryptSecret(keyRow.encrypted_key);
  } catch (error) {
    return res.status(500).json({ error: error?.message || 'Failed to decrypt provider key' });
  }

  const method = parseMethod(requestConfig.method || body.method);
  const usage = body.usage || {};
  const usageEntry = {
    provider,
    kind: cleanText(usage.kind || body.kind || 'other', 40) || 'other',
    model: cleanText(usage.model || body.model || '', 180),
    units: Math.max(1, Math.ceil(Number(usage.units || body.units || 1))),
  };

  const inferredBillable = !['GET', 'HEAD', 'OPTIONS'].includes(method);
  const explicitBillable = body.meta?.billable;
  const billable = inferredBillable || explicitBillable === true;
  const estimatedUsd = billable
    ? toUsdNumber(estimateCostUsd(usageEntry, { includeMargin: false }), 0)
    : 0;

  let limitInfo = {
    usageTodayUsd: 0,
    projectedUsd: 0,
    dailyCapUsd: 0,
    hardStopEnabled: false,
  };
  if (billable && estimatedUsd > 0) {
    const limitCheck = await ensureWithinDailyCap(supabase, teamId, estimatedUsd);
    if (!limitCheck.ok) {
      return res.status(limitCheck.status || 500).json({
        error: limitCheck.error || 'BYOK spend limit check failed',
        usageTodayUsd: limitCheck.usageTodayUsd,
        projectedUsd: limitCheck.projectedUsd,
        dailyCapUsd: limitCheck.dailyCapUsd,
        hardStopEnabled: limitCheck.hardStopEnabled,
      });
    }
    limitInfo = {
      usageTodayUsd: limitCheck.usageTodayUsd,
      projectedUsd: limitCheck.projectedUsd,
      dailyCapUsd: limitCheck.dailyCapUsd,
      hardStopEnabled: limitCheck.hardStopEnabled,
    };
  }

  const forwardedHeaders = toRequestHeaders(requestConfig.headers || body.headers);
  const headers = applyProviderAuthHeaders(provider, providerSecret, forwardedHeaders);
  headers.Accept = headers.Accept || headers.accept || '*/*';

  const requestBody = buildBody(method, requestConfig.body, headers);
  const timeoutMs = Math.min(
    MAX_TIMEOUT_MS,
    Math.max(1000, Number(requestConfig.timeoutMs) || DEFAULT_TIMEOUT_MS),
  );
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), timeoutMs);

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      body: requestBody,
      signal: abort.signal,
    });
  } catch (error) {
    clearTimeout(timer);
    if (error?.name === 'AbortError') {
      return res.status(504).json({ error: `Provider request timed out after ${timeoutMs}ms` });
    }
    return res.status(502).json({ error: error?.message || 'Provider request failed' });
  } finally {
    clearTimeout(timer);
  }

  const responseStatus = response.status;
  const responseContentType = response.headers.get('content-type') || 'application/octet-stream';
  const usagePayload = {
    billable,
    estimatedUsd,
    ...limitInfo,
  };

  if (billable && estimatedUsd > 0 && response.ok) {
    const now = new Date().toISOString();
    const { error: ledgerError } = await supabase.from('byok_spend_ledger').insert({
      team_id: teamId,
      provider,
      kind: usageEntry.kind,
      model: usageEntry.model || null,
      units: usageEntry.units,
      estimated_usd: estimatedUsd,
      request_url: cleanText(url, 500),
      http_method: method,
      response_status: responseStatus,
      note: cleanText(body.meta?.note || '', 255) || null,
      created_by: auth.user.id,
      created_at: now,
    });
    if (ledgerError) {
      console.error('Failed to write byok_spend_ledger:', ledgerError.message);
      usagePayload.ledgerWarning = ledgerError.message;
    } else {
      usagePayload.usageTodayUsd = toUsdNumber(limitInfo.usageTodayUsd + estimatedUsd, 0);
      usagePayload.projectedUsd = usagePayload.usageTodayUsd;
    }
  }

  if (!response.ok) {
    const errorText = sanitizeErrorBody(await response.text().catch(() => ''));
    return res.status(responseStatus).json({
      error: `Provider returned ${responseStatus}`,
      provider,
      status: responseStatus,
      body: errorText || response.statusText,
      usage: usagePayload,
    });
  }

  if (shouldParseJson(responseContentType)) {
    const data = await response.json().catch(() => null);
    return res.status(200).json({
      ok: true,
      status: responseStatus,
      provider,
      contentType: responseContentType,
      data,
      usage: usagePayload,
    });
  }

  if (responseContentType.toLowerCase().startsWith('text/')) {
    const text = await response.text().catch(() => '');
    return res.status(200).json({
      ok: true,
      status: responseStatus,
      provider,
      contentType: responseContentType,
      text,
      usage: usagePayload,
    });
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  return res.status(200).json({
    ok: true,
    status: responseStatus,
    provider,
    contentType: responseContentType,
    bodyBase64: bytes.toString('base64'),
    usage: usagePayload,
  });
};
