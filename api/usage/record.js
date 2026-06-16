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

const resolveAuthUser = async (supabase, req) => {
  const token = getBearerToken(req);
  if (!token) return null;
  const { data, error } = await supabase.auth.getUser(token);
  if (error || !data?.user) return null;
  return data.user;
};

const PROFIT_MARGIN_MULTIPLIER = 1.02;

const roundUsd = (value) => Math.round(value * 100000) / 100000;

const applyMargin = (providerCost) => roundUsd(providerCost * PROFIT_MARGIN_MULTIPLIER);

const normalizeModelForLookup = (model) => {
  if (!model) return '';
  if (model.startsWith('prunaai/z-image:')) return 'prunaai/z-image';
  if (model.startsWith('prunaai/z-image-turbo-lora')) return 'prunaai/z-image-turbo';
  return model;
};

// Provider unit costs in USD before markup.
// Sources used:
// - ai.google.dev/pricing
// - x.ai/api
// - fal.ai model pricing pages
// - sonauto.ai/developers
// - bfl.ai/pricing (Flux family)
// - openai.com/api/pricing (GPT Image reference)
// - For models without published provider list prices in accessible docs, conservative estimates are used.
const MODEL_PROVIDER_RATES = {
  // Gemini (Google AI)
  'gemini:gemini-2.5-flash-image:image': { unitCost: 0.039 },
  'gemini:gemini-3.1-flash-image-preview:image': { unitCost: 0.039 }, // Nano Banana 2 (1K baseline estimate).
  'gemini:gemini-3-pro-image-preview:image': { unitCost: 0.134 }, // token-based approx converted to per-image.
  'gemini:imagen-4.0-generate-001:image': { unitCost: 0.04 },
  'gemini:veo-3.1-fast-generate-preview:video': { unitCost: 0.15 },
  'gemini:veo-3.1-generate-preview:video': { unitCost: 0.4 },
  'gemini:gemini-2.5-flash-preview-tts:audio': { unitCost: 0.02 }, // per generated minute estimate.

  // xAI
  'xai:grok-2-image:image': { unitCost: 0.07 },
  'xai:grok-imagine-video:video': { unitCost: 0.05 }, // Estimated from partner/market Grok video rates.

  // FAL
  'fal:fal-ai/qwen-image-max/text-to-image:image': { unitCost: 0.075 },
  'fal:fal-ai/qwen-image-max/edit:edit': { unitCost: 0.075 },
  'fal:fal-ai/nano-banana-2:image': { unitCost: 0.08 },
  'fal:fal-ai/nano-banana-2/edit:edit': { unitCost: 0.08 },
  'fal:fal-ai/bytedance/seedream/v5/lite/text-to-image:image': { unitCost: 0.035 },
  'fal:bytedance/seedance-2.0/image-to-video:video': { unitCost: 0.3024 },
  'fal:bytedance/seedance-2.0/reference-to-video:video': { unitCost: 0.3024 },
  'fal:alibaba/happy-horse/text-to-video:video': { unitCost: 0.28 },
  'fal:alibaba/happy-horse/image-to-video:video': { unitCost: 0.28 },
  'fal:fal-ai/kling-video/o3/pro/image-to-video:video': { unitCost: 0.28 },
  'fal:fal-ai/kling-video/o3/pro/reference-to-video:video': { unitCost: 0.28 },
  'fal:fal-ai/kling-video/v3/pro/image-to-video:video': { unitCost: 0.336 },
  'fal:fal-ai/kling-video/v3/pro/text-to-video:video': { unitCost: 0.336 },
  'fal:fal-ai/pixverse/c1/reference-to-video:video': { unitCost: 0.05 },
  'fal:fal-ai/creatify/aurora:video': { unitCost: 0.14 },
  'fal:xai/grok-imagine-video/image-to-video:video': { unitCost: 0.05, fixedCost: 0.002 },

  // LTX
  'ltx:video-to-video-hdr:edit': { unitCost: 0.2 },

  // Sonauto
  'sonauto:v3-preview:audio': { unitCost: 0.06 }, // Pay-as-you-go reference: 100 credits per song at $0.06 / 100 credits.

  // Replicate (core generation)
  'replicate:black-forest-labs/flux-1.1-pro:image': { unitCost: 0.04 },
  'replicate:black-forest-labs/flux-schnell:image': { unitCost: 0.003 },
  'replicate:black-forest-labs/flux-2-klein-9b-base:image': { unitCost: 0.015 },
  'replicate:prunaai/flux-2-turbo:image': { unitCost: 0.02 },
  'replicate:prunaai/z-image-turbo:image': { unitCost: 0.004 },
  'replicate:prunaai/z-image:image': { unitCost: 0.006 },
  'replicate:prunaai/z-image-turbo-img2img:image': { unitCost: 0.005 },
  'replicate:openai/gpt-image-1.5:image': { unitCost: 0.042 },
  'replicate:google/gemini-3-pro:image': { unitCost: 0.134 },
  'replicate:qwen/qwen-image-2512:image': { unitCost: 0.02 },
  'replicate:bytedance/seedream-4.5:image': { unitCost: 0.04 },
  'replicate:google/nano-banana-pro:image': { unitCost: 0.15 },
  'replicate:google/nano-banana-pro:edit': { unitCost: 0.15 },
  'replicate:black-forest-labs/flux-2-pro:edit': { unitCost: 0.045 },
  'replicate:prunaai/z-image-turbo-inpaint:edit': { unitCost: 0.005 },
  'replicate:black-forest-labs/flux-fill-dev:edit': { unitCost: 0.05 },
  'replicate:qwen/qwen-image-edit-2511:edit': { unitCost: 0.02 },
  'replicate:qwen/qwen-edit-multiangle:edit': { unitCost: 0.035 },

  // Replicate (utility image/edit models)
  'replicate:runwayml/gen4-image-turbo:image': { unitCost: 0.05 },
  'replicate:isl-org/dpt:image': { unitCost: 0.01 },
  'replicate:intel-isl/midas:image': { unitCost: 0.01 },
  'replicate:cjwbw/rembg:image': { unitCost: 0.008 },
  'replicate:tencentarc/gfpgan:image': { unitCost: 0.01 },
  'replicate:sczhou/restoreformer:image': { unitCost: 0.01 },
  'replicate:aiunivers/openpose:image': { unitCost: 0.009 },
  'replicate:jagilley/controlnet:image': { unitCost: 0.015 },
  'replicate:jagilley/controlnet-scribble:image': { unitCost: 0.015 },
  'replicate:jagilley/controlnet-normal:image': { unitCost: 0.015 },
  'replicate:nightmareai/real-esrgan:edit': { unitCost: 0.015 },
  'replicate:philz1337x/crystal-upscaler:edit': { unitCost: 0.02 },
  'replicate:philz1337x/clarity-upscaler:edit': { unitCost: 0.02 },
  'replicate:topazlabs/image-upscale:edit': { unitCost: 0.06 },
  'replicate:philz1337x/crystal-video-upscaler:edit': { unitCost: 0.03 },
  'replicate:topazlabs/video-upscale:edit': { unitCost: 0.08 },
  'replicate:hyper3d/rodin:image': { unitCost: 0.6 },

  // Replicate (audio models)
  'replicate:minimax/speech-02-hd:audio': { unitCost: 0.02 }, // per clip estimate.
  'replicate:google/lyria-2:audio': { unitCost: 0.03 }, // per clip estimate.
  'replicate:facebookresearch/demucs:audio': { unitCost: 0.009 }, // per stem estimate.

  // Replicate (video models)
  'replicate:google/veo-3.1-fast:video': { unitCost: 0.15 },
  'replicate:google/veo-3.1:video': { unitCost: 0.4 },
  'replicate:wan-video/wan-2.2-i2v-fast:video': { unitCost: 0.05 },
  'replicate:wan-video/wan-2.2-animate-replace:video': { unitCost: 0.05 },
  'replicate:bytedance/seedance-1.5-pro:video': { unitCost: 0.052 },
  'replicate:bytedance/omni-human:video': { unitCost: 0.16 },
  'replicate:kwaivgi/kling-v2.6:video': { unitCost: 0.14 },
  'replicate:kwaivgi/kling-v2.5-turbo-pro:video': { unitCost: 0.07 },
  'replicate:kwaivgi/kling-v2.6-motion-control:video': { unitCost: 0.18 },
  'replicate:lightricks/ltx-2-fast:video': { unitCost: 0.04 },
  'replicate:sczhou/rife:video': { unitCost: 0.04 },
};

const KIND_PROVIDER_RATES = {
  image: 0.04,
  edit: 0.03,
  video: 0.08,
  audio: 0.03,
};

const resolveProviderRate = (entry) => {
  const provider = entry.provider || '';
  const kind = entry.kind || '';
  const model = entry.model || '';
  const directKey = `${provider}:${model}:${kind}`;
  const normalizedKey = `${provider}:${normalizeModelForLookup(model)}:${kind}`;
  const modelRate = MODEL_PROVIDER_RATES[directKey] || MODEL_PROVIDER_RATES[normalizedKey];
  if (modelRate) return modelRate;
  return { unitCost: KIND_PROVIDER_RATES[kind] || 0.03 };
};

const cleanText = (value, max = 180) => {
  if (value === null || value === undefined) return '';
  const text = String(value).trim();
  if (!text) return '';
  return text.slice(0, max);
};

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabaseAdmin();
  if (!supabase) return res.status(500).json({ error: 'Supabase service role not configured' });

  const authUser = await resolveAuthUser(supabase, req);
  if (!authUser) {
    return res.status(401).json({ error: 'Missing or invalid session token' });
  }

  const { teamId, entry, dryRun } = req.body || {};
  if (!teamId || !entry) return res.status(400).json({ error: 'Missing teamId or entry' });

  const { data: member, error: memberError } = await supabase
    .from('team_members')
    .select('role')
    .eq('team_id', teamId)
    .eq('user_id', authUser.id)
    .maybeSingle();
  if (memberError) return res.status(500).json({ error: memberError.message });
  if (!member) return res.status(403).json({ error: 'No access to this team' });

  const quantity = Math.max(1, Math.ceil(Number(entry.units) || 1));
  const normalizedEntry = {
    provider: cleanText(entry.provider, 32) || 'local',
    kind: cleanText(entry.kind, 32) || 'other',
    model: cleanText(entry.model, 180),
    units: quantity,
  };
  const usageType = `${normalizedEntry.provider}:${normalizedEntry.kind}:${normalizedEntry.model || 'default'}`;

  const { data: billing, error: billingError } = await supabase
    .from('team_billing')
    .select('mode, plan_id, credit_balance_cents')
    .eq('team_id', teamId)
    .maybeSingle();
  if (billingError) return res.status(500).json({ error: billingError.message });

  if (!billing) {
    return res.status(200).json({ ok: true, billed: false, dryRun: Boolean(dryRun), balanceCents: null });
  }

  const billable = ['hosted_lite', 'hosted_plan'].includes(billing.mode);
  if (!billable) {
    return res.status(200).json({
      ok: true,
      billed: false,
      dryRun: Boolean(dryRun),
      balanceCents: typeof billing.credit_balance_cents === 'number' ? billing.credit_balance_cents : null,
    });
  }

  const providerRate = resolveProviderRate(normalizedEntry);
  const unitCost = applyMargin(providerRate.unitCost || 0);
  const fixedCost = applyMargin(providerRate.fixedCost || 0);
  const cost = (quantity * unitCost) + fixedCost;
  const deltaCents = -Math.max(1, Math.ceil(cost * 100));
  const current = billing.credit_balance_cents || 0;
  const nextBalance = current + deltaCents;

  if (nextBalance < 0) {
    return res.status(402).json({
      ok: false,
      billed: false,
      blocked: true,
      dryRun: Boolean(dryRun),
      deltaCents: 0,
      balanceCents: current,
      projectedBalanceCents: nextBalance,
      message: 'Insufficient credits',
    });
  }

  if (dryRun) {
    return res.status(200).json({
      ok: true,
      billed: false,
      dryRun: true,
      blocked: false,
      deltaCents,
      balanceCents: current,
      projectedBalanceCents: nextBalance,
      message: 'Preflight passed',
    });
  }

  const now = new Date().toISOString();
  const { error: usageError } = await supabase.from('usage_events').insert({
    team_id: teamId,
    type: usageType,
    quantity,
    created_at: now,
  });
  if (usageError) return res.status(500).json({ error: usageError.message });

  const { error: ledgerError } = await supabase.from('credit_ledger').insert({
    team_id: teamId,
    delta_cents: deltaCents,
    reason: 'usage',
    source: 'app',
    created_at: now,
  });
  if (ledgerError) return res.status(500).json({ error: ledgerError.message });

  const { error: upsertError } = await supabase.from('team_billing').upsert({
    team_id: teamId,
    credit_balance_cents: nextBalance,
    last_usage_at: now,
    updated_at: now,
  }, { onConflict: 'team_id' });
  if (upsertError) return res.status(500).json({ error: upsertError.message });

  return res.status(200).json({ ok: true, billed: true, deltaCents, balanceCents: nextBalance });
};
