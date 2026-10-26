/**
 * Burst Frame workflow (Phil Langer): one start frame becomes a 5-second
 * sequence of 20 static compositions separated by hard cuts. The subject and
 * set stay identical; only camera placement and framing change.
 *
 * This module builds and checks the generation prompt. It is model-agnostic:
 * the prompt works with every video model that takes a start frame or
 * reference images (Seedance, Kling, Wan, FLUX.3 Video, Veo, Grok, …).
 */

export const BURST_FRAME_SETTINGS = {
  durationSeconds: 5,
  shotCount: 20,
  secondsPerShot: 0.25,
  audio: false,
} as const;

export type BurstSubjectKind = 'person' | 'object' | 'animal' | 'landscape' | 'architecture';
export type BurstLighting = 'continuous' | 'time-of-day';

export type BurstFrameInput = {
  /** CONTINUITY LOCK body: subject, pose, wardrobe, props, environment layout. */
  continuity: string;
  /** VISUAL STYLE LOCK body: light, shadows, textures, depth of field, lens. */
  style: string;
  /** 20 shot descriptions without numbering; defaults to the library adapted to `subjectKind`. */
  shots?: string[];
  subjectKind?: BurstSubjectKind;
  lighting?: BurstLighting;
  /** Shorter wording for models with tight prompt limits. */
  compact?: boolean;
};

const LOCKED = 'still, locked frame';

/** Default 20-shot library from the Burst Frame specification. */
export const BURST_SHOT_LIBRARY: Record<'person' | 'object' | 'place', string[]> = {
  person: [
    'Wide establishing view matching the start frame, subject centered in the environment',
    'Camera three-quarter left at eye level, natural spatial depth',
    'Camera three-quarter right at eye level, mirrored coverage with coherent room geometry',
    "Tight close-up of the subject's face, soft ambient light",
    'Extreme close-up of the eyes, reflected environment preserved',
    'Insert close-up of the hands at rest',
    'Low floor-level angle looking slightly upward, foreground plane and subject silhouette emphasized',
    'High angle looking down, subject clearly framed within the same space',
    'Rear three-quarter view toward the environment, recognizable identity and layout preserved',
    'Clean side-profile view shaped by the existing key light',
    'Macro insert of the wardrobe fabric texture from the source',
    'Medium three-quarter view with a longer focal length and compressed background depth, source pose unchanged',
    'Medium three-quarter view with a moderately wider focal length and more environmental context, source pose unchanged',
    'Close-up of the feet or lower body in contact with the floor or seat',
    'Close-up of one resting hand against a nearby surface',
    'Deep-focus reversal: environment sharp, subject softly out of focus in the near foreground',
    'View framed through an existing foreground object, subject unobstructed enough to recognize',
    "Medium frontal hero view using the source image's established light and palette",
    'Medium frontal view with a slightly wider focal length and stronger environmental context',
    'Tight frontal portrait matching the source light, ending on a clear readable frame',
  ],
  object: [
    'Wide establishing view matching the start frame, object centered in the environment',
    'Camera three-quarter left at eye level, natural spatial depth',
    'Camera three-quarter right at eye level, mirrored coverage with coherent geometry',
    'Tight close-up of the front face or primary defining feature',
    'Extreme close-up of the most distinctive fine detail',
    'Insert close-up of the main control, connection, or interaction detail',
    'Low floor-level angle looking slightly upward, foreground plane and silhouette emphasized',
    'High angle looking down, object clearly framed within the same space',
    'Rear three-quarter view without inventing hidden elements, layout preserved',
    'Clean side-profile view shaped by the existing key light',
    'Macro insert of the signature material or surface texture',
    'Medium view with a longer focal length and compressed background depth',
    'Medium view with a moderately wider focal length and more environmental context',
    'Close-up of the base where it meets the supporting surface',
    'Close-up of an edge detail or contact point against a nearby surface',
    'Deep-focus reversal: environment sharp, object softly out of focus in the near foreground',
    'View framed through an existing foreground object, object unobstructed enough to recognize',
    "Medium frontal hero view using the source image's established light and palette",
    'Medium frontal view with a slightly wider focal length and stronger environmental context',
    'Tight frontal defining-detail hero view matching the source light, ending on a clear readable frame',
  ],
  place: [
    'Wide establishing view matching the start frame',
    'Camera three-quarter left at the same height, natural spatial depth',
    'Camera three-quarter right at the same height, mirrored coverage with coherent geometry',
    'Tight view of the most prominent structural or architectural feature',
    'Extreme close-up of a distinctive fine detail visible in the source',
    'Insert of a surface or material detail in the foreground',
    'Low ground-level angle looking slightly upward, foreground plane emphasized',
    'High angle looking down over the same space',
    'Reverse three-quarter view along the established depth axis without inventing unseen areas',
    'Side view along a facade, wall, or edge shaped by the existing key light',
    'Macro insert of a material texture from the source',
    'Telephoto view with compressed depth toward the background',
    'Moderately wider view with more context at the frame edges',
    'Close-up of the ground surface and where structures meet it',
    'Close-up of an edge, joint, or contact point between two materials',
    'Deep-focus reversal: background sharp, a near foreground element softly out of focus',
    'View framed through an existing foreground element',
    "Frontal hero view using the source image's established light and palette",
    'Frontal view with a slightly wider focal length and stronger context',
    'Tight frontal defining-detail view matching the source light, ending on a clear readable frame',
  ],
};

const TIME_OF_DAY_ENDING = [
  'Medium frontal view, coherent nighttime lighting',
  'Medium frontal view, coherent warm sunset light entering from the established source direction',
  'Medium frontal view, illuminated only by plausible light from an existing practical or screen in the scene',
];

const libraryFor = (kind: BurstSubjectKind | undefined) =>
  kind === 'object' ? BURST_SHOT_LIBRARY.object : kind === 'landscape' || kind === 'architecture' ? BURST_SHOT_LIBRARY.place : BURST_SHOT_LIBRARY.person;

const stripLock = (line: string) =>
  line
    .replace(/^\s*\[?\d{1,2}\]?[.)]?\s*/, '')
    .replace(/,?\s*still,\s*locked frame\.?\s*$/i, '')
    .trim()
    .replace(/[.,;]+$/, '');

export function burstShots(input: Pick<BurstFrameInput, 'shots' | 'subjectKind' | 'lighting'>): string[] {
  const base = (input.shots && input.shots.filter((s) => s.trim()).length >= BURST_FRAME_SETTINGS.shotCount
    ? input.shots.filter((s) => s.trim()).slice(0, BURST_FRAME_SETTINGS.shotCount)
    : libraryFor(input.subjectKind)
  ).map(stripLock);
  if (input.lighting === 'time-of-day') base.splice(17, 3, ...TIME_OF_DAY_ENDING);
  return base;
}

export function buildBurstFramePrompt(input: BurstFrameInput): string {
  const shots = burstShots(input);
  const num = (i: number) => String(i + 1).padStart(2, '0');
  const lightingRule =
    input.lighting === 'time-of-day'
      ? 'only camera angle, focal distance, focus plane, and the lighting changes in shots 18–20 may change'
      : 'only camera angle, focal distance, and focus plane may change; one continuous light state throughout';
  const continuity = input.continuity.trim() || 'the subject, pose, wardrobe, props, and environment layout of the start frame';
  const style = input.style.trim() || 'Naturalistic light and texture exactly as in the start frame, photorealistic.';

  if (input.compact) {
    return [
      'Create a 5-second BURST FRAME sequence from the start frame.',
      `CONTINUITY LOCK: keep exactly ${continuity}. Same subject, set, light direction, palette, texture, and aspect ratio; add, remove, or move nothing.`,
      `STYLE: ${style}`,
      'RULES: 20 distinct static shots in 5 seconds, approximately 0.25 seconds each; instantaneous hard cuts; no transition frames. No continuous camera move, orbit, zoom, pan, tilt, or dolly. No subject motion, lip movement, blinking, pose interpolation, or cloth motion. No morphing, cross-dissolves, double exposure, or blended viewpoints.',
      'SHOTS:',
      ...shots.map((shot, i) => `[${num(i)}] ${shot}, ${LOCKED}.`),
      `Same subject, same set, same moment; ${lightingRule}.`,
    ].join('\n');
  }

  return [
    'Create a 5-second cinematic BURST FRAME sequence from the supplied start frame.',
    '',
    'CONTINUITY LOCK',
    `Preserve exactly the same ${continuity}. Preserve the exact spatial relationships, materials, light direction, color palette, texture detail, and aspect ratio of the source image. This is one unchanged subject in one coherent location, photographed from different camera positions. Do not add, remove, redesign, or relocate anything.`,
    '',
    'VISUAL STYLE LOCK',
    style,
    '',
    'EDITING AND MOTION RULES',
    '20 distinct static shots in 5 seconds, approximately 0.25 seconds each. Instantaneous hard cuts; no transition frames. Each numbered item is a separate locked camera setup, not a waypoint in a camera move. No continuous camera move, orbit, zoom, pan, tilt, or dolly. No subject motion, lip movement, blinking, pose interpolation, cloth motion, or environmental motion. No morphing, cross-dissolves, double exposure, blended viewpoints, duplicated anatomy, or identity drift.',
    '',
    'SHOT SEQUENCE',
    ...shots.map((shot, i) => `[${num(i)}] ${shot}, ${LOCKED}.`),
    '',
    'FINAL DIRECTIVE',
    `Render exactly 20 readable, sharply separated viewpoints. Same subject, same set, same moment; ${lightingRule}. Every shot is still, locked frame.`,
  ].join('\n');
}

export type BurstCheck = { ok: boolean; problems: string[] };

/** Quality check from the specification (works on edited prompts too). */
export function checkBurstFramePrompt(prompt: string): BurstCheck {
  const problems: string[] = [];
  const shotLines = prompt.split('\n').filter((line) => /^\s*\[\d{2}\]/.test(line));
  const numbers = shotLines.map((line) => Number(line.trim().slice(1, 3)));
  if (shotLines.length !== 20 || numbers.some((n, i) => n !== i + 1)) problems.push(`Es müssen genau 20 nummerierte Shots [01]–[20] sein (gefunden: ${shotLines.length}).`);
  const missingLock = shotLines.filter((line) => !/still, locked frame/i.test(line)).length;
  if (missingLock) problems.push(`${missingLock} Shot-Zeile(n) ohne „still, locked frame“.`);
  const required: Array<[RegExp, string]> = [
    [/20 distinct static shots in 5 seconds, approximately 0\.25 seconds each/i, '20 distinct static shots … 0.25 seconds each'],
    [/instantaneous hard cuts; no transition frames/i, 'instantaneous hard cuts; no transition frames'],
    [/no continuous camera move, orbit, zoom, pan, tilt, or dolly/i, 'no continuous camera move …'],
    [/no subject motion, lip movement, blinking, pose interpolation,? (or )?cloth motion/i, 'no subject motion … cloth motion'],
    [/no morphing, cross-dissolves, double exposure,? (or )?blended viewpoints/i, 'no morphing … blended viewpoints'],
    [/continuity lock/i, 'CONTINUITY LOCK'],
  ];
  for (const [pattern, label] of required) if (!pattern.test(prompt)) problems.push(`Pflichtregel fehlt: ${label}`);
  const actionWords = shotLines.filter((line) => /\b(turns?|walks?|moves?|raises?|smiles?|speaks?|looks? up|nods?)\b/i.test(line));
  if (actionWords.length) problems.push(`${actionWords.length} Shot(s) beschreiben eine Handlung über Zeit.`);
  return { ok: problems.length === 0, problems };
}

/** Instruction for a vision model that fills the continuity and style blocks from the start frame. */
export const BURST_ANALYSIS_INSTRUCTION = `You prepare a "Burst Frame" video prompt: 20 static camera setups of the SAME frozen moment, cut hard every 0.25 s. Look at the attached start frame and describe only what is visible or safely inferable. Do not invent story actions.
Return strict JSON, no markdown:
{
  "subjectKind": "person" | "object" | "animal" | "landscape" | "architecture",
  "continuity": "one dense sentence fragment that completes 'Preserve exactly the same …': subject identity or object geometry, pose and expression, hair, wardrobe and accessories, visible anatomy, important props and their relative positions, environment geometry and materials",
  "style": "2-3 naturalistic sentences: lighting direction and quality, shadows, time of day, palette, textures, depth of field, lens character, photorealism or the source medium",
  "aspectRatio": "16:9" | "9:16" | "1:1" | "4:3" | "3:4" | "21:9",
  "shots": ["20 camera setups adapted to this subject and environment, each one atomic, each changes one main camera or framing variable, left/right from the camera's viewpoint, close-ups only on visible features, no subject action, no numbering"]
}`;

export type BurstAnalysis = {
  subjectKind?: BurstSubjectKind;
  continuity: string;
  style: string;
  aspectRatio?: string;
  shots?: string[];
};

export function parseBurstAnalysis(text: string): BurstAnalysis | null {
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[0]) as Record<string, unknown>;
    const kinds: BurstSubjectKind[] = ['person', 'object', 'animal', 'landscape', 'architecture'];
    const shots = Array.isArray(data.shots) ? data.shots.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : undefined;
    return {
      subjectKind: kinds.includes(data.subjectKind as BurstSubjectKind) ? (data.subjectKind as BurstSubjectKind) : undefined,
      continuity: typeof data.continuity === 'string' ? data.continuity.trim() : '',
      style: typeof data.style === 'string' ? data.style.trim() : '',
      aspectRatio: typeof data.aspectRatio === 'string' ? data.aspectRatio : undefined,
      shots: shots && shots.length >= 20 ? shots.slice(0, 20) : undefined,
    };
  } catch {
    return null;
  }
}

/** Nearest common aspect ratio for an image size. */
export function nearestAspectRatio(width: number, height: number, options: string[] = ['21:9', '16:9', '4:3', '1:1', '3:4', '9:16']): string {
  if (!width || !height) return '16:9';
  const target = width / height;
  let best = options[0];
  let bestError = Infinity;
  for (const option of options) {
    const [w, h] = option.split(':').map(Number);
    const error = Math.abs(Math.log(target / (w / h)));
    if (error < bestError) {
      bestError = error;
      best = option;
    }
  }
  return best;
}
