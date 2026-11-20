/**
 * Per-shot video prompting (Seedance 2.x first, also Kling / Veo / MiniMax), built
 * from Ludwig's Higgsfield skills: higgsfield-seedance-prompts (block order),
 * higgsfield-acting-skill (Tigran's ACTING TASK), seedance-2-pro-director
 * (complexity budget, blocking), seedance-2-prompt-guidance (final frame, settings
 * out of the prose) and higgsfield-fight-scene.
 *
 * Where the skills disagree this module decides:
 *  - ACTING TASK beats facial choreography: physical detail lives in ACTION/PHYSICS,
 *    emotion is never instructed as an adjective or a face movement.
 *  - Positive phrasing; at most one short trailing guardrail line.
 *  - Field of view in degrees from fixed steps, never millimetres or camera brands.
 *
 * The guide is the system prompt for the in-app writer and for agents (MCP
 * project_video_prompt_guide); lintShotVideoPrompt checks a written prompt.
 */

export const FOV_STEPS = [180, 107, 84, 63, 47, 29, 18, 12, 8] as const;

export const ACTING_TASK_TEMPLATE = `ACTING TASK — [NAME] (fully invested in the tactic; the work happens in the eyes):
SCENE DIRECTION (shared, unspoken): [one line every character in the scene plays]
MOTIVE (their fuel): [why THEY push in that direction, given the circumstances]
GOAL: [their personal fight — never the scene direction's words, never the theme]
OBSTACLE: [what presses against it; what one crack would cost]
TACTIC: [what they DO to the partner, eye-work named as action]
Moment to moment:
— "[dialogue words]" — [verb at the partner + what the eyes check]
— "[dialogue words]" — [verb + eye-work]
— [where the line breaks, if it breaks]
(Safety: gaze always engaged in the task — never a frozen, glassy, unfocused stare; natural blink cadence.)`;

export const FIGHT_STYLE_LOCK = 'every kick stays below belt height; every punch travels a short straight line from the guard; the first visible motion of a limb is the strike itself; every hit lands with a reaction along its direction; both fighters stay fully in frame with feet visible.';

export const SHOT_VIDEO_PROMPT_GUIDE = `You write one self-contained English video prompt per shot for Seedance 2.x (also usable for Kling, Veo, MiniMax).
Each prompt is sealed: the model has no memory of other shots. Never mention scene numbers, script headings, other shots, "as above" or "continues". Use previous/next shots only to keep wardrobe, props, light, time of day and emotional carry consistent.

BLOCKS, in this order (drop the ones the shot does not need; no style prefix):
1. SCENE CONTEXT — 1–2 sentences: what happens, where, when; where each character stands.
2. REFERENCES — one line per reference image with exactly one role: "Image 1 is Mara's identity: woman, 30s, wet dark hair, grey wool coat. 100% matches the reference." Keep appearance short (age, role/build, current state, unique features, what the action needs, voice only if they speak). Never name a reference for a subject that is not in this shot. When references conflict, say which wins.
3. FIRST FRAME / BLOCKING — who is where in frame 1: screen thirds or left/right from the camera, depth layer, facing direction, gaze, contact points. Characters keep their sides; nobody crosses the centre line unless the action requires it.
4. FORMAT — one of: "One continuous shot; the camera does not cut on its own." | timed cuts "0.0s to 3.0s — … / 3.0s HARD CUT / 3.0s to 8.0s — …" with "cuts only at the stated points". Cut types: HARD, MATCH, INSERT, REVERSE, SMASH, WHIP (a whip under 0.8 s reads as a hard cut). Hold geometry, screen direction, light, wardrobe and props across cuts.
5. OPTICS + CAMERA — shot size (ECU, CU, MCU, MS, WS, EWS), field of view in degrees from ${FOV_STEPS.join('/')}°, height, distance, one motivated move ("very slow dolly-in, 47°, eye level — lets the silence sit") or locked off. No millimetres, no camera, lens, film-stock, brand or director names. At most one camera move per segment.
6. ACTION — one dominant action per shot or segment, in simple present tense, one instruction per sentence. Separate what the camera does from what the subject does and what the environment does. Physical truth: weight, inertia, contact, fluids, particles.
7. ACTING TASK — for every character who speaks or whose reaction matters, including silent listeners. Use this ladder: read the whole scene first; name the scene's event from its ending; SCENE DIRECTION shared by everyone; then per character MOTIVE, GOAL, OBSTACLE, TACTIC with moment-to-moment beats keyed to the actual dialogue words. Characters play the direction, never the emotion. No emotion adjectives ("sadly", "nervously"), no facial choreography ("brows lift", "lip trembles"); name eye-work as action ("checking both of his eyes for a spark of trust", "stealing looks and snapping back before she is caught"). Template:
${ACTING_TASK_TEMPLATE}
8. DIALOGUE — short lines with speaker, timing and delivery: Mara says quietly at 4s: "Stay here." No subtitles unless asked.
9. LIGHT — source, direction, quality, key/fill, haze as numbers ("haze 20%"), white balance in Kelvin. Light must come from something in the scene.
10. AUDIO — ambience, Foley, dialogue, music listed separately, each with a visible or timed cause ("rain on the tin roof, a cup set down at 2s, no music"). If nothing is needed: "quiet room tone, no music".
11. LOCKS + FINAL FRAME — short positive continuity locks next to what they protect ("her scarf stays wrapped twice around her neck"), then "Final frame: …" describing the last image and how long it holds. Optionally one trailing guardrail line: "No cuts, no morphing, no text."

COMPLEXITY BUDGET: one shot = one main idea, one main action, one camera strategy. 4–8 s: one action. 8–12 s: action + reveal. 12–15 s: 2–3 simple beats. Split into timed cuts or separate shots when there are more than 2 strong actions, more than 2 camera moves, more than 3 important characters, or a location change.

WORDING: write only what is visible or audible. No mood words (epic, cinematic, beautiful, stunning, masterpiece, dramatic, ultra-realistic, 8K). Atmosphere in numbers, giants in multiples of human height, colour as material + light ("rust-red paint flaking under sodium light"). Duration, aspect ratio and resolution are generation settings — do not bury them in the prose unless the model needs cut timing.

FIGHTS: beats of 1–2 s (position → strike with limb, surface and target → reaction along the strike's direction → new position); at most 4 actions without a stillness beat; describe states, not wind-ups ("the fist is already travelling"); body geometry instead of martial-arts terms; every impact sound in AUDIO; end with: "${FIGHT_STYLE_LOCK}"`;

export type ShotPromptIssue = { rule: string; severity: 'high' | 'medium' | 'low'; message: string };

const MOOD_WORDS = /\b(epic|cinematic masterpiece|masterpiece|stunning|breathtaking|beautiful|gorgeous|ultra[- ]?realistic|hyper[- ]?realistic|award[- ]winning|8k|4k uhd|dramatic(?:ally)?)\b/gi;
const BRANDS = /\b(arri|alexa|red komodo|red v-raptor|sony venice|panavision|cooke|zeiss|kodak|portra|fujifilm|leica|canon eos|blackmagic|imax|spielberg|kubrick|fincher|villeneuve|deakins|nolan)\b/gi;
const EMOTION_ADVERBS = /\b(sadly|nervously|angrily|happily|anxiously|fearfully|tearfully|joyfully|lovingly|bitterly|desperately)\b/gi;
const FACE_CHOREO = /\b(brows? (?:lift|rise|raise|furrow)s?|eyebrows? (?:lift|rise|raise)s?|lip trembles|lips tremble|jaw tightens|nostrils flare|eyes widen)\b/gi;
const CONTEXT_LEAK = /\b(as above|same as before|continues from|previous shot|next shot|scene \d+|shot \d+|INT\.|EXT\.)/g;

const findAll = (text: string, pattern: RegExp) => Array.from(new Set((text.match(pattern) || []).map((m) => m.toLowerCase())));

/** Checks a written shot prompt against the skill rules. Empty array = clean. */
export const lintShotVideoPrompt = (
  prompt: string,
  context?: { hasDialogue?: boolean; characters?: number; isFight?: boolean; durationSeconds?: number },
): ShotPromptIssue[] => {
  const text = prompt || '';
  const issues: ShotPromptIssue[] = [];
  const push = (rule: string, severity: ShotPromptIssue['severity'], message: string) => issues.push({ rule, severity, message });

  const mood = findAll(text, MOOD_WORDS);
  if (mood.length) push('wording', 'medium', `Mood words describe nothing visible: ${mood.join(', ')}.`);
  const brands = findAll(text, BRANDS);
  if (brands.length) push('names', 'medium', `No camera, film-stock or director names: ${brands.join(', ')}.`);
  if (/\b\d{2,3}\s?mm\b/i.test(text)) push('optics', 'low', `Give the field of view in degrees (${FOV_STEPS.join('/')}°) instead of millimetres.`);
  const leaks = findAll(text, CONTEXT_LEAK);
  if (leaks.length) push('sealed', 'high', `Each prompt stands alone; remove references to other shots or script headings: ${leaks.join(', ')}.`);
  if (!/final frame\s*:/i.test(text)) push('final-frame', 'medium', 'End with "Final frame: …" (the last image and how long it holds).');

  const negatives = (text.match(/\b(no|don't|do not|never|without|avoid)\b/gi) || []).length;
  const guardrail = /\n?[^\n]*no (?:cuts|morphing|text)[^\n]*$/i.test(text.trim());
  if (negatives > (guardrail ? 6 : 3)) push('positive', 'low', 'Phrase locks positively; naming a forbidden thing tends to summon it. Keep negatives to one short trailing guardrail.');

  const emotion = findAll(text, EMOTION_ADVERBS);
  if (emotion.length) push('acting', 'medium', `Characters play the direction, not the emotion: ${emotion.join(', ')}.`);
  const face = findAll(text, FACE_CHOREO);
  if (face.length) push('acting', 'medium', `Facial choreography makes dead faces; give the eyes a task instead: ${face.join(', ')}.`);
  if (context?.hasDialogue && !/ACTING TASK/i.test(text)) push('acting', 'high', 'Dialogue shot without an ACTING TASK block.');
  if (/ACTING TASK/i.test(text) && !/(blink|glassy|frozen)/i.test(text)) push('acting', 'low', 'Add the safety line: gaze engaged in the task, never frozen or glassy; natural blinks.');

  const times = Array.from(text.matchAll(/(\d+(?:\.\d+)?)s to (\d+(?:\.\d+)?)s/g)).map((m) => [Number(m[1]), Number(m[2])] as const);
  for (let i = 0; i < times.length; i += 1) {
    const [from, to] = times[i];
    if (to <= from || (i > 0 && from < times[i - 1][1])) { push('timing', 'high', 'Timed segments must run forward without overlap.'); break; }
    if (context?.durationSeconds && to > context.durationSeconds + 0.01) { push('timing', 'high', `A segment ends at ${to}s, after the ${context.durationSeconds}s clip.`); break; }
  }
  if (times.length > 1 && !/cuts? only at/i.test(text)) push('timing', 'low', 'With timed cuts, add "cuts only at the stated points".');

  if ((context?.characters || 0) > 3) push('budget', 'medium', 'More than 3 important characters: split the shot or use timed cuts.');
  if (context?.isFight) {
    if (!/below belt height/i.test(text)) push('fight', 'medium', 'Fight shot without the fight style lock.');
    if (/\b(jab|cross|hook|uppercut|roundhouse|wing chun|jkd|kata)\b/i.test(text)) push('fight', 'low', 'Describe body geometry instead of martial-arts terms.');
  }
  return issues;
};

/** Short human-readable summary for UI and agent replies. */
export const summarizeShotPromptIssues = (issues: ShotPromptIssue[]) =>
  issues.length ? issues.map((issue) => `[${issue.severity}] ${issue.message}`).join('\n') : 'Clean.';

/** A prompt written with this guide: block labels, an acting task or a final frame. Such prompts are sent as written. */
export const isStructuredShotPrompt = (prompt: string | null | undefined) => {
  const text = prompt || '';
  if (/ACTING TASK/i.test(text) || /^\s*final frame\s*:/im.test(text)) return true;
  const labels = text.match(/^\s*(SCENE CONTEXT|REFERENCES|FIRST FRAME|BLOCKING|FORMAT|OPTICS|CAMERA|ACTION|DIALOGUE|LIGHT(?:ING)?|AUDIO|LOCKS)\b\s*[:—-]/gim) || [];
  return labels.length >= 3;
};

export type ShotVideoPromptCharacter = {
  name: string;
  look?: string;
  personality?: string;
  goals?: string;
  gestures?: string;
  voice?: string;
  speechStyle?: string;
};

export type ShotVideoPromptRequest = {
  shotNumber: number;
  description: string;
  modelLabel?: string;
  durationSeconds?: number;
  aspectRatio?: string;
  mode?: 'image-to-video' | 'text-to-video' | 'reference-to-video';
  /** Reference images in the order the model receives them (Image 1, Image 2, …). */
  references?: string[];
  characters?: ShotVideoPromptCharacter[];
  environment?: string;
  dialogue?: Array<{ speaker?: string; line: string }>;
  cameraMovement?: string;
  style?: string;
  framing?: string;
  previousShot?: string;
  nextShot?: string;
  /** The other shots of the same scene, in order, so the acting ladder can read the whole scene. */
  sceneShots?: string[];
  script?: string;
};

const block = (title: string, body?: string | null) => (body && body.trim() ? `${title}:\n${body.trim()}` : '');

/** The user message for an LLM writing one shot's video prompt with SHOT_VIDEO_PROMPT_GUIDE as instructions. */
export const buildShotVideoPromptRequest = (req: ShotVideoPromptRequest) => [
  `Write the video prompt for shot ${req.shotNumber}${req.modelLabel ? ` (model: ${req.modelLabel})` : ''}.`,
  `Settings (do not repeat them as prose unless cut timing needs them): ${[
    req.mode || 'image-to-video',
    req.durationSeconds ? `${req.durationSeconds} s` : '',
    req.aspectRatio ? `aspect ${req.aspectRatio}` : '',
  ].filter(Boolean).join(', ')}.`,
  req.mode !== 'text-to-video' ? 'The storyboard frame of this shot is the first frame; describe motion from it, keep its composition and identities.' : '',
  block('Shot', req.description),
  block('Reference images, in order', (req.references || []).map((name, index) => `Image ${index + 1}: ${name}`).join('\n')),
  block('Characters in this shot', (req.characters || []).map((c) => [
    `- ${c.name}${c.look ? `: ${c.look}` : ''}`,
    c.personality ? `  personality: ${c.personality}` : '',
    c.goals ? `  wants: ${c.goals}` : '',
    c.gestures ? `  physical habits: ${c.gestures}` : '',
    c.voice || c.speechStyle ? `  voice: ${[c.voice, c.speechStyle].filter(Boolean).join('; ')}` : '',
  ].filter(Boolean).join('\n')).join('\n')),
  block('Location', req.environment),
  block('Dialogue in this shot', (req.dialogue || []).map((d) => `${d.speaker ? `${d.speaker}: ` : ''}"${d.line}"`).join('\n')),
  block('Camera movement chosen by the director', req.cameraMovement),
  block('Visual style', req.style),
  block('Framing', req.framing),
  block('The whole scene, shot by shot (read it first for the acting ladder; do not mention other shots)', (req.sceneShots || []).join('\n')),
  block('Previous shot (continuity only)', req.previousShot),
  block('Next shot (continuity only)', req.nextShot),
  req.script ? block('Script', req.script.length > 12000 ? `${req.script.slice(0, 12000)}…` : req.script) : '',
  'Return only the prompt text, with the block labels, nothing before or after it.',
].filter(Boolean).join('\n\n');
