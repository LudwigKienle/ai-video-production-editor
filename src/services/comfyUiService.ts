import type { MediaItem } from '../types';

type ComfyModelOptions = {
  checkpoints: string[];
  vae: string[];
  loras: string[];
  clips: string[];
};

type ComfyImageInput = {
  name: string;
  subfolder?: string;
  type?: string;
};

export type ComfyGenerationOptions = {
  baseUrl: string;
  prompt: string;
  negativePrompt?: string;
  width: number;
  height: number;
  steps: number;
  cfg: number;
  sampler: string;
  scheduler: string;
  seed: number;
  denoise: number;
  checkpoint?: string;
  vae?: string;
  clip?: string;
  lora?: string;
  loraStrength?: number;
  loraStack?: ComfyLoraStackEntry[];
  freefuse?: {
    enabled?: boolean;
    backgroundText?: string;
    collectStep?: number;
    collectBlock?: number;
    temperature?: number;
    topKRatio?: number;
    enableAttentionBias?: boolean;
    biasScale?: number;
    positiveBiasScale?: number;
  };
  initImage?: ComfyImageInput;
};

export type ComfyLoraStackEntry = {
  loraName: string;
  adapterName?: string;
  conceptText?: string;
  strengthModel?: number;
  strengthClip?: number;
};

const buildId = () => `comfy-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const normalizeBaseUrl = (url: string) => url.replace(/\/+$/, '');

const fetchJson = async (baseUrl: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}${path}`, init);
  if (!response.ok) {
    throw new Error(`ComfyUI request failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const extractChoices = (node: any, field: string): string[] => {
  const input = node?.input?.required?.[field] ?? node?.input?.optional?.[field];
  if (!input) return [];
  if (Array.isArray(input)) {
    const first = input[0];
    const meta = input[1] || {};
    if (Array.isArray(first)) return first.filter(Boolean);
    if (Array.isArray(meta.values)) return meta.values.filter(Boolean);
    if (Array.isArray(meta.choices)) return meta.choices.filter(Boolean);
    if (Array.isArray(meta.enum)) return meta.enum.filter(Boolean);
  }
  if (input?.choices && Array.isArray(input.choices)) {
    return input.choices.filter(Boolean);
  }
  return [];
};

export const testComfyUiConnection = async (baseUrl: string) => {
  await fetchJson(baseUrl, '/system_stats');
  return true;
};

export const getComfyUiHealth = async (baseUrl: string) => {
  return fetchJson(baseUrl, '/system_stats');
};

export const listComfyUiModels = async (baseUrl: string): Promise<ComfyModelOptions> => {
  const info = await fetchJson(baseUrl, '/object_info');
  const checkpoints = extractChoices(info?.CheckpointLoaderSimple, 'ckpt_name');
  const vae = extractChoices(info?.VAELoader, 'vae_name');
  const loras = Array.from(new Set([
    ...extractChoices(info?.LoraLoader, 'lora_name'),
    ...extractChoices(info?.FreeFuseLoRALoader, 'lora_name'),
    ...extractChoices(info?.FreeFuseLoRALoaderSimple, 'lora_name'),
  ]));
  const clips = extractChoices(info?.CLIPLoader, 'clip_name');
  return { checkpoints, vae, loras, clips };
};

export const uploadComfyImage = async (baseUrl: string, blob: Blob, filename = 'input.png') => {
  const form = new FormData();
  form.append('image', blob, filename);
  const response = await fetch(`${normalizeBaseUrl(baseUrl)}/upload/image`, {
    method: 'POST',
    body: form,
  });
  if (!response.ok) {
    throw new Error(`ComfyUI upload failed: ${response.status} ${response.statusText}`);
  }
  return response.json();
};

const normalizeLoraStack = (options: ComfyGenerationOptions): ComfyLoraStackEntry[] => {
  const baseScale = Number.isFinite(options.loraStrength) ? Number(options.loraStrength) : 0.7;
  const stack = (options.loraStack || [])
    .map((entry, index) => {
      const loraName = (entry?.loraName || '').trim();
      if (!loraName) return null;
      const fallbackAdapter = `concept${index + 1}`;
      return {
        loraName,
        adapterName: (entry?.adapterName || fallbackAdapter).trim() || fallbackAdapter,
        conceptText: (entry?.conceptText || '').trim(),
        strengthModel: Number.isFinite(entry?.strengthModel) ? Number(entry?.strengthModel) : baseScale,
        strengthClip: Number.isFinite(entry?.strengthClip) ? Number(entry?.strengthClip) : baseScale,
      } satisfies ComfyLoraStackEntry;
    })
    .filter((entry) => Boolean(entry)) as ComfyLoraStackEntry[];

  if (stack.length > 0) return stack;
  if (options.lora?.trim()) {
    return [{
      loraName: options.lora.trim(),
      adapterName: 'concept1',
      conceptText: '',
      strengthModel: baseScale,
      strengthClip: baseScale,
    }];
  }
  return [];
};

const createStandardComfyWorkflow = (options: ComfyGenerationOptions) => {
  const {
    prompt,
    negativePrompt,
    width,
    height,
    steps,
    cfg,
    sampler,
    scheduler,
    seed,
    denoise,
    checkpoint,
    vae,
    clip,
    initImage,
  } = options;
  const loraStack = normalizeLoraStack(options);

  const workflow: Record<string, any> = {};

  workflow['1'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: checkpoint || '',
    },
  };

  let modelSource: [string, number] = ['1', 0];
  let clipSource: [string, number] = ['1', 1];
  let nextNodeId = 2;
  loraStack.forEach((entry) => {
    const nodeId = String(nextNodeId++);
    workflow[nodeId] = {
      class_type: 'LoraLoader',
      inputs: {
        model: modelSource,
        clip: clipSource,
        lora_name: entry.loraName,
        strength_model: Number.isFinite(entry.strengthModel) ? Number(entry.strengthModel) : 0.7,
        strength_clip: Number.isFinite(entry.strengthClip) ? Number(entry.strengthClip) : 0.7,
      },
    };
    modelSource = [nodeId, 0];
    clipSource = [nodeId, 1];
  });

  if (clip) {
    const clipLoaderId = String(nextNodeId++);
    workflow[clipLoaderId] = {
      class_type: 'CLIPLoader',
      inputs: {
        clip_name: clip,
      },
    };
    if (loraStack.length === 0) {
      clipSource = [clipLoaderId, 0];
    }
  }

  const positiveNodeId = String(nextNodeId++);
  workflow[positiveNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: prompt,
      clip: clipSource,
    },
  };

  const negativeNodeId = String(nextNodeId++);
  workflow[negativeNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: negativePrompt || '',
      clip: clipSource,
    },
  };

  let vaeSource: [string, number] = ['1', 2];
  if (vae) {
    const vaeNodeId = String(nextNodeId++);
    workflow[vaeNodeId] = {
      class_type: 'VAELoader',
      inputs: {
        vae_name: vae,
      },
    };
    vaeSource = [vaeNodeId, 0];
  }

  let latentSource: [string, number];
  if (initImage) {
    const loadImageNodeId = String(nextNodeId++);
    workflow[loadImageNodeId] = {
      class_type: 'LoadImage',
      inputs: {
        image: initImage.subfolder ? `${initImage.subfolder}/${initImage.name}` : initImage.name,
      },
    };
    const vaeEncodeNodeId = String(nextNodeId++);
    workflow[vaeEncodeNodeId] = {
      class_type: 'VAEEncode',
      inputs: {
        pixels: [loadImageNodeId, 0],
        vae: vaeSource,
      },
    };
    latentSource = [vaeEncodeNodeId, 0];
  } else {
    const emptyLatentNodeId = String(nextNodeId++);
    workflow[emptyLatentNodeId] = {
      class_type: 'EmptyLatentImage',
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    };
    latentSource = [emptyLatentNodeId, 0];
  }

  const samplerNodeId = String(nextNodeId++);
  workflow[samplerNodeId] = {
    class_type: 'KSampler',
    inputs: {
      model: modelSource,
      positive: [positiveNodeId, 0],
      negative: [negativeNodeId, 0],
      latent_image: latentSource,
      seed,
      steps,
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise,
    },
  };

  const decodeNodeId = String(nextNodeId++);
  workflow[decodeNodeId] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: [samplerNodeId, 0],
      vae: vaeSource,
    },
  };

  const saveNodeId = String(nextNodeId++);
  workflow[saveNodeId] = {
    class_type: 'SaveImage',
    inputs: {
      images: [decodeNodeId, 0],
      filename_prefix: 'ai-video-gen',
    },
  };

  return workflow;
};

const createFreeFuseComfyWorkflow = (options: ComfyGenerationOptions) => {
  const {
    prompt,
    negativePrompt,
    width,
    height,
    steps,
    cfg,
    sampler,
    scheduler,
    seed,
    denoise,
    checkpoint,
    vae,
    initImage,
    freefuse,
  } = options;
  const loraStack = normalizeLoraStack(options);

  const workflow: Record<string, any> = {};
  workflow['1'] = {
    class_type: 'CheckpointLoaderSimple',
    inputs: {
      ckpt_name: checkpoint || '',
    },
  };

  let modelSource: [string, number] = ['1', 0];
  let clipSource: [string, number] = ['1', 1];
  let freefuseDataSource: [string, number] | null = null;
  let nextNodeId = 2;

  loraStack.forEach((entry, index) => {
    const nodeId = String(nextNodeId++);
    const adapterName = (entry.adapterName || `concept${index + 1}`).trim() || `concept${index + 1}`;
    workflow[nodeId] = {
      class_type: 'FreeFuseLoRALoader',
      inputs: {
        model: modelSource,
        clip: clipSource,
        lora_name: entry.loraName,
        adapter_name: adapterName,
        strength_model: Number.isFinite(entry.strengthModel) ? Number(entry.strengthModel) : 0.7,
        strength_clip: Number.isFinite(entry.strengthClip) ? Number(entry.strengthClip) : 0.7,
        ...(freefuseDataSource ? { freefuse_data: freefuseDataSource } : {}),
      },
    };
    modelSource = [nodeId, 0];
    clipSource = [nodeId, 1];
    freefuseDataSource = [nodeId, 2];
  });

  const conceptNodeId = String(nextNodeId++);
  const conceptInputs: Record<string, any> = {
    enable_background: true,
    background_text: (freefuse?.backgroundText || '').trim(),
  };
  loraStack.slice(0, 4).forEach((entry, index) => {
    const adapterName = (entry.adapterName || `concept${index + 1}`).trim() || `concept${index + 1}`;
    conceptInputs[`adapter_name_${index + 1}`] = adapterName;
    conceptInputs[`concept_text_${index + 1}`] = (entry.conceptText || adapterName).trim();
  });
  workflow[conceptNodeId] = {
    class_type: 'FreeFuseConceptMap',
    inputs: {
      ...conceptInputs,
      ...(freefuseDataSource ? { freefuse_data: freefuseDataSource } : {}),
    },
  };

  const tokenNodeId = String(nextNodeId++);
  workflow[tokenNodeId] = {
    class_type: 'FreeFuseTokenPositions',
    inputs: {
      clip: clipSource,
      prompt,
      freefuse_data: [conceptNodeId, 0],
      filter_meaningless: true,
      filter_single_char: true,
    },
  };

  const positiveNodeId = String(nextNodeId++);
  workflow[positiveNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: prompt,
      clip: clipSource,
    },
  };

  const negativeNodeId = String(nextNodeId++);
  workflow[negativeNodeId] = {
    class_type: 'CLIPTextEncode',
    inputs: {
      text: negativePrompt || '',
      clip: clipSource,
    },
  };

  let vaeSource: [string, number] = ['1', 2];
  if (vae) {
    const vaeNodeId = String(nextNodeId++);
    workflow[vaeNodeId] = {
      class_type: 'VAELoader',
      inputs: {
        vae_name: vae,
      },
    };
    vaeSource = [vaeNodeId, 0];
  }

  let latentSource: [string, number];
  if (initImage) {
    const loadImageNodeId = String(nextNodeId++);
    workflow[loadImageNodeId] = {
      class_type: 'LoadImage',
      inputs: {
        image: initImage.subfolder ? `${initImage.subfolder}/${initImage.name}` : initImage.name,
      },
    };
    const vaeEncodeNodeId = String(nextNodeId++);
    workflow[vaeEncodeNodeId] = {
      class_type: 'VAEEncode',
      inputs: {
        pixels: [loadImageNodeId, 0],
        vae: vaeSource,
      },
    };
    latentSource = [vaeEncodeNodeId, 0];
  } else {
    const emptyLatentNodeId = String(nextNodeId++);
    workflow[emptyLatentNodeId] = {
      class_type: 'EmptyLatentImage',
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    };
    latentSource = [emptyLatentNodeId, 0];
  }

  const normalizedCollectStep = Math.max(1, Math.min(steps, Number(freefuse?.collectStep) || Math.min(5, steps)));
  const phase1NodeId = String(nextNodeId++);
  workflow[phase1NodeId] = {
    class_type: 'FreeFusePhase1Sampler',
    inputs: {
      model: modelSource,
      conditioning: [positiveNodeId, 0],
      neg_conditioning: [negativeNodeId, 0],
      latent: latentSource,
      freefuse_data: [tokenNodeId, 0],
      seed,
      steps,
      collect_step: normalizedCollectStep,
      cfg,
      sampler_name: sampler,
      scheduler,
      collect_block: Number.isFinite(freefuse?.collectBlock) ? Number(freefuse?.collectBlock) : 18,
      temperature: Number.isFinite(freefuse?.temperature) ? Number(freefuse?.temperature) : 0,
      top_k_ratio: Number.isFinite(freefuse?.topKRatio) ? Number(freefuse?.topKRatio) : 0.3,
      disable_lora_phase1: true,
    },
  };

  const maskNodeId = String(nextNodeId++);
  workflow[maskNodeId] = {
    class_type: 'FreeFuseMaskApplicator',
    inputs: {
      model: [phase1NodeId, 0],
      masks: [phase1NodeId, 1],
      freefuse_data: [tokenNodeId, 0],
      enable_token_masking: true,
      latent: latentSource,
      enable_attention_bias: freefuse?.enableAttentionBias ?? true,
      bias_scale: Number.isFinite(freefuse?.biasScale) ? Number(freefuse?.biasScale) : 5,
      positive_bias_scale: Number.isFinite(freefuse?.positiveBiasScale) ? Number(freefuse?.positiveBiasScale) : 1,
      bidirectional: true,
      use_positive_bias: true,
      bias_blocks: 'all',
    },
  };

  const samplerNodeId = String(nextNodeId++);
  workflow[samplerNodeId] = {
    class_type: 'KSampler',
    inputs: {
      model: [maskNodeId, 0],
      positive: [positiveNodeId, 0],
      negative: [negativeNodeId, 0],
      latent_image: latentSource,
      seed,
      steps,
      cfg,
      sampler_name: sampler,
      scheduler,
      denoise,
    },
  };

  const decodeNodeId = String(nextNodeId++);
  workflow[decodeNodeId] = {
    class_type: 'VAEDecode',
    inputs: {
      samples: [samplerNodeId, 0],
      vae: vaeSource,
    },
  };

  const saveNodeId = String(nextNodeId++);
  workflow[saveNodeId] = {
    class_type: 'SaveImage',
    inputs: {
      images: [decodeNodeId, 0],
      filename_prefix: 'ai-video-gen-freefuse',
    },
  };

  return workflow;
};

export const createComfyWorkflow = (options: ComfyGenerationOptions) => {
  const loraStack = normalizeLoraStack(options);
  const shouldUseFreeFuse = Boolean(options.freefuse?.enabled) && loraStack.length >= 2;
  if (shouldUseFreeFuse) {
    return createFreeFuseComfyWorkflow({ ...options, loraStack });
  }
  return createStandardComfyWorkflow({ ...options, loraStack });
};

const waitForHistory = async (baseUrl: string, promptId: string, timeoutMs = 120000) => {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const history = await fetchJson(baseUrl, `/history/${promptId}`);
    const entry = history?.[promptId];
    if (entry?.outputs) {
      return entry;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('ComfyUI generation timed out.');
};

export const generateComfyImage = async (
  options: ComfyGenerationOptions,
  workflowOverride?: Record<string, any>
): Promise<MediaItem> => {
  const workflow = workflowOverride || createComfyWorkflow(options);
  const promptResult = await fetchJson(options.baseUrl, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: workflow,
      client_id: `ai-video-${Date.now()}`,
    }),
  });
  const promptId = promptResult?.prompt_id || promptResult?.promptId;
  if (!promptId) {
    throw new Error('ComfyUI did not return a prompt id.');
  }
  const history = await waitForHistory(options.baseUrl, String(promptId));
  const outputs = history?.outputs || {};
  const images: Array<{ filename: string; subfolder?: string; type?: string }> = [];
  Object.values(outputs).forEach((output: any) => {
    if (output?.images && Array.isArray(output.images)) {
      output.images.forEach((img: any) => {
        if (img?.filename) images.push(img);
      });
    }
  });
  if (images.length === 0) {
    throw new Error('ComfyUI returned no images.');
  }
  const image = images[0];
  const url = new URL('/view', normalizeBaseUrl(options.baseUrl));
  url.searchParams.set('filename', image.filename);
  if (image.subfolder) url.searchParams.set('subfolder', image.subfolder);
  if (image.type) url.searchParams.set('type', image.type);

  return {
    id: buildId(),
    name: `ComfyUI_${new Date().toISOString()}`,
    type: 'image',
    url: url.toString(),
    source: 'generated',
    generatedBy: 'ComfyUI (local)',
  };
};
