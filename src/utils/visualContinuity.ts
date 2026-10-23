/**
 * Visual continuity review: a vision model looks at the rendered frame next to the frames
 * before and after it on screen and the cast/outfit/location references, and checks what an
 * editor or script supervisor checks. Pure prompt building and result mapping (no network).
 */
import type { ShotContinuityIssue, ShotContinuityReview } from '../types';

export const CONTINUITY_CATEGORIES = [
  'identity', 'wardrobe', 'props', 'location', 'lighting', 'screen_direction', 'eyeline', 'staging', 'text', 'framing',
] as const;
export type ContinuityCategory = typeof CONTINUITY_CATEGORIES[number];

export type ContinuityImageRole = 'current' | 'previous' | 'next' | 'character' | 'outfit' | 'location' | 'prop';

export type VisualContinuityInput = {
  shot: {
    label: string;
    description: string;
    prompt: string;
    shotType?: string;
    cameraAngle?: string;
    cameraYaw?: number;
    characters: string[];
    environment?: string | null;
    props?: string[];
    wardrobe?: string[];
  };
  previous?: { label: string; description: string; sameScene: boolean; shotType?: string; characters?: string[] } | null;
  next?: { label: string; description: string; sameScene: boolean } | null;
  sceneText?: string;
  aspectRatio?: string;
  /** Attached images in order; the model sees "Image 1 (current frame)", "Image 2 (…)". */
  images: Array<{ role: ContinuityImageRole; label: string }>;
};

export type VisualContinuityVerdict = {
  score: number;
  status: 'aligned' | 'watch' | 'drift';
  summary: string;
  issues: Array<{ category: string; severity: 'low' | 'medium' | 'high'; message: string }>;
  promptFix: string;
  needsReverseAngle: boolean;
  reverseYaw: number | null;
  reverseReason: string;
};

export const buildVisualContinuityPrompt = (input: VisualContinuityInput) => {
  const { shot, previous, next } = input;
  const imageList = input.images.map((image, index) => `Image ${index + 1}: ${image.label}`).join('\n');
  return `You are the script supervisor and editor of a film. Judge ONE storyboard frame for continuity — by looking at the images, not by trusting the prompt.

Images:
${imageList}

Shot ${shot.label}: ${shot.description}
Intended framing: ${[shot.shotType, shot.cameraAngle].filter(Boolean).join(', ') || 'not specified'}${typeof shot.cameraYaw === 'number' ? ` · camera yaw ${shot.cameraYaw}°` : ''}
In frame: ${shot.characters.join(', ') || 'no characters'}${shot.environment ? ` · location: ${shot.environment}` : ''}${shot.props?.length ? ` · props: ${shot.props.join(', ')}` : ''}
Wardrobe: ${shot.wardrobe?.length ? shot.wardrobe.join('; ') : 'see references'}
${previous ? `Previous shot on screen (${previous.sameScene ? 'same scene' : 'previous scene'}) ${previous.label}: ${previous.description}${previous.shotType ? ` [${previous.shotType}]` : ''}` : 'This is the first shot of the sequence.'}
${next ? `Next shot on screen (${next.sameScene ? 'same scene' : 'next scene'}) ${next.label}: ${next.description}` : ''}
${input.sceneText ? `\nScene (script excerpt):\n${input.sceneText.slice(0, 2400)}\n` : ''}
Check, in this order:
1. identity — every character matches their reference face, hair, age and build.
2. wardrobe — clothes, COLOURS and accessories match the outfit reference for this shot; same as the previous shot of the same scene unless the script changes them.
3. props — the right props, in the right hands, consistent with the previous shot (a glass spilled stays spilled).
4. location — same space and layout as the location reference and the previous shot of the scene.
5. lighting — same time of day, light direction and colour as the previous shot of the scene.
6. screen_direction — the 180° rule: characters keep their left/right sides across the cut; in a shot/reverse-shot pair the two characters look in OPPOSITE screen directions. If the previous shot of the same scene shows A on the left looking right, a reverse on A shows B looking left.
7. eyeline — characters look at who/what they should (up/down, left/right) given positions and heights.
8. staging — the action and blocking the script and description ask for (who stands where, who holds what, who is kneeling).
9. text — any readable text (badges, signs, documents) says exactly what it should, no extra or wrong words.
10. framing — shot size and angle match the intended framing; vertical ${input.aspectRatio || ''} composition works.

Scoring: 90–100 aligned (cuts cleanly), 70–89 watch (minor issues), below 70 drift (would be noticed — re-render).
If the frame breaks screen direction or the scene needs the opposite side of the room for a reverse shot, set needsReverseAngle true and reverseYaw to the camera yaw in degrees (-180..180, 180 = looking back the other way) that the location reference should be shown from.
promptFix: one or two sentences to ADD to the image prompt that fix the issues concretely (positions as "on the left/right of frame", colours, text). Empty if aligned.
Return JSON only.`;
};

/** JSON schema for the verdict (Gemini responseSchema / plain JSON Schema). */
export const VISUAL_CONTINUITY_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    status: { type: 'string', enum: ['aligned', 'watch', 'drift'] },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...CONTINUITY_CATEGORIES] },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          message: { type: 'string' },
        },
        required: ['category', 'severity', 'message'],
      },
    },
    promptFix: { type: 'string' },
    needsReverseAngle: { type: 'boolean' },
    reverseYaw: { type: 'number' },
    reverseReason: { type: 'string' },
  },
  required: ['score', 'status', 'summary', 'issues', 'promptFix', 'needsReverseAngle'],
};

/**
 * Find the verdict object in what the model returned: models sometimes wrap it in an array
 * or under a key ("review", "verdict"). Null when there is no verdict at all — an empty or
 * unparseable answer must not read as "score 0, no issues".
 */
export const extractVerdictObject = (raw: unknown): Record<string, unknown> | null => {
  const isVerdict = (value: unknown): value is Record<string, unknown> =>
    Boolean(value) && typeof value === 'object' && !Array.isArray(value) && Number.isFinite(Number((value as Record<string, unknown>).score)) && (value as Record<string, unknown>).score !== null && (value as Record<string, unknown>).score !== '';
  if (isVerdict(raw)) return raw;
  if (Array.isArray(raw)) return raw.map(extractVerdictObject).find(Boolean) ?? null;
  if (raw && typeof raw === 'object') {
    for (const value of Object.values(raw as Record<string, unknown>)) {
      if (value && typeof value === 'object') {
        const found = extractVerdictObject(value);
        if (found) return found;
      }
    }
  }
  return null;
};

const clampScore = (value: unknown) => Math.max(0, Math.min(100, Math.round(Number(value) || 0)));

/** Normalise whatever the model returned; the status follows the score and the issues. */
export const parseVisualContinuityVerdict = (raw: unknown): VisualContinuityVerdict => {
  const data = extractVerdictObject(raw) ?? {};
  const issues = (Array.isArray(data.issues) ? data.issues : [])
    .filter((issue): issue is Record<string, unknown> => Boolean(issue) && typeof issue === 'object')
    .map((issue) => ({
      category: CONTINUITY_CATEGORIES.includes(issue.category as ContinuityCategory) ? String(issue.category) : 'staging',
      severity: (['low', 'medium', 'high'].includes(String(issue.severity)) ? issue.severity : 'medium') as 'low' | 'medium' | 'high',
      message: String(issue.message || '').trim(),
    }))
    .filter((issue) => issue.message);
  let score = clampScore(data.score);
  if (issues.some((issue) => issue.severity === 'high')) score = Math.min(score, 69);
  const status: VisualContinuityVerdict['status'] = score >= 90 && issues.every((issue) => issue.severity === 'low') ? 'aligned' : score >= 70 ? 'watch' : 'drift';
  const yaw = Number(data.reverseYaw);
  const needsReverseAngle = data.needsReverseAngle === true;
  return {
    score,
    status,
    summary: String(data.summary || '').trim() || (issues[0]?.message ?? 'No issues found.'),
    issues,
    promptFix: status === 'aligned' ? '' : String(data.promptFix || '').trim(),
    needsReverseAngle,
    reverseYaw: needsReverseAngle ? (Number.isFinite(yaw) && yaw !== 0 ? Math.max(-180, Math.min(180, Math.round(yaw))) : 180) : null,
    reverseReason: String(data.reverseReason || '').trim(),
  };
};

const ISSUE_KIND: Record<string, ShotContinuityIssue['kind']> = {
  screen_direction: 'previous_shot', eyeline: 'previous_shot', lighting: 'previous_shot',
  identity: 'reference', wardrobe: 'reference', props: 'reference', location: 'reference',
  staging: 'context_reference', text: 'context_reference', framing: 'context_reference',
};
const SEVERITY_SCORE = { low: 80, medium: 60, high: 35 } as const;

/** The verdict in the editor's existing review shape (shown on the shot card, used by auto-refine). */
export const toShotContinuityReview = (verdict: VisualContinuityVerdict, options: { comparedShot?: number; model: string }): ShotContinuityReview => ({
  score: verdict.score,
  status: verdict.status,
  priority: verdict.status === 'drift' ? 3 : verdict.status === 'watch' ? 2 : 0,
  summary: verdict.summary,
  model: options.model,
  reviewedAt: new Date().toISOString(),
  comparedShot: options.comparedShot,
  issues: verdict.issues.map((issue) => ({
    kind: ISSUE_KIND[issue.category] || 'context_reference',
    category: issue.category,
    severity: issue.severity,
    message: issue.message,
    score: SEVERITY_SCORE[issue.severity],
    comparedShot: ISSUE_KIND[issue.category] === 'previous_shot' ? options.comparedShot : undefined,
  })),
  promptFix: verdict.promptFix || undefined,
  reverseAngle: verdict.needsReverseAngle && verdict.reverseYaw !== null ? { yaw: verdict.reverseYaw, reason: verdict.reverseReason } : undefined,
});
