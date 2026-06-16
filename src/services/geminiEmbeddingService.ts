import { GoogleGenAI } from '@google/genai';
import type {
  ReferenceItem,
  ShotContextReference,
  ShotContinuityIssue,
  ShotContinuityReview,
  ShotPrompt,
  StoryBible,
} from '../types';
import { getBase64FromUrl } from '../utils/helpers';
import { recordUsage } from '../utils/usageTracker';
import { prepareVideoFileDataForGemini } from './geminiService';

export const GEMINI_EMBEDDING_2_MODEL = 'gemini-embedding-2-preview';
const GEMINI_EMBEDDING_FALLBACK_MODEL = 'gemini-embedding-001';
const DEFAULT_OUTPUT_DIMENSIONALITY = 768;
const MAX_REFERENCE_CANDIDATES = 10;
const MAX_MOODBOARD_CANDIDATES = 6;
const MAX_RESEARCH_CANDIDATES = 6;
const MAX_PREVIOUS_SHOT_CANDIDATES = 4;
const MAX_SUGGESTIONS = 5;

type SourceKind = 'reference' | 'moodboard' | 'research' | 'shot';
type ContinuityKind = ShotContinuityIssue['kind'];

type ContextCandidate = {
  id: string;
  key: string;
  sourceKind: SourceKind;
  continuityKind?: ContinuityKind;
  name: string;
  text: string;
  purpose: string;
  tag: ShotContextReference['tag'];
  imageUrl?: string;
  videoUrl?: string;
};

type PreparedContent = {
  candidate: ContextCandidate;
  content: { role: 'user'; parts: Array<Record<string, any>> };
};

type SuggestShotContextOptions = {
  storyBible: StoryBible;
  references: ReferenceItem[];
  shotPrompts: ShotPrompt[];
  shot: ShotPrompt;
  previousShot?: ShotPrompt | null;
};

type SuggestShotContextResult = {
  ok: boolean;
  model: string;
  suggestions: ShotContextReference[];
  summary: string;
  error?: string;
};

type FilmingContextVideoSuggestion = {
  id: string;
  name: string;
  purpose: string;
  videoUrl: string;
  sourceKind: SourceKind;
  similarityScore?: number;
  generatedBy?: string;
};

type SuggestFilmingContextOptions = SuggestShotContextOptions;

type SuggestFilmingContextResult = {
  ok: boolean;
  model: string;
  imageSuggestions: ShotContextReference[];
  videoSuggestions: FilmingContextVideoSuggestion[];
  summary: string;
  error?: string;
};

type ReviewRenderedContinuityOptions = {
  storyBible: StoryBible;
  references: ReferenceItem[];
  shotPrompts: ShotPrompt[];
  targetShots?: number[];
  mode?: 'rendered' | 'storyboard';
};

type ReviewRenderedContinuityResult = {
  ok: boolean;
  model: string;
  reviewedCount: number;
  summary: string;
  shotReviews: Array<{ shot: number; review: ShotContinuityReview }>;
  error?: string;
};

const normalizeText = (value?: string | null) => (value || '').replace(/\s+/g, ' ').trim();

const truncate = (value: string, max = 280) =>
  value.length > max ? `${value.slice(0, max - 1).trimEnd()}…` : value;

const uniqueBy = <T,>(items: T[], keyFn: (item: T) => string) => {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = keyFn(item);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const toScore = (similarity: number) =>
  Math.max(0, Math.min(100, Math.round(((similarity + 1) / 2) * 100)));

const cosineSimilarity = (a: number[], b: number[]) => {
  if (!a.length || !b.length || a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const getApiKey = () => {
  const apiKey = process.env.API_KEY || localStorage.getItem('gemini_api_key');
  if (!apiKey) {
    throw new Error('Gemini API Key is missing. Add it in Settings to enable multimodal context memory.');
  }
  return apiKey;
};

const getAiClient = () => new GoogleGenAI({ apiKey: getApiKey() });

export const isGeminiEmbedding2Configured = () =>
  Boolean(process.env.API_KEY || localStorage.getItem('gemini_api_key'));

const buildProjectContextText = (storyBible: StoryBible) =>
  [
    storyBible.title ? `Project: ${storyBible.title}` : '',
    storyBible.logline ? `Logline: ${truncate(normalizeText(storyBible.logline), 240)}` : '',
    storyBible.productionGuidelines
      ? `Production guidelines: ${truncate(normalizeText(storyBible.productionGuidelines), 320)}`
      : '',
    storyBible.selectedStyle ? `Style: ${storyBible.selectedStyle}` : '',
    storyBible.directorPersonaPrompt
      ? `Director intent: ${truncate(normalizeText(storyBible.directorPersonaPrompt), 240)}`
      : '',
  ]
    .filter(Boolean)
    .join('\n');

const buildShotQueryText = (
  storyBible: StoryBible,
  shot: ShotPrompt,
  previousShot?: ShotPrompt | null,
) => {
  const shotIdentity = [
    Number.isFinite(shot.sceneNumber) ? `Scene ${shot.sceneNumber}` : '',
    `Shot ${shot.shot}`,
    shot.sceneSlugline ? shot.sceneSlugline : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const projectContext = buildProjectContextText(storyBible);
  const shotContext = [
    shotIdentity,
    shot.description ? `Description: ${truncate(normalizeText(shot.description), 320)}` : '',
    shot.prompt ? `Prompt: ${truncate(normalizeText(shot.prompt), 520)}` : '',
    shot.characters.length ? `Cast: ${shot.characters.join(', ')}` : '',
    shot.environment ? `Environment: ${shot.environment}` : '',
    shot.products?.length ? `Products: ${shot.products.join(', ')}` : '',
    shot.visualTriggers?.length ? `Visual triggers: ${shot.visualTriggers.join(', ')}` : '',
    shot.cameraAngle ? `Camera angle: ${shot.cameraAngle}` : '',
    shot.motionPrompt ? `Motion: ${truncate(normalizeText(shot.motionPrompt), 180)}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const previousContext = previousShot
    ? [
        `Previous shot ${previousShot.shot}: ${truncate(normalizeText(previousShot.description || previousShot.prompt || ''), 220)}`,
        previousShot.environment ? `Previous environment: ${previousShot.environment}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    : '';

  return [projectContext, shotContext, previousContext].filter(Boolean).join('\n\n');
};

const matchesShotEntity = (shot: ShotPrompt, ref: ReferenceItem) => {
  const haystack = normalizeText(
    [
      shot.description,
      shot.prompt,
      shot.sceneSlugline,
      shot.characters.join(' '),
      shot.environment,
      (shot.products || []).join(' '),
    ].join(' '),
  ).toLowerCase();
  const name = normalizeText(ref.name).toLowerCase();
  if (!haystack || !name) return false;
  return haystack.includes(name);
};

const inferTagFromText = (value: string, fallback: ShotContextReference['tag'] = 'other') => {
  const normalized = value.toLowerCase();
  if (/light|lighting|backlight|rim light|key light|softbox|sunset|night/i.test(normalized)) return 'lighting';
  if (/wardrobe|costume|outfit|fabric|dress|suit|uniform|jacket|look/i.test(normalized)) return 'wardrobe';
  if (/prop|object|product|tool|accessory|phone|bag|vehicle/i.test(normalized)) return 'props';
  return fallback;
};

const buildReferenceCandidates = (shot: ShotPrompt, references: ReferenceItem[]): ContextCandidate[] => {
  const prioritized = uniqueBy(
    [
      ...references.filter((ref) => matchesShotEntity(shot, ref)),
      ...references,
    ],
    (ref) => ref.id,
  ).slice(0, MAX_REFERENCE_CANDIDATES);

  return prioritized.map((ref) => {
    const refText = [
      `Reference: ${ref.name}`,
      `Type: ${ref.type}`,
      ref.description ? truncate(normalizeText(ref.description), 260) : '',
      ref.tags?.length ? `Tags: ${ref.tags.join(', ')}` : '',
      ref.consistencyLocks?.length ? `Consistency locks: ${ref.consistencyLocks.join(', ')}` : '',
      ref.consistencyNotes ? `Consistency notes: ${truncate(normalizeText(ref.consistencyNotes), 180)}` : '',
    ]
      .filter(Boolean)
      .join('\n');

    const tag =
      ref.type === 'product' || ref.type === 'prop'
        ? 'props'
        : inferTagFromText(ref.description || ref.name, ref.type === 'character' ? 'wardrobe' : 'other');

    return {
      id: ref.id,
      key: `reference:${ref.id}`,
      sourceKind: 'reference',
      continuityKind: 'reference',
      name: ref.name,
      text: refText,
      purpose:
        ref.type === 'character'
          ? 'Identity, wardrobe, and recurring facial features.'
          : ref.type === 'environment'
            ? 'Environment, lighting, and production design continuity.'
            : 'Product and prop continuity.',
      tag,
      imageUrl: ref.imageUrl || undefined,
    };
  });
};

const buildMoodboardCandidates = (storyBible: StoryBible): ContextCandidate[] => {
  const categorized = storyBible.categorizedMoodboard?.items || [];
  const legacy = (storyBible.moodboard || []).map((item, index) => ({
    id: item.id || `legacy-mood-${index}`,
    url: item.url,
    label: item.label || 'Moodboard reference',
    categoryId: 'other',
    query: '',
    sourceLabel: '',
  }));

  return [...categorized, ...legacy]
    .filter((item) => item.url)
    .slice(0, MAX_MOODBOARD_CANDIDATES)
    .map((item, index) => {
      const label = item.label || item.query || `Moodboard ${index + 1}`;
      const sourceContext = [item.categoryId ? `Category: ${item.categoryId}` : '', item.query ? `Query: ${item.query}` : '']
        .filter(Boolean)
        .join('\n');
      return {
        id: item.id || `moodboard-${index}`,
        key: `moodboard:${item.id || index}`,
        sourceKind: 'moodboard',
        continuityKind: 'moodboard',
        name: label,
        text: [`Moodboard: ${label}`, sourceContext].filter(Boolean).join('\n'),
        purpose: 'Visual style, texture, color, and composition anchor.',
        tag: inferTagFromText(`${label} ${item.categoryId || ''}`),
        imageUrl: item.url,
      };
    });
};

const buildResearchCandidates = (storyBible: StoryBible): ContextCandidate[] => {
  const reports = storyBible.researchReports || [];
  const hits = reports.flatMap((report) =>
    (report.imageHits || []).slice(0, 3).map((hit, index) => ({
      reportId: report.id,
      id: hit.id || `${report.id}-${index}`,
      name: hit.title || `Research hit ${index + 1}`,
      imageUrl: hit.thumbnailUrl || hit.url,
      query: report.query,
      source: hit.source || '',
      snippet: hit.snippet || '',
    })),
  );

  return hits
    .filter((hit) => hit.imageUrl)
    .slice(0, MAX_RESEARCH_CANDIDATES)
    .map((hit, index) => ({
      id: hit.id,
      key: `research:${hit.reportId}:${index}`,
      sourceKind: 'research',
      continuityKind: 'research',
      name: hit.name,
      text: [
        `Research image: ${hit.name}`,
        hit.query ? `Query: ${hit.query}` : '',
        hit.source ? `Source: ${hit.source}` : '',
        hit.snippet ? truncate(normalizeText(hit.snippet), 180) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      purpose: 'External reference discovered during project research.',
      tag: inferTagFromText(`${hit.name} ${hit.query}`),
      imageUrl: hit.imageUrl,
    }));
};

const buildPreviousShotCandidates = (shotPrompts: ShotPrompt[], targetShot: ShotPrompt): ContextCandidate[] =>
  shotPrompts
    .filter((entry) => entry.shot < targetShot.shot && Boolean(entry.imageUrl || entry.sketchUrl))
    .sort((a, b) => b.shot - a.shot)
    .slice(0, MAX_PREVIOUS_SHOT_CANDIDATES)
    .map((entry) => ({
      id: `shot-${entry.shot}`,
      key: `shot:${entry.shot}`,
      sourceKind: 'shot' as const,
      continuityKind: 'previous_shot',
      name: `Shot ${entry.shot}`,
      text: [
        `Storyboard shot ${entry.shot}`,
        entry.description ? truncate(normalizeText(entry.description), 240) : '',
        entry.prompt ? truncate(normalizeText(entry.prompt), 260) : '',
        entry.environment ? `Environment: ${entry.environment}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      purpose: 'Previous approved/generated shot for continuity of look and blocking.',
      tag: inferTagFromText(`${entry.description || ''} ${entry.prompt || ''}`),
      imageUrl: entry.imageUrl || entry.sketchUrl || undefined,
    }));

const buildPreviousShotVideoCandidates = (shotPrompts: ShotPrompt[], targetShot: ShotPrompt): ContextCandidate[] =>
  shotPrompts
    .filter((entry) => entry.shot < targetShot.shot && Boolean(entry.videoUrl || entry.motionReferenceUrl))
    .sort((a, b) => b.shot - a.shot)
    .slice(0, MAX_PREVIOUS_SHOT_CANDIDATES)
    .map((entry) => ({
      id: `shot-video-${entry.shot}`,
      key: `shot-video:${entry.shot}`,
      sourceKind: 'shot' as const,
      continuityKind: 'previous_shot',
      name: entry.videoUrl ? `Shot ${entry.shot} video` : `Shot ${entry.shot} motion ref`,
      text: [
        `Storyboard shot ${entry.shot} video reference`,
        entry.description ? truncate(normalizeText(entry.description), 240) : '',
        entry.motionPrompt ? `Motion: ${truncate(normalizeText(entry.motionPrompt), 220)}` : '',
        entry.environment ? `Environment: ${entry.environment}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
      purpose: 'Previous shot motion and continuity reference for filming.',
      tag: 'other',
      videoUrl: entry.motionReferenceUrl || entry.videoUrl || undefined,
      imageUrl: entry.imageUrl || entry.startFrameUrl || entry.sketchUrl || undefined,
    }));

const buildShotContinuityCandidates = (
  shot: ShotPrompt,
  opts?: { includeStartFrame?: boolean },
): ContextCandidate[] => {
  const candidates: ContextCandidate[] = [];
  const includeStartFrame = opts?.includeStartFrame !== false;
  const baseFrameUrl = shot.startFrameUrl || shot.imageUrl || shot.sketchUrl || undefined;

  if (includeStartFrame && baseFrameUrl) {
    candidates.push({
      id: `shot-start-frame-${shot.shot}`,
      key: `shot-start-frame:${shot.shot}`,
      sourceKind: 'shot',
      continuityKind: 'start_frame',
      name: `Shot ${shot.shot} start frame`,
      text: [
        `Approved frame for shot ${shot.shot}`,
        shot.description ? truncate(normalizeText(shot.description), 220) : '',
        shot.prompt ? truncate(normalizeText(shot.prompt), 240) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      purpose: 'Approved storyboard or start frame that the render should preserve.',
      tag: inferTagFromText(`${shot.description || ''} ${shot.prompt || ''}`),
      imageUrl: baseFrameUrl,
    });
  }

  if (shot.motionReferenceUrl) {
    candidates.push({
      id: `shot-motion-reference-${shot.shot}`,
      key: `shot-motion-reference:${shot.shot}`,
      sourceKind: 'shot',
      continuityKind: 'motion_reference',
      name: `Shot ${shot.shot} motion reference`,
      text: [
        `Motion reference for shot ${shot.shot}`,
        shot.motionPrompt ? `Motion: ${truncate(normalizeText(shot.motionPrompt), 220)}` : '',
        shot.description ? truncate(normalizeText(shot.description), 200) : '',
      ]
        .filter(Boolean)
        .join('\n'),
      purpose: 'Motion reference clip that should drive camera energy and movement.',
      tag: 'other',
      videoUrl: shot.motionReferenceUrl,
      imageUrl: baseFrameUrl,
    });
  }

  (shot.contextReferences || [])
    .filter((ref) => Boolean(ref.imageUrl))
    .slice(0, 4)
    .forEach((ref, index) => {
      const sourceKind = ref.sourceKind || 'shot';
      candidates.push({
        id: ref.id || `shot-context-${shot.shot}-${index}`,
        key: `shot-context:${shot.shot}:${ref.id || index}`,
        sourceKind,
        continuityKind: 'context_reference',
        name: ref.name || `Shot ${shot.shot} context ${index + 1}`,
        text: [
          `Context reference for shot ${shot.shot}: ${ref.name || `Reference ${index + 1}`}`,
          ref.purpose ? truncate(normalizeText(ref.purpose), 220) : '',
        ]
          .filter(Boolean)
          .join('\n'),
        purpose: ref.purpose || 'Shot-specific continuity reference.',
        tag: ref.tag || 'other',
        imageUrl: ref.imageUrl,
      });
    });

  return uniqueBy(candidates, (candidate) => candidate.key);
};

const prepareMultimodalContent = async (candidate: ContextCandidate): Promise<PreparedContent> => {
  const parts: Array<Record<string, any>> = [];

  if (candidate.text) {
    parts.push({ text: truncate(candidate.text, 1800) });
  }

  if (candidate.videoUrl) {
    try {
      const video = await prepareVideoFileDataForGemini(candidate.videoUrl);
      parts.push({
        fileData: {
          fileUri: video.fileUri,
          mimeType: video.mimeType || 'video/mp4',
        },
      });
    } catch {
      // Fall back to image/text if video preparation fails.
    }
  }

  if (parts.length < 2 && candidate.imageUrl) {
    try {
      const image = await getBase64FromUrl(candidate.imageUrl);
      if (image.base64) {
        parts.push({
          inlineData: {
            data: image.base64,
            mimeType: image.mimeType || 'image/jpeg',
          },
        });
      }
    } catch {
      // If the image cannot be fetched (CORS, broken URL, etc.), keep the text-only candidate.
    }
  }

  return {
    candidate,
    content: {
      role: 'user',
      parts: parts.length > 0 ? parts : [{ text: candidate.name }],
    },
  };
};

const embedContents = async (
  ai: GoogleGenAI,
  model: string,
  contents: Array<{ role: 'user'; parts: Array<Record<string, any>> }>,
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT',
) => {
  const response = await ai.models.embedContent({
    model,
    contents,
    config: {
      taskType,
      outputDimensionality: DEFAULT_OUTPUT_DIMENSIONALITY,
    },
  });

  const embeddings = response.embeddings?.map((entry) => entry.values || []) || [];
  if (embeddings.length !== contents.length) {
    throw new Error(`Embedding response size mismatch for ${model}.`);
  }

  recordUsage({
    provider: 'gemini',
    model,
    kind: 'analysis',
    units: contents.length,
    unitLabel: 'request',
    note: `Gemini multimodal context ${taskType.toLowerCase()} embeddings`,
  });

  return embeddings;
};

const buildTextOnlyContents = (
  contents: Array<{ role: 'user'; parts: Array<Record<string, any>> }>,
) =>
  contents.map((content) => ({
    role: 'user' as const,
    parts: [
      {
        text: content.parts
          .map((part) => (typeof part.text === 'string' ? part.text : ''))
          .filter(Boolean)
          .join('\n\n')
          .slice(0, 1800),
      },
    ],
  }));

const pickSuggestions = (
  ranked: Array<{ candidate: ContextCandidate; similarity: number; score: number }>,
) => {
  const limits: Record<SourceKind, number> = {
    reference: 3,
    moodboard: 2,
    research: 2,
    shot: 1,
  };

  const selected: Array<{ candidate: ContextCandidate; similarity: number; score: number }> = [];
  for (const entry of ranked) {
    if (selected.length >= MAX_SUGGESTIONS) break;
    if (selected.some((picked) => picked.candidate.key === entry.candidate.key)) continue;
    const sameKindCount = selected.filter((picked) => picked.candidate.sourceKind === entry.candidate.sourceKind).length;
    if (sameKindCount >= limits[entry.candidate.sourceKind]) continue;
    if (entry.score < 54 && selected.length >= 2) continue;
    selected.push(entry);
  }
  return selected;
};

const mergeSummary = (selected: Array<{ candidate: ContextCandidate; score: number }>) =>
  selected.length === 0
    ? 'Gemini Context found no strong multimodal anchors.'
    : `Gemini Context matched ${selected.length} anchors: ${selected
        .map((entry) => `${entry.candidate.name} (${entry.score}%)`)
        .join(', ')}.`;

const mergeFilmingSummary = (
  imageSelected: Array<{ candidate: ContextCandidate; score: number }>,
  videoSelected: Array<{ candidate: ContextCandidate; score: number }>,
) => {
  const details = [
    imageSelected.length > 0
      ? `images: ${imageSelected.map((entry) => `${entry.candidate.name} (${entry.score}%)`).join(', ')}`
      : '',
    videoSelected.length > 0
      ? `videos: ${videoSelected.map((entry) => `${entry.candidate.name} (${entry.score}%)`).join(', ')}`
      : '',
  ].filter(Boolean);

  if (details.length === 0) {
    return 'Gemini Filming Context found no strong continuity anchors.';
  }
  return `Gemini Filming Context matched ${details.join(' | ')}.`;
};

const buildRenderedShotQueryContent = async (
  storyBible: StoryBible,
  shot: ShotPrompt,
  previousShot?: ShotPrompt | null,
) => {
  const parts: Array<Record<string, any>> = [
    {
      text: truncate(buildShotQueryText(storyBible, shot, previousShot), 2400),
    },
  ];

  if (shot.videoUrl) {
    try {
      const video = await prepareVideoFileDataForGemini(shot.videoUrl);
      parts.push({
        fileData: {
          fileUri: video.fileUri,
          mimeType: video.mimeType || 'video/mp4',
        },
      });
    } catch {
      // Fall back to image/text when the rendered video cannot be prepared.
    }
  }

  if (parts.length < 2) {
    const imageUrl = shot.imageUrl || shot.startFrameUrl || shot.sketchUrl;
    if (imageUrl) {
      try {
        const image = await getBase64FromUrl(imageUrl);
        if (image.base64) {
          parts.push({
            inlineData: {
              data: image.base64,
              mimeType: image.mimeType || 'image/jpeg',
            },
          });
        }
      } catch {
        // Keep the query text-only if no image can be fetched.
      }
    }
  }

  return [{ role: 'user' as const, parts }];
};

const shouldExpectPreviousShotContinuity = (shot: ShotPrompt, previousShot?: ShotPrompt | null) => {
  if (!previousShot) return false;
  if (shot.usePreviousShotContext === false) return false;
  if (shot.usePreviousShotContext === true) return true;

  const sharedCharacters = shot.characters.some((character) => previousShot.characters.includes(character));
  const sameScene =
    Number.isFinite(shot.sceneNumber) &&
    Number.isFinite(previousShot.sceneNumber) &&
    shot.sceneNumber === previousShot.sceneNumber;
  const sameEnvironment =
    normalizeText(shot.environment).toLowerCase() &&
    normalizeText(shot.environment).toLowerCase() === normalizeText(previousShot.environment).toLowerCase();

  return sharedCharacters || sameScene || Boolean(sameEnvironment);
};

const scoreToSeverity = (score: number): ShotContinuityIssue['severity'] => {
  if (score < 50) return 'high';
  if (score < 62) return 'medium';
  return 'low';
};

const continuityIssueMessage = (
  kind: ContinuityKind,
  score: number,
  candidate?: ContextCandidate,
  previousShot?: ShotPrompt | null,
) => {
  switch (kind) {
    case 'previous_shot':
      return `Drift from the previous shot${previousShot ? ` ${previousShot.shot}` : ''}; preserve carry-over framing, lighting, and character identity more tightly.`;
    case 'start_frame':
      return 'Rendered shot drifted from the approved start frame and should hold the existing composition more closely.';
    case 'motion_reference':
      return 'Rendered motion no longer matches the intended reference clip closely enough.';
    case 'context_reference':
      return `Shot-specific anchor${candidate?.name ? ` "${candidate.name}"` : ''} is not carrying through cleanly in the render.`;
    case 'reference':
      return `Core concept reference${candidate?.name ? ` "${candidate.name}"` : ''} is reading weaker than expected in the final render.`;
    case 'moodboard':
      return `Moodboard styling${candidate?.name ? ` from "${candidate.name}"` : ''} is drifting from the project look.`;
    case 'research':
      return `Research-driven visual anchor${candidate?.name ? ` "${candidate.name}"` : ''} is not landing strongly in the render.`;
    default:
      return score < 58
        ? 'Rendered shot is weakly aligned with the strongest continuity anchors.'
        : 'Rendered shot needs a light continuity pass.';
  }
};

const deriveContinuityIssues = (
  shot: ShotPrompt,
  previousShot: ShotPrompt | null,
  ranked: Array<{ candidate: ContextCandidate; similarity: number; score: number }>,
) => {
  const issues: ShotContinuityIssue[] = [];
  const previousMatch = ranked.find((entry) => entry.candidate.continuityKind === 'previous_shot') || null;
  const startFrameMatch = ranked.find((entry) => entry.candidate.continuityKind === 'start_frame') || null;
  const motionMatch = ranked.find((entry) => entry.candidate.continuityKind === 'motion_reference') || null;
  const contextMatch = ranked.find((entry) => entry.candidate.continuityKind === 'context_reference') || null;
  const strongestReference =
    ranked.find((entry) => ['reference', 'moodboard', 'research'].includes(entry.candidate.continuityKind || '')) || null;

  if (shouldExpectPreviousShotContinuity(shot, previousShot) && previousMatch && previousMatch.score < 62) {
    issues.push({
      kind: 'previous_shot',
      severity: scoreToSeverity(previousMatch.score),
      message: continuityIssueMessage('previous_shot', previousMatch.score, previousMatch.candidate, previousShot),
      score: previousMatch.score,
      anchorName: previousMatch.candidate.name,
      comparedShot: previousShot?.shot,
    });
  }

  if (shot.videoUrl && startFrameMatch && startFrameMatch.score < 64) {
    issues.push({
      kind: 'start_frame',
      severity: scoreToSeverity(startFrameMatch.score),
      message: continuityIssueMessage('start_frame', startFrameMatch.score, startFrameMatch.candidate, previousShot),
      score: startFrameMatch.score,
      anchorName: startFrameMatch.candidate.name,
    });
  }

  if (shot.motionReferenceUrl && motionMatch && motionMatch.score < 60) {
    issues.push({
      kind: 'motion_reference',
      severity: scoreToSeverity(motionMatch.score),
      message: continuityIssueMessage('motion_reference', motionMatch.score, motionMatch.candidate, previousShot),
      score: motionMatch.score,
      anchorName: motionMatch.candidate.name,
    });
  }

  if (contextMatch && contextMatch.score < 58) {
    issues.push({
      kind: 'context_reference',
      severity: scoreToSeverity(contextMatch.score),
      message: continuityIssueMessage('context_reference', contextMatch.score, contextMatch.candidate, previousShot),
      score: contextMatch.score,
      anchorName: contextMatch.candidate.name,
    });
  }

  if (strongestReference && strongestReference.score < 56) {
    issues.push({
      kind: strongestReference.candidate.continuityKind || 'reference',
      severity: scoreToSeverity(strongestReference.score),
      message: continuityIssueMessage(
        strongestReference.candidate.continuityKind || 'reference',
        strongestReference.score,
        strongestReference.candidate,
        previousShot,
      ),
      score: strongestReference.score,
      anchorName: strongestReference.candidate.name,
    });
  }

  return uniqueBy(
    issues.sort((a, b) => a.score - b.score),
    (issue) => `${issue.kind}:${issue.anchorName || ''}:${issue.comparedShot || ''}`,
  );
};

const computeContinuityScore = (
  shot: ShotPrompt,
  previousShot: ShotPrompt | null,
  ranked: Array<{ candidate: ContextCandidate; similarity: number; score: number }>,
) => {
  const weighted: Array<{ score: number; weight: number }> = [];
  const previousMatch = ranked.find((entry) => entry.candidate.continuityKind === 'previous_shot') || null;
  const startFrameMatch = ranked.find((entry) => entry.candidate.continuityKind === 'start_frame') || null;
  const motionMatch = ranked.find((entry) => entry.candidate.continuityKind === 'motion_reference') || null;
  const contextMatch = ranked.find((entry) => entry.candidate.continuityKind === 'context_reference') || null;
  const topOverall = ranked[0] || null;

  if (shouldExpectPreviousShotContinuity(shot, previousShot) && previousMatch) {
    weighted.push({ score: previousMatch.score, weight: 0.35 });
  }
  if (startFrameMatch && (shot.videoUrl || shot.startFrameUrl || shot.sketchUrl)) {
    weighted.push({ score: startFrameMatch.score, weight: 0.3 });
  }
  if (motionMatch) {
    weighted.push({ score: motionMatch.score, weight: 0.2 });
  }
  if (contextMatch) {
    weighted.push({ score: contextMatch.score, weight: 0.2 });
  }
  if (topOverall) {
    weighted.push({ score: topOverall.score, weight: weighted.length > 0 ? 0.15 : 1 });
  }

  if (weighted.length === 0) return topOverall?.score || 60;
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0);
  const weightedScore = weighted.reduce((sum, entry) => sum + entry.score * entry.weight, 0);
  return Math.max(0, Math.min(100, Math.round(weightedScore / totalWeight)));
};

const scoreToContinuityStatus = (score: number): ShotContinuityReview['status'] => {
  if (score < 58) return 'drift';
  if (score < 74) return 'watch';
  return 'aligned';
};

const computeContinuityPriority = (score: number, issues: ShotContinuityIssue[]) => {
  const highIssues = issues.filter((issue) => issue.severity === 'high').length;
  const mediumIssues = issues.filter((issue) => issue.severity === 'medium').length;
  const lowIssues = issues.filter((issue) => issue.severity === 'low').length;
  return Math.max(
    0,
    Math.min(100, Math.round((100 - score) + highIssues * 18 + mediumIssues * 10 + lowIssues * 4)),
  );
};

const summarizeContinuityReview = (
  issues: ShotContinuityIssue[],
  topAnchors: Array<{ name: string; score: number; kind: ContinuityKind }>,
) => {
  if (issues.length > 0) {
    const lead = issues[0].message;
    if (topAnchors.length > 0) {
      return `${lead} Best retained anchor: ${topAnchors[0].name} (${topAnchors[0].score}%).`;
    }
    return lead;
  }
  if (topAnchors.length > 0) {
    return `Aligned with ${topAnchors.map((entry) => `${entry.name} (${entry.score}%)`).join(', ')}.`;
  }
  return 'No clear continuity issues detected.';
};

const mergeContinuityReviewSummary = (shotReviews: Array<{ shot: number; review: ShotContinuityReview }>) => {
  if (shotReviews.length === 0) {
    return 'No rendered shots were available for Gemini Continuity Review.';
  }
  const drift = shotReviews.filter((entry) => entry.review.status === 'drift');
  const watch = shotReviews.filter((entry) => entry.review.status === 'watch');
  if (drift.length === 0 && watch.length === 0) {
    return `Gemini Continuity Review found ${shotReviews.length} aligned rendered shots.`;
  }
  const priorityList = [...drift, ...watch]
    .sort((a, b) => b.review.priority - a.review.priority || a.shot - b.shot)
    .slice(0, 3)
    .map((entry) => `Shot ${entry.shot} (${entry.review.score}%)`)
    .join(', ');
  return `Gemini Continuity Review flagged ${drift.length} drift shots and ${watch.length} watch shots. Priority queue: ${priorityList}.`;
};

export const suggestGeminiContextForShot = async (
  options: SuggestShotContextOptions,
): Promise<SuggestShotContextResult> => {
  if (!isGeminiEmbedding2Configured()) {
    return {
      ok: false,
      model: GEMINI_EMBEDDING_2_MODEL,
      suggestions: [],
      summary: 'Gemini API key missing.',
      error: 'Gemini API key missing.',
    };
  }

  const ai = getAiClient();
  const candidates = uniqueBy(
    [
      ...buildReferenceCandidates(options.shot, options.references),
      ...buildMoodboardCandidates(options.storyBible),
      ...buildResearchCandidates(options.storyBible),
      ...buildPreviousShotCandidates(options.shotPrompts, options.shot),
    ],
    (candidate) => candidate.key,
  );

  if (candidates.length === 0) {
    return {
      ok: true,
      model: GEMINI_EMBEDDING_2_MODEL,
      suggestions: [],
      summary: 'No project assets available for multimodal context matching yet.',
    };
  }

  const preparedCandidates = await Promise.all(candidates.map((candidate) => prepareMultimodalContent(candidate)));
  const queryImageUrl =
    options.shot.sketchUrl ||
    (options.shot.usePreviousShotContext !== false ? options.previousShot?.imageUrl : undefined) ||
    undefined;

  const queryParts: Array<Record<string, any>> = [
    {
      text: truncate(buildShotQueryText(options.storyBible, options.shot, options.previousShot), 2400),
    },
  ];

  if (queryImageUrl) {
    try {
      const image = await getBase64FromUrl(queryImageUrl);
      if (image.base64) {
        queryParts.push({
          inlineData: {
            data: image.base64,
            mimeType: image.mimeType || 'image/jpeg',
          },
        });
      }
    } catch {
      // Keep query text-only if the image is unavailable.
    }
  }

  const queryContent = [{ role: 'user' as const, parts: queryParts }];

  let modelUsed = GEMINI_EMBEDDING_2_MODEL;
  let queryEmbeddings: number[][] = [];
  let candidateEmbeddings: number[][] = [];

  try {
    queryEmbeddings = await embedContents(ai, modelUsed, queryContent, 'RETRIEVAL_QUERY');
    candidateEmbeddings = await embedContents(
      ai,
      modelUsed,
      preparedCandidates.map((entry) => entry.content),
      'RETRIEVAL_DOCUMENT',
    );
  } catch (error) {
    modelUsed = GEMINI_EMBEDDING_FALLBACK_MODEL;
    queryEmbeddings = await embedContents(ai, modelUsed, buildTextOnlyContents(queryContent), 'RETRIEVAL_QUERY');
    candidateEmbeddings = await embedContents(
      ai,
      modelUsed,
      buildTextOnlyContents(preparedCandidates.map((entry) => entry.content)),
      'RETRIEVAL_DOCUMENT',
    );
    console.warn('Gemini Embedding 2 multimodal matching fell back to text embeddings.', error);
  }

  const queryEmbedding = queryEmbeddings[0] || [];
  const ranked = preparedCandidates
    .map((entry, index) => {
      const similarity = cosineSimilarity(queryEmbedding, candidateEmbeddings[index] || []);
      return {
        candidate: entry.candidate,
        similarity,
        score: toScore(similarity),
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const selected = pickSuggestions(ranked);
  const suggestions: ShotContextReference[] = selected.map((entry) => ({
    id: `gemini-context-${options.shot.shot}-${entry.candidate.sourceKind}-${entry.candidate.id}`,
    name: entry.candidate.name,
    purpose: `${entry.candidate.purpose} Multimodal similarity ${entry.score}%.`,
    tag: entry.candidate.tag,
    imageUrl: entry.candidate.imageUrl,
    sourceKind: entry.candidate.sourceKind,
    similarityScore: entry.score,
    generatedBy: modelUsed,
  }));

  return {
    ok: true,
    model: modelUsed,
    suggestions,
    summary: mergeSummary(selected),
  };
};

export const suggestGeminiFilmingContextForShot = async (
  options: SuggestFilmingContextOptions,
): Promise<SuggestFilmingContextResult> => {
  if (!isGeminiEmbedding2Configured()) {
    return {
      ok: false,
      model: GEMINI_EMBEDDING_2_MODEL,
      imageSuggestions: [],
      videoSuggestions: [],
      summary: 'Gemini API key missing.',
      error: 'Gemini API key missing.',
    };
  }

  const ai = getAiClient();
  const candidates = uniqueBy(
    [
      ...buildReferenceCandidates(options.shot, options.references),
      ...buildMoodboardCandidates(options.storyBible),
      ...buildResearchCandidates(options.storyBible),
      ...buildPreviousShotCandidates(options.shotPrompts, options.shot),
      ...buildPreviousShotVideoCandidates(options.shotPrompts, options.shot),
    ],
    (candidate) => candidate.key,
  );

  if (candidates.length === 0) {
    return {
      ok: true,
      model: GEMINI_EMBEDDING_2_MODEL,
      imageSuggestions: [],
      videoSuggestions: [],
      summary: 'No project assets available for filming context matching yet.',
    };
  }

  const preparedCandidates = await Promise.all(candidates.map((candidate) => prepareMultimodalContent(candidate)));
  const queryParts: Array<Record<string, any>> = [
    {
      text: truncate(buildShotQueryText(options.storyBible, options.shot, options.previousShot), 2400),
    },
  ];

  const queryImageUrl = options.shot.startFrameUrl || options.shot.imageUrl || options.shot.sketchUrl;
  if (queryImageUrl) {
    try {
      const image = await getBase64FromUrl(queryImageUrl);
      if (image.base64) {
        queryParts.push({
          inlineData: {
            data: image.base64,
            mimeType: image.mimeType || 'image/jpeg',
          },
        });
      }
    } catch {
      // Keep query text-only if the image is unavailable.
    }
  }

  if (options.shot.motionReferenceUrl) {
    try {
      const video = await prepareVideoFileDataForGemini(options.shot.motionReferenceUrl);
      queryParts.push({
        fileData: {
          fileUri: video.fileUri,
          mimeType: video.mimeType || 'video/mp4',
        },
      });
    } catch {
      // Keep query image/text-only if the video is unavailable.
    }
  }

  const queryContent = [{ role: 'user' as const, parts: queryParts }];

  let modelUsed = GEMINI_EMBEDDING_2_MODEL;
  let queryEmbeddings: number[][] = [];
  let candidateEmbeddings: number[][] = [];

  try {
    queryEmbeddings = await embedContents(ai, modelUsed, queryContent, 'RETRIEVAL_QUERY');
    candidateEmbeddings = await embedContents(
      ai,
      modelUsed,
      preparedCandidates.map((entry) => entry.content),
      'RETRIEVAL_DOCUMENT',
    );
  } catch (error) {
    modelUsed = GEMINI_EMBEDDING_FALLBACK_MODEL;
    queryEmbeddings = await embedContents(ai, modelUsed, buildTextOnlyContents(queryContent), 'RETRIEVAL_QUERY');
    candidateEmbeddings = await embedContents(
      ai,
      modelUsed,
      buildTextOnlyContents(preparedCandidates.map((entry) => entry.content)),
      'RETRIEVAL_DOCUMENT',
    );
    console.warn('Gemini Embedding 2 filming matching fell back to text embeddings.', error);
  }

  const queryEmbedding = queryEmbeddings[0] || [];
  const ranked = preparedCandidates
    .map((entry, index) => {
      const similarity = cosineSimilarity(queryEmbedding, candidateEmbeddings[index] || []);
      return {
        candidate: entry.candidate,
        similarity,
        score: toScore(similarity),
      };
    })
    .sort((a, b) => b.similarity - a.similarity);

  const imageSelected = pickSuggestions(ranked.filter((entry) => !entry.candidate.videoUrl));
  const videoSelected = ranked
    .filter((entry) => entry.candidate.videoUrl)
    .filter((entry, index, array) => index === array.findIndex((other) => other.candidate.videoUrl === entry.candidate.videoUrl))
    .slice(0, 2)
    .filter((entry, index) => entry.score >= 54 || index === 0);

  return {
    ok: true,
    model: modelUsed,
    imageSuggestions: imageSelected.map((entry) => ({
      id: `gemini-filming-image-${options.shot.shot}-${entry.candidate.sourceKind}-${entry.candidate.id}`,
      name: entry.candidate.name,
      purpose: `${entry.candidate.purpose} Multimodal similarity ${entry.score}%.`,
      tag: entry.candidate.tag,
      imageUrl: entry.candidate.imageUrl,
      sourceKind: entry.candidate.sourceKind,
      similarityScore: entry.score,
      generatedBy: modelUsed,
    })),
    videoSuggestions: videoSelected
      .filter((entry) => Boolean(entry.candidate.videoUrl))
      .map((entry) => ({
        id: `gemini-filming-video-${options.shot.shot}-${entry.candidate.sourceKind}-${entry.candidate.id}`,
        name: entry.candidate.name,
        purpose: `${entry.candidate.purpose} Multimodal similarity ${entry.score}%.`,
        videoUrl: entry.candidate.videoUrl!,
        sourceKind: entry.candidate.sourceKind,
        similarityScore: entry.score,
        generatedBy: modelUsed,
      })),
    summary: mergeFilmingSummary(imageSelected, videoSelected),
  };
};

export const reviewGeminiContinuityForRenderedShots = async (
  options: ReviewRenderedContinuityOptions,
): Promise<ReviewRenderedContinuityResult> => {
  if (!isGeminiEmbedding2Configured()) {
    return {
      ok: false,
      model: GEMINI_EMBEDDING_2_MODEL,
      reviewedCount: 0,
      summary: 'Gemini API key missing.',
      shotReviews: [],
      error: 'Gemini API key missing.',
    };
  }

  const targetSet = options.targetShots?.length ? new Set(options.targetShots) : null;
  const renderedShots = options.shotPrompts
    .filter((shot) => (targetSet ? targetSet.has(shot.shot) : true))
    .filter((shot) => Boolean(shot.videoUrl || shot.imageUrl || shot.startFrameUrl));

  if (renderedShots.length === 0) {
    return {
      ok: true,
      model: GEMINI_EMBEDDING_2_MODEL,
      reviewedCount: 0,
      summary: 'No rendered shots were available for Gemini Continuity Review.',
      shotReviews: [],
    };
  }

  const ai = getAiClient();
  const shotReviews: Array<{ shot: number; review: ShotContinuityReview }> = [];
  let modelUsed = GEMINI_EMBEDDING_2_MODEL;
  const reviewMode = options.mode || 'rendered';

  for (const shot of renderedShots) {
    const previousShot =
      [...options.shotPrompts]
        .filter((entry) => entry.shot < shot.shot && Boolean(entry.videoUrl || entry.imageUrl || entry.startFrameUrl))
        .sort((a, b) => b.shot - a.shot)[0] || null;

    const includeStartFrameCandidate = reviewMode !== 'storyboard' || Boolean(shot.startFrameUrl || shot.sketchUrl || shot.videoUrl);
    const candidates = uniqueBy(
      [
        ...buildShotContinuityCandidates(shot, { includeStartFrame: includeStartFrameCandidate }),
        ...(previousShot
          ? [
              ...buildPreviousShotCandidates([previousShot], shot),
              ...buildPreviousShotVideoCandidates([previousShot], shot),
            ]
          : []),
        ...buildReferenceCandidates(shot, options.references).slice(0, 3),
        ...buildMoodboardCandidates(options.storyBible).slice(0, 2),
        ...buildResearchCandidates(options.storyBible).slice(0, 2),
      ],
      (candidate) => candidate.key,
    );

    if (candidates.length === 0) {
      shotReviews.push({
        shot: shot.shot,
        review: {
          score: 72,
          status: 'aligned',
          priority: 0,
          summary: 'No continuity anchors were available for this rendered shot.',
          model: modelUsed,
          reviewedAt: new Date().toISOString(),
          comparedShot: previousShot?.shot,
          topAnchors: [],
          issues: [],
        },
      });
      continue;
    }

    const preparedCandidates = await Promise.all(candidates.map((candidate) => prepareMultimodalContent(candidate)));
    const queryContent = await buildRenderedShotQueryContent(options.storyBible, shot, previousShot);

    let shotModel = GEMINI_EMBEDDING_2_MODEL;
    let queryEmbeddings: number[][] = [];
    let candidateEmbeddings: number[][] = [];

    try {
      queryEmbeddings = await embedContents(ai, shotModel, queryContent, 'RETRIEVAL_QUERY');
      candidateEmbeddings = await embedContents(
        ai,
        shotModel,
        preparedCandidates.map((entry) => entry.content),
        'RETRIEVAL_DOCUMENT',
      );
    } catch (error) {
      shotModel = GEMINI_EMBEDDING_FALLBACK_MODEL;
      queryEmbeddings = await embedContents(ai, shotModel, buildTextOnlyContents(queryContent), 'RETRIEVAL_QUERY');
      candidateEmbeddings = await embedContents(
        ai,
        shotModel,
        buildTextOnlyContents(preparedCandidates.map((entry) => entry.content)),
        'RETRIEVAL_DOCUMENT',
      );
      console.warn(`Gemini Continuity Review fell back to text embeddings for shot ${shot.shot}.`, error);
    }

    modelUsed = shotModel;
    const queryEmbedding = queryEmbeddings[0] || [];
    const ranked = preparedCandidates
      .map((entry, index) => {
        const similarity = cosineSimilarity(queryEmbedding, candidateEmbeddings[index] || []);
        return {
          candidate: entry.candidate,
          similarity,
          score: toScore(similarity),
        };
      })
      .sort((a, b) => b.similarity - a.similarity);

    const topAnchors = ranked
      .filter((entry, index) => entry.score >= 54 || index < 2)
      .slice(0, 4)
      .map((entry) => ({
        name: entry.candidate.name,
        score: entry.score,
        kind: entry.candidate.continuityKind || 'reference',
      }));

    const issues = deriveContinuityIssues(shot, previousShot, ranked);
    const score = computeContinuityScore(shot, previousShot, ranked);
    const status = scoreToContinuityStatus(score);
    const priority = computeContinuityPriority(score, issues);

    shotReviews.push({
      shot: shot.shot,
      review: {
        score,
        status,
        priority,
        summary: summarizeContinuityReview(issues, topAnchors),
        model: shotModel,
        reviewedAt: new Date().toISOString(),
        comparedShot: previousShot?.shot,
        topAnchors,
        issues,
      },
    });
  }

  return {
    ok: true,
    model: modelUsed,
    reviewedCount: shotReviews.length,
    summary: mergeContinuityReviewSummary(shotReviews),
    shotReviews,
  };
};
