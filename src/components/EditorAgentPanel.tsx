import React, { useEffect, useMemo, useState } from 'react';
import {
    AgentApplyBatchSummary,
    AgentReviewPassResult,
    EditPlan,
    EditPlanApplyResult,
    EditPlanOperation,
    EditPlanOperationPreview,
    EditPlanPreview,
    MediaItem,
    NeurocinematicsAnalysisResult,
    TimelineClip,
    TimelineTrack,
} from '../types';
import { generateEditPlan } from '../services/editorAgentService';

interface EditorAgentPanelProps {
    mediaItems: MediaItem[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    selectedClipId: string | null;
    playheadPosition: number;
    apiKeyReady: boolean;
    projectName?: string | null;
    storyContext?: string | null;
    analysisResult?: NeurocinematicsAnalysisResult | null;
    lastAppliedBatch?: AgentApplyBatchSummary | null;
    canUndoLastAppliedBatch: boolean;
    onPreviewPlan: (plan: EditPlan, selectedOperationIds?: string[]) => EditPlanPreview;
    onSelectClip: (clipId: string | null) => void;
    onApplyPlan: (plan: EditPlan, selectedOperationIds?: string[]) => EditPlanApplyResult;
    onUndoLastAppliedBatch: () => void;
    onRunReviewPass: (objective: string) => Promise<AgentReviewPassResult>;
}

const formatTime = (seconds: number | null | undefined) => {
    if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '--:--.-';
    const totalTenths = Math.max(0, Math.round(seconds * 10));
    const mins = Math.floor(totalTenths / 600);
    const secs = Math.floor((totalTenths % 600) / 10);
    const tenths = totalTenths % 10;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${tenths}`;
};

const summarizeText = (value: string | undefined, fallback: string, maxLength = 84) => {
    const compact = (value || '').replace(/\s+/g, ' ').trim();
    if (!compact) return fallback;
    if (compact.length <= maxLength) return compact;
    return `${compact.slice(0, maxLength - 3).trimEnd()}...`;
};

const normalizeColor = (value: string | undefined) => {
    if (!value) return '#FFFFFF';
    return /^#(?:[0-9a-f]{3}){1,2}$/i.test(value.trim()) ? value.trim() : '#FFFFFF';
};

const describeOperation = (operation: EditPlanOperation, clipLabel: string) => {
    switch (operation.type) {
        case 'trim_clip':
            return `Trim ${clipLabel}${typeof operation.start === 'number' ? ` from ${formatTime(operation.start)}` : ''}${typeof operation.end === 'number' ? ` to ${formatTime(operation.end)}` : ''}`;
        case 'move_clip':
            return `Move ${clipLabel} to ${formatTime(operation.start)}${operation.trackId ? ` on ${operation.trackId}` : ''}`;
        case 'delete_clip':
            return `${operation.ripple ? 'Ripple delete' : 'Delete'} ${clipLabel}`;
        case 'set_transition':
            return `Add ${operation.transitionType} to ${clipLabel}${typeof operation.transitionDuration === 'number' ? ` (${operation.transitionDuration.toFixed(2)}s)` : ''}`;
        case 'set_text_overlay':
            return `Overlay "${summarizeText(operation.textContent, 'Text', 36)}" on ${clipLabel}`;
        default:
            return clipLabel;
    }
};

const describeClipSnapshot = (snapshot?: EditPlanOperationPreview['before'] | null) => {
    if (!snapshot) return 'Removed from timeline';
    const base = `${snapshot.trackLabel} ${formatTime(snapshot.start)}-${formatTime(snapshot.end)}`;
    const extras = [
        snapshot.transitionType || null,
        snapshot.textOverlay ? `Text: ${summarizeText(snapshot.textOverlay, '', 24)}` : null,
    ].filter(Boolean);
    return `${base}${extras.length > 0 ? ` · ${extras.join(' · ')}` : ''}`;
};

const EditorAgentPanel: React.FC<EditorAgentPanelProps> = ({
    mediaItems,
    timelineClips,
    timelineTracks,
    selectedClipId,
    playheadPosition,
    apiKeyReady,
    projectName,
    storyContext,
    analysisResult,
    lastAppliedBatch,
    canUndoLastAppliedBatch,
    onPreviewPlan,
    onSelectClip,
    onApplyPlan,
    onUndoLastAppliedBatch,
    onRunReviewPass,
}) => {
    const [objective, setObjective] = useState('Tighten pacing, reduce dead air, and improve continuity without changing the story.');
    const [plan, setPlan] = useState<EditPlan | null>(null);
    const [selectedOperationIds, setSelectedOperationIds] = useState<string[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isApplying, setIsApplying] = useState(false);
    const [isReviewing, setIsReviewing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [applyResult, setApplyResult] = useState<EditPlanApplyResult | null>(null);
    const [reviewResult, setReviewResult] = useState<AgentReviewPassResult | null>(null);

    const mediaById = useMemo(
        () => new Map(mediaItems.map((item) => [item.id, item])),
        [mediaItems],
    );

    const trackLabels = useMemo(() => {
        const labels = new Map<string, string>();
        timelineTracks.forEach((track) => {
            const siblings = timelineTracks.filter((entry) => entry.type === track.type);
            const index = siblings.findIndex((entry) => entry.id === track.id);
            const prefix = track.type === 'audio' ? 'A' : 'V';
            labels.set(track.id, `${prefix}${index >= 0 ? index + 1 : 1}`);
        });
        return labels;
    }, [timelineTracks]);

    const clipLabelById = useMemo(() => {
        const map = new Map<string, string>();
        timelineClips.forEach((clip) => {
            const media = mediaById.get(clip.mediaId);
            const trackLabel = trackLabels.get(clip.trackId) || clip.trackId;
            const label = `${trackLabel} ${formatTime(clip.start)}-${formatTime(clip.end)} · ${summarizeText(media?.prompt || media?.name, clip.id)}`;
            map.set(clip.id, label);
        });
        return map;
    }, [mediaById, timelineClips, trackLabels]);

    const selectedCount = selectedOperationIds.length;
    const planPreview = useMemo(
        () => (plan ? onPreviewPlan(plan, selectedOperationIds) : null),
        [onPreviewPlan, plan, selectedOperationIds],
    );
    const previewByOperationId = useMemo(
        () => new Map((planPreview?.operationPreviews || []).map((entry) => [entry.operationId, entry])),
        [planPreview],
    );
    const readyCount = planPreview?.readyOperationIds.length || 0;
    const rejectedCount = planPreview?.rejectedOperationIds.length || 0;

    useEffect(() => {
        return () => {
            if (reviewResult?.draftPreviewUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(reviewResult.draftPreviewUrl);
            }
        };
    }, [reviewResult?.draftPreviewUrl]);

    const toggleOperation = (operationId: string) => {
        setSelectedOperationIds((prev) =>
            prev.includes(operationId)
                ? prev.filter((id) => id !== operationId)
                : [...prev, operationId],
        );
    };

    const handleGenerate = async () => {
        if (timelineClips.length === 0) {
            setError('Add clips to the timeline first.');
            return;
        }

        setIsGenerating(true);
        setError(null);
        setApplyResult(null);
        setReviewResult(null);

        try {
            const nextPlan = await generateEditPlan({
                objective,
                mediaItems,
                timelineClips,
                timelineTracks,
                selectedClipId,
                projectName,
                storyContext,
                analysisResult,
                playheadPosition,
            });
            setPlan(nextPlan);
            setSelectedOperationIds(nextPlan.operations.map((operation) => operation.id));
        } catch (err: any) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsGenerating(false);
        }
    };

    const handleApply = () => {
        if (!plan || readyCount === 0) return;

        setIsApplying(true);
        setError(null);
        try {
            const result = onApplyPlan(plan, selectedOperationIds);
            setApplyResult(result);
            if (result.appliedOperationIds.length > 0) {
                setSelectedOperationIds((prev) => prev.filter((id) => !result.appliedOperationIds.includes(id)));
            }
        } catch (err: any) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsApplying(false);
        }
    };

    const handleReviewPass = async () => {
        setIsReviewing(true);
        setError(null);
        setApplyResult(null);
        try {
            const result = await onRunReviewPass(objective);
            setReviewResult((prev) => {
                if (prev?.draftPreviewUrl?.startsWith('blob:') && prev.draftPreviewUrl !== result.draftPreviewUrl) {
                    URL.revokeObjectURL(prev.draftPreviewUrl);
                }
                return result;
            });
            setPlan(result.plan);
            setSelectedOperationIds(result.plan.operations.map((operation) => operation.id));
        } catch (err: any) {
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setIsReviewing(false);
        }
    };

    return (
        <div className="bg-gray-800/50 p-4 flex flex-col h-full text-gray-300">
            <div className="flex items-start justify-between gap-3 mb-3">
                <div>
                    <h3 className="text-lg font-semibold text-white">Edit Agent</h3>
                    <p className="text-[11px] text-gray-500 mt-1">
                        Phase 2 previews diffs, groups agent edits into one undo step, and can review a rendered draft before recutting.
                    </p>
                </div>
                <span className={`text-[10px] px-2 py-1 rounded border ${apiKeyReady ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'}`}>
                    {apiKeyReady ? 'AI plan' : 'Heuristic plan'}
                </span>
            </div>

            <div className="space-y-3">
                <div>
                    <label className="block text-[10px] uppercase tracking-widest text-gray-500 mb-1">Goal</label>
                    <textarea
                        value={objective}
                        onChange={(event) => setObjective(event.target.value)}
                        rows={4}
                        className="w-full bg-gray-900/70 border border-gray-700 rounded-lg p-2 text-xs text-gray-200"
                        placeholder="What should the edit agent optimize?"
                    />
                </div>

                <div className="flex items-center gap-2">
                    <button
                        onClick={handleGenerate}
                        disabled={isGenerating || isReviewing}
                        className="flex-1 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 rounded-lg text-sm"
                    >
                        {isGenerating ? 'Planning...' : 'Generate Edit Plan'}
                    </button>
                    <button
                        onClick={handleReviewPass}
                        disabled={isGenerating || isApplying || isReviewing || !apiKeyReady}
                        className="bg-sky-700 hover:bg-sky-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 px-3 rounded-lg text-sm"
                    >
                        {isReviewing ? 'Reviewing...' : 'Review Draft'}
                    </button>
                    {plan && (
                        <button
                            onClick={handleApply}
                            disabled={isApplying || readyCount === 0}
                            className="bg-emerald-700 hover:bg-emerald-600 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2 px-3 rounded-lg text-sm"
                        >
                            {isApplying ? 'Applying...' : `Apply ${readyCount}`}
                        </button>
                    )}
                </div>

                <div className="grid grid-cols-2 gap-2 text-[10px] text-gray-500">
                    <div>Clips: <span className="text-gray-300">{timelineClips.length}</span></div>
                    <div>Playhead: <span className="text-gray-300">{formatTime(playheadPosition)}</span></div>
                    <div>Selected: <span className="text-gray-300">{selectedClipId || 'none'}</span></div>
                    <div>Tracks: <span className="text-gray-300">{timelineTracks.length}</span></div>
                </div>

                {lastAppliedBatch && (
                    <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 text-xs">
                        <div className="flex items-center justify-between gap-3">
                            <div>
                                <div className="text-white font-medium">Last Agent Batch</div>
                                <div className="text-gray-400 mt-1">{lastAppliedBatch.label} · {lastAppliedBatch.operationCount} ops</div>
                            </div>
                            <button
                                onClick={onUndoLastAppliedBatch}
                                disabled={!canUndoLastAppliedBatch}
                                className="px-3 py-1.5 rounded border border-gray-600 text-gray-200 hover:border-gray-400 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Undo Batch
                            </button>
                        </div>
                        {!canUndoLastAppliedBatch && (
                            <div className="mt-2 text-[11px] text-gray-500">
                                Undo is available only while the current timeline still matches the last applied agent batch.
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">
                        {error}
                    </div>
                )}

                {applyResult && (
                    <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100">
                        <div className="text-white">Applied: {applyResult.appliedOperationIds.length}</div>
                        {applyResult.rejected.length > 0 && (
                            <div className="mt-1 text-amber-200">
                                Rejected: {applyResult.rejected.map((entry) => entry.message).join(' | ')}
                            </div>
                        )}
                    </div>
                )}

                {reviewResult && (
                    <div className="rounded-lg border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-100 space-y-2">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-white font-medium">
                                {reviewResult.usedRenderedDraft ? 'Rendered Draft Review' : 'Timeline Review'}
                            </div>
                            {reviewResult.reviewFeedback && (
                                <div className="text-white">{reviewResult.reviewFeedback.overallScore}/10</div>
                            )}
                        </div>
                        {reviewResult.reviewFeedback?.summary && (
                            <p>{reviewResult.reviewFeedback.summary}</p>
                        )}
                        {reviewResult.reviewFeedback?.weaknesses?.length ? (
                            <p className="text-amber-100">
                                Weak spots: {reviewResult.reviewFeedback.weaknesses.slice(0, 3).join(' | ')}
                            </p>
                        ) : null}
                        {reviewResult.note && (
                            <p className="text-[11px] text-sky-200">{reviewResult.note}</p>
                        )}
                        {reviewResult.draftOutputPath && (
                            <p className="text-[11px] text-sky-200 break-all">{reviewResult.draftOutputPath}</p>
                        )}
                        {reviewResult.draftPreviewUrl && (
                            <video
                                src={reviewResult.draftPreviewUrl}
                                controls
                                className="w-full rounded-lg bg-black"
                            />
                        )}
                    </div>
                )}
            </div>

            {!plan ? (
                <div className="flex-1 flex items-center justify-center text-center text-xs text-gray-500 px-4">
                    Generate a plan to get an editable diff of proposed timeline operations.
                </div>
            ) : (
                <div className="flex-1 min-h-0 overflow-y-auto mt-4 pr-1 space-y-3">
                    <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3">
                        <div className="flex items-center justify-between gap-3">
                            <div className="text-sm font-semibold text-white">Plan Summary</div>
                            <span className="text-[10px] uppercase tracking-widest text-gray-500">{plan.source}</span>
                        </div>
                        <p className="text-xs text-gray-300 mt-2">{plan.summary}</p>
                        {plan.risks && plan.risks.length > 0 && (
                            <div className="mt-2 text-[11px] text-amber-200">
                                {plan.risks.join(' ')}
                            </div>
                        )}
                    </div>

                    {planPreview && (
                        <div className="rounded-lg border border-gray-700 bg-gray-900/40 p-3 space-y-2">
                            <div className="flex items-center justify-between gap-3">
                                <div className="text-sm font-semibold text-white">Preview Diff</div>
                                <div className="text-[10px] text-gray-500">
                                    Ready {readyCount} · Rejected {rejectedCount}
                                </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-400">
                                <div>Touched clips: <span className="text-gray-200">{planPreview.touchedClipIds.length}</span></div>
                                <div>Duration delta: <span className="text-gray-200">{planPreview.totalDurationDelta >= 0 ? '+' : ''}{planPreview.totalDurationDelta.toFixed(2)}s</span></div>
                            </div>
                        </div>
                    )}

                    {plan.findings.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] uppercase tracking-widest text-gray-500">Findings</div>
                                <div className="text-[10px] text-gray-600">{plan.findings.length}</div>
                            </div>
                            {plan.findings.map((finding) => (
                                <div
                                    key={finding.id}
                                    className={`rounded-lg border p-3 text-xs ${
                                        finding.severity === 'warning'
                                            ? 'border-amber-500/30 bg-amber-500/10 text-amber-100'
                                            : finding.severity === 'opportunity'
                                                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
                                                : 'border-gray-700 bg-gray-900/40 text-gray-200'
                                    }`}
                                >
                                    <div className="font-semibold text-white">{finding.title}</div>
                                    <div className="mt-1">{finding.detail}</div>
                                    {finding.clipIds && finding.clipIds.length > 0 && (
                                        <div className="mt-2 flex flex-wrap gap-1">
                                            {finding.clipIds.map((clipId) => (
                                                <button
                                                    key={clipId}
                                                    onClick={() => onSelectClip(clipId)}
                                                    className="px-2 py-0.5 rounded bg-black/20 border border-white/10 text-[10px] hover:bg-black/30"
                                                >
                                                    {clipLabelById.get(clipId) || clipId}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <div className="text-[10px] uppercase tracking-widest text-gray-500">Operations</div>
                            <div className="flex items-center gap-2 text-[10px]">
                                <button onClick={() => setSelectedOperationIds(plan.operations.map((operation) => operation.id))} className="text-gray-500 hover:text-gray-300">All</button>
                                <button onClick={() => setSelectedOperationIds([])} className="text-gray-500 hover:text-gray-300">None</button>
                            </div>
                        </div>
                        {plan.operations.length === 0 ? (
                            <div className="rounded-lg border border-gray-700 bg-gray-900/30 p-3 text-xs text-gray-500">
                                No concrete timeline ops were proposed for this snapshot.
                            </div>
                        ) : (
                            plan.operations.map((operation) => {
                                const checked = selectedOperationIds.includes(operation.id);
                                const clipLabel = clipLabelById.get(operation.clipId) || operation.clipId;
                                const preview = previewByOperationId.get(operation.id);
                                return (
                                    <div key={operation.id} className={`rounded-lg border p-3 ${checked ? 'border-indigo-500/40 bg-indigo-500/10' : 'border-gray-700 bg-gray-900/40'}`}>
                                        <div className="flex items-start gap-3">
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleOperation(operation.id)}
                                                className="mt-0.5 accent-indigo-500"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-start justify-between gap-3">
                                                    <div className="text-sm font-medium text-white">
                                                        {describeOperation(operation, clipLabel)}
                                                    </div>
                                                    <span className="text-[10px] text-gray-500 whitespace-nowrap">
                                                        {Math.round(operation.confidence * 100)}%
                                                    </span>
                                                </div>
                                                <div className="mt-1 text-xs text-gray-400">{operation.reason}</div>
                                                {operation.type === 'set_text_overlay' && (
                                                    <div className="mt-2 text-[11px] text-gray-500">
                                                        {operation.textPosition || 'center'} · {operation.textSize || 48}px · {normalizeColor(operation.textColor)}
                                                    </div>
                                                )}
                                                {preview && (
                                                    <div className={`mt-2 rounded border p-2 text-[11px] ${
                                                        preview.status === 'ready'
                                                            ? 'border-emerald-500/20 bg-emerald-500/5 text-emerald-100'
                                                            : 'border-amber-500/20 bg-amber-500/5 text-amber-100'
                                                    }`}>
                                                        <div className="font-medium text-white">{preview.title}</div>
                                                        <div className="mt-1">{preview.message}</div>
                                                        <div className="mt-1 text-[10px] text-gray-300">
                                                            Before: {describeClipSnapshot(preview.before)}
                                                        </div>
                                                        <div className="text-[10px] text-gray-300">
                                                            After: {describeClipSnapshot(preview.after)}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                        <div className="mt-2 flex items-center justify-between gap-2">
                                            <div className="text-[10px] text-gray-600">{operation.id}</div>
                                            <button
                                                onClick={() => onSelectClip(operation.clipId)}
                                                className="text-[10px] px-2 py-0.5 rounded border border-gray-600 text-gray-300 hover:border-indigo-400 hover:text-white"
                                            >
                                                Focus Clip
                                            </button>
                                        </div>
                                    </div>
                                );
                            })
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

export default EditorAgentPanel;
