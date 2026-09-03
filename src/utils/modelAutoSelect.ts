/**
 * Auto model selection: picks the engine that is strongest for what a shot
 * actually shows, based on 2026 comparisons (GPT Image 2 / Nano Banana 2 for
 * people and products, Krea 2 for creatures and stylised art, Seedream 5 Pro
 * for environments and dense scenes, Ideogram for typography; Veo 3.1 for
 * dialogue and native audio, Kling v3 for human performance and motion
 * control, Seedance 2.5 for action, commercial work and long single shots,
 * Seedance Omni / Kling O3 when several references must stay consistent).
 *
 * The function only chooses among models the caller has available; the first
 * ranked candidate that exists wins, so removing a model never breaks a pick.
 */

export type ShotSubjectCategory =
  | 'human'
  | 'creature'
  | 'animal'
  | 'product'
  | 'typography'
  | 'environment'
  | 'architecture'
  | 'vehicle'
  | 'food'
  | 'illustration'
  | 'vfx'
  | 'dialogue'
  | 'performance'
  | 'action'
  | 'general';

const CATEGORY_KEYWORDS: Record<Exclude<ShotSubjectCategory, 'general'>, RegExp> = {
  human: /\b(portrait|face|woman|man|girl|boy|person|people|actor|actress|character|hero|heroine|protagonist|couple|family|model|skin|eyes|smile|hands?|close[- ]?up on (?:her|his|their)|frau|mann|mädchen|junge|gesicht|schauspieler)\b/i,
  creature: /\b(creature|monster|dragon|alien|beast|demon|orc|troll|goblin|mutant|kaiju|golem|werewolf|vampire|zombie|mythical|fantasy creature|kreatur|monster|drache)\b/i,
  animal: /\b(animal|dog|cat|horse|bird|wolf|lion|tiger|fox|deer|bear|fish|whale|insect|butterfly|puppy|kitten|hund|katze|pferd|vogel|tier)\b/i,
  product: /\b(product|bottle|packaging|package|device|phone|watch|sneaker|shoe|perfume|cosmetic|can|jar|gadget|headphones|laptop|hero shot|e-?commerce|produkt|flasche|verpackung)\b/i,
  typography: /\b(text|title card|poster|logo|typography|lettering|sign|signage|headline|caption|quote|label|billboard|end card|titel|schrift|plakat)\b/i,
  environment: /\b(landscape|city|skyline|street|forest|desert|mountain|ocean|beach|interior|room|kitchen|office|establishing|wide shot|aerial|drone|valley|jungle|village|alley|neon city|landschaft|stadt|wald|zimmer|straße)\b/i,
  architecture: /\b(architecture|building|facade|tower|cathedral|skyscraper|bridge|house exterior|mansion|temple|castle|architektur|gebäude|brücke|schloss)\b/i,
  vehicle: /\b(car|truck|motorcycle|bike|spaceship|starship|plane|aircraft|train|boat|ship|vehicle|auto|fahrzeug|raumschiff|flugzeug)\b/i,
  food: /\b(food|dish|meal|burger|pizza|cake|dessert|coffee|cocktail|drink|restaurant plate|essen|gericht|kuchen|kaffee)\b/i,
  illustration: /\b(illustration|anime|manga|cartoon|watercolor|painting|painted|comic|pixel art|line art|stylized|stylised|storybook|concept art|matte painting|zeichnung|gemälde|comic)\b/i,
  vfx: /\b(magic|spell|explosion|fire|portal|lightning|energy|glowing|particles|hologram|sci-?fi effect|vfx|magie|zauber|explosion|feuer)\b/i,
  dialogue: /\b(dialogue|dialog|speaks?|speaking|talks?|talking|says|saying|conversation|interview|monologue|whisper|shout|lip[- ]?sync|voice|narrat|spricht|sagt|gespräch|interview)\b/i,
  performance: /\b(dance|dancing|choreograph|perform|singing|sings|gesture|walks? toward|runs? toward|acting|expression|tanz|tanzt|singt)\b/i,
  action: /\b(fight|fighting|chase|chasing|explosion|crash|jump|jumping|sprint|running|fast|high[- ]speed|battle|punch|kick|slow[- ]motion|stunt|kampf|verfolgung|springt|rennt)\b/i,
};

export type ShotContext = {
  prompt?: string;
  description?: string;
  characters?: string[];
  environment?: string;
  products?: string[];
  /** Whether reference/start-frame images are attached. */
  hasReferences?: boolean;
  /** Number of reference images (for multi-reference video). */
  referenceCount?: number;
  hasStartFrame?: boolean;
  durationSeconds?: number;
  wantsAudio?: boolean;
};

export type AutoPick<T extends string> = {
  model: T;
  category: ShotSubjectCategory;
  reason: string;
  ranked: T[];
};

const scoreCategories = (context: ShotContext): Array<[ShotSubjectCategory, number]> => {
  const text = [
    context.prompt,
    context.description,
    context.environment,
    ...(context.characters || []),
    ...(context.products || []),
  ].filter(Boolean).join(' ');
  const scores = new Map<ShotSubjectCategory, number>();
  (Object.keys(CATEGORY_KEYWORDS) as Array<Exclude<ShotSubjectCategory, 'general'>>).forEach((category) => {
    const matches = text.match(new RegExp(CATEGORY_KEYWORDS[category].source, 'gi'));
    if (matches && matches.length > 0) scores.set(category, matches.length);
  });
  if ((context.characters || []).length > 0) scores.set('human', (scores.get('human') || 0) + 2);
  if ((context.products || []).length > 0) scores.set('product', (scores.get('product') || 0) + 2);
  return Array.from(scores.entries()).sort((a, b) => b[1] - a[1]);
};

export const classifyShot = (context: ShotContext): ShotSubjectCategory => {
  const ranked = scoreCategories(context);
  return ranked[0]?.[0] || 'general';
};

// ---------------------------------------------------------------------------
// Image rankings (ids as used by the Project hub / Image workspace)
// ---------------------------------------------------------------------------

const IMAGE_RANKINGS: Record<ShotSubjectCategory, string[]> = {
  human: ['nano-banana-2-fal', 'nano', 'nano-banana-pro', 'gpt-image-2-fal-t2i', 'gpt-image-2-fal', 'seedream-v5-pro-fal', 'imagen', 'seedream'],
  creature: ['krea-2-large-fal', 'seedream-v5-pro-fal', 'flux', 'flux-pro', 'gpt-image-2-fal-t2i', 'seedream'],
  animal: ['seedream-v5-pro-fal', 'nano-banana-2-fal', 'nano', 'krea-2-large-fal', 'imagen'],
  product: ['gpt-image-2-fal-t2i', 'gpt-image-2-fal', 'seedream-v5-pro-fal', 'flux', 'flux-pro', 'seedream'],
  typography: ['ideogram-v4-fal', 'gpt-image-2-fal-t2i', 'gpt-image-2-fal', 'seedream-v5-pro-fal', 'seedream'],
  environment: ['seedream-v5-pro-fal', 'imagen', 'krea-2-large-fal', 'flux', 'flux-pro', 'seedream'],
  architecture: ['flux', 'flux-pro', 'seedream-v5-pro-fal', 'gpt-image-2-fal-t2i', 'imagen'],
  vehicle: ['flux', 'flux-pro', 'seedream-v5-pro-fal', 'gpt-image-2-fal-t2i'],
  food: ['gpt-image-2-fal-t2i', 'gpt-image-2-fal', 'seedream-v5-pro-fal', 'nano-banana-2-fal', 'nano'],
  illustration: ['krea-2-large-fal', 'imagen', 'flux', 'flux-pro', 'seedream-v5-pro-fal'],
  vfx: ['krea-2-large-fal', 'seedream-v5-pro-fal', 'flux', 'flux-pro'],
  dialogue: ['nano-banana-2-fal', 'nano', 'gpt-image-2-fal-t2i', 'seedream-v5-pro-fal'],
  performance: ['nano-banana-2-fal', 'nano', 'seedream-v5-pro-fal', 'gpt-image-2-fal-t2i'],
  action: ['seedream-v5-pro-fal', 'nano-banana-2-fal', 'nano', 'gpt-image-2-fal-t2i'],
  general: ['seedream-v5-pro-fal', 'nano-banana-2-fal', 'nano', 'gpt-image-2-fal-t2i', 'seedream', 'imagen'],
};

/** Edit-capable models preferred when references must be honoured. */
const IMAGE_EDIT_RANKINGS: string[] = ['seedream-v5-pro-edit-fal', 'gpt-image-2-fal', 'nano-banana-2-fal', 'nano', 'gpt-image-2-fal-edit', 'nano-banana-2-fal-edit', 'wan-2.7-pro-fal', 'qwen-multiangle-fal'];

const CATEGORY_LABELS: Record<ShotSubjectCategory, string> = {
  human: 'people and faces',
  creature: 'creatures',
  animal: 'animals',
  product: 'products',
  typography: 'text and typography',
  environment: 'environments',
  architecture: 'architecture',
  vehicle: 'vehicles',
  food: 'food',
  illustration: 'stylised art',
  vfx: 'effects and magic',
  dialogue: 'dialogue',
  performance: 'human performance',
  action: 'action',
  general: 'general shots',
};

export const categoryLabel = (category: ShotSubjectCategory) => CATEGORY_LABELS[category];

export const pickImageModel = <T extends string>(context: ShotContext, available: readonly T[], fallback: T): AutoPick<T> => {
  const category = classifyShot(context);
  const availableSet = new Set<string>(available);
  const ranked = (context.hasReferences && category === 'human'
    ? [...IMAGE_EDIT_RANKINGS, ...IMAGE_RANKINGS[category]]
    : [...IMAGE_RANKINGS[category], ...(context.hasReferences ? IMAGE_EDIT_RANKINGS : [])])
    .filter((id, index, list) => list.indexOf(id) === index && availableSet.has(id)) as T[];
  const model = ranked[0] || fallback;
  return {
    model,
    category,
    ranked,
    reason: ranked.length > 0
      ? `${category === 'general' ? 'No clear subject' : `Detected ${CATEGORY_LABELS[category]}`}; ${model} ranks best for that${context.hasReferences ? ' with references' : ''}.`
      : `No ranked model available; using ${fallback}.`,
  };
};

// ---------------------------------------------------------------------------
// Video rankings (ids as used by the Project hub filming step)
// ---------------------------------------------------------------------------

const VIDEO_RANKINGS: Record<ShotSubjectCategory, string[]> = {
  dialogue: ['veo-3.1-generate-preview', 'kling-v3-pro-i2v-fal', 'seedance-2.5-i2v-fal', 'veo-3.1-fast-generate-preview', 'seedance-2.0-fal'],
  performance: ['kling-v3-pro-i2v-fal', 'kling-v2.6-motion-control', 'seedance-2.5-i2v-fal', 'kling-o3-pro-fal', 'seedance-2.0-fal'],
  human: ['kling-v3-pro-i2v-fal', 'veo-3.1-generate-preview', 'seedance-2.5-i2v-fal', 'seedance-2.0-fal'],
  action: ['seedance-2.5-i2v-fal', 'kling-v3-pro-i2v-fal', 'wan-2.7-i2v-fal', 'seedance-2.0-fal'],
  creature: ['seedance-2.5-i2v-fal', 'kling-v3-pro-i2v-fal', 'veo-3.1-generate-preview', 'seedance-2.0-fal'],
  animal: ['veo-3.1-generate-preview', 'seedance-2.5-i2v-fal', 'kling-v3-pro-i2v-fal'],
  product: ['seedance-2.5-i2v-fal', 'veo-3.1-generate-preview', 'wan-2.7-i2v-fal', 'seedance-2.0-fal'],
  typography: ['seedance-2.5-i2v-fal', 'veo-3.1-generate-preview', 'wan-2.7-i2v-fal'],
  environment: ['veo-3.1-generate-preview', 'seedance-2.5-i2v-fal', 'wan-2.7-i2v-fal', 'veo-3.1-fast-generate-preview'],
  architecture: ['veo-3.1-generate-preview', 'seedance-2.5-i2v-fal', 'wan-2.7-i2v-fal'],
  vehicle: ['seedance-2.5-i2v-fal', 'kling-v3-pro-i2v-fal', 'wan-2.7-i2v-fal'],
  food: ['veo-3.1-generate-preview', 'seedance-2.5-i2v-fal', 'wan-2.7-i2v-fal'],
  illustration: ['kling-v3-pro-i2v-fal', 'wan-2.7-i2v-fal', 'seedance-2.5-i2v-fal'],
  vfx: ['seedance-2.5-i2v-fal', 'kling-v3-pro-i2v-fal', 'veo-3.1-generate-preview'],
  general: ['seedance-2.5-i2v-fal', 'veo-3.1-fast-generate-preview', 'kling-v3-pro-i2v-fal', 'seedance-2.0-fal'],
};

const VIDEO_MULTI_REFERENCE: string[] = ['seedance-2.5-omni-fal', 'seedance-2.0-omni-fal', 'kling-o3-pro-fal', 'pixverse-c1-reference-fal'];
const VIDEO_TEXT_ONLY: string[] = ['seedance-2.5-t2v-fal', 'veo-3.1-generate-preview', 'veo-3.1-fast-generate-preview', 'kling-v3-pro-t2v-fal', 'wan-2.7-t2v-fal'];
const VIDEO_LONG_TAKE: string[] = ['seedance-2.5-i2v-fal', 'seedance-2.5-omni-fal', 'seedance-2.5-t2v-fal'];

export const pickVideoModel = <T extends string>(context: ShotContext, available: readonly T[], fallback: T): AutoPick<T> => {
  const category = classifyShot(context);
  const availableSet = new Set<string>(available);
  let ranked: string[];
  let why: string;
  if ((context.referenceCount || 0) >= 2 && category !== 'dialogue') {
    ranked = [...VIDEO_MULTI_REFERENCE, ...VIDEO_RANKINGS[category]];
    why = `${context.referenceCount} references need consistency`;
  } else if (context.hasStartFrame === false) {
    ranked = [...VIDEO_TEXT_ONLY, ...VIDEO_RANKINGS[category]];
    why = 'no start frame, text-to-video engines first';
  } else if ((context.durationSeconds || 0) > 15) {
    ranked = [...VIDEO_LONG_TAKE, ...VIDEO_RANKINGS[category]];
    why = `${context.durationSeconds}s single take`;
  } else {
    ranked = VIDEO_RANKINGS[category];
    why = category === 'general' ? 'no clear subject' : `detected ${CATEGORY_LABELS[category]}`;
  }
  const filtered = ranked.filter((id, index, list) => list.indexOf(id) === index && availableSet.has(id)) as T[];
  const model = filtered[0] || fallback;
  return {
    model,
    category,
    ranked: filtered,
    reason: filtered.length > 0 ? `${why}; ${model} ranks best.` : `No ranked model available; using ${fallback}.`,
  };
};
