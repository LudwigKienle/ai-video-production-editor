import type {
  CreativeDNACameraBehavior,
  CreativeDNACharacterEnergy,
  CreativeDNADirectorMode,
  CreativeDNAEditRhythm,
  CreativeDNAEmotionalVector,
  CreativeDNALightingIntent,
  CreativeDNAPacingMode,
  CreativeDNAProfile,
  CreativeDNASceneOverride,
  CreativeDNAShotOverride,
  StoryBible,
} from '../types';

type CreativeDNAPresetMeta = {
  label: string;
  description: string;
  profile: CreativeDNAProfile;
};

export const DEFAULT_CREATIVE_DNA: CreativeDNAProfile = {
  directorMode: 'prestige',
  emotionalVector: 'restrained',
  pacingMode: 'measured',
  characterEnergy: 'magnetic',
  cameraBehavior: 'gliding',
  editRhythm: 'motivated',
  lightingIntent: 'natural',
};

export const CREATIVE_DNA_PRESETS: Record<
  CreativeDNADirectorMode,
  CreativeDNAPresetMeta
> = {
  intimate: {
    label: 'Intimate',
    description: 'Close emotional distance, gentle motion, restrained edits.',
    profile: {
      directorMode: 'intimate',
      emotionalVector: 'tender',
      pacingMode: 'slow_burn',
      characterEnergy: 'vulnerable',
      cameraBehavior: 'gliding',
      editRhythm: 'invisible',
      lightingIntent: 'natural',
    },
  },
  prestige: {
    label: 'Prestige',
    description: 'Controlled, cinematic, polished dramatic coverage.',
    profile: {
      ...DEFAULT_CREATIVE_DNA,
      directorMode: 'prestige',
    },
  },
  kinetic: {
    label: 'Kinetic',
    description: 'High drive, aggressive motion, propulsive editorial rhythm.',
    profile: {
      directorMode: 'kinetic',
      emotionalVector: 'charged',
      pacingMode: 'urgent',
      characterEnergy: 'chaotic',
      cameraBehavior: 'aggressive',
      editRhythm: 'trailer',
      lightingIntent: 'contrast',
    },
  },
  dreamlike: {
    label: 'Dreamlike',
    description: 'Floaty emotion, softened logic, poetic transitions.',
    profile: {
      directorMode: 'dreamlike',
      emotionalVector: 'tender',
      pacingMode: 'measured',
      characterEnergy: 'magnetic',
      cameraBehavior: 'gliding',
      editRhythm: 'music_led',
      lightingIntent: 'golden',
    },
  },
  documentary: {
    label: 'Documentary',
    description: 'Observed realism, practical motion, low artifice.',
    profile: {
      directorMode: 'documentary',
      emotionalVector: 'restrained',
      pacingMode: 'measured',
      characterEnergy: 'authoritative',
      cameraBehavior: 'handheld',
      editRhythm: 'motivated',
      lightingIntent: 'natural',
    },
  },
  comic: {
    label: 'Comic',
    description: 'Expressive performance, punchy frames, heightened design.',
    profile: {
      directorMode: 'comic',
      emotionalVector: 'triumphant',
      pacingMode: 'urgent',
      characterEnergy: 'playful',
      cameraBehavior: 'locked',
      editRhythm: 'music_led',
      lightingIntent: 'studio',
    },
  },
  product_hero: {
    label: 'Product Hero',
    description: 'High control, polished contrast, premium commercial finish.',
    profile: {
      directorMode: 'product_hero',
      emotionalVector: 'triumphant',
      pacingMode: 'measured',
      characterEnergy: 'authoritative',
      cameraBehavior: 'locked',
      editRhythm: 'motivated',
      lightingIntent: 'studio',
    },
  },
};

const DIRECTOR_PERSONA_MODE_MAP: Record<string, CreativeDNADirectorMode> = {
  'large-format-realist': 'prestige',
  'kinetic-dialogue': 'kinetic',
  'symmetric-pastel': 'comic',
  'classic-suspense': 'prestige',
  'warm-adventure': 'intimate',
  'precision-thriller': 'prestige',
  'dreamlike-epic': 'dreamlike',
  'street-crime-kinetic': 'kinetic',
  'intimate-coming-of-age': 'intimate',
  'observational-naturalism': 'documentary',
  'romantic-neon-drama': 'dreamlike',
  commercial: 'product_hero',
  product: 'product_hero',
  documentary: 'documentary',
};

const mergeProfile = (
  base: CreativeDNAProfile,
  patch?: Partial<CreativeDNAProfile> | null,
): CreativeDNAProfile => ({
  ...base,
  ...(patch || {}),
});

export const mapDirectorPersonaToCreativeMode = (
  directorPersona?: string | null,
): CreativeDNADirectorMode => {
  const normalized = (directorPersona || '').trim().toLowerCase();
  if (!normalized) return DEFAULT_CREATIVE_DNA.directorMode;
  return DIRECTOR_PERSONA_MODE_MAP[normalized] || DEFAULT_CREATIVE_DNA.directorMode;
};

export const createCreativeDNAPreset = (
  mode: CreativeDNADirectorMode,
): CreativeDNAProfile => ({
  ...CREATIVE_DNA_PRESETS[mode].profile,
});

export const normalizeCreativeDNAProfile = (
  profile?: Partial<CreativeDNAProfile> | null,
): CreativeDNAProfile => {
  const candidateMode = profile?.directorMode;
  const preset =
    candidateMode && CREATIVE_DNA_PRESETS[candidateMode]
      ? CREATIVE_DNA_PRESETS[candidateMode].profile
      : DEFAULT_CREATIVE_DNA;
  return mergeProfile(preset, profile);
};

export const resolveCreativeDNAProfile = (params: {
  storyBible?: StoryBible | null;
  sceneOverride?: CreativeDNASceneOverride | null;
  shotOverride?: CreativeDNAShotOverride | null;
  taskOverride?: Partial<CreativeDNAProfile> | null;
}): CreativeDNAProfile => {
  const storyProfile =
    params.storyBible?.creativeDNA ||
    createCreativeDNAPreset(
      mapDirectorPersonaToCreativeMode(params.storyBible?.directorPersona),
    );

  return normalizeCreativeDNAProfile(
    mergeProfile(
      mergeProfile(
        mergeProfile(storyProfile, params.sceneOverride || null),
        params.shotOverride || null,
      ),
      params.taskOverride || null,
    ),
  );
};

const formatToken = (value: string) => value.replace(/_/g, ' ');

const DIMENSION_LABELS: Array<{
  key: keyof CreativeDNAProfile;
  label: string;
}> = [
  { key: 'directorMode', label: 'director mode' },
  { key: 'emotionalVector', label: 'emotional vector' },
  { key: 'pacingMode', label: 'pacing' },
  { key: 'characterEnergy', label: 'character energy' },
  { key: 'cameraBehavior', label: 'camera behavior' },
  { key: 'editRhythm', label: 'edit rhythm' },
  { key: 'lightingIntent', label: 'lighting intent' },
];

export const summarizeCreativeDNA = (profile?: CreativeDNAProfile | null) => {
  const resolved = normalizeCreativeDNAProfile(profile);
  const summary = DIMENSION_LABELS.map(
    ({ key, label }) => `${label}: ${formatToken(String(resolved[key]))}`,
  );
  if (resolved.notes?.trim()) {
    summary.push(`notes: ${resolved.notes.trim()}`);
  }
  return summary.join(' | ');
};

export const buildCreativeDNAGuidance = (
  profile?: CreativeDNAProfile | null,
) => {
  const resolved = normalizeCreativeDNAProfile(profile);
  return [
    `Creative DNA: ${CREATIVE_DNA_PRESETS[resolved.directorMode].label}.`,
    `Emotional tone should feel ${formatToken(resolved.emotionalVector)} with ${formatToken(resolved.characterEnergy)} performances.`,
    `Camera behavior should stay ${formatToken(resolved.cameraBehavior)} and editorial rhythm should feel ${formatToken(resolved.editRhythm)}.`,
    `Pacing should remain ${formatToken(resolved.pacingMode)} with ${formatToken(resolved.lightingIntent)} lighting intent.`,
    resolved.notes?.trim() ? `Additional DNA notes: ${resolved.notes.trim()}` : '',
  ]
    .filter(Boolean)
    .join(' ');
};

export const buildCreativeDNAReviewRubric = (
  profile?: CreativeDNAProfile | null,
) => {
  const resolved = normalizeCreativeDNAProfile(profile);
  return [
    `Check whether pacing reads as ${formatToken(resolved.pacingMode)}.`,
    `Check whether framing and movement feel ${formatToken(resolved.cameraBehavior)} rather than generic.`,
    `Check whether performance energy lands as ${formatToken(resolved.characterEnergy)}.`,
    `Check whether lighting reads ${formatToken(resolved.lightingIntent)}.`,
    `Check whether the cut rhythm supports a ${formatToken(resolved.editRhythm)} editorial language.`,
  ].join(' ');
};

export const findCreativeDNASceneOverride = (
  storyBible: StoryBible | null | undefined,
  params: { sceneNumber?: number | null; sceneSlugline?: string | null },
) => {
  const overrides = storyBible?.creativeDNASceneOverrides || [];
  return (
    overrides.find(
      (entry) =>
        typeof params.sceneNumber === 'number' &&
        typeof entry.sceneNumber === 'number' &&
        entry.sceneNumber === params.sceneNumber,
    ) ||
    overrides.find(
      (entry) =>
        entry.sceneSlugline &&
        params.sceneSlugline &&
        entry.sceneSlugline.trim().toLowerCase() ===
          params.sceneSlugline.trim().toLowerCase(),
    ) ||
    null
  );
};

export const getCreativeDNADimensionOptions = () => ({
  directorMode: Object.keys(CREATIVE_DNA_PRESETS) as CreativeDNADirectorMode[],
  emotionalVector: [
    'restrained',
    'tender',
    'charged',
    'anxious',
    'triumphant',
  ] as CreativeDNAEmotionalVector[],
  pacingMode: [
    'slow_burn',
    'measured',
    'urgent',
    'hyper_cut',
  ] as CreativeDNAPacingMode[],
  characterEnergy: [
    'stoic',
    'playful',
    'authoritative',
    'chaotic',
    'vulnerable',
    'magnetic',
  ] as CreativeDNACharacterEnergy[],
  cameraBehavior: [
    'locked',
    'gliding',
    'handheld',
    'aggressive',
  ] as CreativeDNACameraBehavior[],
  editRhythm: [
    'invisible',
    'motivated',
    'music_led',
    'trailer',
  ] as CreativeDNAEditRhythm[],
  lightingIntent: [
    'natural',
    'contrast',
    'golden',
    'neon',
    'studio',
  ] as CreativeDNALightingIntent[],
});
