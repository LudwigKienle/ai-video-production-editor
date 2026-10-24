/**
 * Video take review: a video model (Gemini, natively — frames and sound) watches a generated
 * shot and judges what stills and loudness meters cannot: image and animation quality, the
 * camera move, whether background extras move or stand frozen like mannequins, character
 * consistency against the concept references, lip sync against the dialogue line, audio and
 * artifacts. Several takes of one shot can be compared side by side to pick the one to cut in.
 * Pure prompt building, result mapping and scoring (no network); geminiService sends it.
 */
import type { ShotPrompt, ShotVideoReview, ShotVideoReviewIssue, ShotVideoReviewScores, ShotVideoTakeComparison } from '../types';

export const VIDEO_REVIEW_DIMENSIONS = ['visualQuality', 'animation', 'cameraMotion', 'backgroundMotion', 'consistency', 'lipSync', 'audio'] as const;
export type VideoReviewDimension = typeof VIDEO_REVIEW_DIMENSIONS[number];

export const VIDEO_REVIEW_DIMENSION_LABELS: Record<VideoReviewDimension, string> = {
  visualQuality: 'Image quality',
  animation: 'Animation',
  cameraMotion: 'Camera move',
  backgroundMotion: 'Background life',
  consistency: 'Character consistency',
  lipSync: 'Lip sync',
  audio: 'Audio',
};

/** How much each dimension counts in the computed score (renormalised over the ones that apply). */
const DIMENSION_WEIGHTS: Record<VideoReviewDimension, number> = {
  visualQuality: 0.2,
  animation: 0.22,
  cameraMotion: 0.08,
  backgroundMotion: 0.12,
  consistency: 0.18,
  lipSync: 0.14,
  audio: 0.06,
};

export const VIDEO_ISSUE_CATEGORIES: ShotVideoReviewIssue['category'][] = ['quality', 'animation', 'camera', 'background', 'consistency', 'lip_sync', 'audio', 'artifact', 'story'];

export type VideoReviewShotInput = {
  label: string;
  description: string;
  /** The motion/video prompt the take was rendered from. */
  videoPrompt?: string;
  cameraMove?: string;
  characters: string[];
  environment?: string | null;
  /** The line that should be spoken in this shot, if any. */
  dialogue?: string | null;
  /** The scene has people in the background (a party, a street, an office). */
  populated?: boolean;
  durationSeconds?: number;
  aspectRatio?: string;
  videoModel?: string;
};

/** Reference images in order after the video; the model sees "Image 1: Nora Vale — character reference". */
export type VideoReviewReferenceLabel = { label: string };

const shotBlock = (shot: VideoReviewShotInput) => [
  `Shot ${shot.label}: ${shot.description || 'no description'}`,
  shot.videoPrompt ? `Video prompt: ${shot.videoPrompt.slice(0, 1200)}` : '',
  `Intended camera move: ${shot.cameraMove || 'as the prompt describes (static if none)'}`,
  `On screen: ${shot.characters.join(', ') || 'no named characters'}${shot.environment ? ` · location: ${shot.environment}` : ''}`,
  shot.dialogue ? `Dialogue line that must be spoken, in sync: "${shot.dialogue}"` : 'No dialogue is written for this shot (lipSync -1 unless someone clearly speaks).',
  shot.populated ? 'The scene is populated: background people must stay alive (shift weight, talk, glance, sip, walk).' : '',
  [shot.durationSeconds ? `Length ≈ ${Math.round(shot.durationSeconds)}s` : '', shot.aspectRatio ? `aspect ${shot.aspectRatio}` : '', shot.videoModel ? `rendered with ${shot.videoModel}` : ''].filter(Boolean).join(' · '),
].filter(Boolean).join('\n');

const RUBRIC = `Score each dimension 0–10 (10 = indistinguishable from a real film shot, 7 = usable in a cut, 5 = noticeable problems, 3 or less = unusable). Use -1 when a dimension does not apply.
- visualQuality — sharpness, detail, lighting and colour, stable exposure; no flicker, smearing, noise or compression mush.
- animation — how the CHARACTERS move: natural body mechanics, weight and balance, hands, facial expression, blinking, timing; no jitter, rubber limbs, floating, sliding feet or slow-motion drift.
- cameraMotion — the camera does the intended move, smoothly, without warping the space.
- backgroundMotion — secondary motion: extras and the environment stay alive. Background people frozen in place, standing like mannequins or wax figures while the foreground moves, is the most common AI failure: score it 3 or less, set frozenBackground true and add a high "background" issue with the timestamp. -1 only if the frame has no background people or moving environment at all.
- consistency — each character matches their reference image (face, hair, age, build, wardrobe colours) and stays the same person for the whole clip.
- lipSync — mouth shapes match the spoken words and the timing; the line is intelligible and is the written line (missing words, gibberish or the wrong speaker are issues). -1 if nobody speaks and no line is written.
- audio — clean sound: no clipping, dropouts, robotic or wrong voice, music or noise that does not belong. -1 if the clip is silent.
Issues: concrete, with timestamp "MM:SS" and severity. Categories: quality, animation, camera, background, consistency, lip_sync, audio, artifact (morphing, melting or merging bodies, extra or missing limbs and fingers, warped faces, objects popping in or out, garbled text or signs), story (the action is not what the shot asks for).
score — overall 0–10 for cutting this take into the film. verdict — keep (≥ 8, cut it in), usable (6–7.9), reshoot (< 6).
dialogueHeard — the words actually spoken, verbatim (empty if none).
promptFix — one or two sentences to change in the VIDEO prompt so a re-render fixes the biggest problems (e.g. "background guests keep chatting and shifting weight throughout"). Empty if nothing to fix.`;

/** Prompt for one take: watch it (with sound), compare with the references, judge. */
export const buildVideoReviewPrompt = (shot: VideoReviewShotInput, references: VideoReviewReferenceLabel[] = []) => `You are the editor and VFX supervisor of a film made with AI video. WATCH the whole clip and LISTEN to its sound — judge what you see and hear, not what the prompt promises.

${shotBlock(shot)}
${references.length ? `\nAfter the video come the concept references:\n${references.map((ref, index) => `Image ${index + 1}: ${ref.label}`).join('\n')}\n` : ''}
${RUBRIC}
Return JSON only.`;

/** Prompt for several takes of the same shot: pick the one to cut in. */
export const buildTakeComparisonPrompt = (shot: VideoReviewShotInput, takeLabels: string[], references: VideoReviewReferenceLabel[] = []) => `You are the editor of a film made with AI video. Here are ${takeLabels.length} takes of the SAME shot, in this order:
${takeLabels.map((label, index) => `Video ${index + 1}: ${label}`).join('\n')}
WATCH every take completely and LISTEN to its sound, then decide which one to cut into the film.

${shotBlock(shot)}
${references.length ? `\nAfter the videos come the concept references:\n${references.map((ref, index) => `Image ${index + 1}: ${ref.label}`).join('\n')}\n` : ''}
Weigh, in this order: artifacts and broken anatomy (disqualifying), character animation and consistency with the references, lip sync of the written line, background extras that stay alive (frozen mannequin crowds are a serious flaw), image quality, camera move, audio.
bestTake — the number of the best video (1-based). ranking — every take once: take number, rank (1 = best), one-sentence reason naming what is visibly better or worse. reason — why the best take wins, in one or two sentences.
Return JSON only.`;

const scoreProperty = { type: 'number', description: '0–10, or -1 when not applicable' };

/** JSON schema of one take review (Gemini responseJsonSchema / plain JSON Schema). */
export const VIDEO_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    verdict: { type: 'string', enum: ['keep', 'usable', 'reshoot'] },
    scores: {
      type: 'object',
      properties: Object.fromEntries(VIDEO_REVIEW_DIMENSIONS.map((key) => [key, scoreProperty])),
      required: [...VIDEO_REVIEW_DIMENSIONS],
    },
    frozenBackground: { type: 'boolean' },
    summary: { type: 'string' },
    issues: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: [...VIDEO_ISSUE_CATEGORIES] },
          severity: { type: 'string', enum: ['low', 'medium', 'high'] },
          message: { type: 'string' },
          timestamp: { type: 'string' },
        },
        required: ['category', 'severity', 'message'],
      },
    },
    dialogueHeard: { type: 'string' },
    promptFix: { type: 'string' },
  },
  required: ['score', 'verdict', 'scores', 'frozenBackground', 'summary', 'issues', 'promptFix'],
};

export const TAKE_COMPARISON_SCHEMA = {
  type: 'object',
  properties: {
    bestTake: { type: 'number' },
    reason: { type: 'string' },
    ranking: {
      type: 'array',
      items: {
        type: 'object',
        properties: { take: { type: 'number' }, rank: { type: 'number' }, reason: { type: 'string' } },
        required: ['take', 'rank', 'reason'],
      },
    },
  },
  required: ['bestTake', 'reason', 'ranking'],
};

const isRecord = (value: unknown): value is Record<string, unknown> => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** Find the object holding `key` in what the model returned (it sometimes wraps it in an array or under "review"). */
const findObjectWith = (raw: unknown, key: string, depth = 0): Record<string, unknown> | null => {
  if (depth > 4) return null;
  if (isRecord(raw) && raw[key] !== undefined && raw[key] !== null && raw[key] !== '') return raw;
  const children = Array.isArray(raw) ? raw : isRecord(raw) ? Object.values(raw) : [];
  for (const child of children) {
    if (child && typeof child === 'object') {
      const found = findObjectWith(child, key, depth + 1);
      if (found) return found;
    }
  }
  return null;
};

const round1 = (value: number) => Math.round(value * 10) / 10;

/** 0–10 with one decimal; models sometimes answer on a 0–100 scale. Null for "not applicable" and junk. */
export const normalizeTenScale = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '' || typeof value === 'boolean') return null;
  let number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  if (number > 10) number = number <= 100 ? number / 10 : 10;
  return round1(Math.min(10, number));
};

/** Weighted mean of the dimensions that apply; null when none does. */
export const weightedVideoScore = (scores: ShotVideoReviewScores): number | null => {
  let total = 0;
  let weight = 0;
  for (const key of VIDEO_REVIEW_DIMENSIONS) {
    const value = scores[key];
    if (value === null || value === undefined) continue;
    total += value * DIMENSION_WEIGHTS[key];
    weight += DIMENSION_WEIGHTS[key];
  }
  return weight > 0 ? round1(total / weight) : null;
};

/**
 * The overall score: the reviewer's own number, kept honest by its sub-scores and issues —
 * it may not sit more than 2 points above the weighted sub-scores, a high-severity issue caps it
 * at 5.5, a frozen background at 6, and a dimension at 3 or below pulls it to that + 2.5.
 */
export const computeVideoReviewScore = (input: { modelScore: number | null; scores: ShotVideoReviewScores; issues: ShotVideoReviewIssue[]; frozenBackground: boolean }) => {
  const weighted = weightedVideoScore(input.scores);
  let score = input.modelScore ?? weighted ?? 0;
  if (weighted !== null) score = Math.min(score, weighted + 2);
  if (input.issues.some((issue) => issue.severity === 'high')) score = Math.min(score, 5.5);
  if (input.frozenBackground) score = Math.min(score, 6);
  const lowest = VIDEO_REVIEW_DIMENSIONS.map((key) => input.scores[key]).filter((value): value is number => value !== null && value !== undefined);
  if (lowest.length && Math.min(...lowest) <= 3) score = Math.min(score, Math.min(...lowest) + 2.5);
  return round1(Math.max(0, Math.min(10, score)));
};

export const verdictForScore = (score: number): ShotVideoReview['verdict'] => (score >= 8 ? 'keep' : score >= 6 ? 'usable' : 'reshoot');

const TIMESTAMP = /^\d{1,2}:\d{2}(?:\.\d+)?$/;

/** Normalise one take review. Null when the answer holds no review at all (never read as "score 0"). */
export const parseVideoReview = (raw: unknown, meta: { videoUrl: string; model?: string; reviewedAt?: string }): ShotVideoReview | null => {
  const data = findObjectWith(raw, 'scores') ?? findObjectWith(raw, 'score');
  if (!data) return null;
  const rawScores = isRecord(data.scores) ? data.scores : {};
  const scores = Object.fromEntries(VIDEO_REVIEW_DIMENSIONS.map((key) => [key, normalizeTenScale(rawScores[key])])) as ShotVideoReviewScores;
  const issues: ShotVideoReviewIssue[] = (Array.isArray(data.issues) ? data.issues : [])
    .filter(isRecord)
    .map((issue) => {
      const category = String(issue.category || '').toLowerCase().replace(/[\s-]+/g, '_');
      const timestamp = String(issue.timestamp || '').trim();
      return {
        category: (VIDEO_ISSUE_CATEGORIES.includes(category as ShotVideoReviewIssue['category']) ? category : category === 'lipsync' ? 'lip_sync' : 'quality') as ShotVideoReviewIssue['category'],
        severity: (['low', 'medium', 'high'].includes(String(issue.severity)) ? issue.severity : 'medium') as ShotVideoReviewIssue['severity'],
        message: String(issue.message || '').trim(),
        ...(TIMESTAMP.test(timestamp) ? { timestamp } : {}),
      };
    })
    .filter((issue) => issue.message);
  const frozenBackground = data.frozenBackground === true
    || (scores.backgroundMotion !== null && scores.backgroundMotion <= 3 && issues.some((issue) => issue.category === 'background'));
  const modelScore = normalizeTenScale(data.score);
  if (modelScore === null && weightedVideoScore(scores) === null) return null;
  const score = computeVideoReviewScore({ modelScore, scores, issues, frozenBackground });
  const dialogueHeard = String(data.dialogueHeard || '').trim();
  const promptFix = String(data.promptFix || '').trim();
  return {
    videoUrl: meta.videoUrl,
    score,
    verdict: verdictForScore(score),
    scores,
    frozenBackground,
    summary: String(data.summary || '').trim(),
    issues,
    ...(dialogueHeard ? { dialogueHeard } : {}),
    ...(promptFix ? { promptFix } : {}),
    ...(meta.model ? { model: meta.model } : {}),
    reviewedAt: meta.reviewedAt || new Date().toISOString(),
  };
};

export type ParsedTakeComparison = { bestTake: number; reason: string; ranking: Array<{ take: number; rank: number; reason: string }> };

/** Normalise a side-by-side answer; takes are 1-based and must exist. Null when unusable. */
export const parseTakeComparison = (raw: unknown, takeCount: number): ParsedTakeComparison | null => {
  const data = findObjectWith(raw, 'bestTake') ?? findObjectWith(raw, 'ranking');
  if (!data) return null;
  const valid = (take: unknown) => Number.isInteger(Number(take)) && Number(take) >= 1 && Number(take) <= takeCount;
  const seen = new Set<number>();
  const ranking = (Array.isArray(data.ranking) ? data.ranking : [])
    .filter(isRecord)
    .filter((entry) => valid(entry.take))
    .map((entry) => ({ take: Number(entry.take), rank: Number(entry.rank), reason: String(entry.reason || '').trim() }))
    .filter((entry) => (seen.has(entry.take) ? false : (seen.add(entry.take), true)))
    .sort((a, b) => (Number.isFinite(a.rank) ? a.rank : 99) - (Number.isFinite(b.rank) ? b.rank : 99))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const bestTake = valid(data.bestTake) ? Number(data.bestTake) : ranking[0]?.take;
  if (!bestTake) return null;
  return { bestTake, reason: String(data.reason || '').trim() || ranking.find((entry) => entry.take === bestTake)?.reason || '', ranking };
};

/**
 * Decide the take to cut in. The side-by-side pick stands unless the single-take reviews show it
 * clearly worse (more than 1.5 points below the best-scored take, or a reshoot next to a keeper);
 * then the scores decide. Without a comparison the highest score wins (the newer take on a tie).
 */
export const pickBestTake = (takes: string[], reviews: ShotVideoReview[], comparison: ParsedTakeComparison | null, meta: { model?: string; comparedAt?: string } = {}): ShotVideoTakeComparison | null => {
  if (takes.length === 0) return null;
  const scoreOf = (url: string) => reviews.find((review) => review.videoUrl === url)?.score ?? null;
  const byScore = takes
    .map((url, index) => ({ url, index, score: scoreOf(url) }))
    .filter((entry): entry is { url: string; index: number; score: number } => entry.score !== null)
    .sort((a, b) => b.score - a.score || b.index - a.index);
  const comparedAt = meta.comparedAt || new Date().toISOString();
  const base = { ...(meta.model ? { model: meta.model } : {}), comparedAt };
  const scoreRanking = () => byScore.map((entry, index) => {
    const review = reviews.find((item) => item.videoUrl === entry.url);
    return { videoUrl: entry.url, rank: index + 1, reason: review?.summary || `Scored ${entry.score}/10.` };
  });
  if (comparison) {
    const pickedUrl = takes[comparison.bestTake - 1];
    const pickedScore = scoreOf(pickedUrl);
    const top = byScore[0];
    const overruled = Boolean(top && pickedScore !== null && top.url !== pickedUrl
      && (top.score - pickedScore > 1.5 || (verdictForScore(pickedScore) === 'reshoot' && verdictForScore(top.score) === 'keep')));
    if (!overruled) {
      const ranking = comparison.ranking.length
        ? comparison.ranking.map((entry) => ({ videoUrl: takes[entry.take - 1], rank: entry.rank, reason: entry.reason }))
        : scoreRanking();
      return { bestVideoUrl: pickedUrl, reason: comparison.reason, ranking, decidedBy: 'comparison', ...base };
    }
    const topReview = reviews.find((review) => review.videoUrl === top.url);
    return {
      bestVideoUrl: top.url,
      reason: `Scores ${top.score}/10 against ${pickedScore}/10 for the side-by-side pick (v${comparison.bestTake}). ${topReview?.summary || ''}`.trim(),
      ranking: scoreRanking(),
      decidedBy: 'scores',
      ...base,
    };
  }
  if (!byScore.length) return null;
  const top = byScore[0];
  return { bestVideoUrl: top.url, reason: reviews.find((review) => review.videoUrl === top.url)?.summary || `Highest score (${top.score}/10).`, ranking: scoreRanking(), decidedBy: 'scores', ...base };
};

/** The shot's takes, oldest first (videoVersions, or the single videoUrl). */
export const shotTakes = (shot: Pick<ShotPrompt, 'videoUrl' | 'videoVersions'>) => {
  const versions = (shot.videoVersions || []).filter(Boolean);
  if (versions.length) return shot.videoUrl && !versions.includes(shot.videoUrl) ? [...versions, shot.videoUrl] : versions;
  return shot.videoUrl ? [shot.videoUrl] : [];
};

/** Replace reviews of the same take, drop reviews of takes the shot no longer has. */
export const mergeVideoReviews = (existing: ShotVideoReview[] | undefined, incoming: ShotVideoReview[], takes: string[]) => {
  const byUrl = new Map<string, ShotVideoReview>();
  for (const review of [...(existing || []), ...incoming]) byUrl.set(review.videoUrl, review);
  return [...byUrl.values()].filter((review) => takes.includes(review.videoUrl));
};

export const videoReviewFor = (shot: Pick<ShotPrompt, 'videoReviews'>, videoUrl?: string | null) =>
  (videoUrl ? shot.videoReviews?.find((review) => review.videoUrl === videoUrl) : undefined) || null;

/** The written line for lip sync: the voiceover text, else the first quoted line in the prompts. */
export const extractDialogueLine = (shot: Pick<ShotPrompt, 'voiceoverText' | 'motionPrompt' | 'prompt' | 'description'>) => {
  const voice = shot.voiceoverText?.trim();
  if (voice) return voice;
  for (const text of [shot.motionPrompt, shot.prompt, shot.description]) {
    const quoted = (text || '').match(/["“„«]([^"“”„«»]{4,400})["”“»]/g);
    const line = quoted?.map((entry) => entry.slice(1, -1).trim()).find((entry) => entry.split(/\s+/).length >= 2);
    if (line) return line;
  }
  return null;
};

const POPULATED = /\b(crowd|party|guests?|extras?|people|passers?-?by|pedestrians?|audience|bar|club|restaurant|caf[eé]|office|street|market|press|reporters?|paparazzi|ballroom|gala|wedding|station|lobby|waiters?|staff|patrons?|dancers?|commuters?|students?|crew)\b/i;

/** Does the shot have people in the background who must keep moving? */
export const isPopulatedShot = (shot: Pick<ShotPrompt, 'prompt' | 'description' | 'motionPrompt' | 'sceneSlugline' | 'environment'>) =>
  POPULATED.test([shot.prompt, shot.description, shot.motionPrompt, shot.sceneSlugline, shot.environment].filter(Boolean).join(' '));

/** One-line agent/tool view of a review. */
export const formatVideoReviewIssues = (review: ShotVideoReview) =>
  review.issues.map((issue) => `[${issue.severity}]${issue.timestamp ? ` ${issue.timestamp}` : ''} ${issue.category}: ${issue.message}`);
