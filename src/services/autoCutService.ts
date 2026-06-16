/**
 * Auto Cut Service
 * AI-powered video analysis for automatic segment detection and quality verification.
 */

import { GoogleGenAI, Type, GenerateContentResponse } from "@google/genai";
import { recordUsage } from '../utils/usageTracker';
import { prepareVideoFileDataForGemini } from './geminiService';

const AUTO_CUT_MODEL_PRO = 'gemini-3.1-pro-preview';
const AUTO_CUT_EMBEDDING_MODEL = 'gemini-embedding-001';
const MAX_SCRIPT_CONTEXT_CHARS = 24000;
const MAX_SCRIPT_BEATS = 24;
const MAX_SCRIPT_BEAT_CHARS = 900;

// ============================================================================
// TYPES
// ============================================================================

export interface VideoSegment {
    id: string;
    startTime: number; // Seconds
    endTime: number;   // Seconds
    score: number;     // 0-100
    baseScore?: number; // Original score before script matching
    semanticScore?: number | null; // 0-100 script-match score
    reason: string;    // Why this segment is good
    summary?: string;
    dialogue?: string;
    keywords?: string[];
    scriptMatch?: ScriptBeatMatch | null;
    technicalQuality: {
        focus: number;      // 0-100
        exposure: number;   // 0-100
        stability: number;  // 0-100
    };
    contentRelevance: number;  // 0-100
    emotionalImpact: number;   // 0-100
}

export interface SegmentAnalysisResult {
    segments: VideoSegment[];
    totalDuration: number;
    analysisNotes: string;
}

export interface ScriptBeat {
    id: string;
    label: string;
    text: string;
    excerpt: string;
}

export interface ScriptBeatMatch {
    beatId: string;
    beatLabel: string;
    excerpt: string;
    similarity: number; // 0-100
}

export interface AutoCutContext {
    scriptText?: string | null;
    storyContext?: string | null;
}

export interface KuleshovCheckResult {
    score: number;          // 0-100
    emotionalEnhancement: boolean;
    suggestedAdjustment: string | null;
    reasoning: string;
}

export interface ContinuityCheckResult {
    score: number;          // 0-100
    issues: ContinuityIssue[];
    isPassing: boolean;
}

export interface ContinuityIssue {
    type: 'jump_cut' | 'screen_direction' | 'eyeline' | '180_degree' | 'prop_continuity';
    severity: 'low' | 'medium' | 'high';
    description: string;
    suggestedFix: string;
}

export interface VerificationResult {
    kuleshovScore: number;
    continuityScore: number;
    compositeScore: number;
    isPassing: boolean;
    suggestions: string[];
}

export interface AutoCutConfig {
    qualityThreshold: number;  // 0-100, default 85
    maxIterations: number;     // default 3
    minSegmentDuration: number; // seconds
    maxSegmentDuration: number; // seconds
    maxSegmentsPerClip: number; // default 6
    verifyTransitions: boolean; // run continuity checks
    useScriptMatching: boolean;
    scriptWeight: number; // 0-100 blend between visual score and script match
    embeddingModelId: string;
    criteria: {
        technicalQuality: boolean;
        contentRelevance: boolean;
        emotionalImpact: boolean;
    };
    modelId: string;
}

export const DEFAULT_AUTO_CUT_CONFIG: AutoCutConfig = {
    qualityThreshold: 85,
    maxIterations: 3,
    minSegmentDuration: 0.8,
    maxSegmentDuration: 6,
    maxSegmentsPerClip: 6,
    verifyTransitions: false,
    useScriptMatching: true,
    scriptWeight: 45,
    embeddingModelId: AUTO_CUT_EMBEDDING_MODEL,
    criteria: {
        technicalQuality: true,
        contentRelevance: true,
        emotionalImpact: true,
    },
    modelId: AUTO_CUT_MODEL_PRO,
};

// ============================================================================
// HELPERS
// ============================================================================

const getAiClient = () => {
    const envKey = process.env.API_KEY;
    const storageKey = localStorage.getItem('gemini_api_key');
    const apiKey = envKey || storageKey;

    if (!apiKey) {
        throw new Error("API Key is missing. Please enter your Google Gemini API Key in the settings.");
    }
    return new GoogleGenAI({ apiKey });
};

const withRetry = async <T>(
    apiCall: () => Promise<T>,
    maxRetries = 3,
    initialDelay = 2000
): Promise<T> => {
    let attempt = 0;
    while (true) {
        try {
            return await apiCall();
        } catch (error: any) {
            attempt++;
            if (attempt >= maxRetries) throw error;
            const delay = initialDelay * Math.pow(2, attempt - 1);
            console.warn(`Auto Cut API error. Retrying in ${delay}ms... (${attempt}/${maxRetries})`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
};

const formatTimecode = (seconds: number): string => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    const ms = Math.round((seconds % 1) * 1000);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(3, '0')}`;
};

const parseTimecode = (timecode: string): number => {
    // Supports MM:SS.mmm, MM:SS, or just seconds
    const parts = timecode.split(':');
    if (parts.length === 2) {
        const [mins, secs] = parts;
        return parseFloat(mins) * 60 + parseFloat(secs);
    }
    return parseFloat(timecode);
};

const extractJsonFromText = (text: string): string => {
    const trimmed = text.trim();
    if (trimmed.startsWith('```')) {
        const fenced = trimmed.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
        if (fenced) return fenced;
    }

    const firstObject = trimmed.indexOf('{');
    const firstArray = trimmed.indexOf('[');
    const startCandidates = [firstObject, firstArray].filter((index) => index >= 0);
    if (startCandidates.length === 0) return trimmed;

    const start = Math.min(...startCandidates);
    const lastObject = trimmed.lastIndexOf('}');
    const lastArray = trimmed.lastIndexOf(']');
    const endCandidates = [lastObject, lastArray].filter((index) => index >= 0);
    const end = Math.max(...endCandidates);

    if (end > start) {
        return trimmed.slice(start, end + 1).trim();
    }

    return trimmed;
};

const parseJsonFromText = <T>(text: string, label: string): T => {
    try {
        return JSON.parse(text.trim()) as T;
    } catch (error) {
        const extracted = extractJsonFromText(text);
        try {
            return JSON.parse(extracted) as T;
        } catch (innerError) {
            console.error(`${label} JSON parse failed. Raw:`, text);
            throw innerError;
        }
    }
};

const normalizeText = (value: string) => value.replace(/\s+/g, ' ').trim();

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const screenplayHeadingPattern = /^\s*(INT\.|EXT\.|INT\/EXT\.|EXT\/INT\.|I\/E\.)/i;

const buildScriptContextText = (context?: AutoCutContext | null): string => {
    const parts = [context?.scriptText || '', context?.storyContext || '']
        .map((entry) => normalizeText(entry))
        .filter(Boolean);

    return parts.join('\n\n').slice(0, MAX_SCRIPT_CONTEXT_CHARS);
};

const splitScriptIntoBeats = (scriptText: string): ScriptBeat[] => {
    const normalized = scriptText.replace(/\r\n/g, '\n').trim();
    if (!normalized) return [];

    const lines = normalized.split('\n');
    const scenes: Array<{ label: string; lines: string[] }> = [];
    let currentLabel = 'Context';
    let currentLines: string[] = [];

    const flushScene = () => {
        const text = normalizeText(currentLines.join(' '));
        if (!text) return;
        scenes.push({ label: currentLabel, lines: [text] });
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            if (currentLines.length > 0 && currentLines[currentLines.length - 1] !== '') {
                currentLines.push('');
            }
            continue;
        }

        if (screenplayHeadingPattern.test(line) && currentLines.length > 0) {
            flushScene();
            currentLabel = line.toUpperCase();
            currentLines = [];
            continue;
        }

        if (screenplayHeadingPattern.test(line) && currentLines.length === 0) {
            currentLabel = line.toUpperCase();
            continue;
        }

        currentLines.push(line);
    }

    flushScene();

    const blocks = scenes.length > 0
        ? scenes.flatMap((scene) => {
            const sceneText = scene.lines.join(' ').trim();
            if (sceneText.length <= MAX_SCRIPT_BEAT_CHARS) {
                return [{ label: scene.label, text: sceneText }];
            }

            const paragraphs = sceneText
                .split(/\s{2,}/)
                .map((entry) => normalizeText(entry))
                .filter(Boolean);
            const units = paragraphs.length > 1
                ? paragraphs
                : (sceneText.match(/[^.!?]+[.!?]?/g) || [sceneText])
                    .map((entry) => normalizeText(entry))
                    .filter(Boolean);

            const chunks: Array<{ label: string; text: string }> = [];
            let currentChunk = '';
            let partIndex = 1;

            const pushChunk = () => {
                const text = normalizeText(currentChunk);
                if (!text) return;
                chunks.push({
                    label: `${scene.label} (Part ${partIndex})`,
                    text,
                });
                partIndex += 1;
                currentChunk = '';
            };

            for (const unit of units) {
                const next = normalizeText(`${currentChunk} ${unit}`);
                if (next.length > MAX_SCRIPT_BEAT_CHARS && currentChunk) {
                    pushChunk();
                }
                currentChunk = normalizeText(`${currentChunk} ${unit}`);
            }

            pushChunk();
            return chunks;
        })
        : normalized
            .split(/\n\s*\n/)
            .map((entry) => normalizeText(entry))
            .filter(Boolean)
            .map((text, index) => ({ label: `Beat ${index + 1}`, text }));

    return blocks
        .slice(0, MAX_SCRIPT_BEATS)
        .map((block, index) => ({
            id: `beat-${index + 1}`,
            label: block.label || `Beat ${index + 1}`,
            text: block.text,
            excerpt: block.text.length > 220 ? `${block.text.slice(0, 217).trimEnd()}...` : block.text,
        }));
};

export const buildAutoCutScriptBeats = (
    input?: string | AutoCutContext | null,
): ScriptBeat[] => {
    const scriptText = typeof input === 'string'
        ? input.replace(/\r\n/g, '\n').trim()
        : buildScriptContextText(input);

    if (!scriptText) return [];
    return splitScriptIntoBeats(scriptText);
};

const cosineSimilarity = (a: number[], b: number[]): number => {
    if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0;

    let dot = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i];
        normA += a[i] * a[i];
        normB += b[i] * b[i];
    }

    if (!normA || !normB) return 0;
    return dot / (Math.sqrt(normA) * Math.sqrt(normB));
};

const similarityToScore = (similarity: number) => clamp(Math.round(((similarity + 1) / 2) * 100), 0, 100);

const buildSegmentSemanticText = (segment: VideoSegment) => {
    const parts = [
        segment.summary || '',
        segment.reason || '',
        segment.dialogue ? `Dialogue: ${segment.dialogue}` : '',
        segment.keywords?.length ? `Keywords: ${segment.keywords.join(', ')}` : '',
    ].map((entry) => normalizeText(entry)).filter(Boolean);

    return parts.join('\n');
};

const scriptEmbeddingCache = new Map<string, { beats: ScriptBeat[]; embeddings: number[][] }>();

const getScriptEmbeddingCacheKey = (modelId: string, scriptText: string) => {
    const compact = normalizeText(scriptText);
    return `${modelId}:${compact.length}:${compact.slice(0, 512)}`;
};

const embedTexts = async (
    texts: string[],
    modelId: string,
    taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' = 'RETRIEVAL_DOCUMENT',
): Promise<number[][]> => {
    const ai = getAiClient();
    const filtered = texts.map((entry) => normalizeText(entry)).filter(Boolean);

    if (filtered.length === 0) return [];

    const response = await withRetry(() => ai.models.embedContent({
        model: modelId,
        contents: filtered,
        config: {
            taskType,
            outputDimensionality: 768,
        },
    }));

    const embeddings = response.embeddings?.map((entry) => entry.values || []) || [];
    if (embeddings.length !== filtered.length) {
        throw new Error(`Embedding response size mismatch for model ${modelId}.`);
    }

    recordUsage({
        provider: 'gemini',
        model: modelId,
        kind: 'analysis',
        units: filtered.length,
        unitLabel: 'request',
        note: `Auto Cut ${taskType.toLowerCase()} embedding batch`,
    });

    return embeddings;
};

const getScriptBeatsAndEmbeddings = async (
    scriptText: string,
    modelId: string,
): Promise<{ beats: ScriptBeat[]; embeddings: number[][] }> => {
    const beats = splitScriptIntoBeats(scriptText);
    if (beats.length === 0) {
        return { beats: [], embeddings: [] };
    }

    const cacheKey = getScriptEmbeddingCacheKey(modelId, scriptText);
    const cached = scriptEmbeddingCache.get(cacheKey);
    if (cached) return cached;

    const embeddings = await embedTexts(
        beats.map((beat) => `${beat.label}\n${beat.text}`),
        modelId,
        'RETRIEVAL_QUERY',
    );

    const payload = { beats, embeddings };
    scriptEmbeddingCache.set(cacheKey, payload);
    return payload;
};

const applyScriptMatchingToSegments = async (
    segments: VideoSegment[],
    context: AutoCutContext,
    config: AutoCutConfig,
    onProgress?: (message: string) => void,
): Promise<{ segments: VideoSegment[]; notes: string[] }> => {
    const scriptText = buildScriptContextText(context);
    if (!config.useScriptMatching || !scriptText) {
        return { segments, notes: [] };
    }

    const segmentTexts = segments.map((segment) => buildSegmentSemanticText(segment));
    if (segmentTexts.every((text) => !text)) {
        return { segments, notes: ['Script matching skipped because no segment semantic text was available.'] };
    }

    onProgress?.('Ranking segments against script beats with Gemini embeddings...');

    const { beats, embeddings: beatEmbeddings } = await getScriptBeatsAndEmbeddings(
        scriptText,
        config.embeddingModelId,
    );

    if (beats.length === 0 || beatEmbeddings.length === 0) {
        return { segments, notes: ['Script matching skipped because no script beats could be derived.'] };
    }

    const segmentEmbeddings = await embedTexts(segmentTexts, config.embeddingModelId, 'RETRIEVAL_DOCUMENT');
    const scriptWeight = clamp(config.scriptWeight, 0, 100) / 100;

    const enrichedSegments = segments.map((segment, index) => {
        const embedding = segmentEmbeddings[index] || [];
        let bestIndex = -1;
        let bestSimilarity = -1;

        beatEmbeddings.forEach((beatEmbedding, beatIndex) => {
            const similarity = cosineSimilarity(embedding, beatEmbedding);
            if (similarity > bestSimilarity) {
                bestSimilarity = similarity;
                bestIndex = beatIndex;
            }
        });

        const matchedBeat = bestIndex >= 0 ? beats[bestIndex] : null;
        const semanticScore = bestIndex >= 0 ? similarityToScore(bestSimilarity) : null;
        const baseScore = segment.baseScore ?? segment.score;
        const blendedScore = semanticScore === null
            ? baseScore
            : Math.round((baseScore * (1 - scriptWeight)) + (semanticScore * scriptWeight));

        return {
            ...segment,
            baseScore,
            semanticScore,
            score: blendedScore,
            scriptMatch: matchedBeat
                ? {
                    beatId: matchedBeat.id,
                    beatLabel: matchedBeat.label,
                    excerpt: matchedBeat.excerpt,
                    similarity: semanticScore || 0,
                }
                : null,
        };
    });

    const matchedCount = enrichedSegments.filter((segment) => segment.scriptMatch).length;
    return {
        segments: enrichedSegments,
        notes: [`Matched ${matchedCount}/${enrichedSegments.length} segments against ${beats.length} script beats.`],
    };
};

// ============================================================================
// PHASE 1: SEGMENT ANALYSIS
// ============================================================================

export const analyzeVideoForSegments = async (
    videoFileUri: string,
    mimeType: string,
    config: AutoCutConfig = DEFAULT_AUTO_CUT_CONFIG,
    context?: AutoCutContext,
    onProgress?: (message: string) => void
): Promise<SegmentAnalysisResult> => {
    const ai = getAiClient();

    onProgress?.("Analyzing video for usable segments...");
    const safeMimeType = mimeType === 'application/octet-stream' ? 'video/mp4' : mimeType;

    const criteriaText = [
        config.criteria.technicalQuality ? "Technical Quality (focus, exposure, stability)" : null,
        config.criteria.contentRelevance ? "Content Relevance (action, subject visibility)" : null,
        config.criteria.emotionalImpact ? "Emotional Impact (reactions, tension, climax)" : null,
    ].filter(Boolean).join(", ");
    const scriptContext = buildScriptContextText(context);

    const prompt = `You are an expert film editor and cinematic critic. Your task is to analyze this raw footage and identify the best segments for a high-quality video edit.

**Your Goal:** Find segments that have strong visual interest, clear action, or emotional resonance. Ignore dead air, bad camera work, or boring sections.

**Evaluation Criteria:**
${criteriaText}

**Instructions:**
1. **Scan the video** to understand the overall context and action.
2. **Identify precise start and end points** for each usable segment.
   - Start: When the action begins or the subject enters the frame.
   - End: When the action completes or the subject leaves/stops.
   - Avoid cutting in the middle of a sentence or movement.
   - Keep segments between ${config.minSegmentDuration}s and ${config.maxSegmentDuration}s.
3. **Rate each segment** (0-100) based on the criteria above.
4. **Provide a reason** for your selection (e.g., "Good establishing shot", "Clear reaction", "Action sequence").
5. **Summarize the segment** with a concise visual description, any audible dialogue, and 3-6 semantic keywords.
6. ${scriptContext
            ? `Use this script/story context to describe how each segment could fit the intended edit. Do not force a match, but prefer segments that clearly align with the script beats.\n\n**Script Context:**\n${scriptContext}`
            : 'If no script context is provided, focus purely on footage quality and editorial usefulness.'}

**Output Format:**
Return a PURE JSON object (no markdown, no extra text) with this structure:
{
    "segments": [
        {
            "id": "unique_id_1",
            "startTime": "MM:SS.mmm",
            "endTime": "MM:SS.mmm",
            "score": 85,
            "reason": "Clear action with good lighting",
            "summary": "The subject enters frame, looks left, and sits down.",
            "dialogue": "We need to move now.",
            "keywords": ["arrival", "decision", "medium shot"],
            "technicalQuality": { "focus": 90, "exposure": 85, "stability": 80 },
            "contentRelevance": 90,
            "emotionalImpact": 75
        }
    ],
    "totalDuration": 120.5,
    "analysisNotes": "Brief summary of the video content and quality."
}`;

    const buildVideoPart = () => {
        if (videoFileUri.startsWith('data:')) {
            const base64 = videoFileUri.split(',')[1] || '';
            return { inlineData: { data: base64, mimeType: safeMimeType } };
        }

        if (!videoFileUri.startsWith('http') && !videoFileUri.startsWith('https') && !videoFileUri.startsWith('file:')) {
            return { inlineData: { data: videoFileUri, mimeType: safeMimeType } };
        }

        return { fileData: { fileUri: videoFileUri, mimeType: safeMimeType } };
    };

    const result: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: config.modelId,
        contents: {
            parts: [
                { text: prompt },
                buildVideoPart()
            ]
        },
        config: {
            responseMimeType: "application/json",
            responseSchema: {
                type: Type.OBJECT,
                properties: {
                    segments: {
                        type: Type.ARRAY,
                        items: {
                            type: Type.OBJECT,
                            properties: {
                                id: { type: Type.STRING },
                                startTime: { type: Type.STRING },
                                endTime: { type: Type.STRING },
                                score: { type: Type.NUMBER },
                                reason: { type: Type.STRING },
                                summary: { type: Type.STRING },
                                dialogue: { type: Type.STRING },
                                keywords: {
                                    type: Type.ARRAY,
                                    items: { type: Type.STRING },
                                },
                                technicalQuality: {
                                    type: Type.OBJECT,
                                    properties: {
                                        focus: { type: Type.NUMBER },
                                        exposure: { type: Type.NUMBER },
                                        stability: { type: Type.NUMBER },
                                    },
                                },
                                contentRelevance: { type: Type.NUMBER },
                                emotionalImpact: { type: Type.NUMBER },
                            },
                        },
                    },
                    totalDuration: { type: Type.NUMBER },
                    analysisNotes: { type: Type.STRING },
                },
            },
        },
    }));

    const parsed = parseJsonFromText<{
        segments: Array<{
            id: string;
            startTime: string;
            endTime: string;
            score: number;
            reason: string;
            summary?: string;
            dialogue?: string;
            keywords?: string[];
            technicalQuality: { focus: number; exposure: number; stability: number };
            contentRelevance: number;
            emotionalImpact: number;
        }>;
        totalDuration: number;
        analysisNotes: string;
    }>(result.text, 'AutoCutSegmentAnalysis');

    // Convert timecodes to seconds
    let segments: VideoSegment[] = parsed.segments.map(seg => ({
        ...seg,
        baseScore: seg.score,
        summary: normalizeText(seg.summary || ''),
        dialogue: normalizeText(seg.dialogue || ''),
        keywords: Array.isArray(seg.keywords)
            ? seg.keywords.map((entry) => normalizeText(String(entry))).filter(Boolean)
            : [],
        startTime: parseTimecode(seg.startTime),
        endTime: parseTimecode(seg.endTime),
    })).filter(seg => {
        const duration = seg.endTime - seg.startTime;
        return duration >= config.minSegmentDuration && duration <= config.maxSegmentDuration;
    });

    const analysisNotes = [parsed.analysisNotes];

    if (config.useScriptMatching && scriptContext && segments.length > 0) {
        try {
            const matched = await applyScriptMatchingToSegments(segments, context || {}, config, onProgress);
            segments = matched.segments;
            analysisNotes.push(...matched.notes);
        } catch (error) {
            console.warn('Script-aware segment matching failed. Falling back to visual-only ranking.', error);
            analysisNotes.push('Script-aware ranking was unavailable, so Auto Cut fell back to visual-only scoring.');
        }
    }

    recordUsage({
        provider: 'gemini',
        model: config.modelId,
        kind: 'analysis',
        units: 1,
        unitLabel: 'request',
        note: 'Auto Cut segment analysis',
    });

    onProgress?.(`Found ${segments.length} usable segments`);

    return {
        segments,
        totalDuration: parsed.totalDuration,
        analysisNotes: analysisNotes.filter(Boolean).join(' '),
    };
};

export const analyzeVideoSourceForSegments = async (
    video: File | string,
    config: AutoCutConfig = DEFAULT_AUTO_CUT_CONFIG,
    context?: AutoCutContext,
    onProgress?: (message: string) => void
): Promise<SegmentAnalysisResult> => {
    onProgress?.('Uploading video to Gemini for analysis...');
    const { fileUri, mimeType } = await prepareVideoFileDataForGemini(video);
    return analyzeVideoForSegments(fileUri, mimeType, config, context, onProgress);
};

// ============================================================================
// PHASE 3: QUALITY VERIFICATION
// ============================================================================

export const verifyKuleshovEffect = async (
    clipALastFrame: { base64: string; mimeType: string },
    clipBFirstFrame: { base64: string; mimeType: string },
    context?: string,
    modelId: string = AUTO_CUT_MODEL_PRO
): Promise<KuleshovCheckResult> => {
    const ai = getAiClient();

    const prompt = `You are a film theory expert and editor specializing in the Kuleshov Effect.

**Task:** Analyze the cut between Shot A (outgoing) and Shot B (incoming) to determine if it creates a meaningful or emotional connection.

**Context:** ${context || 'No specific context provided.'}

**Analyze:**
1. **Meaning:** Does the juxtaposition create a new meaning not present in either shot alone? (e.g., Man + Soup = Hunger)
2. **Flo w:** Is there a visual connection (match cut, color, shape)?
3. **Emotion:** Does the cut heighten the emotional impact?

**Output:**
Return PURE JSON:
{
    "score": 0-100,
    "emotionalEnhancement": true/false,
    "suggestedAdjustment": "Optional suggestion to improve the cut (e.g. 'Trim 5 frames from A')",
    "reasoning": "Explanation of the effect created by this cut."
}`;

    const result: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: modelId,
        contents: {
            parts: [
                { text: prompt },
                { text: "Frame A (outgoing clip):" },
                { inlineData: { data: clipALastFrame.base64, mimeType: clipALastFrame.mimeType } },
                { text: "Frame B (incoming clip):" },
                { inlineData: { data: clipBFirstFrame.base64, mimeType: clipBFirstFrame.mimeType } },
            ]
        },
        config: {
            responseMimeType: "application/json",
        },
    }));

    recordUsage({
        provider: 'gemini',
        model: modelId,
        kind: 'analysis',
        units: 1,
        unitLabel: 'request',
        note: 'Kuleshov effect verification',
    });

    return parseJsonFromText<KuleshovCheckResult>(result.text, 'KuleshovVerification');
};

export const verifyContinuity = async (
    clipALastFrame: { base64: string; mimeType: string },
    clipBFirstFrame: { base64: string; mimeType: string },
    modelId: string = AUTO_CUT_MODEL_PRO
): Promise<ContinuityCheckResult> => {
    const ai = getAiClient();

    const prompt = `You are a professional continuity supervisor (script supervisor).

**Analyze the transition between these two frames for continuity errors:**

1. **Jump Cut Detection:** Is the camera angle/position change less than 30 degrees? (Bad = jump cut)
2. **Screen Direction:** Do subjects maintain consistent left-right orientation?
3. **Eyeline Match:** Do eyelines connect logically between shots?
4. **180-Degree Rule:** Does the cut cross the axis of action?
5. **Prop Continuity:** Are objects in the same position/state?

Return JSON:
{
    "score": 75,
    "issues": [
        {
            "type": "jump_cut",
            "severity": "medium",
            "description": "Camera angle change is only ~15 degrees",
            "suggestedFix": "Use a cutaway or add more angle difference"
        }
    ],
    "isPassing": false
}`;

    const result: GenerateContentResponse = await withRetry(() => ai.models.generateContent({
        model: modelId,
        contents: {
            parts: [
                { text: prompt },
                { text: "Frame A (outgoing):" },
                { inlineData: { data: clipALastFrame.base64, mimeType: clipALastFrame.mimeType } },
                { text: "Frame B (incoming):" },
                { inlineData: { data: clipBFirstFrame.base64, mimeType: clipBFirstFrame.mimeType } },
            ]
        },
        config: {
            responseMimeType: "application/json",
        },
    }));

    recordUsage({
        provider: 'gemini',
        model: modelId,
        kind: 'analysis',
        units: 1,
        unitLabel: 'request',
        note: 'Continuity verification',
    });

    return parseJsonFromText<ContinuityCheckResult>(result.text, 'ContinuityVerification');
};

export const calculateCompositeScore = (
    kuleshovResult: KuleshovCheckResult,
    continuityResult: ContinuityCheckResult,
    weights = { kuleshov: 0.4, continuity: 0.6 }
): VerificationResult => {
    const compositeScore = Math.round(
        kuleshovResult.score * weights.kuleshov +
        continuityResult.score * weights.continuity
    );

    const suggestions: string[] = [];

    if (kuleshovResult.suggestedAdjustment) {
        suggestions.push(`Kuleshov: ${kuleshovResult.suggestedAdjustment}`);
    }

    continuityResult.issues.forEach(issue => {
        suggestions.push(`${issue.type}: ${issue.suggestedFix}`);
    });

    return {
        kuleshovScore: kuleshovResult.score,
        continuityScore: continuityResult.score,
        compositeScore,
        isPassing: compositeScore >= 85 && continuityResult.isPassing,
        suggestions,
    };
};

// ============================================================================
// FULL PIPELINE
// ============================================================================

export interface AutoCutPipelineResult {
    segments: VideoSegment[];
    verificationResults: Map<string, VerificationResult>;
    finalScore: number;
    iterations: number;
    status: 'accepted' | 'needs_review' | 'rejected';
}

export const selectTopSegments = (
    segments: VideoSegment[],
    config: AutoCutConfig = DEFAULT_AUTO_CUT_CONFIG
): VideoSegment[] => {
    if (segments.length === 0) return [];

    const sortedByScore = [...segments].sort((a, b) => b.score - a.score);
    const selected: VideoSegment[] = [];

    for (const seg of sortedByScore) {
        if (selected.length >= config.maxSegmentsPerClip) break;
        const overlaps = selected.some(s => !(seg.endTime <= s.startTime || seg.startTime >= s.endTime));
        if (!overlaps) selected.push(seg);
    }

    return selected.sort((a, b) => a.startTime - b.startTime);
};

export const verifySegmentTransitions = async (
    segments: VideoSegment[],
    videoUrl: string,
    extractFrame: (videoUrl: string, time: number) => Promise<{ base64: string; mimeType: string }>,
    modelId: string,
    onProgress?: (message: string) => void
): Promise<{ verificationResults: Map<string, VerificationResult>; avgScore: number }> => {
    const verificationResults = new Map<string, VerificationResult>();
    if (segments.length < 2) {
        return { verificationResults, avgScore: 100 };
    }

    for (let i = 0; i < segments.length - 1; i++) {
        const segA = segments[i];
        const segB = segments[i + 1];
        onProgress?.(`Verifying transition ${i + 1}/${segments.length - 1}...`);
        const frameA = await extractFrame(videoUrl, Math.max(segA.endTime - 0.1, segA.startTime));
        const frameB = await extractFrame(videoUrl, segB.startTime);
        const kuleshovResult = await verifyKuleshovEffect(frameA, frameB, undefined, modelId);
        const continuityResult = await verifyContinuity(frameA, frameB, modelId);
        const verification = calculateCompositeScore(kuleshovResult, continuityResult);
        verificationResults.set(`${segA.id}->${segB.id}`, verification);
    }

    const verificationScores = Array.from(verificationResults.values()).map(v => v.compositeScore);
    const avgScore = verificationScores.length > 0
        ? verificationScores.reduce((a, b) => a + b, 0) / verificationScores.length
        : 100;

    return { verificationResults, avgScore };
};

export const runAutoCutPipeline = async (
    videoFileUri: string,
    mimeType: string,
    config: AutoCutConfig = DEFAULT_AUTO_CUT_CONFIG,
    extractFrame: (videoUrl: string, time: number) => Promise<{ base64: string; mimeType: string }>,
    context?: AutoCutContext,
    onProgress?: (message: string) => void
): Promise<AutoCutPipelineResult> => {
    // Phase 1: Analyze
    onProgress?.("Phase 1: Analyzing video for segments...");
    const analysis = await analyzeVideoForSegments(videoFileUri, mimeType, config, context, onProgress);

    if (analysis.segments.length === 0) {
        return {
            segments: [],
            verificationResults: new Map(),
            finalScore: 0,
            iterations: 0,
            status: 'rejected',
        };
    }

    // Phase 3: Verify transitions (if multiple segments)
    const verificationResults = new Map<string, VerificationResult>();

    if (config.verifyTransitions && analysis.segments.length > 1) {
        onProgress?.("Phase 3: Verifying cut quality...");

        for (let i = 0; i < analysis.segments.length - 1; i++) {
            const segA = analysis.segments[i];
            const segB = analysis.segments[i + 1];

            onProgress?.(`Checking transition ${i + 1}/${analysis.segments.length - 1}...`);

            // Extract frames at cut points
            const frameA = await extractFrame(videoFileUri, segA.endTime - 0.1);
            const frameB = await extractFrame(videoFileUri, segB.startTime);

            const kuleshovResult = await verifyKuleshovEffect(frameA, frameB, undefined, config.modelId);
            const continuityResult = await verifyContinuity(frameA, frameB, config.modelId);

            const verification = calculateCompositeScore(kuleshovResult, continuityResult);
            verificationResults.set(`${segA.id}->${segB.id}`, verification);
        }
    }

    // Calculate final score
    const segmentScores = analysis.segments.map(s => s.score);
    const verificationScores = Array.from(verificationResults.values()).map(v => v.compositeScore);

    const avgSegmentScore = segmentScores.reduce((a, b) => a + b, 0) / segmentScores.length;
    const avgVerificationScore = verificationScores.length > 0
        ? verificationScores.reduce((a, b) => a + b, 0) / verificationScores.length
        : 100;

    const finalScore = Math.round((avgSegmentScore * 0.6) + (avgVerificationScore * 0.4));

    const status = finalScore >= config.qualityThreshold
        ? 'accepted'
        : finalScore >= config.qualityThreshold - 15
            ? 'needs_review'
            : 'rejected';

    onProgress?.(`Analysis complete. Final score: ${finalScore}/100 (${status})`);

    return {
        segments: analysis.segments,
        verificationResults,
        finalScore,
        iterations: 1,
        status,
    };
};

export const runAutoCutSourcePipeline = async (
    video: File | string,
    extractFrame: (videoUrl: string, time: number) => Promise<{ base64: string; mimeType: string }>,
    config: AutoCutConfig = DEFAULT_AUTO_CUT_CONFIG,
    context?: AutoCutContext,
    onProgress?: (message: string) => void
): Promise<AutoCutPipelineResult> => {
    onProgress?.('Uploading video to Gemini for analysis...');
    const { fileUri, mimeType } = await prepareVideoFileDataForGemini(video);
    return runAutoCutPipeline(fileUri, mimeType, config, extractFrame, context, onProgress);
};
