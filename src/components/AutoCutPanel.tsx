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
import { TimelineClip, MediaItem, TimelineTrack } from '../types';
import { getRegisteredMediaFile } from '../services/mediaSourceService';
import { parseScriptDocument } from '../services/documentParsingService';

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
    const [selectedClipForAnalysis, setSelectedClipForAnalysis] = useState<string | null>(null);
    const [customModelId, setCustomModelId] = useState<string>('');
    const [analysisScope, setAnalysisScope] = useState<'clip' | 'timeline' | 'pool' | null>(null);
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

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Clip Selection */}
            {(status === 'idle' || status === 'error') && (
                <div className="mb-4">
                    <label className="block text-sm font-medium text-gray-300 mb-2">
                        Select Video Clip to Analyze
                    </label>
                    {videoClips.length === 0 ? (
                        <p className="text-gray-500 text-sm">
                            {mediaPoolVideos.length > 0
                                ? 'No timeline clips yet. You can still analyze the media pool below.'
                                : 'Add video clips to the timeline or media pool first'}
                        </p>
                    ) : (
                        <select
                            value={selectedClipForAnalysis || selectedClipId || ''}
                            onChange={(e) => setSelectedClipForAnalysis(e.target.value || null)}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                        >
                            <option value="">-- Select a clip --</option>
                            {videoClips.map(clip => {
                                const media = mediaItems.find(m => m.id === clip.mediaId);
                                return (
                                    <option key={clip.id} value={clip.id}>
                                        {media?.name || 'Unknown'} ({formatTime(clip.start)} - {formatTime(clip.end)})
                                    </option>
                                );
                            })}
                        </select>
                    )}
                </div>
            )}

            {/* Config Options */}
            {status === 'idle' && (videoClips.length > 0 || mediaPoolVideos.length > 0) && (
                <div className="mb-4 p-3 bg-gray-800/50 rounded-lg border border-gray-700">
                    <h4 className="text-xs font-medium text-gray-400 uppercase mb-2">Analysis Criteria</h4>
                    <div className="flex flex-wrap gap-3">
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                                type="checkbox"
                                checked={config.criteria.technicalQuality}
                                onChange={(e) => setConfig(prev => ({
                                    ...prev,
                                    criteria: { ...prev.criteria, technicalQuality: e.target.checked }
                                }))}
                                className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                            />
                            Technical
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                                type="checkbox"
                                checked={config.criteria.contentRelevance}
                                onChange={(e) => setConfig(prev => ({
                                    ...prev,
                                    criteria: { ...prev.criteria, contentRelevance: e.target.checked }
                                }))}
                                className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                            />
                            Content
                        </label>
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                                type="checkbox"
                                checked={config.criteria.emotionalImpact}
                                onChange={(e) => setConfig(prev => ({
                                    ...prev,
                                    criteria: { ...prev.criteria, emotionalImpact: e.target.checked }
                                }))}
                                className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                            />
                            Emotion
                        </label>
                    </div>
                    <div className="mt-3 grid gap-2">
                        <label className="text-xs text-gray-400">Model</label>
                        <select
                            value={modelChoice}
                            onChange={(e) => {
                                const value = e.target.value;
                                if (value === 'pro') {
                                    setConfig(prev => ({ ...prev, modelId: AUTO_CUT_MODEL_PRO }));
                                } else if (value === 'flash') {
                                    setConfig(prev => ({ ...prev, modelId: AUTO_CUT_MODEL_FLASH }));
                                } else {
                                    const fallback = customModelId || config.modelId || AUTO_CUT_MODEL_PRO;
                                    setCustomModelId(fallback);
                                    setConfig(prev => ({ ...prev, modelId: fallback }));
                                }
                            }}
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                        >
                            <option value="pro">Quality (gemini-3.1-pro-preview)</option>
                            <option value="flash">Fast (gemini-3.1-flash-preview)</option>
                            <option value="custom">Custom model ID</option>
                        </select>
                        {modelChoice === 'custom' && (
                            <input
                                type="text"
                                value={customModelId || config.modelId}
                                onChange={(e) => {
                                    const value = e.target.value.trim();
                                    setCustomModelId(value);
                                    setConfig(prev => ({ ...prev, modelId: value || prev.modelId }));
                                }}
                                placeholder="e.g. gemini-3.1-pro-preview"
                                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm"
                            />
                        )}
                    </div>
                    <div className="mt-3 p-2 rounded border border-gray-700 bg-gray-900/40 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-xs text-gray-400">Auto-edit script</label>
                            <span className="text-[10px] text-gray-500">{activeScriptSummary}</span>
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs text-gray-300">
                            <label className="flex items-center gap-2 rounded border border-gray-700 px-2 py-1.5">
                                <input
                                    type="radio"
                                    name="autocut-script-source"
                                    checked={activeScriptMode === 'project'}
                                    disabled={!hasProjectScript}
                                    onChange={() => setScriptSourceMode('project')}
                                    className="w-3 h-3 border-gray-600 bg-gray-700 text-indigo-500 disabled:opacity-50"
                                />
                                Project script
                            </label>
                            <label className="flex items-center gap-2 rounded border border-gray-700 px-2 py-1.5">
                                <input
                                    type="radio"
                                    name="autocut-script-source"
                                    checked={activeScriptMode === 'custom'}
                                    onChange={() => setScriptSourceMode('custom')}
                                    className="w-3 h-3 border-gray-600 bg-gray-700 text-indigo-500"
                                />
                                Custom script
                            </label>
                        </div>
                        <div className="flex items-center gap-2">
                            <label className="inline-flex cursor-pointer items-center rounded border border-gray-700 px-2 py-1 text-xs text-gray-300 hover:border-gray-600 hover:text-white">
                                <input
                                    type="file"
                                    accept=".pdf,.docx,.txt,.md,.json,.xlsx,.xls,.csv,text/*"
                                    className="hidden"
                                    onChange={handleCustomScriptUpload}
                                />
                                {isParsingScript ? 'Importing script...' : 'Upload script'}
                            </label>
                            <button
                                onClick={() => {
                                    setCustomScriptText('');
                                    setCustomScriptName('');
                                    setScriptImportError(null);
                                }}
                                disabled={!customScriptText && !customScriptName}
                                className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-400 hover:border-gray-600 hover:text-white disabled:opacity-40"
                            >
                                Clear custom
                            </button>
                        </div>
                        {scriptImportError && (
                            <p className="text-[10px] text-red-400">{scriptImportError}</p>
                        )}
                        {activeScriptMode === 'custom' && (
                            <textarea
                                value={customScriptText}
                                onChange={(e) => {
                                    setCustomScriptText(e.target.value);
                                    setScriptImportError(null);
                                }}
                                placeholder="Paste a shooting script, interview transcript, beat sheet, or edit outline just for this rough cut."
                                rows={7}
                                className="w-full resize-y rounded-lg border border-gray-700 bg-gray-950/70 p-2 text-xs text-white placeholder:text-gray-500"
                            />
                        )}
                        <p className="text-[10px] text-gray-500">
                            This script only guides Auto Cut and rough-cut scene matching. It does not overwrite the Project workspace script.
                        </p>
                        {scriptBeats.length > 0 && (
                            <p className="text-[10px] text-green-400">
                                Scene detect ready: {scriptBeats.length} derived scene beats from the active script.
                            </p>
                        )}
                        {!hasProjectScript && (
                            <p className="text-[10px] text-yellow-400">
                                No Project workspace script is loaded. Use the custom script field for standalone rough cuts.
                            </p>
                        )}
                    </div>
                    <div className="mt-3 p-2 rounded border border-gray-700 bg-gray-900/40 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-xs text-gray-400">Script-aware ranking</label>
                            <input
                                type="checkbox"
                                checked={config.useScriptMatching}
                                disabled={!hasScriptGuidance}
                                onChange={(e) => setConfig(prev => ({ ...prev, useScriptMatching: e.target.checked }))}
                                className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500 disabled:opacity-50"
                            />
                        </div>
                        <p className="text-[10px] text-gray-500">
                            {hasScriptGuidance
                                ? 'Segments are semantically ranked against your script/context using Gemini embeddings.'
                                : 'Load a project script, paste a custom script, or provide story context to enable embedding-based footage matching.'}
                        </p>
                        <label className="block text-xs text-gray-400">
                            Script weight: {config.scriptWeight}%
                        </label>
                        <input
                            type="range"
                            min="0"
                            max="80"
                            step="5"
                            value={config.scriptWeight}
                            disabled={!hasScriptGuidance || !config.useScriptMatching}
                            onChange={(e) => setConfig(prev => ({ ...prev, scriptWeight: parseInt(e.target.value, 10) || 0 }))}
                            className="w-full"
                        />
                        <label className="block text-xs text-gray-400">Embedding model</label>
                        <input
                            type="text"
                            value={config.embeddingModelId}
                            disabled={!hasScriptGuidance || !config.useScriptMatching}
                            onChange={(e) => setConfig(prev => ({ ...prev, embeddingModelId: e.target.value.trim() || prev.embeddingModelId }))}
                            placeholder="gemini-embedding-001"
                            className="w-full bg-gray-900 border border-gray-700 rounded-lg p-2 text-white text-sm disabled:opacity-50"
                        />
                    </div>
                    <div className="mt-3 p-2 rounded border border-gray-700 bg-gray-900/40 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                            <label className="text-xs text-gray-400">Media pool scope</label>
                            <span className="text-[10px] text-gray-500">
                                {mediaPoolCandidates.length}/{mediaPoolVideos.length} videos
                            </span>
                        </div>
                        <label className="flex items-center gap-2 text-xs text-gray-300">
                            <input
                                type="checkbox"
                                checked={unusedOnlyInPool}
                                onChange={(e) => setUnusedOnlyInPool(e.target.checked)}
                                className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                            />
                            Only unused footage
                        </label>
                        <p className="text-[10px] text-gray-500">
                            Analyze project footage directly from the media pool and build a rough cut from the best script matches.
                        </p>
                    </div>
                    <div className="mt-3">
                        <label className="text-xs text-gray-400">
                            Threshold: {config.qualityThreshold}%
                        </label>
                        <input
                            type="range"
                            min="50"
                            max="100"
                            value={config.qualityThreshold}
                            onChange={(e) => setConfig(prev => ({
                                ...prev,
                                qualityThreshold: parseInt(e.target.value)
                            }))}
                            className="w-full mt-1"
                        />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-300">
                        <label className="flex items-center gap-2">
                            Min seg (s)
                            <input
                                type="number"
                                min="0.2"
                                step="0.1"
                                value={config.minSegmentDuration}
                                onChange={(e) => setConfig(prev => ({ ...prev, minSegmentDuration: parseFloat(e.target.value) || 0.8 }))}
                                className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                            />
                        </label>
                        <label className="flex items-center gap-2">
                            Max seg (s)
                            <input
                                type="number"
                                min="0.5"
                                step="0.5"
                                value={config.maxSegmentDuration}
                                onChange={(e) => setConfig(prev => ({ ...prev, maxSegmentDuration: parseFloat(e.target.value) || 6 }))}
                                className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                            />
                        </label>
                        <label className="flex items-center gap-2">
                            Top N
                            <input
                                type="number"
                                min="1"
                                max="12"
                                step="1"
                                value={config.maxSegmentsPerClip}
                                onChange={(e) => setConfig(prev => ({ ...prev, maxSegmentsPerClip: parseInt(e.target.value, 10) || 6 }))}
                                className="w-16 bg-gray-900 border border-gray-700 rounded px-2 py-1 text-white"
                            />
                        </label>
                        <label className="flex items-center gap-2">
                            Verify
                            <input
                                type="checkbox"
                                checked={config.verifyTransitions}
                                onChange={(e) => setConfig(prev => ({ ...prev, verifyTransitions: e.target.checked }))}
                                className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                            />
                        </label>
                    </div>
                </div>
            )}

            {/* Progress */}
            {(status === 'analyzing' || status === 'verifying') && (
                <div className="mb-4 p-3 bg-indigo-500/10 border border-indigo-500/30 rounded-lg">
                    <div className="flex items-center gap-3">
                        <div className="animate-spin w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full" />
                        <span className="text-sm text-indigo-300">{progress}</span>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                    <p className="text-sm text-red-400">{error}</p>
                </div>
            )}

            {/* Results (Single Clip) */}
            {status === 'complete' && analysisScope === 'clip' && segments.length > 0 && (
                <div className="flex-1 overflow-hidden flex flex-col">
                    {/* Summary */}
                    <div className="mb-3 p-2 bg-gray-800/50 rounded-lg border border-gray-700 flex items-center justify-between">
                        <div className="text-xs">
                            <span className="text-gray-400">Found </span>
                            <span className="text-white font-bold">{segments.length}</span>
                            <span className="text-gray-400"> segments</span>
                        </div>
                        <div className={`px-2 py-0.5 rounded-full text-xs ${getScoreBg(finalScore)}`}>
                            <span className={`font-bold ${getScoreColor(finalScore)}`}>
                                {finalScore}/100
                            </span>
                        </div>
                    </div>

                    {/* Selection Controls */}
                    <div className="flex gap-2 mb-2 text-xs">
                        <button
                            onClick={handleSelectAll}
                            className="text-indigo-400 hover:text-indigo-300"
                        >
                            All
                        </button>
                        <span className="text-gray-600">|</span>
                        <button
                            onClick={handleDeselectAll}
                            className="text-indigo-400 hover:text-indigo-300"
                        >
                            None
                        </button>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-400">
                            {selectedSegments.size} selected
                        </span>
                    </div>

                    {/* Segments List */}
                    <div className="flex-1 overflow-y-auto space-y-2 pr-1">
                        {segments.map((segment, index) => (
                            <div
                                key={segment.id}
                                className={`p-2 rounded-lg border cursor-pointer transition-all ${selectedSegments.has(segment.id)
                                    ? 'bg-indigo-500/20 border-indigo-500/50'
                                    : 'bg-gray-800/50 border-gray-700 hover:border-gray-600'
                                    }`}
                                onClick={() => handleToggleSegment(segment.id)}
                            >
                                <div className="flex items-center justify-between">
                                    <div className="flex items-center gap-2">
                                        <input
                                            type="checkbox"
                                            checked={selectedSegments.has(segment.id)}
                                            onChange={() => handleToggleSegment(segment.id)}
                                            className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                                            onClick={(e) => e.stopPropagation()}
                                        />
                                        <div className="text-xs">
                                            <span className="text-white font-medium">#{index + 1}</span>
                                            <span className="text-gray-400 ml-2">
                                                {formatTime(segment.startTime)} → {formatTime(segment.endTime)}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleTrimToSingleSegment(segment);
                                            }}
                                            className="text-[10px] px-2 py-0.5 bg-gray-700 hover:bg-gray-600 text-gray-300 rounded"
                                                title="Trim clip to this segment only"
                                            >
                                                Apply
                                        </button>
                                        <div className={`px-1.5 py-0.5 rounded text-xs ${getScoreBg(segment.score)}`}>
                                            <span className={getScoreColor(segment.score)}>{segment.score}</span>
                                        </div>
                                    </div>
                                </div>
                                <p className="text-[10px] text-gray-500 mt-1 ml-5 line-clamp-1">{segment.reason}</p>
                                {segment.scriptMatch && (
                                    <>
                                        <p className="text-[10px] text-indigo-300 mt-1 ml-5">
                                            Script match: {segment.scriptMatch.beatLabel} · {segment.scriptMatch.similarity}/100
                                        </p>
                                        <p className="text-[10px] text-gray-500 mt-1 ml-5 line-clamp-2">{segment.scriptMatch.excerpt}</p>
                                    </>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* Apply Button */}
                    <div className="mt-3 pt-3 border-t border-gray-700">
                        <button
                            onClick={handleApplySegments}
                            disabled={selectedSegments.size === 0}
                            className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Split into {selectedSegments.size} Clips
                        </button>
                    </div>
                </div>
            )}

            {/* Results (Timeline) */}
            {status === 'complete' && analysisScope === 'timeline' && timelineGroups.length > 0 && (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="mb-3 p-2 bg-gray-800/50 rounded-lg border border-gray-700 flex items-center justify-between">
                        <div className="text-xs">
                            <span className="text-gray-400">Found </span>
                            <span className="text-white font-bold">
                                {timelineGroups.reduce((sum, group) => sum + group.segments.length, 0)}
                            </span>
                            <span className="text-gray-400"> segments across </span>
                            <span className="text-white font-bold">{timelineGroups.length}</span>
                            <span className="text-gray-400"> clips</span>
                        </div>
                        <div className={`px-2 py-0.5 rounded-full text-xs ${getScoreBg(timelineScore)}`}>
                            <span className={`font-bold ${getScoreColor(timelineScore)}`}>
                                {timelineScore}/100
                            </span>
                        </div>
                    </div>

                    <div className="flex gap-2 mb-2 text-xs">
                        <button onClick={handleSelectAllTimeline} className="text-indigo-400 hover:text-indigo-300">
                            All
                        </button>
                        <span className="text-gray-600">|</span>
                        <button onClick={handleDeselectAllTimeline} className="text-indigo-400 hover:text-indigo-300">
                            None
                        </button>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-400">
                            {timelineSelected.size} selected
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                        {timelineGroups.map(group => (
                            <div key={group.clipId} className="bg-gray-800/40 border border-gray-700 rounded-lg p-2">
                                <div className="text-xs font-semibold text-gray-200">{group.clipLabel}</div>
                                <div className="mt-2 space-y-2">
                                    {group.segments.map((segment, index) => {
                                        const key = buildTimelineKey(group.clipId, segment.id);
                                        const isSelected = timelineSelected.has(key);
                                        return (
                                            <div
                                                key={key}
                                                className={`p-2 rounded-lg border cursor-pointer transition-all ${isSelected
                                                    ? 'bg-indigo-500/20 border-indigo-500/50'
                                                    : 'bg-gray-900/40 border-gray-700 hover:border-gray-600'
                                                    }`}
                                                onClick={() => handleToggleTimelineSegment(key)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => handleToggleTimelineSegment(key)}
                                                            className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                        <div className="text-xs">
                                                            <span className="text-white font-medium">#{index + 1}</span>
                                                            <span className="text-gray-400 ml-2">
                                                                {formatTime(segment.startTime)} → {formatTime(segment.endTime)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className={`px-1.5 py-0.5 rounded text-xs ${getScoreBg(segment.score)}`}>
                                                        <span className={getScoreColor(segment.score)}>{segment.score}</span>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-gray-500 mt-1 ml-5 line-clamp-1">{segment.reason}</p>
                                                {segment.scriptMatch && (
                                                    <>
                                                        <p className="text-[10px] text-indigo-300 mt-1 ml-5">
                                                            Script match: {segment.scriptMatch.beatLabel} · {segment.scriptMatch.similarity}/100
                                                        </p>
                                                        <p className="text-[10px] text-gray-500 mt-1 ml-5 line-clamp-2">{segment.scriptMatch.excerpt}</p>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                        <p className="text-[10px] text-gray-500">
                            This will append the selected segments as new clips at the end of the active video track.
                        </p>
                        <button
                            onClick={handleApplyTimelineCut}
                            disabled={timelineSelected.size === 0}
                            className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Append {timelineSelected.size} Segments to Timeline
                        </button>
                    </div>
                </div>
            )}

            {status === 'complete' && analysisScope === 'pool' && mediaPoolGroups.length > 0 && (
                <div className="flex-1 overflow-hidden flex flex-col">
                    <div className="mb-3 p-2 bg-gray-800/50 rounded-lg border border-gray-700 flex items-center justify-between">
                        <div className="text-xs">
                            <span className="text-gray-400">Found </span>
                            <span className="text-white font-bold">
                                {mediaPoolGroups.reduce((sum, group) => sum + group.segments.length, 0)}
                            </span>
                            <span className="text-gray-400"> segments across </span>
                            <span className="text-white font-bold">{mediaPoolGroups.length}</span>
                            <span className="text-gray-400"> media files</span>
                        </div>
                        <div className={`px-2 py-0.5 rounded-full text-xs ${getScoreBg(mediaPoolScore)}`}>
                            <span className={`font-bold ${getScoreColor(mediaPoolScore)}`}>
                                {mediaPoolScore}/100
                            </span>
                        </div>
                    </div>

                    {sceneDailies.length > 0 && (
                        <div className="mb-3 rounded-lg border border-gray-700 bg-gray-800/40 p-2">
                            <div className="flex items-center justify-between gap-2">
                                <div>
                                    <p className="text-xs font-semibold text-white">Scene Dailies</p>
                                    <p className="text-[10px] text-gray-500">
                                        Covered {coveredSceneCount}/{sceneDailies.length} script scenes with matched footage.
                                    </p>
                                </div>
                                <button
                                    onClick={handleSelectBestPerScene}
                                    className="rounded border border-gray-700 px-2 py-1 text-[10px] text-gray-300 hover:border-gray-600 hover:text-white"
                                >
                                    Select best per scene
                                </button>
                            </div>
                            <div className="mt-2 max-h-48 space-y-2 overflow-y-auto pr-1">
                                {sceneDailies.map((entry) => (
                                    <div key={entry.beatId} className="rounded border border-gray-700 bg-gray-900/40 p-2">
                                        <div className="flex items-start justify-between gap-3">
                                            <div className="min-w-0">
                                                <p className="text-xs font-medium text-gray-100">{entry.beatLabel}</p>
                                                <p className="mt-0.5 line-clamp-2 text-[10px] text-gray-500">{entry.excerpt}</p>
                                            </div>
                                            <div className="shrink-0 text-right text-[10px] text-gray-400">
                                                <p>{entry.candidateCount} takes</p>
                                                <p>{entry.selectedCount} selected</p>
                                            </div>
                                        </div>
                                        {entry.topCandidate ? (
                                            <div className="mt-2 text-[10px] text-gray-300">
                                                <p>
                                                    Best: {entry.topCandidate.mediaName} · {formatTime(entry.topCandidate.startTime)} → {formatTime(entry.topCandidate.endTime)} · {entry.topCandidate.score}/100
                                                </p>
                                                <p className="mt-0.5 line-clamp-2 text-gray-500">
                                                    {entry.topCandidate.summary || entry.topCandidate.reason}
                                                </p>
                                            </div>
                                        ) : (
                                            <p className="mt-2 text-[10px] text-yellow-400">
                                                No matching footage found for this scene yet.
                                            </p>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    <div className="flex gap-2 mb-2 text-xs">
                        <button onClick={handleSelectAllMediaPool} className="text-indigo-400 hover:text-indigo-300">
                            All
                        </button>
                        <span className="text-gray-600">|</span>
                        <button onClick={handleDeselectAllMediaPool} className="text-indigo-400 hover:text-indigo-300">
                            None
                        </button>
                        <span className="text-gray-600">|</span>
                        <span className="text-gray-400">
                            {mediaPoolSelected.size} selected
                        </span>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-1">
                        {mediaPoolGroups.map(group => (
                            <div key={group.mediaId} className="bg-gray-800/40 border border-gray-700 rounded-lg p-2">
                                <div className="text-xs font-semibold text-gray-200">{group.mediaName}</div>
                                <div className="mt-2 space-y-2">
                                    {group.segments.map((segment, index) => {
                                        const key = buildMediaPoolKey(group.mediaId, segment.id);
                                        const isSelected = mediaPoolSelected.has(key);
                                        return (
                                            <div
                                                key={key}
                                                className={`p-2 rounded-lg border cursor-pointer transition-all ${isSelected
                                                    ? 'bg-indigo-500/20 border-indigo-500/50'
                                                    : 'bg-gray-900/40 border-gray-700 hover:border-gray-600'
                                                    }`}
                                                onClick={() => handleToggleMediaPoolSegment(key)}
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div className="flex items-center gap-2">
                                                        <input
                                                            type="checkbox"
                                                            checked={isSelected}
                                                            onChange={() => handleToggleMediaPoolSegment(key)}
                                                            className="w-3 h-3 rounded border-gray-600 bg-gray-700 text-indigo-500"
                                                            onClick={(e) => e.stopPropagation()}
                                                        />
                                                        <div className="text-xs">
                                                            <span className="text-white font-medium">#{index + 1}</span>
                                                            <span className="text-gray-400 ml-2">
                                                                {formatTime(segment.startTime)} → {formatTime(segment.endTime)}
                                                            </span>
                                                        </div>
                                                    </div>
                                                    <div className={`px-1.5 py-0.5 rounded text-xs ${getScoreBg(segment.score)}`}>
                                                        <span className={getScoreColor(segment.score)}>{segment.score}</span>
                                                    </div>
                                                </div>
                                                <p className="text-[10px] text-gray-500 mt-1 ml-5 line-clamp-1">{segment.reason}</p>
                                                {segment.scriptMatch && (
                                                    <>
                                                        <p className="text-[10px] text-indigo-300 mt-1 ml-5">
                                                            Script match: {segment.scriptMatch.beatLabel} · {segment.scriptMatch.similarity}/100
                                                        </p>
                                                        <p className="text-[10px] text-gray-500 mt-1 ml-5 line-clamp-2">{segment.scriptMatch.excerpt}</p>
                                                    </>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))}
                    </div>

                    <div className="mt-3 pt-3 border-t border-gray-700 space-y-2">
                        <p className="text-[10px] text-gray-500">
                            This will append the selected media-pool segments as source trims on the end of the first unlocked video track, ordered by script scene when available.
                        </p>
                        <button
                            onClick={handleApplyMediaPoolCut}
                            disabled={mediaPoolSelected.size === 0}
                            className="w-full py-2 bg-green-600 hover:bg-green-500 disabled:bg-gray-700 disabled:text-gray-500 text-white rounded-lg text-sm font-medium transition-colors"
                        >
                            Build Rough Cut from {mediaPoolSelected.size} Segments
                        </button>
                    </div>
                </div>
            )}

            {/* No Results */}
            {status === 'complete' && analysisScope === 'clip' && segments.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400 text-sm">
                        <p>No usable segments found.</p>
                        <p className="text-xs mt-1">Try lowering the threshold.</p>
                    </div>
                </div>
            )}

            {status === 'complete' && analysisScope === 'timeline' && timelineGroups.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400 text-sm">
                        <p>No usable segments found across the timeline.</p>
                        <p className="text-xs mt-1">Try lowering the threshold.</p>
                    </div>
                </div>
            )}

            {status === 'complete' && analysisScope === 'pool' && mediaPoolGroups.length === 0 && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center text-gray-400 text-sm">
                        <p>
                            {hasScriptGuidance && config.useScriptMatching
                                ? 'No usable script-matched footage found in the media pool.'
                                : 'No usable footage found in the media pool.'}
                        </p>
                        <p className="text-xs mt-1">Try lowering the threshold or include used footage.</p>
                    </div>
                </div>
            )}

            {/* Analyze Button */}
            {status === 'idle' && selectedClip && (
                <div className="space-y-2">
                    <button
                        onClick={handleAnalyze}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Analyze Clip
                    </button>
                    <button
                        onClick={handleAnalyzeTimeline}
                        className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Analyze Full Timeline
                    </button>
                    <button
                        onClick={handleAnalyzeMediaPool}
                        className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Analyze Media Pool
                    </button>
                </div>
            )}

            {status === 'idle' && !selectedClip && (
                <div className="space-y-2">
                    <button
                        onClick={handleAnalyzeTimeline}
                        className="w-full py-2 bg-gray-700 hover:bg-gray-600 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Analyze Full Timeline
                    </button>
                    <button
                        onClick={handleAnalyzeMediaPool}
                        className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                    >
                        Analyze Media Pool
                    </button>
                </div>
            )}

            {/* Retry Button */}
            {status === 'error' && (
                <button
                    onClick={analysisScope === 'timeline'
                        ? handleAnalyzeTimeline
                        : analysisScope === 'pool'
                            ? handleAnalyzeMediaPool
                            : handleAnalyze}
                    className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    Retry
                </button>
            )}
        </div>
    );
};

export default AutoCutPanel;
