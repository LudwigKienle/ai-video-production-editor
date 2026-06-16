import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, {
  addEdge,
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlowProvider,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from 'reactflow';
import type { Connection, Edge, Node, NodeProps } from 'reactflow';
import {
  Activity,
  Boxes,
  CheckCircle2,
  Cloud,
  Copy,
  Database,
  GitBranch,
  HardDrive,
  LayoutTemplate,
  Play,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  Wand2,
  Workflow,
  Zap,
} from 'lucide-react';
import { LayersIcon } from '../components/icons';
import 'reactflow/dist/style.css';
import { ClipFilters, LutId, MediaItem, NodeGraphState, NodeGraphViewport, RecentProject, ReferenceItem, ShotPrompt } from '../types';
import { generateImageWithGemini3Pro, generateImageWithImagen, generateImageWithNano, generateImageWithReferences, generateVideoWithVeo } from '../services/geminiService';
import {
  generateImageWithControlNet,
  generateImageWithControlNetNormal,
  generateImageWithControlNetScribble,
  generateImageWithFlux2Turbo,
  generateImageWithFluxKlein,
  generateImageWithRunwayGen4Turbo,
  generateImageWithZImage,
  generateImageWithZTurbo,
  generateDepthMapWithDpt,
  removeBackgroundWithRembg,
  restoreFaceWithGfpgan,
  restoreFaceWithRestoreFormer,
  interpolateVideoWithRife,
  generateImageWithFlux,
  generateImageWithGemini3ProReplicateOnly,
  generateImageWithGptImage15,
  generateImageWithNanoBananaPro,
  generateImageWithQwenImage,
  generateModelWithRodin,
  generateImageWithSeedream,
  generateImageWithSeedreamReferences,
  generateVideoWithKling26,
  generateVideoWithSeedance,
  generateVideoWithWanI2V,
  generateOpenPose,
  generateTextWithGemini3ProReplicate,
  generateTextWithGpt5NanoReplicate,
  upscaleImage,
  upscaleImageWithClarity,
  upscaleImageWithCrystal,
  upscaleImageWithTopaz,
  upscaleVideoWithCrystal,
  upscaleVideoWithTopaz,
} from '../services/replicateService';
import { generateImageWithFalGrokImagine, generateImageWithFalQwenImageMax } from '../services/falAiService';
import { getBase64FromUrl } from '../utils/helpers';
import { FILM_LUTS, buildFilterString, getBloomStrength, getGrainStrength, getHalationStrength, getVignetteStrength, normalizeFilters } from '../utils/colorGrading';
import { applyCubeLutToImageData, parseCubeLut } from '../utils/lut';
import { LibraryAsset, useLibraryAssets } from '../hooks/useLibraryAssets';

type NodeKind =
  | 'prompt'
  | 'imageInput'
  | 'model'
  | 'sampler'
  | 'output'
  | 'video'
  | 'upscale'
  | 'filter'
  | 'chroma'
  | 'blend'
  | 'sketch'
  | 'openpose'
  | 'llm'
  | 'depth'
  | 'faceRestore'
  | 'bgRemove'
  | 'rife';

type NodeData = {
  label: string;
  value?: string;
  options?: string[];
  selected?: string;
  params?: Record<string, any>;
  onChange?: (updates: Partial<NodeData>) => void;
};

type PaletteGroupId = 'io' | 'models' | 'generation' | 'processing' | 'comp' | 'output';

type PaletteItem = {
  type: NodeKind;
  label: string;
  group: PaletteGroupId;
  description: string;
  portLabel: string;
  tone: string;
};

type QuickTemplateOption = {
  id: string;
  label: string;
  description: string;
  backend: 'Local' | 'Cloud' | 'Hybrid';
  nodeCount: number;
};

type ExecutionMode = 'local' | 'cloud' | 'hybrid';
type SafetyMode = 'draft' | 'review' | 'locked';

type RunTraceEntry = {
  id: string;
  nodeId: string;
  label: string;
  status: 'queued' | 'running' | 'done' | 'error';
  detail: string;
};

const isLikelyImageUrl = (url: string) => {
  if (!url) return false;
  if (url.startsWith('data:image')) return true;
  if (url.startsWith('blob:')) return true;
  return /\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(url.split('?')[0]);
};

const NODE_ASPECT_RATIOS = ['16:9', '9:16', '1:1', '4:3', '3:4', '2:1', '21:9', '235:100', '239:100'] as const;
const LORA_SUPPORTED_NODE_MODELS = new Set<string>(['Flux', 'Flux 2 Klein', 'Flux 2 Turbo', 'Z-Image', 'Z-Turbo']);

const resolveAspectRatioParam = (params?: Record<string, any>, fallback = '16:9') => {
  const mode = params?.aspectRatioMode;
  const value = mode === 'custom' ? params?.customAspectRatio : params?.aspectRatio;
  if (typeof value === 'string' && value.trim()) return value.trim();
  return fallback;
};

const resolveLoraParams = (params: Record<string, any> | undefined, modelLabel: string) => {
  if (!LORA_SUPPORTED_NODE_MODELS.has(modelLabel)) return undefined;
  const loraUrl = typeof params?.loraUrl === 'string' ? params.loraUrl.trim() : '';
  if (!loraUrl) return undefined;
  const loraScale = typeof params?.loraScale === 'number' ? params.loraScale : 0.75;
  return { loraUrl, loraScale };
};

const PromptNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  return (
    <div className="bg-gray-900 border border-indigo-500/40 rounded-lg p-3 min-w-[220px] text-gray-200">
      <div className="text-xs uppercase tracking-[0.2em] text-indigo-300">Prompt</div>
      <textarea
        value={data.value || ''}
        placeholder="Enter prompt..."
        className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
        rows={4}
        onChange={(event) => data.onChange?.({ value: event.target.value })}
      />
      <Handle type="target" position={Position.Left} id="text" />
      <Handle type="source" position={Position.Right} id="prompt" />
    </div>
  );
};

const ImageInputNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const hasImage = Boolean(data.value);
  const isVideo = typeof data.value === 'string'
    && (data.value.startsWith('data:video') || ['.mp4', '.mov', '.webm', '.mkv'].some((ext) => data.value?.toLowerCase().includes(ext)));
  return (
    <div className="bg-gray-900 border border-blue-500/40 rounded-lg p-3 min-w-[200px] text-gray-200">
      <div className="text-xs uppercase tracking-[0.2em] text-blue-300">Image In</div>
      <div className="mt-3 space-y-2">
        {hasImage ? (
          isVideo ? (
            <video src={data.value} className="w-full h-24 rounded object-cover border border-gray-700" />
          ) : (
            <img src={data.value} alt="Input preview" className="w-full h-24 rounded object-cover border border-gray-700" />
          )
        ) : (
          <div className="h-24 rounded border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
            Upload or paste an image/video URL
          </div>
        )}
        <input
          value={data.value || ''}
          onChange={(event) => data.onChange?.({ value: event.target.value })}
          placeholder="Image or video URL..."
          className="w-full bg-gray-800 text-white text-[10px] p-2 rounded border border-gray-700 focus:border-blue-500"
        />
        <div className="flex items-center gap-2">
          <label className="text-[10px] bg-blue-600/30 text-blue-200 px-2 py-1 rounded cursor-pointer">
            Upload
            <input
              type="file"
              accept="image/*,video/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (!file) return;
                const reader = new FileReader();
                reader.onload = () => {
                  if (typeof reader.result === 'string') {
                    data.onChange?.({ value: reader.result });
                  }
                };
                reader.readAsDataURL(file);
                event.currentTarget.value = '';
              }}
            />
          </label>
          {hasImage && (
            <button
              className="text-[10px] text-gray-400 hover:text-gray-200"
              onClick={() => data.onChange?.({ value: '' })}
            >
              Clear
            </button>
          )}
        </div>
      </div>
      <Handle type="source" position={Position.Right} id="image" />
    </div>
  );
};

const ModelNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: string | number) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  const mode = params.aspectRatioMode === 'custom' ? 'custom' : 'preset';
  const ratioValue = typeof params.aspectRatio === 'string' && params.aspectRatio.trim()
    ? params.aspectRatio.trim()
    : '16:9';
  const hasPreset = NODE_ASPECT_RATIOS.includes(ratioValue as any);
  const selectedRatio = mode === 'custom' ? 'custom' : (hasPreset ? ratioValue : 'custom');
  const supportsLora = LORA_SUPPORTED_NODE_MODELS.has(data.selected || '');
  const loraScale = typeof params.loraScale === 'number' ? params.loraScale : 0.75;
  return (
    <div className="bg-gray-900 border border-emerald-500/40 rounded-lg p-3 min-w-[200px] text-gray-200">
      <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">Model</div>
      <select
        value={data.selected || ''}
        onChange={(event) => data.onChange?.({ selected: event.target.value })}
        className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-emerald-500"
      >
        {(data.options || [
          'Imagen',
          'Gemini 3 Pro',
          'Nano Banana 2',
          'Gemini 3 Pro (Replicate)',
          'Seedream',
          'Flux',
          'Flux 2 Klein',
          'Flux 2 Turbo',
          'Z-Image',
          'Z-Turbo',
          'Qwen',
          'Nano Banana Pro',
          'Qwen Image Max (FAL)',
          'Grok Imagine (FAL)',
          'GPT Image 1.5',
          'Runway Gen-4 Turbo',
          'ControlNet',
          'ControlNet Scribble',
          'ControlNet Normal',
          'Rodin 3D',
        ]).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <div className="mt-2">
        <div className="text-[10px] text-gray-400 mb-1">Aspect Ratio</div>
        <select
          value={selectedRatio}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'custom') {
              updateParam('aspectRatioMode', 'custom');
            } else {
              updateParam('aspectRatioMode', 'preset');
              updateParam('aspectRatio', value);
            }
          }}
          className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-emerald-500"
        >
          {NODE_ASPECT_RATIOS.map((ratio) => (
            <option key={ratio} value={ratio}>{ratio}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
        {selectedRatio === 'custom' && (
          <input
            value={params.customAspectRatio || ''}
            onChange={(event) => updateParam('customAspectRatio', event.target.value)}
            placeholder="e.g. 5:4"
            className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-emerald-500"
          />
        )}
      </div>
      {supportsLora && (
        <div className="mt-2">
          <div className="text-[10px] text-gray-400 mb-1">LoRA (supported models)</div>
          <input
            value={params.loraUrl || ''}
            onChange={(event) => updateParam('loraUrl', event.target.value)}
            placeholder="LoRA URL (public)"
            className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-emerald-500"
          />
          <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
            Strength
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={loraScale}
              onChange={(event) => updateParam('loraScale', Number(event.target.value))}
              className="flex-1"
            />
            <span className="text-gray-300">{loraScale.toFixed(2)}</span>
          </div>
        </div>
      )}
      <Handle type="target" position={Position.Left} id="prompt" />
      <Handle type="target" position={Position.Left} id="image" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Right} id="model" />
    </div>
  );
};

const SamplerNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  return (
    <div className="bg-gray-900 border border-amber-500/40 rounded-lg p-3 min-w-[200px] text-gray-200">
      <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Sampler</div>
      <select
        value={data.selected || ''}
        onChange={(event) => data.onChange?.({ selected: event.target.value })}
        className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-amber-500"
      >
        {(data.options || ['Standard', 'Cinematic', 'Fast', 'High Detail']).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-400">
        Steps
        <input type="range" min={10} max={50} defaultValue={28} className="flex-1" />
      </div>
      <Handle type="target" position={Position.Left} id="model" />
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Right} id="sampled" />
    </div>
  );
};

const OutputNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const previewUrl = data.params?.previewUrl as string | undefined;
  const previewType = data.params?.previewType as string | undefined;
  return (
    <div className="bg-gray-900 border border-purple-500/40 rounded-lg p-3 min-w-[200px] text-gray-200">
      <div className="text-xs uppercase tracking-[0.2em] text-purple-300">Output</div>
      <div className="mt-3 h-24 rounded border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500">
        {previewUrl ? (
          previewType === 'video' ? (
            <video src={previewUrl} className="w-full h-full object-cover rounded" />
          ) : isLikelyImageUrl(previewUrl) ? (
            <img src={previewUrl} alt="Output preview" className="w-full h-full object-cover rounded" />
          ) : (
            <span>Output ready</span>
          )
        ) : (
          <span>Rendered output</span>
        )}
      </div>
      <Handle type="target" position={Position.Left} id="image" />
    </div>
  );
};

const VideoNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const previewUrl = data.params?.previewUrl as string | undefined;
  const params = data.params || {};
  const updateParam = (key: string, value: string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  const mode = params.aspectRatioMode === 'custom' ? 'custom' : 'preset';
  const ratioValue = typeof params.aspectRatio === 'string' && params.aspectRatio.trim()
    ? params.aspectRatio.trim()
    : '16:9';
  const hasPreset = NODE_ASPECT_RATIOS.includes(ratioValue as any);
  const selectedRatio = mode === 'custom' ? 'custom' : (hasPreset ? ratioValue : 'custom');
  return (
    <div className="bg-gray-900 border border-rose-500/40 rounded-lg p-3 min-w-[220px] text-gray-200">
      <div className="text-xs uppercase tracking-[0.2em] text-rose-300">Video</div>
      <select
        value={data.selected || ''}
        onChange={(event) => data.onChange?.({ selected: event.target.value })}
        className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-rose-500"
      >
        {(data.options || ['Veo 3.1 Fast', 'Veo 3.1', 'Seedance 1.5', 'Kling 2.6', 'Wan I2V']).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <div className="mt-2">
        <div className="text-[10px] text-gray-400 mb-1">Aspect Ratio</div>
        <select
          value={selectedRatio}
          onChange={(event) => {
            const value = event.target.value;
            if (value === 'custom') {
              updateParam('aspectRatioMode', 'custom');
            } else {
              updateParam('aspectRatioMode', 'preset');
              updateParam('aspectRatio', value);
            }
          }}
          className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-rose-500"
        >
          {NODE_ASPECT_RATIOS.map((ratio) => (
            <option key={ratio} value={ratio}>{ratio}</option>
          ))}
          <option value="custom">Custom</option>
        </select>
        {selectedRatio === 'custom' && (
          <input
            value={params.customAspectRatio || ''}
            onChange={(event) => updateParam('customAspectRatio', event.target.value)}
            placeholder="e.g. 2.35:1"
            className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-rose-500"
          />
        )}
      </div>
      <div className="mt-2 h-24 rounded border border-dashed border-gray-700 flex items-center justify-center text-[10px] text-gray-500 overflow-hidden">
        {previewUrl ? (
          <video src={previewUrl} className="w-full h-full object-cover" />
        ) : (
          <span>Rendered video</span>
        )}
      </div>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="target" position={Position.Left} id="prompt" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Right} id="video" />
    </div>
  );
};

const UpscaleNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: number | string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  const scale = Number.isFinite(Number(params.scale)) ? Number(params.scale) : 4;
  return (
    <div className="bg-gray-900 border border-cyan-500/40 rounded-lg p-3 min-w-[230px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-cyan-300">Upscale</div>
      <select
        value={data.selected || 'Crystal Upscaler'}
        onChange={(event) => data.onChange?.({ selected: event.target.value })}
        className="mt-2 w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-cyan-500"
      >
        {(data.options || ['Crystal Upscaler', 'Clarity Upscaler', 'Topaz Upscale', 'Real-ESRGAN 4x', 'Crystal Video Upscaler', 'Topaz Video Upscale']).map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
      <div className="text-[10px] text-gray-400">Scale</div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={1}
          max={8}
          step={0.5}
          value={scale}
          onChange={(event) => updateParam('scale', Number(event.target.value))}
          className="flex-1"
        />
        <input
          type="number"
          min={1}
          max={8}
          step={0.5}
          value={scale}
          onChange={(event) => updateParam('scale', Number(event.target.value) || 4)}
          className="w-16 bg-gray-800 text-white text-[10px] p-1 rounded border border-gray-700 focus:border-cyan-500"
        />
      </div>
      <div className="text-[10px] text-gray-400">Resolution (optional)</div>
      <input
        value={params.resolution || ''}
        onChange={(event) => updateParam('resolution', event.target.value)}
        placeholder="e.g. 1080p or 1920x1080"
        className="w-full bg-gray-800 text-white text-[10px] p-2 rounded border border-gray-700 focus:border-cyan-500"
      />
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="upscaled" />
    </div>
  );
};

const FilterNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: number | string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  const lutOptions = ['none', 'custom', ...FILM_LUTS.map((lut) => lut.id)];

  return (
    <div className="bg-gray-900 border border-indigo-500/40 rounded-lg p-3 min-w-[240px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-indigo-300">Filter</div>
      <div className="grid gap-2 text-[10px]">
        <label className="flex items-center justify-between gap-2">
          <span>Brightness</span>
          <input
            type="range"
            min={0}
            max={200}
            value={params.brightness ?? 100}
            onChange={(event) => updateParam('brightness', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Contrast</span>
          <input
            type="range"
            min={0}
            max={200}
            value={params.contrast ?? 100}
            onChange={(event) => updateParam('contrast', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Saturate</span>
          <input
            type="range"
            min={0}
            max={200}
            value={params.saturate ?? 100}
            onChange={(event) => updateParam('saturate', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Hue</span>
          <input
            type="range"
            min={-180}
            max={180}
            value={params.hueRotate ?? 0}
            onChange={(event) => updateParam('hueRotate', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Blur</span>
          <input
            type="range"
            min={0}
            max={20}
            value={params.blur ?? 0}
            onChange={(event) => updateParam('blur', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Grain</span>
          <input
            type="range"
            min={0}
            max={100}
            value={params.grain ?? 0}
            onChange={(event) => updateParam('grain', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Halation</span>
          <input
            type="range"
            min={0}
            max={100}
            value={params.halation ?? 0}
            onChange={(event) => updateParam('halation', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Bloom</span>
          <input
            type="range"
            min={0}
            max={100}
            value={params.bloom ?? 0}
            onChange={(event) => updateParam('bloom', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <label className="flex items-center justify-between gap-2">
          <span>Vignette</span>
          <input
            type="range"
            min={0}
            max={100}
            value={params.vignette ?? 0}
            onChange={(event) => updateParam('vignette', Number(event.target.value))}
            className="flex-1"
          />
        </label>
        <div className="space-y-1">
          <div className="text-[10px] text-gray-400">LUT</div>
          <select
            value={params.lut ?? 'none'}
            onChange={(event) => updateParam('lut', event.target.value)}
            className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-indigo-500"
          >
            {lutOptions.map((lut) => (
              <option key={lut} value={lut}>
                {lut}
              </option>
            ))}
          </select>
          {params.lut === 'custom' && (
            <div className="flex items-center justify-between gap-2 text-[10px] text-gray-400">
              <label className="cursor-pointer text-indigo-200">
                Upload .cube
                <input
                  type="file"
                  accept=".cube"
                  className="hidden"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return;
                    const reader = new FileReader();
                    reader.onload = () => {
                      if (typeof reader.result === 'string') {
                        data.onChange?.({
                          params: {
                            ...params,
                            lut: 'custom',
                            lutName: file.name,
                            lutText: reader.result,
                          },
                        });
                      }
                    };
                    reader.readAsText(file);
                    event.currentTarget.value = '';
                  }}
                />
              </label>
              {params.lutName && (
                <button
                  className="text-[10px] text-gray-500 hover:text-gray-200"
                  onClick={() => data.onChange?.({ params: { ...params, lut: 'none', lutName: '', lutText: '' } })}
                >
                  Clear
                </button>
              )}
            </div>
          )}
          {params.lut === 'custom' && params.lutName && (
            <div className="text-[10px] text-gray-500 truncate">Custom LUT: {params.lutName}</div>
          )}
          <label className="flex items-center justify-between gap-2">
            <span>LUT Intensity</span>
            <input
              type="range"
              min={0}
              max={100}
              value={params.lutIntensity ?? 100}
              onChange={(event) => updateParam('lutIntensity', Number(event.target.value))}
              className="flex-1"
            />
          </label>
        </div>
      </div>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="filtered" />
    </div>
  );
};

const ChromaKeyNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: number | string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  return (
    <div className="bg-gray-900 border border-emerald-500/40 rounded-lg p-3 min-w-[200px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">Chroma Key</div>
      <div className="flex items-center gap-2">
        <input
          type="color"
          value={params.keyColor ?? '#00ff00'}
          onChange={(event) => updateParam('keyColor', event.target.value)}
          className="w-8 h-8 rounded border border-gray-700 bg-transparent"
        />
        <label className="flex-1 text-[10px]">
          Tolerance
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={params.tolerance ?? 0.25}
            onChange={(event) => updateParam('tolerance', Number(event.target.value))}
            className="w-full"
          />
        </label>
      </div>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="keyed" />
    </div>
  );
};

const BlendNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: number | string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  return (
    <div className="bg-gray-900 border border-amber-500/40 rounded-lg p-3 min-w-[220px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-amber-300">Composite</div>
      <select
        value={params.mode ?? 'normal'}
        onChange={(event) => updateParam('mode', event.target.value)}
        className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-amber-500"
      >
        {['normal', 'screen', 'multiply', 'overlay', 'soft-light', 'lighten', 'darken'].map((mode) => (
          <option key={mode} value={mode}>
            {mode}
          </option>
        ))}
      </select>
      <label className="flex items-center justify-between gap-2 text-[10px]">
        <span>Opacity</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={params.opacity ?? 0.8}
          onChange={(event) => updateParam('opacity', Number(event.target.value))}
          className="flex-1"
        />
      </label>
      <Handle type="target" position={Position.Left} id="base" style={{ top: '35%' }} />
      <Handle type="target" position={Position.Left} id="overlay" style={{ top: '70%' }} />
      <Handle type="source" position={Position.Right} id="composited" />
    </div>
  );
};

const SketchNode: React.FC<NodeProps<NodeData>> = () => {
  return (
    <div className="bg-gray-900 border border-slate-500/40 rounded-lg p-3 min-w-[200px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-slate-300">Sketch</div>
      <div className="text-[10px] text-gray-500">Creates a pencil-style edge sketch.</div>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="sketch" />
    </div>
  );
};

const OpenPoseNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: boolean) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  return (
    <div className="bg-gray-900 border border-fuchsia-500/40 rounded-lg p-3 min-w-[200px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-fuchsia-300">OpenPose</div>
      <label className="flex items-center justify-between text-[10px]">
        Face
        <input
          type="checkbox"
          checked={params.includeFace ?? true}
          onChange={(event) => updateParam('includeFace', event.target.checked)}
        />
      </label>
      <label className="flex items-center justify-between text-[10px]">
        Hands
        <input
          type="checkbox"
          checked={params.includeHands ?? true}
          onChange={(event) => updateParam('includeHands', event.target.checked)}
        />
      </label>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="pose" />
    </div>
  );
};

const DepthNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  return (
    <div className="bg-gray-900 border border-sky-500/40 rounded-lg p-3 min-w-[200px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-sky-300">Depth Map</div>
      <select
        value={params.model || 'dpt'}
        onChange={(event) => updateParam('model', event.target.value)}
        className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-sky-500"
      >
        <option value="dpt">DPT</option>
        <option value="midas">MiDaS</option>
      </select>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="depth" />
    </div>
  );
};

const FaceRestoreNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  return (
    <div className="bg-gray-900 border border-emerald-500/40 rounded-lg p-3 min-w-[220px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-emerald-300">Face Restore</div>
      <select
        value={params.model || 'gfpgan'}
        onChange={(event) => updateParam('model', event.target.value)}
        className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-emerald-500"
      >
        <option value="gfpgan">GFPGAN</option>
        <option value="restoreformer">RestoreFormer</option>
      </select>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="restored" />
    </div>
  );
};

const BackgroundRemoveNode: React.FC<NodeProps<NodeData>> = () => {
  return (
    <div className="bg-gray-900 border border-teal-500/40 rounded-lg p-3 min-w-[200px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-teal-300">Background Remove</div>
      <div className="text-[10px] text-gray-500">Removes background and outputs transparency.</div>
      <Handle type="target" position={Position.Left} id="image" />
      <Handle type="source" position={Position.Right} id="cutout" />
    </div>
  );
};

const RifeNode: React.FC<NodeProps<NodeData>> = () => {
  return (
    <div className="bg-gray-900 border border-rose-500/40 rounded-lg p-3 min-w-[200px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-rose-300">RIFE Interpolate</div>
      <div className="text-[10px] text-gray-500">Smooths motion by generating in-between frames.</div>
      <Handle type="target" position={Position.Left} id="video" />
      <Handle type="source" position={Position.Right} id="video" />
    </div>
  );
};

const LlmNode: React.FC<NodeProps<NodeData>> = ({ data }) => {
  const params = data.params || {};
  const updateParam = (key: string, value: string) => {
    data.onChange?.({ params: { ...params, [key]: value } });
  };
  return (
    <div className="bg-gray-900 border border-teal-500/40 rounded-lg p-3 min-w-[240px] text-gray-200 space-y-2">
      <div className="text-xs uppercase tracking-[0.2em] text-teal-300">LLM</div>
      <select
        value={params.model || 'gemini-3-pro-replicate'}
        onChange={(event) => updateParam('model', event.target.value)}
        className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-teal-500"
      >
        <option value="gemini-3-pro-replicate">Gemini 3 Pro (Replicate)</option>
        <option value="gpt-5-nano">GPT-5 Nano (Replicate)</option>
      </select>
      <textarea
        value={data.value || ''}
        placeholder="LLM prompt..."
        className="w-full bg-gray-800 text-white text-xs p-2 rounded border border-gray-700 focus:border-teal-500"
        rows={4}
        onChange={(event) => data.onChange?.({ value: event.target.value })}
      />
      <input
        value={params.systemPrompt || ''}
        onChange={(event) => updateParam('systemPrompt', event.target.value)}
        placeholder="System prompt (optional)"
        className="w-full bg-gray-800 text-white text-[10px] p-2 rounded border border-gray-700 focus:border-teal-500"
      />
      <Handle type="target" position={Position.Left} id="prompt" />
      <Handle type="source" position={Position.Right} id="text" />
    </div>
  );
};

const nodeTypes = {
  prompt: PromptNode,
  imageInput: ImageInputNode,
  model: ModelNode,
  sampler: SamplerNode,
  output: OutputNode,
  video: VideoNode,
  upscale: UpscaleNode,
  filter: FilterNode,
  chroma: ChromaKeyNode,
  blend: BlendNode,
  sketch: SketchNode,
  openpose: OpenPoseNode,
  depth: DepthNode,
  faceRestore: FaceRestoreNode,
  bgRemove: BackgroundRemoveNode,
  rife: RifeNode,
  llm: LlmNode,
};

type NodeWorkspaceProps = {
  nodeGraph?: NodeGraphState | null;
  onNodeGraphChange?: (graph: NodeGraphState) => void;
  onAddGeneratedMedia?: (item: MediaItem) => void;
  apiKeyReady?: boolean;
  mediaItems?: MediaItem[];
  references?: ReferenceItem[];
  shotPrompts?: ShotPrompt[];
  recentProjects?: RecentProject[];
  currentProjectName?: string | null;
  currentProjectPath?: string | null;
};

const initialNodes: Node<NodeData>[] = [
  {
    id: 'prompt-1',
    type: 'prompt',
    position: { x: 80, y: 120 },
    data: { label: 'Prompt', value: '' },
  },
  {
    id: 'model-1',
    type: 'model',
    position: { x: 500, y: 120 },
    data: { label: 'Model', selected: 'Imagen' },
  },
  {
    id: 'sampler-1',
    type: 'sampler',
    position: { x: 920, y: 120 },
    data: { label: 'Sampler', selected: 'Standard' },
  },
  {
    id: 'output-1',
    type: 'output',
    position: { x: 1320, y: 120 },
    data: { label: 'Output' },
  },
];

const initialEdges: Edge[] = [
  { id: 'e1', source: 'prompt-1', sourceHandle: 'prompt', target: 'model-1', targetHandle: 'prompt' },
  { id: 'e2', source: 'model-1', sourceHandle: 'model', target: 'sampler-1', targetHandle: 'model' },
  { id: 'e3', source: 'sampler-1', sourceHandle: 'sampled', target: 'output-1', targetHandle: 'image' },
];

const paletteGroupLabels: Record<PaletteGroupId, string> = {
  io: 'Inputs',
  models: 'Models & Agents',
  generation: 'Generation',
  processing: 'Processing',
  comp: 'Composite',
  output: 'Outputs',
};

const paletteItems: PaletteItem[] = [
  {
    type: 'prompt',
    label: 'Prompt',
    group: 'io',
    description: 'Text context for image, video, and agent nodes.',
    portLabel: 'text -> prompt',
    tone: 'from-indigo-500/24 to-indigo-500/5 border-indigo-400/35',
  },
  {
    type: 'imageInput',
    label: 'Media In',
    group: 'io',
    description: 'Image or video source from upload, URL, or library.',
    portLabel: 'media -> graph',
    tone: 'from-sky-500/24 to-sky-500/5 border-sky-400/35',
  },
  {
    type: 'llm',
    label: 'LLM Agent',
    group: 'models',
    description: 'Prompt expansion, task planning, and text transforms.',
    portLabel: 'prompt -> text',
    tone: 'from-teal-500/24 to-teal-500/5 border-teal-400/35',
  },
  {
    type: 'model',
    label: 'Image Model',
    group: 'models',
    description: 'Model-agnostic image generation with references and LoRA.',
    portLabel: 'prompt/media -> image',
    tone: 'from-emerald-500/24 to-emerald-500/5 border-emerald-400/35',
  },
  {
    type: 'sampler',
    label: 'Sampler',
    group: 'generation',
    description: 'Quality and speed pass for image model outputs.',
    portLabel: 'model -> image',
    tone: 'from-amber-500/24 to-amber-500/5 border-amber-400/35',
  },
  {
    type: 'video',
    label: 'Video Model',
    group: 'generation',
    description: 'Prompt or image-to-video generation with aspect control.',
    portLabel: 'prompt/media -> video',
    tone: 'from-rose-500/24 to-rose-500/5 border-rose-400/35',
  },
  {
    type: 'upscale',
    label: 'Upscale',
    group: 'processing',
    description: 'Crystal, Topaz, Clarity, ESRGAN, and video upscale paths.',
    portLabel: 'media -> media',
    tone: 'from-cyan-500/24 to-cyan-500/5 border-cyan-400/35',
  },
  {
    type: 'filter',
    label: 'Look Filter',
    group: 'processing',
    description: 'Brightness, LUT, grain, halation, bloom, and vignette.',
    portLabel: 'image -> image',
    tone: 'from-violet-500/24 to-violet-500/5 border-violet-400/35',
  },
  {
    type: 'chroma',
    label: 'Chroma Key',
    group: 'processing',
    description: 'Key a color range and output transparency.',
    portLabel: 'image -> alpha',
    tone: 'from-lime-500/24 to-lime-500/5 border-lime-400/35',
  },
  {
    type: 'bgRemove',
    label: 'Background Remove',
    group: 'processing',
    description: 'Subject cutout for transparent compositing.',
    portLabel: 'image -> cutout',
    tone: 'from-teal-500/24 to-teal-500/5 border-teal-400/35',
  },
  {
    type: 'faceRestore',
    label: 'Face Restore',
    group: 'processing',
    description: 'GFPGAN and RestoreFormer repair pass.',
    portLabel: 'image -> image',
    tone: 'from-emerald-500/24 to-emerald-500/5 border-emerald-400/35',
  },
  {
    type: 'depth',
    label: 'Depth Map',
    group: 'processing',
    description: 'Depth or normal-style utility output for relight and VFX.',
    portLabel: 'image -> depth',
    tone: 'from-blue-500/24 to-blue-500/5 border-blue-400/35',
  },
  {
    type: 'openpose',
    label: 'OpenPose',
    group: 'processing',
    description: 'Pose extraction for controlled generation.',
    portLabel: 'image -> pose',
    tone: 'from-fuchsia-500/24 to-fuchsia-500/5 border-fuchsia-400/35',
  },
  {
    type: 'sketch',
    label: 'Sketch',
    group: 'processing',
    description: 'Pencil-edge control pass for image workflows.',
    portLabel: 'image -> sketch',
    tone: 'from-slate-500/24 to-slate-500/5 border-slate-400/35',
  },
  {
    type: 'rife',
    label: 'RIFE Interpolate',
    group: 'processing',
    description: 'Generate in-between frames for smoother motion.',
    portLabel: 'video -> video',
    tone: 'from-rose-500/24 to-rose-500/5 border-rose-400/35',
  },
  {
    type: 'blend',
    label: 'Composite',
    group: 'comp',
    description: 'Two-input blend with screen, multiply, overlay, and opacity.',
    portLabel: 'A+B -> image',
    tone: 'from-orange-500/24 to-orange-500/5 border-orange-400/35',
  },
  {
    type: 'output',
    label: 'Output',
    group: 'output',
    description: 'Preview and collect final graph output.',
    portLabel: 'image -> result',
    tone: 'from-purple-500/24 to-purple-500/5 border-purple-400/35',
  },
];

const paletteGroupOrder: PaletteGroupId[] = ['io', 'models', 'generation', 'processing', 'comp', 'output'];

const quickTemplateOptions: QuickTemplateOption[] = [
  {
    id: 'text-image',
    label: 'Text -> Image',
    description: 'Prompt, model, sampler, and output for fast still generation.',
    backend: 'Hybrid',
    nodeCount: 4,
  },
  {
    id: 'image-video',
    label: 'Image -> Video',
    description: 'Reference image plus prompt into a video model.',
    backend: 'Cloud',
    nodeCount: 3,
  },
  {
    id: 'image-polish',
    label: 'Image Polish',
    description: 'Media input through look filter, upscale, and output.',
    backend: 'Hybrid',
    nodeCount: 4,
  },
  {
    id: 'agent-concept',
    label: 'Agent Concept Pass',
    description: 'LLM expands a creative brief before image generation.',
    backend: 'Hybrid',
    nodeCount: 6,
  },
  {
    id: 'vfx-matte',
    label: 'VFX Matte Stack',
    description: 'Cutout, color treatment, upscale, and final plate output.',
    backend: 'Hybrid',
    nodeCount: 5,
  },
  {
    id: 'two-plate-comp',
    label: 'Two-Plate Composite',
    description: 'Base and overlay media with blend, look, and output.',
    backend: 'Local',
    nodeCount: 5,
  },
  {
    id: 'video-polish',
    label: 'Video Polish',
    description: 'Video input through interpolation and video upscale.',
    backend: 'Cloud',
    nodeCount: 3,
  },
];

const IMAGE_MODEL_SET = new Set<string>([
  'Imagen',
  'Gemini 3 Pro',
  'Nano Banana 2',
  'Gemini Flash',
  'Gemini 3 Pro (Replicate)',
  'Seedream',
  'Flux',
  'Flux 2 Klein',
  'Flux 2 Turbo',
  'Z-Image',
  'Z-Turbo',
  'Qwen',
  'Nano Banana Pro',
  'Qwen Image Max (FAL)',
  'Grok Imagine (FAL)',
  'GPT Image 1.5',
  'Runway Gen-4 Turbo',
  'ControlNet',
  'ControlNet Scribble',
  'ControlNet Normal',
  'Rodin 3D',
]);

const MODEL_REQUIRES_IMAGE = new Set<string>([
  'ControlNet',
  'ControlNet Scribble',
  'ControlNet Normal',
  'Rodin 3D',
]);

const VIDEO_MODEL_SET = new Set<string>([
  'Veo 3.1 Fast',
  'Veo 3.1',
  'Seedance 1.5',
  'Kling 2.6',
  'Wan I2V',
]);

const UPSCALE_IMAGE_SET = new Set<string>([
  'Crystal Upscaler',
  'Clarity Upscaler',
  'Topaz Upscale',
  'Real-ESRGAN 4x',
]);

const UPSCALE_VIDEO_SET = new Set<string>([
  'Crystal Video Upscaler',
  'Topaz Video Upscale',
]);

const IMAGE_OUTPUT_TYPES = new Set<NodeKind>([
  'imageInput',
  'model',
  'sampler',
  'filter',
  'chroma',
  'blend',
  'sketch',
  'openpose',
  'upscale',
]);

type PipelineTarget = {
  nodeId: string;
  kind: 'image' | 'video' | 'text';
  prompt: string;
  model: string;
  imageInput?: string | null;
  secondaryInput?: string | null;
  params?: Record<string, any>;
  task?: 'generate' | 'upscale' | 'filter' | 'chroma' | 'blend' | 'sketch' | 'openpose' | 'llm' | 'depth' | 'faceRestore' | 'bgRemove' | 'rife';
};

type EvaluatedOutput = {
  kind: 'image' | 'video' | 'text';
  item?: MediaItem;
  text?: string;
  sourceType?: NodeKind;
};

const NodeWorkspaceContent: React.FC<NodeWorkspaceProps> = ({
  nodeGraph,
  onNodeGraphChange,
  onAddGeneratedMedia,
  apiKeyReady,
  mediaItems = [],
  references = [],
  shotPrompts = [],
  recentProjects = [],
  currentProjectName,
  currentProjectPath,
}) => {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const [viewport, setViewportState] = useState<NodeGraphViewport>({ x: -120, y: -40, zoom: 0.9 });
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [runResults, setRunResults] = useState<MediaItem[]>([]);
  const [runTextResults, setRunTextResults] = useState<Array<{ id: string; model: string; text: string }>>([]);
  const [librarySearch, setLibrarySearch] = useState('');
  const [paletteSearch, setPaletteSearch] = useState('');
  const [activePaletteGroup, setActivePaletteGroup] = useState<PaletteGroupId | 'all'>('all');
  const [executionMode, setExecutionMode] = useState<ExecutionMode>('hybrid');
  const [safetyMode, setSafetyMode] = useState<SafetyMode>('review');
  const [runTrace, setRunTrace] = useState<RunTraceEntry[]>([]);
  const [selectedImageNodeId, setSelectedImageNodeId] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const flowWrapperRef = useRef<HTMLDivElement>(null);
  const nodeIdRef = useRef(2);
  const grainCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const scratchCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const saveTimerRef = useRef<number | null>(null);
  const lastEmittedGraphRef = useRef<string | null>(null);
  const { setViewport, getViewport, fitView } = useReactFlow();

  const { assets: libraryAssets, isLoading: libraryLoading, error: libraryError } = useLibraryAssets({
    currentProjectName,
    currentProjectPath,
    mediaItems,
    references,
    shotPrompts,
    recentProjects,
  });

  const buildNodeData = useCallback((type: NodeKind | undefined, data?: NodeData): NodeData => {
    let defaults: NodeData = { label: 'Node' };
    switch (type) {
      case 'prompt':
        defaults = { label: 'Prompt', value: '' };
        break;
      case 'imageInput':
        defaults = { label: 'Image In', value: '' };
        break;
      case 'model':
        defaults = {
          label: 'Model',
          selected: 'Imagen',
          params: {
            aspectRatio: '16:9',
            aspectRatioMode: 'preset',
            customAspectRatio: '',
            loraUrl: '',
            loraScale: 0.75,
          },
        };
        break;
      case 'sampler':
        defaults = { label: 'Sampler', selected: 'Standard' };
        break;
      case 'output':
        defaults = { label: 'Output' };
        break;
      case 'video':
        defaults = { label: 'Video', selected: 'Veo 3.1 Fast', params: { aspectRatio: '16:9', aspectRatioMode: 'preset', customAspectRatio: '' } };
        break;
      case 'upscale':
        defaults = { label: 'Upscale', selected: 'Crystal Upscaler', params: { scale: 4, resolution: '' } };
        break;
      case 'filter':
        defaults = {
          label: 'Filter',
          params: {
            brightness: 100,
            contrast: 100,
            saturate: 100,
            hueRotate: 0,
            blur: 0,
            grain: 0,
            halation: 0,
            bloom: 0,
            vignette: 0,
            lut: 'none',
            lutIntensity: 100,
            lutName: '',
            lutText: '',
          },
        };
        break;
      case 'chroma':
        defaults = { label: 'Chroma Key', params: { keyColor: '#00ff00', tolerance: 0.25 } };
        break;
      case 'blend':
        defaults = { label: 'Composite', params: { mode: 'normal', opacity: 0.8 } };
        break;
      case 'sketch':
        defaults = { label: 'Sketch', params: { strength: 1 } };
        break;
      case 'openpose':
        defaults = { label: 'OpenPose', params: { includeFace: true, includeHands: true } };
        break;
      case 'depth':
        defaults = { label: 'Depth Map', params: { model: 'dpt' } };
        break;
      case 'faceRestore':
        defaults = { label: 'Face Restore', params: { model: 'gfpgan' } };
        break;
      case 'bgRemove':
        defaults = { label: 'Background Remove' };
        break;
      case 'rife':
        defaults = { label: 'RIFE Interpolate' };
        break;
      case 'llm':
        defaults = { label: 'LLM', value: '', params: { systemPrompt: '', model: 'gemini-3-pro-replicate' } };
        break;
      default:
        break;
    }
    return { ...defaults, ...data };
  }, []);

  const getNextNodeId = useCallback((type: NodeKind) => {
    const nextId = nodeIdRef.current + 1;
    nodeIdRef.current = nextId;
    return `${type}-${nextId}`;
  }, []);

  const createNodeInstance = useCallback((type: NodeKind, position: { x: number; y: number }, data?: NodeData): Node<NodeData> => {
    return {
      id: getNextNodeId(type),
      type,
      position,
      data: buildNodeData(type, data),
    };
  }, [buildNodeData, getNextNodeId]);

  const handleNodeDataChange = useCallback((nodeId: string, updates: Partial<NodeData>) => {
    setNodes((prev) =>
      prev.map((node) =>
        node.id === nodeId ? { ...node, data: { ...node.data, ...updates } } : node
      )
    );
  }, [setNodes]);

  const setNodePreview = useCallback((nodeId: string, item?: MediaItem | null) => {
    setNodes((prev) =>
      prev.map((node) => {
        if (node.id !== nodeId) return node;
        const params = node.data.params || {};
        return {
          ...node,
          data: {
            ...node.data,
            params: {
              ...params,
              previewUrl: item?.url || '',
              previewType: item?.type || '',
            },
          },
        };
      })
    );
  }, [setNodes]);

  const attachNodeHandlers = useCallback((nodeList: Node<NodeData>[]) => {
    return nodeList.map((node) => ({
      ...node,
      data: {
        ...buildNodeData(node.type as NodeKind | undefined, node.data),
        onChange: (updates: Partial<NodeData>) => handleNodeDataChange(node.id, updates),
      },
    }));
  }, [buildNodeData, handleNodeDataChange]);

  useEffect(() => {
    const graphNodes = nodeGraph?.nodes?.length ? nodeGraph.nodes : initialNodes;
    const graphEdges = nodeGraph?.edges?.length ? nodeGraph.edges : initialEdges;
    const graphViewport = nodeGraph?.viewport;
    const serialized = JSON.stringify({ nodes: graphNodes, edges: graphEdges, viewport: graphViewport });
    if (serialized === lastEmittedGraphRef.current) return;

    setNodes(attachNodeHandlers(graphNodes as Node<NodeData>[]));
    setEdges(graphEdges as Edge[]);
    if (graphViewport) {
      setViewport(graphViewport);
      setViewportState(graphViewport);
    } else {
      setViewportState({ x: 0, y: 0, zoom: 1 });
    }
  }, [nodeGraph, attachNodeHandlers, setEdges, setNodes, setViewport]);

  useEffect(() => {
    const maxId = nodes.reduce((max, node) => {
      const match = node.id.match(/-(\d+)$/);
      if (!match) return max;
      return Math.max(max, Number(match[1]));
    }, 1);
    nodeIdRef.current = maxId;
  }, [nodes]);

  useEffect(() => {
    if (selectedNodeId && !nodes.some((node) => node.id === selectedNodeId)) {
      setSelectedNodeId(null);
    }
  }, [nodes, selectedNodeId]);

  const buildGraphState = useCallback((currentNodes: Node<NodeData>[], currentEdges: Edge[], nextViewport: NodeGraphViewport) => {
    return {
      nodes: currentNodes.map((node) => {
        const { previewUrl, previewType, ...params } = node.data.params || {};
        return {
          id: node.id,
          type: node.type,
          position: node.position,
          data: {
            label: node.data.label,
            value: node.data.value,
            selected: node.data.selected,
            options: node.data.options,
            params,
          },
        };
      }),
      edges: currentEdges.map((edge) => ({
        id: edge.id,
        source: edge.source,
        target: edge.target,
        sourceHandle: edge.sourceHandle,
        targetHandle: edge.targetHandle,
        animated: edge.animated,
        type: edge.type,
      })),
      viewport: nextViewport,
    } as NodeGraphState;
  }, []);

  useEffect(() => {
    if (!onNodeGraphChange) return;
    if (saveTimerRef.current) {
      window.clearTimeout(saveTimerRef.current);
    }
    saveTimerRef.current = window.setTimeout(() => {
      const graph = buildGraphState(nodes, edges, viewport);
      lastEmittedGraphRef.current = JSON.stringify(graph);
      onNodeGraphChange(graph);
    }, 300);
    return () => {
      if (saveTimerRef.current) {
        window.clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
    };
  }, [nodes, edges, viewport, onNodeGraphChange, buildGraphState]);

  const onConnect = useCallback((params: Connection) => {
    setEdges((eds) => addEdge({ ...params, animated: true }, eds));
  }, [setEdges]);

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node<NodeData>) => {
    setSelectedNodeId(node.id);
    if (node.type === 'imageInput') {
      setSelectedImageNodeId(node.id);
    }
  }, []);

  const handleAddNodeFromPalette = useCallback((nodeType: NodeKind) => {
    const currentViewport = getViewport();
    const position = {
      x: Math.round((220 - currentViewport.x) / currentViewport.zoom),
      y: Math.round((160 - currentViewport.y) / currentViewport.zoom),
    };
    const [nodeWithHandlers] = attachNodeHandlers([createNodeInstance(nodeType, position)]);
    setNodes((prev) => prev.concat(nodeWithHandlers));
    setSelectedNodeId(nodeWithHandlers.id);
    if (nodeType === 'imageInput') {
      setSelectedImageNodeId(nodeWithHandlers.id);
    }
  }, [attachNodeHandlers, createNodeInstance, getViewport, setNodes]);

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    const flowBounds = flowWrapperRef.current?.getBoundingClientRect();
    const nodeType = event.dataTransfer.getData('application/reactflow') as NodeKind;
    if (!nodeType || !flowBounds) return;

    const position = {
      x: event.clientX - flowBounds.left,
      y: event.clientY - flowBounds.top,
    };

    const [nodeWithHandlers] = attachNodeHandlers([createNodeInstance(nodeType, position)]);
    setNodes((nds) => nds.concat(nodeWithHandlers));
    setSelectedNodeId(nodeWithHandlers.id);
    if (nodeType === 'imageInput') {
      setSelectedImageNodeId(nodeWithHandlers.id);
    }
  }, [attachNodeHandlers, createNodeInstance, setNodes]);

  const handleLibrarySelect = useCallback((asset: LibraryAsset) => {
    if (!asset.url) return;
    if (!selectedImageNodeId) {
      setRunStatus('Select an Image In node to apply the library asset.');
      return;
    }
    handleNodeDataChange(selectedImageNodeId, { value: asset.url });
    setRunStatus(`Linked ${asset.name} to ${selectedImageNodeId}.`);
  }, [handleNodeDataChange, selectedImageNodeId]);

  const handleMoveEnd = useCallback(() => {
    setViewportState(getViewport());
  }, [getViewport]);

  const handleDeleteSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    setEdges((prev) => prev.filter((edge) => edge.source !== selectedNodeId && edge.target !== selectedNodeId));
    setNodes((prev) => prev.filter((node) => node.id !== selectedNodeId));
    if (selectedImageNodeId === selectedNodeId) {
      setSelectedImageNodeId(null);
    }
    setSelectedNodeId(null);
  }, [selectedImageNodeId, selectedNodeId, setEdges, setNodes]);

  const handleDuplicateSelectedNode = useCallback(() => {
    if (!selectedNodeId) return;
    let nextSelectedId: string | null = null;
    let nextImageInputId: string | null = null;
    setNodes((prev) => {
      const original = prev.find((node) => node.id === selectedNodeId);
      if (!original) return prev;
      const clone = createNodeInstance(
        original.type as NodeKind,
        { x: original.position.x + 60, y: original.position.y + 60 },
        original.data
      );
      const [nodeWithHandlers] = attachNodeHandlers([clone]);
      nextSelectedId = nodeWithHandlers.id;
      if (nodeWithHandlers.type === 'imageInput') {
        nextImageInputId = nodeWithHandlers.id;
      }
      return prev.concat(nodeWithHandlers);
    });
    if (nextSelectedId) {
      setSelectedNodeId(nextSelectedId);
    }
    if (nextImageInputId) {
      setSelectedImageNodeId(nextImageInputId);
    }
  }, [attachNodeHandlers, createNodeInstance, selectedNodeId, setNodes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const isTyping = tag === 'input' || tag === 'textarea' || target?.isContentEditable;
      if (isTyping) return;
      if (event.key === 'Delete' || event.key === 'Backspace') {
        if (!selectedNodeId) return;
        event.preventDefault();
        handleDeleteSelectedNode();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [handleDeleteSelectedNode, selectedNodeId]);

  const isVideoAsset = useCallback((value: string) => {
    const lower = value.toLowerCase();
    if (lower.startsWith('data:video')) return true;
    return ['.mp4', '.mov', '.webm', '.mkv'].some((ext) => lower.includes(ext));
  }, []);

  const filteredLibraryAssets = useMemo(() => {
    const term = librarySearch.trim().toLowerCase();
    return libraryAssets.filter((asset) => {
      if (!asset.url) return false;
      if (asset.kind === 'audio') return false;
      if (!term) return true;
      return (
        asset.name.toLowerCase().includes(term) ||
        asset.projectName.toLowerCase().includes(term) ||
        (asset.detail || '').toLowerCase().includes(term)
      );
    });
  }, [libraryAssets, librarySearch]);

  const filteredPalette = useMemo(() => {
    const term = paletteSearch.trim().toLowerCase();
    return paletteItems.filter((item) => {
      const matchesGroup = activePaletteGroup === 'all' || item.group === activePaletteGroup;
      const matchesTerm = !term
        || item.label.toLowerCase().includes(term)
        || item.description.toLowerCase().includes(term)
        || item.portLabel.toLowerCase().includes(term);
      return matchesGroup && matchesTerm;
    });
  }, [activePaletteGroup, paletteSearch]);

  const paletteCounts = useMemo(() => {
    return paletteItems.reduce((counts, item) => {
      counts[item.group] = (counts[item.group] || 0) + 1;
      return counts;
    }, {} as Record<PaletteGroupId, number>);
  }, []);

  const handleInsertQuickTemplate = useCallback((templateId: string) => {
    const currentViewport = getViewport();
    const startX = Math.round((220 - currentViewport.x) / currentViewport.zoom);
    const startY = Math.round((120 - currentViewport.y) / currentViewport.zoom);
    const created: Node<NodeData>[] = [];
    const nextEdges: Edge[] = [];

    const add = (type: NodeKind, dx: number, dy: number, data?: NodeData) => {
      const node = createNodeInstance(type, { x: startX + dx, y: startY + dy }, data);
      created.push(node);
      return node;
    };
    const link = (source: Node<NodeData>, sourceHandle: string, target: Node<NodeData>, targetHandle: string) => {
      nextEdges.push({
        id: `e-${source.id}-${target.id}-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
        source: source.id,
        sourceHandle,
        target: target.id,
        targetHandle,
        animated: true,
      });
    };

    if (templateId === 'text-image') {
      const prompt = add('prompt', 0, 0);
      const model = add('model', 360, 0);
      const sampler = add('sampler', 720, 0);
      const output = add('output', 1080, 0);
      link(prompt, 'prompt', model, 'prompt');
      link(model, 'model', sampler, 'model');
      link(sampler, 'sampled', output, 'image');
    }

    if (templateId === 'image-video') {
      const prompt = add('prompt', 0, 0);
      const image = add('imageInput', 0, 240);
      const video = add('video', 420, 120);
      link(prompt, 'prompt', video, 'prompt');
      link(image, 'image', video, 'image');
    }

    if (templateId === 'image-polish') {
      const image = add('imageInput', 0, 0);
      const filter = add('filter', 360, 0);
      const upscale = add('upscale', 720, 0);
      const output = add('output', 1080, 0);
      link(image, 'image', filter, 'image');
      link(filter, 'filtered', upscale, 'image');
      link(upscale, 'upscaled', output, 'image');
    }

    if (templateId === 'agent-concept') {
      const brief = add('prompt', 0, 0, {
        label: 'Creative Brief',
        value: 'Create a cinematic concept frame for a tense AI film scene with precise lens, lighting, character, and mood notes.',
      });
      const agent = add('llm', 360, 0, {
        label: 'Prompt Agent',
        params: {
          model: 'gemini-3-pro-replicate',
          systemPrompt: 'Rewrite the brief as one production-ready visual generation prompt. Include lens, lighting, composition, mood, and constraints.',
        },
      });
      const expandedPrompt = add('prompt', 720, 0, { label: 'Expanded Prompt', value: '' });
      const model = add('model', 1080, 0, {
        label: 'Image Model',
        selected: 'Gemini 3 Pro',
        params: {
          aspectRatio: '16:9',
          aspectRatioMode: 'preset',
          customAspectRatio: '',
          loraUrl: '',
          loraScale: 0.75,
        },
      });
      const sampler = add('sampler', 1440, 0, { label: 'Sampler', selected: 'Cinematic' });
      const output = add('output', 1800, 0);
      link(brief, 'prompt', agent, 'prompt');
      link(agent, 'text', expandedPrompt, 'text');
      link(expandedPrompt, 'prompt', model, 'prompt');
      link(model, 'model', sampler, 'model');
      link(sampler, 'sampled', output, 'image');
    }

    if (templateId === 'vfx-matte') {
      const image = add('imageInput', 0, 0, { label: 'Plate In' });
      const cutout = add('bgRemove', 360, 0, { label: 'Subject Cutout' });
      const filter = add('filter', 720, 0, {
        label: 'Look Match',
        params: {
          brightness: 104,
          contrast: 112,
          saturate: 94,
          hueRotate: 0,
          blur: 0,
          grain: 22,
          halation: 18,
          bloom: 10,
          vignette: 18,
          lut: 'kodak-2383',
          lutIntensity: 70,
          lutName: '',
          lutText: '',
        },
      });
      const upscale = add('upscale', 1080, 0, { label: 'Plate Upscale', selected: 'Crystal Upscaler', params: { scale: 2, resolution: '' } });
      const output = add('output', 1440, 0, { label: 'VFX Plate Out' });
      link(image, 'image', cutout, 'image');
      link(cutout, 'cutout', filter, 'image');
      link(filter, 'filtered', upscale, 'image');
      link(upscale, 'upscaled', output, 'image');
    }

    if (templateId === 'two-plate-comp') {
      const base = add('imageInput', 0, 0, { label: 'Base Plate' });
      const overlay = add('imageInput', 0, 220, { label: 'Overlay Plate' });
      const blend = add('blend', 380, 110, { label: 'Merge A/B', params: { mode: 'screen', opacity: 0.72 } });
      const filter = add('filter', 760, 110, {
        label: 'Final Look',
        params: {
          brightness: 100,
          contrast: 108,
          saturate: 105,
          hueRotate: 0,
          blur: 0,
          grain: 15,
          halation: 10,
          bloom: 16,
          vignette: 12,
          lut: 'none',
          lutIntensity: 100,
          lutName: '',
          lutText: '',
        },
      });
      const output = add('output', 1140, 110, { label: 'Composite Out' });
      link(base, 'image', blend, 'base');
      link(overlay, 'image', blend, 'overlay');
      link(blend, 'composited', filter, 'image');
      link(filter, 'filtered', output, 'image');
    }

    if (templateId === 'video-polish') {
      const video = add('imageInput', 0, 0, { label: 'Video In' });
      const interpolate = add('rife', 360, 0, { label: 'Motion Smooth' });
      const upscale = add('upscale', 720, 0, {
        label: 'Video Upscale',
        selected: 'Crystal Video Upscaler',
        params: { scale: 2, resolution: '1080p' },
      });
      link(video, 'image', interpolate, 'video');
      link(interpolate, 'video', upscale, 'image');
    }

    if (created.length === 0) return;
    const withHandlers = attachNodeHandlers(created);
    setNodes((prev) => prev.concat(withHandlers));
    setEdges((prev) => prev.concat(nextEdges));
    setSelectedNodeId(withHandlers[0]?.id || null);
    if (withHandlers.some((node) => node.type === 'imageInput')) {
      const firstImageNode = withHandlers.find((node) => node.type === 'imageInput');
      if (firstImageNode) setSelectedImageNodeId(firstImageNode.id);
    }
    const template = quickTemplateOptions.find((item) => item.id === templateId);
    if (template?.backend === 'Local') setExecutionMode('local');
    if (template?.backend === 'Cloud') setExecutionMode('cloud');
    if (template?.backend === 'Hybrid') setExecutionMode('hybrid');
    setRunStatus(`Template inserted: ${template?.label || templateId}`);
  }, [attachNodeHandlers, createNodeInstance, getViewport, setEdges, setExecutionMode, setNodes]);

  const validation = useMemo(() => {
    const errors: string[] = [];
    const pipelines: PipelineTarget[] = [];
    const nodeMap = new Map(nodes.map((node) => [node.id, node]));
    const incoming = new Map<string, string[]>();

    edges.forEach((edge) => {
      if (!edge.target) return;
      const list = incoming.get(edge.target) || [];
      list.push(edge.source);
      incoming.set(edge.target, list);
    });

    const findUpstreamNode = (startId: string, type: NodeKind): Node<NodeData> | null => {
      const queue = [startId];
      const visited = new Set<string>();
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        const sources = incoming.get(current) || [];
        for (const sourceId of sources) {
          if (visited.has(sourceId)) continue;
          visited.add(sourceId);
          const node = nodeMap.get(sourceId);
          if (node?.type === type) return node;
          queue.push(sourceId);
        }
      }
      return null;
    };

    const findUpstreamNodes = (startId: string, type: NodeKind): Node<NodeData>[] => {
      const queue = [startId];
      const visited = new Set<string>();
      const matches: Node<NodeData>[] = [];
      while (queue.length > 0) {
        const current = queue.shift();
        if (!current) continue;
        const sources = incoming.get(current) || [];
        for (const sourceId of sources) {
          if (visited.has(sourceId)) continue;
          visited.add(sourceId);
          const node = nodeMap.get(sourceId);
          if (node?.type === type) {
            matches.push(node);
          } else {
            queue.push(sourceId);
          }
        }
      }
      return matches;
    };

    const findHandleSource = (targetId: string, targetHandle: string) => {
      const edge = edges.find((edgeItem) => edgeItem.target === targetId && edgeItem.targetHandle === targetHandle);
      if (!edge) return null;
      const source = nodeMap.get(edge.source);
      return source || null;
    };

    const hasHandleConnection = (targetId: string, targetHandle: string) => {
      return edges.some((edgeItem) => edgeItem.target === targetId && edgeItem.targetHandle === targetHandle);
    };

    const addError = (message: string) => {
      if (errors.includes(message)) return;
      errors.push(message);
    };

    const outputNodes = nodes.filter((node) =>
      node.type === 'output'
      || node.type === 'video'
      || node.type === 'upscale'
      || node.type === 'filter'
      || node.type === 'chroma'
      || node.type === 'blend'
      || node.type === 'sketch'
      || node.type === 'openpose'
      || node.type === 'depth'
      || node.type === 'faceRestore'
      || node.type === 'bgRemove'
      || node.type === 'rife'
      || node.type === 'llm'
    );
    if (outputNodes.length === 0) {
      addError('Add an Output, Video, or Upscale node to run.');
      return { pipelines, errors };
    }

    outputNodes.forEach((node) => {
      const isSink = !edges.some((edgeItem) => edgeItem.source === node.id);

      if (node.type === 'output') {
        const hasImageInput = hasHandleConnection(node.id, 'image');
        if (!hasImageInput) {
          const promptNode = findUpstreamNode(node.id, 'prompt');
          const modelNode = findUpstreamNode(node.id, 'model');
          const promptValue = promptNode?.data.value?.trim() || '';
          const modelLabel = modelNode?.data.selected?.trim() || '';

          if (!promptValue) {
            addError(`Output ${node.id} needs a prompt node or an image input.`);
          }
          if (!modelLabel) {
            addError(`Output ${node.id} needs a model selection.`);
          } else if (!IMAGE_MODEL_SET.has(modelLabel)) {
            addError(`Output ${node.id} uses an unsupported model (${modelLabel}).`);
          }
        }

        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Output',
            task: 'generate',
          });
        }
      }

      if (node.type === 'video') {
        const promptNode = findUpstreamNode(node.id, 'prompt');
        const promptValue = promptNode?.data.value?.trim() || '';
        const modelLabel = node.data.selected?.trim() || '';
        const imageSource = findHandleSource(node.id, 'image');
        const hasImageInput = Boolean(imageSource);
        const imageValue = imageSource?.data.value?.trim() || '';

        if (!promptValue) {
          addError(`Video ${node.id} needs a prompt node.`);
        }
        if (!modelLabel) {
          addError(`Video ${node.id} needs a model selection.`);
        } else if (!VIDEO_MODEL_SET.has(modelLabel)) {
          addError(`Video ${node.id} uses an unsupported model (${modelLabel}).`);
        }
        if (modelLabel === 'Wan I2V' && !hasImageInput) {
          addError(`Video ${node.id} (Wan I2V) needs an Image In node.`);
        }
        if (imageSource?.type === 'video') {
          addError(`Video ${node.id} expects an image reference, not a video node.`);
        }
        if (imageSource?.type === 'imageInput' && imageValue && isVideoAsset(imageValue)) {
          addError(`Video ${node.id} expects an image reference, not a video URL.`);
        }

        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'video',
            prompt: '',
            model: modelLabel || 'Video',
            task: 'generate',
          });
        }
      }

      if (node.type === 'upscale') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        const modelLabel = node.data.selected?.trim() || '';

        if (!modelLabel) {
          addError(`Upscale ${node.id} needs a model selection.`);
        } else if (!UPSCALE_IMAGE_SET.has(modelLabel) && !UPSCALE_VIDEO_SET.has(modelLabel)) {
          addError(`Upscale ${node.id} uses an unsupported model (${modelLabel}).`);
        }
        if (!imageSource) {
          addError(`Upscale ${node.id} needs an Image In node.`);
        }
        if (modelLabel && UPSCALE_VIDEO_SET.has(modelLabel) && imageSource?.type === 'imageInput' && imageValue && !isVideoAsset(imageValue)) {
          addError(`Upscale ${node.id} uses video upscaler but input is not a video URL.`);
        }
        if (modelLabel && UPSCALE_IMAGE_SET.has(modelLabel) && imageSource?.type === 'video') {
          addError(`Upscale ${node.id} expects an image input, not a video node.`);
        }

        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: UPSCALE_VIDEO_SET.has(modelLabel) ? 'video' : 'image',
            prompt: '',
            model: modelLabel || 'Upscale',
            task: 'upscale',
          });
        }
      }

      if (node.type === 'filter') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`Filter ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`Filter ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`Filter ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Filter',
            task: 'filter',
          });
        }
      }

      if (node.type === 'chroma') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`Chroma ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`Chroma ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`Chroma ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Chroma Key',
            task: 'chroma',
          });
        }
      }

      if (node.type === 'sketch') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`Sketch ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`Sketch ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`Sketch ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Sketch',
            task: 'sketch',
          });
        }
      }

      if (node.type === 'openpose') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`OpenPose ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`OpenPose ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`OpenPose ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'OpenPose',
            task: 'openpose',
          });
        }
      }

      if (node.type === 'depth') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`Depth ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`Depth ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`Depth ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Depth Map',
            task: 'depth',
          });
        }
      }

      if (node.type === 'faceRestore') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`Face Restore ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`Face Restore ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`Face Restore ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Face Restore',
            task: 'faceRestore',
          });
        }
      }

      if (node.type === 'bgRemove') {
        const imageSource = findHandleSource(node.id, 'image');
        const imageValue = imageSource?.data.value?.trim() || '';
        if (!imageSource) {
          addError(`Background Remove ${node.id} needs an Image In node.`);
        } else if (imageSource?.type === 'video') {
          addError(`Background Remove ${node.id} requires an image input.`);
        } else if (imageSource?.type === 'imageInput' && isVideoAsset(imageValue)) {
          addError(`Background Remove ${node.id} requires an image input.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Background Remove',
            task: 'bgRemove',
          });
        }
      }

      if (node.type === 'rife') {
        const videoSource = findHandleSource(node.id, 'video');
        const videoValue = videoSource?.data.value?.trim() || '';
        if (!videoSource) {
          addError(`RIFE ${node.id} needs a video input.`);
        } else if (videoSource?.type === 'imageInput' && videoValue && !isVideoAsset(videoValue)) {
          addError(`RIFE ${node.id} requires a video URL.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'video',
            prompt: '',
            model: 'RIFE',
            task: 'rife',
          });
        }
      }

      if (node.type === 'blend') {
        const baseNode = findHandleSource(node.id, 'base');
        const overlayNode = findHandleSource(node.id, 'overlay');
        const baseValue = baseNode?.data.value?.trim() || '';
        const overlayValue = overlayNode?.data.value?.trim() || '';
        if (!baseNode || !overlayNode) {
          addError(`Composite ${node.id} needs base + overlay inputs.`);
        } else if (baseNode?.type === 'video' || overlayNode?.type === 'video') {
          addError(`Composite ${node.id} requires image inputs.`);
        } else if (baseNode?.type === 'upscale' && UPSCALE_VIDEO_SET.has(baseNode.data.selected || '')) {
          addError(`Composite ${node.id} requires image inputs.`);
        } else if (overlayNode?.type === 'upscale' && UPSCALE_VIDEO_SET.has(overlayNode.data.selected || '')) {
          addError(`Composite ${node.id} requires image inputs.`);
        } else if (baseNode?.type === 'imageInput' && !baseValue) {
          addError(`Composite ${node.id} base input is empty.`);
        } else if (overlayNode?.type === 'imageInput' && !overlayValue) {
          addError(`Composite ${node.id} overlay input is empty.`);
        } else if (baseNode?.type === 'imageInput' && isVideoAsset(baseValue)) {
          addError(`Composite ${node.id} requires image inputs.`);
        } else if (overlayNode?.type === 'imageInput' && isVideoAsset(overlayValue)) {
          addError(`Composite ${node.id} requires image inputs.`);
        }
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'image',
            prompt: '',
            model: 'Composite',
            task: 'blend',
          });
        }
      }

      if (node.type === 'llm') {
        const promptNode = findUpstreamNode(node.id, 'prompt');
        const promptValue = promptNode?.data.value?.trim() || node.data.value?.trim() || '';
        if (!promptValue) {
          addError(`LLM ${node.id} needs a prompt.`);
        }
        const llmModel = node.data.params?.model === 'gpt-5-nano'
          ? 'GPT-5 Nano (Replicate)'
          : 'Gemini 3 Pro (Replicate)';
        if (isSink) {
          pipelines.push({
            nodeId: node.id,
            kind: 'text',
            prompt: '',
            model: llmModel,
            task: 'llm',
          });
        }
      }
    });

    if (pipelines.length === 0) {
      addError('No end nodes to run. Leave a node unconnected or add an Output node.');
    }

    return { pipelines, errors };
  }, [nodes, edges, isVideoAsset]);

  const resolveAssetPayload = useCallback(async (value?: string | null) => {
    if (!value) return undefined;
    if (value.startsWith('data:')) {
      const match = value.match(/^data:(.*?);base64,(.*)$/);
      if (match) {
        return { mimeType: match[1], base64: match[2] };
      }
    }
    return getBase64FromUrl(value);
  }, []);

  const nodeMap = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  const incomingMap = useMemo(() => {
    const map = new Map<string, string[]>();
    edges.forEach((edge) => {
      if (!edge.target) return;
      const list = map.get(edge.target) || [];
      list.push(edge.source);
      map.set(edge.target, list);
    });
    return map;
  }, [edges]);

  const findUpstreamNode = useCallback((startId: string, type: NodeKind) => {
    const queue = [startId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      const sources = incomingMap.get(current) || [];
      for (const sourceId of sources) {
        if (visited.has(sourceId)) continue;
        visited.add(sourceId);
        const node = nodeMap.get(sourceId);
        if (node?.type === type) return node;
        queue.push(sourceId);
      }
    }
    return null;
  }, [incomingMap, nodeMap]);

  const findHandleSource = useCallback((targetId: string, targetHandle: string) => {
    const edge = edges.find((edgeItem) => edgeItem.target === targetId && edgeItem.targetHandle === targetHandle);
    if (!edge) return null;
    return nodeMap.get(edge.source) || null;
  }, [edges, nodeMap]);

  const pipelineNeedsApi = useCallback((nodeId: string) => {
    const queue = [nodeId];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current) continue;
      if (visited.has(current)) continue;
      visited.add(current);
      const node = nodeMap.get(current);
      if (node?.type && ['model', 'video', 'upscale', 'openpose', 'depth', 'faceRestore', 'bgRemove', 'rife', 'llm'].includes(node.type)) {
        return true;
      }
      const sources = incomingMap.get(current) || [];
      sources.forEach((sourceId) => queue.push(sourceId));
    }
    return false;
  }, [incomingMap, nodeMap]);

  const loadImageElement = useCallback((src: string) => {
    return new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('Failed to load image.'));
      img.src = src;
    });
  }, []);

  const getGrainPattern = useCallback((ctx: CanvasRenderingContext2D) => {
    let canvas = grainCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = 96;
      canvas.height = 96;
      grainCanvasRef.current = canvas;
    }
    const grainCtx = canvas.getContext('2d');
    if (!grainCtx) return null;
    const imageData = grainCtx.createImageData(canvas.width, canvas.height);
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
      const value = Math.floor(Math.random() * 255);
      data[i] = value;
      data[i + 1] = value;
      data[i + 2] = value;
      data[i + 3] = 255;
    }
    grainCtx.putImageData(imageData, 0, 0);
    return ctx.createPattern(canvas, 'repeat');
  }, []);

  const drawGrain = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, strength: number) => {
    if (strength <= 0) return;
    const pattern = getGrainPattern(ctx);
    if (!pattern) return;
    ctx.save();
    ctx.globalCompositeOperation = 'soft-light';
    ctx.globalAlpha = Math.min(0.6, (strength / 100) * 0.35);
    ctx.filter = 'none';
    ctx.fillStyle = pattern;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }, [getGrainPattern]);

  const drawGlowOverlay = useCallback((
    ctx: CanvasRenderingContext2D,
    source: CanvasImageSource,
    width: number,
    height: number,
    baseFilter: string,
    strength: number,
    options: { blur: number; opacity: number; tint: boolean },
  ) => {
    if (strength <= 0) return;
    ctx.save();
    ctx.globalCompositeOperation = 'screen';
    ctx.globalAlpha = options.opacity;
    const blurFilter = `blur(${options.blur}px)`;
    const tintFilter = options.tint ? `${blurFilter} saturate(140%) hue-rotate(-8deg)` : blurFilter;
    ctx.filter = baseFilter ? `${baseFilter} ${tintFilter}` : tintFilter;
    ctx.drawImage(source, 0, 0, width, height);
    ctx.restore();
  }, []);

  const drawVignette = useCallback((ctx: CanvasRenderingContext2D, width: number, height: number, strength: number) => {
    if (strength <= 0) return;
    const intensity = Math.min(1, Math.max(0, strength / 100));
    const maxRadius = Math.max(width, height) / 2;
    const innerRadius = maxRadius * (0.55 - intensity * 0.2);
    const outerRadius = maxRadius * 0.95;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.filter = 'none';
    const gradient = ctx.createRadialGradient(width / 2, height / 2, innerRadius, width / 2, height / 2, outerRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${Math.min(0.7, intensity * 0.75)})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
  }, []);

  const applyFilterToImage = useCallback(async (inputUrl: string, params: Record<string, any> = {}) => {
    const img = await loadImageElement(inputUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available.');

    const filters: ClipFilters = normalizeFilters({
      brightness: Number(params.brightness ?? 100),
      contrast: Number(params.contrast ?? 100),
      saturate: Number(params.saturate ?? 100),
      hueRotate: Number(params.hueRotate ?? 0),
      grain: Number(params.grain ?? 0),
      halation: Number(params.halation ?? 0),
      bloom: Number(params.bloom ?? 0),
      vignette: Number(params.vignette ?? 0),
      lut: (params.lut as LutId) || 'none',
      lutIntensity: Number(params.lutIntensity ?? 100),
    });
    const blur = Number(params.blur ?? 0);
    const baseFilter = buildFilterString(filters);
    const combinedFilter = [baseFilter, blur > 0 ? `blur(${blur}px)` : ''].filter(Boolean).join(' ');

    let scratch = scratchCanvasRef.current;
    if (!scratch) {
      scratch = document.createElement('canvas');
      scratchCanvasRef.current = scratch;
    }
    scratch.width = width;
    scratch.height = height;
    const scratchCtx = scratch.getContext('2d');
    if (!scratchCtx) throw new Error('Canvas not available.');
    scratchCtx.clearRect(0, 0, width, height);
    scratchCtx.filter = combinedFilter || 'none';
    scratchCtx.drawImage(img, 0, 0, width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(scratch, 0, 0, width, height);

    if (filters.lut === 'custom' && params.lutText) {
      try {
        const lut = parseCubeLut(String(params.lutText));
        const imageData = ctx.getImageData(0, 0, width, height);
        applyCubeLutToImageData(imageData, lut, (filters.lutIntensity || 0) / 100);
        ctx.putImageData(imageData, 0, 0);
      } catch (error) {
        console.warn('Failed to apply custom LUT.', error);
      }
    }

    const halationStrength = getHalationStrength(filters);
    const bloomStrength = getBloomStrength(filters);
    if (halationStrength > 0) {
      const intensity = Math.min(1, Math.max(0, halationStrength / 100));
      drawGlowOverlay(ctx, scratch, width, height, baseFilter, halationStrength, {
        blur: 8 + intensity * 18,
        opacity: Math.min(0.45, intensity * 0.4),
        tint: true,
      });
    }
    if (bloomStrength > 0) {
      const intensity = Math.min(1, Math.max(0, bloomStrength / 100));
      drawGlowOverlay(ctx, scratch, width, height, baseFilter, bloomStrength, {
        blur: 6 + intensity * 20,
        opacity: Math.min(0.45, intensity * 0.5),
        tint: false,
      });
    }

    drawGrain(ctx, width, height, getGrainStrength(filters));
    drawVignette(ctx, width, height, getVignetteStrength(filters));

    return canvas.toDataURL('image/png');
  }, [buildFilterString, drawGlowOverlay, drawGrain, drawVignette, loadImageElement]);

  const applyChromaKeyToImage = useCallback(async (inputUrl: string, params: Record<string, any> = {}) => {
    const img = await loadImageElement(inputUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available.');
    ctx.drawImage(img, 0, 0, width, height);
    const imageData = ctx.getImageData(0, 0, width, height);
    const data = imageData.data;
    const keyColor = params.keyColor || '#00ff00';
    const tolerance = Number(params.tolerance ?? 0.25);
    const hex = keyColor.replace('#', '');
    const keyR = parseInt(hex.substring(0, 2), 16);
    const keyG = parseInt(hex.substring(2, 4), 16);
    const keyB = parseInt(hex.substring(4, 6), 16);
    const threshold = Math.max(0, Math.min(1, tolerance)) * 255 * Math.sqrt(3);
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const distance = Math.sqrt(
        Math.pow(r - keyR, 2) + Math.pow(g - keyG, 2) + Math.pow(b - keyB, 2)
      );
      if (distance < threshold) {
        data[i + 3] = 0;
      }
    }
    ctx.putImageData(imageData, 0, 0);
    return canvas.toDataURL('image/png');
  }, [loadImageElement]);

  const applySketchToImage = useCallback(async (inputUrl: string, params: Record<string, any> = {}) => {
    const img = await loadImageElement(inputUrl);
    const width = img.naturalWidth || img.width;
    const height = img.naturalHeight || img.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available.');
    ctx.drawImage(img, 0, 0, width, height);
    const src = ctx.getImageData(0, 0, width, height);
    const dst = ctx.createImageData(width, height);
    const gray = new Float32Array(width * height);
    for (let i = 0; i < src.data.length; i += 4) {
      const r = src.data[i];
      const g = src.data[i + 1];
      const b = src.data[i + 2];
      gray[i / 4] = 0.299 * r + 0.587 * g + 0.114 * b;
    }
    const strength = Math.max(0.5, Math.min(3, Number(params.strength ?? 1)));
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        const idx = y * width + x;
        const gx =
          -gray[idx - width - 1] - 2 * gray[idx - 1] - gray[idx + width - 1]
          + gray[idx - width + 1] + 2 * gray[idx + 1] + gray[idx + width + 1];
        const gy =
          -gray[idx - width - 1] - 2 * gray[idx - width] - gray[idx - width + 1]
          + gray[idx + width - 1] + 2 * gray[idx + width] + gray[idx + width + 1];
        const mag = Math.min(255, Math.sqrt(gx * gx + gy * gy) * strength);
        const value = 255 - mag;
        const outIndex = idx * 4;
        dst.data[outIndex] = value;
        dst.data[outIndex + 1] = value;
        dst.data[outIndex + 2] = value;
        dst.data[outIndex + 3] = 255;
      }
    }
    ctx.putImageData(dst, 0, 0);
    return canvas.toDataURL('image/png');
  }, [loadImageElement]);

  const applyBlendToImage = useCallback(async (
    baseUrl: string,
    overlayUrl: string,
    params: Record<string, any> = {}
  ) => {
    const [base, overlay] = await Promise.all([loadImageElement(baseUrl), loadImageElement(overlayUrl)]);
    const width = base.naturalWidth || base.width;
    const height = base.naturalHeight || base.height;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas not available.');
    ctx.drawImage(base, 0, 0, width, height);
    const modeMap: Record<string, GlobalCompositeOperation> = {
      normal: 'source-over',
      screen: 'screen',
      multiply: 'multiply',
      overlay: 'overlay',
      'soft-light': 'soft-light',
      lighten: 'lighten',
      darken: 'darken',
    };
    ctx.globalCompositeOperation = modeMap[params.mode] || 'source-over';
    ctx.globalAlpha = Number(params.opacity ?? 0.8);
    ctx.drawImage(overlay, 0, 0, width, height);
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    return canvas.toDataURL('image/png');
  }, [loadImageElement]);

  const runImagePipeline = useCallback(async (
    prompt: string,
    modelLabel: string,
    reference?: { base64: string; mimeType: string } | null,
    referenceIsSketch?: boolean,
    aspectRatio?: string,
    loraOptions?: { loraUrl?: string; loraScale?: number }
  ) => {
    const ratio = aspectRatio || '16:9';
    switch (modelLabel) {
      case 'Imagen':
        return generateImageWithImagen(prompt, ratio as any);
      case 'Gemini 3 Pro':
        if (reference) {
          return generateImageWithReferences(
            prompt,
            referenceIsSketch ? [] : [reference],
            referenceIsSketch ? reference : undefined,
            'gemini-3-pro-image-preview',
            { aspectRatio: ratio, imageSize: '2K' }
          );
        }
        return generateImageWithGemini3Pro(prompt, ratio, '2K');
      case 'Nano Banana 2':
      case 'Gemini Flash':
        if (reference) {
          return generateImageWithReferences(
            prompt,
            referenceIsSketch ? [] : [reference],
            referenceIsSketch ? reference : undefined,
            'gemini-3.1-flash-image-preview',
            { aspectRatio: ratio, imageSize: '1K' }
          );
        }
        return generateImageWithNano(prompt, { aspectRatio: ratio, imageSize: '1K' });
      case 'Gemini 3 Pro (Replicate)':
        return generateImageWithGemini3ProReplicateOnly(
          prompt,
          ratio as any,
          '2K',
          reference && !referenceIsSketch ? [reference] : undefined
        );
      case 'Seedream':
        if (reference) {
          return generateImageWithSeedreamReferences(prompt, [reference], ratio, '2K');
        }
        return generateImageWithSeedream(prompt, ratio, '2K');
      case 'Flux':
        return generateImageWithFlux(prompt, ratio, loraOptions);
      case 'Flux 2 Klein':
        return generateImageWithFluxKlein(prompt, ratio, reference || undefined, loraOptions);
      case 'Flux 2 Turbo':
        return generateImageWithFlux2Turbo(prompt, ratio, reference || undefined, loraOptions);
      case 'Z-Image':
        return generateImageWithZImage(prompt, ratio as any, loraOptions);
      case 'Z-Turbo':
        return generateImageWithZTurbo(prompt, ratio as any, loraOptions);
      case 'Qwen':
        return generateImageWithQwenImage(prompt, ratio);
      case 'Nano Banana Pro':
        return generateImageWithNanoBananaPro(prompt, ratio as any, '1K', reference ? [reference] : undefined);
      case 'Qwen Image Max (FAL)':
        return generateImageWithFalQwenImageMax(prompt, { aspectRatio: ratio as any });
      case 'Grok Imagine (FAL)':
        return generateImageWithFalGrokImagine(prompt, { aspectRatio: ratio as any });
      case 'GPT Image 1.5':
        return generateImageWithGptImage15(prompt, ratio, reference ? [reference] : undefined);
      case 'Runway Gen-4 Turbo':
        return generateImageWithRunwayGen4Turbo(prompt, ratio);
      case 'ControlNet':
        if (!reference) {
          throw new Error('ControlNet requires an Image In node.');
        }
        return generateImageWithControlNet(prompt, reference);
      case 'ControlNet Scribble':
        if (!reference) {
          throw new Error('ControlNet Scribble requires an Image In node.');
        }
        return generateImageWithControlNetScribble(prompt, reference);
      case 'ControlNet Normal':
        if (!reference) {
          throw new Error('ControlNet Normal requires an Image In node.');
        }
        return generateImageWithControlNetNormal(prompt, reference);
      case 'Rodin 3D':
        if (!reference) {
          throw new Error('Rodin 3D requires an Image In node.');
        }
        return generateModelWithRodin(prompt, reference);
      default:
        throw new Error(`Unsupported image model: ${modelLabel}`);
    }
  }, []);

  const runVideoPipeline = useCallback(async (
    prompt: string,
    modelLabel: string,
    imageInput?: string | null,
    aspectRatio?: string
  ) => {
    const ratio = aspectRatio || '16:9';
    const reference = await resolveAssetPayload(imageInput);
    switch (modelLabel) {
      case 'Veo 3.1 Fast':
        return generateVideoWithVeo(
          prompt,
          (message) => setRunStatus(message),
          ratio as any,
          reference,
          'veo-3.1-fast-generate-preview'
        );
      case 'Veo 3.1':
        return generateVideoWithVeo(
          prompt,
          (message) => setRunStatus(message),
          ratio as any,
          reference,
          'veo-3.1-generate-preview'
        );
      case 'Seedance 1.5':
        return generateVideoWithSeedance(prompt, reference);
      case 'Kling 2.6':
        return generateVideoWithKling26(prompt, {
          startImage: reference,
          aspectRatio: ratio as any,
          duration: 5,
          generateAudio: true,
        });
      case 'Wan I2V':
        if (!reference) throw new Error('Wan I2V requires an Image In node.');
        return generateVideoWithWanI2V(prompt, reference);
      default:
        throw new Error(`Unsupported video model: ${modelLabel}`);
    }
  }, [resolveAssetPayload]);

  const runUpscalePipeline = useCallback(async (
    modelLabel: string,
    assetInput?: string | null,
    params?: Record<string, any>
  ) => {
    const payload = await resolveAssetPayload(assetInput);
    if (!payload) {
      throw new Error('Upscale requires an Image In node.');
    }
    const options = {
      scale: Number.isFinite(Number(params?.scale)) ? Number(params.scale) : undefined,
      resolution: typeof params?.resolution === 'string' && params.resolution.trim() ? params.resolution.trim() : undefined,
    };
    switch (modelLabel) {
      case 'Crystal Upscaler':
        return upscaleImageWithCrystal(payload, options);
      case 'Clarity Upscaler':
        return upscaleImageWithClarity(payload, options);
      case 'Topaz Upscale':
        return upscaleImageWithTopaz(payload, options);
      case 'Real-ESRGAN 4x':
        return upscaleImage(payload, options);
      case 'Crystal Video Upscaler':
        return upscaleVideoWithCrystal(payload, options);
      case 'Topaz Video Upscale':
        return upscaleVideoWithTopaz(payload, options);
      default:
        throw new Error(`Unsupported upscale model: ${modelLabel}`);
    }
  }, [resolveAssetPayload]);

  const buildImageItem = useCallback((label: string, url: string): MediaItem => {
    return {
      id: `${label.toLowerCase().replace(/\s+/g, '-')}-${Date.now()}`,
      name: `${label.toLowerCase().replace(/\s+/g, '_')}_${Date.now()}.png`,
      type: 'image',
      url,
      source: 'generated',
    };
  }, []);

  const runFilterPipeline = useCallback(async (inputUrl: string, params?: Record<string, any>) => {
    const outputUrl = await applyFilterToImage(inputUrl, params);
    return buildImageItem('filter', outputUrl);
  }, [applyFilterToImage, buildImageItem]);

  const runChromaPipeline = useCallback(async (inputUrl: string, params?: Record<string, any>) => {
    const outputUrl = await applyChromaKeyToImage(inputUrl, params);
    return buildImageItem('chroma_key', outputUrl);
  }, [applyChromaKeyToImage, buildImageItem]);

  const runSketchPipeline = useCallback(async (inputUrl: string, params?: Record<string, any>) => {
    const outputUrl = await applySketchToImage(inputUrl, params);
    return buildImageItem('sketch', outputUrl);
  }, [applySketchToImage, buildImageItem]);

  const runBlendPipeline = useCallback(async (
    baseUrl: string,
    overlayUrl: string,
    params?: Record<string, any>
  ) => {
    const outputUrl = await applyBlendToImage(baseUrl, overlayUrl, params);
    return buildImageItem('composite', outputUrl);
  }, [applyBlendToImage, buildImageItem]);

  const runOpenPosePipeline = useCallback(async (inputUrl: string, params?: Record<string, any>) => {
    const payload = await resolveAssetPayload(inputUrl);
    if (!payload) {
      throw new Error('OpenPose requires an Image In node.');
    }
    return generateOpenPose(payload, {
      includeFace: params?.includeFace ?? true,
      includeHands: params?.includeHands ?? true,
    });
  }, [resolveAssetPayload]);

  const runDepthPipeline = useCallback(async (inputUrl: string, params?: Record<string, any>) => {
    const payload = await resolveAssetPayload(inputUrl);
    if (!payload) {
      throw new Error('Depth Map requires an Image In node.');
    }
    return generateDepthMapWithDpt(payload, {
      model: params?.model === 'midas' ? 'midas' : 'dpt',
    });
  }, [resolveAssetPayload]);

  const runFaceRestorePipeline = useCallback(async (inputUrl: string, params?: Record<string, any>) => {
    const payload = await resolveAssetPayload(inputUrl);
    if (!payload) {
      throw new Error('Face Restore requires an Image In node.');
    }
    if (params?.model === 'restoreformer') {
      return restoreFaceWithRestoreFormer(payload);
    }
    return restoreFaceWithGfpgan(payload);
  }, [resolveAssetPayload]);

  const runBackgroundRemovePipeline = useCallback(async (inputUrl: string) => {
    const payload = await resolveAssetPayload(inputUrl);
    if (!payload) {
      throw new Error('Background Remove requires an Image In node.');
    }
    return removeBackgroundWithRembg(payload);
  }, [resolveAssetPayload]);

  const runRifePipeline = useCallback(async (inputUrl: string) => {
    const payload = await resolveAssetPayload(inputUrl);
    if (!payload) {
      throw new Error('RIFE requires a video input.');
    }
    return interpolateVideoWithRife(payload);
  }, [resolveAssetPayload]);

  const runLlmPipeline = useCallback(async (promptText: string, params?: Record<string, any>) => {
    const model = params?.model || 'gemini-3-pro-replicate';
    const options = {
      systemPrompt: params?.systemPrompt,
      temperature: 0.4,
      maxTokens: 800,
    };
    if (model === 'gpt-5-nano') {
      return generateTextWithGpt5NanoReplicate(promptText, options);
    }
    return generateTextWithGemini3ProReplicate(promptText, options);
  }, []);

  const resolveNodeOutput = useCallback(async (
    nodeId: string,
    cache: Map<string, EvaluatedOutput>,
    inProgress: Set<string>,
  ): Promise<EvaluatedOutput> => {
    if (cache.has(nodeId)) {
      return cache.get(nodeId)!;
    }
    if (inProgress.has(nodeId)) {
      throw new Error('Graph has a cycle. Remove circular connections.');
    }
    const node = nodeMap.get(nodeId);
    if (!node || !node.type) {
      throw new Error('Missing node in graph.');
    }

    inProgress.add(nodeId);
    const store = (output: EvaluatedOutput) => {
      cache.set(nodeId, output);
      inProgress.delete(nodeId);
      return output;
    };

    const resolvePromptText = async (targetId: string) => {
      const promptSource = findHandleSource(targetId, 'prompt');
      if (promptSource) {
        const output = await resolveNodeOutput(promptSource.id, cache, inProgress);
        if (output.kind === 'text' && output.text) {
          return output.text;
        }
      }
      const promptNode = findUpstreamNode(targetId, 'prompt');
      if (promptNode) {
        const output = await resolveNodeOutput(promptNode.id, cache, inProgress);
        if (output.kind === 'text' && output.text) {
          return output.text;
        }
      }
      return '';
    };

    const resolveMediaFromHandle = async (
      targetId: string,
      handle: string,
      allowedKinds: Array<'image' | 'video'> = ['image']
    ) => {
      const source = findHandleSource(targetId, handle);
      if (!source) return null;
      const output = await resolveNodeOutput(source.id, cache, inProgress);
      if (!output.item || !allowedKinds.includes(output.kind as 'image' | 'video')) {
        throw new Error(`Node ${targetId} expects ${allowedKinds.join(' or ')} input.`);
      }
      return { item: output.item, sourceType: output.sourceType, kind: output.kind };
    };

    switch (node.type) {
      case 'prompt': {
        const textSource = findHandleSource(node.id, 'text');
        if (textSource) {
          const output = await resolveNodeOutput(textSource.id, cache, inProgress);
          if (output.kind === 'text' && output.text) {
            return store({ kind: 'text', text: output.text, sourceType: node.type });
          }
        }
        const value = node.data.value?.trim();
        if (!value) {
          throw new Error(`Prompt ${node.id} is empty.`);
        }
        return store({ kind: 'text', text: value, sourceType: node.type });
      }
      case 'llm': {
        const promptText = (await resolvePromptText(node.id)) || node.data.value?.trim() || '';
        if (!promptText) {
          throw new Error(`LLM ${node.id} needs a prompt.`);
        }
        const text = await runLlmPipeline(promptText, node.data.params);
        return store({ kind: 'text', text, sourceType: node.type });
      }
      case 'imageInput': {
        const value = node.data.value?.trim() || '';
        if (!value) {
          throw new Error(`Image In ${node.id} is empty.`);
        }
        const isVideo = isVideoAsset(value);
        const item: MediaItem = {
          id: `input-${node.id}`,
          name: `input_${node.id}`,
          type: isVideo ? 'video' : 'image',
          url: value,
          source: 'upload',
        };
        return store({ kind: isVideo ? 'video' : 'image', item, sourceType: node.type });
      }
      case 'model': {
        const promptText = await resolvePromptText(node.id);
        if (!promptText) {
          throw new Error(`Model ${node.id} needs a prompt.`);
        }
        const reference = await resolveMediaFromHandle(node.id, 'image', ['image']);
        const referencePayload = reference ? await resolveAssetPayload(reference.item.url) : undefined;
        const referenceIsSketch = reference?.sourceType === 'sketch' || reference?.sourceType === 'openpose';
        const modelLabel = node.data.selected?.trim() || '';
        if (!modelLabel) {
          throw new Error(`Model ${node.id} needs a selection.`);
        }
        if (MODEL_REQUIRES_IMAGE.has(modelLabel) && !referencePayload) {
          throw new Error(`Model ${node.id} (${modelLabel}) needs an Image In node.`);
        }
        const aspectRatio = resolveAspectRatioParam(node.data.params);
        const loraOptions = resolveLoraParams(node.data.params, modelLabel);
        const item = await runImagePipeline(promptText, modelLabel, referencePayload || null, referenceIsSketch, aspectRatio, loraOptions);
        const itemWithMeta = { ...item, generatedBy: modelLabel };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'sampler': {
        const modelSource = findHandleSource(node.id, 'model') || findUpstreamNode(node.id, 'model');
        if (!modelSource) {
          throw new Error(`Sampler ${node.id} needs a model input.`);
        }
        const output = await resolveNodeOutput(modelSource.id, cache, inProgress);
        if (output.kind !== 'image' || !output.item) {
          throw new Error(`Sampler ${node.id} could not resolve image.`);
        }
        return store({ ...output, sourceType: node.type });
      }
      case 'video': {
        const promptText = await resolvePromptText(node.id);
        if (!promptText) {
          throw new Error(`Video ${node.id} needs a prompt.`);
        }
        const reference = await resolveMediaFromHandle(node.id, 'image', ['image']);
        const modelLabel = node.data.selected?.trim() || '';
        if (!modelLabel) {
          throw new Error(`Video ${node.id} needs a model selection.`);
        }
        const aspectRatio = resolveAspectRatioParam(node.data.params);
        const item = await runVideoPipeline(promptText, modelLabel, reference?.item.url, aspectRatio);
        const itemWithMeta = { ...item, generatedBy: modelLabel };
        setNodePreview(node.id, itemWithMeta);
        return store({ kind: 'video', item: itemWithMeta, sourceType: node.type });
      }
      case 'upscale': {
        const modelLabel = node.data.selected?.trim() || '';
        const allowVideo = UPSCALE_VIDEO_SET.has(modelLabel);
        const input = await resolveMediaFromHandle(node.id, 'image', allowVideo ? ['video'] : ['image']);
        if (!input) {
          throw new Error(`Upscale ${node.id} needs an image input.`);
        }
        if (!modelLabel) {
          throw new Error(`Upscale ${node.id} needs a model selection.`);
        }
        const item = await runUpscalePipeline(modelLabel, input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: modelLabel };
        return store({ kind: item.type === 'video' ? 'video' : 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'filter': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`Filter ${node.id} needs an image input.`);
        }
        const item = await runFilterPipeline(input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'Filter' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'chroma': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`Chroma ${node.id} needs an image input.`);
        }
        const item = await runChromaPipeline(input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'Chroma Key' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'sketch': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`Sketch ${node.id} needs an image input.`);
        }
        const item = await runSketchPipeline(input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'Sketch' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'openpose': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`OpenPose ${node.id} needs an image input.`);
        }
        const item = await runOpenPosePipeline(input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'OpenPose' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'depth': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`Depth ${node.id} needs an image input.`);
        }
        const item = await runDepthPipeline(input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'Depth Map' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'faceRestore': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`Face Restore ${node.id} needs an image input.`);
        }
        const item = await runFaceRestorePipeline(input.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'Face Restore' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'bgRemove': {
        const input = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (!input) {
          throw new Error(`Background Remove ${node.id} needs an image input.`);
        }
        const item = await runBackgroundRemovePipeline(input.item.url);
        const itemWithMeta = { ...item, generatedBy: 'Background Remove' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'rife': {
        const input = await resolveMediaFromHandle(node.id, 'video', ['video']);
        if (!input) {
          throw new Error(`RIFE ${node.id} needs a video input.`);
        }
        const item = await runRifePipeline(input.item.url);
        const itemWithMeta = { ...item, generatedBy: 'RIFE' };
        setNodePreview(node.id, itemWithMeta);
        return store({ kind: 'video', item: itemWithMeta, sourceType: node.type });
      }
      case 'blend': {
        const base = await resolveMediaFromHandle(node.id, 'base', ['image']);
        const overlay = await resolveMediaFromHandle(node.id, 'overlay', ['image']);
        if (!base || !overlay) {
          throw new Error(`Composite ${node.id} needs base + overlay inputs.`);
        }
        const item = await runBlendPipeline(base.item.url, overlay.item.url, node.data.params);
        const itemWithMeta = { ...item, generatedBy: 'Composite' };
        return store({ kind: 'image', item: itemWithMeta, sourceType: node.type });
      }
      case 'output': {
        const upstreamImage = await resolveMediaFromHandle(node.id, 'image', ['image']);
        if (upstreamImage) {
          setNodePreview(node.id, upstreamImage.item);
          return store({ kind: 'image', item: upstreamImage.item, sourceType: node.type });
        }
        const modelSource = findUpstreamNode(node.id, 'model') || findUpstreamNode(node.id, 'sampler');
        if (modelSource) {
          const output = await resolveNodeOutput(modelSource.id, cache, inProgress);
          if (output.kind === 'image' && output.item) {
            setNodePreview(node.id, output.item);
            return store({ kind: 'image', item: output.item, sourceType: node.type });
          }
        }
        throw new Error(`Output ${node.id} cannot resolve an image.`);
      }
      default:
        throw new Error(`Unsupported node type: ${node.type}`);
    }
  }, [
    findHandleSource,
    findUpstreamNode,
    isVideoAsset,
    nodeMap,
    resolveAssetPayload,
    runBlendPipeline,
    runChromaPipeline,
    runDepthPipeline,
    runFaceRestorePipeline,
    runFilterPipeline,
    runBackgroundRemovePipeline,
    runImagePipeline,
    runLlmPipeline,
    runOpenPosePipeline,
    runRifePipeline,
    runSketchPipeline,
    runUpscalePipeline,
    runVideoPipeline,
    setNodePreview,
  ]);

  const handleRun = useCallback(async () => {
    const needsApi = validation.pipelines.some((pipeline) => pipelineNeedsApi(pipeline.nodeId));
    if (needsApi && apiKeyReady === false) {
      setRunStatus('Connect your API keys to run pipelines.');
      return;
    }
    if (validation.pipelines.length === 0) {
      setRunStatus('No valid pipeline. Fix the validation errors and try again.');
      return;
    }

    setIsRunning(true);
    setRunStatus(`Running ${validation.pipelines.length} pipeline${validation.pipelines.length > 1 ? 's' : ''}...`);
    setRunTrace(
      validation.pipelines.map((pipeline) => ({
        id: `${pipeline.nodeId}-${Date.now()}`,
        nodeId: pipeline.nodeId,
        label: pipeline.model || pipeline.nodeId,
        status: 'queued',
        detail: `${pipeline.kind} ${pipeline.task || 'run'}`,
      }))
    );
    const newResults: MediaItem[] = [];
    const newTextResults: Array<{ id: string; model: string; text: string }> = [];
    const failures: string[] = [];
    const cache = new Map<string, EvaluatedOutput>();
    const inProgress = new Set<string>();

    for (const pipeline of validation.pipelines) {
      try {
        setRunTrace((prev) =>
          prev.map((entry) =>
            entry.nodeId === pipeline.nodeId
              ? { ...entry, status: 'running', detail: `${pipeline.kind} pipeline active` }
              : entry
          )
        );
        const output = await resolveNodeOutput(pipeline.nodeId, cache, inProgress);
        if (output.kind === 'text' && output.text) {
          newTextResults.push({
            id: `llm-${Date.now()}-${pipeline.nodeId}`,
            model: pipeline.model || 'LLM',
            text: output.text,
          });
          setRunTrace((prev) =>
            prev.map((entry) =>
              entry.nodeId === pipeline.nodeId
                ? { ...entry, status: 'done', detail: 'Text output captured' }
                : entry
            )
          );
          continue;
        }
        if (output.item) {
          const itemWithMeta = { ...output.item, generatedBy: output.item.generatedBy || pipeline.model };
          onAddGeneratedMedia?.(itemWithMeta);
          newResults.push(itemWithMeta);
          setRunTrace((prev) =>
            prev.map((entry) =>
              entry.nodeId === pipeline.nodeId
                ? { ...entry, status: 'done', detail: `${itemWithMeta.type} output captured` }
                : entry
            )
          );
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Pipeline failed.';
        failures.push(message);
        setRunTrace((prev) =>
          prev.map((entry) =>
            entry.nodeId === pipeline.nodeId
              ? { ...entry, status: 'error', detail: message }
              : entry
          )
        );
      }
    }

    if (newResults.length > 0) {
      setRunResults((prev) => [...newResults, ...prev].slice(0, 6));
    }
    if (newTextResults.length > 0) {
      setRunTextResults((prev) => [...newTextResults, ...prev].slice(0, 6));
    }

    if (failures.length > 0) {
      const errorSummary = failures.slice(0, 2).join(' | ');
      setRunStatus(
        `Completed with ${failures.length} error${failures.length > 1 ? 's' : ''}. ${errorSummary}`
      );
    } else if (newResults.length > 0 && newTextResults.length > 0) {
      setRunStatus(
        `Generated ${newResults.length} asset${newResults.length > 1 ? 's' : ''} and ${newTextResults.length} text output${newTextResults.length > 1 ? 's' : ''}.`
      );
    } else if (newResults.length > 0) {
      setRunStatus(`Generated ${newResults.length} asset${newResults.length > 1 ? 's' : ''}.`);
    } else if (newTextResults.length > 0) {
      setRunStatus(`Generated ${newTextResults.length} text output${newTextResults.length > 1 ? 's' : ''}.`);
    } else {
      setRunStatus('No new outputs were produced.');
    }

    setIsRunning(false);
  }, [apiKeyReady, onAddGeneratedMedia, pipelineNeedsApi, resolveNodeOutput, validation.pipelines]);

  const handleAutoSpace = useCallback(() => {
    setNodes((prev) => {
      if (prev.length <= 1) return prev;
      const indegree = new Map<string, number>();
      const outgoing = new Map<string, string[]>();
      prev.forEach((node) => {
        indegree.set(node.id, 0);
        outgoing.set(node.id, []);
      });
      edges.forEach((edge) => {
        if (!indegree.has(edge.target) || !outgoing.has(edge.source)) return;
        indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
        outgoing.get(edge.source)!.push(edge.target);
      });

      const queue: string[] = [];
      indegree.forEach((value, id) => {
        if (value === 0) queue.push(id);
      });
      const level = new Map<string, number>();
      queue.forEach((id) => level.set(id, 0));
      while (queue.length > 0) {
        const current = queue.shift()!;
        const currentLevel = level.get(current) || 0;
        (outgoing.get(current) || []).forEach((target) => {
          const nextLevel = Math.max(level.get(target) || 0, currentLevel + 1);
          level.set(target, nextLevel);
          const nextIn = (indegree.get(target) || 0) - 1;
          indegree.set(target, nextIn);
          if (nextIn === 0) queue.push(target);
        });
      }

      const layers = new Map<number, Node<NodeData>[]>();
      prev.forEach((node) => {
        const nodeLevel = level.get(node.id) ?? 0;
        const list = layers.get(nodeLevel) || [];
        list.push(node);
        layers.set(nodeLevel, list);
      });

      const orderedLevels = Array.from(layers.keys()).sort((a, b) => a - b);
      const xGap = 360;
      const yGap = 190;
      const startX = 80;
      const startY = 80;
      const nextPosition = new Map<string, { x: number; y: number }>();
      orderedLevels.forEach((layerLevel) => {
        const layerNodes = (layers.get(layerLevel) || []).sort((a, b) => a.position.y - b.position.y);
        layerNodes.forEach((node, index) => {
          nextPosition.set(node.id, {
            x: startX + layerLevel * xGap,
            y: startY + index * yGap,
          });
        });
      });

      return prev.map((node) => ({
        ...node,
        position: nextPosition.get(node.id) || node.position,
      }));
    });
    window.setTimeout(() => {
      fitView({ padding: 0.24, duration: 260 });
    }, 20);
  }, [edges, fitView, setNodes]);

  const requiresApi = useMemo(() => {
    return validation.pipelines.some((pipeline) => pipelineNeedsApi(pipeline.nodeId));
  }, [pipelineNeedsApi, validation.pipelines]);

  const readyForRun = validation.pipelines.length > 0 && (apiKeyReady !== false || !requiresApi);
  const shouldFitView = !nodeGraph?.viewport;
  const selectedNode = useMemo(
    () => nodes.find((node) => node.id === selectedNodeId) || null,
    [nodes, selectedNodeId]
  );
  const selectedNodeMeta = selectedNode
    ? paletteItems.find((item) => item.type === selectedNode.type)
    : null;
  const selectedIncoming = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges
      .filter((edge) => edge.target === selectedNodeId)
      .map((edge) => nodeMap.get(edge.source)?.data.label || edge.source);
  }, [edges, nodeMap, selectedNodeId]);
  const selectedOutgoing = useMemo(() => {
    if (!selectedNodeId) return [];
    return edges
      .filter((edge) => edge.source === selectedNodeId)
      .map((edge) => nodeMap.get(edge.target)?.data.label || edge.target);
  }, [edges, nodeMap, selectedNodeId]);
  const selectedParams = useMemo(() => {
    if (!selectedNode?.data.params) return [];
    return Object.entries(selectedNode.data.params)
      .filter(([key]) => key !== 'previewUrl' && key !== 'previewType' && key !== 'lutText')
      .slice(0, 6)
      .map(([key, value]) => ({
        key,
        value: typeof value === 'number' ? value.toFixed(Number.isInteger(value) ? 0 : 2) : String(value || 'none'),
      }));
  }, [selectedNode]);
  const graphHealth = useMemo(() => {
    if (validation.errors.length > 0) return { label: 'Needs review', tone: 'text-amber-300', icon: Activity };
    if (!readyForRun) return { label: 'Waiting for keys', tone: 'text-amber-300', icon: ShieldCheck };
    return { label: 'Ready', tone: 'text-emerald-300', icon: CheckCircle2 };
  }, [readyForRun, validation.errors.length]);
  const executionModeMeta = useMemo(() => {
    const icon = executionMode === 'local' ? HardDrive : executionMode === 'cloud' ? Cloud : Zap;
    const label = executionMode === 'local' ? 'Local first' : executionMode === 'cloud' ? 'Cloud run' : 'Hybrid run';
    return { icon, label };
  }, [executionMode]);
  const safetyModeLabel = safetyMode === 'draft' ? 'Draft' : safetyMode === 'review' ? 'Review gate' : 'Locked';
  const runTracePreview = runTrace.slice(0, 5);
  const HealthIcon = graphHealth.icon;
  const ExecutionIcon = executionModeMeta.icon;

  return (
    <div className="studio-workspace h-full overflow-hidden p-4 lg:p-6">
      <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4">
        <div className="app-panel flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg border border-indigo-400/30 bg-indigo-500/12">
              <Workflow className="h-6 w-6 text-indigo-200" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-3">
                <h2 className="text-2xl font-bold">Node Space</h2>
                <span className="rounded-md border border-emerald-400/25 bg-emerald-400/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-200">
                  Studio orchestration
                </span>
              </div>
              <p className="mt-1 text-sm text-gray-400">
                Modular AI workflows for images, video, text agents, compositing, and finishing.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-300">
              <HealthIcon className={`h-4 w-4 ${graphHealth.tone}`} />
              <span>{graphHealth.label}</span>
            </div>
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-300">
              <ExecutionIcon className="h-4 w-4 text-sky-200" />
              <span>{executionModeMeta.label}</span>
            </div>
            <button
              className="app-button app-primary justify-center text-xs disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!readyForRun || isRunning}
              onClick={handleRun}
            >
              <Play className="h-4 w-4" />
              {isRunning ? 'Running' : 'Run graph'}
            </button>
            <button
              className="app-button app-secondary justify-center text-xs"
              onClick={handleAutoSpace}
            >
              <GitBranch className="h-4 w-4" />
              Auto space
            </button>
          </div>
        </div>

        <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_360px]">
          <aside className="app-panel flex min-h-0 flex-col overflow-hidden">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  <Boxes className="h-4 w-4 text-indigo-300" />
                  Node library
                </div>
                <span className="text-[10px] text-gray-500">{paletteItems.length} nodes</span>
              </div>
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  value={paletteSearch}
                  onChange={(event) => setPaletteSearch(event.target.value)}
                  placeholder="Search nodes"
                  className="app-input py-2 pl-9 text-xs"
                />
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setActivePaletteGroup('all')}
                  className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
                    activePaletteGroup === 'all'
                      ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200'
                  }`}
                >
                  All {paletteItems.length}
                </button>
                {paletteGroupOrder.map((group) => (
                  <button
                    key={group}
                    type="button"
                    onClick={() => setActivePaletteGroup(group)}
                    className={`rounded-md border px-2 py-1 text-[10px] font-semibold ${
                      activePaletteGroup === group
                        ? 'border-indigo-400/50 bg-indigo-500/15 text-indigo-100'
                        : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {paletteGroupLabels[group]} {paletteCounts[group] || 0}
                  </button>
                ))}
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="mb-5 space-y-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  <LayoutTemplate className="h-4 w-4 text-amber-200" />
                  Blueprints
                </div>
                <div className="grid gap-2">
                  {quickTemplateOptions.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleInsertQuickTemplate(item.id)}
                      className="rounded-lg border border-white/10 bg-white/[0.045] p-3 text-left transition hover:border-indigo-400/45 hover:bg-indigo-500/10"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-gray-100">{item.label}</div>
                          <div className="mt-1 text-[11px] leading-relaxed text-gray-500">{item.description}</div>
                        </div>
                        <span className="rounded border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400">
                          {item.backend}
                        </span>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-gray-500">
                        <Sparkles className="h-3.5 w-3.5 text-amber-200" />
                        {item.nodeCount} nodes
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                {filteredPalette.map((item) => (
                  <div
                    key={item.type}
                    draggable
                    onDragStart={(event) => {
                      event.dataTransfer.setData('application/reactflow', item.type);
                      event.dataTransfer.effectAllowed = 'move';
                    }}
                    className={`cursor-grab rounded-lg border bg-gradient-to-br p-3 active:cursor-grabbing ${item.tone}`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-gray-100">{item.label}</span>
                          <span className="rounded bg-black/20 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.12em] text-gray-400">
                            {paletteGroupLabels[item.group]}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] leading-relaxed text-gray-400">{item.description}</div>
                        <div className="mt-2 font-mono text-[10px] text-gray-500">{item.portLabel}</div>
                      </div>
                      <button
                        type="button"
                        className="rounded-md border border-white/10 bg-black/20 p-1.5 text-indigo-200 hover:border-indigo-300/50 hover:text-white"
                        aria-label={`Add ${item.label}`}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleAddNodeFromPalette(item.type);
                        }}
                      >
                        <Wand2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
                {filteredPalette.length === 0 && (
                  <div className="rounded-lg border border-dashed border-white/10 p-4 text-center text-xs text-gray-500">
                    No matching node types.
                  </div>
                )}
              </div>
            </div>

            <div className="border-t border-white/10 p-4">
              <div className="mb-2 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  <Database className="h-4 w-4 text-sky-200" />
                  Assets
                </div>
                <span className="text-[10px] text-gray-500">{selectedImageNodeId || 'no target'}</span>
              </div>
              <input
                value={librarySearch}
                onChange={(event) => setLibrarySearch(event.target.value)}
                placeholder="Search project media"
                className="app-input py-2 text-xs"
              />
              {libraryError && <div className="mt-2 text-[10px] text-amber-300">{libraryError}</div>}
              <div className="mt-3 grid max-h-52 gap-2 overflow-auto">
                {filteredLibraryAssets.map((asset) => (
                  <button
                    key={asset.id}
                    type="button"
                    onClick={() => handleLibrarySelect(asset)}
                    className="rounded-lg border border-white/10 bg-white/[0.045] p-2 text-left hover:border-indigo-400/45"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-16 shrink-0 items-center justify-center overflow-hidden rounded-md bg-black/60 text-[10px] text-gray-400">
                        {asset.kind === 'video' && asset.url ? (
                          <video src={asset.url} className="h-full w-full object-cover" />
                        ) : asset.url && isLikelyImageUrl(asset.url) ? (
                          <img src={asset.url} alt={asset.name} className="h-full w-full object-cover" />
                        ) : (
                          <span>{asset.kind}</span>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs text-gray-200">{asset.name}</div>
                        <div className="truncate text-[10px] text-gray-500">{asset.projectName}</div>
                      </div>
                    </div>
                  </button>
                ))}
                {filteredLibraryAssets.length === 0 && !libraryLoading && (
                  <div className="text-[10px] text-gray-500">No library assets found.</div>
                )}
                {libraryLoading && (
                  <div className="text-[10px] text-gray-500">Loading library assets...</div>
                )}
              </div>
            </div>
          </aside>

          <main className="app-panel flex min-h-[560px] min-w-0 flex-col overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-gray-300">
                  {nodes.length} nodes
                </span>
                <span className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-gray-300">
                  {edges.length} links
                </span>
                <span className="rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 text-xs text-gray-300">
                  {validation.pipelines.length} runnable
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {(['local', 'hybrid', 'cloud'] as ExecutionMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setExecutionMode(mode)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold capitalize ${
                      executionMode === mode
                        ? 'border-sky-400/50 bg-sky-500/15 text-sky-100'
                        : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
                {(['draft', 'review', 'locked'] as SafetyMode[]).map((mode) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setSafetyMode(mode)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-semibold capitalize ${
                      safetyMode === mode
                        ? 'border-emerald-400/50 bg-emerald-500/15 text-emerald-100'
                        : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200'
                    }`}
                  >
                    {mode}
                  </button>
                ))}
              </div>
            </div>

            {apiKeyReady === false && requiresApi && (
              <div className="border-b border-amber-400/20 bg-amber-400/10 px-4 py-2 text-xs text-amber-200">
                Connect API keys to execute this graph.
              </div>
            )}
            {validation.errors.length > 0 && (
              <div className="grid gap-1 border-b border-amber-400/20 bg-amber-400/8 px-4 py-2 text-xs text-amber-100">
                {validation.errors.slice(0, 3).map((error) => (
                  <div key={error}>{error}</div>
                ))}
                {validation.errors.length > 3 && (
                  <div className="text-amber-300">+{validation.errors.length - 3} more</div>
                )}
              </div>
            )}

            <div
              ref={flowWrapperRef}
              className="overflow-hidden p-2"
              style={{ height: 'min(68vh, 760px)', minHeight: 520 }}
            >
              <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={onNodesChange}
                onEdgesChange={onEdgesChange}
                onConnect={onConnect}
                onDrop={onDrop}
                onDragOver={onDragOver}
                onMoveEnd={handleMoveEnd}
                onInit={(instance) => setViewportState(instance.getViewport())}
                onNodeClick={handleNodeClick}
                onPaneClick={() => setSelectedNodeId(null)}
                nodeTypes={nodeTypes}
                fitView={shouldFitView}
                fitViewOptions={{ padding: 0.24 }}
                snapToGrid
                snapGrid={[20, 20]}
              >
                <MiniMap pannable zoomable />
                <Controls />
                <Background gap={20} size={1} color="#1f2937" />
              </ReactFlow>
            </div>

            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 px-4 py-3 text-xs text-gray-400">
              <div className="flex items-center gap-2">
                <LayersIcon className="h-4 w-4 text-indigo-300" />
                <span>{runStatus || 'Graph idle'}</span>
              </div>
              <div className="font-mono text-[10px] text-gray-500">
                x {Math.round(viewport.x)} / y {Math.round(viewport.y)} / {Math.round(viewport.zoom * 100)}%
              </div>
            </div>
          </main>

          <aside className="app-panel flex min-h-0 flex-col overflow-hidden lg:col-span-2 xl:col-span-1">
            <div className="border-b border-white/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-gray-400">
                  <Activity className="h-4 w-4 text-emerald-200" />
                  Inspector
                </div>
                <span className="text-[10px] text-gray-500">{safetyModeLabel}</span>
              </div>
              {selectedNode ? (
                <div className="mt-4 rounded-lg border border-white/10 bg-white/[0.045] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-base font-semibold text-gray-100">{selectedNode.data.label}</div>
                      <div className="mt-1 font-mono text-[10px] text-gray-500">{selectedNode.id}</div>
                    </div>
                    <span className="rounded-md border border-white/10 bg-black/20 px-2 py-1 text-[10px] text-gray-400">
                      {selectedNodeMeta?.label || selectedNode.type}
                    </span>
                  </div>
                  {selectedNodeMeta && (
                    <div className="mt-3 text-xs leading-relaxed text-gray-400">{selectedNodeMeta.description}</div>
                  )}
                  <div className="mt-4 grid grid-cols-2 gap-2">
                    <button
                      className="app-button app-secondary justify-center text-xs disabled:opacity-50"
                      disabled={!selectedNodeId}
                      onClick={handleDuplicateSelectedNode}
                    >
                      <Copy className="h-4 w-4" />
                      Duplicate
                    </button>
                    <button
                      className="app-button app-secondary justify-center text-xs disabled:opacity-50"
                      disabled={!selectedNodeId}
                      onClick={handleDeleteSelectedNode}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-lg border border-dashed border-white/10 p-4 text-sm text-gray-500">
                  Select a node to inspect its role, links, and parameters.
                </div>
              )}
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-4">
              <div className="grid gap-3">
                <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Graph health</div>
                    <HealthIcon className={`h-4 w-4 ${graphHealth.tone}`} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="rounded-md bg-black/20 p-2">
                      <div className="text-lg font-semibold text-gray-100">{nodes.length}</div>
                      <div className="text-[10px] text-gray-500">Nodes</div>
                    </div>
                    <div className="rounded-md bg-black/20 p-2">
                      <div className="text-lg font-semibold text-gray-100">{edges.length}</div>
                      <div className="text-[10px] text-gray-500">Links</div>
                    </div>
                    <div className="rounded-md bg-black/20 p-2">
                      <div className="text-lg font-semibold text-gray-100">{validation.errors.length}</div>
                      <div className="text-[10px] text-gray-500">Issues</div>
                    </div>
                  </div>
                </div>

                <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                  <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Connections</div>
                  <div className="grid gap-2 text-xs">
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-gray-500">Incoming</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedIncoming.length ? selectedIncoming : ['none']).map((item) => (
                          <span key={item} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-gray-400">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div>
                      <div className="mb-1 text-[10px] uppercase tracking-[0.14em] text-gray-500">Outgoing</div>
                      <div className="flex flex-wrap gap-1.5">
                        {(selectedOutgoing.length ? selectedOutgoing : ['none']).map((item) => (
                          <span key={item} className="rounded border border-white/10 bg-black/20 px-2 py-1 text-gray-400">
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {selectedParams.length > 0 && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Parameters</div>
                    <div className="grid gap-2">
                      {selectedParams.map((param) => (
                        <div key={param.key} className="flex items-center justify-between gap-3 rounded-md bg-black/20 px-2 py-1.5 text-xs">
                          <span className="text-gray-500">{param.key}</span>
                          <span className="truncate text-gray-200">{param.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                  <div className="mb-3 flex items-center justify-between gap-2">
                    <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Run trace</div>
                    <ShieldCheck className="h-4 w-4 text-emerald-200" />
                  </div>
                  <div className="grid gap-2">
                    {runTracePreview.length > 0 ? (
                      runTracePreview.map((entry) => (
                        <div key={entry.id} className="rounded-md border border-white/10 bg-black/20 p-2">
                          <div className="flex items-center justify-between gap-2">
                            <span className="truncate text-xs font-semibold text-gray-200">{entry.label}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] ${
                                entry.status === 'done'
                                  ? 'bg-emerald-400/15 text-emerald-200'
                                  : entry.status === 'error'
                                    ? 'bg-red-400/15 text-red-200'
                                    : entry.status === 'running'
                                      ? 'bg-sky-400/15 text-sky-200'
                                      : 'bg-white/10 text-gray-400'
                              }`}
                            >
                              {entry.status}
                            </span>
                          </div>
                          <div className="mt-1 line-clamp-2 text-[10px] text-gray-500">{entry.detail}</div>
                        </div>
                      ))
                    ) : (
                      <div className="text-xs text-gray-500">No run trace yet.</div>
                    )}
                  </div>
                </div>

                {(runResults.length > 0 || runTextResults.length > 0) && (
                  <div className="rounded-lg border border-white/10 bg-white/[0.045] p-3">
                    <div className="mb-3 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">Latest outputs</div>
                    <div className="grid gap-2">
                      {runResults.slice(0, 3).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/20 p-2">
                          <div className="aspect-video overflow-hidden rounded bg-black/50">
                            {item.type === 'video' ? (
                              <video src={item.url} className="h-full w-full object-cover" />
                            ) : isLikelyImageUrl(item.url) ? (
                              <img src={item.url} alt={item.name} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full items-center justify-center text-[10px] text-gray-500">
                                Output ready
                              </div>
                            )}
                          </div>
                          <div className="mt-2 truncate text-[10px] text-gray-400">{item.name}</div>
                        </div>
                      ))}
                      {runTextResults.slice(0, 2).map((item) => (
                        <div key={item.id} className="rounded-md border border-white/10 bg-black/20 p-2">
                          <div className="text-[10px] text-indigo-300">{item.model}</div>
                          <div className="mt-1 line-clamp-4 whitespace-pre-wrap text-[11px] text-gray-300">
                            {item.text}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
};

const NodeWorkspace: React.FC<NodeWorkspaceProps> = (props) => {
  return (
    <ReactFlowProvider>
      <NodeWorkspaceContent {...props} />
    </ReactFlowProvider>
  );
};

export default NodeWorkspace;
