export type SunPosition = {
  x: number;
  y: number;
  z: number;
};

export type RenderQuality = 'realtime' | 'cinematic' | 'final';

export type RenderQualitySettings = {
  maxPixelRatio: number;
  ambientOcclusion: boolean;
  aoKernelRadius: number;
  aoMinDistance: number;
  aoMaxDistance: number;
  bloomStrength: number;
  bloomRadius: number;
  bloomThreshold: number;
};

export type RenderSize = {
  width: number;
  height: number;
};

export type RenderPresetSettings = {
  renderQuality: RenderQuality;
  exposure: number;
  skyEnabled: boolean;
  sunEnabled: boolean;
  sunAzimuth: number;
  sunElevation: number;
  sunIntensity: number;
  useHdriBackground: boolean;
};

export type PartialRenderPresetSettings = Partial<RenderPresetSettings>;

export const HDRI_IMPORT_ACCEPT = '.hdr,.exr';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const toRadians = (value: number) => (value * Math.PI) / 180;
const roundForScene = (value: number) => {
  const rounded = Math.round(value * 1_000_000) / 1_000_000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

export const clampRenderExposure = (value: number) => {
  if (!Number.isFinite(value)) return 1;
  return clamp(value, 0.1, 3);
};

export const normalizeHdrUrl = (value: string) => {
  const trimmed = value.trim();
  const path = trimmed.split(/[?#]/)[0]?.toLowerCase() || '';
  return /\.(hdr|exr)$/.test(path) ? trimmed : '';
};

export const isSupportedHdriFile = (name: string) => /\.(hdr|exr)$/i.test(name.trim());

export const resolveRenderSize = (width: number, height: number): RenderSize => ({
  width: Math.max(1, Math.round(Number.isFinite(width) ? width : 1)),
  height: Math.max(1, Math.round(Number.isFinite(height) ? height : 1)),
});

export const buildSunPosition = (azimuthDegrees: number, elevationDegrees: number, distance = 30): SunPosition => {
  const azimuth = toRadians(azimuthDegrees);
  const elevation = toRadians(clamp(elevationDegrees, -5, 90));
  const radius = Math.max(1, distance);
  const horizontal = Math.cos(elevation) * radius;

  return {
    x: roundForScene(Math.sin(azimuth) * horizontal),
    y: roundForScene(Math.sin(elevation) * radius),
    z: roundForScene(Math.cos(azimuth) * horizontal),
  };
};

export const mergeRenderPresetSettings = (
  current: RenderPresetSettings,
  preset: PartialRenderPresetSettings
): RenderPresetSettings => ({
  renderQuality: preset.renderQuality || current.renderQuality,
  exposure: preset.exposure === undefined ? current.exposure : clampRenderExposure(preset.exposure),
  skyEnabled: preset.skyEnabled ?? current.skyEnabled,
  sunEnabled: preset.sunEnabled ?? current.sunEnabled,
  sunAzimuth: preset.sunAzimuth ?? current.sunAzimuth,
  sunElevation: preset.sunElevation ?? current.sunElevation,
  sunIntensity: preset.sunIntensity ?? current.sunIntensity,
  useHdriBackground: preset.useHdriBackground ?? current.useHdriBackground,
});

export const getRenderQualitySettings = (quality: RenderQuality): RenderQualitySettings => {
  switch (quality) {
    case 'final':
      return {
        maxPixelRatio: 2,
        ambientOcclusion: true,
        aoKernelRadius: 18,
        aoMinDistance: 0.004,
        aoMaxDistance: 0.16,
        bloomStrength: 0.42,
        bloomRadius: 0.34,
        bloomThreshold: 0.82,
      };
    case 'cinematic':
      return {
        maxPixelRatio: 1.5,
        ambientOcclusion: true,
        aoKernelRadius: 10,
        aoMinDistance: 0.005,
        aoMaxDistance: 0.11,
        bloomStrength: 0.26,
        bloomRadius: 0.24,
        bloomThreshold: 0.9,
      };
    case 'realtime':
    default:
      return {
        maxPixelRatio: 1,
        ambientOcclusion: false,
        aoKernelRadius: 0,
        aoMinDistance: 0.005,
        aoMaxDistance: 0.1,
        bloomStrength: 0.12,
        bloomRadius: 0.14,
        bloomThreshold: 0.96,
      };
  }
};
