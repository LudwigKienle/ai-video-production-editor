import type { RelightSettings } from '../types';

export type { RelightSettings };

import relightNeutral from '../assets/relight/relight_neutral_1772276348761.png';
import relightGolden from '../assets/relight/relight_golden_1772276362775.png';
import relightNoir from '../assets/relight/relight_noir_1772276377733.png';
import relightNeon from '../assets/relight/relight_neon_1772276392291.png';
import relightStudio from '../assets/relight/relight_studio_1772276404664.png';

export type RelightPreset = {
  id: string;
  label: string;
  prompt: string;
  image?: string;
};

export type RelightDirection = {
  id: string;
  label: string;
  prompt: string;
};

export const RELIGHT_PRESETS: RelightPreset[] = [
  { id: 'neutral', label: 'Neutral Soft', prompt: 'soft neutral key light, balanced exposure, natural color', image: relightNeutral },
  { id: 'golden', label: 'Golden Hour', prompt: 'warm golden hour light, long soft shadows, gentle glow', image: relightGolden },
  { id: 'noir', label: 'Noir', prompt: 'low-key lighting, high contrast, deep shadows, moody atmosphere', image: relightNoir },
  { id: 'neon', label: 'Neon Night', prompt: 'neon practicals, colorful bounce, glossy highlights', image: relightNeon },
  { id: 'studio', label: 'Studio Softbox', prompt: 'studio softbox key, clean falloff, controlled highlights', image: relightStudio },
  { id: 'rim', label: 'Cinematic Rim', prompt: 'rim light separation, subtle fill, cinematic contrast' },
  { id: 'volumetric', label: 'Volumetric', prompt: 'visible light rays, soft haze, cinematic atmosphere' },
  { id: 'split-neon', label: 'Split Key + Neon Rim', prompt: 'split key lighting, hard shadow division, neon rim accents' },
  { id: 'high-key', label: 'High-Key Fashion', prompt: 'high-key fashion lighting, soft fill, minimal shadows, clean background' },
  { id: 'window-bounce', label: 'Window Bounce', prompt: 'soft window light, cool ambient bounce, gentle falloff' },
  { id: 'warm-practical', label: 'Warm Practical + Cool Fill', prompt: 'warm tungsten practical key, cool fill, cinematic contrast' },
  { id: 'overhead-stage', label: 'Overhead Stage', prompt: 'hard overhead light, dramatic falloff, strong top highlights' },
];

export const RELIGHT_DIRECTIONS: RelightDirection[] = [
  { id: 'front', label: 'Front', prompt: 'key light from camera front' },
  { id: 'left', label: 'Left 45', prompt: 'key light from camera left at 45 degrees' },
  { id: 'right', label: 'Right 45', prompt: 'key light from camera right at 45 degrees' },
  { id: 'back', label: 'Back / Rim', prompt: 'backlight/rim light from behind' },
  { id: 'top', label: 'Top', prompt: 'top light from above' },
  { id: 'under', label: 'Under', prompt: 'uplight from below' },
];

const describeIntensity = (value: number) => {
  if (value <= 0.35) return 'low';
  if (value <= 0.7) return 'medium';
  return 'high';
};

const describeSoftness = (value: number) => {
  if (value <= 0.35) return 'hard';
  if (value <= 0.7) return 'balanced';
  return 'soft';
};

export const buildRelightPrompt = (settings: RelightSettings) => {
  const preset = RELIGHT_PRESETS.find((item) => item.id === settings.presetId);
  const direction = RELIGHT_DIRECTIONS.find((item) => item.id === settings.directionId);
  const color = settings.color && settings.color !== '#ffffff' ? `Light color ${settings.color}` : '';
  const environment = settings.environment.trim() ? `Environment: ${settings.environment.trim()}` : '';
  const notes = settings.notes.trim() ? settings.notes.trim() : '';
  return [
    'Relight the image only. Preserve subject identity, composition, camera framing, and background.',
    preset?.prompt,
    direction?.prompt,
    `Light intensity ${describeIntensity(settings.intensity)}.`,
    `Light softness ${describeSoftness(settings.softness)}.`,
    color,
    environment,
    notes,
    'Do not change pose, lens, or scene layout.',
  ].filter(Boolean).join(' ');
};
