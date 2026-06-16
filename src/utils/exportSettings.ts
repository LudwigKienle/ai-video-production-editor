export type ExportContainer = 'webm' | 'mp4' | 'mov';
export type ExportVideoCodec = 'vp9' | 'vp8' | 'h264' | 'hevc' | 'prores';
export type ExportColorProfile = 'source' | 'rec709' | 'rec2020-hlg' | 'rec2020-pq';

export type ExportPreset = {
  id: string;
  label: string;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
};

export type QuickExportFormat = {
  mimeType: string;
  extension: 'webm';
  videoCodec: 'vp9' | 'vp8';
};

export type ExportSettingsInput = {
  presetId?: string;
  filename: string;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  useFfmpeg: boolean;
  styleTransferPreset?: string;
  styleTransferStrength?: number;
  gpuAcceleration?: string;
  container: ExportContainer;
  videoCodec: ExportVideoCodec;
  bitDepth: number;
  colorProfile: ExportColorProfile;
};

export type NormalizedExportSettings = Omit<ExportSettingsInput, 'container' | 'videoCodec'> & {
  filename: string;
  width: number;
  height: number;
  fps: number;
  bitrateKbps: number;
  container: ExportContainer;
  videoCodec: ExportVideoCodec;
  bitDepth: number;
  mimeType?: string;
};

export const EXPORT_PRESETS: ExportPreset[] = [
  {
    id: 'youtube-1080p',
    label: 'YouTube 1080p (16:9)',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 12000,
  },
  {
    id: 'tiktok-1080x1920',
    label: 'TikTok 1080x1920 (9:16)',
    width: 1080,
    height: 1920,
    fps: 30,
    bitrateKbps: 8000,
  },
  {
    id: 'reels-1080x1920',
    label: 'Instagram Reels 1080x1920 (9:16)',
    width: 1080,
    height: 1920,
    fps: 30,
    bitrateKbps: 8000,
  },
  {
    id: 'custom',
    label: 'Custom',
    width: 1280,
    height: 720,
    fps: 30,
    bitrateKbps: 6000,
  },
];

const QUICK_EXPORT_FORMATS: QuickExportFormat[] = [
  { mimeType: 'video/webm;codecs=vp9', extension: 'webm', videoCodec: 'vp9' },
  { mimeType: 'video/webm;codecs=vp8', extension: 'webm', videoCodec: 'vp8' },
  { mimeType: 'video/webm', extension: 'webm', videoCodec: 'vp8' },
];

export const sanitizeExportFilename = (filename: string, fallbackStem = 'my-ai-video') => {
  const rawName = String(filename || '').trim().replace(/[/\\]+/g, '-');
  const withoutExt = rawName.replace(/\.[^/.]+$/, '');
  const sanitized = withoutExt
    .replace(/[^a-z0-9._ -]+/gi, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+/g, '-')
    .replace(/^[.\s-]+|[.\s-]+$/g, '')
    .slice(0, 96);
  return sanitized || fallbackStem;
};

export const replaceFileExtension = (filename: string, ext: string) => {
  const stem = sanitizeExportFilename(filename);
  return `${stem}.${ext.replace(/^\./, '')}`;
};

export const resolveContainerForCodec = (codec: ExportVideoCodec, preferred?: string): ExportContainer => {
  if (codec === 'vp8' || codec === 'vp9') return 'webm';
  if (codec === 'prores') return 'mov';
  return preferred === 'mov' ? 'mov' : 'mp4';
};

export const normalizeBitDepthForCodec = (codec: ExportVideoCodec, bitDepth: number) => {
  if (codec === 'vp8' || codec === 'vp9') return 8;
  if (codec === 'prores') return 10;
  if (codec === 'h264') return bitDepth >= 10 ? 10 : 8;
  return bitDepth >= 12 ? 12 : bitDepth >= 10 ? 10 : 8;
};

export const getBitDepthOptions = (codec: ExportVideoCodec) => {
  if (codec === 'prores') {
    return [{ value: 10, label: '10-bit ProRes 422 HQ' }];
  }
  if (codec === 'hevc') {
    return [
      { value: 8, label: '8-bit' },
      { value: 10, label: '10-bit Main10' },
      { value: 12, label: '12-bit x265 CPU' },
    ];
  }
  return [
    { value: 8, label: '8-bit' },
    { value: 10, label: '10-bit x264 CPU' },
  ];
};

export const getQuickExportFormat = (
  isTypeSupported: (mimeType: string) => boolean = (mimeType) => {
    if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
      return mimeType === 'video/webm';
    }
    return MediaRecorder.isTypeSupported(mimeType);
  },
): QuickExportFormat | null => {
  return QUICK_EXPORT_FORMATS.find((format) => isTypeSupported(format.mimeType)) || null;
};

const clampNumber = (value: number, fallback: number, min: number, max = Number.POSITIVE_INFINITY) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(min, Math.min(max, numeric));
};

export const normalizeExportSettings = (
  input: ExportSettingsInput,
  options: { quickFormat?: QuickExportFormat | null } = {},
): NormalizedExportSettings => {
  const width = Math.round(clampNumber(input.width, 1920, 16));
  const height = Math.round(clampNumber(input.height, 1080, 16));
  const fps = Math.round(clampNumber(input.fps, 30, 1, 240));
  const bitrateKbps = Math.round(clampNumber(input.bitrateKbps, 12000, 500));

  if (!input.useFfmpeg) {
    const quickFormat = options.quickFormat ?? getQuickExportFormat();
    if (!quickFormat) {
      return {
        ...input,
        width,
        height,
        fps,
        bitrateKbps,
        container: 'webm',
        videoCodec: 'vp8',
        bitDepth: 8,
        filename: replaceFileExtension(input.filename, 'webm'),
      };
    }

    return {
      ...input,
      width,
      height,
      fps,
      bitrateKbps,
      container: quickFormat.extension,
      videoCodec: quickFormat.videoCodec,
      bitDepth: 8,
      filename: replaceFileExtension(input.filename, quickFormat.extension),
      mimeType: quickFormat.mimeType,
    };
  }

  const videoCodec = input.videoCodec === 'hevc' || input.videoCodec === 'prores'
    ? input.videoCodec
    : 'h264';
  const container = resolveContainerForCodec(videoCodec, input.container);
  const bitDepth = normalizeBitDepthForCodec(videoCodec, input.bitDepth);

  return {
    ...input,
    width,
    height,
    fps,
    bitrateKbps,
    videoCodec,
    container,
    bitDepth,
    filename: replaceFileExtension(input.filename, container),
  };
};
