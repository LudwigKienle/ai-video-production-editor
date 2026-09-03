/**
 * Production formats: project-level templates that set sensible defaults for
 * every generation surface (aspect ratio, look, character styling, pacing).
 * A microdrama, a commercial and a feature film want very different defaults;
 * picking the format once in the Project hub applies them everywhere.
 */

export type ProductionFormatId = 'feature' | 'short' | 'commercial' | 'microdrama' | 'music-video' | 'documentary' | 'social';

export type ProductionFormat = {
  id: ProductionFormatId;
  label: string;
  tagline: string;
  description: string;
  aspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9' | '235:100';
  videoAspectRatio: '16:9' | '9:16' | '1:1' | '4:3' | '21:9';
  /** Typical shot length in seconds. */
  shotDuration: number;
  /** Appended to image and video prompts so every generation shares the look. */
  lookSuffix: string;
  /** Appended when generating characters, casting stills, or avatars. */
  characterSuffix: string;
  /** Default colour treatment: maps onto the Color page presets. */
  colorPresetId?: string;
  /** Preferred engines, first available wins. */
  preferredImageModels: string[];
  preferredVideoModels: string[];
  /** Hub phases that matter most for this format, in order. */
  emphasisPhases: string[];
  /** Short tips shown in the Project hub. */
  tips: string[];
};

export const PRODUCTION_FORMATS: ProductionFormat[] = [
  {
    id: 'feature',
    label: 'Feature / Series',
    tagline: 'Long-form narrative',
    description: 'Widescreen, scene-driven storytelling with a full script-to-storyboard-to-filming loop.',
    aspectRatio: '235:100',
    videoAspectRatio: '21:9',
    shotDuration: 6,
    lookSuffix: 'anamorphic 2.39:1 widescreen, cinematic film look, ARRI Alexa colour science, natural skin tones, shallow depth of field',
    characterSuffix: 'cinematic character portrait, natural skin texture, motivated lighting, ARRI Alexa look',
    colorPresetId: 'warm-film',
    preferredImageModels: ['seedream-v5-pro-fal', 'gpt-image-2-fal', 'seedream'],
    preferredVideoModels: ['seedance-25-i2v-fal', 'kling-v3-pro-i2v-fal', 'veo'],
    emphasisPhases: ['script', 'director', 'storyboard', 'filming', 'review'],
    tips: ['Lock the script and director treatment before generating shots.', 'Use the Scene Wall for anything longer than 20 scenes.'],
  },
  {
    id: 'short',
    label: 'Short film',
    tagline: 'Festival-ready 16:9',
    description: 'Compact narrative with a handful of scenes and strong visual identity.',
    aspectRatio: '16:9',
    videoAspectRatio: '16:9',
    shotDuration: 5,
    lookSuffix: '16:9 cinematic, filmic contrast, 35mm lens, natural skin tones',
    characterSuffix: 'cinematic character portrait, natural skin texture, 35mm lens',
    colorPresetId: 'punchy',
    preferredImageModels: ['seedream-v5-pro-fal', 'seedream', 'gpt-image-2-fal'],
    preferredVideoModels: ['seedance-25-i2v-fal', 'kling-v3-pro-i2v-fal', 'veo'],
    emphasisPhases: ['script', 'concept', 'storyboard', 'filming'],
    tips: ['Keep to one look preset for the whole film.'],
  },
  {
    id: 'microdrama',
    label: 'Microdrama',
    tagline: 'Vertical episodic, 9:16',
    description: 'Mobile-first episodes of 60 to 120 seconds with hooks every few seconds, glossy casting and a clean, flattering skin-tone look.',
    aspectRatio: '9:16',
    videoAspectRatio: '9:16',
    shotDuration: 4,
    lookSuffix: 'vertical 9:16 framing for mobile, glossy microdrama look, ARRI Alexa skin tones, soft beauty lighting, high production value, crisp modern styling',
    characterSuffix: 'attractive lead in glossy microdrama style, flattering soft beauty lighting, polished styling, ARRI Alexa skin tones, vertical 9:16 portrait framing',
    colorPresetId: 'warm-film',
    preferredImageModels: ['seedream-v5-pro-fal', 'nano-banana-2-fal', 'gpt-image-2-fal'],
    preferredVideoModels: ['seedance-25-i2v-fal', 'kling-v3-pro-i2v-fal', 'seedance-2-fal'],
    emphasisPhases: ['script', 'concept', 'storyboard', 'filming', 'marketing'],
    tips: ['Open every episode with a hook in the first three seconds and end on a cliffhanger.', 'Cast with the character suffix so leads stay consistent across episodes.', 'Storyboard in 9:16; the Video page defaults to vertical for this format.'],
  },
  {
    id: 'commercial',
    label: 'Commercial',
    tagline: 'Product-led, 15–60 s',
    description: 'Brand and product spots where the hero object, tagline and end card matter most.',
    aspectRatio: '16:9',
    videoAspectRatio: '16:9',
    shotDuration: 3,
    lookSuffix: 'polished commercial look, studio-grade product lighting, clean highlights, crisp detail',
    characterSuffix: 'commercial casting, friendly natural expression, clean beauty lighting',
    colorPresetId: 'punchy',
    preferredImageModels: ['gpt-image-2-fal', 'seedream-v5-pro-fal', 'ideogram-v4-fal'],
    preferredVideoModels: ['veo', 'seedance-25-i2v-fal', 'kling-v3-pro-i2v-fal'],
    emphasisPhases: ['concept', 'storyboard', 'filming', 'marketing'],
    tips: ['Generate the end card with Ideogram or GPT Image for clean typography.'],
  },
  {
    id: 'music-video',
    label: 'Music video',
    tagline: 'Beat-driven visuals',
    description: 'Performance and concept footage cut to the track, with bold looks and fast rhythm.',
    aspectRatio: '16:9',
    videoAspectRatio: '16:9',
    shotDuration: 3,
    lookSuffix: 'stylised music video look, bold colour, dynamic camera, high contrast',
    characterSuffix: 'performer portrait, stylised lighting, fashion-forward styling',
    colorPresetId: 'teal-orange',
    preferredImageModels: ['krea-2-large-fal', 'seedream-v5-pro-fal'],
    preferredVideoModels: ['seedance-25-ref-fal', 'kling-o3-pro-fal'],
    emphasisPhases: ['concept', 'storyboard', 'filming'],
    tips: ['Use Auto Cut with beat detection once the track is on the timeline.'],
  },
  {
    id: 'documentary',
    label: 'Documentary',
    tagline: 'Observational, natural',
    description: 'Interview and b-roll driven pieces with a restrained, natural look.',
    aspectRatio: '16:9',
    videoAspectRatio: '16:9',
    shotDuration: 8,
    lookSuffix: 'documentary realism, available light, handheld feel, natural colour',
    characterSuffix: 'documentary portrait, natural light, candid expression',
    colorPresetId: 'lifted-matte',
    preferredImageModels: ['nano-banana-2-fal', 'seedream-v5-pro-fal'],
    preferredVideoModels: ['veo', 'wan-v27-i2v-fal'],
    emphasisPhases: ['script', 'storyboard', 'filming', 'review'],
    tips: ['Silence removal in Auto Cut is tuned for interviews.'],
  },
  {
    id: 'social',
    label: 'Social clip',
    tagline: 'Short vertical or square',
    description: 'Quick social-first clips and stills with punchy pacing.',
    aspectRatio: '9:16',
    videoAspectRatio: '9:16',
    shotDuration: 3,
    lookSuffix: 'social-first vertical framing, bright punchy look, crisp detail',
    characterSuffix: 'social creator portrait, bright soft lighting, vertical framing',
    colorPresetId: 'punchy',
    preferredImageModels: ['nano-banana-2-fal', 'krea-2-turbo-fal'],
    preferredVideoModels: ['seedance-25-t2v-fal', 'happy-horse-i2v-fal'],
    emphasisPhases: ['concept', 'filming', 'marketing'],
    tips: ['Export in 9:16 from Deliver; captions come from the Titles panel.'],
  },
];

export const DEFAULT_PRODUCTION_FORMAT_ID: ProductionFormatId = 'feature';

export const getProductionFormat = (id?: string | null): ProductionFormat =>
  PRODUCTION_FORMATS.find((format) => format.id === id) || PRODUCTION_FORMATS[0];

/** Picks the first preferred engine that the workspace actually offers. */
export const pickPreferredModel = <T extends string>(preferred: string[], available: T[], fallback: T): T =>
  (preferred.find((id) => (available as string[]).includes(id)) as T | undefined) || fallback;
