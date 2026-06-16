import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CostRate, MediaItem, RecentProject, ReferenceItem, ShotPrompt, DirectorTreatment, DirectorShot } from '../types';
import type { UIMode } from '../config/uiModes';
import { SparklesIcon, UploadIcon, TrashIcon, DownloadIcon } from '../components/icons';
import {
  generateImageWithGemini3Pro,
  generateImageWithImagen,
  generateImageWithNano,
  generateImageWithReferences,
  relightImageWithGemini3Pro,
  analyzeImage,
  generateViMaxStoryboard,
} from '../services/geminiService';
import {
  generateImageWithFlux,
  generateImageWithFlux2Turbo,
  generateImageWithFluxKlein,
  generateImageWithRunwayGen4Turbo,
  generateImageWithGemini3ProReplicate,
  generateImageWithGptImage15,
  getReplicateTraining,
  generateImageWithQwenImage,
  generateImageWithSeedream,
  generateImageWithSeedreamReferences,
  generateImageWithWan27ImagePro,
  startFastFluxLoraTraining,
  generateImageWithZTurboImg2Img,
  generateImageWithZTurbo,
  generateImageWithZImage,
  editImageWithFireRed,
  relightImageWithReplicate,
} from '../services/replicateService';
import {
  editImageWithFalGptImage2,
  generateImageWithFalGptImage2,
  editImageWithFalNanoBanana2,
  editImageWithFalQwenMultiAngle,
  editImageWithFalWanV27Pro,
  generateImageWithFalNanoBanana2,
  generateImageWithFalQwenImageMax,
  generateImageWithFalSeedreamV5Lite,
  generateImageWithFalWanV27Pro
} from '../services/falAiService';
import { generateImageWithGrok } from '../services/xaiService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { RELIGHT_DIRECTIONS, RELIGHT_PRESETS, buildRelightPrompt } from '../utils/relight';
import type { RelightSettings } from '../utils/relight';
import { LibraryAsset, useLibraryAssets } from '../hooks/useLibraryAssets';
import { LensSelection } from '../components/LensSelection';
import { CAMERA_PRESETS, LENS_PRESETS } from '../data/cameraData';
import { estimateGenerationCost, formatUnitSummary, formatUsd } from '../utils/generationPricing';
import { formatSmartModelEta, routeSmartModel, type SmartModelCandidate, type SmartModelRoute } from '../utils/smartModelRouter';

import { StyleSelection } from '../components/StyleSelection';
import { STYLE_PRESETS } from '../data/styleData';
import { ShotTypeSelection } from '../components/ShotTypeSelection';
import { SHOT_TYPE_PRESETS } from '../data/shotTypeData';
import { LightingSelection } from '../components/LightingSelection';
import { LIGHTING_PRESETS } from '../data/lightingData';
import {
  ComfyLoraStackEntry,
  createComfyWorkflow,
  generateComfyImage,
  getComfyUiHealth,
  listComfyUiModels,
  testComfyUiConnection,
  uploadComfyImage,
} from '../services/comfyUiService';

import logoGemini from '../assets/logos/logo_gemini_1772276093848.png';
import logoNanabanana from '../assets/logos/logo_nanabanana_1772276159682.png';
import logoOpenai from '../assets/logos/logo_openai_1772276078244.png';
import logoGrok from '../assets/logos/logo_grok_1772276108537.png';
import logoSeedream from '../assets/logos/logo_seedream_1772276120681.png';
import logoBytedance from '../assets/logos/logo_bytedance_1772276133419.png';
import logoQwen from '../assets/logos/logo_qwen_1772276147335.png';

interface ImageGenerationWorkspaceProps {
  onAddGeneratedMedia: (item: MediaItem) => void;
  uiMode?: UIMode;
  apiKeyReady?: boolean;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
  costRates?: CostRate[];
  billingMode?: 'hosted' | 'byok';
  onValidateHostedGeneration?: (opts: {
    provider: CostRate['provider'];
    kind: CostRate['kind'];
    model?: string;
    units?: number;
    credits?: number;
  }) => Promise<{ ok: boolean; message?: string }>;
  onAnimateImage?: (item: MediaItem) => void;
}

type ImageModelId =
  | 'gemini-flash'
  | 'gemini-pro'
  | 'imagen'
  | 'grok-image'
  | 'gen4-turbo'
  | 'flux-pro'
  | 'flux-2-klein'
  | 'flux-2-turbo'
  | 'seedream'
  | 'wan-v27-image-pro-replicate'
  | 'seedream-v5-lite-fal'
  | 'wan-v27-pro-fal'
  | 'wan-v27-pro-edit-fal'
  | 'nano-banana-2-fal'
  | 'nano-banana-2-fal-edit'
  | 'firered'
  | 'qwen'
  | 'qwen-max-fal-t2i'
  | 'qwen-max-fal-edit'
  | 'gpt-image-2-fal'
  | 'gpt-image-2-fal-edit'
  | 'gpt-image-1-5'
  | 'z-image'
  | 'z-turbo'
  | 'z-turbo-img2img'
  | 'comfyui';

const MODEL_OPTIONS: Array<{ id: ImageModelId; label: string; provider: string; icon?: string; goodFor?: string }> = [
  { id: 'gemini-flash', label: 'Nano Banana 2 (fast)', provider: 'Gemini API', icon: logoNanabanana, goodFor: 'Speed, realism and detailed context adherence' },
  { id: 'gemini-pro', label: 'Gemini 3 Pro', provider: 'Gemini', icon: logoGemini, goodFor: 'Prompt adherence, complex reasoning and text layout' },
  { id: 'imagen', label: 'Imagen 4', provider: 'Gemini', icon: logoGemini, goodFor: 'Cinematic quality and highly stylized artistic renders' },
  { id: 'grok-image', label: 'Grok Image', provider: 'xAI', icon: logoGrok, goodFor: 'Creative, uncensored, and diverse artistic generations' },
  { id: 'gen4-turbo', label: 'Runway Gen-4 Turbo', provider: 'Replicate', goodFor: 'High-quality structured generation with excellent lighting' },
  { id: 'flux-pro', label: 'Flux 1.1 Pro', provider: 'Replicate', goodFor: 'Ultimate high fidelity and structural prompt adherence' },
  { id: 'flux-2-klein', label: 'Flux 2 Klein', provider: 'Replicate', goodFor: 'Fast and reliable standard generation' },
  { id: 'flux-2-turbo', label: 'Flux 2 Turbo', provider: 'Replicate', goodFor: 'Extremely fast real-time image generation' },
  { id: 'seedream', label: 'Seedream 4.5', provider: 'Replicate', icon: logoSeedream, goodFor: 'Exceptional cinematic realism and atmospheric depth' },
  { id: 'wan-v27-image-pro-replicate', label: 'WAN 2.7 Image Pro', provider: 'Replicate', icon: logoBytedance, goodFor: '4K-capable cinematic generation and multi-image editing via one model' },
  { id: 'seedream-v5-lite-fal', label: 'Seedream v5 Lite (FAL)', provider: 'FAL', icon: logoSeedream, goodFor: 'Fast cinematic realism and detailed environments' },
  { id: 'wan-v27-pro-fal', label: 'WAN 2.7 Pro (FAL)', provider: 'FAL', icon: logoBytedance, goodFor: 'High-detail cinematic image generation with strong composition' },
  { id: 'wan-v27-pro-edit-fal', label: 'WAN 2.7 Pro Edit (FAL)', provider: 'FAL', icon: logoBytedance, goodFor: 'Precise multi-reference image editing and transformations' },
  { id: 'nano-banana-2-fal', label: 'Nano Banana 2 (FAL)', provider: 'FAL', icon: logoNanabanana, goodFor: 'Speed, photorealism, and accurate character generation' },
  { id: 'nano-banana-2-fal-edit', label: 'Nano Banana 2 Edit (FAL)', provider: 'FAL', icon: logoNanabanana, goodFor: 'Fast and photorealistic contextual image editing' },
  { id: 'firered', label: 'FireRed Edit', provider: 'Replicate', goodFor: 'Multi-reference contextual editing and continuity-preserving redraws' },
  { id: 'qwen', label: 'Qwen Image 2512', provider: 'Replicate', icon: logoQwen, goodFor: 'Strong multilingual support and diverse aesthetic styles' },
  { id: 'qwen-max-fal-t2i', label: 'Qwen Image Max (FAL)', provider: 'FAL', icon: logoQwen, goodFor: 'Maximum quality multilingual generation and nuances' },
  { id: 'qwen-max-fal-edit', label: 'Qwen Image Max Edit (FAL)', provider: 'FAL', icon: logoQwen, goodFor: 'High fidelity and detailed image editing workflows' },
  { id: 'gpt-image-2-fal', label: 'GPT Image 2 (FAL)', provider: 'FAL', icon: logoOpenai, goodFor: 'High-end text rendering, prompt adherence, and detailed photoreal generation' },
  { id: 'gpt-image-2-fal-edit', label: 'GPT Image 2 Edit (FAL)', provider: 'FAL', icon: logoOpenai, goodFor: 'Fine-grained multi-image edits with strong prompt adherence' },
  { id: 'gpt-image-1-5', label: 'GPT Image 1.5', provider: 'Replicate', icon: logoOpenai, goodFor: 'Versatile, highly detailed and creative artistic styles' },
  { id: 'z-image', label: 'Z-Image', provider: 'Replicate', goodFor: 'Extreme speed and general-purpose cost-effectiveness' },
  { id: 'z-turbo', label: 'Z-Image Turbo', provider: 'Replicate', goodFor: 'Maximum speed lightweight generation' },
  { id: 'z-turbo-img2img', label: 'Z-Image Turbo Img2Img', provider: 'Replicate', goodFor: 'Fast style transfer and image-to-image workflows' },
  { id: 'comfyui', label: 'ComfyUI (Local)', provider: 'Local', goodFor: 'Unlimited control and advanced node-based local workflows' },
];

const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '2:1', '21:9', '235:100', '239:100'] as const;
const IMAGE_SIZES = ['1K', '2K', '4K'] as const;
const IMAGEN_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4'] as const;
export type AspectRatioOption = (typeof ASPECT_RATIOS)[number];
const MODEL_ASPECT_RATIOS: Record<ImageModelId, AspectRatioOption[]> = {
  'gemini-flash': [...IMAGEN_ASPECT_RATIOS],
  'gemini-pro': [...ASPECT_RATIOS],
  imagen: [...IMAGEN_ASPECT_RATIOS],
  'grok-image': ['4:3'],
  'gen4-turbo': [...ASPECT_RATIOS],
  'flux-pro': [...ASPECT_RATIOS],
  'flux-2-klein': [...ASPECT_RATIOS],
  'flux-2-turbo': [...ASPECT_RATIOS],
  seedream: [...ASPECT_RATIOS],
  'wan-v27-image-pro-replicate': [...ASPECT_RATIOS],
  'seedream-v5-lite-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'wan-v27-pro-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'wan-v27-pro-edit-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'nano-banana-2-fal': ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
  'nano-banana-2-fal-edit': ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'],
  firered: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  qwen: [...ASPECT_RATIOS],
  'qwen-max-fal-t2i': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'qwen-max-fal-edit': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'gpt-image-2-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'gpt-image-2-fal-edit': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'gpt-image-1-5': [...ASPECT_RATIOS],
  'z-image': [...ASPECT_RATIOS],
  'z-turbo': [...ASPECT_RATIOS],
  'z-turbo-img2img': [...ASPECT_RATIOS],
  comfyui: [...ASPECT_RATIOS],
};

// Camera/Lens data moved to ../data/cameraData.ts
const MODEL_REFERENCE_LIMITS: Record<ImageModelId, number> = {
  'gemini-flash': 10,
  'gemini-pro': 8,
  imagen: 0,
  'grok-image': 0,
  'gen4-turbo': 0,
  'flux-pro': 0,
  'flux-2-klein': 1,
  'flux-2-turbo': 1,
  seedream: 8,
  'wan-v27-image-pro-replicate': 9,
  'seedream-v5-lite-fal': 0,
  'wan-v27-pro-fal': 0,
  'wan-v27-pro-edit-fal': 4,
  'nano-banana-2-fal': 0,
  'nano-banana-2-fal-edit': 14,
  firered: 8,
  qwen: 8,
  'qwen-max-fal-t2i': 0,
  'qwen-max-fal-edit': 1,
  'gpt-image-2-fal': 0,
  'gpt-image-2-fal-edit': 8,
  'gpt-image-1-5': 6,
  'z-image': 0,
  'z-turbo': 0,
  'z-turbo-img2img': 1,
  comfyui: 1,
};
type ImageModelPricing = {
  provider: CostRate['provider'];
  kind: CostRate['kind'];
  model?: string;
};

const IMAGE_MODEL_PRICING: Partial<Record<ImageModelId, ImageModelPricing>> = {
  'gemini-flash': { provider: 'gemini', kind: 'image', model: 'gemini-3.1-flash-image-preview' },
  'gemini-pro': { provider: 'gemini', kind: 'image', model: 'gemini-3-pro-image-preview' },
  imagen: { provider: 'gemini', kind: 'image', model: 'imagen-4.0-generate-001' },
  'grok-image': { provider: 'xai', kind: 'image', model: 'grok-2-image' },
  'gen4-turbo': { provider: 'replicate', kind: 'image', model: 'runwayml/gen4-image-turbo' },
  'flux-pro': { provider: 'replicate', kind: 'image', model: 'black-forest-labs/flux-1.1-pro' },
  'flux-2-klein': { provider: 'replicate', kind: 'image', model: 'black-forest-labs/flux-2-klein-9b-base' },
  'flux-2-turbo': { provider: 'replicate', kind: 'image', model: 'prunaai/flux-2-turbo' },
  seedream: { provider: 'replicate', kind: 'image', model: 'bytedance/seedream-4.5' },
  'wan-v27-image-pro-replicate': { provider: 'replicate', kind: 'image', model: 'wan-video/wan-2.7-image-pro' },
  'seedream-v5-lite-fal': { provider: 'fal', kind: 'image', model: 'fal-ai/bytedance/seedream/v5/lite/text-to-image' },
  'wan-v27-pro-fal': { provider: 'fal', kind: 'image', model: 'fal-ai/wan/v2.7/pro/text-to-image' },
  'wan-v27-pro-edit-fal': { provider: 'fal', kind: 'edit', model: 'fal-ai/wan/v2.7/pro/edit' },
  'nano-banana-2-fal': { provider: 'fal', kind: 'image', model: 'fal-ai/nano-banana-2' },
  'nano-banana-2-fal-edit': { provider: 'fal', kind: 'edit', model: 'fal-ai/nano-banana-2/edit' },
  firered: { provider: 'replicate', kind: 'edit', model: 'prunaai/firered-image-edit' },
  qwen: { provider: 'replicate', kind: 'image', model: 'qwen/qwen-image-2512' },
  'qwen-max-fal-t2i': { provider: 'fal', kind: 'image', model: 'fal-ai/qwen-image-max/text-to-image' },
  'qwen-max-fal-edit': { provider: 'fal', kind: 'edit', model: 'fal-ai/qwen-image-max/edit' },
  'gpt-image-2-fal': { provider: 'fal', kind: 'image', model: 'openai/gpt-image-2' },
  'gpt-image-2-fal-edit': { provider: 'fal', kind: 'edit', model: 'openai/gpt-image-2/edit' },
  'gpt-image-1-5': { provider: 'replicate', kind: 'image', model: 'openai/gpt-image-1.5' },
  'z-image': { provider: 'replicate', kind: 'image', model: 'prunaai/z-image' },
  'z-turbo': { provider: 'replicate', kind: 'image', model: 'prunaai/z-image-turbo' },
  'z-turbo-img2img': { provider: 'replicate', kind: 'image', model: 'prunaai/z-image-turbo-img2img' },
};

const SMART_ROUTER_GOAL_PRESETS = [
  'realistischer Produktshot',
  'schnelle Vorschau',
  'billige Variation',
] as const;

const SMART_ROUTER_MODEL_CANDIDATES: SmartModelCandidate<ImageModelId>[] = [
  {
    id: 'gpt-image-2-fal',
    label: 'GPT Image 2 (FAL)',
    provider: 'fal',
    quality: 9.6,
    speed: 5.6,
    costEfficiency: 4.2,
    eta: { minSeconds: 60, maxSeconds: 120 },
    strengths: ['photoreal', 'product', 'commercial', 'studio', 'text'],
    recommendedImageSize: '2K',
  },
  {
    id: 'gemini-pro',
    label: 'Gemini 3 Pro',
    provider: 'gemini',
    quality: 9.3,
    speed: 5.2,
    costEfficiency: 4.4,
    eta: { minSeconds: 45, maxSeconds: 90 },
    strengths: ['quality', 'photoreal', 'realism', 'prompt adherence', 'commercial'],
    supportsReferences: true,
    recommendedImageSize: '2K',
  },
  {
    id: 'seedream',
    label: 'Seedream 4.5',
    provider: 'replicate',
    quality: 9.1,
    speed: 6.4,
    costEfficiency: 5.6,
    eta: { minSeconds: 30, maxSeconds: 60 },
    strengths: ['photoreal', 'cinematic', 'product', 'commercial', 'style'],
    supportsReferences: true,
    recommendedImageSize: '2K',
  },
  {
    id: 'wan-v27-image-pro-replicate',
    label: 'WAN 2.7 Image Pro',
    provider: 'replicate',
    quality: 8.9,
    speed: 5.8,
    costEfficiency: 5.4,
    eta: { minSeconds: 80, maxSeconds: 140 },
    strengths: ['quality', '4k', 'reference', 'commercial'],
    supportsReferences: true,
    recommendedImageSize: '2K',
  },
  {
    id: 'gen4-turbo',
    label: 'Runway Gen-4 Turbo',
    provider: 'replicate',
    quality: 8.7,
    speed: 6.8,
    costEfficiency: 5.4,
    eta: { minSeconds: 45, maxSeconds: 90 },
    strengths: ['quality', 'structured', 'lighting', 'commercial'],
    recommendedImageSize: '2K',
  },
  {
    id: 'nano-banana-2-fal',
    label: 'Nano Banana 2 (FAL)',
    provider: 'fal',
    quality: 8.5,
    speed: 8.5,
    costEfficiency: 5.2,
    eta: { minSeconds: 15, maxSeconds: 30 },
    strengths: ['fast', 'photoreal', 'preview', 'product'],
    recommendedImageSize: '1K',
  },
  {
    id: 'seedream-v5-lite-fal',
    label: 'Seedream v5 Lite (FAL)',
    provider: 'fal',
    quality: 8.1,
    speed: 8.2,
    costEfficiency: 6.6,
    eta: { minSeconds: 15, maxSeconds: 25 },
    strengths: ['fast', 'preview', 'photoreal', 'cinematic'],
    recommendedImageSize: '1K',
  },
  {
    id: 'flux-2-turbo',
    label: 'Flux 2 Turbo',
    provider: 'replicate',
    quality: 7.0,
    speed: 9.4,
    costEfficiency: 7.4,
    eta: { minSeconds: 8, maxSeconds: 18 },
    strengths: ['fast', 'preview', 'draft', 'iterate'],
    supportsReferences: true,
    recommendedImageSize: '1K',
  },
  {
    id: 'flux-2-klein',
    label: 'Flux 2 Klein',
    provider: 'replicate',
    quality: 7.2,
    speed: 7.6,
    costEfficiency: 7.2,
    eta: { minSeconds: 20, maxSeconds: 40 },
    strengths: ['preview', 'draft', 'balanced', 'reference'],
    supportsReferences: true,
    recommendedImageSize: '1K',
  },
  {
    id: 'qwen',
    label: 'Qwen Image 2512',
    provider: 'replicate',
    quality: 7.8,
    speed: 6.5,
    costEfficiency: 7.0,
    eta: { minSeconds: 25, maxSeconds: 60 },
    strengths: ['style', 'variation', 'reference', 'multilingual'],
    supportsReferences: true,
    recommendedImageSize: '1K',
  },
  {
    id: 'gpt-image-1-5',
    label: 'GPT Image 1.5',
    provider: 'replicate',
    quality: 8.8,
    speed: 5.8,
    costEfficiency: 5.2,
    eta: { minSeconds: 45, maxSeconds: 90 },
    strengths: ['quality', 'photoreal', 'reference', 'creative'],
    supportsReferences: true,
    recommendedImageSize: '2K',
  },
  {
    id: 'z-turbo-img2img',
    label: 'Z-Image Turbo Img2Img',
    provider: 'replicate',
    quality: 5.9,
    speed: 9.8,
    costEfficiency: 9.8,
    eta: { minSeconds: 8, maxSeconds: 15 },
    strengths: ['cheap', 'variation', 'reference', 'iterate', 'fast'],
    supportsReferences: true,
    requiresReferences: true,
    recommendedImageSize: '1K',
  },
  {
    id: 'z-turbo',
    label: 'Z-Image Turbo',
    provider: 'replicate',
    quality: 5.7,
    speed: 10,
    costEfficiency: 10,
    eta: { minSeconds: 6, maxSeconds: 12 },
    strengths: ['cheap', 'budget', 'preview', 'fast', 'iterate'],
    recommendedImageSize: '1K',
  },
  {
    id: 'z-image',
    label: 'Z-Image',
    provider: 'replicate',
    quality: 6.3,
    speed: 8.6,
    costEfficiency: 9.4,
    eta: { minSeconds: 8, maxSeconds: 18 },
    strengths: ['cheap', 'budget', 'variation', 'iterate'],
    recommendedImageSize: '1K',
  },
];
const LORA_SUPPORTED_MODELS = new Set<ImageModelId>(['flux-pro', 'flux-2-klein', 'flux-2-turbo', 'z-image', 'z-turbo', 'z-turbo-img2img']);
const PHOTOREALISM_PROMPT = `You are a VFX supervisor. Evaluate the photorealism of the image.
Return a concise Markdown report with:
- Photorealism score (0-100) and label (photoreal / mixed / stylized)
- Realism cues (lighting, materials, scale, lens, depth)
- Red flags (AI artifacts, texture issues, anatomy)
- Fix suggestions (prompt or post tweaks)
Keep it short and practical.`;
const HISTORY_STORAGE_PREFIX = 'image_generation_history_v1';
const IMAGE_WORKSPACE_UI_PREFS_KEY = 'image_workspace_ui_prefs_v1';
const COMFY_STORAGE_KEY = 'comfyui_config_v1';
const COMFY_PRESETS_KEY = 'comfyui_presets_v1';
const COMFY_FAVORITES_KEY = 'comfyui_favorites_v1';
const COMFY_SAMPLERS = ['euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'dpmpp_sde', 'heun', 'lcm'];
const COMFY_SCHEDULERS = ['normal', 'karras', 'exponential', 'simple', 'sgm_uniform'];
const COMFY_UPSCALE_WORKFLOW = JSON.stringify(
  {
    '1': {
      class_type: 'LoadImage',
      inputs: {
        image: 'input.png',
      },
    },
    '2': {
      class_type: 'UpscaleModelLoader',
      inputs: {
        model_name: '4x-UltraSharp.pth',
      },
    },
    '3': {
      class_type: 'ImageUpscaleWithModel',
      inputs: {
        upscale_model: ['2', 0],
        image: ['1', 0],
      },
    },
    '4': {
      class_type: 'SaveImage',
      inputs: {
        images: ['3', 0],
        filename_prefix: 'upscale',
      },
    },
  },
  null,
  2
);
const COMFY_FACE_RESTORE_WORKFLOW = JSON.stringify(
  {
    '1': {
      class_type: 'LoadImage',
      inputs: {
        image: 'input.png',
      },
    },
    '2': {
      class_type: 'GFPGAN',
      inputs: {
        image: ['1', 0],
        model_name: 'GFPGANv1.4.pth',
        strength: 1,
      },
    },
    '3': {
      class_type: 'SaveImage',
      inputs: {
        images: ['2', 0],
        filename_prefix: 'face_restore',
      },
    },
  },
  null,
  2
);

type ImageWorkspaceUiPrefs = {
  modelId?: ImageModelId;
};

const isImageModelId = (value: string): value is ImageModelId =>
  MODEL_OPTIONS.some((option) => option.id === value);

const buildWorkspaceUiPrefsScope = (projectPath?: string | null, projectName?: string | null) =>
  (projectPath || projectName || 'default').trim().toLowerCase();

const readImageWorkspaceUiPrefs = (scope: string): ImageWorkspaceUiPrefs => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(IMAGE_WORKSPACE_UI_PREFS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, ImageWorkspaceUiPrefs>;
    const scoped = all?.[scope];
    if (!scoped || typeof scoped !== 'object') return {};
    if (typeof scoped.modelId === 'string' && isImageModelId(scoped.modelId)) {
      return { modelId: scoped.modelId };
    }
    return {};
  } catch {
    return {};
  }
};

const writeImageWorkspaceUiPrefs = (scope: string, patch: ImageWorkspaceUiPrefs) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(IMAGE_WORKSPACE_UI_PREFS_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, ImageWorkspaceUiPrefs> : {};
    all[scope] = { ...(all[scope] || {}), ...patch };
    window.localStorage.setItem(IMAGE_WORKSPACE_UI_PREFS_KEY, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
};
const COMFY_CHAIN_TEMPLATES: ComfyChainTemplate[] = [
  {
    id: 'upscale-only',
    name: 'Txt2Img → Upscale (4x)',
    description: 'Runs a 4x upscaler after the base generation (update the model name if needed).',
    steps: [
      {
        name: 'Upscale (4x)',
        mode: 'custom',
        workflowJson: COMFY_UPSCALE_WORKFLOW,
        patchMap: {},
        useInitImage: true,
      },
    ],
  },
  {
    id: 'face-restore-only',
    name: 'Txt2Img → Face Restore',
    description: 'Runs GFPGAN face restore after the base generation (update the model name if needed).',
    steps: [
      {
        name: 'Face Restore',
        mode: 'custom',
        workflowJson: COMFY_FACE_RESTORE_WORKFLOW,
        patchMap: {},
        useInitImage: true,
      },
    ],
  },
  {
    id: 'upscale-face-restore',
    name: 'Txt2Img → Upscale → Face Restore',
    description: 'Upscale first, then restore faces (update model names if needed).',
    steps: [
      {
        name: 'Upscale (4x)',
        mode: 'custom',
        workflowJson: COMFY_UPSCALE_WORKFLOW,
        patchMap: {},
        useInitImage: true,
      },
      {
        name: 'Face Restore',
        mode: 'custom',
        workflowJson: COMFY_FACE_RESTORE_WORKFLOW,
        patchMap: {},
        useInitImage: true,
      },
    ],
  },
];

type MoodboardImage = {
  id: string;
  file: File;
  url: string;
};

type ContextReferenceImage = {
  id: string;
  file?: File;
  url: string;
};

type GenerationHistoryEntry = {
  id: string;
  createdAt: string;
  url: string;
  prompt: string;
  negativePrompt?: string;
  modelId: ImageModelId;
  modelLabel?: string;
  aspectRatio: AspectRatioOption;
  imageSize: (typeof IMAGE_SIZES)[number];
  selectedStyleId: string;
  selectedShotTypeId: string | null;
  selectedLightingId: string | null;
  cameraPresetId: string;
  lensPresetId: string;
  customStyle: string;
  references: Array<{ url: string; name?: string; type?: string }>;
};

type GenerationJob = {
  id: string;
  status: 'queued' | 'running' | 'done' | 'error';
  prompt: string;
  modelLabel?: string;
};

type ComfyPatchMap = {
  positiveNodeId?: string;
  negativeNodeId?: string;
  checkpointNodeId?: string;
  vaeNodeId?: string;
  clipNodeId?: string;
  loraNodeId?: string;
  samplerNodeId?: string;
  latentNodeId?: string;
  loadImageNodeId?: string;
};

type ComfyChainStep = {
  id: string;
  name: string;
  mode: 'auto' | 'custom';
  workflowJson: string;
  patchMap: ComfyPatchMap;
  useInitImage: boolean;
};

type ComfyChainTemplate = {
  id: string;
  name: string;
  description: string;
  steps: Array<Omit<ComfyChainStep, 'id'>>;
};

type ComfyPreset = {
  id: string;
  name: string;
  settings: {
    url: string;
    checkpoint: string;
    vae: string;
    clip: string;
    lora: string;
    loraScale: number;
    loraStackText: string;
    useFreeFuse: boolean;
    freeFuseBackgroundText: string;
    steps: number;
    cfg: number;
    sampler: string;
    scheduler: string;
    seed: number | null;
    denoise: number;
    workflowMode: 'auto' | 'custom';
    workflowJson: string;
    patchMap: ComfyPatchMap;
    chainEnabled: boolean;
    chainSteps: ComfyChainStep[];
  };
};

const ImageGenerationWorkspace: React.FC<ImageGenerationWorkspaceProps> = ({
  onAddGeneratedMedia,
  uiMode = 'pro',
  apiKeyReady,
  mediaItems = [],
  references = [],
  shotPrompts = [],
  recentProjects = [],
  currentProjectName,
  currentProjectPath,
  costRates = [],
  billingMode = 'hosted',
  onValidateHostedGeneration,
  onAnimateImage,
}) => {
  const isBeginnerMode = uiMode === 'beginner';
  const isProMode = uiMode === 'pro';
  const uiPrefsScope = useMemo(
    () => buildWorkspaceUiPrefsScope(currentProjectPath, currentProjectName),
    [currentProjectName, currentProjectPath],
  );
  const storedUiPrefs = useMemo(() => readImageWorkspaceUiPrefs(uiPrefsScope), [uiPrefsScope]);
  const [activeTab, setActiveTab] = useState<'generate' | 'moodboard' | 'relight' | 'photoreal' | 'director'>('generate');
  // Director Mode State
  const [directorScript, setDirectorScript] = useState('');
  const [directorTreatment, setDirectorTreatment] = useState<DirectorTreatment | null>(null);
  const [directorStatus, setDirectorStatus] = useState<string | null>(null);
  const [isDirecting, setIsDirecting] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [customStyle, setCustomStyle] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [selectedStyleId, setSelectedStyleId] = useState<string>('');
  const [selectedShotTypeId, setSelectedShotTypeId] = useState<string | null>(null);
  const [selectedLightingId, setSelectedLightingId] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>('16:9');
  const [imageSize, setImageSize] = useState<(typeof IMAGE_SIZES)[number]>('2K');
  const [modelId, setModelId] = useState<ImageModelId>(() => storedUiPrefs.modelId || 'gemini-pro');
  const [smartRouterGoal, setSmartRouterGoal] = useState('');
  const [appliedSmartRoute, setAppliedSmartRoute] = useState<SmartModelRoute<ImageModelId> | null>(null);
  const [cameraPresetId, setCameraPresetId] = useState('auto');
  const [lensPresetId, setLensPresetId] = useState('auto');
  const [customCameraNote, setCustomCameraNote] = useState('');
  const [customLensNote, setCustomLensNote] = useState('');
  const [loraUrl, setLoraUrl] = useState('');
  const [loraScale, setLoraScale] = useState(0.75);
  const [trainerDestination, setTrainerDestination] = useState('');
  const [trainerInputImagesUrl, setTrainerInputImagesUrl] = useState('');
  const [trainerTriggerWord, setTrainerTriggerWord] = useState('TOK');
  const [trainerType, setTrainerType] = useState<'subject' | 'style'>('subject');
  const [trainerId, setTrainerId] = useState('');
  const [trainerStatus, setTrainerStatus] = useState<string | null>(null);
  const [trainerIsRunning, setTrainerIsRunning] = useState(false);
  const [relightSourceUrl, setRelightSourceUrl] = useState('');
  const [relightModel, setRelightModel] = useState<'gemini' | 'replicate'>('gemini');
  const [relightPresetId, setRelightPresetId] = useState(RELIGHT_PRESETS[0]?.id || 'neutral');
  const [relightDirectionId, setRelightDirectionId] = useState(RELIGHT_DIRECTIONS[0]?.id || 'front');
  const [relightIntensity, setRelightIntensity] = useState(0.7);
  const [relightSoftness, setRelightSoftness] = useState(0.6);
  const [relightColor, setRelightColor] = useState('#ffffff');
  const [relightEnvironment, setRelightEnvironment] = useState('');
  const [relightNotes, setRelightNotes] = useState('');
  const [relightStatus, setRelightStatus] = useState<string | null>(null);
  const [relightIsRunning, setRelightIsRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [generated, setGenerated] = useState<MediaItem[]>([]);
  const [generationHistory, setGenerationHistory] = useState<GenerationHistoryEntry[]>([]);
  const [activeJobs, setActiveJobs] = useState<GenerationJob[]>([]);
  const [moodboard, setMoodboard] = useState<MoodboardImage[]>([]);
  const [contextReferences, setContextReferences] = useState<ContextReferenceImage[]>([]);
  const moodboardRef = useRef<MoodboardImage[]>([]);
  const contextRef = useRef<ContextReferenceImage[]>([]);
  const historySkipSaveRef = useRef(false);
  const [libraryAction, setLibraryAction] = useState<'reference' | 'moodboard' | 'relight' | 'photoreal'>('reference');
  const [librarySearch, setLibrarySearch] = useState('');
  const [assetPreview, setAssetPreview] = useState<{ url: string; kind: 'image' | 'video'; title?: string } | null>(null);
  const [photorealSourceUrl, setPhotorealSourceUrl] = useState('');
  const [photorealResult, setPhotorealResult] = useState('');
  const [photorealStatus, setPhotorealStatus] = useState<string | null>(null);
  const [isPhotorealChecking, setIsPhotorealChecking] = useState(false);
  const [comfyUrl, setComfyUrl] = useState('http://127.0.0.1:8188');
  const [comfyStatus, setComfyStatus] = useState<string | null>(null);
  const [comfyModels, setComfyModels] = useState<{ checkpoints: string[]; vae: string[]; loras: string[]; clips: string[] }>({
    checkpoints: [],
    vae: [],
    loras: [],
    clips: [],
  });
  const [comfyWorkflowMode, setComfyWorkflowMode] = useState<'auto' | 'custom'>('auto');
  const [comfyWorkflowJson, setComfyWorkflowJson] = useState('');
  const [comfyWorkflowError, setComfyWorkflowError] = useState<string | null>(null);
  const [comfyPatchMap, setComfyPatchMap] = useState<ComfyPatchMap>({});
  const [comfyChainEnabled, setComfyChainEnabled] = useState(false);
  const [comfyChainSteps, setComfyChainSteps] = useState<ComfyChainStep[]>([]);
  const [comfyChainTemplateId, setComfyChainTemplateId] = useState('');
  const [comfyPresets, setComfyPresets] = useState<ComfyPreset[]>([]);
  const [comfyPresetName, setComfyPresetName] = useState('');
  const [selectedComfyPresetId, setSelectedComfyPresetId] = useState<string>('');
  const [comfyFavorites, setComfyFavorites] = useState<{ checkpoints: string[]; vae: string[]; clips: string[]; loras: string[] }>({
    checkpoints: [],
    vae: [],
    clips: [],
    loras: [],
  });
  const [comfyLaunchCommand, setComfyLaunchCommand] = useState('python');
  const [comfyLaunchArgs, setComfyLaunchArgs] = useState('main.py');
  const [comfyLaunchCwd, setComfyLaunchCwd] = useState('');
  const [comfyAutoStart, setComfyAutoStart] = useState(false);
  const [comfyAutoProfileId, setComfyAutoProfileId] = useState('');
  const [comfyLaunchStatus, setComfyLaunchStatus] = useState<string | null>(null);
  const [comfyIsStarting, setComfyIsStarting] = useState(false);
  const [comfyLogLines, setComfyLogLines] = useState<string[]>([]);
  const [comfyLogStatus, setComfyLogStatus] = useState<string | null>(null);
  const [comfyIsLoadingLogs, setComfyIsLoadingLogs] = useState(false);
  const [comfyHealth, setComfyHealth] = useState<any | null>(null);
  const [comfyHealthStatus, setComfyHealthStatus] = useState<string | null>(null);
  const [comfyIsCheckingHealth, setComfyIsCheckingHealth] = useState(false);
  const [comfyCheckpoint, setComfyCheckpoint] = useState('');
  const [comfyVae, setComfyVae] = useState('');
  const [comfyClip, setComfyClip] = useState('');
  const [comfyLora, setComfyLora] = useState('');
  const [comfyLoraScale, setComfyLoraScale] = useState(0.7);
  const [comfyLoraStackText, setComfyLoraStackText] = useState('');
  const [comfyUseFreeFuse, setComfyUseFreeFuse] = useState(false);
  const [comfyFreeFuseBackgroundText, setComfyFreeFuseBackgroundText] = useState('');
  const [comfySteps, setComfySteps] = useState(24);
  const [comfyCfg, setComfyCfg] = useState(7);
  const [comfySampler, setComfySampler] = useState(COMFY_SAMPLERS[0]);
  const [comfyScheduler, setComfyScheduler] = useState(COMFY_SCHEDULERS[0]);
  const [comfySeed, setComfySeed] = useState<number | ''>('');
  const [comfyDenoise, setComfyDenoise] = useState(0.7);
  const [comfyIsLoading, setComfyIsLoading] = useState(false);
  const comfyAutoStartRef = useRef(false);

  // Model Dropdown State
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const characterReferences = useMemo(
    () => references.filter((item) => item.type === 'character' && item.imageUrl),
    [references]
  );

  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const stylePrompt = useMemo(() => {
    const preset = STYLE_PRESETS.find((p) => p.id === selectedStyleId);
    const custom = customStyle.trim();
    return [preset?.prompt, custom].filter(Boolean).join(', ');
  }, [customStyle, selectedStyleId]);

  const shotTypePrompt = useMemo(() => {
    return SHOT_TYPE_PRESETS.find((s) => s.id === selectedShotTypeId)?.prompt || '';
  }, [selectedShotTypeId]);

  const lightingPrompt = useMemo(() => {
    return LIGHTING_PRESETS.find((l) => l.id === selectedLightingId)?.prompt || '';
  }, [selectedLightingId]);

  const styleReferenceHint = useMemo(() => {
    return moodboard.length > 0 ? 'Match the moodboard reference style.' : '';
  }, [moodboard.length]);

  const cameraPreset = useMemo(
    () => CAMERA_PRESETS.find((preset) => preset.id === cameraPresetId),
    [cameraPresetId]
  );
  const lensPreset = useMemo(
    () => LENS_PRESETS.find((preset) => preset.id === lensPresetId),
    [lensPresetId]
  );
  const effectiveAspectRatio = lensPreset?.aspectRatioOverride || aspectRatio;
  const availableAspectRatios = MODEL_ASPECT_RATIOS[modelId] || ASPECT_RATIOS;
  const lensAspectHint = lensPreset?.aspectRatioHint ? lensPreset.aspectRatioHint.trim() : '';
  const cameraLensPrompt = useMemo(() => {
    return [
      cameraPreset?.prompt,
      lensPreset?.prompt,
      customCameraNote.trim(),
      customLensNote.trim(),
    ]
      .filter(Boolean)
      .join(', ');
  }, [cameraPreset?.prompt, lensPreset?.prompt, customCameraNote, customLensNote]);

  const finalPrompt = useMemo(() => {
    const parts = [
      styleReferenceHint,
      stylePrompt,
      shotTypePrompt,
      lightingPrompt,
      prompt.trim(),
      cameraLensPrompt,
      lensAspectHint
    ];
    if (negativePrompt.trim()) {
      parts.push(`Avoid: ${negativePrompt.trim()}`);
    }
    return parts.filter(Boolean).join('. ');
  }, [negativePrompt, prompt, stylePrompt, shotTypePrompt, lightingPrompt, styleReferenceHint, cameraLensPrompt, lensAspectHint]);

  const supportsAspect = availableAspectRatios.length > 1;
  const supportsSize = modelId === 'gemini-flash'
    || modelId === 'gemini-pro'
    || modelId === 'seedream'
    || modelId === 'wan-v27-image-pro-replicate'
    || modelId === 'nano-banana-2-fal'
    || modelId === 'nano-banana-2-fal-edit'
    || modelId === 'comfyui';
  const readyForGeneration = modelId === 'comfyui' ? true : apiKeyReady !== false;
  const referenceLimit = MODEL_REFERENCE_LIMITS[modelId] || 0;
  const supportsReferences = referenceLimit > 0;
  const supportsLora = LORA_SUPPORTED_MODELS.has(modelId);
  const hasMoodboard = moodboard.length > 0;
  const isComfyUi = modelId === 'comfyui';
  const imagenAspectRatio = (IMAGEN_ASPECT_RATIOS as readonly string[]).includes(effectiveAspectRatio)
    ? (effectiveAspectRatio as (typeof IMAGEN_ASPECT_RATIOS)[number])
    : '16:9';
  const activeReferenceSource = isComfyUi
    ? contextReferences
    : contextReferences.length > 0
      ? contextReferences
      : moodboard;
  const referenceOverflow = supportsReferences && activeReferenceSource.length > referenceLimit;
  const activeReferences = supportsReferences ? activeReferenceSource.slice(0, referenceLimit) : [];
  const readSmartRouterAvailableProviders = () => {
    if (billingMode === 'hosted') return undefined;
    if (typeof window === 'undefined') return undefined;
    const providers: string[] = [];
    if (process.env.API_KEY || window.localStorage.getItem('gemini_api_key')) providers.push('gemini');
    if (window.localStorage.getItem('replicate_api_key')) providers.push('replicate');
    if (window.localStorage.getItem('fal_api_key')) providers.push('fal');
    if (window.localStorage.getItem('xai_api_key')) providers.push('xai');
    return providers.length > 0 ? providers : undefined;
  };
  const resolveSmartRoute = (goalText: string) =>
    routeSmartModel<ImageModelId>({
      goal: goalText,
      candidates: SMART_ROUTER_MODEL_CANDIDATES,
      availableProviders: readSmartRouterAvailableProviders(),
      hasReferences: activeReferenceSource.length > 0,
    });
  const smartRoutePreview = useMemo(() => {
    const goalText = smartRouterGoal.trim();
    if (!goalText) return null;
    return resolveSmartRoute(goalText);
  }, [activeReferenceSource.length, apiKeyReady, billingMode, smartRouterGoal]);
  const currentSmartModelCandidate = useMemo(
    () => SMART_ROUTER_MODEL_CANDIDATES.find((candidate) => candidate.id === modelId) || null,
    [modelId]
  );
  const currentModelEta = formatSmartModelEta(currentSmartModelCandidate?.eta);
  const generationCostEstimate = useMemo(() => {
    const pricing = IMAGE_MODEL_PRICING[modelId];
    if (!pricing) return null;
    let units = 1;
    if (modelId === 'gemini-flash') {
      units = imageSize === '4K' ? 16 : imageSize === '2K' ? 4 : 1;
    } else if (modelId === 'nano-banana-2-fal' || modelId === 'nano-banana-2-fal-edit') {
      units = imageSize === '4K' ? 2 : imageSize === '2K' ? 1.5 : 1;
    } else if (modelId === 'gemini-pro') {
      units = imageSize === '4K' ? 1.6 : imageSize === '2K' ? 1.3 : 1;
    } else if (modelId === 'seedream') {
      units = imageSize === '4K' ? 1.5 : 1;
    } else if (modelId === 'wan-v27-image-pro-replicate') {
      units = imageSize === '4K' ? 1.8 : imageSize === '2K' ? 1.25 : 1;
    }
    return estimateGenerationCost({
      rates: costRates,
      provider: pricing.provider,
      kind: pricing.kind,
      model: pricing.model,
      units,
    });
  }, [modelId, imageSize, costRates]);
  const generationCostDetail = useMemo(() => {
    if (modelId === 'comfyui') return 'Local ComfyUI generation is not billed by hosted credits.';
    if (!generationCostEstimate) return 'No price mapping found for the selected model.';
    if (modelId === 'firered') return 'FireRed is a reference-first edit model and needs at least one context or moodboard image.';
    if (modelId === 'gemini-flash' && imageSize !== '1K') return `${imageSize} render applies a large output-token multiplier for Nano Banana 2.`;
    if ((modelId === 'nano-banana-2-fal' || modelId === 'nano-banana-2-fal-edit') && imageSize !== '1K') {
      return `${imageSize} render applies higher FAL compute pricing than 1K.`;
    }
    if (modelId === 'wan-v27-image-pro-replicate' && imageSize === '4K') {
      return 'WAN 2.7 Image Pro supports 4K for text-to-image; reference-guided edits may fall back to 2K.';
    }
    if (modelId === 'seedream' && imageSize === '4K') return '4K generation uses higher compute than 2K.';
    if (modelId === 'gemini-pro' && imageSize !== '1K') return `${imageSize} render applies a higher compute multiplier.`;
    return `Based on ${formatUnitSummary(generationCostEstimate.units, generationCostEstimate.unitLabel)}.`;
  }, [generationCostEstimate, imageSize, modelId]);

  const normalizeComfyUrl = (value: string) => value.trim().replace(/\/+$/, '');
  const normalizeAdapterName = (value: string, fallback: string) =>
    (value || fallback)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback;
  const parseComfyLoraStack = (input: string, fallbackScale: number): ComfyLoraStackEntry[] => {
    const lines = (input || '')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#'));
    const parsed = lines
      .map((line, index) => {
        const [loraNameRaw, adapterRaw, conceptRaw, modelScaleRaw, clipScaleRaw] = line.split('|').map((part) => part.trim());
        const loraName = (loraNameRaw || '').trim();
        if (!loraName) return null;
        const fallbackAdapter = `concept${index + 1}`;
        const adapterName = normalizeAdapterName(adapterRaw, fallbackAdapter);
        const strengthModel = Number.isFinite(Number(modelScaleRaw)) ? Number(modelScaleRaw) : fallbackScale;
        const strengthClip = Number.isFinite(Number(clipScaleRaw)) ? Number(clipScaleRaw) : strengthModel;
        return {
          loraName,
          adapterName,
          conceptText: (conceptRaw || adapterName).trim(),
          strengthModel,
          strengthClip,
        } satisfies ComfyLoraStackEntry;
      })
      .filter((entry) => Boolean(entry)) as ComfyLoraStackEntry[];
    return parsed.slice(0, 4);
  };
  const comfyParsedLoraStack = useMemo(
    () => parseComfyLoraStack(comfyLoraStackText, comfyLoraScale),
    [comfyLoraScale, comfyLoraStackText]
  );
  const comfyEffectiveLoraStack = useMemo(() => {
    if (comfyParsedLoraStack.length > 0) return comfyParsedLoraStack;
    if (!comfyLora) return [] as ComfyLoraStackEntry[];
    return [{
      loraName: comfyLora,
      adapterName: 'concept1',
      conceptText: 'subject',
      strengthModel: comfyLoraScale,
      strengthClip: comfyLoraScale,
    }] as ComfyLoraStackEntry[];
  }, [comfyLora, comfyLoraScale, comfyParsedLoraStack]);
  const comfyFreeFuseActive = comfyUseFreeFuse && comfyEffectiveLoraStack.length >= 2;
  const comfyHasAnyLoraSelection = comfyEffectiveLoraStack.length > 0;
  const roundToMultiple = (value: number, multiple: number) => Math.round(value / multiple) * multiple;
  const resolveComfyDimensions = (ratio: string, size: (typeof IMAGE_SIZES)[number]) => {
    const parts = ratio.split(':').map((part) => Number(part));
    const [w, h] = parts.length === 2 && parts.every((part) => Number.isFinite(part) && part > 0)
      ? parts
      : [16, 9];
    const maxEdge = size === '4K' ? 4096 : size === '2K' ? 2048 : 1024;
    const r = w / h;
    let width = r >= 1 ? maxEdge : Math.round(maxEdge * r);
    let height = r >= 1 ? Math.round(maxEdge / r) : maxEdge;
    width = Math.max(256, roundToMultiple(width, 8));
    height = Math.max(256, roundToMultiple(height, 8));
    return { width, height };
  };
  const parseComfyArgs = (input: string) => {
    const matches = input.match(/(?:[^\s"]+|"[^"]*")+/g);
    if (!matches) return [];
    return matches.map((value) => value.replace(/^"|"$/g, ''));
  };
  const sortWithFavorites = (list: string[], favorites: string[]) => {
    const favoriteSet = new Set(favorites);
    const favs = list.filter((item) => favoriteSet.has(item));
    const rest = list.filter((item) => !favoriteSet.has(item));
    return [...favs, ...rest];
  };
  const parseComfyWorkflowNodes = (json: string) => {
    if (!json.trim()) return null;
    try {
      const parsed = JSON.parse(json) as Record<string, any>;
      if (!parsed || typeof parsed !== 'object') return null;
      const entries = Object.entries(parsed)
        .filter(([, node]) => node && typeof node === 'object' && (node as any).class_type)
        .map(([id, node]) => [id, node as any] as [string, any]);
      const outputsById = new Map<string, Set<number>>();
      const collectRefs = (value: any) => {
        if (Array.isArray(value)) {
          if (value.length >= 2 && typeof value[0] === 'string' && typeof value[1] === 'number') {
            if (!outputsById.has(value[0])) outputsById.set(value[0], new Set());
            outputsById.get(value[0])?.add(value[1]);
          }
          value.forEach(collectRefs);
          return;
        }
        if (value && typeof value === 'object') {
          Object.values(value).forEach(collectRefs);
        }
      };
      entries.forEach(([, node]) => {
        Object.values(node?.inputs || {}).forEach(collectRefs);
      });
      const nodes = entries.map(([id, node]) => ({
        id,
        type: node.class_type as string,
        inputs: Object.keys(node?.inputs || {}),
        outputs: Array.from(outputsById.get(id) ?? []).sort((a, b) => a - b),
      }));
      const nodeMap = Object.fromEntries(nodes.map((node) => [node.id, node]));
      const byType = (type: string) => nodes.filter((node) => node.type === type);
      return { nodes, nodeMap, byType };
    } catch {
      return null;
    }
  };
  const formatComfyHealth = (payload: any) => {
    try {
      return JSON.stringify(payload, null, 2);
    } catch {
      return String(payload);
    }
  };
  const renderComfyPatchPreview = (
    patchMap: ComfyPatchMap,
    nodes: ReturnType<typeof parseComfyWorkflowNodes> | null
  ) => {
    if (!nodes) return null;
    const entries = [
      { label: 'Positive', id: patchMap.positiveNodeId },
      { label: 'Negative', id: patchMap.negativeNodeId },
      { label: 'Checkpoint', id: patchMap.checkpointNodeId },
      { label: 'VAE', id: patchMap.vaeNodeId },
      { label: 'CLIP', id: patchMap.clipNodeId },
      { label: 'LoRA', id: patchMap.loraNodeId },
      { label: 'Sampler', id: patchMap.samplerNodeId },
      { label: 'Latent', id: patchMap.latentNodeId },
      { label: 'Load Image', id: patchMap.loadImageNodeId },
    ].filter((entry): entry is { label: string; id: string } => Boolean(entry.id));
    if (entries.length === 0) return null;
    return (
      <div className="space-y-2 text-[10px] text-gray-500">
        {entries.map((entry) => {
          const node = nodes.nodeMap?.[entry.id];
          if (!node) return null;
          return (
            <div key={`${entry.label}-${entry.id}`} className="rounded border border-gray-700 bg-gray-900/40 p-2">
              <div className="text-gray-300">
                {entry.label}: {entry.id} • {node.type}
              </div>
              <div>Inputs: {node.inputs.length ? node.inputs.join(', ') : 'None'}</div>
              <div>Outputs: {node.outputs.length ? node.outputs.join(', ') : 'None'}</div>
            </div>
          );
        })}
      </div>
    );
  };
  const historyStorageKey = useMemo(() => {
    if (currentProjectPath) return `${HISTORY_STORAGE_PREFIX}:${currentProjectPath}`;
    if (currentProjectName) return `${HISTORY_STORAGE_PREFIX}:name:${currentProjectName}`;
    return HISTORY_STORAGE_PREFIX;
  }, [currentProjectName, currentProjectPath]);

  useEffect(() => {
    const prefs = readImageWorkspaceUiPrefs(uiPrefsScope);
    if (prefs.modelId) {
      setModelId(prefs.modelId);
    }
  }, [uiPrefsScope]);

  useEffect(() => {
    writeImageWorkspaceUiPrefs(uiPrefsScope, { modelId });
  }, [modelId, uiPrefsScope]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    historySkipSaveRef.current = true;
    try {
      const raw = window.localStorage.getItem(historyStorageKey);
      if (!raw) {
        setGenerationHistory([]);
        return;
      }
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setGenerationHistory(parsed.slice(0, 20));
      } else {
        setGenerationHistory([]);
      }
    } catch {
      setGenerationHistory([]);
    }
  }, [historyStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (historySkipSaveRef.current) {
      historySkipSaveRef.current = false;
      return;
    }
    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(generationHistory));
    } catch {
      // Ignore localStorage errors (quota/private mode).
    }
  }, [generationHistory, historyStorageKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(COMFY_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (parsed?.url) setComfyUrl(parsed.url);
      if (parsed?.checkpoint) setComfyCheckpoint(parsed.checkpoint);
      if (parsed?.vae) setComfyVae(parsed.vae);
      if (parsed?.clip) setComfyClip(parsed.clip);
      if (parsed?.lora) setComfyLora(parsed.lora);
      if (typeof parsed?.loraScale === 'number') setComfyLoraScale(parsed.loraScale);
      if (typeof parsed?.loraStackText === 'string') setComfyLoraStackText(parsed.loraStackText);
      if (typeof parsed?.useFreeFuse === 'boolean') setComfyUseFreeFuse(parsed.useFreeFuse);
      if (typeof parsed?.freeFuseBackgroundText === 'string') setComfyFreeFuseBackgroundText(parsed.freeFuseBackgroundText);
      if (typeof parsed?.steps === 'number') setComfySteps(parsed.steps);
      if (typeof parsed?.cfg === 'number') setComfyCfg(parsed.cfg);
      if (typeof parsed?.sampler === 'string') setComfySampler(parsed.sampler);
      if (typeof parsed?.scheduler === 'string') setComfyScheduler(parsed.scheduler);
      if (typeof parsed?.seed === 'number') setComfySeed(parsed.seed);
      if (typeof parsed?.denoise === 'number') setComfyDenoise(parsed.denoise);
      if (typeof parsed?.workflowMode === 'string') setComfyWorkflowMode(parsed.workflowMode);
      if (typeof parsed?.workflowJson === 'string') setComfyWorkflowJson(parsed.workflowJson);
      if (typeof parsed?.launchCommand === 'string') setComfyLaunchCommand(parsed.launchCommand);
      if (typeof parsed?.launchArgs === 'string') setComfyLaunchArgs(parsed.launchArgs);
      if (typeof parsed?.launchCwd === 'string') setComfyLaunchCwd(parsed.launchCwd);
      if (typeof parsed?.autoStart === 'boolean') setComfyAutoStart(parsed.autoStart);
      if (parsed?.patchMap && typeof parsed.patchMap === 'object') setComfyPatchMap(parsed.patchMap);
      if (typeof parsed?.chainEnabled === 'boolean') setComfyChainEnabled(parsed.chainEnabled);
      if (Array.isArray(parsed?.chainSteps)) setComfyChainSteps(parsed.chainSteps);
      if (typeof parsed?.autoProfileId === 'string') setComfyAutoProfileId(parsed.autoProfileId);
    } catch {
      // ignore malformed localStorage
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const payload = {
      url: comfyUrl,
      checkpoint: comfyCheckpoint,
      vae: comfyVae,
      clip: comfyClip,
      lora: comfyLora,
      loraScale: comfyLoraScale,
      loraStackText: comfyLoraStackText,
      useFreeFuse: comfyUseFreeFuse,
      freeFuseBackgroundText: comfyFreeFuseBackgroundText,
      steps: comfySteps,
      cfg: comfyCfg,
      sampler: comfySampler,
      scheduler: comfyScheduler,
      seed: typeof comfySeed === 'number' ? comfySeed : null,
      denoise: comfyDenoise,
      workflowMode: comfyWorkflowMode,
      workflowJson: comfyWorkflowJson,
      launchCommand: comfyLaunchCommand,
      launchArgs: comfyLaunchArgs,
      launchCwd: comfyLaunchCwd,
      autoStart: comfyAutoStart,
      patchMap: comfyPatchMap,
      chainEnabled: comfyChainEnabled,
      chainSteps: comfyChainSteps,
      autoProfileId: comfyAutoProfileId,
    };
    try {
      window.localStorage.setItem(COMFY_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // ignore localStorage errors
    }
  }, [
    comfyUrl,
    comfyCheckpoint,
    comfyVae,
    comfyClip,
    comfyLora,
    comfyLoraScale,
    comfyLoraStackText,
    comfyUseFreeFuse,
    comfyFreeFuseBackgroundText,
    comfySteps,
    comfyCfg,
    comfySampler,
    comfyScheduler,
    comfySeed,
    comfyDenoise,
    comfyWorkflowMode,
    comfyWorkflowJson,
    comfyLaunchCommand,
    comfyLaunchArgs,
    comfyLaunchCwd,
    comfyAutoStart,
    comfyPatchMap,
    comfyChainEnabled,
    comfyChainSteps,
    comfyAutoProfileId,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(COMFY_PRESETS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) setComfyPresets(parsed);
      }
    } catch {
      setComfyPresets([]);
    }
    try {
      const raw = window.localStorage.getItem(COMFY_FAVORITES_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed) setComfyFavorites(parsed);
      }
    } catch {
      setComfyFavorites({ checkpoints: [], vae: [], clips: [], loras: [] });
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(COMFY_PRESETS_KEY, JSON.stringify(comfyPresets));
    } catch {
      // ignore localStorage errors
    }
  }, [comfyPresets]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(COMFY_FAVORITES_KEY, JSON.stringify(comfyFavorites));
    } catch {
      // ignore localStorage errors
    }
  }, [comfyFavorites]);

  useEffect(() => {
    if (!availableAspectRatios.includes(aspectRatio)) {
      setAspectRatio(availableAspectRatios[0]);
    }
  }, [availableAspectRatios, aspectRatio]);

  // removed togglePreset

  useEffect(() => {
    moodboardRef.current = moodboard;
  }, [moodboard]);

  useEffect(() => {
    return () => {
      moodboardRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    contextRef.current = contextReferences;
  }, [contextReferences]);

  useEffect(() => {
    return () => {
      contextRef.current.forEach((item) => URL.revokeObjectURL(item.url));
    };
  }, []);

  useEffect(() => {
    if (!isComfyUi) return;
    const url = normalizeComfyUrl(comfyUrl);
    if (!url) return;
    if (comfyModels.checkpoints.length === 0) {
      loadComfyModels(url);
    }
  }, [isComfyUi]);

  useEffect(() => {
    if (!isComfyUi || !comfyAutoStart) return;
    if (comfyAutoStartRef.current) return;
    comfyAutoStartRef.current = true;
    if (comfyAutoProfileId) {
      applyComfyPreset(comfyAutoProfileId);
    }
    setTimeout(() => {
      handleComfyStart();
    }, 300);
  }, [isComfyUi, comfyAutoStart]);

  useEffect(() => {
    if (!comfyAutoStart) {
      comfyAutoStartRef.current = false;
    }
  }, [comfyAutoStart]);

  const handleMoodboardUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const additions: MoodboardImage[] = Array.from(files).map((file, index) => ({
      id: `mood-${Date.now()}-${index}`,
      file,
      url: URL.createObjectURL(file),
    }));
    setMoodboard((prev) => [...prev, ...additions]);
  };

  const handleMoodboardRemove = (id: string) => {
    setMoodboard((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleMoodboardClear = () => {
    moodboard.forEach((item) => URL.revokeObjectURL(item.url));
    setMoodboard([]);
  };

  const handleContextUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    if (!supportsReferences) {
      setStatus('This model does not accept reference images.');
      return;
    }
    const remaining = referenceLimit - contextReferences.length;
    if (remaining <= 0) {
      setStatus(`Only ${referenceLimit} reference images are supported for this model.`);
      return;
    }
    const additions: ContextReferenceImage[] = Array.from(files)
      .slice(0, remaining)
      .map((file, index) => ({
        id: `ctx-${Date.now()}-${index}`,
        file,
        url: URL.createObjectURL(file),
      }));
    setContextReferences((prev) => [...prev, ...additions]);
  };

  const handleContextRemove = (id: string) => {
    setContextReferences((prev) => {
      const target = prev.find((item) => item.id === id);
      if (target) {
        URL.revokeObjectURL(target.url);
      }
      return prev.filter((item) => item.id !== id);
    });
  };

  const handleContextClear = () => {
    contextReferences.forEach((item) => URL.revokeObjectURL(item.url));
    setContextReferences([]);
  };

  const fileFromUrl = async (url: string, name: string) => {
    const response = await fetch(url);
    const blob = await response.blob();
    const ext = blob.type.split('/')[1] || 'png';
    return new File([blob], `${name}.${ext}`, { type: blob.type || 'image/png' });
  };

  const addLibraryReference = async (asset: LibraryAsset) => {
    if (!asset.url) return;
    if (!supportsReferences) {
      setStatus('This model does not accept reference images.');
      return;
    }
    if (contextReferences.length >= referenceLimit) {
      setStatus(`Only ${referenceLimit} reference images are supported for this model.`);
      return;
    }
    const file = await fileFromUrl(asset.url, asset.name || 'reference');
    const url = URL.createObjectURL(file);
    setContextReferences((prev) => [...prev, { id: `ctx-lib-${Date.now()}`, file, url }]);
  };

  const addLibraryMoodboard = async (asset: LibraryAsset) => {
    if (!asset.url) return;
    const file = await fileFromUrl(asset.url, asset.name || 'moodboard');
    const url = URL.createObjectURL(file);
    setMoodboard((prev) => [...prev, { id: `mood-lib-${Date.now()}`, file, url }]);
  };

  const addLibraryRelight = (asset: LibraryAsset) => {
    if (!asset.url) return;
    setRelightSourceUrl(asset.url);
    setRelightStatus(`Selected ${asset.name || 'library image'} for relighting.`);
    setActiveTab('relight');
  };

  const addLibraryPhotoreal = (asset: LibraryAsset) => {
    if (!asset.url) return;
    setPhotorealSourceUrl(asset.url);
    setPhotorealResult('');
    setPhotorealStatus(null);
    setActiveTab('photoreal');
  };

  const hasGeminiKey = () => {
    if (typeof window === 'undefined') return false;
    try {
      return !!(localStorage.getItem('gemini_api_key') || process.env.API_KEY);
    } catch {
      return false;
    }
  };

  const handlePhotorealCheck = async () => {
    if (!photorealSourceUrl.trim()) {
      setPhotorealStatus('Upload or select an image to analyze.');
      return;
    }
    if (!hasGeminiKey()) {
      setPhotorealStatus('Add a Gemini API key in Settings to run photorealism checks.');
      return;
    }
    setIsPhotorealChecking(true);
    setPhotorealStatus('Analyzing photorealism...');
    try {
      const payload = await getBase64FromUrl(photorealSourceUrl.trim());
      const response = await analyzeImage(PHOTOREALISM_PROMPT, payload);
      setPhotorealResult(response.trim());
      setPhotorealStatus('Analysis complete.');
    } catch (error) {
      setPhotorealStatus(error instanceof Error ? error.message : 'Photorealism check failed.');
    } finally {
      setIsPhotorealChecking(false);
    }
  };

  const buildRelightSettings = (): RelightSettings => ({
    presetId: relightPresetId,
    directionId: relightDirectionId,
    intensity: relightIntensity,
    softness: relightSoftness,
    color: relightColor,
    environment: relightEnvironment,
    notes: relightNotes,
  });

  const loadComfyModels = async (baseUrl: string) => {
    setComfyIsLoading(true);
    try {
      const models = await listComfyUiModels(baseUrl);
      setComfyModels(models);
      setComfyCheckpoint((prev) => (models.checkpoints.includes(prev) ? prev : models.checkpoints[0] || ''));
      setComfyVae((prev) => (models.vae.includes(prev) ? prev : models.vae[0] || ''));
      setComfyClip((prev) => (models.clips.includes(prev) ? prev : models.clips[0] || ''));
      setComfyLora((prev) => (models.loras.includes(prev) ? prev : ''));
      setComfyStatus('ComfyUI models loaded.');
    } catch (error) {
      setComfyStatus(error instanceof Error ? error.message : 'Failed to load ComfyUI models.');
    } finally {
      setComfyIsLoading(false);
    }
  };

  const handleComfyConnect = async () => {
    const url = normalizeComfyUrl(comfyUrl);
    if (!url) {
      setComfyStatus('Enter a ComfyUI server URL.');
      return;
    }
    setComfyStatus('Connecting to ComfyUI...');
    try {
      await testComfyUiConnection(url);
      setComfyStatus('Connected. Loading models...');
      await loadComfyModels(url);
    } catch (error) {
      setComfyStatus(error instanceof Error ? error.message : 'Failed to connect to ComfyUI.');
    }
  };

  const handleComfyStart = async () => {
    const comfyApi = (typeof window !== 'undefined' ? (window as any).electron?.comfyui : undefined) as
      | {
        start: (options: { command: string; args?: string[]; cwd?: string }) => Promise<any>;
      }
      | undefined;
    if (!comfyApi) {
      setComfyLaunchStatus('Auto-start is available in the desktop app only.');
      return;
    }
    const command = comfyLaunchCommand.trim();
    if (!command) {
      setComfyLaunchStatus('Set a ComfyUI launch command first.');
      return;
    }
    setComfyIsStarting(true);
    try {
      const args = parseComfyArgs(comfyLaunchArgs);
      const result = await comfyApi.start({
        command,
        args,
        cwd: comfyLaunchCwd.trim() || undefined,
      });
      if (result?.error) {
        setComfyLaunchStatus(result.error);
      } else {
        setComfyLaunchStatus('ComfyUI started.');
        setTimeout(() => {
          handleComfyConnect();
        }, 1500);
      }
    } catch (error) {
      setComfyLaunchStatus(error instanceof Error ? error.message : 'Failed to start ComfyUI.');
    } finally {
      setComfyIsStarting(false);
    }
  };

  const handleComfyStop = async () => {
    const comfyApi = (typeof window !== 'undefined' ? (window as any).electron?.comfyui : undefined) as
      | {
        stop: () => Promise<any>;
      }
      | undefined;
    if (!comfyApi) {
      setComfyLaunchStatus('Auto-start is available in the desktop app only.');
      return;
    }
    try {
      const result = await comfyApi.stop();
      if (result?.error) {
        setComfyLaunchStatus(result.error);
      } else {
        setComfyLaunchStatus('ComfyUI stopped.');
      }
    } catch (error) {
      setComfyLaunchStatus(error instanceof Error ? error.message : 'Failed to stop ComfyUI.');
    }
  };

  const handleComfyRefreshStatus = async () => {
    const comfyApi = (typeof window !== 'undefined' ? (window as any).electron?.comfyui : undefined) as
      | {
        status: () => Promise<any>;
      }
      | undefined;
    if (!comfyApi) return;
    try {
      const status = await comfyApi.status();
      if (status?.running) {
        setComfyLaunchStatus(`ComfyUI running (pid ${status.pid}).`);
      } else {
        setComfyLaunchStatus('ComfyUI not running.');
      }
    } catch {
      setComfyLaunchStatus('Unable to check ComfyUI status.');
    }
  };

  const handleComfyHealthCheck = async () => {
    const url = normalizeComfyUrl(comfyUrl);
    if (!url) {
      setComfyHealthStatus('Enter a ComfyUI server URL.');
      return;
    }
    setComfyIsCheckingHealth(true);
    setComfyHealthStatus('Running health check...');
    try {
      const stats = await getComfyUiHealth(url);
      setComfyHealth(stats);
      setComfyHealthStatus('Health check OK.');
    } catch (error) {
      setComfyHealth(null);
      setComfyHealthStatus(error instanceof Error ? error.message : 'Health check failed.');
    } finally {
      setComfyIsCheckingHealth(false);
    }
  };

  const handleComfyLoadLogs = async () => {
    const comfyApi = (typeof window !== 'undefined' ? (window as any).electron?.comfyui : undefined) as
      | {
        getLogs?: () => Promise<{ lines?: string[] }>;
      }
      | undefined;
    if (!comfyApi?.getLogs) {
      setComfyLogStatus('Log view is available in the desktop app only.');
      return;
    }
    setComfyIsLoadingLogs(true);
    setComfyLogStatus('Loading logs...');
    try {
      const result = await comfyApi.getLogs();
      setComfyLogLines(Array.isArray(result?.lines) ? result.lines : []);
      setComfyLogStatus('Logs loaded.');
    } catch (error) {
      setComfyLogStatus(error instanceof Error ? error.message : 'Failed to load logs.');
    } finally {
      setComfyIsLoadingLogs(false);
    }
  };

  const handleComfyClearLogs = async () => {
    const comfyApi = (typeof window !== 'undefined' ? (window as any).electron?.comfyui : undefined) as
      | {
        clearLogs?: () => Promise<{ ok?: boolean }>;
      }
      | undefined;
    if (!comfyApi?.clearLogs) {
      setComfyLogStatus('Log view is available in the desktop app only.');
      return;
    }
    try {
      const result = await comfyApi.clearLogs();
      if (result?.ok) {
        setComfyLogLines([]);
        setComfyLogStatus('Logs cleared.');
      } else {
        setComfyLogStatus('Failed to clear logs.');
      }
    } catch (error) {
      setComfyLogStatus(error instanceof Error ? error.message : 'Failed to clear logs.');
    }
  };

  const buildWorkflowOverrides = (
    workflow: Record<string, any>,
    options: {
      prompt: string;
      negativePrompt: string;
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
      initImage?: { name: string; subfolder?: string };
    },
    patchMap?: ComfyPatchMap
  ) => {
    type WorkflowNode = {
      class_type?: string;
      inputs: Record<string, any>;
    };

    const isWorkflowNode = (value: unknown): value is WorkflowNode => {
      if (!value || typeof value !== 'object') {
        return false;
      }
      const maybeNode = value as { inputs?: unknown };
      return !!maybeNode.inputs && typeof maybeNode.inputs === 'object';
    };

    const cloned = JSON.parse(JSON.stringify(workflow)) as Record<string, unknown>;
    const nodes = Object.entries(cloned).filter((entry): entry is [string, WorkflowNode] => isWorkflowNode(entry[1]));
    const byType = (type: string) => nodes.filter(([, node]) => node.class_type === type);
    const byId = (id?: string) => (id ? nodes.find(([nodeId]) => nodeId === id) : undefined);
    const shouldPatch = (nodeId: string, targetId?: string) => !targetId || nodeId === targetId;

    const [posNode, negNode] = byType('CLIPTextEncode');
    if (patchMap?.positiveNodeId) {
      const node = byId(patchMap.positiveNodeId);
      if (node) {
        node[1].inputs.text = options.prompt;
      } else if (posNode) {
        posNode[1].inputs.text = options.prompt;
      }
    } else if (posNode) {
      posNode[1].inputs.text = options.prompt;
    }

    if (patchMap?.negativeNodeId) {
      const node = byId(patchMap.negativeNodeId);
      if (node) {
        node[1].inputs.text = options.negativePrompt || '';
      } else if (negNode) {
        negNode[1].inputs.text = options.negativePrompt || '';
      }
    } else if (negNode) {
      negNode[1].inputs.text = options.negativePrompt || '';
    }

    byType('CheckpointLoaderSimple').forEach(([nodeId, node]) => {
      if (options.checkpoint && shouldPatch(nodeId, patchMap?.checkpointNodeId)) {
        node.inputs.ckpt_name = options.checkpoint;
      }
    });
    byType('VAELoader').forEach(([nodeId, node]) => {
      if (options.vae && shouldPatch(nodeId, patchMap?.vaeNodeId)) {
        node.inputs.vae_name = options.vae;
      }
    });
    byType('CLIPLoader').forEach(([nodeId, node]) => {
      if (options.clip && shouldPatch(nodeId, patchMap?.clipNodeId)) {
        node.inputs.clip_name = options.clip;
      }
    });
    const normalizedStack = (options.loraStack && options.loraStack.length > 0)
      ? options.loraStack
      : options.lora
        ? [{
          loraName: options.lora,
          adapterName: 'concept1',
          conceptText: 'subject',
          strengthModel: options.loraStrength,
          strengthClip: options.loraStrength,
        } satisfies ComfyLoraStackEntry]
        : [];
    const resolveLoraEntry = (index: number) => normalizedStack[index] || normalizedStack[0];
    byType('LoraLoader').forEach(([nodeId, node], index) => {
      if (!shouldPatch(nodeId, patchMap?.loraNodeId)) return;
      const entry = resolveLoraEntry(index);
      if (!entry) return;
      node.inputs.lora_name = entry.loraName;
      node.inputs.strength_model =
        typeof entry.strengthModel === 'number'
          ? entry.strengthModel
          : typeof options.loraStrength === 'number'
            ? options.loraStrength
            : node.inputs.strength_model;
      node.inputs.strength_clip =
        typeof entry.strengthClip === 'number'
          ? entry.strengthClip
          : typeof options.loraStrength === 'number'
            ? options.loraStrength
            : node.inputs.strength_clip;
    });
    byType('FreeFuseLoRALoader').forEach(([nodeId, node], index) => {
      if (!shouldPatch(nodeId, patchMap?.loraNodeId)) return;
      const entry = resolveLoraEntry(index);
      if (!entry) return;
      node.inputs.lora_name = entry.loraName;
      if (entry.adapterName) node.inputs.adapter_name = entry.adapterName;
      node.inputs.strength_model =
        typeof entry.strengthModel === 'number'
          ? entry.strengthModel
          : typeof options.loraStrength === 'number'
            ? options.loraStrength
            : node.inputs.strength_model;
      node.inputs.strength_clip =
        typeof entry.strengthClip === 'number'
          ? entry.strengthClip
          : typeof options.loraStrength === 'number'
            ? options.loraStrength
            : node.inputs.strength_clip;
    });
    byType('EmptyLatentImage').forEach(([nodeId, node]) => {
      if (shouldPatch(nodeId, patchMap?.latentNodeId)) {
        node.inputs.width = options.width;
        node.inputs.height = options.height;
      }
    });
    byType('KSampler').forEach(([nodeId, node]) => {
      if (shouldPatch(nodeId, patchMap?.samplerNodeId)) {
        node.inputs.steps = options.steps;
        node.inputs.cfg = options.cfg;
        node.inputs.sampler_name = options.sampler;
        node.inputs.scheduler = options.scheduler;
        node.inputs.seed = options.seed;
        node.inputs.denoise = options.denoise;
      }
    });
    if (options.initImage) {
      byType('LoadImage').forEach(([nodeId, node]) => {
        if (shouldPatch(nodeId, patchMap?.loadImageNodeId)) {
          node.inputs.image = options.initImage?.subfolder
            ? `${options.initImage.subfolder}/${options.initImage.name}`
            : options.initImage?.name;
        }
      });
    }

    return cloned;
  };

  const handleImportWorkflow = async (file: File | null) => {
    if (!file) return;
    try {
      const text = await file.text();
      JSON.parse(text);
      setComfyWorkflowJson(text);
      setComfyWorkflowMode('custom');
      setComfyWorkflowError(null);
    } catch (error) {
      setComfyWorkflowError(error instanceof Error ? error.message : 'Invalid workflow JSON.');
    }
  };

  const handleExportWorkflow = () => {
    const workflow = createComfyWorkflow({
      baseUrl: normalizeComfyUrl(comfyUrl),
      prompt: finalPrompt || 'Your prompt here',
      negativePrompt,
      ...resolveComfyDimensions(effectiveAspectRatio, imageSize),
      steps: comfySteps,
      cfg: comfyCfg,
      sampler: comfySampler,
      scheduler: comfyScheduler,
      seed: typeof comfySeed === 'number' ? comfySeed : 0,
      denoise: comfyDenoise,
      checkpoint: comfyCheckpoint,
      vae: comfyVae,
      clip: comfyClip,
      lora: comfyLora,
      loraStrength: comfyLoraScale,
      loraStack: comfyEffectiveLoraStack,
      freefuse: {
        enabled: comfyFreeFuseActive,
        backgroundText: comfyFreeFuseBackgroundText,
      },
    });
    const blob = new Blob([JSON.stringify(workflow, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'comfyui-workflow.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const saveComfyPreset = () => {
    const name = comfyPresetName.trim();
    if (!name) return;
    const preset: ComfyPreset = {
      id: selectedComfyPresetId || `preset-${Date.now()}`,
      name,
      settings: {
        url: comfyUrl,
        checkpoint: comfyCheckpoint,
        vae: comfyVae,
        clip: comfyClip,
        lora: comfyLora,
        loraScale: comfyLoraScale,
        loraStackText: comfyLoraStackText,
        useFreeFuse: comfyUseFreeFuse,
        freeFuseBackgroundText: comfyFreeFuseBackgroundText,
        steps: comfySteps,
        cfg: comfyCfg,
        sampler: comfySampler,
        scheduler: comfyScheduler,
        seed: typeof comfySeed === 'number' ? comfySeed : null,
        denoise: comfyDenoise,
        workflowMode: comfyWorkflowMode,
        workflowJson: comfyWorkflowJson,
        patchMap: comfyPatchMap,
        chainEnabled: comfyChainEnabled,
        chainSteps: comfyChainSteps,
      },
    };
    setComfyPresets((prev) => {
      const existingIndex = prev.findIndex((item) => item.id === preset.id);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = preset;
        return next;
      }
      return [...prev, preset];
    });
    setSelectedComfyPresetId(preset.id);
  };

  const updateComfyPatchMap = (key: keyof ComfyPatchMap, value: string) => {
    setComfyPatchMap((prev) => ({
      ...prev,
      [key]: value || undefined,
    }));
  };

  const addComfyChainStep = () => {
    setComfyChainSteps((prev) => [
      ...prev,
      {
        id: `chain-${Date.now()}-${Math.random().toString(16).slice(2)}`,
        name: `Step ${prev.length + 1}`,
        mode: 'custom',
        workflowJson: '',
        patchMap: {},
        useInitImage: true,
      },
    ]);
  };

  const applyComfyChainTemplate = (templateId: string) => {
    const template = COMFY_CHAIN_TEMPLATES.find((item) => item.id === templateId);
    if (!template) return;
    const steps = template.steps.map((step, index) => ({
      ...step,
      id: `chain-${Date.now()}-${index}-${Math.random().toString(16).slice(2)}`,
    }));
    setComfyChainEnabled(true);
    setComfyChainSteps(steps);
  };

  const updateComfyChainStep = (id: string, updates: Partial<ComfyChainStep>) => {
    setComfyChainSteps((prev) => prev.map((step) => (step.id === id ? { ...step, ...updates } : step)));
  };

  const updateComfyChainPatch = (id: string, key: keyof ComfyPatchMap, value: string) => {
    setComfyChainSteps((prev) =>
      prev.map((step) =>
        step.id === id
          ? { ...step, patchMap: { ...step.patchMap, [key]: value || undefined } }
          : step
      )
    );
  };

  const removeComfyChainStep = (id: string) => {
    setComfyChainSteps((prev) => prev.filter((step) => step.id !== id));
  };

  const applyComfyPreset = (presetId: string) => {
    const preset = comfyPresets.find((item) => item.id === presetId);
    if (!preset) return;
    setSelectedComfyPresetId(presetId);
    setComfyPresetName(preset.name);
    setComfyUrl(preset.settings.url);
    setComfyCheckpoint(preset.settings.checkpoint);
    setComfyVae(preset.settings.vae);
    setComfyClip(preset.settings.clip);
    setComfyLora(preset.settings.lora);
    setComfyLoraScale(preset.settings.loraScale);
    setComfyLoraStackText(preset.settings.loraStackText || '');
    setComfyUseFreeFuse(Boolean(preset.settings.useFreeFuse));
    setComfyFreeFuseBackgroundText(preset.settings.freeFuseBackgroundText || '');
    setComfySteps(preset.settings.steps);
    setComfyCfg(preset.settings.cfg);
    setComfySampler(preset.settings.sampler);
    setComfyScheduler(preset.settings.scheduler);
    setComfySeed(preset.settings.seed ?? '');
    setComfyDenoise(preset.settings.denoise);
    setComfyWorkflowMode(preset.settings.workflowMode);
    setComfyWorkflowJson(preset.settings.workflowJson);
    setComfyPatchMap(preset.settings.patchMap || {});
    setComfyChainEnabled(Boolean(preset.settings.chainEnabled));
    setComfyChainSteps(preset.settings.chainSteps || []);
  };

  const deleteComfyPreset = () => {
    if (!selectedComfyPresetId) return;
    setComfyPresets((prev) => prev.filter((item) => item.id !== selectedComfyPresetId));
    setSelectedComfyPresetId('');
    setComfyPresetName('');
  };

  const toggleFavorite = (group: keyof typeof comfyFavorites, value: string) => {
    if (!value) return;
    setComfyFavorites((prev) => {
      const list = prev[group] || [];
      const exists = list.includes(value);
      return {
        ...prev,
        [group]: exists ? list.filter((item) => item !== value) : [...list, value],
      };
    });
  };

  const handleRelight = async () => {
    if (!relightSourceUrl) {
      setRelightStatus('Select an image to relight.');
      return;
    }
    if (apiKeyReady === false) {
      setRelightStatus('Add API keys in Settings to relight images.');
      return;
    }
    setRelightIsRunning(true);
    setRelightStatus('Relighting image...');
    try {
      const relightPrompt = buildRelightPrompt(buildRelightSettings());
      const baseImage = await getBase64FromUrl(relightSourceUrl);
      const modelLabel = relightModel === 'gemini' ? 'Gemini 3 Pro' : 'Replicate Relight';
      const item = relightModel === 'gemini'
        ? await relightImageWithGemini3Pro(relightPrompt, baseImage, effectiveAspectRatio, imageSize)
        : await relightImageWithReplicate(relightPrompt, baseImage, { aspectRatio: effectiveAspectRatio });
      const itemWithMeta = { ...item, generatedBy: `Relight (${modelLabel})`, prompt: relightPrompt };
      onAddGeneratedMedia(itemWithMeta);
      setGenerated((prev) => [itemWithMeta, ...prev].slice(0, 12));
      setRelightStatus('Relight complete and added to your project.');
    } catch (error) {
      setRelightStatus(error instanceof Error ? error.message : 'Relight failed.');
    } finally {
      setRelightIsRunning(false);
    }
  };

  const normalizeCharacterTag = (name: string) => `@${name.replace(/\s+/g, '').toLowerCase()}`;

  const buildPromptWithCharacterTags = (input: string) => {
    const tags = new Set<string>();
    input.match(/@[\w-]+/g)?.forEach((tag) => tags.add(tag.toLowerCase()));
    const matched = characterReferences.filter((char) => tags.has(normalizeCharacterTag(char.name)));
    if (matched.length === 0) return { prompt: input, refs: [] as ContextReferenceImage[] };
    const refs = matched
      .filter((char) => char.imageUrl)
      .map((char) => ({ id: `char-${char.id}`, url: char.imageUrl!, file: undefined }));
    return { prompt: input, refs };
  };

  const handleStartLoraTraining = async () => {
    setTrainerIsRunning(true);
    setTrainerStatus('Starting LoRA training...');
    try {
      const training = await startFastFluxLoraTraining({
        destination: trainerDestination,
        inputImagesUrl: trainerInputImagesUrl,
        triggerWord: trainerTriggerWord,
        loraType: trainerType,
      });
      setTrainerId(training.id);
      setTrainerStatus(training.status ? `Training started: ${training.status}` : 'Training started.');
    } catch (error) {
      setTrainerStatus(error instanceof Error ? error.message : 'Failed to start LoRA training.');
    } finally {
      setTrainerIsRunning(false);
    }
  };

  const handleRefreshLoraTraining = async () => {
    if (!trainerId.trim()) {
      setTrainerStatus('Enter or create a training ID first.');
      return;
    }
    setTrainerIsRunning(true);
    setTrainerStatus('Refreshing training status...');
    try {
      const training = await getReplicateTraining(trainerId.trim());
      setTrainerStatus(
        training.status
          ? `Training ${training.id}: ${training.status}${training.error ? ` (${training.error})` : ''}`
          : `Training ${training.id}: status unavailable`
      );
    } catch (error) {
      setTrainerStatus(error instanceof Error ? error.message : 'Failed to refresh training status.');
    } finally {
      setTrainerIsRunning(false);
    }
  };

  const handleApplySmartRoute = (goalOverride?: string) => {
    const goalText = (goalOverride ?? smartRouterGoal).trim();
    if (!goalText) {
      setStatus('Add a routing goal first.');
      return;
    }
    const route = resolveSmartRoute(goalText);
    setSmartRouterGoal(goalText);
    setModelId(route.selected.id);
    if (route.selected.recommendedImageSize) {
      setImageSize(route.selected.recommendedImageSize);
    }
    setAppliedSmartRoute(route);
    setIsModelDropdownOpen(false);
    setStatus(`Smart router selected ${route.selected.label}. ${route.reason}`);
  };

  const handleGenerate = async () => {
    if (!finalPrompt.trim()) {
      setStatus('Add a prompt before generating.');
      return;
    }
    if (billingMode === 'hosted' && modelId !== 'comfyui' && onValidateHostedGeneration) {
      const pricing = IMAGE_MODEL_PRICING[modelId];
      if (pricing) {
        const validation = await onValidateHostedGeneration({
          provider: pricing.provider,
          kind: pricing.kind,
          model: pricing.model,
          units: generationCostEstimate?.units || 1,
          credits: generationCostEstimate?.credits,
        });
        if (!validation.ok) {
          setStatus(validation.message || 'Hosted generation blocked by billing guardrail.');
          return;
        }
      }
    }
    const jobId = `job-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setActiveJobs((prev) => [
      { id: jobId, status: 'queued', prompt: finalPrompt, modelLabel: MODEL_OPTIONS.find((o) => o.id === modelId)?.label },
      ...prev,
    ]);
    setStatus('Generating image...');
    try {
      setActiveJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: 'running' } : job)));
      const hasGeminiKey = Boolean(process.env.API_KEY || localStorage.getItem('gemini_api_key'));
      const hasReplicateKey = Boolean(localStorage.getItem('replicate_api_key'));
      const fallbackGeminiFlashToReplicate = modelId === 'gemini-flash' && !hasGeminiKey && hasReplicateKey;
      const fallbackGeminiProToReplicate = modelId === 'gemini-pro' && !hasGeminiKey && hasReplicateKey;
      const tagContext = buildPromptWithCharacterTags(finalPrompt);
      const mergedReferences = [...activeReferences, ...tagContext.refs].filter(
        (ref, index, arr) => arr.findIndex((other) => other.url === ref.url) === index
      );
      const mergedLimited = supportsReferences ? mergedReferences.slice(0, referenceLimit) : [];
      const referenceImages = supportsReferences && mergedLimited.length > 0
        ? await Promise.all(
          mergedLimited.map(async (item) => {
            if (item.file) {
              return {
                base64: await fileToBase64(item.file),
                mimeType: item.file.type || 'image/png',
              };
            }
            const payload = await getBase64FromUrl(item.url);
            return { base64: payload.base64, mimeType: payload.mimeType || 'image/png' };
          })
        )
        : [];
      const singleReference = referenceImages[0];
      const loraOptions = supportsLora && loraUrl.trim()
        ? { loraUrl: loraUrl.trim(), loraScale }
        : undefined;
      let item: MediaItem;
      const qwenMaxAspectRatio = (
        ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(effectiveAspectRatio)
          ? effectiveAspectRatio
          : '16:9'
      ) as '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      const fireRedAspectRatio = (
        ['16:9', '9:16', '1:1', '4:3', '3:4'].includes(effectiveAspectRatio)
          ? effectiveAspectRatio
          : '16:9'
      ) as '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      const falNanoAspectRatio = (
        ['21:9', '16:9', '9:16', '1:1', '4:3', '3:4'].includes(effectiveAspectRatio)
          ? effectiveAspectRatio
          : '16:9'
      ) as '21:9' | '16:9' | '9:16' | '1:1' | '4:3' | '3:4';
      switch (modelId) {
        case 'gemini-flash':
          if (fallbackGeminiFlashToReplicate) {
            setStatus('No Gemini key found. Using Nano Banana Pro via Replicate...');
            item = await generateImageWithGemini3ProReplicate(
              finalPrompt,
              effectiveAspectRatio,
              imageSize,
              referenceImages.length ? referenceImages : undefined
            );
          } else {
            item = referenceImages.length
              ? await generateImageWithReferences(finalPrompt, referenceImages, undefined, 'gemini-3.1-flash-image-preview', {
                aspectRatio: effectiveAspectRatio as any,
                imageSize,
              })
              : await generateImageWithNano(finalPrompt, {
                aspectRatio: effectiveAspectRatio as any,
                imageSize,
              });
          }
          break;
        case 'gemini-pro':
          if (fallbackGeminiProToReplicate) {
            setStatus('No Gemini key found. Using Nano Banana Pro via Replicate...');
            item = await generateImageWithGemini3ProReplicate(
              finalPrompt,
              effectiveAspectRatio,
              imageSize,
              referenceImages.length ? referenceImages : undefined
            );
          } else {
            item = referenceImages.length
              ? await generateImageWithReferences(finalPrompt, referenceImages, undefined, 'gemini-3-pro-image-preview', {
                aspectRatio: effectiveAspectRatio as any,
                imageSize,
              })
              : await generateImageWithGemini3Pro(finalPrompt, effectiveAspectRatio as any, imageSize);
          }
          break;
        case 'imagen':
          item = await generateImageWithImagen(finalPrompt, imagenAspectRatio as any);
          break;
        case 'grok-image':
          item = await generateImageWithGrok(finalPrompt);
          break;
        case 'gen4-turbo':
          item = await generateImageWithRunwayGen4Turbo(finalPrompt, effectiveAspectRatio as any);
          break;
        case 'flux-pro':
          item = await generateImageWithFlux(finalPrompt, effectiveAspectRatio as any, loraOptions);
          break;
        case 'flux-2-klein':
          item = await generateImageWithFluxKlein(finalPrompt, effectiveAspectRatio as any, singleReference, loraOptions);
          break;
        case 'flux-2-turbo':
          item = await generateImageWithFlux2Turbo(finalPrompt, effectiveAspectRatio as any, singleReference, loraOptions);
          break;
        case 'seedream':
          item = referenceImages.length
            ? await generateImageWithSeedreamReferences(
              finalPrompt,
              referenceImages,
              effectiveAspectRatio,
              imageSize === '4K' ? '4K' : '2K'
            )
            : await generateImageWithSeedream(finalPrompt, effectiveAspectRatio as any, imageSize === '4K' ? '4K' : '2K');
          break;
        case 'wan-v27-image-pro-replicate':
          item = await generateImageWithWan27ImagePro(finalPrompt, effectiveAspectRatio, imageSize, referenceImages.length ? referenceImages : undefined);
          break;
        case 'seedream-v5-lite-fal':
          item = await generateImageWithFalSeedreamV5Lite(finalPrompt, { aspectRatio: qwenMaxAspectRatio });
          break;
        case 'wan-v27-pro-fal':
          item = await generateImageWithFalWanV27Pro(finalPrompt, { aspectRatio: qwenMaxAspectRatio });
          break;
        case 'wan-v27-pro-edit-fal':
          if (referenceImages.length === 0) {
            throw new Error('WAN 2.7 Pro Edit (FAL) requires at least one reference image.');
          }
          {
            const edited = await editImageWithFalWanV27Pro(finalPrompt, referenceImages.slice(0, 4), {
              aspectRatio: qwenMaxAspectRatio,
              numOutputs: 1,
            });
            if (!edited.length) {
              throw new Error('WAN 2.7 Pro Edit (FAL) returned no images.');
            }
            item = edited[0];
          }
          break;
        case 'nano-banana-2-fal':
          item = await generateImageWithFalNanoBanana2(finalPrompt, {
            aspectRatio: falNanoAspectRatio,
            resolution: imageSize,
          });
          break;
        case 'nano-banana-2-fal-edit':
          if (referenceImages.length === 0) {
            throw new Error('Nano Banana 2 Edit (FAL) requires at least one reference image.');
          }
          {
            const edited = await editImageWithFalNanoBanana2(finalPrompt, referenceImages, {
              aspectRatio: falNanoAspectRatio,
              resolution: imageSize,
              numOutputs: 1,
            });
            if (!edited.length) {
              throw new Error('Nano Banana 2 Edit (FAL) returned no images.');
            }
            item = edited[0];
          }
          break;
        case 'firered':
          if (referenceImages.length === 0) {
            throw new Error('FireRed Edit requires at least one reference image or moodboard image.');
          }
          item = await editImageWithFireRed(finalPrompt, referenceImages, { aspectRatio: fireRedAspectRatio });
          break;
        case 'qwen':
          item = await generateImageWithQwenImage(finalPrompt, effectiveAspectRatio as any, singleReference);
          break;
        case 'qwen-max-fal-t2i':
          item = await generateImageWithFalQwenImageMax(finalPrompt, { aspectRatio: qwenMaxAspectRatio });
          break;
        case 'qwen-max-fal-edit':
          if (!singleReference) {
            throw new Error('Qwen Image Max Edit (FAL) requires one reference image.');
          }
          {
            const edited = await editImageWithFalQwenMultiAngle(finalPrompt, singleReference, { numOutputs: 1 });
            if (!edited.length) {
              throw new Error('Qwen Image Max Edit (FAL) returned no images.');
            }
            item = edited[0];
          }
          break;
        case 'gpt-image-2-fal':
          item = await generateImageWithFalGptImage2(finalPrompt, {
            aspectRatio: qwenMaxAspectRatio,
            numOutputs: 1,
            quality: 'high',
            outputFormat: 'png',
          });
          break;
        case 'gpt-image-2-fal-edit':
          if (referenceImages.length === 0) {
            throw new Error('GPT Image 2 Edit (FAL) requires at least one reference image.');
          }
          {
            const edited = await editImageWithFalGptImage2(finalPrompt, referenceImages, {
              aspectRatio: qwenMaxAspectRatio,
              numOutputs: 1,
              quality: 'high',
              outputFormat: 'png',
            });
            if (!edited.length) {
              throw new Error('GPT Image 2 Edit (FAL) returned no images.');
            }
            item = edited[0];
          }
          break;
        case 'gpt-image-1-5':
          item = await generateImageWithGptImage15(finalPrompt, effectiveAspectRatio as any, referenceImages);
          break;
        case 'z-image':
          item = await generateImageWithZImage(finalPrompt, effectiveAspectRatio as any, loraOptions);
          break;
        case 'z-turbo':
          item = await generateImageWithZTurbo(finalPrompt, effectiveAspectRatio as any, loraOptions);
          break;
        case 'z-turbo-img2img':
          if (!singleReference) {
            throw new Error('Z-Image Turbo Img2Img requires a reference image.');
          }
          item = await generateImageWithZTurboImg2Img(finalPrompt, effectiveAspectRatio as any, singleReference, loraOptions);
          break;
        case 'comfyui': {
          const baseUrl = normalizeComfyUrl(comfyUrl);
          if (!baseUrl) {
            throw new Error('Add a ComfyUI server URL before generating.');
          }
          if (!comfyCheckpoint) {
            throw new Error('Select a ComfyUI checkpoint before generating.');
          }
          const { width, height } = resolveComfyDimensions(effectiveAspectRatio, imageSize);
          let initImage;
          if (mergedLimited[0]) {
            const reference = mergedLimited[0];
            const blob = reference.file
              ? reference.file
              : await fetch(reference.url).then((response) => response.blob());
            const uploaded = await uploadComfyImage(baseUrl, blob, `ref-${Date.now()}.png`);
            initImage = {
              name: uploaded?.name || uploaded?.filename || uploaded?.path || 'input.png',
              subfolder: uploaded?.subfolder || uploaded?.folder,
              type: uploaded?.type,
            };
          }
          const seedValue =
            typeof comfySeed === 'number'
              ? comfySeed
              : Math.floor(Math.random() * 1000000000);
          const workflowOptions = {
            baseUrl,
            prompt: finalPrompt,
            negativePrompt,
            width,
            height,
            steps: comfySteps,
            cfg: comfyCfg,
            sampler: comfySampler,
            scheduler: comfyScheduler,
            seed: seedValue,
            denoise: initImage ? comfyDenoise : 1,
            checkpoint: comfyCheckpoint,
            vae: comfyVae,
            clip: comfyClip,
            lora: comfyLora,
            loraStrength: comfyLoraScale,
            loraStack: comfyEffectiveLoraStack,
            freefuse: {
              enabled: comfyFreeFuseActive,
              backgroundText: comfyFreeFuseBackgroundText,
            },
            initImage,
          };
          let workflowOverride: Record<string, any> | undefined;
          if (comfyWorkflowMode === 'custom') {
            if (!comfyWorkflowJson.trim()) {
              throw new Error('Import a ComfyUI workflow JSON for custom mode.');
            }
            try {
              const parsed = JSON.parse(comfyWorkflowJson);
              workflowOverride = buildWorkflowOverrides(parsed, {
                prompt: finalPrompt,
                negativePrompt,
                width,
                height,
                steps: comfySteps,
                cfg: comfyCfg,
                sampler: comfySampler,
                scheduler: comfyScheduler,
                seed: seedValue,
                denoise: initImage ? comfyDenoise : 1,
                checkpoint: comfyCheckpoint,
                vae: comfyVae,
                clip: comfyClip,
                lora: comfyLora,
                loraStrength: comfyLoraScale,
                loraStack: comfyEffectiveLoraStack,
                initImage,
              }, comfyPatchMap);
            } catch (error) {
              throw new Error('Custom workflow JSON is invalid.');
            }
          }
          let currentItem = await generateComfyImage(workflowOptions, workflowOverride);
          if (comfyChainEnabled && comfyChainSteps.length > 0) {
            for (const step of comfyChainSteps) {
              let stepInit;
              if (step.useInitImage) {
                const blob = await fetch(currentItem.url).then((response) => response.blob());
                const uploaded = await uploadComfyImage(baseUrl, blob, `chain-${Date.now()}.png`);
                stepInit = {
                  name: uploaded?.name || uploaded?.filename || uploaded?.path || 'input.png',
                  subfolder: uploaded?.subfolder || uploaded?.folder,
                  type: uploaded?.type,
                };
              }
              const stepOptions = {
                ...workflowOptions,
                seed: seedValue,
                initImage: stepInit,
                denoise: stepInit ? comfyDenoise : 1,
              };
              let stepOverride: Record<string, any> | undefined;
              if (step.mode === 'custom') {
                if (!step.workflowJson.trim()) {
                  throw new Error(`Chain step "${step.name}" is missing workflow JSON.`);
                }
                const parsed = JSON.parse(step.workflowJson);
                stepOverride = buildWorkflowOverrides(parsed, {
                  prompt: finalPrompt,
                  negativePrompt,
                  width,
                  height,
                  steps: comfySteps,
                  cfg: comfyCfg,
                  sampler: comfySampler,
                  scheduler: comfyScheduler,
                  seed: seedValue,
                  denoise: stepInit ? comfyDenoise : 1,
                  checkpoint: comfyCheckpoint,
                  vae: comfyVae,
                  clip: comfyClip,
                  lora: comfyLora,
                  loraStrength: comfyLoraScale,
                  loraStack: comfyEffectiveLoraStack,
                  initImage: stepInit,
                }, step.patchMap);
              }
              currentItem = await generateComfyImage(stepOptions, stepOverride);
            }
          }
          item = currentItem;
          break;
        }
        default:
          throw new Error('Unsupported model selection.');
      }
      const modelLabel = MODEL_OPTIONS.find((option) => option.id === modelId)?.label;
      const itemWithMeta = { ...item, generatedBy: modelLabel, prompt: finalPrompt };
      onAddGeneratedMedia(itemWithMeta);
      setGenerated((prev) => [itemWithMeta, ...prev].slice(0, 12));
      setGenerationHistory((prev) => [
        {
          id: itemWithMeta.id,
          createdAt: new Date().toISOString(),
          url: itemWithMeta.url,
          prompt: finalPrompt,
          negativePrompt,
          modelId,
          modelLabel,
          aspectRatio: effectiveAspectRatio as AspectRatioOption,
          imageSize,
          selectedStyleId,
          selectedShotTypeId,
          selectedLightingId,
          cameraPresetId,
          lensPresetId,
          customStyle,
          references: mergedLimited.map((ref) => ({ url: ref.url, name: ref.id })),
        },
        ...prev,
      ].slice(0, 20));
      const aspectNote =
        modelId === 'imagen' && imagenAspectRatio !== effectiveAspectRatio
          ? ' Imagen uses 16:9 for custom ratios.'
          : modelId === 'grok-image'
            ? ' Grok Image uses a fixed 1024x768 (4:3) output.'
            : modelId === 'firered' && fireRedAspectRatio !== effectiveAspectRatio
              ? ' FireRed uses 16:9 for unsupported ratios.'
            : '';
      const referenceSourceLabel = contextReferences.length > 0 ? 'Context references' : hasMoodboard ? 'Moodboard references' : '';
      const referenceNote = referenceSourceLabel && !supportsReferences
        ? ` ${referenceSourceLabel} were ignored by this model.`
        : '';
      const referenceLimitNote = referenceOverflow
        ? ` Only the first ${referenceLimit} reference images were used.`
        : '';
      setStatus(`Image generated and added to your project.${aspectNote}${referenceNote}${referenceLimitNote}`);
      setActiveJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: 'done' } : job)));
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Image generation failed.');
      setActiveJobs((prev) => prev.map((job) => (job.id === jobId ? { ...job, status: 'error' } : job)));
    }
  };

  const handleReuse = (entry: GenerationHistoryEntry) => {
    setPrompt(entry.prompt);
    setNegativePrompt(entry.negativePrompt || '');
    setModelId(entry.modelId);
    setSelectedStyleId(entry.selectedStyleId);
    setSelectedShotTypeId(entry.selectedShotTypeId);
    setSelectedLightingId(entry.selectedLightingId);
    setAspectRatio(entry.aspectRatio);
    setImageSize(entry.imageSize);
    setCameraPresetId(entry.cameraPresetId);
    setLensPresetId(entry.lensPresetId);
    setCustomStyle(entry.customStyle);
    if (entry.references.length > 0) {
      setContextReferences(
        entry.references.map((ref, idx) => ({
          id: `${entry.id}-ref-${idx}`,
          url: ref.url,
          file: undefined,
        }))
      );
    } else {
      setContextReferences([]);
    }
    setActiveTab('generate');
    setStatus('Loaded previous generation settings.');
  };

  const handleReusePrompt = (promptText: string) => {
    if (!promptText.trim()) return;
    setPrompt(promptText);
    setActiveTab('generate');
    setStatus('Loaded prompt into the generator.');
  };

  const handleClearCompletedJobs = () => {
    setActiveJobs((prev) => prev.filter((job) => job.status === 'running' || job.status === 'queued'));
  };

  const handleDirectorGenerate = async () => {
    if (!directorScript.trim()) {
      setDirectorStatus('Please enter a script or scene description.');
      return;
    }
    if (!hasGeminiKey()) {
      setDirectorStatus('Gemini API key required for Director Mode.');
      return;
    }
    setIsDirecting(true);
    setDirectorStatus('Director AI is analyzing script and planning shots...');
    try {
      const treatment = await generateViMaxStoryboard(directorScript);
      setDirectorTreatment(treatment);
      setDirectorStatus('Director analysis complete.');
    } catch (error) {
      setDirectorStatus(error instanceof Error ? error.message : 'Director analysis failed.');
    } finally {
      setIsDirecting(false);
    }
  };

  const handleApplyDirectorShot = (shot: DirectorShot) => {
    setPrompt(shot.prompt);

    // Try to match preset IDs. If exact match fails, we stick to the AI's suggestion or leave it
    // ideally the AI returns valid IDs from the authorized list.
    if (shot.shotTypePresetId) setSelectedShotTypeId(shot.shotTypePresetId);
    if (shot.lightingPresetId) setSelectedLightingId(shot.lightingPresetId);

    // Switch to generate tab
    setActiveTab('generate');
    setStatus(`Applied Director's settings for Shot #${shot.shotNumber}`);
  };

  const historyByUrl = useMemo(() => {
    const map = new Map<string, GenerationHistoryEntry>();
    generationHistory.forEach((entry) => {
      if (!map.has(entry.url)) {
        map.set(entry.url, entry);
      }
    });
    return map;
  }, [generationHistory]);

  const comfyWorkflowNodes = useMemo(() => parseComfyWorkflowNodes(comfyWorkflowJson), [comfyWorkflowJson]);

  const latestResults = useMemo(() => {
    const projectImages = mediaItems.filter((item) => item.type === 'image');
    const combined = [...generated, ...projectImages];
    const seen = new Set<string>();
    const unique: MediaItem[] = [];
    for (const item of combined) {
      if (seen.has(item.url)) continue;
      seen.add(item.url);
      unique.push(item);
    }
    return unique.slice(0, 12);
  }, [generated, mediaItems]);

  const filteredLibraryAssets = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    return libraryAssets.filter((asset) => {
      if (
        term &&
        !asset.name.toLowerCase().includes(term) &&
        !asset.projectName.toLowerCase().includes(term) &&
        !(asset.prompt || '').toLowerCase().includes(term)
      ) {
        return false;
      }
      return true;
    });
  }, [libraryAssets, librarySearch]);

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          <button
            className={`app-button ${activeTab === 'generate' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveTab('generate')}
          >
            Generate
          </button>
          <button
            className={`app-button ${activeTab === 'moodboard' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveTab('moodboard')}
          >
            Moodboard
          </button>
          <button
            className={`app-button ${activeTab === 'relight' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveTab('relight')}
          >
            Relight
          </button>
          <button
            className={`app-button ${activeTab === 'photoreal' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveTab('photoreal')}
          >
            Photoreal Check
          </button>
          <button
            className={`app-button ${activeTab === 'director' ? 'workspace-tab--active' : ''}`}
            onClick={() => setActiveTab('director')}
          >
            Director Mode 🎬
          </button>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          {activeTab === 'director' ? (
            <div className="md:col-span-2 app-panel p-6 space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-2xl font-bold">Director Mode (ViMax)</h2>
                  <p className="text-gray-400">AI Director Agent analyzes your script and creates a shot list.</p>
                </div>
                <div className="text-4xl">🎬</div>
              </div>

              <div className="space-y-2">
                <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Script / Scene Description</label>
                <textarea
                  className="app-input min-h-[150px] font-mono text-sm leading-relaxed"
                  placeholder="INT. CYBERPUNK BAR - NIGHT\nThe neon lights flicker as Kael walks in..."
                  value={directorScript}
                  onChange={(e) => setDirectorScript(e.target.value)}
                />
                <button
                  className={`app-button w-full py-4 text-center font-bold text-lg ${isDirecting ? 'opacity-50 cursor-wait' : ''}`}
                  onClick={handleDirectorGenerate}
                  disabled={isDirecting}
                >
                  {isDirecting ? 'Directing Scene...' : 'Auto-Direct Scene ✨'}
                </button>
                {directorStatus && <p className="text-xs text-indigo-300 text-center">{directorStatus}</p>}
              </div>

              {directorTreatment && (
                <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
                  {/* Analysis Card */}
                  <div className="bg-indigo-950/50 border border-indigo-800/50 rounded-lg p-5">
                    <h3 className="text-sm font-bold text-indigo-300 uppercase tracking-wider mb-4 border-b border-indigo-800/50 pb-2">Director's Analysis</h3>
                    <div className="grid md:grid-cols-3 gap-6">
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase">Mood</div>
                        <div className="font-medium text-indigo-100">{directorTreatment.analysis.mood}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase">Visual Theme</div>
                        <div className="font-medium text-indigo-100">{directorTreatment.analysis.visualTheme}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-gray-500 uppercase">Pacing</div>
                        <div className="font-medium text-indigo-100">{directorTreatment.analysis.pacing}</div>
                      </div>
                    </div>
                  </div>

                  {/* Shot List */}
                  <div className="space-y-4">
                    <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider">Shot List ({directorTreatment.shots.length})</h3>
                    <div className="grid gap-4">
                      {directorTreatment.shots.map((shot, idx) => (
                        <div key={idx} className="bg-gray-900/50 border border-gray-800 hover:border-indigo-500/50 transition-colors rounded-lg p-4 flex gap-4 items-start group">
                          <div className="flex-shrink-0 w-8 h-8 rounded-full bg-indigo-900/50 flex items-center justify-center text-xs font-bold text-indigo-300">
                            {shot.shotNumber}
                          </div>
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-gray-200">{shot.description}</span>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <span className="px-2 py-1 rounded bg-gray-800 text-[10px] text-gray-300 border border-gray-700">
                                📷 {shot.cameraAngle} ({shot.shotTypePresetId})
                              </span>
                              <span className="px-2 py-1 rounded bg-gray-800 text-[10px] text-gray-300 border border-gray-700">
                                💡 {shot.lightingPresetId}
                              </span>
                            </div>
                            <p className="text-xs text-gray-500 italic border-l-2 border-indigo-500/30 pl-2">
                              "{shot.rationale}"
                            </p>
                          </div>
                          <button
                            className="opacity-0 group-hover:opacity-100 transition-opacity bg-indigo-600 hover:bg-indigo-500 text-white px-4 py-2 rounded text-xs font-bold whitespace-nowrap"
                            onClick={() => handleApplyDirectorShot(shot)}
                          >
                            Apply to Generator &rarr;
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div className="contents">
              <section className="app-panel p-6 space-y-5">
                {activeTab === 'generate' ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold">Create Images</h2>
                        <p className="text-gray-400">Describe the shot, optionally add a reference, then create a new image.</p>
                      </div>
                      <SparklesIcon className="w-8 h-8 text-indigo-300" />
                    </div>

                    <div className="rounded-2xl border border-gray-700/80 bg-gray-950/50 p-4">
                      <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.2em] text-gray-400">
                        <span>Quick Flow</span>
                        <span className="text-gray-600">1. Describe</span>
                        <span className="text-gray-600">2. Add references</span>
                        <span className="text-gray-600">3. Create</span>
                      </div>
                      <p className="mt-2 text-sm text-gray-300">
                        {isBeginnerMode
                          ? 'Fastest setup: write what you want, keep the suggested engine, and press Create Image.'
                          : 'Start simple. Use the advanced section only when you need tighter control over look, framing, or references.'}
                      </p>
                    </div>

                    {apiKeyReady === false && !isComfyUi && (
                      <div className="app-panel p-3 text-sm text-amber-200 border border-amber-400/40 bg-amber-400/10">
                        Add your API keys in Settings before creating images.
                      </div>
                    )}

                    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.9fr)]">
                      <div className="app-card p-5 space-y-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.12em] text-gray-500">Main Idea</div>
                          <p className="mt-1 text-sm text-gray-400">
                            Start with the image itself. The controls below should help the first result look right without extra setup.
                          </p>
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-[0.12em] text-gray-500">What Should The Image Show?</label>
                          <textarea
                            value={prompt}
                            onChange={(event) => setPrompt(event.target.value)}
                            placeholder="Describe the scene, subject, mood, and setting..."
                            className="app-textarea mt-2 h-32"
                          />
                        </div>
                        <div>
                          <label className="text-xs uppercase tracking-[0.12em] text-gray-500">What Should It Avoid?</label>
                          <textarea
                            value={negativePrompt}
                            onChange={(event) => setNegativePrompt(event.target.value)}
                            placeholder="Optional: unwanted styles, artifacts, or details to avoid..."
                            className="app-textarea mt-2 h-20"
                          />
                        </div>
                      </div>

                      <div className="app-card p-5 space-y-4">
                        <div>
                          <div className="text-xs uppercase tracking-[0.12em] text-gray-500">Quick Setup</div>
                          <p className="mt-1 text-sm text-gray-400">
                            Choose the engine and output format. Fine-tuning lives below in the advanced section.
                          </p>
                        </div>
                        <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/8 p-3 space-y-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="text-xs uppercase tracking-[0.12em] text-indigo-200">Smart Model Router</div>
                            {smartRoutePreview && (
                              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-0.5 text-[10px] uppercase tracking-[0.12em] text-gray-300">
                                {smartRoutePreview.intent}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-col gap-2 sm:flex-row">
                            <input
                              value={smartRouterGoal}
                              onChange={(event) => {
                                setSmartRouterGoal(event.target.value);
                                setAppliedSmartRoute(null);
                              }}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault();
                                  handleApplySmartRoute();
                                }
                              }}
                              placeholder="Goal: realistischer Produktshot, schnelle Vorschau, billige Variation..."
                              className="app-input flex-1"
                            />
                            <button
                              type="button"
                              className="app-button app-secondary whitespace-nowrap"
                              onClick={() => handleApplySmartRoute()}
                            >
                              Apply Route
                            </button>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            {SMART_ROUTER_GOAL_PRESETS.map((goal) => (
                              <button
                                key={goal}
                                type="button"
                                className="rounded-full border border-white/10 bg-black/20 px-2.5 py-1 text-[11px] text-gray-300 transition-colors hover:border-indigo-400/50 hover:text-white"
                                onClick={() => handleApplySmartRoute(goal)}
                              >
                                {goal}
                              </button>
                            ))}
                          </div>
                          {smartRoutePreview && (
                            <div className="rounded-lg border border-white/8 bg-black/15 p-3 text-xs text-gray-300">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="font-semibold text-gray-100">{smartRoutePreview.selected.label}</span>
                                <span className="text-gray-400">{smartRoutePreview.selected.provider}</span>
                              </div>
                              <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-gray-400">
                                <span>Quality {smartRoutePreview.selected.quality.toFixed(1)}</span>
                                <span>Speed {smartRoutePreview.selected.speed.toFixed(1)}</span>
                                <span>Cost {smartRoutePreview.selected.costEfficiency.toFixed(1)}</span>
                                {formatSmartModelEta(smartRoutePreview.selected.eta) && (
                                  <span>ETA {formatSmartModelEta(smartRoutePreview.selected.eta)}</span>
                                )}
                                {smartRoutePreview.selected.recommendedImageSize && (
                                  <span>{smartRoutePreview.selected.recommendedImageSize}</span>
                                )}
                              </div>
                            </div>
                          )}
                          {appliedSmartRoute && (
                            <div className="text-[11px] text-indigo-200">
                              Active route: {appliedSmartRoute.selected.label}
                            </div>
                          )}
                        </div>
                        <div ref={modelDropdownRef} className="relative z-10 w-full">
                        <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Creative Engine</label>
                        <div
                          className="app-input mt-1 cursor-pointer flex items-center justify-between hover:border-indigo-500/50"
                          onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                        >
                          <div className="flex items-center gap-3">
                            {MODEL_OPTIONS.find(o => o.id === modelId)?.icon ? (
                              <img src={MODEL_OPTIONS.find(o => o.id === modelId)?.icon} className="w-5 h-5 rounded object-contain bg-black/40" alt="" />
                            ) : (
                              <div className="w-5 h-5 rounded bg-gray-800 flex items-center justify-center border border-gray-700">
                                <span className="text-[10px] uppercase font-bold text-gray-400">{MODEL_OPTIONS.find(o => o.id === modelId)?.provider[0]}</span>
                              </div>
                            )}
                            <span className="text-gray-200 text-sm font-medium">{MODEL_OPTIONS.find(o => o.id === modelId)?.label}</span>
                          </div>
                          <span className="text-gray-500 text-xs text-opacity-70">▼</span>
                        </div>
                        {isModelDropdownOpen && (
                          <div className="absolute top-full left-0 right-0 mt-2 max-h-[400px] overflow-y-auto app-menu border border-indigo-500/20 rounded-2xl shadow-2xl">
                            {MODEL_OPTIONS.map((option) => (
                              <div
                                key={option.id}
                                className={`p-3 cursor-pointer hover:bg-indigo-500/8 border-b border-white/5 last:border-0 flex items-start gap-3 transition-colors ${modelId === option.id ? 'bg-indigo-500/10' : ''}`}
                                onClick={() => { setModelId(option.id); setAppliedSmartRoute(null); setIsModelDropdownOpen(false); }}
                              >
                                {option.icon ? (
                                  <img src={option.icon} className="w-10 h-10 rounded-lg mt-0.5 object-cover bg-black/40 shadow-sm border border-gray-800" alt="" />
                                ) : (
                                  <div className="w-10 h-10 rounded-lg mt-0.5 bg-gray-800 flex items-center justify-center flex-shrink-0 shadow-sm border border-gray-700">
                                    <span className="text-xs text-gray-400 font-bold uppercase">{option.provider[0]}</span>
                                  </div>
                                )}
                                <div className="flex flex-col flex-1">
                                  <div className="flex items-center justify-between gap-2">
                                    <span className={`text-sm font-medium ${modelId === option.id ? 'text-indigo-200' : 'text-gray-200'}`}>{option.label}</span>
                                    {isProMode && (
                                      <span className="text-[9px] uppercase tracking-wider text-gray-400 px-1.5 py-0.5 bg-black/20 rounded-full border border-white/10">{option.provider}</span>
                                    )}
                                  </div>
                                  {option.goodFor && (
                                    <span className="text-xs text-gray-400 mt-1 leading-snug break-words pr-2">{option.goodFor}</span>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                        </div>
                        <div className="grid gap-4 md:grid-cols-2">
                          <div>
                        <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Format</label>
                        <select
                          value={aspectRatio}
                          onChange={(event) => setAspectRatio(event.target.value as (typeof ASPECT_RATIOS)[number])}
                          className="app-select mt-1"
                          disabled={!supportsAspect}
                        >
                          {availableAspectRatios.map((ratio) => (
                            <option key={ratio} value={ratio}>
                              {ratio}
                            </option>
                          ))}
                        </select>
                        {!supportsAspect && <p className="text-[11px] text-gray-500 mt-1">Uses default ratio for this model.</p>}
                        {lensPreset?.aspectRatioOverride && (
                          <p className="text-[11px] text-amber-300 mt-1">
                            Framing override: {lensPreset.aspectRatioOverride}
                          </p>
                        )}
                        {modelId === 'imagen' && imagenAspectRatio !== effectiveAspectRatio && (
                          <p className="text-[11px] text-gray-500 mt-1">Imagen supports standard ratios only.</p>
                        )}
                          </div>
                          <div>
                        <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Output Size</label>
                        <select
                          value={imageSize}
                          onChange={(event) => setImageSize(event.target.value as (typeof IMAGE_SIZES)[number])}
                          className="app-select mt-1"
                          disabled={!supportsSize}
                        >
                          {IMAGE_SIZES.map((size) => (
                            <option key={size} value={size}>
                              {size}
                            </option>
                          ))}
                        </select>
                        {!supportsSize && <p className="text-[11px] text-gray-500 mt-1">Size control is limited for this model.</p>}
                          </div>
                        </div>
                        <div>
                        <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Extra Look Notes</label>
                        <input
                          value={customStyle}
                          onChange={(event) => setCustomStyle(event.target.value)}
                          placeholder="Optional look or mood notes..."
                          className="app-input mt-1"
                        />
                        </div>
                        {generationCostEstimate && (
                          <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2 text-sm text-gray-300">
                            {billingMode === 'byok'
                              ? `Estimated provider cost: ${formatUsd(generationCostEstimate.providerUsd)}`
                              : `Estimated cost: ${generationCostEstimate.credits} credits`}
                            {currentModelEta ? ` · ETA ${currentModelEta}` : ''}
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="sticky bottom-0 z-10 -mx-6 border-t border-white/6 bg-[rgb(var(--app-bg-rgb)/0.92)] px-6 py-4 backdrop-blur-xl">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        onClick={handleGenerate}
                        disabled={!readyForGeneration}
                        className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {activeJobs.length > 0 ? `Create Image (${activeJobs.length} running)` : 'Create Image'}
                      </button>
                      <div className="flex items-center gap-3 text-xs text-gray-400">
                        {modelId === 'comfyui' ? (
                          <span>Local ComfyUI — no cost</span>
                        ) : generationCostEstimate ? (
                          <span>
                            {billingMode === 'byok'
                              ? `~${formatUsd(generationCostEstimate.providerUsd)}`
                              : `${generationCostEstimate.credits} credits`}
                          </span>
                        ) : null}
                        {currentModelEta && <span>ETA {currentModelEta}</span>}
                        {billingMode === 'byok' && <span className="px-1.5 py-0.5 rounded bg-sky-500/10 border border-sky-500/30 text-sky-300 text-[10px]">BYOK</span>}
                      </div>
                      {finalPrompt && (
                        <p className="text-[10px] text-gray-500 w-full mt-1 truncate">
                          Final: {finalPrompt.slice(0, 200)}{finalPrompt.length > 200 ? '...' : ''}
                        </p>
                      )}
                      </div>
                    </div>

                    {status && (
                      <div className="rounded-xl border border-white/8 bg-black/10 px-4 py-3 text-sm text-gray-300">
                        {status}
                      </div>
                    )}

                    {/* ─── Advanced Visual Settings (collapsible) ─── */}
                    <details className="group">
                      <summary className="cursor-pointer flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-gray-400 hover:text-gray-200 transition-colors select-none py-2">
                        <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
                        Creative Direction & Advanced Options
                        <span className="text-[10px] text-gray-600 normal-case tracking-normal">
                          (Look, framing, references, extras)
                        </span>
                      </summary>
                      <div className="mt-3 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">

                        <div className="app-panel p-4 space-y-4">
                          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Framing & Camera Feel</div>
                          <LensSelection
                            cameraPresetId={cameraPresetId}
                            setCameraPresetId={setCameraPresetId}
                            lensPresetId={lensPresetId}
                            setLensPresetId={setLensPresetId}
                          />
                          <div className="grid gap-4 md:grid-cols-2">
                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Camera Feel</label>
                              <input
                                value={customCameraNote}
                                onChange={(event) => setCustomCameraNote(event.target.value)}
                                placeholder="e.g. handheld, clean studio, documentary"
                                className="app-input mt-1"
                              />
                            </div>
                            <div>
                              <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Focus & Lens Feel</label>
                              <input
                                value={customLensNote}
                                onChange={(event) => setCustomLensNote(event.target.value)}
                                placeholder="e.g. shallow depth of field, compressed portrait look"
                                className="app-input mt-1"
                              />
                            </div>
                          </div>
                        </div>

                        {supportsLora && (
                          <div className="app-panel p-4 space-y-3">
                            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Custom LoRA (Flux / Z-Image)</div>
                            <input
                              value={loraUrl}
                              onChange={(event) => setLoraUrl(event.target.value)}
                              placeholder="LoRA URL (public)"
                              className="app-input"
                            />
                            <div className="flex items-center gap-3 text-[11px] text-gray-400">
                              <span>Strength</span>
                              <input
                                type="range"
                                min={0}
                                max={1}
                                step={0.05}
                                value={loraScale}
                                onChange={(event) => setLoraScale(Number(event.target.value))}
                                className="flex-1"
                              />
                              <span className="text-gray-300">{loraScale.toFixed(2)}</span>
                            </div>
                            <div className="text-[11px] text-gray-500">
                              LoRA support depends on the model inputs on Replicate.
                            </div>
                            <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-2">
                              <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">LoRA Trainer (Replicate Fast Flux)</div>
                              <input
                                value={trainerDestination}
                                onChange={(event) => setTrainerDestination(event.target.value)}
                                placeholder="Destination (e.g. yourname/my-new-lora)"
                                className="app-input"
                              />
                              <input
                                value={trainerInputImagesUrl}
                                onChange={(event) => setTrainerInputImagesUrl(event.target.value)}
                                placeholder="ZIP URL with training images"
                                className="app-input"
                              />
                              <div className="grid gap-2 md:grid-cols-3">
                                <input
                                  value={trainerTriggerWord}
                                  onChange={(event) => setTrainerTriggerWord(event.target.value)}
                                  placeholder="Trigger word"
                                  className="app-input"
                                />
                                <select
                                  value={trainerType}
                                  onChange={(event) => setTrainerType(event.target.value as 'subject' | 'style')}
                                  className="app-select"
                                >
                                  <option value="subject">Subject</option>
                                  <option value="style">Style</option>
                                </select>
                                <input
                                  value={trainerId}
                                  onChange={(event) => setTrainerId(event.target.value)}
                                  placeholder="Training ID"
                                  className="app-input"
                                />
                              </div>
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  className="app-button app-secondary text-xs"
                                  onClick={handleStartLoraTraining}
                                  disabled={trainerIsRunning}
                                >
                                  {trainerIsRunning ? 'Working...' : 'Start Training'}
                                </button>
                                <button
                                  type="button"
                                  className="app-button app-secondary text-xs"
                                  onClick={handleRefreshLoraTraining}
                                  disabled={trainerIsRunning}
                                >
                                  Refresh Status
                                </button>
                              </div>
                              {trainerStatus && <div className="text-[11px] text-gray-400">{trainerStatus}</div>}
                            </div>
                          </div>
                        )}
                        {isComfyUi && (
                          <div className="app-panel p-4 space-y-4">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">ComfyUI Local</div>
                                <div className="text-[11px] text-gray-500 mt-1">
                                  Put models into ComfyUI <span className="text-gray-300">models/checkpoints</span>, <span className="text-gray-300">models/loras</span>, <span className="text-gray-300">models/vae</span>, <span className="text-gray-300">models/clip</span> and refresh.
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={handleComfyConnect}
                                className="app-button app-secondary text-xs"
                                disabled={comfyIsLoading}
                              >
                                {comfyIsLoading ? 'Loading...' : 'Test & Load'}
                              </button>
                            </div>
                            <input
                              value={comfyUrl}
                              onChange={(event) => setComfyUrl(event.target.value)}
                              placeholder="http://127.0.0.1:8188"
                              className="app-input"
                            />
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Checkpoint</label>
                                <select
                                  value={comfyCheckpoint}
                                  onChange={(event) => setComfyCheckpoint(event.target.value)}
                                  className="app-select mt-1"
                                >
                                  {comfyModels.checkpoints.length === 0 && <option value="">No checkpoints found</option>}
                                  {sortWithFavorites(comfyModels.checkpoints, comfyFavorites.checkpoints).map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="text-[10px] text-gray-400 hover:text-white mt-2"
                                  onClick={() => toggleFavorite('checkpoints', comfyCheckpoint)}
                                  disabled={!comfyCheckpoint}
                                >
                                  {comfyFavorites.checkpoints.includes(comfyCheckpoint) ? '★ Favorited' : '☆ Favorite'}
                                </button>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">VAE (optional)</label>
                                <select
                                  value={comfyVae}
                                  onChange={(event) => setComfyVae(event.target.value)}
                                  className="app-select mt-1"
                                >
                                  <option value="">Use checkpoint VAE</option>
                                  {sortWithFavorites(comfyModels.vae, comfyFavorites.vae).map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="text-[10px] text-gray-400 hover:text-white mt-2"
                                  onClick={() => toggleFavorite('vae', comfyVae)}
                                  disabled={!comfyVae}
                                >
                                  {comfyFavorites.vae.includes(comfyVae) ? '★ Favorited' : '☆ Favorite'}
                                </button>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Text Encoder (optional)</label>
                                <select
                                  value={comfyClip}
                                  onChange={(event) => setComfyClip(event.target.value)}
                                  className="app-select mt-1"
                                  disabled={comfyHasAnyLoraSelection}
                                >
                                  <option value="">Use checkpoint CLIP</option>
                                  {sortWithFavorites(comfyModels.clips, comfyFavorites.clips).map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                                {comfyHasAnyLoraSelection && (
                                  <div className="text-[10px] text-amber-300 mt-1">LoRA overrides CLIP selection.</div>
                                )}
                                <button
                                  type="button"
                                  className="text-[10px] text-gray-400 hover:text-white mt-2"
                                  onClick={() => toggleFavorite('clips', comfyClip)}
                                  disabled={!comfyClip}
                                >
                                  {comfyFavorites.clips.includes(comfyClip) ? '★ Favorited' : '☆ Favorite'}
                                </button>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">LoRA (optional)</label>
                                <select
                                  value={comfyLora}
                                  onChange={(event) => setComfyLora(event.target.value)}
                                  className="app-select mt-1"
                                >
                                  <option value="">None</option>
                                  {sortWithFavorites(comfyModels.loras, comfyFavorites.loras).map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                                <button
                                  type="button"
                                  className="text-[10px] text-gray-400 hover:text-white mt-2"
                                  onClick={() => toggleFavorite('loras', comfyLora)}
                                  disabled={!comfyLora}
                                >
                                  {comfyFavorites.loras.includes(comfyLora) ? '★ Favorited' : '☆ Favorite'}
                                </button>
                                {comfyLora && (
                                  <div className="mt-2 flex items-center gap-3 text-[11px] text-gray-400">
                                    <span>Strength</span>
                                    <input
                                      type="range"
                                      min={0}
                                      max={1}
                                      step={0.05}
                                      value={comfyLoraScale}
                                      onChange={(event) => setComfyLoraScale(Number(event.target.value))}
                                      className="flex-1"
                                    />
                                    <span className="text-gray-300">{comfyLoraScale.toFixed(2)}</span>
                                  </div>
                                )}
                              </div>
                              <div className="md:col-span-2 rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">FreeFuse Multi-LoRA</div>
                                  <label className="text-xs text-gray-300 flex items-center gap-2">
                                    <input
                                      type="checkbox"
                                      checked={comfyUseFreeFuse}
                                      onChange={(event) => setComfyUseFreeFuse(event.target.checked)}
                                    />
                                    Enable FreeFuse
                                  </label>
                                </div>
                                <textarea
                                  value={comfyLoraStackText}
                                  onChange={(event) => setComfyLoraStackText(event.target.value)}
                                  placeholder={'One LoRA per line: lora_name|adapter|concept text|model_strength|clip_strength\nExample: harry_potter_flux.safetensors|harry|harry potter wizard|1|1'}
                                  className="app-textarea h-24"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <button
                                    type="button"
                                    className="app-button app-secondary text-[10px]"
                                    onClick={() => {
                                      if (!comfyLora) return;
                                      const nextIndex = comfyParsedLoraStack.length + 1;
                                      const fallbackAdapter = `concept${nextIndex}`;
                                      const adapter = normalizeAdapterName(
                                        comfyLora.replace(/\.[^/.]+$/, '').replace(/\s+/g, '_'),
                                        fallbackAdapter
                                      );
                                      const line = `${comfyLora}|${adapter}|${adapter}|${comfyLoraScale.toFixed(2)}|${comfyLoraScale.toFixed(2)}`;
                                      setComfyLoraStackText((prev) => (prev.trim() ? `${prev.trim()}\n${line}` : line));
                                    }}
                                    disabled={!comfyLora}
                                  >
                                    Add Selected LoRA
                                  </button>
                                  <button
                                    type="button"
                                    className="app-button app-tertiary text-[10px]"
                                    onClick={() => setComfyLoraStackText('')}
                                    disabled={!comfyLoraStackText.trim()}
                                  >
                                    Clear Stack
                                  </button>
                                </div>
                                <input
                                  value={comfyFreeFuseBackgroundText}
                                  onChange={(event) => setComfyFreeFuseBackgroundText(event.target.value)}
                                  placeholder="FreeFuse background text (optional)"
                                  className="app-input"
                                />
                                <div className="text-[10px] text-gray-500">
                                  Parsed stack: {comfyEffectiveLoraStack.length} / 4 LoRAs.
                                  {comfyUseFreeFuse && !comfyFreeFuseActive ? ' FreeFuse needs at least 2 valid stack lines.' : ''}
                                </div>
                                {comfyUseFreeFuse && (
                                  <div className="text-[10px] text-gray-500">
                                    Requires FreeFuse ComfyUI nodes (for example: <span className="text-gray-300">comfy node install freefuse</span>).
                                  </div>
                                )}
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Steps</label>
                                <input
                                  type="number"
                                  value={comfySteps}
                                  onChange={(event) => setComfySteps(Number(event.target.value) || 1)}
                                  className="app-input mt-1"
                                  min={1}
                                  max={150}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">CFG</label>
                                <input
                                  type="number"
                                  value={comfyCfg}
                                  onChange={(event) => setComfyCfg(Number(event.target.value) || 1)}
                                  className="app-input mt-1"
                                  min={1}
                                  max={30}
                                  step={0.5}
                                />
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Sampler</label>
                                <select
                                  value={comfySampler}
                                  onChange={(event) => setComfySampler(event.target.value)}
                                  className="app-select mt-1"
                                >
                                  {COMFY_SAMPLERS.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Scheduler</label>
                                <select
                                  value={comfyScheduler}
                                  onChange={(event) => setComfyScheduler(event.target.value)}
                                  className="app-select mt-1"
                                >
                                  {COMFY_SCHEDULERS.map((name) => (
                                    <option key={name} value={name}>{name}</option>
                                  ))}
                                </select>
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Seed (optional)</label>
                                <input
                                  type="number"
                                  value={comfySeed}
                                  onChange={(event) => setComfySeed(event.target.value === '' ? '' : Number(event.target.value))}
                                  placeholder="Random"
                                  className="app-input mt-1"
                                />
                              </div>
                              <div>
                                <label className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Denoise (img2img)</label>
                                <input
                                  type="number"
                                  value={comfyDenoise}
                                  onChange={(event) => setComfyDenoise(Number(event.target.value))}
                                  className="app-input mt-1"
                                  min={0.1}
                                  max={1}
                                  step={0.05}
                                />
                              </div>
                            </div>
                            <div className="grid gap-3 md:grid-cols-2">
                              <div className="app-panel p-3 space-y-2">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Workflow Mode</div>
                                <div className="flex items-center gap-3 text-[11px] text-gray-300">
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="radio"
                                      name="comfy-workflow-mode"
                                      checked={comfyWorkflowMode === 'auto'}
                                      onChange={() => setComfyWorkflowMode('auto')}
                                    />
                                    Auto
                                  </label>
                                  <label className="flex items-center gap-2">
                                    <input
                                      type="radio"
                                      name="comfy-workflow-mode"
                                      checked={comfyWorkflowMode === 'custom'}
                                      onChange={() => setComfyWorkflowMode('custom')}
                                    />
                                    Custom JSON
                                  </label>
                                </div>
                                {comfyWorkflowMode === 'custom' && (
                                  <div className="space-y-2">
                                    <input
                                      type="file"
                                      accept="application/json"
                                      className="text-[10px] text-gray-400"
                                      onChange={(event) => handleImportWorkflow(event.target.files?.[0] || null)}
                                    />
                                    <textarea
                                      value={comfyWorkflowJson}
                                      onChange={(event) => {
                                        setComfyWorkflowJson(event.target.value);
                                        setComfyWorkflowError(null);
                                      }}
                                      placeholder="Paste ComfyUI workflow JSON..."
                                      rows={5}
                                      className="app-textarea text-[10px]"
                                    />
                                    {comfyWorkflowError && (
                                      <div className="text-[10px] text-amber-300">{comfyWorkflowError}</div>
                                    )}
                                    {!comfyWorkflowError && comfyWorkflowJson.trim() && !comfyWorkflowNodes && (
                                      <div className="text-[10px] text-amber-300">Invalid workflow JSON.</div>
                                    )}
                                    {comfyWorkflowNodes && (
                                      <div className="space-y-2">
                                        <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Patch Mapping</div>
                                        <div className="grid gap-2 md:grid-cols-2">
                                          <div>
                                            <label className="text-[10px] text-gray-400">Positive Prompt Node</label>
                                            <select
                                              value={comfyPatchMap.positiveNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('positiveNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('CLIPTextEncode').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">Negative Prompt Node</label>
                                            <select
                                              value={comfyPatchMap.negativeNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('negativeNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('CLIPTextEncode').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">Checkpoint Node</label>
                                            <select
                                              value={comfyPatchMap.checkpointNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('checkpointNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('CheckpointLoaderSimple').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">VAE Node</label>
                                            <select
                                              value={comfyPatchMap.vaeNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('vaeNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('VAELoader').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">CLIP Node</label>
                                            <select
                                              value={comfyPatchMap.clipNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('clipNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('CLIPLoader').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">LoRA Node</label>
                                            <select
                                              value={comfyPatchMap.loraNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('loraNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('LoraLoader').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">Sampler Node</label>
                                            <select
                                              value={comfyPatchMap.samplerNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('samplerNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('KSampler').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">Latent Node</label>
                                            <select
                                              value={comfyPatchMap.latentNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('latentNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('EmptyLatentImage').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                          <div>
                                            <label className="text-[10px] text-gray-400">Load Image Node</label>
                                            <select
                                              value={comfyPatchMap.loadImageNodeId || ''}
                                              onChange={(event) => updateComfyPatchMap('loadImageNodeId', event.target.value)}
                                              className="app-select mt-1"
                                            >
                                              <option value="">Auto</option>
                                              {comfyWorkflowNodes.byType('LoadImage').map((node) => (
                                                <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                              ))}
                                            </select>
                                          </div>
                                        </div>
                                        {renderComfyPatchPreview(comfyPatchMap, comfyWorkflowNodes)}
                                      </div>
                                    )}
                                  </div>
                                )}
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="app-button app-secondary text-[10px]"
                                    onClick={handleExportWorkflow}
                                  >
                                    Export Auto JSON
                                  </button>
                                  <button
                                    type="button"
                                    className="app-button app-tertiary text-[10px]"
                                    onClick={() => navigator.clipboard.writeText(
                                      JSON.stringify(
                                        createComfyWorkflow({
                                          baseUrl: normalizeComfyUrl(comfyUrl),
                                          prompt: finalPrompt || 'Your prompt here',
                                          negativePrompt,
                                          ...resolveComfyDimensions(effectiveAspectRatio, imageSize),
                                          steps: comfySteps,
                                          cfg: comfyCfg,
                                          sampler: comfySampler,
                                          scheduler: comfyScheduler,
                                          seed: typeof comfySeed === 'number' ? comfySeed : 0,
                                          denoise: comfyDenoise,
                                          checkpoint: comfyCheckpoint,
                                          vae: comfyVae,
                                          clip: comfyClip,
                                          lora: comfyLora,
                                          loraStrength: comfyLoraScale,
                                          loraStack: comfyEffectiveLoraStack,
                                          freefuse: {
                                            enabled: comfyFreeFuseActive,
                                            backgroundText: comfyFreeFuseBackgroundText,
                                          },
                                        }),
                                        null,
                                        2
                                      )
                                    )}
                                  >
                                    Copy Auto JSON
                                  </button>
                                </div>
                              </div>
                              <div className="app-panel p-3 space-y-2">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Presets</div>
                                <select
                                  value={selectedComfyPresetId}
                                  onChange={(event) => applyComfyPreset(event.target.value)}
                                  className="app-select"
                                >
                                  <option value="">Select preset</option>
                                  {comfyPresets.map((preset) => (
                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                  ))}
                                </select>
                                <input
                                  value={comfyPresetName}
                                  onChange={(event) => setComfyPresetName(event.target.value)}
                                  placeholder="Preset name"
                                  className="app-input"
                                />
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="app-button app-primary text-[10px]"
                                    onClick={saveComfyPreset}
                                  >
                                    Save / Update
                                  </button>
                                  <button
                                    type="button"
                                    className="app-button app-tertiary text-[10px]"
                                    onClick={deleteComfyPreset}
                                    disabled={!selectedComfyPresetId}
                                  >
                                    Delete
                                  </button>
                                </div>
                              </div>
                            </div>
                            <div className="app-panel p-3 space-y-3">
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Workflow Chain</div>
                                <label className="flex items-center gap-2 text-[10px] text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={comfyChainEnabled}
                                    onChange={(event) => setComfyChainEnabled(event.target.checked)}
                                  />
                                  Enable chain
                                </label>
                              </div>
                              {comfyChainEnabled && (
                                <div className="space-y-3">
                                  <div className="space-y-2">
                                    <div className="grid gap-2 md:grid-cols-[1fr_auto]">
                                      <select
                                        value={comfyChainTemplateId}
                                        onChange={(event) => setComfyChainTemplateId(event.target.value)}
                                        className="app-select text-[10px]"
                                      >
                                        <option value="">Chain templates</option>
                                        {COMFY_CHAIN_TEMPLATES.map((template) => (
                                          <option key={template.id} value={template.id}>
                                            {template.name}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        className="app-button app-secondary text-[10px]"
                                        onClick={() => applyComfyChainTemplate(comfyChainTemplateId)}
                                        disabled={!comfyChainTemplateId}
                                      >
                                        Apply Template
                                      </button>
                                    </div>
                                    {comfyChainTemplateId && (
                                      <div className="text-[10px] text-gray-500">
                                        {COMFY_CHAIN_TEMPLATES.find((item) => item.id === comfyChainTemplateId)?.description}
                                      </div>
                                    )}
                                    <div className="text-[10px] text-gray-500">
                                      Applying a template replaces the current chain steps.
                                    </div>
                                  </div>
                                  {comfyChainSteps.length === 0 && (
                                    <div className="text-[10px] text-gray-500">Add chain steps to run multiple workflows (e.g., upscale).</div>
                                  )}
                                  {comfyChainSteps.map((step) => {
                                    const stepNodes = parseComfyWorkflowNodes(step.workflowJson);
                                    return (
                                      <div key={step.id} className="bg-gray-900/60 border border-gray-700 rounded-lg p-3 space-y-2">
                                        <div className="flex items-center justify-between gap-2">
                                          <input
                                            value={step.name}
                                            onChange={(event) => updateComfyChainStep(step.id, { name: event.target.value })}
                                            className="app-input text-[11px]"
                                          />
                                          <button
                                            type="button"
                                            className="text-[10px] text-red-300 hover:text-red-200"
                                            onClick={() => removeComfyChainStep(step.id)}
                                          >
                                            Remove
                                          </button>
                                        </div>
                                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-gray-300">
                                          <label className="flex items-center gap-2">
                                            <input
                                              type="radio"
                                              name={`chain-mode-${step.id}`}
                                              checked={step.mode === 'auto'}
                                              onChange={() => updateComfyChainStep(step.id, { mode: 'auto' })}
                                            />
                                            Auto
                                          </label>
                                          <label className="flex items-center gap-2">
                                            <input
                                              type="radio"
                                              name={`chain-mode-${step.id}`}
                                              checked={step.mode === 'custom'}
                                              onChange={() => updateComfyChainStep(step.id, { mode: 'custom' })}
                                            />
                                            Custom JSON
                                          </label>
                                          <label className="flex items-center gap-2">
                                            <input
                                              type="checkbox"
                                              checked={step.useInitImage}
                                              onChange={(event) => updateComfyChainStep(step.id, { useInitImage: event.target.checked })}
                                            />
                                            Use previous output as init
                                          </label>
                                        </div>
                                        {step.mode === 'custom' && (
                                          <div className="space-y-2">
                                            <textarea
                                              value={step.workflowJson}
                                              onChange={(event) => updateComfyChainStep(step.id, { workflowJson: event.target.value })}
                                              rows={4}
                                              placeholder="Paste chain workflow JSON..."
                                              className="app-textarea text-[10px]"
                                            />
                                            {!step.workflowJson.trim() && (
                                              <div className="text-[10px] text-amber-300">Add workflow JSON for this step.</div>
                                            )}
                                            {step.workflowJson.trim() && !stepNodes && (
                                              <div className="text-[10px] text-amber-300">Invalid workflow JSON.</div>
                                            )}
                                            {stepNodes && (
                                              <div className="grid gap-2 md:grid-cols-2">
                                                <div>
                                                  <label className="text-[10px] text-gray-400">Prompt Node</label>
                                                  <select
                                                    value={step.patchMap.positiveNodeId || ''}
                                                    onChange={(event) => updateComfyChainPatch(step.id, 'positiveNodeId', event.target.value)}
                                                    className="app-select mt-1"
                                                  >
                                                    <option value="">Auto</option>
                                                    {stepNodes.byType('CLIPTextEncode').map((node) => (
                                                      <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-400">Negative Node</label>
                                                  <select
                                                    value={step.patchMap.negativeNodeId || ''}
                                                    onChange={(event) => updateComfyChainPatch(step.id, 'negativeNodeId', event.target.value)}
                                                    className="app-select mt-1"
                                                  >
                                                    <option value="">Auto</option>
                                                    {stepNodes.byType('CLIPTextEncode').map((node) => (
                                                      <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-400">Checkpoint Node</label>
                                                  <select
                                                    value={step.patchMap.checkpointNodeId || ''}
                                                    onChange={(event) => updateComfyChainPatch(step.id, 'checkpointNodeId', event.target.value)}
                                                    className="app-select mt-1"
                                                  >
                                                    <option value="">Auto</option>
                                                    {stepNodes.byType('CheckpointLoaderSimple').map((node) => (
                                                      <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-400">Sampler Node</label>
                                                  <select
                                                    value={step.patchMap.samplerNodeId || ''}
                                                    onChange={(event) => updateComfyChainPatch(step.id, 'samplerNodeId', event.target.value)}
                                                    className="app-select mt-1"
                                                  >
                                                    <option value="">Auto</option>
                                                    {stepNodes.byType('KSampler').map((node) => (
                                                      <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                                <div>
                                                  <label className="text-[10px] text-gray-400">Load Image Node</label>
                                                  <select
                                                    value={step.patchMap.loadImageNodeId || ''}
                                                    onChange={(event) => updateComfyChainPatch(step.id, 'loadImageNodeId', event.target.value)}
                                                    className="app-select mt-1"
                                                  >
                                                    <option value="">Auto</option>
                                                    {stepNodes.byType('LoadImage').map((node) => (
                                                      <option key={node.id} value={node.id}>{node.id} • {node.type}</option>
                                                    ))}
                                                  </select>
                                                </div>
                                              </div>
                                            )}
                                            {stepNodes && renderComfyPatchPreview(step.patchMap, stepNodes)}
                                          </div>
                                        )}
                                      </div>
                                    );
                                  })}
                                  <button
                                    type="button"
                                    className="app-button app-secondary text-[10px]"
                                    onClick={addComfyChainStep}
                                  >
                                    Add Chain Step
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="app-panel p-3 space-y-2">
                              <div className="flex items-center justify-between">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Auto-Start (Desktop)</div>
                                <label className="flex items-center gap-2 text-[10px] text-gray-300">
                                  <input
                                    type="checkbox"
                                    checked={comfyAutoStart}
                                    onChange={(event) => setComfyAutoStart(event.target.checked)}
                                  />
                                  Auto-start ComfyUI
                                </label>
                              </div>
                              <select
                                value={comfyAutoProfileId}
                                onChange={(event) => setComfyAutoProfileId(event.target.value)}
                                className="app-select text-[10px]"
                              >
                                <option value="">Auto profile (optional)</option>
                                {comfyPresets.map((preset) => (
                                  <option key={preset.id} value={preset.id}>{preset.name}</option>
                                ))}
                              </select>
                              <div className="grid gap-2 md:grid-cols-2">
                                <input
                                  value={comfyLaunchCommand}
                                  onChange={(event) => setComfyLaunchCommand(event.target.value)}
                                  placeholder="Command (e.g., python)"
                                  className="app-input"
                                />
                                <input
                                  value={comfyLaunchArgs}
                                  onChange={(event) => setComfyLaunchArgs(event.target.value)}
                                  placeholder="Args (e.g., main.py)"
                                  className="app-input"
                                />
                              </div>
                              <input
                                value={comfyLaunchCwd}
                                onChange={(event) => setComfyLaunchCwd(event.target.value)}
                                placeholder="Working directory (ComfyUI folder)"
                                className="app-input"
                              />
                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  className="app-button app-secondary text-[10px]"
                                  onClick={handleComfyStart}
                                  disabled={comfyIsStarting}
                                >
                                  {comfyIsStarting ? 'Starting...' : 'Start ComfyUI'}
                                </button>
                                <button
                                  type="button"
                                  className="app-button app-tertiary text-[10px]"
                                  onClick={handleComfyStop}
                                >
                                  Stop
                                </button>
                                <button
                                  type="button"
                                  className="app-button app-tertiary text-[10px]"
                                  onClick={handleComfyRefreshStatus}
                                >
                                  Status
                                </button>
                              </div>
                              {comfyLaunchStatus && (
                                <div className="text-[10px] text-gray-400">{comfyLaunchStatus}</div>
                              )}
                            </div>
                            <div className="app-panel p-3 space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="text-[10px] uppercase tracking-[0.2em] text-gray-500">Diagnostics</div>
                                <div className="flex items-center gap-2">
                                  <button
                                    type="button"
                                    className="app-button app-secondary text-[10px]"
                                    onClick={handleComfyHealthCheck}
                                    disabled={comfyIsCheckingHealth}
                                  >
                                    {comfyIsCheckingHealth ? 'Checking...' : 'Health Check'}
                                  </button>
                                  <button
                                    type="button"
                                    className="app-button app-tertiary text-[10px]"
                                    onClick={handleComfyLoadLogs}
                                    disabled={comfyIsLoadingLogs}
                                  >
                                    {comfyIsLoadingLogs ? 'Loading...' : 'Refresh Logs'}
                                  </button>
                                  <button
                                    type="button"
                                    className="app-button app-tertiary text-[10px]"
                                    onClick={handleComfyClearLogs}
                                  >
                                    Clear
                                  </button>
                                </div>
                              </div>
                              {comfyHealthStatus && (
                                <div className="text-[10px] text-gray-400">{comfyHealthStatus}</div>
                              )}
                              {comfyHealth && (
                                <pre className="whitespace-pre-wrap text-[10px] text-gray-300 bg-gray-900/60 border border-gray-700 rounded p-2 max-h-40 overflow-auto">
                                  {formatComfyHealth(comfyHealth)}
                                </pre>
                              )}
                              {comfyLogStatus && (
                                <div className="text-[10px] text-gray-400">{comfyLogStatus}</div>
                              )}
                              <div className="bg-gray-900/60 border border-gray-700 rounded p-2 max-h-40 overflow-auto text-[10px] text-gray-300">
                                {comfyLogLines.length === 0 ? (
                                  <div className="text-gray-500">Log buffer empty.</div>
                                ) : (
                                  <pre className="whitespace-pre-wrap">{comfyLogLines.join('\n')}</pre>
                                )}
                              </div>
                            </div>
                            {comfyStatus && <div className="text-[11px] text-gray-400">{comfyStatus}</div>}
                            <div className="text-[10px] text-gray-500">
                              Tip: For img2img, add a reference image. The first reference will be used as init image.
                            </div>
                          </div>
                        )}

                        <div>
                          <StyleSelection
                            selectedStyleId={selectedStyleId}
                            setSelectedStyleId={setSelectedStyleId}
                          />
                        </div>

                        <div>
                          <ShotTypeSelection
                            selectedId={selectedShotTypeId}
                            onSelect={setSelectedShotTypeId}
                          />
                        </div>

                        <div>
                          <LightingSelection
                            selectedId={selectedLightingId}
                            onSelect={setSelectedLightingId}
                          />
                        </div>

                        <div className="app-panel p-4 space-y-3">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Reference Images</div>
                              <p className="text-[11px] text-gray-500 mt-1">
                                {supportsReferences
                                  ? isComfyUi
                                    ? `Up to ${referenceLimit} image. The first one will guide the starting frame.`
                                    : modelId === 'firered'
                                      ? `Up to ${referenceLimit} images. FireRed needs at least one reference or moodboard image.`
                                      : `Up to ${referenceLimit} images. If you leave this empty, moodboard images are used when supported.`
                                  : 'This engine does not use reference images.'}
                              </p>
                            </div>
                            <span className="text-xs text-gray-400">
                              {contextReferences.length}/{supportsReferences ? referenceLimit : 0}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <label className={`app-button app-secondary text-xs cursor-pointer ${supportsReferences ? '' : 'opacity-50 cursor-not-allowed'}`}>
                              <UploadIcon className="w-4 h-4" />
                              Upload
                              <input
                                type="file"
                                multiple
                                accept="image/*"
                                className="hidden"
                                disabled={!supportsReferences}
                                onChange={(event) => {
                                  handleContextUpload(event.target.files);
                                  event.currentTarget.value = '';
                                }}
                              />
                            </label>
                            {contextReferences.length > 0 && (
                              <button className="app-button app-tertiary text-xs" onClick={handleContextClear}>
                                <TrashIcon className="w-4 h-4" />
                                Clear
                              </button>
                            )}
                            {referenceOverflow && (
                              <span className="text-[11px] text-amber-300">
                                Only first {referenceLimit} will be used.
                              </span>
                            )}
                          </div>
                          {contextReferences.length === 0 ? (
                            <div className="text-[11px] text-gray-500 border border-dashed border-gray-700 rounded-lg p-3 text-center">
                              Drop reference images here if you want model context beyond the moodboard.
                            </div>
                          ) : (
                            <div className="grid gap-3 sm:grid-cols-3">
                              {contextReferences.map((item) => (
                                <div key={item.id} className="relative aspect-video bg-black/60 rounded-lg overflow-hidden border border-gray-700">
                                  <img src={item.url} alt="Context reference" className="w-full h-full object-cover" />
                                  <button
                                    className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded"
                                    onClick={() => handleContextRemove(item.id)}
                                  >
                                    Remove
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {characterReferences.length > 0 && (
                          <div className="app-panel p-4 space-y-3">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Characters</div>
                                <p className="text-[11px] text-gray-500 mt-1">
                                  Click a character to insert @tag and use the reference as context.
                                </p>
                              </div>
                            </div>
                            <div className="grid gap-3 sm:grid-cols-2">
                              {characterReferences.map((char) => {
                                const tag = normalizeCharacterTag(char.name);
                                return (
                                  <button
                                    key={char.id}
                                    className="app-card p-3 flex items-center gap-3 text-left hover:border-indigo-400/40"
                                    onClick={() => {
                                      setPrompt((prev) => (prev.includes(tag) ? prev : `${prev} ${tag}`.trim()));
                                      if (char.imageUrl) {
                                        setContextReferences((prev) => {
                                          if (prev.some((ref) => ref.url === char.imageUrl)) return prev;
                                          return [
                                            { id: `char-${char.id}`, url: char.imageUrl!, file: undefined },
                                            ...prev,
                                          ];
                                        });
                                      }
                                    }}
                                  >
                                    <div className="w-10 h-10 rounded-lg overflow-hidden bg-black/40">
                                      {char.imageUrl ? (
                                        <img src={char.imageUrl} alt={char.name} className="w-full h-full object-cover" />
                                      ) : null}
                                    </div>
                                    <div className="min-w-0">
                                      <div className="text-sm text-gray-200 truncate">{char.name}</div>
                                      <div className="text-[10px] text-indigo-300">{tag}</div>
                                    </div>
                                  </button>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div className="app-panel p-3 flex items-center justify-between text-sm text-gray-300">
                          <span>{moodboard.length} moodboard images</span>
                          <button className="app-button app-secondary text-xs" onClick={() => setActiveTab('moodboard')}>
                            Edit Moodboard
                          </button>
                        </div>
                        {moodboard.length > 0 && !supportsReferences && (
                          <p className="text-xs text-gray-500">
                            This model does not accept reference images. Moodboard guidance will be text-only.
                          </p>
                        )}

                      </div>{/* end Advanced Visual Settings content */}
                    </details>
                  </>
                ) : activeTab === 'moodboard' ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold">Moodboard</h2>
                        <p className="text-gray-400">Upload style references for consistent visual direction.</p>
                      </div>
                      <UploadIcon className="w-8 h-8 text-indigo-300" />
                    </div>

                    <div className="flex flex-wrap items-center gap-3">
                      <label className="app-button app-primary cursor-pointer">
                        <UploadIcon className="w-4 h-4" />
                        Upload images
                        <input
                          type="file"
                          multiple
                          accept="image/*"
                          className="hidden"
                          onChange={(event) => {
                            handleMoodboardUpload(event.target.files);
                            event.currentTarget.value = '';
                          }}
                        />
                      </label>
                      {moodboard.length > 0 && (
                        <button className="app-button app-secondary text-sm" onClick={handleMoodboardClear}>
                          <TrashIcon className="w-4 h-4" />
                          Clear
                        </button>
                      )}
                      <span className="text-sm text-gray-400">{moodboard.length} references</span>
                    </div>

                    {moodboard.length === 0 && (
                      <div className="app-panel p-6 text-center text-gray-400">
                        Drop style references here to guide your next generations.
                      </div>
                    )}

                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {moodboard.map((item) => (
                        <div key={item.id} className="app-card p-2">
                          <div className="relative aspect-video bg-black/60 rounded-lg overflow-hidden">
                            <img
                              src={item.url}
                              alt="Moodboard reference"
                              className="w-full h-full object-cover cursor-zoom-in"
                              onDoubleClick={() => setAssetPreview({ url: item.url, kind: 'image', title: 'Moodboard reference' })}
                            />
                            <button
                              className="absolute top-2 right-2 bg-black/60 text-white text-xs px-2 py-1 rounded"
                              onClick={() => handleMoodboardRemove(item.id)}
                            >
                              Remove
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : activeTab === 'relight' ? (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold">Relight</h2>
                        <p className="text-gray-400">Rebuild lighting on an existing image without changing the scene.</p>
                      </div>
                      <SparklesIcon className="w-8 h-8 text-indigo-300" />
                    </div>

                    <div className="app-panel p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Source Image</div>
                        <div className="flex items-center gap-2">
                          <label className="app-button app-secondary text-xs cursor-pointer">
                            <UploadIcon className="w-4 h-4" />
                            Upload
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  if (typeof reader.result === 'string') {
                                    setRelightSourceUrl(reader.result);
                                  }
                                };
                                reader.readAsDataURL(file);
                                event.currentTarget.value = '';
                              }}
                            />
                          </label>
                          <button
                            className="app-button app-tertiary text-xs"
                            disabled={latestResults.length === 0}
                            onClick={() => {
                              if (latestResults[0]?.url) {
                                setRelightSourceUrl(latestResults[0].url);
                              }
                            }}
                          >
                            Use Latest
                          </button>
                        </div>
                      </div>
                      <input
                        value={relightSourceUrl}
                        onChange={(event) => setRelightSourceUrl(event.target.value)}
                        placeholder="Paste image URL..."
                        className="app-input"
                      />
                      {relightSourceUrl ? (
                        <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                          <img src={relightSourceUrl} alt="Relight source" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500 border border-dashed border-gray-700 rounded-lg p-3 text-center">
                          Upload or paste an image to relight.
                        </div>
                      )}
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Relight Model</label>
                        <select
                          value={relightModel}
                          onChange={(event) => setRelightModel(event.target.value as 'gemini' | 'replicate')}
                          className="app-select mt-1"
                        >
                          <option value="gemini">Gemini 3 Pro</option>
                          <option value="replicate">Replicate (Qwen Edit)</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-4 mb-2">
                      <label className="text-xs uppercase tracking-[0.2em] text-gray-400 mb-2 block">Preset</label>
                      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-2">
                        {RELIGHT_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => {
                              setRelightPresetId(preset.id);
                            }}
                            className={`relative group overflow-hidden rounded-lg aspect-square border transition-all ${relightPresetId === preset.id ? 'border-amber-400 ring-2 ring-amber-400/30 scale-[1.02] shadow-lg shadow-amber-900/20' : 'border-gray-700 hover:border-gray-500 hover:scale-[1.01]'
                              }`}
                          >
                            {preset.image ? (
                              <img src={preset.image} alt={preset.label} className="absolute inset-0 w-full h-full object-cover group-hover:opacity-90 transition-opacity" />
                            ) : (
                              <div className="absolute inset-0 flex items-center justify-center bg-gray-800 text-gray-500">
                                <span className="text-[10px] uppercase font-bold text-gray-400">Custom</span>
                              </div>
                            )}
                            <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/50 to-transparent p-2 pt-6">
                              <span className={`text-[11px] font-medium block text-left ${relightPresetId === preset.id ? 'text-amber-300' : 'text-gray-200'}`}>
                                {preset.label}
                              </span>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Light Direction</label>
                        <select
                          value={relightDirectionId}
                          onChange={(event) => setRelightDirectionId(event.target.value)}
                          className="app-select mt-1"
                        >
                          {RELIGHT_DIRECTIONS.map((direction) => (
                            <option key={direction.id} value={direction.id}>
                              {direction.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Light Color</label>
                        <div className="mt-1 flex items-center gap-2">
                          <input
                            type="color"
                            value={relightColor}
                            onChange={(event) => setRelightColor(event.target.value)}
                            className="h-10 w-12 rounded border border-gray-700 bg-gray-900"
                          />
                          <input
                            value={relightColor}
                            onChange={(event) => setRelightColor(event.target.value)}
                            className="app-input flex-1"
                          />
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Intensity</label>
                        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={relightIntensity}
                            onChange={(event) => setRelightIntensity(Number(event.target.value))}
                            className="flex-1"
                          />
                          <span className="text-gray-300">{relightIntensity.toFixed(2)}</span>
                        </div>
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Softness</label>
                        <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
                          <input
                            type="range"
                            min={0}
                            max={1}
                            step={0.05}
                            value={relightSoftness}
                            onChange={(event) => setRelightSoftness(Number(event.target.value))}
                            className="flex-1"
                          />
                          <span className="text-gray-300">{relightSoftness.toFixed(2)}</span>
                        </div>
                      </div>
                    </div>

                    <div className="grid gap-4 md:grid-cols-2">
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Environment</label>
                        <input
                          value={relightEnvironment}
                          onChange={(event) => setRelightEnvironment(event.target.value)}
                          placeholder="e.g., rainy street, studio, golden hour haze"
                          className="app-input mt-1"
                        />
                      </div>
                      <div>
                        <label className="text-xs uppercase tracking-[0.2em] text-gray-400">Extra Notes</label>
                        <input
                          value={relightNotes}
                          onChange={(event) => setRelightNotes(event.target.value)}
                          placeholder="e.g., keep skin tones natural"
                          className="app-input mt-1"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        onClick={handleRelight}
                        disabled={relightIsRunning || !relightSourceUrl}
                        className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {relightIsRunning ? 'Relighting...' : 'Relight Image'}
                      </button>
                      <p className="text-xs text-gray-500 flex-1 text-right">
                        Prompt: {buildRelightPrompt(buildRelightSettings()).slice(0, 120)}
                        {buildRelightPrompt(buildRelightSettings()).length > 120 ? '...' : ''}
                      </p>
                    </div>

                    {relightStatus && <p className="text-sm text-gray-300">{relightStatus}</p>}
                  </>
                ) : (
                  <>
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-2xl font-bold">Photorealism Check</h2>
                        <p className="text-gray-400">Analyze how photoreal an image feels and get fixes.</p>
                      </div>
                      <SparklesIcon className="w-8 h-8 text-indigo-300" />
                    </div>

                    <div className="app-panel p-4 space-y-3">
                      <div className="flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Source Image</div>
                        <div className="flex items-center gap-2">
                          <label className="app-button app-secondary text-xs cursor-pointer">
                            <UploadIcon className="w-4 h-4" />
                            Upload
                            <input
                              type="file"
                              accept="image/*"
                              className="hidden"
                              onChange={(event) => {
                                const file = event.target.files?.[0];
                                if (!file) return;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  if (typeof reader.result === 'string') {
                                    setPhotorealSourceUrl(reader.result);
                                    setPhotorealResult('');
                                    setPhotorealStatus(null);
                                  }
                                };
                                reader.readAsDataURL(file);
                                event.currentTarget.value = '';
                              }}
                            />
                          </label>
                          <button
                            className="app-button app-tertiary text-xs"
                            disabled={latestResults.length === 0}
                            onClick={() => {
                              if (latestResults[0]?.url) {
                                setPhotorealSourceUrl(latestResults[0].url);
                                setPhotorealResult('');
                                setPhotorealStatus(null);
                              }
                            }}
                          >
                            Use Latest
                          </button>
                        </div>
                      </div>
                      <input
                        value={photorealSourceUrl}
                        onChange={(event) => setPhotorealSourceUrl(event.target.value)}
                        placeholder="Paste image URL..."
                        className="app-input"
                      />
                      {photorealSourceUrl ? (
                        <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                          <img src={photorealSourceUrl} alt="Photoreal source" className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="text-[11px] text-gray-500 border border-dashed border-gray-700 rounded-lg p-3 text-center">
                          Upload or paste an image to analyze.
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <button
                        onClick={handlePhotorealCheck}
                        disabled={isPhotorealChecking || !photorealSourceUrl}
                        className="app-button app-primary disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isPhotorealChecking ? 'Analyzing...' : 'Run Photorealism Check'}
                      </button>
                      <button
                        onClick={() => {
                          setPhotorealSourceUrl('');
                          setPhotorealResult('');
                          setPhotorealStatus(null);
                        }}
                        className="app-button app-secondary"
                      >
                        Clear
                      </button>
                    </div>

                    {photorealStatus && <p className="text-sm text-gray-300">{photorealStatus}</p>}
                    {photorealResult && (
                      <div className="app-panel p-4 whitespace-pre-wrap text-sm text-gray-200">
                        {photorealResult}
                      </div>
                    )}
                  </>
                )}
              </section>

              <aside className="space-y-4">
                <section className="app-panel p-5 space-y-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Latest results</div>
                  {latestResults.length === 0 && (
                    <div className="text-sm text-gray-500">
                      Generate an image to see previews here. Results are also added to your media bin.
                    </div>
                  )}
                  <div className="grid gap-3 sm:grid-cols-2">
                    {latestResults.map((item) => (
                      (() => {
                        const historyEntry = historyByUrl.get(item.url);
                        const promptText = item.prompt || historyEntry?.prompt || '';
                        return (
                          <div key={item.id} className="app-card p-2 space-y-2">
                            <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                              <img
                                src={item.url}
                                alt={item.name}
                                className="w-full h-full object-cover cursor-zoom-in"
                                onDoubleClick={() => setAssetPreview({ url: item.url, kind: 'image', title: item.name })}
                              />
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-xs text-gray-400 truncate">{item.name}</p>
                                  {item.generatedBy && (
                                    <p className="text-[10px] text-indigo-300">{item.generatedBy}</p>
                                  )}
                                </div>
                                <a href={item.url} download className="app-button app-secondary text-xs">
                                  <DownloadIcon className="w-4 h-4" />
                                  Download
                                </a>
                              </div>
                              {promptText && (
                                <div className="text-[10px] text-gray-400 line-clamp-2">{promptText}</div>
                              )}
                              {promptText && (
                                <div className="flex items-center gap-2">
                                  <button
                                    className="app-button app-primary text-[10px] flex-1"
                                    onClick={() => (historyEntry ? handleReuse(historyEntry) : handleReusePrompt(promptText))}
                                  >
                                    {historyEntry ? 'Reuse Settings' : 'Reuse Prompt'}
                                  </button>
                                  <button
                                    className="app-button app-secondary text-[10px]"
                                    onClick={() => navigator.clipboard.writeText(promptText)}
                                  >
                                    Copy Prompt
                                  </button>
                                </div>
                              )}
                              {onAnimateImage && (
                                <button
                                  className="app-button app-primary text-xs w-full"
                                  onClick={() => onAnimateImage(item)}
                                >
                                  Animate in Video Gen
                                </button>
                              )}
                              {activeTab === 'photoreal' && (
                                <button
                                  className="app-button app-tertiary text-xs w-full"
                                  onClick={() => {
                                    setPhotorealSourceUrl(item.url);
                                    setPhotorealResult('');
                                    setPhotorealStatus(null);
                                  }}
                                >
                                  Use for Check
                                </button>
                              )}
                            </div>
                          </div>
                        );
                      })()
                    ))}
                  </div>
                </section>

                {activeJobs.length > 0 && (
                  <section className="app-panel p-5 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Active jobs</div>
                      <button
                        className="app-button app-tertiary text-[10px]"
                        onClick={handleClearCompletedJobs}
                      >
                        Clear completed
                      </button>
                    </div>
                    <div className="space-y-2">
                      {activeJobs.map((job) => (
                        <div key={job.id} className="app-card p-3 flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-xs text-gray-200 truncate">{job.prompt}</div>
                            <div className="text-[10px] text-indigo-300">{job.modelLabel || 'Model'}</div>
                          </div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-[0.2em]">
                            {job.status}
                          </span>
                        </div>
                      ))}
                    </div>
                  </section>
                )}

                <section className="app-panel p-5 space-y-3">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">History</div>
                  {generationHistory.length === 0 ? (
                    <div className="text-sm text-gray-500">No iterations yet. Generate to build a history.</div>
                  ) : (
                    <div className="grid gap-3">
                      {generationHistory.map((entry) => (
                        <div key={entry.id} className="app-card p-3 space-y-2">
                          <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                            <img src={entry.url} alt={entry.prompt} className="w-full h-full object-cover" />
                          </div>
                          <div className="text-xs text-gray-300 line-clamp-2">{entry.prompt}</div>
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-indigo-300">
                            <span className="px-2 py-1 rounded bg-indigo-500/10 border border-indigo-500/30">
                              {entry.modelLabel || entry.modelId}
                            </span>
                            <span className="px-2 py-1 rounded bg-gray-800/60 border border-gray-700">
                              {entry.aspectRatio}
                            </span>
                            {entry.selectedStyleId && (
                              <span className="px-2 py-1 rounded bg-gray-800/60 border border-gray-700">
                                {entry.selectedStyleId}
                              </span>
                            )}
                          </div>
                          {entry.references.length > 0 && (
                            <div className="flex items-center gap-2">
                              {entry.references.slice(0, 4).map((ref) => (
                                <div key={ref.url} className="w-10 h-10 rounded-md overflow-hidden border border-gray-700 bg-black/60">
                                  <img src={ref.url} alt="reference" className="w-full h-full object-cover" />
                                </div>
                              ))}
                              {entry.references.length > 4 && (
                                <span className="text-[10px] text-gray-500">+{entry.references.length - 4}</span>
                              )}
                            </div>
                          )}
                          <div className="flex items-center gap-2">
                            <button
                              className="app-button app-primary text-xs flex-1"
                              onClick={() => handleReuse(entry)}
                            >
                              Reuse Prompt
                            </button>
                            <button
                              className="app-button app-secondary text-xs"
                              onClick={() => navigator.clipboard.writeText(entry.prompt)}
                            >
                              Copy
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                <section className="app-panel p-5 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs uppercase tracking-[0.2em] text-gray-400">Library assets</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        className={`app-button text-xs ${libraryAction === 'reference' ? 'app-primary' : 'app-secondary'}`}
                        onClick={() => setLibraryAction('reference')}
                      >
                        Use as Reference
                      </button>
                      <button
                        type="button"
                        className={`app-button text-xs ${libraryAction === 'moodboard' ? 'app-primary' : 'app-secondary'}`}
                        onClick={() => setLibraryAction('moodboard')}
                      >
                        Use as Moodboard
                      </button>
                      <button
                        type="button"
                        className={`app-button text-xs ${libraryAction === 'relight' ? 'app-primary' : 'app-secondary'}`}
                        onClick={() => setLibraryAction('relight')}
                      >
                        Use as Relight
                      </button>
                      <button
                        type="button"
                        className={`app-button text-xs ${libraryAction === 'photoreal' ? 'app-primary' : 'app-secondary'}`}
                        onClick={() => setLibraryAction('photoreal')}
                      >
                        Use for Check
                      </button>
                    </div>
                  </div>
                  <input
                    value={librarySearch}
                    onChange={(event) => setLibrarySearch(event.target.value)}
                    placeholder="Search library assets..."
                    className="app-input"
                  />
                  {libraryLoading && <p className="text-xs text-gray-500">Loading library assets...</p>}
                  {libraryError && <p className="text-xs text-amber-300">{libraryError}</p>}
                  <div className="grid gap-3 max-h-[360px] overflow-auto pr-1">
                    {filteredLibraryAssets.map((asset) => (
                      (() => {
                        const historyEntry = asset.url ? historyByUrl.get(asset.url) : undefined;
                        const promptText = asset.prompt || historyEntry?.prompt || '';
                        return (
                          <div key={asset.id} className="app-card p-3 space-y-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-xs text-gray-200 truncate">{asset.name}</p>
                                <p className="text-[10px] text-gray-500 truncate">{asset.projectName}</p>
                              </div>
                              {asset.generatedBy && (
                                <span className="text-[10px] text-indigo-300">{asset.generatedBy}</span>
                              )}
                            </div>
                            {promptText && (
                              <div className="text-[10px] text-gray-400 line-clamp-2">{promptText}</div>
                            )}
                            {asset.url && (asset.kind === 'image' || asset.kind === 'reference') ? (
                              <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                                <img
                                  src={asset.url}
                                  alt={asset.name}
                                  className="w-full h-full object-cover cursor-zoom-in"
                                  onDoubleClick={() => setAssetPreview({ url: asset.url || '', kind: 'image', title: asset.name })}
                                />
                              </div>
                            ) : (
                              <div className="aspect-video bg-gray-900/50 rounded-lg flex items-center justify-center text-[10px] text-gray-500">
                                {asset.kind} asset
                              </div>
                            )}
                            <div className="flex items-center justify-between gap-2">
                              {asset.url && (asset.kind === 'image' || asset.kind === 'reference') ? (
                                <button
                                  className="app-button app-secondary text-xs"
                                  onClick={() => {
                                    if (libraryAction === 'reference') {
                                      addLibraryReference(asset);
                                    } else if (libraryAction === 'moodboard') {
                                      addLibraryMoodboard(asset);
                                    } else if (libraryAction === 'photoreal') {
                                      addLibraryPhotoreal(asset);
                                    } else {
                                      addLibraryRelight(asset);
                                    }
                                  }}
                                >
                                  {libraryAction === 'reference'
                                    ? 'Add to References'
                                    : libraryAction === 'moodboard'
                                      ? 'Add to Moodboard'
                                      : libraryAction === 'photoreal'
                                        ? 'Use for Check'
                                        : 'Use for Relight'}
                                </button>
                              ) : (
                                <span className="text-[10px] text-gray-500">Image only</span>
                              )}
                              {asset.url && (
                                <a href={asset.url} download className="app-button app-tertiary text-xs">
                                  <DownloadIcon className="w-4 h-4" />
                                  Download
                                </a>
                              )}
                            </div>
                            {promptText && (
                              <div className="flex items-center gap-2">
                                <button
                                  className="app-button app-primary text-[10px] flex-1"
                                  onClick={() => (historyEntry ? handleReuse(historyEntry) : handleReusePrompt(promptText))}
                                >
                                  {historyEntry ? 'Reuse Settings' : 'Reuse Prompt'}
                                </button>
                                <button
                                  className="app-button app-secondary text-[10px]"
                                  onClick={() => navigator.clipboard.writeText(promptText)}
                                >
                                  Copy Prompt
                                </button>
                              </div>
                            )}
                          </div>
                        );
                      })()
                    ))}
                    {filteredLibraryAssets.length === 0 && !libraryLoading && (
                      <div className="text-xs text-gray-500 text-center">No library assets found.</div>
                    )}
                  </div>
                </section>
              </aside>
            </div>
          )}
          {assetPreview && (
            <div
              className="fixed inset-0 z-[90] bg-black/85 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => setAssetPreview(null)}
            >
              <div
                className="relative w-full max-w-6xl max-h-[90vh] rounded-xl border border-gray-700 bg-black/90 overflow-hidden"
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  type="button"
                  className="absolute top-3 right-3 z-10 app-button app-secondary text-xs"
                  onClick={() => setAssetPreview(null)}
                >
                  Close
                </button>
                <div className="w-full h-full flex items-center justify-center">
                  {assetPreview.kind === 'video' ? (
                    <video src={assetPreview.url} controls autoPlay className="max-h-[88vh] w-auto max-w-full" />
                  ) : (
                    <img src={assetPreview.url} alt={assetPreview.title || 'Preview'} className="max-h-[88vh] w-auto max-w-full object-contain" />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ImageGenerationWorkspace;
