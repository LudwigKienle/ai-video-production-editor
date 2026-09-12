import React, { useState, useCallback } from 'react';
import {
    runAutoCutSourcePipeline,
    VideoSegment,
    AutoCutConfig,
    DEFAULT_AUTO_CUT_CONFIG,
    VerificationResult,
    analyzeVideoSourceForSegments,
    selectTopSegments,
    verifySegmentTransitions,
    ScriptBeat,
    buildAutoCutScriptBeats,
} from '../services/autoCutService';
import { buildCleanSpeechSegments, detectSceneSegments, detectSpeechSegments, extractAudioAsWav, type LocalAnalysis } from '../utils/autoCutLocal';
import { transcribeAudioWithWordTimings } from '../services/geminiService';
import { trackTask } from '../services/taskCenter';
import { TimelineClip, MediaItem, TimelineTrack } from '../types';
import { getRegisteredMediaFile } from '../services/mediaSourceService';
import { parseScriptDocument } from '../services/documentParsingService';
import { ScissorsIcon } from './icons';

const AUTO_CUT_MODEL_PRO = 'gemini-3.1-pro-preview';
const AUTO_CUT_MODEL_FLASH = 'gemini-3.1-flash-preview';

interface AutoCutPanelProps {
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    mediaItems: MediaItem[];
    selectedClipId: string | null;
    scriptText?: string | null;
    storyContext?: string | null;
    onUpdateClip: (updatedClip: TimelineClip) => void;
    onAddMediaItems: (items: MediaItem[]) => void;
    onAddClips: (clips: TimelineClip[]) => void;
    onSplitClipWithSegments: (clipId: string, segments: VideoSegment[]) => void;
}

type PipelineStatus = 'idle' | 'analyzing' | 'verifying' | 'complete' | 'error';

type TimelineSegmentGroup = {
    clipId: string;
    trackId: string;
    mediaId: string;
    clipLabel: string;
    mediaName: string;
    mediaUrl: string;
    segments: VideoSegment[];
};

type MediaPoolSegmentGroup = {
    mediaId: string;
    mediaName: string;
    mediaUrl: string;
    segments: VideoSegment[];
};

type ScriptSourceMode = 'project' | 'custom';

type SceneDailiesCandidate = {
    key: string;
    mediaId: string;
    mediaName: string;
    startTime: number;
    endTime: number;
    score: number;
    similarity: number | null;
    reason: string;
    summary: string;
    selected: boolean;
};

type SceneDailiesEntry = {
    beatId: string;
    beatLabel: string;
    excerpt: string;
    candidateCount: number;
    selectedCount: number;
    topCandidate: SceneDailiesCandidate | null;
    candidates: SceneDailiesCandidate[];
};

const AutoCutPanel: React.FC<AutoCutPanelProps> = ({
    timelineClips,
    timelineTracks,
    mediaItems,
    selectedClipId,
    scriptText,
    storyContext,
    onUpdateClip,
    onAddMediaItems,
    onAddClips,
    onSplitClipWithSegments,
}) => {
    const [status, setStatus] = useState<PipelineStatus>('idle');
    const [progress, setProgress] = useState<string>('');
    const [segments, setSegments] = useState<VideoSegment[]>([]);
    const [selectedSegments, setSelectedSegments] = useState<Set<string>>(new Set());
    const [finalScore, setFinalScore] = useState<number>(0);
    const [verificationResults, setVerificationResults] = useState<Map<string, VerificationResult>>(new Map());
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<AutoCutConfig>(DEFAULT_AUTO_CUT_CONFIG);
    const [localMode, setLocalMode] = useState<'silence' | 'scenes' | 'filler'>('silence');
    const [localBusy, setLocalBusy] = useState<string | null>(null);
    const [localResult, setLocalResult] = useState<LocalAnalysis | null>(null);
    const [localSettings, setLocalSettings] = useState({ margin: 0.2, minCut: 0.35, minClip: 0.25, threshold: 12, sceneSensitivity: 3, minScene: 1, removePauses: 1.2 });
    const [selectedClipForAnalysis, setSelectedClipForAnalysis] = useState<string | null>(null);
    const [customModelId, setCustomModelId] = useState<string>('');
    const [analysisScope, setAnalysisScope] = useState<'clip' | 'timeline' | 'pool' | null>(null);
    const [scope, setScope] = useState<'clip' | 'timeline' | 'pool'>(selectedClipId ? 'clip' : 'pool');
    const [timelineGroups, setTimelineGroups] = useState<TimelineSegmentGroup[]>([]);
    const [timelineSelected, setTimelineSelected] = useState<Set<string>>(new Set());
    const [timelineScore, setTimelineScore] = useState<number>(0);
    const [mediaPoolGroups, setMediaPoolGroups] = useState<MediaPoolSegmentGroup[]>([]);
    const [mediaPoolSelected, setMediaPoolSelected] = useState<Set<string>>(new Set());
    const [mediaPoolScore, setMediaPoolScore] = useState<number>(0);
    const [unusedOnlyInPool, setUnusedOnlyInPool] = useState<boolean>(true);
    const [scriptSourceMode, setScriptSourceMode] = useState<ScriptSourceMode>(() => (
        (scriptText || '').trim() ? 'project' : 'custom'
    ));
    const [customScriptText, setCustomScriptText] = useState<string>('');
    const [customScriptName, setCustomScriptName] = useState<string>('');
    const [scriptImportError, setScriptImportError] = useState<string | null>(null);
    const [isParsingScript, setIsParsingScript] = useState<boolean>(false);
    const usedMediaIds = new Set(timelineClips.map((clip) => clip.mediaId));
    const hasProjectScript = Boolean((scriptText || '').trim());
    const activeScriptMode: ScriptSourceMode = scriptSourceMode === 'project' && hasProjectScript
        ? 'project'
        : 'custom';
    const activeScriptText = activeScriptMode === 'custom'
        ? customScriptText.trim()
        : (scriptText || '').trim();
    const hasStoryContext = Boolean((storyContext || '').trim());
    const hasScriptGuidance = Boolean(activeScriptText || hasStoryContext);
    const scriptBeats = activeScriptText ? buildAutoCutScriptBeats(activeScriptText) : [];
    const activeScriptSummary = activeScriptMode === 'project'
        ? 'Using Project workspace script'
        : customScriptName
            ? `Custom script: ${customScriptName}`
            : activeScriptText
                ? 'Using pasted custom script'
                : 'No custom script loaded';

    // Get video clips from timeline
    const videoClips = timelineClips.filter(clip => {
        const media = mediaItems.find(m => m.id === clip.mediaId);
        return media?.type === 'video';
    });
    const mediaPoolVideos = mediaItems.filter((item) => item.type === 'video');
    const mediaPoolCandidates = mediaPoolVideos.filter((item) => !unusedOnlyInPool || !usedMediaIds.has(item.id));

    const selectedClip = selectedClipForAnalysis
        ? timelineClips.find(c => c.id === selectedClipForAnalysis)
        : selectedClipId
            ? timelineClips.find(c => c.id === selectedClipId)
            : null;

    const selectedMedia = selectedClip
        ? mediaItems.find(m => m.id === selectedClip.mediaId)
        : null;

    const modelChoice = config.modelId === AUTO_CUT_MODEL_PRO || config.modelId === 'gemini-2.5-pro'
        ? 'pro'
        : config.modelId === AUTO_CUT_MODEL_FLASH || config.modelId === 'gemini-2.5-flash'
            ? 'flash'
            : 'custom';

    const formatTime = (seconds: number): string => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const ms = Math.round((seconds % 1) * 100);
        return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
    };

    const buildTimelineKey = (clipId: string, segmentId: string) => `${clipId}::${segmentId}`;
    const buildMediaPoolKey = (mediaId: string, segmentId: string) => `${mediaId}::${segmentId}`;
    const resolveVideoAnalysisSource = (media: MediaItem) => {
        if (media.sourceUrl && media.url && media.url !== media.sourceUrl) {
            return media.url;
        }
        return getRegisteredMediaFile(media.id) || media.url;
    };
    const getBeatOrderFromId = (beatId?: string | null) => {
        const match = beatId?.match(/beat-(\d+)/i);
        return match ? parseInt(match[1], 10) : Number.MAX_SAFE_INTEGER;
    };

    const getScriptBeatOrder = (segment: VideoSegment) => {
        return getBeatOrderFromId(segment.scriptMatch?.beatId);
    };

    const buildSceneDailies = (
        groups: MediaPoolSegmentGroup[],
        selectedKeys: Set<string>,
        beats: ScriptBeat[],
    ): SceneDailiesEntry[] => {
        const entries = new Map<string, SceneDailiesEntry>();

        beats.forEach((beat) => {
            entries.set(beat.id, {
                beatId: beat.id,
                beatLabel: beat.label,
                excerpt: beat.excerpt,
                candidateCount: 0,
                selectedCount: 0,
                topCandidate: null,
                candidates: [],
            });
        });

        groups.forEach((group) => {
            group.segments.forEach((segment) => {
                if (!segment.scriptMatch) return;

                const beatId = segment.scriptMatch.beatId;
                const key = buildMediaPoolKey(group.mediaId, segment.id);
                const candidate: SceneDailiesCandidate = {
                    key,
                    mediaId: group.mediaId,
                    mediaName: group.mediaName,
                    startTime: segment.startTime,
                    endTime: segment.endTime,
                    score: segment.score,
                    similarity: segment.scriptMatch.similarity ?? segment.semanticScore ?? null,
                    reason: segment.reason,
                    summary: segment.summary || segment.reason,
                    selected: selectedKeys.has(key),
                };

                const entry = entries.get(beatId) || {
                    beatId,
                    beatLabel: segment.scriptMatch.beatLabel,
                    excerpt: segment.scriptMatch.excerpt,
                    candidateCount: 0,
                    selectedCount: 0,
                    topCandidate: null,
                    candidates: [],
                };

                entry.candidates.push(candidate);
                entry.candidateCount += 1;
                if (candidate.selected) {
                    entry.selectedCount += 1;
                }
                if (!entry.topCandidate || candidate.score > entry.topCandidate.score) {
                    entry.topCandidate = candidate;
                }

                entries.set(beatId, entry);
            });
        });

        return Array.from(entries.values())
            .map((entry) => ({
                ...entry,
                candidates: [...entry.candidates]
                    .sort((a, b) => {
                        if (b.score !== a.score) return b.score - a.score;
                        return a.startTime - b.startTime;
                    })
                    .slice(0, 3),
            }))
            .sort((a, b) => getBeatOrderFromId(a.beatId) - getBeatOrderFromId(b.beatId));
    };

    const suggestMediaPoolSelections = (groups: MediaPoolSegmentGroup[]) => {
        const allSegments = groups.flatMap(group =>
            group.segments.map(seg => ({
                group,
                seg,
                key: buildMediaPoolKey(group.mediaId, seg.id),
            }))
        );

        if (allSegments.length === 0) return new Set<string>();

        const maxSelections = Math.min(12, Math.max(6, groups.length));
        const selected = new Set<string>();

        const withScriptMatches = allSegments.filter(entry => entry.seg.scriptMatch);
        if (withScriptMatches.length > 0) {
            const byBeat = new Map<string, typeof withScriptMatches>();
            withScriptMatches.forEach((entry) => {
                const beatId = entry.seg.scriptMatch?.beatId || 'unmatched';
                const existing = byBeat.get(beatId) || [];
                existing.push(entry);
                byBeat.set(beatId, existing);
            });

            Array.from(byBeat.entries())
                .sort((a, b) => {
                    const beatA = getScriptBeatOrder(a[1][0].seg);
                    const beatB = getScriptBeatOrder(b[1][0].seg);
                    return beatA - beatB;
                })
                .forEach(([, entries]) => {
                    const best = [...entries].sort((a, b) => b.seg.score - a.seg.score)[0];
                    if (best && selected.size < maxSelections) {
                        selected.add(best.key);
                    }
                });
        }

        [...allSegments]
            .sort((a, b) => {
                const beatA = getScriptBeatOrder(a.seg);
                const beatB = getScriptBeatOrder(b.seg);
                if (beatA !== beatB) return beatA - beatB;
                return b.seg.score - a.seg.score;
            })
            .forEach((entry) => {
                if (selected.size >= maxSelections) return;
                selected.add(entry.key);
            });

        return selected;
    };

    const sceneDailies = buildSceneDailies(mediaPoolGroups, mediaPoolSelected, scriptBeats);
    const coveredSceneCount = sceneDailies.filter((entry) => entry.candidateCount > 0).length;

    const extractFrame = useCallback(async (videoUrl: string, time: number) => {
        const video = document.createElement('video');
        video.src = videoUrl;
        video.currentTime = time;
        video.crossOrigin = 'anonymous';

        await new Promise<void>((resolve, reject) => {
            video.onseeked = () => resolve();
            video.onerror = () => reject(new Error('Failed to load video'));
            video.load();
        });

        const canvas = document.createElement('canvas');
        canvas.width = video.videoWidth || 640;
        canvas.height = video.videoHeight || 360;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(video, 0, 0);

        const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        const base64 = dataUrl.split(',')[1];

        return { base64, mimeType: 'image/jpeg' };
    }, []);

    const autoCutContext = {
        scriptText: activeScriptText || undefined,
        storyContext,
    };

    const handleCustomScriptUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;

        setScriptImportError(null);
        setIsParsingScript(true);

        try {
            const parsedScript = await parseScriptDocument(file);
            setCustomScriptText(parsedScript);
            setCustomScriptName(file.name);
            setScriptSourceMode('custom');
        } catch (err: any) {
            setScriptImportError(err?.message || 'Failed to import script');
        } finally {
            setIsParsingScript(false);
        }
    };

    const handleSelectBestPerScene = () => {
        if (mediaPoolGroups.length === 0) return;

        const selectedByBeat = new Set<string>();
        sceneDailies.forEach((entry) => {
            if (entry.topCandidate) {
                selectedByBeat.add(entry.topCandidate.key);
            }
        });

        setMediaPoolSelected(selectedByBeat);
    };

    const runLocalDetection = async () => {
        if (!selectedMedia?.url || !selectedClip) {
            setError('Select a video clip on the timeline first.');
            return;
        }
        setError(null);
        setLocalResult(null);
        const label = localMode === 'silence' ? 'Silence removal' : localMode === 'scenes' ? 'Scene detection' : 'Filler-word removal';
        setLocalBusy(`${label}…`);
        try {
            const analysis = await trackTask({ label, kind: 'analysis', provider: 'local', estimatedMs: 20_000 }, async (task) => {
                if (localMode === 'silence') {
                    return detectSpeechSegments(selectedMedia.url, {
                        marginSeconds: localSettings.margin,
                        minCutSeconds: localSettings.minCut,
                        minClipSeconds: localSettings.minClip,
                        thresholdAboveFloorDb: localSettings.threshold,
                    });
                }
                if (localMode === 'scenes') {
                    return detectSceneSegments(selectedMedia.url, {
                        adaptiveThreshold: localSettings.sceneSensitivity,
                        minSceneSeconds: localSettings.minScene,
                    }, (fraction) => task.update({ progress: fraction, message: `Scanning frames ${Math.round(fraction * 100)}%` }));
                }
                task.update({ message: 'Extracting audio…' });
                const wav = await extractAudioAsWav(selectedMedia.url);
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
                    reader.onerror = () => reject(new Error('Could not read audio.'));
                    reader.readAsDataURL(wav);
                });
                task.update({ message: 'Transcribing with word timings…' });
                const { words } = await transcribeAudioWithWordTimings({ base64, mimeType: 'audio/wav' });
                const duration = selectedMedia.duration || Math.max(...words.map((w) => w.end), 0);
                return buildCleanSpeechSegments(words, duration, { maxPauseSeconds: localSettings.removePauses });
            });
            setLocalResult(analysis);
        } catch (err: any) {
            setError(err?.message || 'Local detection failed.');
        } finally {
            setLocalBusy(null);
        }
    };

    const applyLocalResult = () => {
        if (!selectedClip || !localResult || localResult.segments.length === 0) return;
        const sourceIn = selectedClip.sourceIn ?? 0;
        const sourceOut = selectedClip.sourceOut ?? (sourceIn + (selectedClip.end - selectedClip.start));
        const segments: VideoSegment[] = localResult.segments
            .map((segment, index) => ({
                id: `local-${localMode}-${index}`,
                startTime: Math.max(sourceIn, segment.start),
                endTime: Math.min(sourceOut, segment.end),
                score: segment.score,
                reason: segment.reason,
                technicalQuality: { focus: 80, exposure: 80, stability: 80 },
                contentRelevance: segment.score,
                emotionalImpact: 50,
            }))
            .filter((segment) => segment.endTime - segment.startTime > 0.1);
        if (segments.length === 0) return;
        onSplitClipWithSegments(selectedClip.id, segments);
        setLocalResult(null);
    };

    const handleAnalyze = async () => {
        if (!selectedMedia?.url) {
            setError('Please select a video clip from the timeline first');
            return;
        }

        setStatus('analyzing');
        setAnalysisScope('clip');
        setError(null);
        setSegments([]);
        setSelectedSegments(new Set());
        setTimelineGroups([]);
        setTimelineSelected(new Set());
        setMediaPoolGroups([]);
        setMediaPoolSelected(new Set());
        setMediaPoolScore(0);

        try {
            const result = await runAutoCutSourcePipeline(
                resolveVideoAnalysisSource(selectedMedia),
                extractFrame,
                config,
                autoCutContext,
                (msg) => setProgress(msg)
            );

            setSegments(result.segments);
            setVerificationResults(result.verificationResults);
            setFinalScore(result.finalScore);

            const suggested = selectTopSegments(result.segments, config);
            setSelectedSegments(new Set(suggested.map(s => s.id)));

            if (config.verifyTransitions && suggested.length > 1) {
                setStatus('verifying');
                const { verificationResults, avgScore } = await verifySegmentTransitions(
                    suggested,
                    selectedMedia.url,
                    extractFrame,
                    config.modelId,
                    (msg) => setProgress(msg)
                );
                setVerificationResults(verificationResults);
                const avgSegmentScore = suggested.reduce((sum, s) => sum + s.score, 0) / suggested.length;
                const final = Math.round(avgSegmentScore * 0.6 + avgScore * 0.4);
                setFinalScore(final);
            }

            setStatus('complete');
        } catch (err: any) {
            console.error('Auto Cut analysis failed:', err);
            setError(err.message || 'Analysis failed');
            setStatus('error');
        }
    };

    const handleAnalyzeTimeline = async () => {
        if (videoClips.length === 0) {
            setError('Add video clips to the timeline first');
            return;
        }

        setStatus('analyzing');
        setAnalysisScope('timeline');
        setError(null);
        setSegments([]);
        setSelectedSegments(new Set());
        setTimelineGroups([]);
        setTimelineSelected(new Set());
        setTimelineScore(0);
        setMediaPoolGroups([]);
        setMediaPoolSelected(new Set());
        setMediaPoolScore(0);

        try {
            const orderedClips = [...videoClips].sort((a, b) => a.start - b.start);
            const groups: TimelineSegmentGroup[] = [];
            const selectedKeys = new Set<string>();
            const allScores: number[] = [];

            for (let i = 0; i < orderedClips.length; i++) {
                const clip = orderedClips[i];
                const media = mediaItems.find(m => m.id === clip.mediaId);
                if (!media?.url) continue;

                setProgress(`Analyzing clip ${i + 1}/${orderedClips.length}: ${media.name}`);

                const analysis = await analyzeVideoSourceForSegments(
                    resolveVideoAnalysisSource(media),
                    config,
                    autoCutContext,
                    (msg) => setProgress(`Clip ${i + 1}/${orderedClips.length}: ${msg}`)
                );

                if (analysis.segments.length > 0) {
                    const suggested = selectTopSegments(analysis.segments, config);
                    const clipLabel = `${media.name} (${formatTime(clip.start)} - ${formatTime(clip.end)})`;
                    const segmentsSorted = [...analysis.segments].sort((a, b) => a.startTime - b.startTime);
                    segmentsSorted.forEach(seg => allScores.push(seg.score));

                    suggested.forEach(seg => {
                        selectedKeys.add(buildTimelineKey(clip.id, seg.id));
                    });

                    groups.push({
                        clipId: clip.id,
                        trackId: clip.trackId,
                        mediaId: media.id,
                        clipLabel,
                        mediaName: media.name,
                        mediaUrl: media.url,
                        segments: segmentsSorted,
                    });
                }
            }

            const avgScore = allScores.length
                ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
                : 0;

            setTimelineGroups(groups);
            setTimelineSelected(selectedKeys);
            setTimelineScore(avgScore);
            setStatus('complete');
            setProgress('');
        } catch (err: any) {
            console.error('Timeline auto cut failed:', err);
            setError(err.message || 'Timeline analysis failed');
            setStatus('error');
        }
    };

    const handleAnalyzeMediaPool = async () => {
        if (mediaPoolCandidates.length === 0) {
            setError(unusedOnlyInPool
                ? 'No unused video footage found in the media pool'
                : 'Add video footage to the media pool first');
            return;
        }

        setStatus('analyzing');
        setAnalysisScope('pool');
        setError(null);
        setSegments([]);
        setSelectedSegments(new Set());
        setTimelineGroups([]);
        setTimelineSelected(new Set());
        setTimelineScore(0);
        setMediaPoolGroups([]);
        setMediaPoolSelected(new Set());
        setMediaPoolScore(0);

        try {
            const orderedMedia = [...mediaPoolCandidates].sort((a, b) => a.name.localeCompare(b.name));
            const groups: MediaPoolSegmentGroup[] = [];
            const allScores: number[] = [];

            for (let i = 0; i < orderedMedia.length; i++) {
                const media = orderedMedia[i];
                if (!media.url) continue;

                setProgress(`Analyzing media ${i + 1}/${orderedMedia.length}: ${media.name}`);

                const analysis = await analyzeVideoSourceForSegments(
                    resolveVideoAnalysisSource(media),
                    config,
                    autoCutContext,
                    (msg) => setProgress(`Media ${i + 1}/${orderedMedia.length}: ${msg}`)
                );

                if (analysis.segments.length > 0) {
                    const segmentsSorted = [...analysis.segments].sort((a, b) => {
                        const beatA = getScriptBeatOrder(a);
                        const beatB = getScriptBeatOrder(b);
                        if (beatA !== beatB) return beatA - beatB;
                        if (a.startTime !== b.startTime) return a.startTime - b.startTime;
                        return b.score - a.score;
                    });

                    segmentsSorted.forEach(seg => allScores.push(seg.score));
                    groups.push({
                        mediaId: media.id,
                        mediaName: media.name,
                        mediaUrl: media.url,
                        segments: segmentsSorted,
                    });
                }
            }

            const avgScore = allScores.length
                ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
                : 0;

            setMediaPoolGroups(groups);
            setMediaPoolSelected(suggestMediaPoolSelections(groups));
            setMediaPoolScore(avgScore);
            setStatus('complete');
            setProgress('');
        } catch (err: any) {
            console.error('Media pool auto cut failed:', err);
            setError(err.message || 'Media pool analysis failed');
            setStatus('error');
        }
    };

    const handleToggleSegment = (segmentId: string) => {
        setSelectedSegments(prev => {
            const next = new Set(prev);
            if (next.has(segmentId)) {
                next.delete(segmentId);
            } else {
                next.add(segmentId);
            }
            return next;
        });
    };

    const handleToggleTimelineSegment = (key: string) => {
        setTimelineSelected(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const handleSelectAll = () => {
        setSelectedSegments(new Set(segments.map(s => s.id)));
    };

    const handleDeselectAll = () => {
        setSelectedSegments(new Set());
    };

    const handleSelectAllTimeline = () => {
        const allKeys = new Set<string>();
        timelineGroups.forEach(group => {
            group.segments.forEach(seg => {
                allKeys.add(buildTimelineKey(group.clipId, seg.id));
            });
        });
        setTimelineSelected(allKeys);
    };

    const handleDeselectAllTimeline = () => {
        setTimelineSelected(new Set());
    };

    const handleToggleMediaPoolSegment = (key: string) => {
        setMediaPoolSelected(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    const handleSelectAllMediaPool = () => {
        const allKeys = new Set<string>();
        mediaPoolGroups.forEach(group => {
            group.segments.forEach(seg => {
                allKeys.add(buildMediaPoolKey(group.mediaId, seg.id));
            });
        });
        setMediaPoolSelected(allKeys);
    };

    const handleDeselectAllMediaPool = () => {
        setMediaPoolSelected(new Set());
    };

    const handleApplySegments = () => {
        if (!selectedClip) return;

        const selected = segments
            .filter(s => selectedSegments.has(s.id))
            .sort((a, b) => a.startTime - b.startTime);

        if (selected.length === 0) return;

        // Call parent to split the clip based on segments
        onSplitClipWithSegments(selectedClip.id, selected);

        // Reset state
        setStatus('idle');
        setSegments([]);
        setSelectedSegments(new Set());
        setSelectedClipForAnalysis(null);
    };

    const handleApplyTimelineCut = () => {
        if (timelineGroups.length === 0) {
            setError('No timeline segments to apply');
            return;
        }

        const selected = timelineGroups.flatMap(group =>
            group.segments
                .filter(seg => timelineSelected.has(buildTimelineKey(group.clipId, seg.id)))
                .map(seg => ({ group, seg }))
        );

        if (selected.length === 0) {
            setError('Select at least one segment to apply');
            return;
        }

        const targetTrack = timelineTracks.find(t => t.type === 'video' && !t.isLocked);
        if (!targetTrack) {
            setError('No unlocked video track available');
            return;
        }

        let startTime = timelineClips
            .filter(c => c.trackId === targetTrack.id)
            .reduce((max, c) => Math.max(max, c.end), 0);

        const newMediaItems: MediaItem[] = [];
        const newClips: TimelineClip[] = [];
        const timestamp = Date.now();

        selected.forEach(({ group, seg }, index) => {
            const duration = Math.max(0.1, seg.endTime - seg.startTime);
            const mediaId = `autocut-${timestamp}-${index}`;
            const clipId = `clip-${timestamp}-${index}`;
            const segmentLabel = `${formatTime(seg.startTime)}-${formatTime(seg.endTime)}`;
            const url = `${group.mediaUrl}#t=${seg.startTime.toFixed(3)},${seg.endTime.toFixed(3)}`;

            newMediaItems.push({
                id: mediaId,
                name: `${group.mediaName} [${segmentLabel}]`,
                type: 'video',
                url,
                source: 'generated',
                duration,
            });

            newClips.push({
                id: clipId,
                mediaId,
                trackId: targetTrack.id,
                start: startTime,
                end: startTime + duration,
                duration,
                speed: 1,
                effect: null,
            });

            startTime += duration;
        });

        onAddMediaItems(newMediaItems);
        onAddClips(newClips);

        setStatus('idle');
        setTimelineGroups([]);
        setTimelineSelected(new Set());
        setAnalysisScope(null);
    };

    const handleApplyMediaPoolCut = () => {
        if (mediaPoolGroups.length === 0) {
            setError('No media pool segments to apply');
            return;
        }

        const selected = mediaPoolGroups.flatMap(group =>
            group.segments
                .filter(seg => mediaPoolSelected.has(buildMediaPoolKey(group.mediaId, seg.id)))
                .map(seg => ({ group, seg }))
        );

        if (selected.length === 0) {
            setError('Select at least one media pool segment to apply');
            return;
        }

        const targetTrack = timelineTracks.find(t => t.type === 'video' && !t.isLocked);
        if (!targetTrack) {
            setError('No unlocked video track available');
            return;
        }

        let startTime = timelineClips
            .filter(c => c.trackId === targetTrack.id)
            .reduce((max, c) => Math.max(max, c.end), 0);

        const timestamp = Date.now();
        const newClips: TimelineClip[] = [...selected]
            .sort((a, b) => {
                const beatA = getScriptBeatOrder(a.seg);
                const beatB = getScriptBeatOrder(b.seg);
                if (beatA !== beatB) return beatA - beatB;
                if (a.group.mediaName !== b.group.mediaName) return a.group.mediaName.localeCompare(b.group.mediaName);
                return a.seg.startTime - b.seg.startTime;
            })
            .map(({ group, seg }, index) => {
                const duration = Math.max(0.1, seg.endTime - seg.startTime);
                const clipId = `pool-autocut-${timestamp}-${index}`;
                const clip: TimelineClip = {
                    id: clipId,
                    mediaId: group.mediaId,
                    trackId: targetTrack.id,
                    start: startTime,
                    end: startTime + duration,
                    duration,
                    speed: 1,
                    sourceIn: seg.startTime,
                    sourceOut: seg.endTime,
                    effect: null,
                };
                startTime += duration;
                return clip;
            });

        onAddClips(newClips);

        setStatus('idle');
        setMediaPoolGroups([]);
        setMediaPoolSelected(new Set());
        setAnalysisScope(null);
    };

    const handleTrimToSingleSegment = (segment: VideoSegment) => {
        if (!selectedClip) return;

        // Update the clip's start/end to match the segment (trim to just this segment)
        // We adjust the clip timing based on the segment's position within the source video
        const updatedClip: TimelineClip = {
            ...selectedClip,
            // Keep the same start position on timeline, just adjust duration
            duration: segment.endTime - segment.startTime,
            end: selectedClip.start + (segment.endTime - segment.startTime),
        };

        onUpdateClip(updatedClip);

        // Reset state
        setStatus('idle');
        setSegments([]);
        setSelectedSegments(new Set());
        setSelectedClipForAnalysis(null);
    };

    const getScoreColor = (score: number): string => {
        if (score >= 85) return 'text-green-400';
        if (score >= 70) return 'text-yellow-400';
        return 'text-red-400';
    };

    const getScoreBg = (score: number): string => {
        if (score >= 85) return 'bg-green-500/20';
        if (score >= 70) return 'bg-yellow-500/20';
        return 'bg-red-500/20';
    };

    const scoreClass = (score: number) => (score >= 85 ? 'pk-score--good' : score >= 70 ? 'pk-score--mid' : 'pk-score--low');
    const isBusy = status === 'analyzing' || status === 'verifying';
    const effectiveScope = scope === 'clip' && !selectedClip ? (videoClips.length > 0 ? 'clip' : 'pool') : scope;
    const runAnalysis = () => {
        if (effectiveScope === 'clip') return handleAnalyze();
        if (effectiveScope === 'timeline') return handleAnalyzeTimeline();
        return handleAnalyzeMediaPool();
    };
    const analyzeLabel = effectiveScope === 'clip' ? 'Analyze clip' : effectiveScope === 'timeline' ? 'Analyze timeline' : 'Analyze media pool';
    const analyzeDisabled = effectiveScope === 'clip' ? !selectedClip : effectiveScope === 'timeline' ? videoClips.length === 0 : mediaPoolCandidates.length === 0;
    const resetResults = () => { setStatus('idle'); setError(null); };

    const renderSegmentRow = (
        segment: VideoSegment,
        index: number,
        selected: boolean,
        onToggle: () => void,
        extra?: React.ReactNode,
    ) => (
        <label key={segment.id} className={`pk-row pk-row--clickable ${selected ? 'pk-row--selected' : ''}`}>
            <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Segment ${index + 1}`} />
            <div className="pk-row__body">
                <div className="pk-row__title"><span className="pk-mono">#{index + 1}</span> <span className="pk-mono" style={{ fontWeight: 500 }}>{formatTime(segment.startTime)} → {formatTime(segment.endTime)}</span></div>
                <div className="pk-row__meta pk-row__meta--clamp">{segment.reason}</div>
                {segment.scriptMatch && (
                    <div className="pk-row__meta" style={{ color: 'var(--app-accent-strong)' }}>Script · {segment.scriptMatch.beatLabel} · {segment.scriptMatch.similarity}/100</div>
                )}
            </div>
            <div className="pk-row__aside">
                <span className={`pk-score ${scoreClass(segment.score)}`}>{segment.score}</span>
                {extra}
            </div>
        </label>
    );

    const resultCount = analysisScope === 'clip'
        ? segments.length
        : analysisScope === 'timeline'
            ? timelineGroups.reduce((sum, group) => sum + group.segments.length, 0)
            : mediaPoolGroups.reduce((sum, group) => sum + group.segments.length, 0);
    const resultScore = analysisScope === 'clip' ? finalScore : analysisScope === 'timeline' ? timelineScore : mediaPoolScore;
    const selectedCount = analysisScope === 'clip' ? selectedSegments.size : analysisScope === 'timeline' ? timelineSelected.size : mediaPoolSelected.size;
    const selectAll = analysisScope === 'clip' ? handleSelectAll : analysisScope === 'timeline' ? handleSelectAllTimeline : handleSelectAllMediaPool;
    const selectNone = analysisScope === 'clip' ? handleDeselectAll : analysisScope === 'timeline' ? handleDeselectAllTimeline : handleDeselectAllMediaPool;
    const applyResults = analysisScope === 'clip' ? handleApplySegments : analysisScope === 'timeline' ? handleApplyTimelineCut : handleApplyMediaPoolCut;
    const applyLabel = analysisScope === 'clip'
        ? `Split into ${selectedCount} clip${selectedCount === 1 ? '' : 's'}`
        : analysisScope === 'timeline'
            ? `Append ${selectedCount} segment${selectedCount === 1 ? '' : 's'}`
            : `Build rough cut · ${selectedCount}`;
    const showResults = status === 'complete' && analysisScope !== null;

    return (
        <div className="fx-browser">
            <div className="fx-browser__header">
                <h3 className="fx-browser__title">Auto Cut</h3>
                {showResults ? (
                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={resetResults}>‹ New analysis</button>
                ) : (
                    <span className="pk-chip">{videoClips.length} clip{videoClips.length === 1 ? '' : 's'} · {mediaPoolVideos.length} in pool</span>
                )}
            </div>

            <div className="fx-browser__scroll">
                {!showResults && (
                    <div className="pk-stack">
                        <div className="pk-card">
                            <div className="pk-card__head"><span className="pk-card__title">What to analyze</span></div>
                            <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                                <button type="button" aria-pressed={effectiveScope === 'clip'} onClick={() => setScope('clip')} disabled={videoClips.length === 0}>Clip</button>
                                <button type="button" aria-pressed={effectiveScope === 'timeline'} onClick={() => setScope('timeline')} disabled={videoClips.length === 0}>Timeline</button>
                                <button type="button" aria-pressed={effectiveScope === 'pool'} onClick={() => setScope('pool')} disabled={mediaPoolVideos.length === 0}>Media pool</button>
                            </div>
                            {effectiveScope === 'clip' && (
                                <select value={selectedClipForAnalysis || selectedClipId || ''} onChange={(e) => setSelectedClipForAnalysis(e.target.value || null)} aria-label="Clip to analyze">
                                    <option value="">Choose a clip…</option>
                                    {videoClips.map((clip) => {
                                        const media = mediaItems.find((m) => m.id === clip.mediaId);
                                        return <option key={clip.id} value={clip.id}>{media?.name || 'Clip'} · {formatTime(clip.start)}–{formatTime(clip.end)}</option>;
                                    })}
                                </select>
                            )}
                            {effectiveScope === 'timeline' && <p className="pk-hint">Finds the best moments in every video clip on the timeline and appends them as new clips.</p>}
                            {effectiveScope === 'pool' && (
                                <>
                                    <label className="pk-check"><input type="checkbox" checked={unusedOnlyInPool} onChange={(e) => setUnusedOnlyInPool(e.target.checked)} />Only footage not yet in the cut <span className="pk-chip">{mediaPoolCandidates.length}/{mediaPoolVideos.length}</span></label>
                                    <p className="pk-hint">Builds a rough cut from the strongest takes in the media pool, in script order when a script is loaded.</p>
                                </>
                            )}
                            {videoClips.length === 0 && mediaPoolVideos.length === 0 && <p className="pk-hint">Import video on the Media page first.</p>}
                            <button type="button" className="edit-text-btn edit-text-btn--primary w-full justify-center" onClick={runAnalysis} disabled={isBusy || analyzeDisabled}>
                                {isBusy ? 'Analyzing…' : analyzeLabel}
                            </button>
                        </div>

                        {isBusy && (
                            <div className="pk-progress"><span className="pk-spinner" />{progress || 'Working…'}</div>
                        )}
                        {error && (
                            <div className="pk-alert pk-alert--danger">
                                {error}
                                <div style={{ marginTop: '0.4rem' }}><button type="button" className="edit-text-btn edit-text-btn--outline" onClick={runAnalysis}>Try again</button></div>
                            </div>
                        )}

                        {effectiveScope === 'clip' && selectedClip && !isBusy && (
                            <details className="pk-details">
                                <summary>Quick cut · offline<small>{localMode === 'silence' ? 'Silence' : localMode === 'scenes' ? 'Scenes' : 'Fillers'}</small></summary>
                                <div className="pk-details__body">
                                    <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
                                        {([['silence', 'Silence'], ['scenes', 'Scenes'], ['filler', 'Fillers']] as Array<['silence' | 'scenes' | 'filler', string]>).map(([id, label]) => (
                                            <button key={id} type="button" aria-pressed={localMode === id} onClick={() => { setLocalMode(id); setLocalResult(null); }}>{label}</button>
                                        ))}
                                    </div>
                                    <p className="pk-hint">
                                        {localMode === 'silence' && 'Keeps speech, drops dead air — adaptive loudness threshold, no API needed.'}
                                        {localMode === 'scenes' && 'Finds hard cuts from frame differences, ignores camera moves — no API needed.'}
                                        {localMode === 'filler' && 'Transcribes with word timings and removes ums, ähs and long pauses (needs a Gemini key).'}
                                    </p>
                                    {localMode === 'silence' && (
                                        <div className="pk-inline">
                                            <label className="pk-inline">Margin<input type="number" step={0.05} min={0} value={localSettings.margin} onChange={(e) => setLocalSettings((p) => ({ ...p, margin: Number(e.target.value) }))} />s</label>
                                            <label className="pk-inline">Min cut<input type="number" step={0.05} min={0} value={localSettings.minCut} onChange={(e) => setLocalSettings((p) => ({ ...p, minCut: Number(e.target.value) }))} />s</label>
                                            <label className="pk-inline">Min clip<input type="number" step={0.05} min={0} value={localSettings.minClip} onChange={(e) => setLocalSettings((p) => ({ ...p, minClip: Number(e.target.value) }))} />s</label>
                                            <label className="pk-inline">Threshold<input type="number" step={1} min={2} max={30} value={localSettings.threshold} onChange={(e) => setLocalSettings((p) => ({ ...p, threshold: Number(e.target.value) }))} />dB</label>
                                        </div>
                                    )}
                                    {localMode === 'scenes' && (
                                        <div className="pk-inline">
                                            <label className="pk-inline">Sensitivity<input type="number" step={0.5} min={1.5} max={8} value={localSettings.sceneSensitivity} onChange={(e) => setLocalSettings((p) => ({ ...p, sceneSensitivity: Number(e.target.value) }))} />×</label>
                                            <label className="pk-inline">Min scene<input type="number" step={0.5} min={0.2} value={localSettings.minScene} onChange={(e) => setLocalSettings((p) => ({ ...p, minScene: Number(e.target.value) }))} />s</label>
                                        </div>
                                    )}
                                    {localMode === 'filler' && (
                                        <label className="pk-inline">Cut pauses over<input type="number" step={0.1} min={0} value={localSettings.removePauses} onChange={(e) => setLocalSettings((p) => ({ ...p, removePauses: Number(e.target.value) }))} />s</label>
                                    )}
                                    <div className="pk-actions">
                                        <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={runLocalDetection} disabled={Boolean(localBusy)}>{localBusy || 'Detect'}</button>
                                        {localResult && (
                                            <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={applyLocalResult} disabled={localResult.segments.length === 0}>
                                                Apply {localResult.segments.length} segment{localResult.segments.length === 1 ? '' : 's'}
                                            </button>
                                        )}
                                    </div>
                                    {localResult && (
                                        <div className="pk-alert pk-alert--info">
                                            {localResult.notes.map((note, index) => <div key={index}>{note}</div>)}
                                            {localResult.removedSeconds > 0 && <div>Removes {localResult.removedSeconds.toFixed(1)}s of {localResult.duration.toFixed(1)}s.</div>}
                                        </div>
                                    )}
                                </div>
                            </details>
                        )}

                        <details className="pk-details">
                            <summary>Analysis settings<small>{modelChoice === 'pro' ? 'Quality' : modelChoice === 'flash' ? 'Fast' : 'Custom'} · {config.qualityThreshold}%</small></summary>
                            <div className="pk-details__body">
                                <div className="pk-field">
                                    <span>Judge by</span>
                                    <div className="pk-actions">
                                        <label className="pk-check"><input type="checkbox" checked={config.criteria.technicalQuality} onChange={(e) => setConfig((prev) => ({ ...prev, criteria: { ...prev.criteria, technicalQuality: e.target.checked } }))} />Technical</label>
                                        <label className="pk-check"><input type="checkbox" checked={config.criteria.contentRelevance} onChange={(e) => setConfig((prev) => ({ ...prev, criteria: { ...prev.criteria, contentRelevance: e.target.checked } }))} />Content</label>
                                        <label className="pk-check"><input type="checkbox" checked={config.criteria.emotionalImpact} onChange={(e) => setConfig((prev) => ({ ...prev, criteria: { ...prev.criteria, emotionalImpact: e.target.checked } }))} />Emotion</label>
                                    </div>
                                </div>
                                <label className="pk-field">
                                    <span>Model</span>
                                    <select
                                        value={modelChoice}
                                        onChange={(e) => {
                                            const value = e.target.value;
                                            if (value === 'pro') setConfig((prev) => ({ ...prev, modelId: AUTO_CUT_MODEL_PRO }));
                                            else if (value === 'flash') setConfig((prev) => ({ ...prev, modelId: AUTO_CUT_MODEL_FLASH }));
                                            else { const fallback = customModelId || config.modelId || AUTO_CUT_MODEL_PRO; setCustomModelId(fallback); setConfig((prev) => ({ ...prev, modelId: fallback })); }
                                        }}
                                    >
                                        <option value="pro">Quality · Gemini 3.1 Pro</option>
                                        <option value="flash">Fast · Gemini 3.1 Flash</option>
                                        <option value="custom">Custom model ID</option>
                                    </select>
                                    {modelChoice === 'custom' && (
                                        <input type="text" value={customModelId || config.modelId} onChange={(e) => { const value = e.target.value.trim(); setCustomModelId(value); setConfig((prev) => ({ ...prev, modelId: value || prev.modelId })); }} placeholder="e.g. gemini-3.1-pro-preview" />
                                    )}
                                </label>
                                <label className="pk-field">
                                    <span>Keep segments scoring at least {config.qualityThreshold}%</span>
                                    <input type="range" min="50" max="100" value={config.qualityThreshold} onChange={(e) => setConfig((prev) => ({ ...prev, qualityThreshold: parseInt(e.target.value, 10) }))} />
                                </label>
                                <div className="pk-inline">
                                    <label className="pk-inline">Min<input type="number" min="0.2" step="0.1" value={config.minSegmentDuration} onChange={(e) => setConfig((prev) => ({ ...prev, minSegmentDuration: parseFloat(e.target.value) || 0.8 }))} />s</label>
                                    <label className="pk-inline">Max<input type="number" min="0.5" step="0.5" value={config.maxSegmentDuration} onChange={(e) => setConfig((prev) => ({ ...prev, maxSegmentDuration: parseFloat(e.target.value) || 6 }))} />s</label>
                                    <label className="pk-inline">Top<input type="number" min="1" max="12" step="1" value={config.maxSegmentsPerClip} onChange={(e) => setConfig((prev) => ({ ...prev, maxSegmentsPerClip: parseInt(e.target.value, 10) || 6 }))} /></label>
                                    <label className="pk-check"><input type="checkbox" checked={config.verifyTransitions} onChange={(e) => setConfig((prev) => ({ ...prev, verifyTransitions: e.target.checked }))} />Verify cuts</label>
                                </div>
                            </div>
                        </details>

                        <details className="pk-details">
                            <summary>Script guidance<small>{hasScriptGuidance ? (config.useScriptMatching ? `on · ${config.scriptWeight}%` : 'off') : 'no script'}</small></summary>
                            <div className="pk-details__body">
                                <p className="pk-hint">Rank footage against a script or story context. Only guides Auto Cut — the project script stays untouched.</p>
                                <div className="pk-seg" style={{ gridTemplateColumns: 'repeat(2, 1fr)' }}>
                                    <button type="button" aria-pressed={activeScriptMode === 'project'} disabled={!hasProjectScript} onClick={() => setScriptSourceMode('project')}>Project script</button>
                                    <button type="button" aria-pressed={activeScriptMode === 'custom'} onClick={() => setScriptSourceMode('custom')}>Custom script</button>
                                </div>
                                <p className="pk-hint">{activeScriptSummary}{scriptBeats.length > 0 ? ` · ${scriptBeats.length} scene beats` : ''}</p>
                                {activeScriptMode === 'custom' && (
                                    <>
                                        <div className="pk-actions">
                                            <label className="edit-text-btn edit-text-btn--outline" style={{ cursor: 'pointer' }}>
                                                <input type="file" accept=".pdf,.docx,.txt,.md,.json,.xlsx,.xls,.csv,text/*" className="hidden" onChange={handleCustomScriptUpload} />
                                                {isParsingScript ? 'Importing…' : 'Upload script'}
                                            </label>
                                            <button type="button" className="edit-text-btn" onClick={() => { setCustomScriptText(''); setCustomScriptName(''); setScriptImportError(null); }} disabled={!customScriptText && !customScriptName}>Clear</button>
                                        </div>
                                        <textarea value={customScriptText} onChange={(e) => { setCustomScriptText(e.target.value); setScriptImportError(null); }} placeholder="Paste a shooting script, transcript, beat sheet or outline for this rough cut." rows={5} />
                                    </>
                                )}
                                {scriptImportError && <p className="pk-hint" style={{ color: 'var(--app-danger)' }}>{scriptImportError}</p>}
                                <label className="pk-switch">
                                    <span>Script-aware ranking</span>
                                    <input type="checkbox" checked={config.useScriptMatching} disabled={!hasScriptGuidance} onChange={(e) => setConfig((prev) => ({ ...prev, useScriptMatching: e.target.checked }))} />
                                </label>
                                <label className="pk-field">
                                    <span>Script weight · {config.scriptWeight}%</span>
                                    <input type="range" min="0" max="80" step="5" value={config.scriptWeight} disabled={!hasScriptGuidance || !config.useScriptMatching} onChange={(e) => setConfig((prev) => ({ ...prev, scriptWeight: parseInt(e.target.value, 10) || 0 }))} />
                                </label>
                                <label className="pk-field">
                                    <span>Embedding model</span>
                                    <input type="text" value={config.embeddingModelId} disabled={!hasScriptGuidance || !config.useScriptMatching} onChange={(e) => setConfig((prev) => ({ ...prev, embeddingModelId: e.target.value.trim() || prev.embeddingModelId }))} placeholder="gemini-embedding-001" />
                                </label>
                            </div>
                        </details>
                    </div>
                )}

                {showResults && (
                    <div className="pk-stack">
                        <div className="pk-card">
                            <div className="pk-card__head">
                                <span className="pk-card__title">
                                    {resultCount} segment{resultCount === 1 ? '' : 's'}
                                    {analysisScope === 'timeline' && ` in ${timelineGroups.length} clip${timelineGroups.length === 1 ? '' : 's'}`}
                                    {analysisScope === 'pool' && ` in ${mediaPoolGroups.length} file${mediaPoolGroups.length === 1 ? '' : 's'}`}
                                </span>
                                <span className={`pk-score ${scoreClass(resultScore)}`}>{resultScore}/100</span>
                            </div>
                            {resultCount > 0 && (
                                <div className="pk-actions pk-actions--split">
                                    <span className="pk-hint">{selectedCount} selected</span>
                                    <span className="pk-actions">
                                        <button type="button" className="edit-text-btn" onClick={selectAll}>All</button>
                                        <button type="button" className="edit-text-btn" onClick={selectNone}>None</button>
                                    </span>
                                </div>
                            )}
                        </div>

                        {resultCount === 0 && (
                            <div className="pk-empty">
                                <ScissorsIcon />
                                <strong>No usable segments</strong>
                                <span>
                                    {analysisScope === 'pool' && hasScriptGuidance && config.useScriptMatching ? 'Nothing in the pool matched the script. ' : ''}
                                    Lower the score threshold in Analysis settings{analysisScope === 'pool' ? ' or include used footage' : ''} and try again.
                                </span>
                            </div>
                        )}

                        {analysisScope === 'pool' && sceneDailies.length > 0 && (
                            <details className="pk-details" open>
                                <summary>Scene coverage<small>{coveredSceneCount}/{sceneDailies.length} scenes</small></summary>
                                <div className="pk-details__body">
                                    <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={handleSelectBestPerScene}>Select the best take per scene</button>
                                    <div className="pk-list">
                                        {sceneDailies.map((entry) => (
                                            <div key={entry.beatId} className="pk-row">
                                                <div className="pk-row__body">
                                                    <div className="pk-row__title">{entry.beatLabel}</div>
                                                    <div className="pk-row__meta pk-row__meta--clamp">{entry.excerpt}</div>
                                                    {entry.topCandidate ? (
                                                        <div className="pk-row__meta">Best · {entry.topCandidate.mediaName} · <span className="pk-mono">{formatTime(entry.topCandidate.startTime)}–{formatTime(entry.topCandidate.endTime)}</span></div>
                                                    ) : (
                                                        <div className="pk-row__meta" style={{ color: 'var(--app-warm)' }}>No matching footage yet</div>
                                                    )}
                                                </div>
                                                <div className="pk-row__aside">
                                                    <span className="pk-chip">{entry.candidateCount} takes</span>
                                                    {entry.selectedCount > 0 && <span className="pk-chip pk-chip--accent">{entry.selectedCount} picked</span>}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </details>
                        )}

                        {analysisScope === 'clip' && segments.length > 0 && (
                            <div className="pk-list">
                                {segments.map((segment, index) =>
                                    renderSegmentRow(segment, index, selectedSegments.has(segment.id), () => handleToggleSegment(segment.id), (
                                        <button type="button" className="edit-text-btn" onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleTrimToSingleSegment(segment); }} title="Trim the clip to just this segment">Trim to</button>
                                    ))
                                )}
                            </div>
                        )}

                        {analysisScope === 'timeline' && timelineGroups.map((group) => (
                            <section key={group.clipId} className="fx-section">
                                <header className="fx-section__title">{group.clipLabel}</header>
                                <div className="pk-list">
                                    {group.segments.map((segment, index) => {
                                        const key = buildTimelineKey(group.clipId, segment.id);
                                        return renderSegmentRow(segment, index, timelineSelected.has(key), () => handleToggleTimelineSegment(key));
                                    })}
                                </div>
                            </section>
                        ))}

                        {analysisScope === 'pool' && mediaPoolGroups.map((group) => (
                            <section key={group.mediaId} className="fx-section">
                                <header className="fx-section__title">{group.mediaName}</header>
                                <div className="pk-list">
                                    {group.segments.map((segment, index) => {
                                        const key = buildMediaPoolKey(group.mediaId, segment.id);
                                        return renderSegmentRow(segment, index, mediaPoolSelected.has(key), () => handleToggleMediaPoolSegment(key));
                                    })}
                                </div>
                            </section>
                        ))}
                    </div>
                )}
            </div>

            <footer className={`fx-browser__footer ${showResults && resultCount > 0 ? 'fx-browser__footer--bar' : ''}`}>
                {showResults && resultCount > 0 ? (
                    <>
                        <span>
                            {analysisScope === 'clip' && 'Splits the clip into the chosen segments'}
                            {analysisScope === 'timeline' && 'Appends to the end of the active video track'}
                            {analysisScope === 'pool' && 'Appends to the first unlocked video track, in script order'}
                        </span>
                        <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={applyResults} disabled={selectedCount === 0}>{applyLabel}</button>
                    </>
                ) : (
                    <span>Auto Cut never changes the timeline until you apply a result.</span>
                )}
            </footer>
        </div>
    );
};

export default AutoCutPanel;
