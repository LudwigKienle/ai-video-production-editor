/**
 * Per-model prompt structure, distilled from each provider's prompting docs.
 *
 * Every model family wants information in a slightly different order and
 * style. `structurePromptForModel()` rewrites a loose brief into the structure
 * a model responds to best, without inventing content: it only reorders,
 * labels and appends the format cues the model expects.
 *
 * Sources (summarised):
 * - Seedance 2.x (fal/BytePlus): natural-language "subject + action + scene +
 *   camera + lighting + style", supports explicit camera moves and audio cues,
 *   prefers one continuous shot description; negatives via plain phrasing.
 * - Kling v3 / O3: "[shot type] [subject] [action] [environment] [lighting]
 *   [camera movement]"; short sentences; avoid abstract words.
 * - Veo 3.1: cinematic descriptors first, then subject/action, camera, lens,
 *   lighting, mood, and dialogue/sfx in quotes for audio.
 * - WAN 2.7 / Happy Horse: descriptive prose with motion and lens details.
 * - Seedream 5 / 4.5: composition-first, literal text in double quotes,
 *   explicit layout and style; keeps aspect/size in the API not the prompt.
 * - GPT Image 2: long natural language, explicit materials, typography, layout;
 *   quotes for text.
 * - Ideogram 4: typography-friendly; put the exact text in quotes, style words
 *   at the end (poster, logo, typography, photo).
 * - Krea 2: aesthetic-first, short evocative phrases, camera/film stock,
 *   avoids long instruction lists.
 * - Flux 1.1 / 2: precise nouns and adjectives, lighting and lens, no negatives.
 * - Nano Banana 2 / Gemini image: conversational, scene description with
 *   reasoning-friendly detail; edits phrased as instructions.
 * - Imagen 4: photography vocabulary (lens, aperture, film), subject, context.
 * - Grok Imagine: playful natural language, supports style references.
 */

export type PromptMediaKind = 'image' | 'video';

export type PromptGuide = {
  id: string;
  match: RegExp;
  label: string;
  kind: PromptMediaKind | 'both';
  /** Ordered sections the model likes; `key` maps onto PromptBrief fields. */
  order: PromptSectionKey[];
  /** Style of joining sections. */
  join: 'sentences' | 'comma' | 'labelled';
  /** Extra suffix appended when the brief lacks it (e.g. "cinematic, 35mm"). */
  defaultStyle?: string;
  /** How literal text should be wrapped. */
  textQuoting?: 'double' | 'none';
  /** Whether negative prompts are supported in-prompt. */
  supportsNegative: boolean;
  /** Whether audio/dialogue cues belong in the prompt. */
  supportsAudioCues: boolean;
  /** Max recommended words. */
  maxWords: number;
  tips: string[];
};

export type PromptSectionKey = 'shot' | 'subject' | 'action' | 'scene' | 'camera' | 'lighting' | 'style' | 'text' | 'audio' | 'negative';

export type PromptBrief = Partial<Record<PromptSectionKey, string>> & {
  /** Free-form brief when the caller has not split it into sections. */
  raw?: string;
};

const SHOT_WORDS = /\b(close[- ]?up|wide shot|medium shot|extreme close[- ]?up|establishing shot|over[- ]the[- ]shoulder|two[- ]shot|low angle|high angle|bird'?s[- ]eye|pov|point of view|macro|full shot|cowboy shot|dutch angle)\b/i;
const CAMERA_WORDS = /\b(dolly|push[- ]in|pull[- ]out|pan(?:ning)?|tilt(?:ing)?|crane|handheld|steadicam|tracking shot|orbit|zoom(?:ing)?|rack focus|slow motion|slow-mo|timelapse|drone|gimbal|static camera|locked off|whip pan)\b/i;
const LIGHTING_WORDS = /\b(golden hour|blue hour|backlit|rim light|soft light|hard light|neon|volumetric|chiaroscuro|overcast|moonlight|candlelight|practical lights?|high[- ]key|low[- ]key|natural light|studio lighting|silhouette|god rays|fluorescent|tungsten)\b/i;
const STYLE_WORDS = /\b(cinematic|photorealistic|anamorphic|35 ?mm|16 ?mm|70 ?mm|film grain|kodak|fuji|portra|arri alexa|red komodo|imax|documentary|noir|anime|watercolor|oil painting|illustration|3d render|octane|unreal engine|editorial|fashion|vogue|polaroid|vhs|analog)\b/i;
const AUDIO_WORDS = /\b(dialogue|says|whispers|shouts|voice[- ]over|narration|sound of|sfx|ambient sound|music|soundtrack|footsteps|rain sounds?)\b/i;

export const PROMPT_GUIDES: PromptGuide[] = [
  {
    id: 'seedance',
    match: /seedance/i,
    label: 'Seedance',
    kind: 'video',
    order: ['shot', 'subject', 'action', 'scene', 'camera', 'lighting', 'style', 'audio'],
    join: 'sentences',
    defaultStyle: 'cinematic, realistic motion, coherent single shot',
    supportsNegative: false,
    supportsAudioCues: true,
    maxWords: 140,
    tips: ['Describe one continuous shot; name the camera move explicitly.', 'Put dialogue or sound cues at the end in quotes; Seedance renders synced audio.'],
  },
  {
    id: 'kling',
    match: /kling/i,
    label: 'Kling',
    kind: 'video',
    order: ['shot', 'subject', 'action', 'scene', 'lighting', 'camera', 'style'],
    join: 'comma',
    defaultStyle: 'cinematic, high detail',
    supportsNegative: true,
    supportsAudioCues: false,
    maxWords: 110,
    tips: ['Lead with the shot type, then subject and a single clear action.', 'Keep sentences short; abstract words lower motion quality.'],
  },
  {
    id: 'veo',
    match: /veo/i,
    label: 'Veo',
    kind: 'video',
    order: ['style', 'shot', 'subject', 'action', 'scene', 'camera', 'lighting', 'audio'],
    join: 'sentences',
    defaultStyle: 'Cinematic film still quality, shallow depth of field',
    textQuoting: 'double',
    supportsNegative: false,
    supportsAudioCues: true,
    maxWords: 150,
    tips: ['Start with the cinematic look, then the subject and action.', 'Write dialogue in quotes and describe ambient sound for native audio.'],
  },
  {
    id: 'wan',
    match: /wan|happy-horse|happy horse|ltx|pixverse/i,
    label: 'WAN / Happy Horse / LTX',
    kind: 'video',
    order: ['subject', 'action', 'scene', 'camera', 'lighting', 'style', 'audio'],
    join: 'sentences',
    defaultStyle: 'cinematic, natural motion, 24fps look',
    supportsNegative: true,
    supportsAudioCues: true,
    maxWords: 120,
    tips: ['Descriptive prose works best; mention lens and motion speed.'],
  },
  {
    id: 'grok-video',
    match: /grok/i,
    label: 'Grok Imagine',
    kind: 'both',
    order: ['subject', 'action', 'scene', 'style', 'camera', 'lighting'],
    join: 'sentences',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 100,
    tips: ['Conversational phrasing is fine; keep it vivid and concrete.'],
  },
  {
    id: 'seedream',
    match: /seedream/i,
    label: 'Seedream',
    kind: 'image',
    order: ['shot', 'subject', 'scene', 'text', 'lighting', 'style'],
    join: 'comma',
    defaultStyle: 'photorealistic, high detail',
    textQuoting: 'double',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 120,
    tips: ['Composition first, then subject; literal text goes in double quotes.', 'Dense layouts: describe positions (top-left, centre) explicitly.'],
  },
  {
    id: 'gpt-image',
    match: /gpt-image|gpt image|openai/i,
    label: 'GPT Image',
    kind: 'image',
    order: ['subject', 'scene', 'text', 'lighting', 'camera', 'style'],
    join: 'sentences',
    textQuoting: 'double',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 220,
    tips: ['Long natural language is welcome: materials, typography, layout.', 'Any words that must appear go in quotes.'],
  },
  {
    id: 'ideogram',
    match: /ideogram/i,
    label: 'Ideogram',
    kind: 'image',
    order: ['text', 'subject', 'scene', 'lighting', 'style'],
    join: 'comma',
    defaultStyle: 'typography, poster design',
    textQuoting: 'double',
    supportsNegative: true,
    supportsAudioCues: false,
    maxWords: 100,
    tips: ['Lead with the exact text in quotes, then the design context.', 'Finish with a style word: poster, logo, typography, photo.'],
  },
  {
    id: 'krea',
    match: /krea/i,
    label: 'Krea',
    kind: 'image',
    order: ['style', 'subject', 'scene', 'lighting', 'camera'],
    join: 'comma',
    defaultStyle: 'editorial photography, kodak portra 400',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 70,
    tips: ['Aesthetic first: short evocative phrases beat instruction lists.', 'Name a film stock or camera for a consistent look.'],
  },
  {
    id: 'flux',
    match: /flux|z-image|z-turbo/i,
    label: 'Flux / Z-Image',
    kind: 'image',
    order: ['subject', 'action', 'scene', 'lighting', 'camera', 'style'],
    join: 'comma',
    defaultStyle: 'photorealistic, 50mm lens, sharp focus',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 110,
    tips: ['Precise nouns and adjectives; Flux ignores negatives.', 'State lens and lighting instead of "high quality".'],
  },
  {
    id: 'nano-banana',
    match: /nano|gemini|banana/i,
    label: 'Nano Banana / Gemini',
    kind: 'image',
    order: ['subject', 'action', 'scene', 'lighting', 'camera', 'style', 'text'],
    join: 'sentences',
    textQuoting: 'double',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 160,
    tips: ['Describe the scene like a brief to a photographer; edits as plain instructions.'],
  },
  {
    id: 'imagen',
    match: /imagen/i,
    label: 'Imagen',
    kind: 'image',
    order: ['subject', 'scene', 'camera', 'lighting', 'style'],
    join: 'comma',
    defaultStyle: 'DSLR photo, 85mm lens, f/2.8',
    supportsNegative: false,
    supportsAudioCues: false,
    maxWords: 90,
    tips: ['Photography vocabulary (lens, aperture, film) steers Imagen best.'],
  },
  {
    id: 'qwen',
    match: /qwen|wan-v27-pro|wan 2\.7 pro/i,
    label: 'Qwen / WAN Image',
    kind: 'image',
    order: ['subject', 'scene', 'text', 'lighting', 'camera', 'style'],
    join: 'sentences',
    textQuoting: 'double',
    supportsNegative: true,
    supportsAudioCues: false,
    maxWords: 140,
    tips: ['Strong multilingual text rendering; quote the exact words.'],
  },
];

const GENERIC_IMAGE: PromptGuide = {
  id: 'generic-image',
  match: /.*/,
  label: 'Generic image',
  kind: 'image',
  order: ['shot', 'subject', 'action', 'scene', 'lighting', 'camera', 'style', 'text'],
  join: 'comma',
  supportsNegative: false,
  supportsAudioCues: false,
  maxWords: 120,
  tips: [],
};

const GENERIC_VIDEO: PromptGuide = {
  ...GENERIC_IMAGE,
  id: 'generic-video',
  label: 'Generic video',
  kind: 'video',
  order: ['shot', 'subject', 'action', 'scene', 'camera', 'lighting', 'style', 'audio'],
  join: 'sentences',
  supportsAudioCues: true,
};

export const getPromptGuide = (modelIdOrLabel: string, kind: PromptMediaKind): PromptGuide => {
  const guide = PROMPT_GUIDES.find((entry) => entry.match.test(modelIdOrLabel) && (entry.kind === kind || entry.kind === 'both'));
  return guide || (kind === 'video' ? GENERIC_VIDEO : GENERIC_IMAGE);
};

/** Splits a free-form brief into rough sections using vocabulary cues. */
export const splitBrief = (raw: string): PromptBrief => {
  const cleaned = raw.replace(/\s+/g, ' ').trim();
  if (!cleaned) return {};
  const parts = cleaned.split(/(?<=[.!?])\s+|\s*;\s*|\s*\|\s*/).map((p) => p.trim()).filter(Boolean);
  const brief: PromptBrief = {};
  const push = (key: PromptSectionKey, value: string) => {
    brief[key] = brief[key] ? `${brief[key]}, ${value}` : value;
  };
  parts.forEach((part, index) => {
    const quoted = part.match(/"([^"]+)"|“([^”]+)”/);
    if (quoted && !brief.text) {
      push('text', quoted[1] || quoted[2]);
    }
    if (AUDIO_WORDS.test(part) && !SHOT_WORDS.test(part)) push('audio', part);
    else if (CAMERA_WORDS.test(part) && part.split(' ').length <= 12) push('camera', part);
    else if (LIGHTING_WORDS.test(part) && part.split(' ').length <= 12) push('lighting', part);
    else if (STYLE_WORDS.test(part) && part.split(' ').length <= 10) push('style', part);
    else if (SHOT_WORDS.test(part) && part.split(' ').length <= 8) push('shot', part);
    else if (index === 0) push('subject', part);
    else if (!brief.action && /\b(ing|s)\b/.test(part)) push('action', part);
    else push('scene', part);
  });
  return brief;
};

const stripTrailingPunctuation = (value: string) => value.replace(/[.,;\s]+$/g, '');

/**
 * Rebuilds the prompt in the order the model prefers. Nothing is invented:
 * sections come from the brief; only the guide's default style is appended
 * when no style cue is present, and text is quoted the way the model expects.
 */
export const structurePromptForModel = (
  modelIdOrLabel: string,
  input: string | PromptBrief,
  kind: PromptMediaKind,
  options?: { appendDefaultStyle?: boolean; formatSuffix?: string; negative?: string },
): { prompt: string; guide: PromptGuide; negative?: string; notes: string[] } => {
  const guide = getPromptGuide(modelIdOrLabel, kind);
  const brief: PromptBrief = typeof input === 'string' ? splitBrief(input) : { ...input };
  if (typeof input === 'string' && Object.keys(brief).length === 0) {
    return { prompt: input, guide, notes: [] };
  }
  const notes: string[] = [];
  const sections: string[] = [];
  guide.order.forEach((key) => {
    let value = brief[key];
    if (!value) return;
    value = stripTrailingPunctuation(value);
    if (key === 'text') {
      const inner = value.replace(/^["“]|["”]$/g, '');
      value = guide.textQuoting === 'double' ? `text reads "${inner}"` : `text: ${inner}`;
    }
    if (key === 'audio' && !guide.supportsAudioCues) {
      notes.push(`${guide.label} ignores audio cues; removed "${value}".`);
      return;
    }
    if (key === 'negative') return;
    sections.push(value);
  });
  const hasStyle = Boolean(brief.style) || STYLE_WORDS.test(sections.join(' '));
  if (!hasStyle && guide.defaultStyle && (options?.appendDefaultStyle ?? true)) {
    sections.push(guide.defaultStyle);
    notes.push(`Added ${guide.label} default look: ${guide.defaultStyle}.`);
  }
  if (options?.formatSuffix) sections.push(stripTrailingPunctuation(options.formatSuffix));

  let prompt = guide.join === 'sentences'
    ? sections.map((s) => (s.endsWith('.') ? s : `${s}.`)).join(' ')
    : sections.join(', ');

  const words = prompt.split(/\s+/).length;
  if (words > guide.maxWords) {
    notes.push(`Prompt is ${words} words; ${guide.label} works best under ${guide.maxWords}.`);
  }
  let negative = options?.negative || brief.negative;
  if (negative && !guide.supportsNegative) {
    notes.push(`${guide.label} has no negative prompt; folded it into the description.`);
    prompt = guide.join === 'sentences' ? `${prompt} Avoid ${stripTrailingPunctuation(negative)}.` : `${prompt}, avoid ${stripTrailingPunctuation(negative)}`;
    negative = undefined;
  }
  return { prompt, guide, negative, notes };
};
