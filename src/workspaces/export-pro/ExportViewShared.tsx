/** Pieces shared by the Premiere and DaVinci export views. */
import React from 'react';
import { FileCode, Film, Image, Images, Music, Play, RotateCcw, Trash2 } from 'lucide-react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import {
    formatTimecode,
    parseTimecode,
    type DestinationKind,
    type ResolvedRange,
    type SourceInfo,
} from './deliveryModel';
import type { ExportJob, ExportPageState, JobStatus } from './exportState';
import { Field, NumberInput, Select, type ExportDispatch } from './ExportFields';

export type ExportViewModel = {
    state: ExportPageState;
    dispatch: ExportDispatch;
    hasElectron: boolean;
    pickFolder?: () => void;
    pickFile?: (target: 'overlay' | 'lut') => void;
    viewer: React.ReactNode;
    duration: number;
    range: ResolvedRange;
    previewTime: number;
    sourceInfo: SourceInfo;
    timelineName: string;
    message: { text: string; tone: 'info' | 'error' } | null;
    exportBlockReason: string | null;
    /** Renderer preflight warnings for FFmpeg jobs (see preflight.ts). */
    preflight: string[];
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    mediaItems: MediaItem[];
    onSeek: (seconds: number) => void;
    onOpenOutput: (job: ExportJob) => void;
};

export const DESTINATION_ICONS: Record<DestinationKind, React.ReactNode> = {
    media: <Film size={14} />,
    interchange: <FileCode size={14} />,
    still: <Image size={14} />,
    sequence: <Images size={14} />,
    audio: <Music size={14} />,
};

export const STATUS_LABELS: Record<JobStatus, string> = {
    pending: 'Wartend',
    running: 'Läuft',
    done: 'Fertig',
    error: 'Fehler',
    cancelled: 'Abgebrochen',
};

export const TimecodeInput: React.FC<{ aid: string; value: number; fps: number; disabled?: boolean; onChange: (seconds: number) => void }> = ({ aid, value, fps, disabled, onChange }) => {
    const [draft, setDraft] = React.useState(formatTimecode(value, fps));
    React.useEffect(() => setDraft(formatTimecode(value, fps)), [value, fps]);
    const commit = () => {
        const parsed = parseTimecode(draft, fps);
        if (parsed === null) setDraft(formatTimecode(value, fps));
        else onChange(parsed);
    };
    return (
        <input
            className="xp-input xp-input--tc"
            data-automation-id={aid}
            value={draft}
            disabled={disabled}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => { if (event.key === 'Enter') commit(); }}
        />
    );
};

/** Frame size / rate / scaling for still and sequence outputs. */
export const FrameFields: React.FC<{ vm: ExportViewModel; withFps?: boolean }> = ({ vm, withFps }) => {
    const { video } = vm.state.settings;
    const v = (patch: Record<string, unknown>) => vm.dispatch('export.settings.patch', { section: 'video', patch });
    return (
        <>
            <Field label="Bildgröße">
                <NumberInput aid="export.settings.frame.width" value={video.width} min={16} max={8192} onChange={(width) => v({ width })} />
                <span className="xp-unit">×</span>
                <NumberInput aid="export.settings.frame.height" value={video.height} min={16} max={8192} onChange={(height) => v({ height })} />
            </Field>
            <Field label="Skalierung">
                <Select aid="export.settings.frame.scaleMode" value={video.scaleMode} options={[{ value: 'fit', label: 'Einpassen' }, { value: 'fill', label: 'Füllen' }, { value: 'stretch', label: 'Strecken' }]} onChange={(scaleMode) => v({ scaleMode })} />
            </Field>
            {withFps ? (
                <Field label="Framerate">
                    <Select aid="export.settings.frame.fps" value={String(video.fps)} options={[24, 25, 30, 48, 50, 60].map((fps) => ({ value: String(fps), label: `${fps} fps` }))} onChange={(fps) => v({ fps: Number(fps) })} />
                </Field>
            ) : null}
        </>
    );
};

export const sourceLabelOf = (source: SourceInfo) => (source ? `Quelle: ${source.width} × ${source.height}${source.fps ? ` · ${source.fps} fps` : ''}` : 'Quelle: unbekannt');

export const PreflightList: React.FC<{ items: string[] }> = ({ items }) => (items.length === 0 ? null : (
    <div className="xp-note" data-automation-id="export.preflight" style={{ color: 'var(--xp-warn)' }}>
        <strong>Vorabprüfung ({items.length}):</strong>
        {items.slice(0, 4).map((item) => <div key={item}>• {item}</div>)}
        {items.length > 4 ? <div>… {items.length - 4} weitere</div> : null}
    </div>
));

export const JobRow: React.FC<{ vm: ExportViewModel; job: ExportJob; compact?: boolean }> = ({ vm, job, compact }) => {
    const busy = vm.state.queue.some((entry) => entry.status === 'running');
    const pct = job.status === 'done' ? 100 : Math.round(job.progress);
    if (compact) {
        return (
            <div className="xp-chip" data-automation-id={`export.queue.job.${job.id}`} title={job.detail || job.label}>
                <div className="xp-chip__row">
                    {DESTINATION_ICONS[job.kind]}
                    <span className="xp-chip__name">{job.fileName}</span>
                    <span className="xp-status" data-status={job.status}>{job.status === 'running' ? `${pct} %` : STATUS_LABELS[job.status]}</span>
                </div>
                <div className="xp-progress" data-status={job.status}><i style={{ width: `${pct}%` }} /></div>
            </div>
        );
    }
    return (
        <div className="xp-job" data-automation-id={`export.queue.job.${job.id}`} data-status={job.status}>
            <div className="xp-job__title">
                {DESTINATION_ICONS[job.kind]}
                <span title={job.fileName}>{job.timelineName} · {job.fileName}</span>
                <span className="xp-status" data-status={job.status}>{STATUS_LABELS[job.status]}</span>
            </div>
            <div className="xp-job__meta">
                {job.presetLabel} · {formatTimecode(job.range.start, job.settings.video.fps)}
                {job.kind !== 'still' ? ` – ${formatTimecode(job.range.end, job.settings.video.fps)}` : ''}
            </div>
            {job.status === 'running' || job.progress > 0 ? <div className="xp-progress" data-status={job.status}><i style={{ width: `${pct}%` }} /></div> : null}
            {job.detail ? <div className="xp-job__meta" title={job.detail}>{job.detail}</div> : null}
            {job.outputPath ? <div className="xp-job__meta" title={job.outputPath}>→ {job.outputPath}</div> : null}
            <div className="xp-job__actions">
                {job.status !== 'running' ? (
                    <button type="button" className="xp-btn xp-btn--sm" data-automation-id={`export.queue.renderJob.${job.id}`} disabled={busy || Boolean(vm.exportBlockReason && job.kind !== 'interchange')} title={vm.exportBlockReason || 'Diesen Job rendern'} onClick={() => vm.dispatch('export.queue.renderJob', { jobId: job.id })}>
                        <Play size={11} /> Rendern
                    </button>
                ) : null}
                {job.status === 'error' || job.status === 'cancelled' || job.status === 'done' ? (
                    <button type="button" className="xp-btn xp-btn--sm xp-btn--icon" title="Zurücksetzen" data-automation-id={`export.queue.retry.${job.id}`} onClick={() => vm.dispatch('export.queue.retry', { jobId: job.id })}><RotateCcw size={11} /></button>
                ) : null}
                {job.outputPath && job.kind !== 'interchange' && vm.hasElectron ? (
                    <button type="button" className="xp-btn xp-btn--sm" data-automation-id={`export.queue.open.${job.id}`} onClick={() => vm.onOpenOutput(job)}>Ordner</button>
                ) : null}
                <span style={{ flex: 1 }} />
                <button type="button" className="xp-btn xp-btn--sm xp-btn--icon xp-btn--danger" title="Job löschen" data-automation-id={`export.queue.remove.${job.id}`} disabled={job.status === 'running'} onClick={() => vm.dispatch('export.queue.remove', { jobId: job.id })}><Trash2 size={11} /></button>
            </div>
        </div>
    );
};
