import type {
  ExportColorProfile,
  ExportContainer,
  ExportVideoCodec,
} from './exportSettings';

export type OpenColorIOManifestInput = {
  projectName?: string;
  filename: string;
  width: number;
  height: number;
  fps: number;
  colorProfile: ExportColorProfile;
  bitDepth: number;
  videoCodec: ExportVideoCodec;
  container: ExportContainer;
  ocioConfigId?: OpenColorIOConfigId;
  ocioConfigPath?: string;
};

export type OpenColorIOConfigId = 'aces-2.0-studio' | 'aces-1.3-studio' | 'aces-1.3-cg' | 'custom';

export type OpenColorIOConfigOption = {
  id: OpenColorIOConfigId;
  label: string;
  configName: string;
  recommendedConfig: string;
  path?: string;
};

export type OpenColorIOProfile = {
  colorProfile: ExportColorProfile;
  configFamily: 'ACES';
  recommendedConfig: string;
  inputColorSpace: string;
  workingColorSpace: string;
  display: string;
  view: string;
  look: string;
  outputColorSpace: string;
  ffmpegTags: {
    colorRange?: string;
    colorspace?: string;
    colorPrimaries?: string;
    colorTransfer?: string;
  };
};

export const DEFAULT_OPEN_COLOR_IO_CONFIG_ID: OpenColorIOConfigId = 'aces-2.0-studio';

export const OPEN_COLOR_IO_CONFIG_OPTIONS: OpenColorIOConfigOption[] = [
  {
    id: 'aces-2.0-studio',
    label: 'ACES 2.0 Studio',
    configName: 'ACES 2.0 Studio Config',
    recommendedConfig: 'ACES 2.0 Studio Config',
  },
  {
    id: 'aces-1.3-studio',
    label: 'ACES 1.3 Studio',
    configName: 'ACES 1.3 Studio Config',
    recommendedConfig: 'ACES 1.3 Studio Config',
  },
  {
    id: 'aces-1.3-cg',
    label: 'ACES 1.3 CG',
    configName: 'ACES 1.3 CG Config',
    recommendedConfig: 'ACES 1.3 CG Config',
  },
  {
    id: 'custom',
    label: 'Custom OCIO',
    configName: 'Custom project OCIO config',
    recommendedConfig: 'Set OCIO to the selected project config path',
  },
];

const OPEN_COLOR_IO_PROFILES: Record<ExportColorProfile, OpenColorIOProfile> = {
  source: {
    colorProfile: 'source',
    configFamily: 'ACES',
    recommendedConfig: 'Studio-config or project OCIO config',
    inputColorSpace: 'Utility - Raw',
    workingColorSpace: 'ACEScg',
    display: 'Source tagged by media metadata',
    view: 'Source tagged by media metadata',
    look: 'None',
    outputColorSpace: 'Source tagged by media metadata',
    ffmpegTags: {},
  },
  rec709: {
    colorProfile: 'rec709',
    configFamily: 'ACES',
    recommendedConfig: 'ACES 1.x / ACES 2.x OCIO config',
    inputColorSpace: 'Utility - sRGB - Texture',
    workingColorSpace: 'ACEScg',
    display: 'sRGB',
    view: 'ACES 1.0 - SDR Video',
    look: 'None',
    outputColorSpace: 'Output - Rec.709',
    ffmpegTags: {
      colorRange: 'tv',
      colorspace: 'bt709',
      colorPrimaries: 'bt709',
      colorTransfer: 'bt709',
    },
  },
  'rec2020-hlg': {
    colorProfile: 'rec2020-hlg',
    configFamily: 'ACES',
    recommendedConfig: 'ACES 1.x / ACES 2.x OCIO config',
    inputColorSpace: 'Utility - Linear - Rec.2020',
    workingColorSpace: 'ACEScg',
    display: 'Rec.2100-HLG',
    view: 'ACES 1.0 - HDR Video',
    look: 'None',
    outputColorSpace: 'Output - Rec.2100-HLG',
    ffmpegTags: {
      colorRange: 'tv',
      colorspace: 'bt2020nc',
      colorPrimaries: 'bt2020',
      colorTransfer: 'arib-std-b67',
    },
  },
  'rec2020-pq': {
    colorProfile: 'rec2020-pq',
    configFamily: 'ACES',
    recommendedConfig: 'ACES 1.x / ACES 2.x OCIO config',
    inputColorSpace: 'Utility - Linear - Rec.2020',
    workingColorSpace: 'ACEScg',
    display: 'Rec.2100-PQ',
    view: 'ACES 1.0 - HDR Video',
    look: 'None',
    outputColorSpace: 'Output - Rec.2100-PQ',
    ffmpegTags: {
      colorRange: 'tv',
      colorspace: 'bt2020nc',
      colorPrimaries: 'bt2020',
      colorTransfer: 'smpte2084',
    },
  },
};

export const resolveOpenColorIOProfile = (colorProfile: ExportColorProfile): OpenColorIOProfile => {
  return OPEN_COLOR_IO_PROFILES[colorProfile] || OPEN_COLOR_IO_PROFILES.source;
};

export const resolveOpenColorIOConfig = (
  configId: OpenColorIOConfigId = DEFAULT_OPEN_COLOR_IO_CONFIG_ID,
  customConfigPath = '',
): OpenColorIOConfigOption => {
  const fallback = OPEN_COLOR_IO_CONFIG_OPTIONS.find((option) => option.id === DEFAULT_OPEN_COLOR_IO_CONFIG_ID)!;
  const option = OPEN_COLOR_IO_CONFIG_OPTIONS.find((item) => item.id === configId) || fallback;
  const path = String(customConfigPath || '').trim();
  if (option.id !== 'custom') return option;
  return {
    ...option,
    path: path || undefined,
    recommendedConfig: path || option.recommendedConfig,
  };
};

export const buildOpenColorIOManifest = ({
  projectName = 'Timeline Export',
  filename,
  width,
  height,
  fps,
  colorProfile,
  bitDepth,
  videoCodec,
  container,
  ocioConfigId = DEFAULT_OPEN_COLOR_IO_CONFIG_ID,
  ocioConfigPath = '',
}: OpenColorIOManifestInput) => {
  const profile = resolveOpenColorIOProfile(colorProfile);
  const config = resolveOpenColorIOConfig(ocioConfigId, ocioConfigPath);
  const manifest = {
    schema: 'ai-video-production-editor.open-color-io-manifest.v1',
    project: {
      name: projectName,
    },
    delivery: {
      filename,
      width,
      height,
      fps,
      colorProfile,
      bitDepth,
      videoCodec,
      container,
    },
    openColorIO: {
      configFamily: profile.configFamily,
      configId: config.id,
      configName: config.configName,
      configPath: config.path,
      recommendedConfig: config.recommendedConfig || profile.recommendedConfig,
      inputColorSpace: profile.inputColorSpace,
      workingColorSpace: profile.workingColorSpace,
      display: profile.display,
      view: profile.view,
      look: profile.look,
      outputColorSpace: profile.outputColorSpace,
    },
    ffmpegTags: profile.ffmpegTags,
    notes: [
      'Sidecar manifest for relinking the render in OCIO-aware tools such as Resolve, Nuke, Blender, Natron, and OpenRV.',
      'The app exports codec color tags separately; use this manifest to align the shot with the project OCIO/ACES display transform.',
    ],
  };

  return JSON.stringify(manifest, null, 2);
};
