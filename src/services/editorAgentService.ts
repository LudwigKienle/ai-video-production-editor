import { GoogleGenAI, Type } from '@google/genai';
import {
    EditPlan,
    EditPlanFinding,
    EditPlanOperation,
    EditPlanTextPosition,
    MediaItem,
    NeurocinematicsAnalysisResult,
    ReviewFeedback,
    TimelineClip,
    TimelineTrack,
    TransitionType,
} from '../types';

const EDIT_AGENT_MODEL = 'gemini-3.1-pro-preview';
const MAX_TIMELINE_CLIPS_IN_CONTEXT = 32;
const MAX_FINDINGS = 6;
const MAX_OPERATIONS = 8;
const TEXT_POSITIONS: EditPlanTextPosition[] = [
    'center',
    'top-left',
    'top-center',
    'top-right',
    'bottom-left',
    'bottom-center',
    'bottom-right',
];

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const buildId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;

const getAiClient = () => {
    const envKey = process.env.API_KEY;
    const storageKey = localStorage.getItem('gemini_api_key');
    const apiKey = envKey || storageKey;

    if (!apiKey) {
        return null;
    }
    return new GoogleGenAI({ apiKey });
};

const extractJsonFromText = (text: string) => {
    const trimmed = (text || '').trim();
    if (trimmed.startsWith('```')) {
        return trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
    }
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        return trimmed.slice(firstBrace, lastBrace + 1);
    }
    return trimmed;
};

const parseJson = <T>(text: string): T => JSON.parse(extractJsonFromText(text)) as T;

const maybeNumber = (value: unknown) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim().length > 0) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
    }
    return undefined;
};

const normalizeConfidence = (value: unknown) => {
    const numeric = maybeNumber(value);
    if (typeof numeric !== 'number') return 0.6;
    if (numeric > 1 && numeric <= 100) return clamp(numeric / 100, 0, 1);
    return clamp(numeric, 0, 1);
};

const summarizeText = (value: string | null | undefined, fallback: string, maxLength = 120) => {
    const compact = (value || '').replace(/\s+/g, ' ').trim();
    if (!compact) return fallback;
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
};

const formatTime = (seconds: number) => {
    const totalTenths = Math.max(0, Math.round(seconds * 10));
    const mins = Math.floor(totalTenths / 600);
    const secs = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
};

const resolveTrackLabel = (track: TimelineTrack | undefined, orderedTracks: TimelineTrack[]) => {
    if (!track) return 'Track';
    const sameType = orderedTracks.filter((entry) => entry.type === track.type);
    const index = sameType.findIndex((entry) => entry.id === track.id);
    const prefix = track.type === 'audio' ? 'A' : 'V';
    return `${prefix}${index >= 0 ? index + 1 : 1}`;
};

const buildAnalysisSummary = (analysisResult?: NeurocinematicsAnalysisResult | null) => {
    if (!analysisResult) return '';
    const sceneNotes = (analysisResult.scenes || [])
        .slice(0, 3)
        .map((scene) => `${scene.timestamp}: ${summarizeText(scene.improvementSuggestion || scene.description, 'No note', 140)}`);
    return [
        analysisResult.overallFeedback?.neurocinematics,
        analysisResult.overallFeedback?.kuleshovEffect,
        analysisResult.overallFeedback?.cognitivePsychology,
        analysisResult.overallFeedback?.soundDesign,
        sceneNotes.length > 0 ? `Scene notes: ${sceneNotes.join(' | ')}` : '',
    ]
        .filter(Boolean)
        .join('\n');
};

const buildTimelineOverview = (payload: {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
}) => {
    const mediaById = new Map(payload.mediaItems.map((item) => [item.id, item]));
    const orderedTracks = [...payload.timelineTracks];
    const trackById = new Map(orderedTracks.map((track) => [track.id, track]));

    return payload.timelineClips
        .slice()
        .sort((a, b) => {
            const trackIndexA = orderedTracks.findIndex((track) => track.id === a.trackId);
            const trackIndexB = orderedTracks.findIndex((track) => track.id === b.trackId);
            if (trackIndexA !== trackIndexB) return trackIndexA - trackIndexB;
            return a.start - b.start;
        })
        .slice(0, MAX_TIMELINE_CLIPS_IN_CONTEXT)
        .map((clip) => {
            const media = mediaById.get(clip.mediaId);
            const track = trackById.get(clip.trackId);
            const trackLabel = resolveTrackLabel(track, orderedTracks);
            const duration = Math.max(0.05, clip.end - clip.start);
            return {
                clipId: clip.id,
                mediaId: clip.mediaId,
                trackId: clip.trackId,
                trackLabel,
                mediaType: media?.type || 'unknown',
                clipStart: Number(clip.start.toFixed(2)),
                clipEnd: Number(clip.end.toFixed(2)),
                clipDuration: Number(duration.toFixed(2)),
                label: summarizeText(media?.prompt || media?.name, media?.name || clip.id, 120),
                hasTransition: Boolean(clip.transitionOut),
                transitionType: clip.transitionOut?.type || null,
                hasTextOverlay: Boolean(clip.textConfig?.content),
            };
        });
};

export const buildTimelineDraftShotList = (payload: {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
}) => {
    const mediaById = new Map(payload.mediaItems.map((item) => [item.id, item]));
    const trackOrder = payload.timelineTracks
        .filter((track) => track.type === 'video')
        .map((track) => track.id);

    return payload.timelineClips
        .filter((clip) => trackOrder.includes(clip.trackId))
        .slice()
        .sort((a, b) => {
            if (a.start !== b.start) return a.start - b.start;
            return trackOrder.indexOf(a.trackId) - trackOrder.indexOf(b.trackId);
        })
        .slice(0, MAX_TIMELINE_CLIPS_IN_CONTEXT)
        .map((clip, index) => {
            const media = mediaById.get(clip.mediaId);
            const baseLabel = summarizeText(media?.prompt || media?.name, clip.id, 180);
            const timing = `${formatTime(clip.start)}-${formatTime(clip.end)}`;
            return {
                shot: index + 1,
                description: `${timing} on ${clip.trackId} · ${baseLabel}`,
                prompt: media?.prompt || media?.name || baseLabel,
                imageUrl: media?.url,
            };
        });
};

const buildGapSummary = (timelineClips: TimelineClip[], timelineTracks: TimelineTrack[]) => {
    const unlockedVideoTracks = timelineTracks.filter((track) => track.type === 'video' && !track.isLocked);
    const summaries: string[] = [];

    unlockedVideoTracks.forEach((track) => {
        const clips = timelineClips
            .filter((clip) => clip.trackId === track.id)
            .slice()
            .sort((a, b) => a.start - b.start);

        let cursor = 0;
        clips.forEach((clip) => {
            if (clip.start > cursor + 0.6) {
                summaries.push(`${track.id}:${formatTime(cursor)}-${formatTime(clip.start)}`);
            }
            cursor = Math.max(cursor, clip.end);
        });
    });

    return summaries.slice(0, 8);
};

export const buildReviewDrivenObjective = (
    objective: string,
    reviewFeedback?: ReviewFeedback | null,
    analysisResult?: NeurocinematicsAnalysisResult | null,
) => {
    const parts = [summarizeText(objective, 'Tighten pacing, reduce dead air, and improve continuity.', 220)];

    if (reviewFeedback?.summary) {
        parts.push(`Draft review summary: ${summarizeText(reviewFeedback.summary, '', 220)}`);
    }
    if (reviewFeedback?.weaknesses?.length) {
        parts.push(`Address these draft weaknesses: ${reviewFeedback.weaknesses.slice(0, 3).join(' | ')}`);
    }
    if (reviewFeedback?.continuityIssues?.length) {
        parts.push(`Fix continuity issues: ${reviewFeedback.continuityIssues.slice(0, 3).join(' | ')}`);
    }
    if (analysisResult?.scenes?.length) {
        const sceneNotes = analysisResult.scenes
            .slice(0, 3)
            .map((scene) => summarizeText(scene.improvementSuggestion || scene.visualFeedback || scene.description, 'Improve this beat', 140));
        if (sceneNotes.length > 0) {
            parts.push(`Rendered draft notes: ${sceneNotes.join(' | ')}`);
        }
    }

    return parts.filter(Boolean).join('\n');
};

const matchTransitionType = (value: unknown): TransitionType | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    return Object.values(TransitionType).find((candidate) => candidate.toLowerCase() === normalized) || null;
};

const matchTextPosition = (value: unknown): EditPlanTextPosition | undefined => {
    if (typeof value !== 'string') return undefined;
    const normalized = value.trim().toLowerCase();
    return TEXT_POSITIONS.find((candidate) => candidate === normalized) || undefined;
};

const sanitizeFinding = (value: any, clipIds: Set<string>, index: number): EditPlanFinding | null => {
    if (!value || typeof value !== 'object') return null;
    const severity = value.severity === 'warning' || value.severity === 'opportunity' ? value.severity : 'info';
    const title = summarizeText(typeof value.title === 'string' ? value.title : '', '', 80);
    const detail = summarizeText(typeof value.detail === 'string' ? value.detail : '', '', 240);
    if (!title || !detail) return null;
    const linkedClipIds = Array.isArray(value.clipIds)
        ? value.clipIds.filter((clipId: unknown) => typeof clipId === 'string' && clipIds.has(clipId)).slice(0, 4)
        : undefined;
    return {
        id: typeof value.id === 'string' && value.id ? value.id : `finding-${index + 1}`,
        severity,
        title,
        detail,
        clipIds: linkedClipIds && linkedClipIds.length > 0 ? linkedClipIds : undefined,
    };
};

const sanitizeOperation = (value: any, clipIds: Set<string>, trackIds: Set<string>, index: number): EditPlanOperation | null => {
    if (!value || typeof value !== 'object') return null;
    if (typeof value.clipId !== 'string' || !clipIds.has(value.clipId)) return null;
    const type = typeof value.type === 'string' ? value.type.trim() : '';
    const reason = summarizeText(typeof value.reason === 'string' ? value.reason : '', '', 220);
    const confidence = normalizeConfidence(value.confidence);
    const id = typeof value.id === 'string' && value.id ? value.id : `op-${index + 1}`;

    if (!reason) return null;

    if (type === 'trim_clip') {
        const start = maybeNumber(value.start);
        const end = maybeNumber(value.end);
        if (typeof start !== 'number' && typeof end !== 'number') return null;
        return { id, type, clipId: value.clipId, reason, confidence, start, end };
    }

    if (type === 'move_clip') {
        const start = maybeNumber(value.start);
        if (typeof start !== 'number') return null;
        const trackId = typeof value.trackId === 'string' && trackIds.has(value.trackId) ? value.trackId : undefined;
        return { id, type, clipId: value.clipId, reason, confidence, start, trackId };
    }

    if (type === 'delete_clip') {
        return {
            id,
            type,
            clipId: value.clipId,
            reason,
            confidence,
            ripple: value.ripple === true,
        };
    }

    if (type === 'set_transition') {
        const transitionType = matchTransitionType(value.transitionType);
        if (!transitionType) return null;
        const transitionDuration = maybeNumber(value.transitionDuration);
        return {
            id,
            type,
            clipId: value.clipId,
            reason,
            confidence,
            transitionType,
            transitionDuration: typeof transitionDuration === 'number' ? transitionDuration : undefined,
        };
    }

    if (type === 'set_text_overlay') {
        const textContent = summarizeText(typeof value.textContent === 'string' ? value.textContent : '', '', 120);
        if (!textContent) return null;
        const textSize = maybeNumber(value.textSize);
        return {
            id,
            type,
            clipId: value.clipId,
            reason,
            confidence,
            textContent,
            textColor: typeof value.textColor === 'string' ? value.textColor : undefined,
            textSize: typeof textSize === 'number' ? textSize : undefined,
            textPosition: matchTextPosition(value.textPosition),
        };
    }

    return null;
};

const sanitizePlan = (
    raw: any,
    context: {
        objective: string;
        clipIds: Set<string>;
        trackIds: Set<string>;
    },
    source: EditPlan['source'],
): EditPlan => {
    const findings = Array.isArray(raw?.findings)
        ? raw.findings
            .map((entry, index) => sanitizeFinding(entry, context.clipIds, index))
            .filter((entry): entry is EditPlanFinding => Boolean(entry))
            .slice(0, MAX_FINDINGS)
        : [];

    const operations = Array.isArray(raw?.operations)
        ? raw.operations
            .map((entry, index) => sanitizeOperation(entry, context.clipIds, context.trackIds, index))
            .filter((entry): entry is EditPlanOperation => Boolean(entry))
            .slice(0, MAX_OPERATIONS)
        : [];

    const risks = Array.isArray(raw?.risks)
        ? raw.risks
            .filter((entry: unknown) => typeof entry === 'string' && entry.trim().length > 0)
            .map((entry: string) => summarizeText(entry, '', 180))
            .slice(0, 4)
        : [];

    return {
        id: typeof raw?.id === 'string' && raw.id ? raw.id : buildId('edit-plan'),
        createdAt: new Date().toISOString(),
        objective: context.objective,
        summary: summarizeText(typeof raw?.summary === 'string' ? raw.summary : '', 'No summary returned.', 280),
        findings,
        operations,
        risks: risks.length > 0 ? risks : undefined,
        source,
    };
};

export const buildHeuristicEditPlan = (payload: {
    objective: string;
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    selectedClipId?: string | null;
}): EditPlan => {
    const mediaById = new Map(payload.mediaItems.map((item) => [item.id, item]));
    const unlockedVideoTrackIds = new Set(
        payload.timelineTracks.filter((track) => track.type === 'video' && !track.isLocked).map((track) => track.id),
    );
    const sortedVideoClips = payload.timelineClips
        .filter((clip) => unlockedVideoTrackIds.has(clip.trackId))
        .slice()
        .sort((a, b) => a.start - b.start);

    const findings: EditPlanFinding[] = [];
    const operations: EditPlanOperation[] = [];

    const selectedClip = payload.selectedClipId
        ? payload.timelineClips.find((clip) => clip.id === payload.selectedClipId) || null
        : null;

    const primaryTrimCandidates = (selectedClip ? [selectedClip] : sortedVideoClips)
        .filter((clip) => (clip.end - clip.start) > 7)
        .slice(0, selectedClip ? 1 : 2);

    primaryTrimCandidates.forEach((clip, index) => {
        const newEnd = Number((clip.end - Math.min(2.5, (clip.end - clip.start) * 0.18)).toFixed(2));
        if (newEnd - clip.start < 2) return;
        operations.push({
            id: `heuristic-trim-${index + 1}`,
            type: 'trim_clip',
            clipId: clip.id,
            end: newEnd,
            reason: 'Tighten pacing by trimming the least information-dense tail of the shot.',
            confidence: selectedClip && selectedClip.id === clip.id ? 0.72 : 0.61,
        });
    });

    if (primaryTrimCandidates.length > 0) {
        findings.push({
            id: 'heuristic-long-shots',
            severity: 'opportunity',
            title: 'Long beats detected',
            detail: 'One or more shots run long for a rough cut. Shortening their tails should tighten pacing without changing story order.',
            clipIds: primaryTrimCandidates.map((clip) => clip.id),
        });
    }

    for (let index = 0; index < sortedVideoClips.length - 1 && operations.length < MAX_OPERATIONS; index += 1) {
        const current = sortedVideoClips[index];
        const next = sortedVideoClips[index + 1];
        const cutGap = next.start - current.end;
        if (cutGap < 0.12 && !current.transitionOut && (current.end - current.start) > 1.5 && (next.end - next.start) > 1.5) {
            operations.push({
                id: `heuristic-transition-${index + 1}`,
                type: 'set_transition',
                clipId: current.id,
                transitionType: TransitionType.CROSS_FADE,
                transitionDuration: 0.35,
                reason: 'Smooth a hard cut between adjacent shots to reduce visual abruptness.',
                confidence: 0.55,
            });
            findings.push({
                id: 'heuristic-cut-smoothing',
                severity: 'info',
                title: 'Abrupt cut candidate',
                detail: 'A close, back-to-back cut may benefit from a light dissolve.',
                clipIds: [current.id, next.id],
            });
            break;
        }
    }

    if (operations.length === 0 && sortedVideoClips[0]) {
        const first = sortedVideoClips[0];
        const media = mediaById.get(first.mediaId);
        operations.push({
            id: 'heuristic-title',
            type: 'set_text_overlay',
            clipId: first.id,
            textContent: summarizeText(media?.name, 'Opening beat', 32),
            textPosition: 'bottom-center',
            textSize: 42,
            textColor: '#FFFFFF',
            reason: 'Add a lightweight editorial slate so the first beat reads more clearly in review.',
            confidence: 0.42,
        });
        findings.push({
            id: 'heuristic-no-strong-edit',
            severity: 'warning',
            title: 'No high-confidence cut found',
            detail: 'Heuristic mode could not inspect frame-level content. It returned a conservative editorial suggestion instead.',
            clipIds: [first.id],
        });
    }

    return {
        id: buildId('edit-plan'),
        createdAt: new Date().toISOString(),
        objective: payload.objective,
        summary: operations.length > 0
            ? 'Generated a conservative local plan based on clip durations, cut density, and track structure.'
            : 'Timeline structure looks stable. No clear heuristic edit changes were found.',
        findings: findings.slice(0, MAX_FINDINGS),
        operations: operations.slice(0, MAX_OPERATIONS),
        risks: ['Heuristic mode does not inspect actual frames or audio content. Regenerate with a Gemini API key for a stronger plan.'],
        source: 'heuristic',
    };
};

export const generateEditPlan = async (payload: {
    objective: string;
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    selectedClipId?: string | null;
    projectName?: string | null;
    storyContext?: string | null;
    analysisResult?: NeurocinematicsAnalysisResult | null;
    playheadPosition?: number;
}): Promise<EditPlan> => {
    const clipIds = new Set(payload.timelineClips.map((clip) => clip.id));
    const trackIds = new Set(payload.timelineTracks.map((track) => track.id));
    const objective = summarizeText(payload.objective, 'Tighten pacing, reduce dead air, and improve continuity.', 220);
    const ai = getAiClient();

    if (!ai) {
        return buildHeuristicEditPlan(payload);
    }

    const timelineOverview = buildTimelineOverview(payload);
    const selectedClip = payload.selectedClipId
        ? timelineOverview.find((entry) => entry.clipId === payload.selectedClipId) || null
        : null;
    const analysisSummary = buildAnalysisSummary(payload.analysisResult);
    const gapSummary = buildGapSummary(payload.timelineClips, payload.timelineTracks);

    const prompt = [
        'You are a senior film editor creating a SAFE edit plan for a non-destructive AI video editor.',
        `Objective: ${objective}`,
        payload.projectName ? `Project: ${summarizeText(payload.projectName, '', 80)}` : '',
        payload.storyContext ? `Story context: ${summarizeText(payload.storyContext, '', 500)}` : '',
        analysisSummary ? `Existing analysis: ${analysisSummary}` : '',
        typeof payload.playheadPosition === 'number' ? `Current playhead: ${formatTime(payload.playheadPosition)}` : '',
        selectedClip ? `Selected clip: ${JSON.stringify(selectedClip)}` : 'Selected clip: none',
        gapSummary.length > 0 ? `Notable timeline gaps: ${gapSummary.join(', ')}` : '',
        `Timeline snapshot (${timelineOverview.length} clips max): ${JSON.stringify(timelineOverview)}`,
        'Allowed operation types ONLY: trim_clip, move_clip, delete_clip, set_transition, set_text_overlay.',
        'Rules:',
        '- Use ONLY clipId and trackId values that exist in the snapshot.',
        '- Prefer 2-6 small changes over one destructive rewrite.',
        '- Phase 1 trim operations must only shorten clips, never extend them.',
        '- Do not propose overlapping clips on the same track.',
        '- Do not move clips onto locked tracks.',
        `- Allowed transitionType values: ${Object.values(TransitionType).join(', ')}.`,
        `- Allowed textPosition values: ${TEXT_POSITIONS.join(', ')}.`,
        '- Confidence must be a number from 0 to 1.',
        '- Keep risks honest and concise.',
        'Return JSON only.',
    ]
        .filter(Boolean)
        .join('\n');

    const response = await ai.models.generateContent({
        model: EDIT_AGENT_MODEL,
        contents: prompt,
        config: {
            responseMimeType: 'application/json',
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    summary: { type: Type.STRING },
                    findings: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                severity: { type: Type.STRING },
                                title: { type: Type.STRING },
                                detail: { type: Type.STRING },
                                clipIds: { type: Type.ARRAY, items: { type: Type.STRING } },
                            },
                        },
                    },
                    operations: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                type: { type: Type.STRING },
                                clipId: { type: Type.STRING },
                                reason: { type: Type.STRING },
                                confidence: { type: Type.NUMBER },
                                start: { type: Type.NUMBER },
                                end: { type: Type.NUMBER },
                                trackId: { type: Type.STRING },
                                ripple: { type: Type.BOOLEAN },
                                transitionType: { type: Type.STRING },
                                transitionDuration: { type: Type.NUMBER },
                                textContent: { type: Type.STRING },
                                textColor: { type: Type.STRING },
                                textSize: { type: Type.NUMBER },
                                textPosition: { type: Type.STRING },
                            },
                        },
                    },
                    risks: { type: Type.ARRAY, items: { type: Type.STRING } },
                },
            },
        },
    });

    const parsed = parseJson<any>(response.text);
    return sanitizePlan(parsed, { objective, clipIds, trackIds }, 'ai');
};
