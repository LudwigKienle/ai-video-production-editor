export type ArtRelightBlendMode = 'screen' | 'add' | 'normal' | 'soft-light';
export type ArtRelightSurfaceMode = 'source' | 'depth' | 'normal';

export type ArtRelightSettings = {
  lightX: number;
  lightY: number;
  height: number;
  radius: number;
  intensity: number;
  ambient: number;
  surfaceStrength: number;
  warmth: number;
  blendMode: ArtRelightBlendMode;
};

export type ArtRelightPixelBuffer = {
  width: number;
  height: number;
  data: Uint8ClampedArray;
};

export type ArtRelightTint = {
  r: number;
  g: number;
  b: number;
};

export type ArtRelightOptions = {
  surface?: ArtRelightPixelBuffer | null;
  surfaceMode?: ArtRelightSurfaceMode;
};

export const DEFAULT_ART_RELIGHT_SETTINGS: ArtRelightSettings = {
  lightX: 0.32,
  lightY: 0.28,
  height: 0.35,
  radius: 0.75,
  intensity: 1.4,
  ambient: 0.12,
  surfaceStrength: 2.1,
  warmth: 24,
  blendMode: 'screen',
};

const blendModes: ArtRelightBlendMode[] = ['screen', 'add', 'normal', 'soft-light'];
const surfaceModes: ArtRelightSurfaceMode[] = ['source', 'depth', 'normal'];

const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const safeNumber = (value: unknown, fallback: number) => (
  typeof value === 'number' && Number.isFinite(value) ? value : fallback
);

export const normalizeArtRelightSettings = (
  settings: Partial<ArtRelightSettings> = {},
): ArtRelightSettings => {
  const blendMode = blendModes.includes(settings.blendMode as ArtRelightBlendMode)
    ? settings.blendMode as ArtRelightBlendMode
    : DEFAULT_ART_RELIGHT_SETTINGS.blendMode;

  return {
    lightX: clamp(safeNumber(settings.lightX, DEFAULT_ART_RELIGHT_SETTINGS.lightX), 0, 1),
    lightY: clamp(safeNumber(settings.lightY, DEFAULT_ART_RELIGHT_SETTINGS.lightY), 0, 1),
    height: clamp(safeNumber(settings.height, DEFAULT_ART_RELIGHT_SETTINGS.height), 0.05, 2),
    radius: clamp(safeNumber(settings.radius, DEFAULT_ART_RELIGHT_SETTINGS.radius), 0.05, 2),
    intensity: clamp(safeNumber(settings.intensity, DEFAULT_ART_RELIGHT_SETTINGS.intensity), 0, 4),
    ambient: clamp(safeNumber(settings.ambient, DEFAULT_ART_RELIGHT_SETTINGS.ambient), 0, 1),
    surfaceStrength: clamp(safeNumber(settings.surfaceStrength, DEFAULT_ART_RELIGHT_SETTINGS.surfaceStrength), 0, 6),
    warmth: clamp(safeNumber(settings.warmth, DEFAULT_ART_RELIGHT_SETTINGS.warmth), -100, 100),
    blendMode,
  };
};

export const normalizeArtRelightSurfaceMode = (mode: unknown): ArtRelightSurfaceMode => (
  surfaceModes.includes(mode as ArtRelightSurfaceMode) ? mode as ArtRelightSurfaceMode : 'source'
);

export const getArtRelightTint = (warmth: number): ArtRelightTint => {
  const normalized = clamp(warmth, -100, 100) / 100;
  if (normalized >= 0) {
    return {
      r: 1 + normalized * 0.28,
      g: 1 - normalized * 0.05,
      b: 1 - normalized * 0.28,
    };
  }
  const cool = Math.abs(normalized);
  return {
    r: 1 - cool * 0.25,
    g: 1 - cool * 0.02,
    b: 1 + cool * 0.3,
  };
};

const byte = (value: number) => Math.round(clamp(value, 0, 255));

const luminance = (data: Uint8ClampedArray, offset: number) => (
  (data[offset] * 0.2126 + data[offset + 1] * 0.7152 + data[offset + 2] * 0.0722) / 255
);

const sampleLuma = (
  luma: Float32Array,
  width: number,
  height: number,
  x: number,
  y: number,
) => {
  const sampleX = Math.max(0, Math.min(width - 1, x));
  const sampleY = Math.max(0, Math.min(height - 1, y));
  return luma[sampleY * width + sampleX] || 0;
};

const getPixelOffset = (
  buffer: ArtRelightPixelBuffer,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
) => {
  const sourceX = buffer.width <= 1
    ? 0
    : Math.round((x / Math.max(1, targetWidth - 1)) * (buffer.width - 1));
  const sourceY = buffer.height <= 1
    ? 0
    : Math.round((y / Math.max(1, targetHeight - 1)) * (buffer.height - 1));
  const clampedX = Math.max(0, Math.min(buffer.width - 1, sourceX));
  const clampedY = Math.max(0, Math.min(buffer.height - 1, sourceY));
  return (clampedY * buffer.width + clampedX) * 4;
};

const buildSurfaceLuma = (
  source: ArtRelightPixelBuffer,
  surface: ArtRelightPixelBuffer | null,
  mode: ArtRelightSurfaceMode,
) => {
  const { width, height, data } = source;
  const luma = new Float32Array(width * height);
  const useDepthSurface = mode === 'depth' && surface && surface.width > 0 && surface.height > 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const sourceOffset = useDepthSurface
        ? getPixelOffset(surface, x, y, width, height)
        : index * 4;
      luma[index] = luminance(useDepthSurface ? surface.data : data, sourceOffset);
    }
  }

  return luma;
};

const sampleNormal = (
  surface: ArtRelightPixelBuffer | null,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
) => {
  if (!surface || surface.width <= 0 || surface.height <= 0) return null;
  const offset = getPixelOffset(surface, x, y, targetWidth, targetHeight);
  if (offset + 2 >= surface.data.length) return null;

  const normalX = surface.data[offset] / 127.5 - 1;
  const normalY = surface.data[offset + 1] / 127.5 - 1;
  const normalZ = surface.data[offset + 2] / 127.5 - 1;
  const length = Math.hypot(normalX, normalY, normalZ);
  if (!Number.isFinite(length) || length < 0.0001) return null;

  return {
    x: normalX / length,
    y: normalY / length,
    z: normalZ / length,
  };
};

const screen = (source: number, light: number) => 1 - (1 - source) * (1 - light);

const softLight = (source: number, light: number) => {
  if (light <= 0.5) {
    return source - (1 - 2 * light) * source * (1 - source);
  }
  const curve = source <= 0.25
    ? ((16 * source - 12) * source + 4) * source
    : Math.sqrt(source);
  return source + (2 * light - 1) * (curve - source);
};

const applyBlend = (source: number, light: number, mode: ArtRelightBlendMode) => {
  if (mode === 'add') return clamp(source + light, 0, 1);
  if (mode === 'normal') return clamp(source * (0.65 + light * 1.35), 0, 1);
  if (mode === 'soft-light') return clamp(softLight(source, clamp(light, 0, 1)), 0, 1);
  return clamp(screen(source, clamp(light, 0, 1)), 0, 1);
};

export const relightPixelBuffer = (
  source: ArtRelightPixelBuffer,
  rawSettings: Partial<ArtRelightSettings> = DEFAULT_ART_RELIGHT_SETTINGS,
  options: ArtRelightOptions = {},
): ArtRelightPixelBuffer => {
  const settings = normalizeArtRelightSettings(rawSettings);
  const surfaceMode = normalizeArtRelightSurfaceMode(options.surfaceMode);
  const surface = options.surface || null;
  const { width, height, data } = source;

  if (width <= 0 || height <= 0) {
    return { width, height, data: new Uint8ClampedArray(data) };
  }

  const luma = buildSurfaceLuma(source, surface, surfaceMode);

  const output = new Uint8ClampedArray(data.length);
  const diagonal = Math.max(1, Math.hypot(width, height));
  const lightX = settings.lightX * Math.max(1, width - 1);
  const lightY = settings.lightY * Math.max(1, height - 1);
  const lightZ = settings.height * diagonal;
  const radiusPixels = settings.radius * diagonal;
  const tint = getArtRelightTint(settings.warmth);

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const offset = index * 4;
      const guideNormal = surfaceMode === 'normal'
        ? sampleNormal(surface, x, y, width, height)
        : null;
      const gradientX = (sampleLuma(luma, width, height, x + 1, y) - sampleLuma(luma, width, height, x - 1, y))
          * settings.surfaceStrength;
      const gradientY = (sampleLuma(luma, width, height, x, y + 1) - sampleLuma(luma, width, height, x, y - 1))
          * settings.surfaceStrength;

      const normalX = guideNormal?.x ?? -gradientX;
      const normalY = guideNormal?.y ?? -gradientY;
      const normalZ = guideNormal?.z ?? 1;
      const normalLength = guideNormal ? 1 : Math.max(0.0001, Math.hypot(normalX, normalY, normalZ));

      const vectorX = lightX - x;
      const vectorY = lightY - y;
      const vectorZ = lightZ;
      const vectorLength = Math.max(0.0001, Math.hypot(vectorX, vectorY, vectorZ));

      const lambert = Math.max(0, (
        (normalX / normalLength) * (vectorX / vectorLength)
        + (normalY / normalLength) * (vectorY / vectorLength)
        + (normalZ / normalLength) * (vectorZ / vectorLength)
      ));
      const planeDistance = Math.hypot(vectorX, vectorY);
      const distanceRatio = planeDistance / Math.max(1, radiusPixels);
      const falloff = 1 / (1 + distanceRatio * distanceRatio * 4);
      const lightAmount = settings.ambient + settings.intensity * lambert * falloff;

      output[offset] = byte(applyBlend(data[offset] / 255, lightAmount * tint.r, settings.blendMode) * 255);
      output[offset + 1] = byte(applyBlend(data[offset + 1] / 255, lightAmount * tint.g, settings.blendMode) * 255);
      output[offset + 2] = byte(applyBlend(data[offset + 2] / 255, lightAmount * tint.b, settings.blendMode) * 255);
      output[offset + 3] = data[offset + 3];
    }
  }

  return { width, height, data: output };
};
