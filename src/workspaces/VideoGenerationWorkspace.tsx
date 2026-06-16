import React, { useEffect, useMemo, useState } from 'react';
import { CostRate, MediaItem, RecentProject, ReferenceItem, ShotPrompt } from '../types';
import { UploadIcon, SparklesIcon, DownloadIcon, VideoIcon } from '../components/icons';
import { generateVideoWithVeo } from '../services/geminiService';
import { generateVideoWithGrok } from '../services/xaiService';
import {
  generateVideoWithSeedance,
  generateVideoWithWanI2V,
  generateVideoWithKling26,
  generateVideoWithKling,
  generateVideoWithKlingMotionControl,
  generateVideoWithLtx,
  generateVideoWithLtx23Fast,
  generateVideoWithLtx23Pro,
  generateVideoWithLtxAudioToVideo,
  generateVideoWithPVideo,
} from '../services/replicateService';
import {
  generateVideoWithFalCreatifyAurora,
  generateVideoWithFalGrokImagineI2V,
  generateVideoWithFalHappyHorseImage,
  generateVideoWithFalHappyHorseText,
  generateVideoWithFalKlingO3,
  generateVideoWithFalKlingV3Image,
  generateVideoWithFalPixverseC1Reference,
  generateVideoWithFalSeedanceImage,
  generateVideoWithFalSeedanceReference,
  generateVideoWithFalKlingV3Text,
  generateVideoWithFalWanV27Image,
  generateVideoWithFalWanV27Text,
} from '../services/falAiService';
import { fileToBase64, getBase64FromUrl } from '../utils/helpers';
import { LibraryAsset, useLibraryAssets } from '../hooks/useLibraryAssets';
import { estimateGenerationCost, formatUnitSummary, formatUsd } from '../utils/generationPricing';

interface VideoGenerationWorkspaceProps {
  onAddGeneratedMedia: (item: MediaItem) => void;
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
  seedImage?: MediaItem | null;
  onConsumeSeed?: () => void;
}

type VideoModelId =
  | 'veo-fast'
  | 'veo'
  | 'grok-video'
  | 'seedance'
  | 'seedance-2-fal'
  | 'seedance-2-omni-fal'
  | 'wan-i2v'
  | 'wan-v27-t2v-fal'
  | 'wan-v27-i2v-fal'
  | 'happy-horse-t2v-fal'
  | 'happy-horse-i2v-fal'
  | 'kling-26'
  | 'kling-25'
  | 'kling-o3-pro-fal'
  | 'kling-v3-pro-i2v-fal'
  | 'kling-v3-pro-t2v-fal'
  | 'pixverse-c1-ref-fal'
  | 'grok-imagine-i2v-fal'
  | 'aurora-fal'
  | 'kling-motion'
  | 'ltx'
  | 'ltx-23-fast'
  | 'ltx-23-pro'
  | 'ltx-audio'
  | 'p-video';

type ModelOption = {
  id: VideoModelId;
  label: string;
  provider: string;
  supportsImage?: boolean;
  requiresImage?: boolean;
  supportsAudio?: boolean;
  requiresAudio?: boolean;
  supportsEndFrame?: boolean;
};

type GenerationReadinessItem = {
  label: string;
  detail: string;
  state: 'ready' | 'needed' | 'optional';
};

const REQUIRED_GUIDE_READINESS_LABELS = new Set(['Start frame', 'Reference', 'Motion ref', 'Ref video', 'Audio']);

const MODEL_OPTIONS: ModelOption[] = [
  { id: 'veo-fast', label: 'Veo 3.1 Fast', provider: 'Google/Replicate', supportsImage: true },
  { id: 'veo', label: 'Veo 3.1', provider: 'Google/Replicate', supportsImage: true },
  { id: 'grok-video', label: 'Grok Imagine Video', provider: 'xAI', supportsImage: false },
  { id: 'seedance', label: 'Seedance 1.5 Pro', provider: 'Replicate', supportsImage: true },
  { id: 'seedance-2-fal', label: 'Seedance 2.0 I2V', provider: 'FAL', supportsImage: true, requiresImage: true, supportsEndFrame: true },
  { id: 'seedance-2-omni-fal', label: 'Seedance 2.0 Omni', provider: 'FAL', supportsImage: true, supportsAudio: true },
  { id: 'wan-i2v', label: 'Wan 2.2 I2V Fast', provider: 'Replicate', supportsImage: true, requiresImage: true },
  { id: 'wan-v27-t2v-fal', label: 'WAN 2.7 (Text-to-Video)', provider: 'FAL', supportsImage: false, supportsAudio: true },
  { id: 'wan-v27-i2v-fal', label: 'WAN 2.7 (Image-to-Video)', provider: 'FAL', supportsImage: true, requiresImage: true, supportsAudio: true, supportsEndFrame: true },
  { id: 'happy-horse-t2v-fal', label: 'Happy Horse 1.0 (Text-to-Video)', provider: 'FAL', supportsImage: false },
  { id: 'happy-horse-i2v-fal', label: 'Happy Horse 1.0 (Image-to-Video)', provider: 'FAL', supportsImage: true, requiresImage: true },
  { id: 'kling-26', label: 'Kling 2.6', provider: 'Replicate', supportsImage: true },
  { id: 'kling-25', label: 'Kling 2.5 Turbo', provider: 'Replicate', supportsImage: true, requiresImage: true },
  { id: 'kling-o3-pro-fal', label: 'Kling O3 Pro', provider: 'FAL', supportsImage: true, requiresImage: true },
  { id: 'kling-v3-pro-i2v-fal', label: 'Kling v3 Pro (Image-to-Video)', provider: 'FAL', supportsImage: true, requiresImage: true },
  { id: 'kling-v3-pro-t2v-fal', label: 'Kling v3 Pro (Text-to-Video)', provider: 'FAL', supportsImage: false },
  { id: 'pixverse-c1-ref-fal', label: 'PixVerse C1 Reference', provider: 'FAL', supportsImage: true },
  { id: 'grok-imagine-i2v-fal', label: 'Grok Imagine (Image-to-Video)', provider: 'FAL', supportsImage: true, requiresImage: true },
  { id: 'aurora-fal', label: 'Creatify Aurora (Avatar)', provider: 'FAL', supportsImage: true, requiresImage: true },
  { id: 'kling-motion', label: 'Kling 2.6 Motion Control', provider: 'Replicate', supportsImage: true, requiresImage: true },
  { id: 'ltx', label: 'LTX 2 Fast', provider: 'Replicate', supportsImage: true },
  { id: 'ltx-23-fast', label: 'LTX 2.3 Fast', provider: 'Replicate', supportsImage: true, supportsEndFrame: true },
  { id: 'ltx-23-pro', label: 'LTX 2.3 Pro', provider: 'Replicate', supportsImage: true, supportsAudio: true, supportsEndFrame: true },
  { id: 'ltx-audio', label: 'LTX Audio-to-Video', provider: 'Replicate', supportsImage: true, supportsAudio: true, requiresAudio: true },
  { id: 'p-video', label: 'P-Video', provider: 'Replicate', supportsImage: true, supportsAudio: true },
];

const VIDEO_WORKSPACE_UI_PREFS_KEY = 'video_workspace_ui_prefs_v1';

type VideoWorkspaceUiPrefs = {
  modelId?: VideoModelId;
};

const isVideoModelId = (value: string): value is VideoModelId =>
  MODEL_OPTIONS.some((option) => option.id === value);

const buildWorkspaceUiPrefsScope = (projectPath?: string | null, projectName?: string | null) =>
  (projectPath || projectName || 'default').trim().toLowerCase();

const readVideoWorkspaceUiPrefs = (scope: string): VideoWorkspaceUiPrefs => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(VIDEO_WORKSPACE_UI_PREFS_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, VideoWorkspaceUiPrefs>;
    const scoped = all?.[scope];
    if (!scoped || typeof scoped !== 'object') return {};
    if (typeof scoped.modelId === 'string' && isVideoModelId(scoped.modelId)) {
      return { modelId: scoped.modelId };
    }
    return {};
  } catch {
    return {};
  }
};

const writeVideoWorkspaceUiPrefs = (scope: string, patch: VideoWorkspaceUiPrefs) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(VIDEO_WORKSPACE_UI_PREFS_KEY);
    const all = raw ? JSON.parse(raw) as Record<string, VideoWorkspaceUiPrefs> : {};
    all[scope] = { ...(all[scope] || {}), ...patch };
    window.localStorage.setItem(VIDEO_WORKSPACE_UI_PREFS_KEY, JSON.stringify(all));
  } catch {
    // ignore storage errors
  }
};

const ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3', '21:9', '2.39:1'] as const;
type AspectRatioOption = (typeof ASPECT_RATIOS)[number];
const MODEL_ASPECT_RATIOS: Record<VideoModelId, AspectRatioOption[]> = {
  'veo-fast': ['16:9', '9:16'],
  veo: ['16:9', '9:16'],
  'grok-video': ['16:9', '9:16', '1:1'],
  seedance: ['16:9', '9:16', '1:1'],
  'seedance-2-fal': ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  'seedance-2-omni-fal': ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'],
  'wan-i2v': ['16:9', '9:16'],
  'wan-v27-t2v-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'wan-v27-i2v-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'happy-horse-t2v-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'happy-horse-i2v-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'kling-26': ['16:9', '9:16', '1:1'],
  'kling-25': ['16:9', '9:16', '1:1'],
  'kling-o3-pro-fal': ['16:9', '9:16', '1:1'],
  'kling-v3-pro-i2v-fal': ['16:9', '9:16', '1:1'],
  'kling-v3-pro-t2v-fal': ['16:9', '9:16', '1:1'],
  'pixverse-c1-ref-fal': ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16', '3:2', '2:3'],
  'grok-imagine-i2v-fal': ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'aurora-fal': ['16:9', '9:16', '1:1'],
  'kling-motion': ['16:9', '9:16', '1:1'],
  ltx: ['16:9', '9:16', '1:1', '4:3', '3:4'],
  'ltx-23-fast': ['16:9', '9:16'],
  'ltx-23-pro': ['16:9', '9:16'],
  'ltx-audio': ['16:9'],
  'p-video': ['16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '1:1'],
};

type VideoModelPricing = {
  provider: CostRate['provider'];
  kind: CostRate['kind'];
  model?: string;
};

const VIDEO_MODEL_PRICING: Record<VideoModelId, VideoModelPricing> = {
  'veo-fast': { provider: 'gemini', kind: 'video', model: 'veo-3.1-fast-generate-preview' },
  veo: { provider: 'gemini', kind: 'video', model: 'veo-3.1-generate-preview' },
  'grok-video': { provider: 'xai', kind: 'video', model: 'grok-imagine-video' },
  seedance: { provider: 'replicate', kind: 'video', model: 'bytedance/seedance-1.5-pro' },
  'seedance-2-fal': { provider: 'fal', kind: 'video', model: 'bytedance/seedance-2.0/image-to-video' },
  'seedance-2-omni-fal': { provider: 'fal', kind: 'video', model: 'bytedance/seedance-2.0/reference-to-video' },
  'wan-i2v': { provider: 'replicate', kind: 'video', model: 'wan-video/wan-2.2-i2v-fast' },
  'wan-v27-t2v-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/wan/v2.7/text-to-video' },
  'wan-v27-i2v-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/wan/v2.7/image-to-video' },
  'happy-horse-t2v-fal': { provider: 'fal', kind: 'video', model: 'alibaba/happy-horse/text-to-video' },
  'happy-horse-i2v-fal': { provider: 'fal', kind: 'video', model: 'alibaba/happy-horse/image-to-video' },
  'kling-26': { provider: 'replicate', kind: 'video', model: 'kwaivgi/kling-v2.6' },
  'kling-25': { provider: 'replicate', kind: 'video', model: 'kwaivgi/kling-v2.5-turbo-pro' },
  'kling-o3-pro-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/kling-video/o3/pro/image-to-video' },
  'kling-v3-pro-i2v-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/kling-video/v3/pro/image-to-video' },
  'kling-v3-pro-t2v-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/kling-video/v3/pro/text-to-video' },
  'pixverse-c1-ref-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/pixverse/c1/reference-to-video' },
  'grok-imagine-i2v-fal': { provider: 'fal', kind: 'video', model: 'xai/grok-imagine-video/image-to-video' },
  'aurora-fal': { provider: 'fal', kind: 'video', model: 'fal-ai/creatify/aurora' },
  'kling-motion': { provider: 'replicate', kind: 'video', model: 'kwaivgi/kling-v2.6-motion-control' },
  ltx: { provider: 'replicate', kind: 'video', model: 'lightricks/ltx-2-fast' },
  'ltx-23-fast': { provider: 'replicate', kind: 'video', model: 'lightricks/ltx-2.3-fast' },
  'ltx-23-pro': { provider: 'replicate', kind: 'video', model: 'lightricks/ltx-2.3-pro' },
  'ltx-audio': { provider: 'replicate', kind: 'video', model: 'lightricks/audio-to-video' },
  'p-video': { provider: 'replicate', kind: 'video', model: 'prunaai/p-video' },
};

const VIDEO_DURATION_OPTIONS: Record<VideoModelId, { supported: boolean; options: number[]; fallback: number }> = {
  'veo-fast': { supported: false, options: [5], fallback: 5 },
  veo: { supported: false, options: [5], fallback: 5 },
  'grok-video': { supported: true, options: [3, 5, 8, 10, 12, 15], fallback: 5 },
  seedance: { supported: false, options: [5], fallback: 5 },
  'seedance-2-fal': { supported: true, options: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 10 },
  'seedance-2-omni-fal': { supported: true, options: [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 10 },
  'wan-i2v': { supported: true, options: [3, 5, 8, 10, 12], fallback: 5 },
  'wan-v27-t2v-fal': { supported: true, options: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 5 },
  'wan-v27-i2v-fal': { supported: true, options: [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 5 },
  'happy-horse-t2v-fal': { supported: true, options: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 5 },
  'happy-horse-i2v-fal': { supported: true, options: [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 5 },
  'kling-26': { supported: true, options: [5, 10], fallback: 5 },
  'kling-25': { supported: false, options: [5], fallback: 5 },
  'kling-o3-pro-fal': { supported: true, options: [3, 5, 8, 10, 12, 15], fallback: 5 },
  'kling-v3-pro-i2v-fal': { supported: true, options: [3, 5, 8, 10, 12, 15], fallback: 5 },
  'kling-v3-pro-t2v-fal': { supported: true, options: [3, 5, 8, 10, 12, 15], fallback: 5 },
  'pixverse-c1-ref-fal': { supported: true, options: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], fallback: 5 },
  'grok-imagine-i2v-fal': { supported: true, options: [3, 5, 6, 8, 10, 12, 15], fallback: 6 },
  'aurora-fal': { supported: false, options: [8], fallback: 8 },
  'kling-motion': { supported: false, options: [5], fallback: 5 },
  ltx: { supported: true, options: [6, 8, 10, 12, 14, 16, 18, 20], fallback: 6 },
  'ltx-23-fast': { supported: true, options: [6, 8, 10, 12, 14, 16, 18, 20], fallback: 6 },
  'ltx-23-pro': { supported: true, options: [6, 8, 10], fallback: 6 },
  'ltx-audio': { supported: true, options: [6, 8, 10], fallback: 6 },
  'p-video': { supported: true, options: [1, 2, 3, 4, 5, 6, 8, 10], fallback: 5 },
};

const closestDurationOption = (options: number[], requested: number, fallback: number) => {
  if (!Array.isArray(options) || options.length === 0) return fallback;
  return options.reduce((closest, value) =>
    Math.abs(value - requested) < Math.abs(closest - requested) ? value : closest,
  options[0]);
};

const parseAspectRatioNumber = (ratio: AspectRatioOption | 'auto') => {
  if (ratio === 'auto') return 16 / 9;
  if (ratio.includes(':')) {
    const [left, right] = ratio.split(':').map((value) => Number(value));
    if (Number.isFinite(left) && Number.isFinite(right) && left > 0 && right > 0) {
      return left / right;
    }
  }
  return 16 / 9;
};

const loadImageForStoryboardPanel = async (url: string): Promise<HTMLImageElement> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Could not load storyboard source image (${response.status}).`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Could not decode storyboard source image.'));
    };
    image.src = objectUrl;
  });
};

const drawCoverImage = (
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  width: number,
  height: number,
) => {
  const imageRatio = image.width / Math.max(1, image.height);
  const targetRatio = width / Math.max(1, height);
  let drawWidth = width;
  let drawHeight = height;
  let offsetX = x;
  let offsetY = y;

  if (imageRatio > targetRatio) {
    drawHeight = height;
    drawWidth = height * imageRatio;
    offsetX = x - ((drawWidth - width) / 2);
  } else {
    drawWidth = width;
    drawHeight = width / Math.max(imageRatio, 0.001);
    offsetY = y - ((drawHeight - height) / 2);
  }

  ctx.drawImage(image, offsetX, offsetY, drawWidth, drawHeight);
};

const buildStoryboardCollage = async (
  items: Array<{ url: string; name: string }>,
  aspectRatio: AspectRatioOption | 'auto',
): Promise<{ dataUrl: string; base64: string; mimeType: string }> => {
  const sources = items.filter((item) => !!item.url).slice(0, 9);
  if (sources.length === 0) {
    throw new Error('No storyboard frames available for the collage.');
  }

  const images = await Promise.all(sources.map((item) => loadImageForStoryboardPanel(item.url)));
  const ratio = parseAspectRatioNumber(aspectRatio);
  const isLandscape = ratio >= 1;
  const width = isLandscape ? 2048 : Math.max(1152, Math.round(1792 * ratio));
  const height = isLandscape ? Math.max(1152, Math.round(width / ratio)) : 1792;
  const columns = sources.length <= 2 ? sources.length : sources.length <= 4 ? 2 : 3;
  const rows = Math.ceil(sources.length / columns);
  const padding = Math.round(Math.min(width, height) * 0.035);
  const gap = Math.round(Math.min(width, height) * 0.018);
  const cellWidth = Math.floor((width - (padding * 2) - (gap * (columns - 1))) / columns);
  const cellHeight = Math.floor((height - (padding * 2) - (gap * (rows - 1))) / rows);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Canvas 2D context is not available for the storyboard collage.');
  }

  ctx.fillStyle = '#020617';
  ctx.fillRect(0, 0, width, height);

  images.forEach((image, index) => {
    const col = index % columns;
    const row = Math.floor(index / columns);
    const x = padding + (col * (cellWidth + gap));
    const y = padding + (row * (cellHeight + gap));

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, cellWidth, cellHeight);
    ctx.clip();
    drawCoverImage(ctx, image, x, y, cellWidth, cellHeight);
    ctx.restore();

    ctx.strokeStyle = 'rgba(255,255,255,0.16)';
    ctx.lineWidth = Math.max(2, Math.round(Math.min(width, height) * 0.003));
    ctx.strokeRect(x, y, cellWidth, cellHeight);

    const label = sources[index]?.name || `Frame ${index + 1}`;
    const fontSize = Math.max(18, Math.round(Math.min(width, height) * 0.02));
    ctx.font = `700 ${fontSize}px Arial`;
    const textWidth = Math.ceil(ctx.measureText(label).width);
    const badgeWidth = Math.min(cellWidth - 24, textWidth + 28);
    const badgeHeight = Math.max(30, Math.round(fontSize * 1.8));
    ctx.fillStyle = 'rgba(2, 6, 23, 0.72)';
    ctx.fillRect(x + 12, y + 12, badgeWidth, badgeHeight);
    ctx.fillStyle = '#f8fafc';
    ctx.fillText(label, x + 20, y + 12 + Math.round(badgeHeight * 0.68));
  });

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const [, base64 = ''] = dataUrl.split(',');
  return {
    dataUrl,
    base64,
    mimeType: 'image/jpeg',
  };
};

const dedupeStoryboardSourceItems = (items: Array<{ url: string; name: string }>) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const url = item.url?.trim();
    if (!url || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
};

const VideoGenerationWorkspace: React.FC<VideoGenerationWorkspaceProps> = ({
  onAddGeneratedMedia,
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
  seedImage,
  onConsumeSeed,
}) => {
  const uiPrefsScope = useMemo(
    () => buildWorkspaceUiPrefsScope(currentProjectPath, currentProjectName),
    [currentProjectName, currentProjectPath],
  );
  const storedUiPrefs = useMemo(() => readVideoWorkspaceUiPrefs(uiPrefsScope), [uiPrefsScope]);
  const [modelId, setModelId] = useState<VideoModelId>(() => storedUiPrefs.modelId || 'veo-fast');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('16:9');
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const [referenceUrl, setReferenceUrl] = useState<string | null>(null);
  const [endFrameFile, setEndFrameFile] = useState<File | null>(null);
  const [endFrameUrl, setEndFrameUrl] = useState<string | null>(null);
  const [motionReferenceFile, setMotionReferenceFile] = useState<File | null>(null);
  const [motionReferenceUrl, setMotionReferenceUrl] = useState<string | null>(null);
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [elementsInput, setElementsInput] = useState('');
  const [elements, setElements] = useState<string[]>([]);
  const [elementReferenceAssets, setElementReferenceAssets] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [storyboardReferenceAssets, setStoryboardReferenceAssets] = useState<Array<{ id: string; name: string; url: string }>>([]);
  const [videoDurationSeconds, setVideoDurationSeconds] = useState<number>(5);
  const [ltxResolution, setLtxResolution] = useState<'1080p' | '2k' | '4k'>('1080p');
  const [ltxFps, setLtxFps] = useState<24 | 25 | 48 | 50>(24);
  const [ltxCameraMotion, setLtxCameraMotion] = useState<'none' | 'low' | 'medium' | 'high'>('medium');
  const [ltxGenerateAudio, setLtxGenerateAudio] = useState<boolean>(true);
  const [ltxAudioResolution, setLtxAudioResolution] = useState<'720p' | '1080p' | '1440p' | '2160p'>('1080p');
  const [pVideoResolution, setPVideoResolution] = useState<'720p' | '1080p'>('720p');
  const [pVideoFps, setPVideoFps] = useState<24 | 48>(24);
  const [pVideoDraftMode, setPVideoDraftMode] = useState<boolean>(false);
  const [pVideoPromptUpsampling, setPVideoPromptUpsampling] = useState<boolean>(true);
  const [seedanceGenerateAudio, setSeedanceGenerateAudio] = useState<boolean>(true);
  const [seedanceOmniGenerateAudio, setSeedanceOmniGenerateAudio] = useState<boolean>(true);
  const [pixverseGenerateAudio, setPixverseGenerateAudio] = useState<boolean>(false);
  const [klingGenerateAudio, setKlingGenerateAudio] = useState<boolean>(true);
  const [klingShotType, setKlingShotType] = useState<'static' | 'dynamic' | 'customize' | 'intelligent'>('dynamic');
  const [klingNegativePrompt, setKlingNegativePrompt] = useState<string>('');
  const [klingCfgScale, setKlingCfgScale] = useState<number>(0.5);
  const [klingVoiceIdsText, setKlingVoiceIdsText] = useState<string>('');
  const [klingMultiPromptText, setKlingMultiPromptText] = useState<string>('');
  const [klingUseReferenceVideoForO3, setKlingUseReferenceVideoForO3] = useState<boolean>(false);
  const [status, setStatus] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generated, setGenerated] = useState<MediaItem[]>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [libraryFrameTarget, setLibraryFrameTarget] = useState<'start' | 'end'>('start');
  const [assetPreview, setAssetPreview] = useState<{ url: string; kind: 'image' | 'video'; title?: string } | null>(null);
  const [guidesOpen, setGuidesOpen] = useState(false);

  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const modelOption = useMemo(() => MODEL_OPTIONS.find((option) => option.id === modelId), [modelId]);
  const readyForGeneration = apiKeyReady !== false;
  const availableAspectRatios = MODEL_ASPECT_RATIOS[modelId] || ASPECT_RATIOS;
  const supportsVeoElements = modelId === 'veo-fast' || modelId === 'veo';
  const supportsKlingAdvanced = modelId === 'kling-o3-pro-fal' || modelId === 'kling-v3-pro-i2v-fal' || modelId === 'kling-v3-pro-t2v-fal';
  const supportsStoryboardRefs = modelId === 'seedance' || modelId === 'seedance-2-fal' || modelId === 'seedance-2-omni-fal' || modelId === 'pixverse-c1-ref-fal';
  const usesStoryboardCollageFallback = modelId === 'seedance' || modelId === 'seedance-2-fal';
  const supportsElements = supportsVeoElements || supportsKlingAdvanced;
  const needsMotionRef = modelId === 'kling-motion' || (modelId === 'kling-o3-pro-fal' && klingUseReferenceVideoForO3);
  const supportsMotionReference = needsMotionRef || modelId === 'kling-o3-pro-fal' || modelId === 'seedance-2-omni-fal';
  const needsAudio = modelOption?.requiresAudio === true || modelId === 'aurora-fal';
  const supportsAudioInput = modelOption?.supportsAudio === true || modelId === 'aurora-fal';
  const supportsEndFrame = modelOption?.supportsEndFrame === true || supportsKlingAdvanced;
  const durationConfig = VIDEO_DURATION_OPTIONS[modelId];
  const hasPrompt = prompt.trim().length > 0;
  const hasStartFrame = Boolean(referenceFile || referenceUrl);
  const hasEndFrame = Boolean(endFrameFile || endFrameUrl);
  const hasMotionReference = Boolean(motionReferenceFile || motionReferenceUrl);
  const hasAudioTrack = Boolean(audioFile);
  const hasStoryboardReferences = storyboardReferenceAssets.length > 0;
  const hasRequiredImageReference = hasStartFrame || (supportsStoryboardRefs && hasStoryboardReferences);
  const hasSeedanceOmniReference = hasStartFrame || hasMotionReference || hasStoryboardReferences;
  const normalizedDurationSeconds = durationConfig.supported
    ? closestDurationOption(durationConfig.options, Number(videoDurationSeconds) || durationConfig.fallback, durationConfig.fallback)
    : durationConfig.fallback;
  const estimatedDurationSeconds = useMemo(() => {
    return normalizedDurationSeconds;
  }, [normalizedDurationSeconds]);
  const generationCostEstimate = useMemo(() => {
    const pricing = VIDEO_MODEL_PRICING[modelId];
    if (!pricing) return null;
    return estimateGenerationCost({
      rates: costRates,
      provider: pricing.provider,
      kind: pricing.kind,
      model: pricing.model,
      units: estimatedDurationSeconds,
    });
  }, [costRates, estimatedDurationSeconds, modelId]);
  const generationCostDetail = useMemo(() => {
    if (!generationCostEstimate) return 'No price mapping found for the selected model.';
    const base = `Based on ${formatUnitSummary(generationCostEstimate.units, generationCostEstimate.unitLabel)}.`;
    if (needsAudio) return `${base} Final cost can vary with uploaded audio length.`;
    if (modelId === 'pixverse-c1-ref-fal' && pixverseGenerateAudio) {
      return `${base} PixVerse audio generation can increase the final provider cost above the base 720p estimate.`;
    }
    return base;
  }, [generationCostEstimate, modelId, needsAudio, pixverseGenerateAudio]);
  const selectedModelBadges = useMemo(() => {
    const durationLabel = durationConfig.supported
      ? `${durationConfig.options[0]}-${durationConfig.options[durationConfig.options.length - 1]}s`
      : `${durationConfig.fallback}s fixed`;
    const badges = [modelOption?.provider || 'Provider', durationLabel];
    if (modelOption?.requiresImage) {
      badges.push('Start frame required');
    } else if (modelOption?.supportsImage === false) {
      badges.push('Prompt only');
    } else {
      badges.push('Start frame optional');
    }
    if (supportsEndFrame) badges.push('End frame');
    if (needsAudio) {
      badges.push('Audio required');
    } else if (supportsAudioInput) {
      badges.push('Audio optional');
    }
    if (modelId === 'happy-horse-t2v-fal' || modelId === 'happy-horse-i2v-fal') {
      badges.push('Native audio');
    }
    return badges;
  }, [durationConfig, modelId, modelOption, needsAudio, supportsAudioInput, supportsEndFrame]);
  const selectedModelGuidance = useMemo(() => {
    if (!modelOption) return 'Select a model to see required inputs before you generate.';
    if (modelId === 'happy-horse-t2v-fal') {
      return 'Generates 1080p video with native audio from text; use clear shot timing when you want a controlled sequence.';
    }
    if (modelId === 'happy-horse-i2v-fal') {
      return 'Uses your start frame as the first frame, so choose a clean image that already has the composition you want.';
    }
    if (modelOption.requiresImage && supportsEndFrame) {
      return 'Add a start frame; add an end frame only when the final composition needs to land on a specific image.';
    }
    if (modelOption.requiresImage) return 'Add a start frame before generating.';
    if (modelOption.supportsImage === false) return 'Prompt-only model: frame guides are ignored for this engine.';
    if (supportsAudioInput) return 'A prompt is enough; add a frame or audio track only when you need tighter control.';
    return 'A prompt is enough for the first pass. Add a frame when composition or character continuity matters.';
  }, [modelId, modelOption, supportsAudioInput, supportsEndFrame]);
  const generationReadinessItems = useMemo<GenerationReadinessItem[]>(() => {
    const items: GenerationReadinessItem[] = [
      {
        label: 'Prompt',
        detail: hasPrompt ? `${Math.min(prompt.trim().length, 2500)} chars ready` : 'Add the scene description',
        state: hasPrompt ? 'ready' : 'needed',
      },
      {
        label: 'Engine',
        detail: modelOption?.label || 'Choose model',
        state: modelOption ? 'ready' : 'needed',
      },
    ];

    if (modelId === 'seedance-2-omni-fal') {
      items.push({
        label: 'Reference',
        detail: hasSeedanceOmniReference ? 'Reference attached' : 'Add image, video, or storyboard ref',
        state: hasSeedanceOmniReference ? 'ready' : 'needed',
      });
    } else if (modelId === 'seedance-2-fal' || modelId === 'pixverse-c1-ref-fal' || modelOption?.requiresImage) {
      items.push({
        label: 'Start frame',
        detail: hasRequiredImageReference ? 'Image guide ready' : 'Required for this engine',
        state: hasRequiredImageReference ? 'ready' : 'needed',
      });
    } else if (modelOption?.supportsImage === false) {
      items.push({
        label: 'Frame guide',
        detail: 'Not used by this engine',
        state: 'optional',
      });
    } else {
      items.push({
        label: 'Frame guide',
        detail: hasStartFrame ? 'Start frame attached' : 'Optional',
        state: hasStartFrame ? 'ready' : 'optional',
      });
    }

    if (supportsEndFrame) {
      items.push({
        label: 'End frame',
        detail: hasEndFrame ? 'End frame attached' : 'Optional landing frame',
        state: hasEndFrame ? 'ready' : 'optional',
      });
    }

    if (supportsMotionReference) {
      const requiredMotion = needsMotionRef;
      items.push({
        label: modelId === 'seedance-2-omni-fal' ? 'Ref video' : 'Motion ref',
        detail: hasMotionReference ? 'Video reference attached' : requiredMotion ? 'Required for this mode' : 'Optional',
        state: hasMotionReference ? 'ready' : requiredMotion ? 'needed' : 'optional',
      });
    }

    if (supportsAudioInput) {
      items.push({
        label: 'Audio',
        detail: hasAudioTrack ? 'Audio attached' : needsAudio ? 'Required for this engine' : 'Optional',
        state: hasAudioTrack ? 'ready' : needsAudio ? 'needed' : 'optional',
      });
    }

    items.push({
      label: 'API',
      detail: readyForGeneration ? 'Keys connected' : 'Connect API keys',
      state: readyForGeneration ? 'ready' : 'needed',
    });

    if (generationCostEstimate) {
      items.push({
        label: 'Cost',
        detail: billingMode === 'byok'
          ? `${formatUsd(generationCostEstimate.providerUsd)} provider`
          : `${generationCostEstimate.credits} credits`,
        state: 'ready',
      });
    } else {
      items.push({
        label: 'Cost',
        detail: 'Estimate unavailable',
        state: 'optional',
      });
    }

    return items;
  }, [
    billingMode,
    generationCostEstimate,
    hasAudioTrack,
    hasEndFrame,
    hasMotionReference,
    hasPrompt,
    hasRequiredImageReference,
    hasSeedanceOmniReference,
    hasStartFrame,
    modelId,
    modelOption,
    needsAudio,
    needsMotionRef,
    prompt,
    readyForGeneration,
    supportsAudioInput,
    supportsEndFrame,
    supportsMotionReference,
  ]);
  const generationBlockers = useMemo(
    () => generationReadinessItems.filter((item) => item.state === 'needed'),
    [generationReadinessItems],
  );
  const generationGuideBlockers = useMemo(
    () => generationBlockers.filter((item) => REQUIRED_GUIDE_READINESS_LABELS.has(item.label)),
    [generationBlockers],
  );
  const guideDisclosureStatus = generationGuideBlockers.length > 0
    ? `${generationGuideBlockers.length} required`
    : supportsElements || supportsEndFrame || supportsMotionReference || supportsAudioInput || supportsStoryboardRefs
      ? 'Controls ready'
      : 'Optional';
  const canStartGeneration = generationBlockers.length === 0 && !isGenerating;

  const referencePreviewUrl = useMemo(() => {
    if (referenceFile) return URL.createObjectURL(referenceFile);
    return referenceUrl;
  }, [referenceFile, referenceUrl]);

  const endFramePreviewUrl = useMemo(() => {
    if (endFrameFile) return URL.createObjectURL(endFrameFile);
    return endFrameUrl;
  }, [endFrameFile, endFrameUrl]);

  const motionReferencePreviewUrl = useMemo(() => {
    if (motionReferenceFile) return URL.createObjectURL(motionReferenceFile);
    return motionReferenceUrl;
  }, [motionReferenceFile, motionReferenceUrl]);

  const audioPreviewUrl = useMemo(() => {
    if (audioFile) return URL.createObjectURL(audioFile);
    return null;
  }, [audioFile]);

  useEffect(() => {
    return () => {
      if (referenceFile && referencePreviewUrl) {
        URL.revokeObjectURL(referencePreviewUrl);
      }
    };
  }, [referenceFile, referencePreviewUrl]);

  useEffect(() => {
    return () => {
      if (endFrameFile && endFramePreviewUrl) {
        URL.revokeObjectURL(endFramePreviewUrl);
      }
    };
  }, [endFrameFile, endFramePreviewUrl]);

  useEffect(() => {
    return () => {
      if (motionReferenceFile && motionReferencePreviewUrl) {
        URL.revokeObjectURL(motionReferencePreviewUrl);
      }
    };
  }, [motionReferenceFile, motionReferencePreviewUrl]);

  useEffect(() => {
    return () => {
      if (audioFile && audioPreviewUrl) {
        URL.revokeObjectURL(audioPreviewUrl);
      }
    };
  }, [audioFile, audioPreviewUrl]);

  useEffect(() => {
    if (generationGuideBlockers.length > 0) {
      setGuidesOpen(true);
    }
  }, [generationGuideBlockers.length, modelId]);

  useEffect(() => {
    const prefs = readVideoWorkspaceUiPrefs(uiPrefsScope);
    if (prefs.modelId) {
      setModelId(prefs.modelId);
    }
  }, [uiPrefsScope]);

  useEffect(() => {
    writeVideoWorkspaceUiPrefs(uiPrefsScope, { modelId });
  }, [modelId, uiPrefsScope]);

  useEffect(() => {
    if (!availableAspectRatios.includes(aspectRatio)) {
      setAspectRatio(availableAspectRatios[0]);
    }
  }, [availableAspectRatios, aspectRatio]);

  useEffect(() => {
    const config = VIDEO_DURATION_OPTIONS[modelId];
    if (!config) return;
    const nextValue = config.supported
      ? closestDurationOption(config.options, Number(videoDurationSeconds) || config.fallback, config.fallback)
      : config.fallback;
    if (nextValue !== videoDurationSeconds) {
      setVideoDurationSeconds(nextValue);
    }
  }, [modelId, videoDurationSeconds]);

  useEffect(() => {
    if (!seedImage?.url) return;
    setReferenceUrl(seedImage.url);
    setReferenceFile(null);
    onConsumeSeed?.();
  }, [seedImage, onConsumeSeed]);

  const handleGenerate = async () => {
    const parseKlingMultiPrompt = (value: string): Array<{ prompt: string; duration?: number }> => {
      const lines = (value || '')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);
      return lines
        .map((line) => {
          const durationMatch = line.match(/^(\d+(?:\.\d+)?)\s*[\|:]\s*(.+)$/);
          if (durationMatch) {
            const duration = Number(durationMatch[1]);
            const prompt = durationMatch[2].trim();
            return {
              prompt,
              duration: Number.isFinite(duration) && duration > 0 ? duration : undefined,
            };
          }
          return { prompt: line };
        })
        .filter((entry) => !!entry.prompt);
    };
    const parseCsvIds = (value: string) =>
      (value || '')
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean);

    if (!prompt.trim()) {
      setStatus('Please enter a prompt.');
      return;
    }
    if (billingMode === 'hosted' && onValidateHostedGeneration) {
      const pricing = VIDEO_MODEL_PRICING[modelId];
      if (pricing) {
        const validation = await onValidateHostedGeneration({
          provider: pricing.provider,
          kind: pricing.kind,
          model: pricing.model,
          units: generationCostEstimate?.units || estimatedDurationSeconds,
          credits: generationCostEstimate?.credits,
        });
        if (!validation.ok) {
          setStatus(validation.message || 'Hosted generation blocked by billing guardrail.');
          return;
        }
      }
    }
    if (!readyForGeneration) {
      setStatus('Connect your API keys to generate video.');
      return;
    }
    if (modelOption?.requiresImage && !referenceFile && !referenceUrl && !(supportsStoryboardRefs && storyboardReferenceAssets.length > 0)) {
      setStatus(`${modelOption.label} requires a reference image.`);
      return;
    }
    if (modelId === 'seedance-2-fal' && !referenceFile && !referenceUrl && storyboardReferenceAssets.length === 0) {
      setStatus('Seedance 2.0 I2V requires a start frame or storyboard references.');
      return;
    }
    if (modelId === 'seedance-2-omni-fal' && !referenceFile && !referenceUrl && !motionReferenceFile && !motionReferenceUrl && storyboardReferenceAssets.length === 0) {
      setStatus('Seedance 2.0 Omni requires at least one image or video reference.');
      return;
    }
    if (modelId === 'pixverse-c1-ref-fal' && !referenceFile && !referenceUrl && storyboardReferenceAssets.length === 0) {
      setStatus('PixVerse C1 Reference requires at least one image reference.');
      return;
    }
    if (needsAudio && !audioFile) {
      setStatus(`${modelOption?.label || 'This model'} requires an audio track.`);
      return;
    }
    if (needsMotionRef && !motionReferenceFile && !motionReferenceUrl) {
      setStatus('Kling Motion Control requires a reference video.');
      return;
    }

    setIsGenerating(true);
    setStatus('Starting video generation...');
    try {
      const allowFrameGuides = modelOption?.supportsImage !== false;
      const reference = allowFrameGuides && referenceFile
        ? {
          base64: await fileToBase64(referenceFile),
          mimeType: referenceFile.type || 'image/png',
        }
        : allowFrameGuides && referenceUrl
          ? await getBase64FromUrl(referenceUrl)
          : undefined;
      const endFrameReference = allowFrameGuides && endFrameFile
        ? {
          base64: await fileToBase64(endFrameFile),
          mimeType: endFrameFile.type || 'image/png',
        }
        : allowFrameGuides && endFrameUrl
          ? await getBase64FromUrl(endFrameUrl)
          : undefined;
      const motionReference = motionReferenceFile
        ? {
          base64: await fileToBase64(motionReferenceFile),
          mimeType: motionReferenceFile.type || 'video/mp4',
        }
        : motionReferenceUrl
          ? await getBase64FromUrl(motionReferenceUrl)
          : undefined;
      const audioReference = needsAudio && audioFile
        ? {
          base64: await fileToBase64(audioFile),
          mimeType: audioFile.type || 'audio/mpeg',
        }
        : undefined;
      const optionalAudioReference = !needsAudio && supportsAudioInput && audioFile
        ? {
          base64: await fileToBase64(audioFile),
          mimeType: audioFile.type || 'audio/mpeg',
        }
        : undefined;
      const primaryReferenceSourceUrl = allowFrameGuides ? (referencePreviewUrl || referenceUrl || '') : '';
      const storyboardSourceItems = supportsStoryboardRefs
        ? dedupeStoryboardSourceItems([
          ...(primaryReferenceSourceUrl ? [{ url: primaryReferenceSourceUrl, name: 'Start frame' }] : []),
          ...storyboardReferenceAssets.map((item, index) => ({
            url: item.url,
            name: item.name || `Storyboard ${index + 1}`,
          })),
        ])
        : [];
      const storyboardReferencePayloads = storyboardSourceItems.length > 0
        ? await Promise.all(storyboardSourceItems.map((item) => (
          reference && item.url === primaryReferenceSourceUrl
            ? Promise.resolve(reference)
            : getBase64FromUrl(item.url)
        )))
        : [];
      const storyboardCollageReference = usesStoryboardCollageFallback && storyboardSourceItems.length > 1
        ? await buildStoryboardCollage(
          storyboardSourceItems,
          availableAspectRatios.includes(aspectRatio) ? aspectRatio : 'auto',
        )
        : undefined;
      const seedanceStoryboardReference = usesStoryboardCollageFallback
        ? (storyboardCollageReference
          ? { base64: storyboardCollageReference.base64, mimeType: storyboardCollageReference.mimeType }
          : reference || storyboardReferencePayloads[0])
        : reference;
      const pixverseImageReferences = dedupeStoryboardSourceItems([
        ...(primaryReferenceSourceUrl ? [{ url: primaryReferenceSourceUrl, name: 'subject' }] : []),
        ...storyboardReferenceAssets.map((item, index) => ({
          url: item.url,
          name: item.name || `Reference ${index + 1}`,
        })),
      ]).slice(0, 4);
      const veoElementReferences = supportsVeoElements && elementReferenceAssets.length > 0
        ? await Promise.all(
          elementReferenceAssets.slice(0, 3).map((item) => getBase64FromUrl(item.url))
        )
        : [];
      const elementHint = supportsVeoElements && elements.length > 0
        ? `Include elements: ${elements.join(', ')}.`
        : '';
      const elementReferenceHint = supportsVeoElements && elementReferenceAssets.length > 0
        ? `Element reference anchors: ${elementReferenceAssets.slice(0, 3).map((item, index) => `${index + 1}) ${item.name}`).join('; ')}.`
        : '';
      const klingMultiPrompt = parseKlingMultiPrompt(klingMultiPromptText);
      const klingVoiceIds = parseCsvIds(klingVoiceIdsText);
      const klingElements = supportsKlingAdvanced && elements.length > 0
        ? elements.map((entry) => ({ type: 'text' as const, prompt: entry }))
        : undefined;
      const endFrameHint = endFrameReference
        ? 'End frame reference provided; match the ending composition and lighting.'
        : '';
      const finalPrompt = [prompt.trim(), elementHint, elementReferenceHint, endFrameHint].filter(Boolean).join(' ');
      const veoStartReference = reference || veoElementReferences[0];

      let item: MediaItem;
      switch (modelId) {
        case 'veo-fast':
          item = await generateVideoWithVeo(
            finalPrompt,
            (message) => setStatus(message),
            availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16') : '16:9',
            veoStartReference,
            'veo-3.1-fast-generate-preview'
          );
          break;
        case 'veo':
          item = await generateVideoWithVeo(
            finalPrompt,
            (message) => setStatus(message),
            availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16') : '16:9',
            veoStartReference,
            'veo-3.1-generate-preview'
          );
          break;
        case 'grok-video': {
          const publicReferenceUrl = referenceUrl && /^https?:\/\//.test(referenceUrl) ? referenceUrl : undefined;
          item = await generateVideoWithGrok({
            prompt: finalPrompt,
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1') : '16:9',
            resolution: '720p',
            imageUrl: publicReferenceUrl,
            onProgress: (message) => setStatus(message),
          });
          break;
        }
        case 'seedance':
          item = await generateVideoWithSeedance(finalPrompt, seedanceStoryboardReference);
          break;
        case 'seedance-2-fal':
          if (!seedanceStoryboardReference) throw new Error('Seedance 2.0 requires a start frame or storyboard reference.');
          item = await generateVideoWithFalSeedanceImage(finalPrompt, seedanceStoryboardReference, {
            endImage: endFrameReference,
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16') : 'auto',
            resolution: '720p',
            generateAudio: seedanceGenerateAudio,
          });
          break;
        case 'seedance-2-omni-fal':
          item = await generateVideoWithFalSeedanceReference(finalPrompt, {
            images: storyboardReferencePayloads.length > 0 ? storyboardReferencePayloads.slice(0, 9) : undefined,
            videos: motionReference ? [motionReference] : undefined,
            audios: optionalAudioReference ? [optionalAudioReference] : undefined,
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as 'auto' | '21:9' | '16:9' | '4:3' | '1:1' | '3:4' | '9:16') : 'auto',
            resolution: '720p',
            generateAudio: seedanceOmniGenerateAudio,
          });
          break;
        case 'wan-i2v':
          if (!reference) throw new Error('Wan I2V requires a reference image.');
          item = await generateVideoWithWanI2V(finalPrompt, reference, {
            fps: 16,
            numFrames: Math.max(33, Math.round(normalizedDurationSeconds * 16) + 1),
          });
          break;
        case 'wan-v27-t2v-fal':
          item = await generateVideoWithFalWanV27Text(finalPrompt, {
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4') : '16:9',
            resolution: '1080p',
            audio: optionalAudioReference,
          });
          break;
        case 'wan-v27-i2v-fal':
          if (!reference) throw new Error('WAN 2.7 I2V requires a reference image.');
          item = await generateVideoWithFalWanV27Image(finalPrompt, reference, {
            endImage: endFrameReference,
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4') : '16:9',
            resolution: '1080p',
            audio: optionalAudioReference,
          });
          break;
        case 'happy-horse-t2v-fal':
          item = await generateVideoWithFalHappyHorseText(finalPrompt, {
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4') : '16:9',
            resolution: '1080p',
          });
          break;
        case 'happy-horse-i2v-fal':
          if (!reference) throw new Error('Happy Horse I2V requires a reference image.');
          item = await generateVideoWithFalHappyHorseImage(finalPrompt, reference, {
            duration: normalizedDurationSeconds,
            resolution: '1080p',
          });
          break;
        case 'kling-26':
          item = await generateVideoWithKling26(finalPrompt, {
            startImage: reference,
            aspectRatio: aspectRatio as any,
            duration: normalizedDurationSeconds >= 8 ? 10 : 5,
            generateAudio: true,
          });
          break;
        case 'kling-25':
          if (!reference) throw new Error('Kling 2.5 requires a reference image.');
          item = await generateVideoWithKling(finalPrompt, reference);
          break;
        case 'kling-o3-pro-fal':
          if (!reference) throw new Error('Kling O3 Pro requires a reference image.');
          if (klingUseReferenceVideoForO3 && !motionReference) {
            throw new Error('Kling O3 reference mode requires a reference video.');
          }
          item = await generateVideoWithFalKlingO3(finalPrompt, reference, {
            endImage: endFrameReference,
            duration: normalizedDurationSeconds,
            generateAudio: klingGenerateAudio,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1') : '16:9',
            multiPrompt: klingMultiPrompt.length > 0 ? klingMultiPrompt : undefined,
            shotType: klingShotType === 'static' ? 'static' : 'dynamic',
            elements: klingElements,
            referenceVideo: klingUseReferenceVideoForO3 ? motionReference : undefined,
          });
          break;
        case 'kling-v3-pro-i2v-fal':
          if (!reference) throw new Error('Kling v3 Pro (Image-to-Video) requires a reference image.');
          item = await generateVideoWithFalKlingV3Image(finalPrompt, reference, {
            endImage: endFrameReference,
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1') : '16:9',
            generateAudio: klingGenerateAudio,
            negativePrompt: klingNegativePrompt.trim() || undefined,
            cfgScale: Number.isFinite(klingCfgScale) ? klingCfgScale : 0.5,
            voiceIds: klingVoiceIds.length > 0 ? klingVoiceIds : undefined,
            multiPrompt: klingMultiPrompt.length > 0 ? klingMultiPrompt : undefined,
            shotType: klingShotType,
            elements: klingElements,
          });
          break;
        case 'kling-v3-pro-t2v-fal':
          item = await generateVideoWithFalKlingV3Text(finalPrompt, {
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1') : '16:9',
            generateAudio: klingGenerateAudio,
            negativePrompt: klingNegativePrompt.trim() || undefined,
            cfgScale: Number.isFinite(klingCfgScale) ? klingCfgScale : 0.5,
            voiceIds: klingVoiceIds.length > 0 ? klingVoiceIds : undefined,
            multiPrompt: klingMultiPrompt.length > 0 ? klingMultiPrompt : undefined,
            shotType: klingShotType,
            elements: klingElements,
          });
          break;
        case 'pixverse-c1-ref-fal':
          if (pixverseImageReferences.length === 0) {
            throw new Error('PixVerse C1 Reference requires a start frame or storyboard references.');
          }
          item = await generateVideoWithFalPixverseC1Reference(
            finalPrompt,
            await Promise.all(pixverseImageReferences.map(async (entry, index) => ({
              refName: index === 0 ? 'subject' : `background_${index}`,
              type: index === 0 ? 'subject' as const : 'background' as const,
              image: reference && entry.url === primaryReferenceSourceUrl
                ? reference
                : await getBase64FromUrl(entry.url),
            }))),
            {
              duration: normalizedDurationSeconds,
              aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4' | '3:2' | '2:3' | '21:9') : '16:9',
              resolution: '720p',
              generateAudio: pixverseGenerateAudio,
            },
          );
          break;
        case 'grok-imagine-i2v-fal':
          if (!reference) throw new Error('Grok Imagine I2V requires a reference image.');
          item = await generateVideoWithFalGrokImagineI2V(finalPrompt, reference, {
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '1:1' | '4:3' | '3:4') : '16:9',
            resolution: '720p',
          });
          break;
        case 'aurora-fal':
          if (!reference) throw new Error('Creatify Aurora requires a reference image.');
          if (!audioReference) throw new Error('Creatify Aurora requires an audio track.');
          item = await generateVideoWithFalCreatifyAurora(reference, audioReference, {
            prompt: finalPrompt,
            resolution: '720p',
          });
          break;
        case 'kling-motion':
          if (!reference || !motionReference) throw new Error('Kling Motion Control requires image + video.');
          item = await generateVideoWithKlingMotionControl(finalPrompt, reference, motionReference, {
            mode: 'std',
            characterOrientation: 'image',
            keepOriginalSound: false,
          });
          break;
        case 'ltx':
          item = await generateVideoWithLtx(finalPrompt, {
            image: reference,
            duration: normalizedDurationSeconds as 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20,
            resolution: '1080p',
            generateAudio: true,
          });
          break;
        case 'ltx-23-fast':
          item = await generateVideoWithLtx23Fast(finalPrompt, {
            image: reference,
            lastFrameImage: supportsEndFrame ? endFrameReference : undefined,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16') : '16:9',
            duration: normalizedDurationSeconds as 6 | 8 | 10 | 12 | 14 | 16 | 18 | 20,
            resolution: ltxResolution,
            fps: ltxFps,
          });
          break;
        case 'ltx-23-pro':
          item = await generateVideoWithLtx23Pro(finalPrompt, {
            image: reference,
            lastFrameImage: supportsEndFrame ? endFrameReference : undefined,
            audio: optionalAudioReference,
            task: optionalAudioReference ? 'audio_to_video' : reference ? 'image_to_video' : 'text_to_video',
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16') : '16:9',
            duration: normalizedDurationSeconds as 6 | 8 | 10,
            resolution: ltxResolution,
            fps: ltxFps,
            cameraMotion: ltxCameraMotion,
            generateAudio: ltxGenerateAudio,
          });
          break;
        case 'ltx-audio':
          if (!audioReference) throw new Error('LTX Audio-to-Video requires an audio file.');
          item = await generateVideoWithLtxAudioToVideo(audioReference, {
            prompt: finalPrompt,
            image: reference,
            duration: normalizedDurationSeconds as 6 | 8 | 10,
            resolution: ltxAudioResolution,
          });
          break;
        case 'p-video':
          item = await generateVideoWithPVideo(finalPrompt, {
            image: reference,
            audio: optionalAudioReference,
            duration: normalizedDurationSeconds,
            aspectRatio: availableAspectRatios.includes(aspectRatio) ? (aspectRatio as '16:9' | '9:16' | '4:3' | '3:4' | '3:2' | '2:3' | '1:1') : '16:9',
            resolution: pVideoResolution,
            fps: pVideoFps,
            draftMode: pVideoDraftMode,
            promptUpsampling: pVideoPromptUpsampling,
          });
          break;
        default:
          throw new Error('Unsupported model selection.');
      }

      const itemWithMeta = { ...item, generatedBy: modelOption?.label };
      onAddGeneratedMedia(itemWithMeta);
      setGenerated((prev) => [itemWithMeta, ...prev].slice(0, 12));
      setStatus('Video generated and added to your project.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Video generation failed.');
    } finally {
      setIsGenerating(false);
    }
  };

  const latestResults = useMemo(() => {
    const projectVideos = mediaItems.filter((item) => item.type === 'video');
    const combined = [...generated, ...projectVideos];
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
      if (term && !asset.name.toLowerCase().includes(term) && !asset.projectName.toLowerCase().includes(term)) {
        return false;
      }
      return true;
    });
  }, [libraryAssets, librarySearch]);

  return (
    <div className="studio-workspace p-6 h-full overflow-auto">
      <div className="max-w-7xl mx-auto space-y-6">
        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <section className="app-panel p-6 space-y-5">
            <div className="workspace-hero">
              <div className="workspace-hero__content">
                <div className="workspace-hero__eyebrow">AI video generation</div>
                <h2 className="workspace-hero__title">Create Videos</h2>
                <p className="workspace-hero__body">
                  Compose the scene, choose the engine, then add only the guides the model needs.
                </p>
              </div>
              <div className="workspace-hero__icon apple-symbol">
                <VideoIcon className="w-6 h-6" />
              </div>
              <div className="workspace-stat-grid">
                <div className="workspace-stat">
                  <VideoIcon className="workspace-stat__icon" />
                  <div>
                    <div className="workspace-stat__value">{modelOption?.label || 'Model'}</div>
                    <div className="workspace-stat__label">Engine</div>
                  </div>
                </div>
                <div className="workspace-stat">
                  <SparklesIcon className="workspace-stat__icon" />
                  <div>
                    <div className="workspace-stat__value">{normalizedDurationSeconds}s</div>
                    <div className="workspace-stat__label">Duration</div>
                  </div>
                </div>
                <div className="workspace-stat">
                  <UploadIcon className="workspace-stat__icon" />
                  <div>
                    <div className="workspace-stat__value">{aspectRatio}</div>
                    <div className="workspace-stat__label">Format</div>
                  </div>
                </div>
                <div className="workspace-stat">
                  <SparklesIcon className="workspace-stat__icon" />
                  <div>
                    <div className="workspace-stat__value">
                      {generationBlockers.length === 0 ? 'Ready' : `${generationBlockers.length} needed`}
                    </div>
                    <div className="workspace-stat__label">Readiness</div>
                  </div>
                </div>
              </div>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.9fr)]">
              <div className="app-card p-5 space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.12em] text-gray-500">Main Idea</div>
                  <p className="mt-1 text-sm text-gray-400">
                    Write what should happen in the clip. This should be enough for a first result.
                  </p>
                </div>
                <div>
                  <label className="text-xs uppercase tracking-[0.12em] text-gray-500">What Should The Video Show?</label>
                  <textarea
                    value={prompt}
                    onChange={(event) => setPrompt(event.target.value)}
                    placeholder="Describe the action, subject, mood, and camera feel..."
                    className="app-textarea mt-2 h-32"
                  />
                </div>
              </div>

              <div className="app-card p-5 space-y-4">
                <div>
                  <div className="text-xs uppercase tracking-[0.12em] text-gray-500">Quick Setup</div>
                  <p className="mt-1 text-sm text-gray-400">
                    Choose the engine, clip format, and duration. Model-specific controls stay below.
                  </p>
                </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Video Engine</label>
                <select
                  value={modelId}
                  onChange={(event) => setModelId(event.target.value as VideoModelId)}
                  className="app-select mt-2"
                >
                  <optgroup label="Google">
                    <option value="veo-fast">Veo 3.1 Fast</option>
                    <option value="veo">Veo 3.1 (HQ)</option>
                  </optgroup>
                  <optgroup label="xAI / Grok">
                    <option value="grok-video">Grok Imagine Video</option>
                    <option value="grok-imagine-i2v-fal">Grok Imagine I2V (FAL)</option>
                  </optgroup>
                  <optgroup label="FAL / Alibaba">
                    <option value="happy-horse-t2v-fal">Happy Horse 1.0 T2V</option>
                    <option value="happy-horse-i2v-fal">Happy Horse 1.0 I2V</option>
                    <option value="wan-v27-t2v-fal">WAN 2.7 T2V</option>
                    <option value="wan-v27-i2v-fal">WAN 2.7 I2V</option>
                  </optgroup>
                  <optgroup label="Kling">
                    <option value="kling-26">Kling 2.6</option>
                    <option value="kling-25">Kling 2.5 Turbo</option>
                    <option value="kling-o3-pro-fal">Kling O3 Pro (FAL)</option>
                    <option value="kling-v3-pro-i2v-fal">Kling v3 Pro I2V (FAL)</option>
                    <option value="kling-v3-pro-t2v-fal">Kling v3 Pro T2V (FAL)</option>
                    <option value="kling-motion">Kling 2.6 Motion Control</option>
                  </optgroup>
                  <optgroup label="Other">
                    <option value="seedance">Seedance 1.5 Pro</option>
                    <option value="seedance-2-fal">Seedance 2.0 I2V (FAL)</option>
                    <option value="seedance-2-omni-fal">Seedance 2.0 Omni (FAL)</option>
                    <option value="wan-i2v">Wan 2.2 I2V Fast</option>
                    <option value="pixverse-c1-ref-fal">PixVerse C1 Reference (FAL)</option>
                    <option value="aurora-fal">Creatify Aurora (Avatar)</option>
                    <option value="ltx">LTX 2 Fast</option>
                    <option value="ltx-23-fast">LTX 2.3 Fast</option>
                    <option value="ltx-23-pro">LTX 2.3 Pro</option>
                    <option value="ltx-audio">LTX Audio-to-Video</option>
                    <option value="p-video">P-Video</option>
                  </optgroup>
                </select>
              </div>
              <div className="video-model-summary">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Selected model</div>
                    <div className="text-sm font-semibold text-gray-100">{modelOption?.label || 'Unknown model'}</div>
                  </div>
                  {generationCostEstimate && (
                    <div className="text-right text-xs text-gray-400">
                      {billingMode === 'byok'
                        ? `${formatUsd(generationCostEstimate.providerUsd)} est.`
                        : `${generationCostEstimate.credits} credits est.`}
                    </div>
                  )}
                </div>
                <p className="mt-2 text-sm text-gray-300">{selectedModelGuidance}</p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {selectedModelBadges.map((badge) => (
                    <span key={badge} className="video-model-tag">{badge}</span>
                  ))}
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Format</label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {availableAspectRatios.map((ratio) => (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => setAspectRatio(ratio)}
                      className={`app-button ${aspectRatio === ratio ? 'app-primary' : 'app-secondary'} text-xs`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
                {MODEL_ASPECT_RATIOS[modelId]?.length !== ASPECT_RATIOS.length && (
                  <p className="text-[11px] text-gray-500 mt-2">Aspect ratios vary by model.</p>
                )}
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Duration</label>
                <select
                  value={normalizedDurationSeconds}
                  onChange={(event) => setVideoDurationSeconds(Number(event.target.value) || durationConfig.fallback)}
                  disabled={!durationConfig.supported}
                  className="app-select mt-2 disabled:opacity-60"
                >
                  {durationConfig.options.map((seconds) => (
                    <option key={seconds} value={seconds}>
                      {seconds}s
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-gray-500 mt-2">
                  {durationConfig.supported
                    ? 'Adjustable for this model.'
                    : `Fixed by provider (uses ${durationConfig.fallback}s).`}
                </p>
              </div>
              </div>
              {generationCostEstimate && (
                <div className="rounded-xl border border-white/8 bg-black/10 px-3 py-2 text-sm text-gray-300">
                  {billingMode === 'byok'
                    ? `Estimated provider cost: ${formatUsd(generationCostEstimate.providerUsd)}`
                    : `Estimated cost: ${generationCostEstimate.credits} credits`}
                </div>
              )}
            </div>
            </div>

            <details
              className="guides-disclosure group"
              open={guidesOpen}
              onToggle={(event) => setGuidesOpen(event.currentTarget.open)}
            >
              <summary className="guides-disclosure__summary">
                <div className="guides-disclosure__label">
                  <svg className="guides-disclosure__chevron transition-transform group-open:rotate-90" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z" clipRule="evenodd" /></svg>
                  <span>Guides, References & Advanced Controls</span>
                  <span className="guides-disclosure__hint">frames, elements, motion, model-specific settings</span>
                </div>
                <span className={`guides-disclosure__status ${generationGuideBlockers.length > 0 ? 'guides-disclosure__status--needed' : 'guides-disclosure__status--ready'}`}>
                  {guideDisclosureStatus}
                </span>
              </summary>
              <div className="mt-3 space-y-5 animate-in fade-in slide-in-from-top-2 duration-300">

            {supportsElements && (
              <div className="app-panel p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Elements</div>
                  <span className="text-[10px] text-gray-500">{supportsVeoElements ? 'Veo hint + Kling bindings' : 'Kling bindings'}</span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={elementsInput}
                    onChange={(event) => setElementsInput(event.target.value)}
                    placeholder="Add element (e.g., neon signs, rain)"
                    className="app-input flex-1"
                  />
                  <button
                    className="app-button app-secondary text-xs"
                    type="button"
                    onClick={() => {
                      const next = elementsInput.trim();
                      if (!next) return;
                      setElements((prev) => [...prev, next]);
                      setElementsInput('');
                    }}
                  >
                    Add
                  </button>
                </div>
                {elements.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {elements.map((item, index) => (
                      <button
                        key={`${item}-${index}`}
                        className="text-xs bg-indigo-600/30 text-indigo-200 px-3 py-1 rounded-full"
                        onClick={() => setElements((prev) => prev.filter((_, i) => i !== index))}
                      >
                        {item}
                      </button>
                    ))}
                  </div>
                )}
                {supportsVeoElements && (
                  <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11px] uppercase tracking-[0.2em] text-gray-500">Veo Element References</div>
                      <span className="text-[10px] text-gray-500">{elementReferenceAssets.length}/3</span>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      Add up to 3 image references from the library using “Add as Element Ref”.
                    </div>
                    {elementReferenceAssets.length > 0 && (
                      <div className="flex flex-wrap gap-2">
                        {elementReferenceAssets.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            className="text-xs bg-cyan-600/20 text-cyan-200 px-3 py-1 rounded-full"
                            onClick={() => setElementReferenceAssets((prev) => prev.filter((entry) => entry.id !== item.id))}
                          >
                            {item.name}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {supportsKlingAdvanced && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Kling Advanced</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] text-gray-400">Shot Type</label>
                    <select
                      value={klingShotType}
                      onChange={(event) => setKlingShotType(event.target.value as 'static' | 'dynamic' | 'customize' | 'intelligent')}
                      className="app-select mt-1"
                    >
                      <option value="dynamic">dynamic</option>
                      <option value="static">static</option>
                      <option value="customize">customize</option>
                      <option value="intelligent">intelligent</option>
                    </select>
                  </div>
                  <label className="text-xs text-gray-300 flex items-center gap-2 mt-5">
                    <input
                      type="checkbox"
                      checked={klingGenerateAudio}
                      onChange={(event) => setKlingGenerateAudio(event.target.checked)}
                    />
                    Generate audio
                  </label>
                </div>
                <textarea
                  value={klingMultiPromptText}
                  onChange={(event) => setKlingMultiPromptText(event.target.value)}
                  placeholder="Multi-shot (optional): one segment per line, e.g. 2|Push in to subject"
                  className="app-textarea h-20"
                />
                {modelId === 'kling-o3-pro-fal' && (
                  <label className="text-xs text-gray-300 flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={klingUseReferenceVideoForO3}
                      onChange={(event) => setKlingUseReferenceVideoForO3(event.target.checked)}
                    />
                    Use motion reference video in O3 reference mode
                  </label>
                )}
                {(modelId === 'kling-v3-pro-i2v-fal' || modelId === 'kling-v3-pro-t2v-fal') && (
                  <div className="grid gap-3 md:grid-cols-3">
                    <input
                      value={klingNegativePrompt}
                      onChange={(event) => setKlingNegativePrompt(event.target.value)}
                      placeholder="Negative prompt"
                      className="app-input"
                    />
                    <input
                      type="number"
                      min={0}
                      max={1}
                      step={0.05}
                      value={klingCfgScale}
                      onChange={(event) => setKlingCfgScale(Number(event.target.value))}
                      placeholder="CFG scale"
                      className="app-input"
                    />
                    <input
                      value={klingVoiceIdsText}
                      onChange={(event) => setKlingVoiceIdsText(event.target.value)}
                      placeholder="Voice IDs (comma-separated)"
                      className="app-input"
                    />
                  </div>
                )}
              </div>
            )}

            {supportsStoryboardRefs && (
              <div className="app-panel p-4 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Storyboard References</div>
                  <span className="text-[10px] text-gray-500">{storyboardReferenceAssets.length}/9</span>
                </div>
                <p className="text-[11px] text-gray-500">
                  {usesStoryboardCollageFallback
                    ? 'Add multiple library frames to auto-build a storyboard collage for Seedance multi-shot prompting.'
                    : modelId === 'seedance-2-omni-fal'
                      ? 'Start frame, storyboard frames, optional reference video, and optional audio are sent as native Seedance Omni references.'
                      : 'The first image becomes the PixVerse subject; additional frames are sent as background anchors.'}
                </p>
                {storyboardReferenceAssets.length > 0 ? (
                  <div className="flex flex-wrap gap-2">
                    {storyboardReferenceAssets.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        className="text-xs bg-emerald-600/20 text-emerald-200 px-3 py-1 rounded-full"
                        onClick={() => setStoryboardReferenceAssets((prev) => prev.filter((entry) => entry.id !== item.id))}
                      >
                        {item.name}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-dashed border-gray-700 p-3 text-[11px] text-gray-500">
                    Add image or reference assets from the library to build the storyboard stack.
                  </div>
                )}
              </div>
            )}

            {(modelId === 'ltx-23-fast' || modelId === 'ltx-23-pro') && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">LTX 2.3 Controls</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="text-[10px] text-gray-400">Resolution</label>
                    <select value={ltxResolution} onChange={(event) => setLtxResolution(event.target.value as '1080p' | '2k' | '4k')} className="app-select mt-1">
                      <option value="1080p">1080p</option>
                      <option value="2k">2K</option>
                      <option value="4k">4K</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400">FPS</label>
                    <select value={ltxFps} onChange={(event) => setLtxFps(Number(event.target.value) as 24 | 25 | 48 | 50)} className="app-select mt-1">
                      <option value={24}>24</option>
                      <option value={25}>25</option>
                      <option value={48}>48</option>
                      <option value={50}>50</option>
                    </select>
                  </div>
                  {modelId === 'ltx-23-pro' && (
                    <div>
                      <label className="text-[10px] text-gray-400">Camera Motion</label>
                      <select value={ltxCameraMotion} onChange={(event) => setLtxCameraMotion(event.target.value as 'none' | 'low' | 'medium' | 'high')} className="app-select mt-1">
                        <option value="none">None</option>
                        <option value="low">Low</option>
                        <option value="medium">Medium</option>
                        <option value="high">High</option>
                      </select>
                    </div>
                  )}
                  {modelId === 'ltx-23-pro' && (
                    <label className="text-xs text-gray-300 flex items-center gap-2 mt-5">
                      <input type="checkbox" checked={ltxGenerateAudio} onChange={(event) => setLtxGenerateAudio(event.target.checked)} />
                      Generate audio
                    </label>
                  )}
                </div>
                <p className="text-[11px] text-gray-500">
                  {modelId === 'ltx-23-pro'
                    ? 'LTX 2.3 Pro can switch between text, image, and audio-driven generation based on the inputs you provide.'
                    : 'LTX 2.3 Fast supports start and end frame guidance with higher frame-rate control.'}
                </p>
              </div>
            )}

            {modelId === 'ltx-audio' && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Audio-to-Video Controls</div>
                <div className="grid gap-3 md:grid-cols-2">
                  <div>
                    <label className="text-[10px] text-gray-400">Resolution</label>
                    <select value={ltxAudioResolution} onChange={(event) => setLtxAudioResolution(event.target.value as '720p' | '1080p' | '1440p' | '2160p')} className="app-select mt-1">
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                      <option value="1440p">1440p</option>
                      <option value="2160p">2160p</option>
                    </select>
                  </div>
                  <div className="text-[11px] text-gray-500 flex items-end">
                    Add an audio track, optionally add a start frame, and the model will drive motion from the sound.
                  </div>
                </div>
              </div>
            )}

            {modelId === 'p-video' && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">P-Video Controls</div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <div>
                    <label className="text-[10px] text-gray-400">Resolution</label>
                    <select value={pVideoResolution} onChange={(event) => setPVideoResolution(event.target.value as '720p' | '1080p')} className="app-select mt-1">
                      <option value="720p">720p</option>
                      <option value="1080p">1080p</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] text-gray-400">FPS</label>
                    <select value={pVideoFps} onChange={(event) => setPVideoFps(Number(event.target.value) as 24 | 48)} className="app-select mt-1">
                      <option value={24}>24</option>
                      <option value={48}>48</option>
                    </select>
                  </div>
                  <label className="text-xs text-gray-300 flex items-center gap-2 mt-5">
                    <input type="checkbox" checked={pVideoDraftMode} onChange={(event) => setPVideoDraftMode(event.target.checked)} />
                    Draft mode
                  </label>
                  <label className="text-xs text-gray-300 flex items-center gap-2 mt-5">
                    <input type="checkbox" checked={pVideoPromptUpsampling} onChange={(event) => setPVideoPromptUpsampling(event.target.checked)} />
                    Prompt upsampling
                  </label>
                </div>
                <p className="text-[11px] text-gray-500">P-Video can run text-only, image-conditioned, or audio-conditioned generations.</p>
              </div>
            )}

            {modelId === 'seedance-2-fal' && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Seedance 2.0 Controls</div>
                <label className="text-xs text-gray-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={seedanceGenerateAudio}
                    onChange={(event) => setSeedanceGenerateAudio(event.target.checked)}
                  />
                  Generate synced audio
                </label>
                <p className="text-[11px] text-gray-500">
                  Uses FAL Seedance 2.0 image-to-video with start frame, optional end frame, 4-15s duration, and fixed 720p output.
                </p>
              </div>
            )}

            {modelId === 'seedance-2-omni-fal' && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Seedance 2.0 Omni</div>
                <label className="text-xs text-gray-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={seedanceOmniGenerateAudio}
                    onChange={(event) => setSeedanceOmniGenerateAudio(event.target.checked)}
                  />
                  Generate synced audio
                </label>
                <p className="text-[11px] text-gray-500">
                  Native reference-to-video flow. Uses up to 9 image refs plus an optional reference video and optional audio cue.
                </p>
              </div>
            )}

            {modelId === 'pixverse-c1-ref-fal' && (
              <div className="app-panel p-4 space-y-3">
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">PixVerse C1 Reference</div>
                <label className="text-xs text-gray-300 flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={pixverseGenerateAudio}
                    onChange={(event) => setPixverseGenerateAudio(event.target.checked)}
                  />
                  Generate model audio
                </label>
                <p className="text-[11px] text-gray-500">
                  Uses named image references. Start frame becomes the primary subject, and storyboard refs extend the scene/background guidance.
                </p>
              </div>
            )}

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Start Frame</label>
                <div className="mt-2 app-panel p-4 border border-dashed border-gray-600 space-y-3">
                  {referencePreviewUrl ? (
                    <>
                      <img
                        src={referencePreviewUrl}
                        alt="Start frame"
                        className="w-full rounded-lg object-cover cursor-zoom-in"
                        onDoubleClick={() => setAssetPreview({ url: referencePreviewUrl, kind: 'image', title: 'Start frame' })}
                      />
                      <button
                        type="button"
                        className="app-button app-secondary text-xs"
                        onClick={() => {
                          setReferenceFile(null);
                          setReferenceUrl(null);
                        }}
                      >
                        Clear start frame
                      </button>
                    </>
                  ) : (
                    <label className="app-button app-secondary text-xs cursor-pointer inline-flex items-center gap-2">
                      <UploadIcon className="w-4 h-4" />
                      Upload start frame
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setReferenceFile(file);
                          setReferenceUrl(null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                {modelOption?.supportsImage === false ? (
                  <p className="text-xs text-gray-500 mt-2">Frame guides are not used by this model.</p>
                ) : (
                  <p className="text-xs text-gray-500 mt-2">
                    {modelOption?.requiresImage
                      ? 'This model requires a start frame.'
                      : 'Optional: add a start frame for composition.'}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">End Frame</label>
                <div className="mt-2 app-panel p-4 border border-dashed border-gray-600 space-y-3">
                  {endFramePreviewUrl ? (
                    <>
                      <img
                        src={endFramePreviewUrl}
                        alt="End frame"
                        className="w-full rounded-lg object-cover cursor-zoom-in"
                        onDoubleClick={() => setAssetPreview({ url: endFramePreviewUrl, kind: 'image', title: 'End frame' })}
                      />
                      <button
                        type="button"
                        className="app-button app-secondary text-xs"
                        onClick={() => {
                          setEndFrameFile(null);
                          setEndFrameUrl(null);
                        }}
                      >
                        Clear end frame
                      </button>
                    </>
                  ) : (
                    <label className="app-button app-secondary text-xs cursor-pointer inline-flex items-center gap-2">
                      <UploadIcon className="w-4 h-4" />
                      Upload end frame
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setEndFrameFile(file);
                          setEndFrameUrl(null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">Used when supported by the model.</p>
              </div>
            </div>

            {supportsMotionReference && (
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">
                  {modelId === 'seedance-2-omni-fal' ? 'Reference Video' : 'Motion Reference Video'}
                </label>
                <div className="mt-2 app-panel p-4 border border-dashed border-gray-600 space-y-3">
                  {motionReferencePreviewUrl ? (
                    <>
                      <video
                        src={motionReferencePreviewUrl}
                        controls
                        className="w-full rounded-lg object-cover cursor-zoom-in"
                        onDoubleClick={() => setAssetPreview({ url: motionReferencePreviewUrl, kind: 'video', title: 'Motion reference' })}
                      />
                      <button
                        type="button"
                        className="app-button app-secondary text-xs"
                        onClick={() => {
                          setMotionReferenceFile(null);
                          setMotionReferenceUrl(null);
                        }}
                      >
                        {modelId === 'seedance-2-omni-fal' ? 'Clear reference video' : 'Clear motion reference'}
                      </button>
                    </>
                  ) : (
                    <label className="app-button app-secondary text-xs cursor-pointer inline-flex items-center gap-2">
                      <UploadIcon className="w-4 h-4" />
                      {modelId === 'seedance-2-omni-fal' ? 'Upload reference video' : 'Upload motion reference'}
                      <input
                        type="file"
                        accept="video/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setMotionReferenceFile(file);
                          setMotionReferenceUrl(null);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                {modelId === 'kling-o3-pro-fal' && !klingUseReferenceVideoForO3 && (
                  <p className="text-xs text-gray-500 mt-2">Optional for Kling O3. Enable “Use motion reference video” above to require it.</p>
                )}
                {modelId === 'seedance-2-omni-fal' && (
                  <p className="text-xs text-gray-500 mt-2">Optional: Seedance Omni can use one extra video reference alongside the storyboard images.</p>
                )}
              </div>
            )}

            {supportsAudioInput && (
              <div>
                <label className="text-xs uppercase tracking-[0.12em] text-gray-500">Audio Track</label>
                <div className="mt-2 app-panel p-4 border border-dashed border-gray-600 space-y-3">
                  {audioPreviewUrl ? (
                    <>
                      <audio controls src={audioPreviewUrl} className="w-full" />
                      <button
                        type="button"
                        className="app-button app-secondary text-xs"
                        onClick={() => setAudioFile(null)}
                      >
                        Clear audio
                      </button>
                    </>
                  ) : (
                    <label className="app-button app-secondary text-xs cursor-pointer inline-flex items-center gap-2">
                      <UploadIcon className="w-4 h-4" />
                      Upload audio
                      <input
                        type="file"
                        accept="audio/*"
                        className="hidden"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          setAudioFile(file);
                          event.currentTarget.value = '';
                        }}
                      />
                    </label>
                  )}
                </div>
                <p className="text-xs text-gray-500 mt-2">
                  {needsAudio
                    ? `${modelOption?.label || 'This model'} requires an audio track.`
                    : 'Optional: add audio to drive timing, sync, or motion when the model supports it.'}
                </p>
              </div>
            )}

              </div>
            </details>

            <div className="generation-action-bar sticky bottom-0 z-10 -mx-6 px-6 py-4">
              <div className="flex flex-col gap-3">
                <div className="generation-readiness">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-gray-500">Generation readiness</div>
                      <div className="text-sm font-semibold text-gray-100">
                        {generationBlockers.length === 0 ? 'Ready to generate' : `${generationBlockers.length} item${generationBlockers.length === 1 ? '' : 's'} needed`}
                      </div>
                    </div>
                    <span className={`generation-readiness__pill ${generationBlockers.length === 0 ? 'generation-readiness__pill--ready' : 'generation-readiness__pill--needed'}`}>
                      {generationBlockers.length === 0 ? 'Ready' : 'Needs input'}
                    </span>
                  </div>
                  <div className="generation-readiness__grid">
                    {generationReadinessItems.map((item) => (
                      <div key={`${item.label}-${item.detail}`} className={`generation-readiness-item generation-readiness-item--${item.state}`}>
                        <span className="generation-readiness-dot" />
                        <div className="min-w-0">
                          <div className="generation-readiness-item__label">{item.label}</div>
                          <div className="generation-readiness-item__detail">{item.detail}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
                <button
                  onClick={handleGenerate}
                  disabled={!canStartGeneration}
                  className="app-button app-primary w-full disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <SparklesIcon className="w-4 h-4" />
                  {isGenerating
                    ? 'Generating...'
                    : generationBlockers.length > 0
                      ? `Complete ${generationBlockers.length} item${generationBlockers.length === 1 ? '' : 's'}`
                      : 'Generate Video'}
                </button>
                <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
                  <div className="flex items-center justify-between text-[10px] uppercase tracking-wide">
                    <span>Estimated Cost</span>
                    <span>{billingMode === 'byok' ? 'BYOK' : 'Hosted'}</span>
                  </div>
                  {generationCostEstimate ? (
                    <>
                      {billingMode === 'byok' ? (
                        <div className="mt-2 text-sm text-white">
                          Provider price: {formatUsd(generationCostEstimate.providerUsd)}
                        </div>
                      ) : (
                        <div className="mt-2 text-sm text-white">
                          This generation: {generationCostEstimate.credits} credits ({formatUsd(generationCostEstimate.hostedUsd)})
                        </div>
                      )}
                    </>
                  ) : (
                    <div className="mt-2 text-sm text-white">Price estimate unavailable for this model.</div>
                  )}
                  <div className="text-[11px] app-muted mt-1">{generationCostDetail}</div>
                </div>
                {status && (
                  <div className="rounded-xl border border-white/8 bg-black/10 px-4 py-3 text-sm text-gray-300">
                    {status}
                  </div>
                )}
              </div>
            </div>
          </section>

          <aside className="space-y-4">
            <section className="app-panel p-5 space-y-3">
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Latest results</div>
              {latestResults.length === 0 ? (
                <div className="text-sm text-gray-500">Generate a video to see previews here.</div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {latestResults.map((item) => (
                    <div key={item.id} className="app-card p-2 space-y-2">
                      <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                        <video
                          src={item.url}
                          controls
                          className="w-full h-full object-cover cursor-zoom-in"
                          onDoubleClick={() => setAssetPreview({ url: item.url, kind: 'video', title: item.name })}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-gray-400 truncate">{item.name}</p>
                          {item.generatedBy && (
                            <p className="text-[10px] text-indigo-300">{item.generatedBy}</p>
                          )}
                        </div>
                        <a
                          href={item.url}
                          download
                          className="app-button app-secondary text-xs"
                        >
                          <DownloadIcon className="w-4 h-4" />
                          Download
                        </a>
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
                    className={`app-button text-xs ${libraryFrameTarget === 'start' ? 'app-primary' : 'app-secondary'}`}
                    onClick={() => setLibraryFrameTarget('start')}
                  >
                    Use as Start
                  </button>
                  <button
                    type="button"
                    className={`app-button text-xs ${libraryFrameTarget === 'end' ? 'app-primary' : 'app-secondary'}`}
                    onClick={() => setLibraryFrameTarget('end')}
                  >
                    Use as End
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
                    {asset.url && (asset.kind === 'image' || asset.kind === 'reference') ? (
                      <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                        <img
                          src={asset.url}
                          alt={asset.name}
                          className="w-full h-full object-cover cursor-zoom-in"
                          onDoubleClick={() => setAssetPreview({ url: asset.url || '', kind: 'image', title: asset.name })}
                        />
                      </div>
                    ) : asset.url && asset.kind === 'video' ? (
                      <div className="aspect-video bg-black/60 rounded-lg overflow-hidden">
                        <video
                          src={asset.url}
                          className="w-full h-full object-cover cursor-zoom-in"
                          onDoubleClick={() => setAssetPreview({ url: asset.url || '', kind: 'video', title: asset.name })}
                        />
                      </div>
                    ) : (
                      <div className="aspect-video bg-gray-900/50 rounded-lg flex items-center justify-center text-[10px] text-gray-500">
                        {asset.kind} asset
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      {asset.url && (asset.kind === 'image' || asset.kind === 'reference') ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            className="app-button app-secondary text-xs"
                            onClick={() => {
                              if (libraryFrameTarget === 'start') {
                                setReferenceUrl(asset.url || null);
                                setReferenceFile(null);
                              } else {
                                setEndFrameUrl(asset.url || null);
                                setEndFrameFile(null);
                              }
                            }}
                          >
                            Use as {libraryFrameTarget === 'start' ? 'Start Frame' : 'End Frame'}
                          </button>
                          {supportsStoryboardRefs && (
                            <button
                              className="app-button app-secondary text-xs"
                              onClick={() => {
                                if (!asset.url) return;
                                setStoryboardReferenceAssets((prev) => {
                                  const alreadySelected = prev.some((entry) => entry.url === asset.url);
                                  if (alreadySelected) {
                                    return prev.filter((entry) => entry.url !== asset.url);
                                  }
                                  if (prev.length >= 9) return prev;
                                  return [...prev, {
                                    id: `${asset.id}-storyboard-${Date.now()}`,
                                    name: asset.name,
                                    url: asset.url,
                                  }];
                                });
                              }}
                              disabled={!storyboardReferenceAssets.some((entry) => entry.url === asset.url) && storyboardReferenceAssets.length >= 9}
                            >
                              {storyboardReferenceAssets.some((entry) => entry.url === asset.url)
                                ? 'Remove Storyboard'
                                : modelId === 'pixverse-c1-ref-fal'
                                  ? 'Add as Ref'
                                  : 'Add to Storyboard'}
                            </button>
                          )}
                          {supportsVeoElements && (
                            <button
                              className="app-button app-secondary text-xs"
                              onClick={() => {
                                if (!asset.url) return;
                                setElementReferenceAssets((prev) => {
                                  if (prev.some((entry) => entry.url === asset.url)) return prev;
                                  if (prev.length >= 3) return prev;
                                  return [...prev, {
                                    id: `${asset.id}-${Date.now()}`,
                                    name: asset.name,
                                    url: asset.url,
                                  }];
                                });
                              }}
                              disabled={elementReferenceAssets.length >= 3}
                            >
                              Add as Element Ref
                            </button>
                          )}
                        </div>
                      ) : asset.url && asset.kind === 'video' ? (
                        <button
                          className="app-button app-secondary text-xs"
                          onClick={() => {
                            setMotionReferenceUrl(asset.url || null);
                            setMotionReferenceFile(null);
                          }}
                        >
                          {modelId === 'seedance-2-omni-fal' ? 'Use as Ref Video' : 'Use as Motion Ref'}
                        </button>
                      ) : (
                        <span className="text-[10px] text-gray-500">Not compatible</span>
                      )}
                      {asset.url && (
                        <a href={asset.url} download className="app-button app-tertiary text-xs">
                          <DownloadIcon className="w-4 h-4" />
                          Download
                        </a>
                      )}
                    </div>
                  </div>
                ))}
                {filteredLibraryAssets.length === 0 && !libraryLoading && (
                  <div className="text-xs text-gray-500 text-center">No library assets found.</div>
                )}
              </div>
            </section>
          </aside>
        </div>
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
  );
};

export default VideoGenerationWorkspace;
