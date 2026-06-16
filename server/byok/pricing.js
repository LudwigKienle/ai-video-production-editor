const PROFIT_MARGIN_MULTIPLIER = 1.02;

const roundUsd = (value) => Math.round(value * 100000) / 100000;

const normalizeModelForLookup = (model) => {
  if (!model) return '';
  if (model.startsWith('prunaai/z-image:')) return 'prunaai/z-image';
  if (model.startsWith('prunaai/z-image-turbo-lora')) return 'prunaai/z-image-turbo';
  return model;
};

const MODEL_PROVIDER_RATES = {
  // Gemini (Google AI)
  'gemini:gemini-2.5-flash-image:image': { unitCost: 0.039 },
  'gemini:gemini-3.1-flash-image-preview:image': { unitCost: 0.039 },
  'gemini:gemini-3-pro-image-preview:image': { unitCost: 0.134 },
  'gemini:imagen-4.0-generate-001:image': { unitCost: 0.04 },
  'gemini:veo-3.1-fast-generate-preview:video': { unitCost: 0.15 },
  'gemini:veo-3.1-generate-preview:video': { unitCost: 0.4 },
  'gemini:gemini-2.5-flash-preview-tts:audio': { unitCost: 0.02 },

  // xAI
  'xai:grok-2-image:image': { unitCost: 0.07 },
  'xai:grok-imagine-video:video': { unitCost: 0.05 },

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

  // World Labs
  'worldlabs:Marble 0.1-mini:3d-world': { unitCost: 0.25 },
  'worldlabs:Marble 0.1-plus:3d-world': { unitCost: 0.8 },

  // Sonauto
  'sonauto:v3-preview:audio': { unitCost: 0.06 },

  // Replicate
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
  'replicate:minimax/speech-02-hd:audio': { unitCost: 0.02 },
  'replicate:google/lyria-2:audio': { unitCost: 0.03 },
  'replicate:facebookresearch/demucs:audio': { unitCost: 0.009 },
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
  analysis: 0.02,
  '3d-world': 0.4,
  other: 0.03,
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

const estimateCostUsd = (entry, opts = {}) => {
  const includeMargin = opts.includeMargin !== false;
  const marginMultiplier = Number(opts.marginMultiplier) > 0
    ? Number(opts.marginMultiplier)
    : PROFIT_MARGIN_MULTIPLIER;
  const quantity = Math.max(1, Math.ceil(Number(entry.units) || 1));
  const providerRate = resolveProviderRate(entry);
  const applyMultiplier = includeMargin ? marginMultiplier : 1;
  const unitCost = roundUsd((providerRate.unitCost || 0) * applyMultiplier);
  const fixedCost = roundUsd((providerRate.fixedCost || 0) * applyMultiplier);
  return roundUsd((quantity * unitCost) + fixedCost);
};

module.exports = {
  PROFIT_MARGIN_MULTIPLIER,
  MODEL_PROVIDER_RATES,
  KIND_PROVIDER_RATES,
  normalizeModelForLookup,
  resolveProviderRate,
  estimateCostUsd,
};
