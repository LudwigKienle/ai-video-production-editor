import { ClipEffectLayer, EffectType, TimelineClip } from '../types';

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const LEGACY_EFFECT_LAYER_PREFIX = 'legacy';

export const getLegacyEffectLayerId = (effect: EffectType) => `${LEGACY_EFFECT_LAYER_PREFIX}:${effect}`;

export const normalizeEffectLayer = (layer: Partial<ClipEffectLayer> & Pick<ClipEffectLayer, 'effect'>, fallbackIndex = 0): ClipEffectLayer => {
  const intensity = clamp(Number(layer.intensity ?? 100), 0, 100);
  const rawId = typeof layer.id === 'string' ? layer.id.trim() : '';
  return {
    id: rawId || `fx-${layer.effect}-${fallbackIndex + 1}`,
    effect: layer.effect,
    intensity,
    enabled: layer.enabled !== false,
  };
};

export const getClipEffectLayers = (clip: Pick<TimelineClip, 'effect' | 'effects'>): ClipEffectLayer[] => {
  if (Array.isArray(clip.effects) && clip.effects.length > 0) {
    const normalized = clip.effects
      .map((entry, index) => normalizeEffectLayer(entry, index))
      .filter((entry, index, all) => all.findIndex((candidate) => candidate.id === entry.id) === index);
    if (normalized.length > 0) return normalized;
  }

  if (clip.effect) {
    return [{
      id: getLegacyEffectLayerId(clip.effect),
      effect: clip.effect,
      intensity: 100,
      enabled: true,
    }];
  }

  return [];
};

export const syncClipEffectsLegacyField = <T extends Pick<TimelineClip, 'effect' | 'effects'>>(
  clip: T,
  nextEffects: ClipEffectLayer[],
): T => {
  const normalized = nextEffects.map((entry, index) => normalizeEffectLayer(entry, index));
  const primary = normalized[0]?.effect || null;
  return {
    ...clip,
    effects: normalized,
    effect: primary,
  };
};

export const hasOverlayRenderer = (effect: EffectType) => {
  return (
    effect === EffectType.FIRE_OVERLAY ||
    effect === EffectType.LIGHTNING_OVERLAY ||
    effect === EffectType.EXPLOSION_OVERLAY ||
    effect === EffectType.GLITCH_OVERLAY ||
    effect === EffectType.COMIC
  );
};

export const buildStyleFilterForEffect = (effect: EffectType, intensity01: number) => {
  const i = clamp(intensity01, 0, 1);
  if (i <= 0) return '';

  switch (effect) {
    case EffectType.GRAYSCALE:
      return `grayscale(${Math.round(100 * i)}%)`;
    case EffectType.SEPIA:
      return `sepia(${Math.round(100 * i)}%)`;
    case EffectType.INVERT:
      return `invert(${Math.round(100 * i)}%)`;
    case EffectType.BLUR:
      return `blur(${(8 * i).toFixed(2)}px)`;
    case EffectType.VIBRANT:
      return `saturate(${(100 + 65 * i).toFixed(1)}%) contrast(${(100 + 12 * i).toFixed(1)}%)`;
    case EffectType.WARM_TONE:
      return `sepia(${(22 * i).toFixed(1)}%) saturate(${(100 + 30 * i).toFixed(1)}%) hue-rotate(${(-8 * i).toFixed(1)}deg)`;
    case EffectType.COOL_TONE:
      return `saturate(${(100 + 2 * i).toFixed(1)}%) hue-rotate(${(18 * i).toFixed(1)}deg) contrast(${(100 + 4 * i).toFixed(1)}%)`;
    case EffectType.NOIR:
      return `grayscale(${Math.round(100 * i)}%) contrast(${(100 + 40 * i).toFixed(1)}%) brightness(${(100 - 8 * i).toFixed(1)}%)`;
    case EffectType.VHS:
      return `contrast(${(100 + 20 * i).toFixed(1)}%) saturate(${(100 - 20 * i).toFixed(1)}%) blur(${(1.2 * i).toFixed(2)}px)`;
    case EffectType.VAN_GOGH:
      return `saturate(${(100 + 55 * i).toFixed(1)}%) contrast(${(100 + 32 * i).toFixed(1)}%) hue-rotate(${(-10 * i).toFixed(1)}deg) brightness(${(100 + 8 * i).toFixed(1)}%)`;
    case EffectType.ANIME:
      return `saturate(${(100 + 48 * i).toFixed(1)}%) contrast(${(100 + 42 * i).toFixed(1)}%) brightness(${(100 + 4 * i).toFixed(1)}%)`;
    case EffectType.WATERCOLOR:
      return `saturate(${(100 + 20 * i).toFixed(1)}%) contrast(${(100 - 4 * i).toFixed(1)}%) blur(${(0.9 * i).toFixed(2)}px) brightness(${(100 + 6 * i).toFixed(1)}%)`;
    case EffectType.COMIC:
      return `contrast(${(100 + 65 * i).toFixed(1)}%) saturate(${(100 + 22 * i).toFixed(1)}%) brightness(${(100 - 2 * i).toFixed(1)}%)`;
    case EffectType.GLITCH_OVERLAY:
      return `contrast(${(100 + 32 * i).toFixed(1)}%) saturate(${(100 + 22 * i).toFixed(1)}%) hue-rotate(${(-6 * i).toFixed(1)}deg)`;
    default:
      return '';
  }
};

export const mergeFilterChunk = (base: string, chunk: string) => {
  const cleanChunk = chunk.trim();
  if (!cleanChunk) return base;
  return base ? `${base} ${cleanChunk}` : cleanChunk;
};
