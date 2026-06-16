export type AudioMasteringProvider = 'local' | 'remote';
export type AudioMasteringMode = 'manual' | 'spotify_auto';

export type AudioMasteringPayload = {
  base64: string;
  mimeType: string;
  name?: string;
};

export type AudioMasteringAdvancedOptions = {
  eqMatchAmount?: number;
  limiterCeilingDbtp?: number;
  lowMidCrossoverHz?: number;
  midHighCrossoverHz?: number;
};

export type AudioMasteringRequest = {
  provider: AudioMasteringProvider;
  mode?: AudioMasteringMode;
  target: AudioMasteringPayload;
  reference?: AudioMasteringPayload | null;
  compressionStrength: number;
  stereoWidthPercent: number;
  targetLufs: number;
  advanced?: AudioMasteringAdvancedOptions;
  projectPath?: string | null;
};

export type AudioMasteringProgressPhase =
  | 'decode'
  | 'analyze'
  | 'eq_match'
  | 'multiband_compress'
  | 'stereo_image'
  | 'limit'
  | 'loudness_normalize'
  | 'export';

export type AudioMasteringProgress = {
  phase: AudioMasteringProgressPhase;
  percent: number;
  message?: string;
};

export type AudioMasteringStatus = {
  ready: boolean;
  available: boolean;
  pythonPath?: string | null;
  envPath?: string | null;
  workerPath?: string | null;
  version?: string | null;
  error?: string | null;
};

export type AudioMasteringResult = {
  ok: true;
  outputPath: string;
  outputName: string;
  url: string;
  beforeLufs: number | null;
  afterLufs: number | null;
  beforeTruePeakDbtp: number | null;
  afterTruePeakDbtp: number | null;
  spotifyReady?: boolean;
  autoProfile?: string | null;
  correctionApplied?: boolean;
  warnings?: string[];
  processingSummary?: string | null;
  logLines?: string[];
};
