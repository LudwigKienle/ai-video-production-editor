/**
 * Model-specific prompt shaping.
 *
 * Every image and video model reads prompts differently: Midjourney wants a parameter
 * strip (--ar, --stylize, --no …) after terse scene phrases; Gemini/Nano Banana and
 * Imagen want narrative prose with no parameters at all (aspect ratio is an API field);
 * Flux ignores negatives; Seedream reads each clause as a directive; Ideogram wants the
 * in-image text first and quoted; Veo wants cinematography first and `Name says: "…"`;
 * Kling wants short action plus clearly separated camera sentences; Seedance wants
 * numbered shots without hard timings; LTX wants 4–8 sentences with [performance cues];
 * Hailuo wants [Push in]-style camera brackets.
 *
 * The editor assembles prompts generically (subject, camera, lighting, aspect hints,
 * continuity notes…). `adaptPromptForModel` takes that generic text, classifies each
 * sentence, drops what the target model must not see (aspect text when the API sets the
 * ratio, negatives for models that ignore them) and re-orders / re-formats the rest the
 * way the model's own guide recommends. `promptStyleGuide` gives the same rules to the
 * LLM prompt writers so they draft in the right voice from the start.
 */

export type PromptKind = 'image' | 'video';

export type PromptFamily =
  | 'midjourney'
  | 'gemini-image'
  | 'imagen'
  | 'flux'
  | 'seedream'
  | 'gpt-image'
  | 'ideogram'
  | 'krea'
  | 'wan-image'
  | 'generic-image'
  | 'veo'
  | 'kling'
  | 'seedance'
  | 'wan-video'
  | 'ltx'
  | 'hailuo'
  | 'generic-video';

export type PromptSlot =
  | 'text'        // in-image typography ("the sign reads 'OPEN'")
  | 'subject'     // who/what + action (default)
  | 'camera'      // shot size, movement, lens
  | 'lighting'
  | 'style'
  | 'aspect'      // aspect-ratio / framing hints
  | 'audio'       // dialogue, sound, music
  | 'reference'   // "use the input image as…"
  | 'continuity'  // "must keep consistent…", "continuity anchors…"
  | 'negative';   // "no …", "avoid …"

export type AdaptContext = {
  kind: PromptKind;
  aspectRatio?: string;
  hasReferences?: boolean;
  durationSeconds?: number;
  /** Extra negatives collected by the caller (e.g. a dedicated negative-prompt field). */
  negatives?: string[];
};

const CINEMASCOPE = /2\.39|2\.35|235:100|239:100|21:9|cinemascope|anamorphic/i;

export const resolvePromptFamily = (modelId: string | null | undefined, kind: PromptKind): PromptFamily => {
  const id = String(modelId || '').toLowerCase();
  if (kind === 'video') {
    if (id.startsWith('veo')) return 'veo';
    if (id.includes('kling')) return 'kling';
    if (id.includes('seedance')) return 'seedance';
    if (id.includes('wan')) return 'wan-video';
    if (id.includes('ltx')) return 'ltx';
    if (id.includes('hailuo') || id.includes('minimax')) return 'hailuo';
    return 'generic-video';
  }
  if (id === 'midjourney') return 'midjourney';
  if (id === 'nano' || id === 'nano-banana-2-fal' || id.startsWith('gemini') || id.includes('nano-banana')) return 'gemini-image';
  if (id === 'imagen') return 'imagen';
  if (id.startsWith('flux')) return 'flux';
  if (id.includes('seedream')) return 'seedream';
  if (id.includes('gpt-image')) return 'gpt-image';
  if (id.includes('ideogram')) return 'ideogram';
  if (id.includes('krea')) return 'krea';
  if (id.includes('wan')) return 'wan-image';
  return 'generic-image';
};

// ---------------------------------------------------------------------------
// Sentence classification

const RX = {
  text: /(\btext\b|\bsign\b|\bcaption\b|\bheadline\b|\blogo\b|\btitle card\b|\btypography\b|\bletters?\b|\breads\s*["“']|\bsays\s*["“'](?!.*\bsays:)|"[^"]{1,60}"\s*(?:in|as)\s+\w+\s+(?:font|type|letters))/i,
  audio: /\b(audio|sound|sfx|dialogue|dialog|voice-?over|voice|music|score|ambien[ct]e?|whisper|shout|says:|speaks|line of dialogue|no subtitles)\b/i,
  aspect: /\b(aspect ratio|aspect-ratio|widescreen|vertical (?:cinema|frame|format)|portrait (?:format|orientation)|landscape (?:format|orientation)|9:16|16:9|4:3|3:4|1:1|2\.39:1|2\.35:1|21:9|cinemascope|letterbox|render container|safe zone|headroom|x-axis)\b/i,
  negative: /^\s*(no|without|avoid|never|do not|don't|exclude|free of)\b|\bwithout any\b|\bno (?:text|watermark|logo|people|blur)\b/i,
  reference: /\b(use (?:the )?(?:first |remaining |provided |input |reference |attached )?(?:image|images|photo|frame|map|sketch)s?\b|input images?\b|reference images?\b|as (?:a )?(?:strict )?(?:composition|style|character|identity|pose) reference|openpose|pose map|end frame reference|start frame)/i,
  continuity: /\b(continuity|must keep consistent|keep consistent|consistent with|same (?:face|outfit|wardrobe|character)|preserve (?:character|identity|wardrobe)|anchors?:|matching the previous|previous shot)\b/i,
  camera: /\b(camera|shot|close-?up|wide|medium|establishing|over-the-shoulder|ots|pov|dolly|push[- ]in|pull[- ]out|pan(?:s|ning)?|tilt|track(?:ing|s)?|crane|handheld|steadicam|gimbal|zoom|orbit|rack focus|depth of field|bokeh|\d{2,3}\s?mm|f\/\d|lens|anamorphic|low angle|high angle|dutch|bird'?s[- ]eye|top[- ]down|eye level|framing|frame|composition|rule of thirds|centered)\b/i,
  lighting: /\b(light(?:ing|s|ed)?|lit\b|golden hour|blue hour|magic hour|backlit|rim light|key light|fill light|practical|neon|shadows?|glow(?:ing)?|sunlight|moonlight|overcast|harsh|soft light|chiaroscuro|volumetric|haze|god rays|high[- ]key|low[- ]key|silhouette)\b/i,
  style: /\b(style|cinematic|film(?:ic| stock| grain)?|grain|photoreal(?:istic)?|realistic|illustration|anime|watercolor|oil painting|render(?:ed)?|3d|octane|unreal|kodak|fuji|portra|35mm film|analog|documentary|editorial|noir|look|aesthetic|palette|color grade|graded|mood|atmosphere|vibe|tone)\b/i,
};

export const classifyChunk = (chunk: string): PromptSlot => {
  const text = chunk.trim();
  if (!text) return 'subject';
  if (RX.negative.test(text)) return 'negative';
  if (RX.reference.test(text)) return 'reference';
  if (RX.continuity.test(text)) return 'continuity';
  if (/\bsays:\s*["“]/.test(text)) return 'audio';
  if (RX.text.test(text) && /["“']/.test(text)) return 'text';
  if (RX.audio.test(text)) return 'audio';
  if (RX.aspect.test(text)) return 'aspect';
  // Camera beats lighting beats style when a sentence mixes them; subject sentences rarely contain these terms alone.
  const words = text.split(/\s+/).length;
  if (RX.camera.test(text) && words <= 28) return 'camera';
  if (RX.lighting.test(text) && words <= 22) return 'lighting';
  if (RX.style.test(text) && words <= 22) return 'style';
  return 'subject';
};

/** Split on newlines and sentence boundaries, keeping quoted dialogue intact. */
export const splitPrompt = (prompt: string): string[] => {
  const out: string[] = [];
  for (const line of String(prompt || '').split(/\n+/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Protect decimals (2.39) and quoted spans from the sentence splitter.
    const DOT = '\u00B7DOT\u00B7';
    const protectedLine = trimmed
      .replace(/(\d)\.(\d)/g, (_m, l, r) => `${l}${DOT}${r}`)
      .replace(/"[^"]*"|“[^”]*”/g, (m) => m.split('.').join(DOT));
    // A sentence may also end with a quote whose final period was protected (…Now." Then…).
    for (const piece of protectedLine.split(new RegExp(`(?<=[.!?]["”]?|${DOT}["”])\\s+(?=\\S)`))) {
      const restored = piece.split(DOT).join('.').trim();
      if (restored) out.push(restored);
    }
  }
  return out;
};

type Bucketed = Record<PromptSlot, string[]>;

const bucket = (prompt: string): Bucketed => {
  const buckets: Bucketed = { text: [], subject: [], camera: [], lighting: [], style: [], aspect: [], audio: [], reference: [], continuity: [], negative: [] };
  for (const chunk of splitPrompt(prompt)) buckets[classifyChunk(chunk)].push(chunk);
  return buckets;
};

const stripTerminal = (s: string) => s.replace(/[.\s]+$/, '');
const sentence = (s: string) => {
  const t = stripTerminal(s.trim());
  if (!t) return '';
  return /[.!?"”\]]$/.test(t) ? t : `${t}.`;
};
const joinSentences = (parts: string[]) => parts.map(sentence).filter(Boolean).join(' ');

/** "no text, no watermark" / "Avoid crowds" → ["text", "watermark", "crowds"] */
const negativeTerms = (chunks: string[]): string[] => {
  const terms: string[] = [];
  for (const chunk of chunks) {
    const cleaned = stripTerminal(chunk)
      .replace(/^\s*(?:please\s+)?(?:do not|don't|never|avoid|exclude|without(?: any)?|free of|no)\s+/i, '')
      .replace(/\b(?:no|without|avoid)\s+/gi, '');
    for (const term of cleaned.split(/\s*(?:,|;|\band\b|\bor\b)\s*/i)) {
      const t = term.trim().replace(/^(?:any|the|a|an)\s+/i, '');
      if (t && t.length < 60) terms.push(t);
    }
  }
  return Array.from(new Set(terms));
};

// ---------------------------------------------------------------------------
// Recipes

type Recipe = {
  order: PromptSlot[];
  /** How the pieces are glued: prose sentences, comma phrases, or one line each. */
  join: 'sentences' | 'phrases' | 'lines';
  /** Aspect text is dropped when the API sets the ratio; cinemascope framing hints stay because the app crops afterwards. */
  keepAspectText: 'never' | 'cinemascope' | 'always';
  negatives: 'param' | 'avoid-sentence' | 'drop';
  leadIn?: (b: Bucketed, ctx: AdaptContext) => string | null;
  finish?: (body: string, b: Bucketed, ctx: AdaptContext) => string;
};

const IMAGE_DEFAULT_ORDER: PromptSlot[] = ['subject', 'camera', 'lighting', 'style', 'text', 'reference', 'continuity', 'aspect'];

const RECIPES: Record<PromptFamily, Recipe> = {
  // Terse scene phrases, then the parameter strip. --ar / --v / --style come from the agent; we add --no.
  midjourney: {
    order: ['subject', 'lighting', 'camera', 'style', 'text', 'continuity'],
    join: 'phrases',
    keepAspectText: 'never',
    negatives: 'param',
  },
  // Gemini reads prose; keywords and parameters hurt. Aspect ratio is an API field.
  'gemini-image': { order: ['subject', 'lighting', 'camera', 'style', 'text', 'reference', 'continuity', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  imagen: {
    order: IMAGE_DEFAULT_ORDER,
    join: 'sentences',
    keepAspectText: 'cinemascope',
    negatives: 'drop',
    leadIn: (b) => {
      const first = b.subject[0] || '';
      const photoreal = b.style.some((s) => /photo|realistic|cinematic|film/i.test(s)) || b.style.length === 0;
      return photoreal && !/^(a|an|the)\s+(photo|photograph|cinematic|film still|portrait)/i.test(first) ? 'A photo of' : null;
    },
  },
  // Subject + action + style + context, plain prose, no negatives at all.
  flux: { order: ['subject', 'style', 'lighting', 'camera', 'text', 'reference', 'continuity', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'drop' },
  // Each clause is a directive: format, subject, composition, lighting, in-image text, style.
  seedream: { order: ['camera', 'subject', 'lighting', 'text', 'style', 'reference', 'continuity', 'aspect'], join: 'lines', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  // Brief the photographer: scene → subject → key details → constraints.
  'gpt-image': { order: ['subject', 'camera', 'lighting', 'style', 'text', 'reference', 'continuity', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  // Quoted text first, then style.
  ideogram: { order: ['text', 'subject', 'style', 'lighting', 'camera', 'reference', 'continuity', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  krea: { order: ['subject', 'camera', 'lighting', 'style', 'text', 'reference', 'continuity', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'drop' },
  'wan-image': { order: IMAGE_DEFAULT_ORDER, join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  'generic-image': { order: IMAGE_DEFAULT_ORDER, join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },

  // Cinematography → subject/action → environment → lighting/style → audio. 3–6 sentences. Dialogue as `Name says: "…"`.
  veo: {
    order: ['camera', 'subject', 'lighting', 'style', 'reference', 'continuity', 'audio', 'aspect'],
    join: 'sentences',
    keepAspectText: 'cinemascope',
    negatives: 'avoid-sentence',
    finish: (body, b) => (b.audio.length === 0 ? `${body} Audio: natural ambient sound matching the scene, no music unless stated, no subtitles.` : body),
  },
  // Short. Action first, camera in its own clear sentences, negatives are a separate API field.
  kling: { order: ['subject', 'camera', 'lighting', 'style', 'reference', 'continuity', 'audio', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'drop' },
  // Numbered shots, no hard timings; camera move → subject action → position → sound.
  seedance: {
    order: ['camera', 'subject', 'lighting', 'style', 'reference', 'continuity', 'aspect'],
    join: 'sentences',
    keepAspectText: 'cinemascope',
    negatives: 'avoid-sentence',
    finish: (body, b, ctx) => {
      if (/\bshot\s*1\b/i.test(body)) return body;
      const sound = b.audio.length ? ` Sound: ${joinSentences(b.audio)}` : '';
      const seconds = ctx.durationSeconds ? `, ${ctx.durationSeconds}s` : '';
      return `1 shot${seconds}. Shot 1: ${body}${sound}`;
    },
  },
  // Subject + action + environment + camera + motion quality + style; multi-shot = summary then numbered shots.
  'wan-video': { order: ['subject', 'camera', 'style', 'lighting', 'reference', 'continuity', 'audio', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  // Subject → action → camera → lighting → lens → constraints → negatives; long and explicit is good.
  ltx: { order: ['subject', 'camera', 'lighting', 'style', 'reference', 'continuity', 'audio', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
  // [Camera command] + subject + motion + environment + style + lighting + mood.
  hailuo: {
    order: ['subject', 'lighting', 'style', 'reference', 'continuity', 'audio', 'aspect'],
    join: 'sentences',
    keepAspectText: 'cinemascope',
    negatives: 'avoid-sentence',
    leadIn: (b) => {
      const moves: string[] = [];
      const text = b.camera.join(' ').toLowerCase();
      const map: Array<[RegExp, string]> = [
        [/push(?:es|ing)?[- ]?in|dolly in|move(?:s)? (?:in|closer|toward)/, 'Push in'], [/pull(?:s|ing)?[- ]?out|dolly out|move(?:s)? (?:back|away)/, 'Pull out'],
        [/pan(?:s|ning)? left/, 'Pan left'], [/pan(?:s|ning)? right/, 'Pan right'], [/truck left/, 'Truck left'], [/truck right/, 'Truck right'],
        [/tilt(?:s|ing)? up/, 'Tilt up'], [/tilt(?:s|ing)? down/, 'Tilt down'], [/pedestal up|crane up|rise/, 'Pedestal up'], [/pedestal down|crane down|descend/, 'Pedestal down'],
        [/zoom(?:s|ing)? in/, 'Zoom in'], [/zoom(?:s|ing)? out/, 'Zoom out'], [/track(?:ing|s)?|follow(?:s|ing)?/, 'Tracking shot'], [/handheld|shak/, 'Shake'], [/static|locked[- ]off|fixed/, 'Static shot'],
      ];
      for (const [rx, cmd] of map) if (rx.test(text) && !moves.includes(cmd)) moves.push(cmd);
      return moves.length ? `[${moves.slice(0, 3).join(', ')}]` : null;
    },
    finish: (body, b) => (b.camera.length ? `${body} ${joinSentences(b.camera.map((c) => c.replace(/^camera\b/i, 'The camera')))}` : body),
  },
  'generic-video': { order: ['subject', 'camera', 'lighting', 'style', 'reference', 'continuity', 'audio', 'aspect'], join: 'sentences', keepAspectText: 'cinemascope', negatives: 'avoid-sentence' },
};

// ---------------------------------------------------------------------------
// Public API

export const adaptPromptForModel = (modelId: string | null | undefined, prompt: string, ctx: AdaptContext): string => {
  const raw = String(prompt || '').trim();
  if (!raw) return raw;
  const family = resolvePromptFamily(modelId, ctx.kind);
  const recipe = RECIPES[family];
  const b = bucket(raw);

  // Aspect text: only when the app crops afterwards (cinemascope) or the recipe always wants it.
  const wantsAspect = recipe.keepAspectText === 'always' || (recipe.keepAspectText === 'cinemascope' && CINEMASCOPE.test(String(ctx.aspectRatio || '')));
  if (!wantsAspect) b.aspect = [];

  const negatives = [...negativeTerms(b.negative), ...(ctx.negatives || []).map((n) => n.trim()).filter(Boolean)];
  b.negative = [];

  // Hailuo folds camera into the bracket lead-in + a trailing sentence, so it is not part of the ordered body.
  const orderedSlots = recipe.order.filter((slot) => !(family === 'hailuo' && slot === 'camera'));
  const pieces: string[] = [];
  for (const slot of orderedSlots) pieces.push(...b[slot]);

  let body: string;
  if (recipe.join === 'phrases') {
    body = pieces.map((p) => stripTerminal(p).replace(/^(?:a|an|the)\s+/i, (m) => m)).filter(Boolean).join(', ');
  } else if (recipe.join === 'lines') {
    body = pieces.map(sentence).filter(Boolean).join('\n');
  } else {
    body = joinSentences(pieces);
  }

  const lead = recipe.leadIn ? recipe.leadIn(b, ctx) : null;
  if (lead) body = family === 'imagen' ? `${lead} ${body.charAt(0).toLowerCase()}${body.slice(1)}` : `${lead} ${body}`;
  if (recipe.finish) body = recipe.finish(body, b, ctx);

  if (negatives.length) {
    if (recipe.negatives === 'param') body = `${body} --no ${negatives.join(', ')}`;
    else if (recipe.negatives === 'avoid-sentence') body = `${body}${recipe.join === 'lines' ? '\n' : ' '}Avoid: ${negatives.join(', ')}.`;
  }
  return body.replace(/[ \t]+/g, ' ').replace(/ \n/g, '\n').trim();
};

/** One-paragraph instruction for LLM prompt writers so drafts already match the model's voice. */
export const promptStyleGuide = (modelId: string | null | undefined, kind: PromptKind): string => {
  const family = resolvePromptFamily(modelId, kind);
  switch (family) {
    case 'midjourney':
      return 'Target model: Midjourney. Write terse scene phrases separated by commas in this order: subject and action, environment, lighting, medium/style. No full sentences, no "a photo of", no parameters (--ar, --v, --style are added automatically), no aspect-ratio wording, no negatives in the text.';
    case 'gemini-image':
      return 'Target model: Gemini image (Nano Banana). Write one flowing narrative paragraph in full sentences, as if describing a finished photograph to a person. Lead with the main subject, then setting, then light and style. No keyword lists, no commas-as-glue, no parameters and no aspect-ratio wording — the ratio is set separately.';
    case 'imagen':
      return 'Target model: Imagen 4. Start with "A photo of …" for photoreal results. Use concrete photography language: shot size, lens and aperture, light source and time of day, texture. Full sentences, no parameters, no aspect-ratio wording.';
    case 'flux':
      return 'Target model: FLUX. Plain prose, 30–80 words: main subject and action first, then critical style, then essential context. Never write negatives — say what should be there. No parameters, no aspect-ratio wording. Quote any in-image text and give colours as names or #RRGGBB.';
    case 'seedream':
      return 'Target model: Seedream. Write short directive clauses, one per line, in this order: format/shot, subject, composition, lighting, in-image text (quoted), style. Concrete physical and compositional facts; skip "beautiful" and "high quality". No parameters, no aspect-ratio wording.';
    case 'gpt-image':
      return 'Target model: GPT Image. Brief a photographer: scene → subject → key details → purpose → constraints. Describe lens, framing, time of day, light source, texture and believable imperfection. For edits write "Change: … Preserve: … Constraints: …". No parameters, no aspect-ratio wording.';
    case 'ideogram':
      return 'Target model: Ideogram. Put the exact in-image text first, in quotation marks, with font feel and placement; then subject, style and lighting. No parameters, no aspect-ratio wording.';
    case 'krea':
      return 'Target model: Krea 2. Natural language; name composition, light direction, colour palette and material texture. Medium length is fine. No parameters, no aspect-ratio wording.';
    case 'veo':
      return 'Target model: Veo 3.1. 3–6 sentences (100–150 words) in this order: cinematography (shot size, camera move, lens), subject with distinct traits, one clear action, environment, lighting/style, then audio. Dialogue as: Name says: "exact line" (no subtitles). Keep lines short — the clip is ~8 seconds. No parameters.';
    case 'kling':
      return 'Target model: Kling. 50–100 words. Subject and action first, then the camera in its own clear sentence ("Camera tracks beside the runner at low angle"). Describe visible motion: posture, speed, direction, contact with the ground. Negatives go in a separate field, not the prompt. No parameters.';
    case 'seedance':
      return 'Target model: Seedance. State the shot count and total length up front, then numbered shots ("Shot 1: …"). Per shot: camera move, subject action, position in frame, sound. Do not force second-precise timings. No parameters.';
    case 'wan-video':
      return 'Target model: Wan. Lead with the shot: subject and camera first, then wardrobe, light and set dressing. Order: subject + action + environment + camera + motion quality + style. Multi-shot: one-line summary, then numbered shots with time ranges. No parameters.';
    case 'ltx':
      return 'Target model: LTX-2. 4–8 sentences: subject → action → camera (explicit verbs: pushes in, tracks, tilts) → lighting → lens → constraints → negatives last as "Avoid: …". Dialogue in short phrases with [performance cues] between lines; direct acting with physical cues, not emotion labels. No parameters.';
    case 'hailuo':
      return 'Target model: Hailuo/MiniMax. Start with camera commands in square brackets, up to three, e.g. [Push in, Tilt up]; then subject, subject motion, environment, style, lighting, mood. No parameters.';
    case 'wan-image':
    case 'generic-image':
      return 'Write clear prose: subject and action, then setting, camera/framing, light, style. No parameters, no aspect-ratio wording.';
    case 'generic-video':
    default:
      return 'Write clear prose: subject and action, then environment, camera movement in its own sentence, light, style, then any sound. No parameters.';
  }
};
