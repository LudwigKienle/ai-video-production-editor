
import { Effect, EffectType, Transition, TransitionType } from './types';
import { MagicWandIcon } from './components/icons';

export const EFFECTS: Effect[] = [
  {
    id: EffectType.VEOGEN,
    name: 'Generate Video (Veo)',
    type: 'ai',
    description: "Use Google's Veo model to generate a video from a text prompt."
  },
  {
    id: EffectType.IMAGEN_GEN,
    name: 'Generate Image (Imagen)',
    type: 'ai',
    description: "Use Imagen 4 for high-quality, photorealistic image generation."
  },
  {
    id: EffectType.GEMINI_3_PRO_IMAGE,
    name: 'Generate Image (Gemini 3 Pro)',
    type: 'ai',
    description: "Use Gemini 3 Pro for high-resolution (up to 4K) image generation."
  },
  {
    id: EffectType.REPLICATE_SEEDREAM,
    name: 'Generate Image (Seedream 4.5)',
    type: 'ai',
    description: 'Use Seedream 4.5 for strong spatial understanding and world knowledge.'
  },
  {
    id: EffectType.REPLICATE_QWEN_EDIT,
    name: 'Edit Image (Qwen)',
    type: 'ai',
    description: 'Edit an image with Qwen Image Edit on Replicate.'
  },
  {
    id: EffectType.VIDEO_FROM_IMAGE,
    name: 'Generate Video from Image',
    type: 'ai',
    description: "Use Veo to generate a video starting from an uploaded image."
  },
  {
    id: EffectType.NANOGEN,
    name: 'Generate Image (Flash)',
    type: 'ai',
    description: "Use Gemini Flash Image for quick image generation."
  },
  {
    id: EffectType.NANO_EDIT,
    name: 'Edit Image (Flash)',
    type: 'ai',
    description: "Use a text prompt to edit a selected image clip."
  },
  {
    id: EffectType.TTSGEN,
    name: 'Generate Speech (TTS)',
    type: 'ai',
    description: "Use Gemini to generate speech from a text prompt."
  },
  {
    id: EffectType.NATIVE_SOLID_COLOR,
    name: 'Solid Color',
    type: 'native',
    description: "Generate a solid color clip. Works offline without an API key."
  },
  {
    id: EffectType.CHROMA_KEY,
    name: 'Chroma Key (Green Screen)',
    type: 'native',
    description: 'Remove a color background (e.g., a green screen) from a clip.'
  },
  {
    id: EffectType.TEXT,
    name: 'Text Overlay',
    type: 'native',
    description: "Add and customize text on top of your clip."
  },
  {
    id: EffectType.GRAYSCALE,
    name: 'Grayscale',
    type: 'css',
    description: 'Convert the clip to black and white.'
  },
  {
    id: EffectType.SEPIA,
    name: 'Sepia',
    type: 'css',
    description: 'Apply a warm, brownish tint to the clip.'
  },
  {
    id: EffectType.INVERT,
    name: 'Invert',
    type: 'css',
    description: 'Invert the colors of the clip.'
  },
  {
    id: EffectType.BLUR,
    name: 'Blur',
    type: 'css',
    description: 'Apply a blur effect to the clip.'
  },
];

export const TRANSITIONS: Transition[] = [
    {
        id: TransitionType.CROSS_FADE,
        name: 'Cross Fade',
        duration: 1.0,
    },
    {
        id: TransitionType.FADE_TO_BLACK,
        name: 'Fade to Black',
        duration: 1.5,
    }
];

export const STYLE_PRESETS = {
    visual: [
        "Cinematic, 35mm film grain, High Contrast",
        "Neo-Noir, Shadowy, Moody, High Contrast",
        "Cyberpunk, Neon lights, Wet pavement, Futuristic",
        "Symmetric Pastel, Centered framing, Soft palette, Flat lighting",
        "Documentary Style, Handheld, Natural Lighting, Gritty",
        "Hand-Painted Animation, Vibrant, Painted background, Warm light",
        "Vintage 1950s Technicolor, Saturated, Soft Focus"
    ],
    lighting: [
        "Golden Hour, Warm soft light",
        "Blue Hour, Cold tones",
        "Rembrandt Lighting, Dramatic shadows",
        "Soft Diffused Window Light",
        "Harsh Overhead Fluorescent",
        "Volumetric Foggy Lighting"
    ],
    camera: [
        "Wide Angle Shot (24mm)",
        "Telephoto Close-up (85mm), Bokeh background",
        "Low Angle, Heroic",
        "High Angle, Bird's eye view",
        "Dutch Angle, Disorienting",
        "Macro Detail Shot"
    ]
};
