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

    const busy = isGenerating || isReviewing || isApplying;
    const scoreClass = (score: number) => (score >= 8 ? 'pk-score--good' : score >= 5 ? 'pk-score--mid' : 'pk-score--low');

    return (
        <div className="fx-browser">
            <div className="fx-browser__header">
                <h3 className="fx-browser__title">Edit Agent</h3>
                <span className={`pk-chip ${apiKeyReady ? 'pk-chip--ok' : 'pk-chip--warn'}`} title={apiKeyReady ? 'Plans are written by the AI model' : 'No API key — plans use built-in heuristics'}>
                    {apiKeyReady ? 'AI plan' : 'Heuristic plan'}
                </span>
            </div>

            <div className="fx-browser__scroll">
                <div className="pk-stack">
                    <label className="pk-field">
                        <span>Goal</span>
                        <textarea
                            value={objective}
                            onChange={(event) => setObjective(event.target.value)}
                            rows={3}
                            placeholder="What should the agent improve? e.g. tighten pacing, remove dead air…"
                        />
                    </label>

                    <div className="pk-actions">
                        <button type="button" className="edit-text-btn edit-text-btn--primary grow" onClick={handleGenerate} disabled={busy || timelineClips.length === 0}>
                            {isGenerating ? 'Planning…' : plan ? 'Plan again' : 'Generate plan'}
                        </button>
                        <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={handleReviewPass} disabled={busy || !apiKeyReady} title={apiKeyReady ? 'Render a draft and let the agent review it' : 'Needs an API key'}>
                            {isReviewing ? 'Reviewing…' : 'Review draft'}
                        </button>
                    </div>

                    <div className="pk-chips">
                        <span className="pk-chip"><strong>{timelineClips.length}</strong> clips</span>
                        <span className="pk-chip"><strong>{timelineTracks.length}</strong> tracks</span>
                        <span className="pk-chip pk-mono">{formatTime(playheadPosition)}</span>
                        {selectedClipId && <span className="pk-chip pk-chip--accent">1 selected</span>}
                    </div>

                    {timelineClips.length === 0 && !plan && (
                        <div className="pk-empty">
                            <strong>Nothing to plan yet</strong>
                            <span>Add clips to the timeline and the agent will propose trims, moves, transitions and text.</span>
                        </div>
                    )}

                    {error && <div className="pk-alert pk-alert--danger">{error}</div>}

                    {applyResult && (
                        <div className="pk-alert pk-alert--ok">
                            Applied {applyResult.appliedOperationIds.length} change{applyResult.appliedOperationIds.length === 1 ? '' : 's'} as one undo step.
                            {applyResult.rejected.length > 0 && (
                                <div className="pk-hint" style={{ marginTop: '0.25rem' }}>Skipped: {applyResult.rejected.map((entry) => entry.message).join(' · ')}</div>
                            )}
                        </div>
                    )}

                    {lastAppliedBatch && (
                        <div className="pk-card">
                            <div className="pk-card__head">
                                <div style={{ minWidth: 0 }}>
                                    <div className="pk-card__title">Last agent batch</div>
                                    <div className="pk-hint">{lastAppliedBatch.label} · {lastAppliedBatch.operationCount} ops</div>
                                </div>
                                <button type="button" className="edit-text-btn edit-text-btn--outline" onClick={onUndoLastAppliedBatch} disabled={!canUndoLastAppliedBatch} title={canUndoLastAppliedBatch ? 'Revert everything from that batch' : 'The timeline has changed since; undo is no longer safe'}>
                                    Undo
                                </button>
                            </div>
                        </div>
                    )}

                    {reviewResult && (
                        <div className="pk-card pk-card--accent">
                            <div className="pk-card__head">
                                <div className="pk-card__title">{reviewResult.usedRenderedDraft ? 'Draft review' : 'Timeline review'}</div>
                                {reviewResult.reviewFeedback && <span className={`pk-score ${scoreClass(reviewResult.reviewFeedback.overallScore)}`}>{reviewResult.reviewFeedback.overallScore}/10</span>}
                            </div>
                            {reviewResult.reviewFeedback?.summary && <p className="pk-body">{reviewResult.reviewFeedback.summary}</p>}
                            {reviewResult.reviewFeedback?.weaknesses?.length ? (
                                <p className="pk-hint">Weak spots: {reviewResult.reviewFeedback.weaknesses.slice(0, 3).join(' · ')}</p>
                            ) : null}
                            {reviewResult.note && <p className="pk-hint">{reviewResult.note}</p>}
                            {reviewResult.draftPreviewUrl && <video src={reviewResult.draftPreviewUrl} controls className="w-full rounded-lg bg-black" />}
                        </div>
                    )}

                    {plan && (
                        <>
                            <div className="pk-card">
                                <div className="pk-card__head">
                                    <div className="pk-card__title">Plan</div>
                                    <span className="pk-chip">{plan.source}</span>
                                </div>
                                <p className="pk-body">{plan.summary}</p>
                                {plan.risks && plan.risks.length > 0 && <p className="pk-hint" style={{ color: 'var(--app-warm)' }}>{plan.risks.join(' ')}</p>}
                                {planPreview && (
                                    <div className="pk-chips">
                                        <span className="pk-chip pk-chip--ok"><strong>{readyCount}</strong> ready</span>
                                        {rejectedCount > 0 && <span className="pk-chip pk-chip--warn"><strong>{rejectedCount}</strong> blocked</span>}
                                        <span className="pk-chip"><strong>{planPreview.touchedClipIds.length}</strong> clips touched</span>
                                        <span className="pk-chip pk-mono">{planPreview.totalDurationDelta >= 0 ? '+' : ''}{planPreview.totalDurationDelta.toFixed(2)}s</span>
                                    </div>
                                )}
                            </div>

                            {plan.findings.length > 0 && (
                                <section className="fx-section">
                                    <header className="fx-section__title">Findings · {plan.findings.length}</header>
                                    <div className="pk-list">
                                        {plan.findings.map((finding) => (
                                            <div key={finding.id} className="pk-row">
                                                <div className="pk-row__body">
                                                    <div className="pk-row__title">{finding.title}</div>
                                                    <div className="pk-row__meta">{finding.detail}</div>
                                                    {finding.clipIds && finding.clipIds.length > 0 && (
                                                        <div className="pk-chips" style={{ marginTop: '0.2rem' }}>
                                                            {finding.clipIds.map((clipId) => (
                                                                <button key={clipId} type="button" className="pk-chip pk-chip--accent" onClick={() => onSelectClip(clipId)} title="Select this clip">
                                                                    {summarizeText(clipLabelById.get(clipId) || clipId, clipId, 28)}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                                <span className={`pk-chip ${finding.severity === 'warning' ? 'pk-chip--warn' : finding.severity === 'opportunity' ? 'pk-chip--ok' : ''}`}>{finding.severity}</span>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            )}

                            <section className="fx-section">
                                <header className="fx-section__title" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <span>Changes · {plan.operations.length}</span>
                                    <span style={{ display: 'flex', gap: '0.35rem', textTransform: 'none', letterSpacing: 0 }}>
                                        <button type="button" className="edit-text-btn" onClick={() => setSelectedOperationIds(plan.operations.map((operation) => operation.id))}>All</button>
                                        <button type="button" className="edit-text-btn" onClick={() => setSelectedOperationIds([])}>None</button>
                                    </span>
                                </header>
                                {plan.operations.length === 0 ? (
                                    <div className="pk-card pk-card--quiet"><p className="pk-hint">No concrete timeline changes were proposed for this snapshot.</p></div>
                                ) : (
                                    <div className="pk-list">
                                        {plan.operations.map((operation) => {
                                            const checked = selectedOperationIds.includes(operation.id);
                                            const clipLabel = clipLabelById.get(operation.clipId) || operation.clipId;
                                            const preview = previewByOperationId.get(operation.id);
                                            const blocked = preview && preview.status !== 'ready';
                                            return (
                                                <label key={operation.id} className={`pk-row pk-row--clickable ${checked ? 'pk-row--selected' : ''}`}>
                                                    <input type="checkbox" checked={checked} onChange={() => toggleOperation(operation.id)} aria-label={describeOperation(operation, clipLabel)} />
                                                    <div className="pk-row__body">
                                                        <div className="pk-row__title">{describeOperation(operation, summarizeText(clipLabel, operation.clipId, 40))}</div>
                                                        <div className="pk-row__meta pk-row__meta--clamp">{operation.reason}</div>
                                                        {operation.type === 'set_text_overlay' && (
                                                            <div className="pk-row__meta">{operation.textPosition || 'center'} · {operation.textSize || 48}px · {normalizeColor(operation.textColor)}</div>
                                                        )}
                                                        {preview && (
                                                            <details className="pk-details" onClick={(event) => event.stopPropagation()}>
                                                                <summary style={{ padding: '0.3rem 0.5rem' }}>{blocked ? <span style={{ color: 'var(--app-warm)' }}>{preview.title}</span> : 'Before / after'}</summary>
                                                                <div className="pk-details__body" style={{ padding: '0.4rem 0.5rem 0.5rem' }}>
                                                                    <p className="pk-hint">{preview.message}</p>
                                                                    <p className="pk-hint pk-mono">Before · {describeClipSnapshot(preview.before)}</p>
                                                                    <p className="pk-hint pk-mono">After · {describeClipSnapshot(preview.after)}</p>
                                                                </div>
                                                            </details>
                                                        )}
                                                    </div>
                                                    <div className="pk-row__aside">
                                                        <span className="pk-score" title="Confidence">{Math.round(operation.confidence * 100)}%</span>
                                                        <button type="button" className="edit-text-btn" onClick={(event) => { event.preventDefault(); event.stopPropagation(); onSelectClip(operation.clipId); }} title="Select the affected clip">Show</button>
                                                    </div>
                                                </label>
                                            );
                                        })}
                                    </div>
                                )}
                            </section>
                        </>
                    )}
                </div>
            </div>

            <footer className="fx-browser__footer fx-browser__footer--bar">
                {plan ? (
                    <>
                        <span>{selectedCount} of {plan.operations.length} selected</span>
                        <button type="button" className="edit-text-btn edit-text-btn--primary" onClick={handleApply} disabled={isApplying || readyCount === 0}>
                            {isApplying ? 'Applying…' : `Apply ${readyCount}`}
                        </button>
                    </>
                ) : (
                    <span>Every applied plan is one undo step — nothing changes until you press Apply.</span>
                )}
            </footer>
        </div>
    );
};

export default EditorAgentPanel;
