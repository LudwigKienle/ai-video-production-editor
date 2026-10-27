/**
 * Upscale page: catalogue of the AI models the app can actually call.
 *
 * Pure data. Every entry maps to an existing service function in
 * `services/replicateService.ts`, `services/ltxService.ts` or
 * `services/runwayService.ts`; nothing here ships or calls a local engine.
 * Output limits are conservative app limits so a job never asks a provider
 * for a size it rejects; they are not official provider maxima.
 */

export type UpscaleMediaKind = 'image' | 'video';

export type EnhanceModelId = 'crystal' | 'clarity' | 'topaz' | 'real-esrgan' | 'crystal-video' | 'topaz-video';

export type HdrEngineId = 'ltx' | 'runway-ruby';

export type ModelLimits = {
  /** Largest allowed output edge in pixels. */
  maxLongEdge: number;
  /** Largest allowed scale factor relative to the source. */
  maxScale: number;
  /** Highest output frame rate (video models). */
  maxFps?: number;
};

export type EnhanceModelSpec = {
  id: EnhanceModelId;
  label: string;
  kind: UpscaleMediaKind;
  provider: 'replicate';
  /** Provider model path, used for cost lookup. */
  providerModel: string;
  description: string;
  limits: ModelLimits;
  /** Typical wall-clock time for the progress animation. */
  estimatedMs: number;
};

export const ENHANCE_MODELS: readonly EnhanceModelSpec[] = [
  {
    id: 'crystal',
    label: 'Crystal',
    kind: 'image',
    provider: 'replicate',
    providerModel: 'philz1337x/crystal-upscaler',
    description: 'Detailtreu und ruhig; gut für Fotos, Porträts und KI-Bilder.',
    limits: { maxLongEdge: 8192, maxScale: 8 },
    estimatedMs: 45_000,
  },
  {
    id: 'clarity',
    label: 'Clarity',
    kind: 'image',
    provider: 'replicate',
    providerModel: 'philz1337x/clarity-upscaler',
    description: 'Generativ: erfindet feine Texturen hinzu. Stark bei weichen Quellen, kann Details verändern.',
    limits: { maxLongEdge: 8192, maxScale: 4 },
    estimatedMs: 60_000,
  },
  {
    id: 'topaz',
    label: 'Topaz Image (Cloud)',
    kind: 'image',
    provider: 'replicate',
    providerModel: 'topazlabs/image-upscale',
    description: 'Cloud-Modell von Topaz Labs über Replicate; natürliche Schärfe, wenig Halluzination.',
    limits: { maxLongEdge: 12288, maxScale: 6 },
    estimatedMs: 40_000,
  },
  {
    id: 'real-esrgan',
    label: 'Real-ESRGAN',
    kind: 'image',
    provider: 'replicate',
    providerModel: 'nightmareai/real-esrgan',
    description: 'Schnell und günstig; klassisches GAN-Upscaling mit Gesichtskorrektur.',
    limits: { maxLongEdge: 8192, maxScale: 4 },
    estimatedMs: 15_000,
  },
  {
    id: 'topaz-video',
    label: 'Topaz Video (Cloud)',
    kind: 'video',
    provider: 'replicate',
    providerModel: 'topazlabs/video-upscale',
    description: 'Cloud-Modell von Topaz Labs über Replicate; zeitlich stabil, bis 4K.',
    limits: { maxLongEdge: 3840, maxScale: 4, maxFps: 60 },
    estimatedMs: 180_000,
  },
  {
    id: 'crystal-video',
    label: 'Crystal Video',
    kind: 'video',
    provider: 'replicate',
    providerModel: 'philz1337x/crystal-video-upscaler',
    description: 'Detailtreues Video-Upscaling für KI-Clips; bis 4K.',
    limits: { maxLongEdge: 3840, maxScale: 4, maxFps: 60 },
    estimatedMs: 150_000,
  },
];

export const DEFAULT_IMAGE_MODEL: EnhanceModelId = 'crystal';
export const DEFAULT_VIDEO_MODEL: EnhanceModelId = 'topaz-video';

export const getEnhanceModel = (id: string | null | undefined): EnhanceModelSpec | undefined =>
  ENHANCE_MODELS.find((model) => model.id === id);

export const modelsForKind = (kind: UpscaleMediaKind): EnhanceModelSpec[] =>
  ENHANCE_MODELS.filter((model) => model.kind === kind);

/** Frame interpolation: RIFE on Replicate doubles the frame rate of a clip. */
export const INTERPOLATION_MODEL = {
  id: 'rife',
  label: 'RIFE',
  providerModel: 'sczhou/rife',
  description: 'Erzeugt Zwischenbilder (2× Bildrate). Für Zeitlupe oder flüssigere Bewegung.',
  factor: 2,
  estimatedMs: 90_000,
} as const;

export type HdrEngineSpec = {
  id: HdrEngineId;
  label: string;
  provider: 'ltx' | 'runway';
  providerModel: string;
  description: string;
  /** Longest accepted input in seconds at 1080p. */
  maxSeconds: number;
  maxLongEdge: number;
  estimatedMs: number;
};

export const HDR_ENGINES: readonly HdrEngineSpec[] = [
  {
    id: 'ltx',
    label: 'LTX ACES HDR',
    provider: 'ltx',
    providerModel: 'video-to-video-hdr',
    description: 'SDR zu ACES HDR; Ausgabe als ZIP mit EXR-Einzelbildern. Ca. 7 s bei 1080p, 4 s bei 1440p, 2 s bei 4K.',
    maxSeconds: 7,
    maxLongEdge: 3840,
    estimatedMs: 240_000,
  },
  {
    id: 'runway-ruby',
    label: 'Runway Ruby',
    provider: 'runway',
    providerModel: 'ruby',
    description: 'SDR zu HDR (BT.2020), behält Pixel und Ton. Bis 30 s und 4096 px pro Seite.',
    maxSeconds: 30,
    maxLongEdge: 4096,
    estimatedMs: 180_000,
  },
];

export const getHdrEngine = (id: string | null | undefined): HdrEngineSpec | undefined =>
  HDR_ENGINES.find((engine) => engine.id === id);

/**
 * Fallback cost rates (USD incl. 2 % margin) mirroring the app defaults, used
 * only when the host passes no `costRates`. Shape matches `CostRate`.
 */
export const UPSCALE_FALLBACK_RATES = [
  { id: 'replicate-upscale-real', provider: 'replicate', model: 'nightmareai/real-esrgan', kind: 'edit', unitCost: 0.0153, unitLabel: 'image', label: 'Real-ESRGAN Upscale' },
  { id: 'replicate-upscale-crystal', provider: 'replicate', model: 'philz1337x/crystal-upscaler', kind: 'edit', unitCost: 0.0204, unitLabel: 'image', label: 'Crystal Upscaler' },
  { id: 'replicate-upscale-clarity', provider: 'replicate', model: 'philz1337x/clarity-upscaler', kind: 'edit', unitCost: 0.0204, unitLabel: 'image', label: 'Clarity Upscaler' },
  { id: 'replicate-upscale-topaz', provider: 'replicate', model: 'topazlabs/image-upscale', kind: 'edit', unitCost: 0.0612, unitLabel: 'image', label: 'Topaz Image Upscale' },
  { id: 'replicate-video-upscale-crystal', provider: 'replicate', model: 'philz1337x/crystal-video-upscaler', kind: 'edit', unitCost: 0.0306, unitLabel: 'second', label: 'Crystal Video Upscale' },
  { id: 'replicate-video-upscale-topaz', provider: 'replicate', model: 'topazlabs/video-upscale', kind: 'edit', unitCost: 0.0816, unitLabel: 'second', label: 'Topaz Video Upscale' },
  { id: 'replicate-rife', provider: 'replicate', model: 'sczhou/rife', kind: 'video', unitCost: 0.0408, unitLabel: 'clip', label: 'RIFE Frame Interpolation' },
  { id: 'ltx-video-to-video-hdr', provider: 'ltx', model: 'video-to-video-hdr', kind: 'edit', unitCost: 0.204, unitLabel: 'clip', label: 'LTX Color Science Upscale (ACES HDR)' },
  { id: 'runway-ruby', provider: 'runway', model: 'ruby', kind: 'edit', unitCost: 0.51, unitLabel: 'clip', label: 'Runway Ruby SDR to HDR' },
] as const;
