/**
 * The single viewer of the Cut page. It switches between source clip, source
 * tape and timeline, and turns into the dual-frame trim view (outgoing |
 * incoming) while a cut or clip is selected for trimming.
 */
import React, { useEffect, useRef } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import PreviewPlayer from '../../components/PreviewPlayer';
import { formatTimecode } from '../../utils/timecode';
import type { TapeSegment } from './editOps';
import type { SourceMarks, ViewerMode } from './cutState';
import {
    FastReviewIcon, ForwardIcon, MarkInGlyph, MarkOutGlyph, NextEditIcon, PrevEditIcon, ReverseIcon,
    SourceClipIcon, SourceTapeIcon, StopIcon, TimelineViewIcon,
} from './CutIcons';

/* ─── Media elements ─── */

/** A video/audio/image element that shows `time`, or plays natively when `rate` > 0. */
export const MediaSurface: React.FC<{
    media: MediaItem | null;
    time: number;
    rate?: number;
    muted?: boolean;
    waveform?: number[];
    onTime?: (time: number) => void;
    onEnded?: () => void;
    automationId?: string;
}> = ({ media, time, rate = 0, muted = true, waveform, onTime, onEnded, automationId }) => {
    const ref = useRef<HTMLVideoElement & HTMLAudioElement>(null);
    const callbacks = useRef({ onTime, onEnded });
    callbacks.current = { onTime, onEnded };
    const playing = rate > 0 && (media?.type === 'video' || media?.type === 'audio');

    // Native playback for forward speeds; frame-accurate seeking otherwise.
    useEffect(() => {
        const element = ref.current;
        if (!element || !playing) return;
        let frame = 0;
        try {
            element.playbackRate = Math.min(16, Math.max(0.1, rate));
            element.muted = muted || rate > 2;
            const started = element.play();
            if (started && typeof started.catch === 'function') started.catch(() => undefined);
        } catch { /* element not ready */ }
        const tick = () => {
            if (!ref.current) return;
            callbacks.current.onTime?.(ref.current.currentTime);
            frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        const ended = () => callbacks.current.onEnded?.();
        element.addEventListener('ended', ended);
        return () => {
            cancelAnimationFrame(frame);
            element.removeEventListener('ended', ended);
            try { element.pause(); } catch { /* ignore */ }
        };
    }, [playing, rate, muted, media?.url]);

    useEffect(() => {
        const element = ref.current;
        if (!element || playing) return;
        const seek = () => {
            try {
                const duration = Number.isFinite(element.duration) ? element.duration : Number.POSITIVE_INFINITY;
                const target = Math.max(0, Math.min(duration - 0.001, time));
                if (Math.abs(element.currentTime - target) > 0.015) element.currentTime = target;
            } catch { /* not seekable yet */ }
        };
        seek();
        element.addEventListener('loadedmetadata', seek);
        return () => element.removeEventListener('loadedmetadata', seek);
    }, [time, playing, media?.url]);

    if (!media) return <div className="cutp-surface cutp-surface--empty" data-automation-id={automationId}>Kein Clip</div>;
    if (media.type === 'image') {
        return <div className="cutp-surface" data-automation-id={automationId}><img src={media.url} alt="" draggable={false} /></div>;
    }
    if (media.type === 'audio') {
        const length = media.duration || 1;
        return (
            <div className="cutp-surface cutp-surface--audio" data-automation-id={automationId}>
                <audio ref={ref} src={media.url} preload="auto" />
                {waveform && waveform.length > 0 ? <WaveformSvg peaks={waveform} className="cutp-surface__wave" /> : <span className="cutp-surface__label">Audio</span>}
                <span className="cutp-surface__cursor" style={{ left: `${Math.max(0, Math.min(100, (time / length) * 100))}%` }} />
            </div>
        );
    }
    return (
        <div className="cutp-surface" data-automation-id={automationId}>
            <video ref={ref} src={media.url} muted={muted} playsInline preload="auto" />
        </div>
    );
};

/** Mirrored peak waveform; `from`/`to` (0..1) pick the visible part of the media. */
export const WaveformSvg: React.FC<{ peaks: number[]; from?: number; to?: number; className?: string }> = ({ peaks, from = 0, to = 1, className }) => {
    const start = Math.max(0, Math.floor(from * peaks.length));
    const end = Math.max(start + 1, Math.min(peaks.length, Math.ceil(to * peaks.length)));
    const slice = peaks.slice(start, end);
    if (slice.length === 0) return null;
    const points = slice.map((value, index) => `${index},${(1 - Math.max(0.02, value)) * 50}`).join(' ');
    const lower = slice.map((value, index) => `${index},${50 + Math.max(0.02, value) * 50}`).reverse().join(' ');
    return (
        <svg className={className} viewBox={`0 0 ${Math.max(1, slice.length - 1)} 100`} preserveAspectRatio="none" aria-hidden>
            <polygon points={`${points} ${lower}`} />
        </svg>
    );
};

/* ─── Scrubber ─── */

export const Scrubber: React.FC<{
    duration: number;
    time: number;
    marks?: SourceMarks | null;
    segments?: TapeSegment[];
    onSeek: (time: number) => void;
    automationId: string;
}> = ({ duration, time, marks, segments, onSeek, automationId }) => {
    const ref = useRef<HTMLDivElement>(null);
    const span = Math.max(0.001, duration);
    const pct = (value: number) => `${Math.max(0, Math.min(100, (value / span) * 100))}%`;
    const seekFromEvent = (event: React.PointerEvent) => {
        const rect = ref.current?.getBoundingClientRect();
        if (!rect || rect.width <= 0) return;
        onSeek(Math.max(0, Math.min(span, ((event.clientX - rect.left) / rect.width) * span)));
    };
    return (
        <div
            ref={ref}
            className="cutp-scrub"
            data-automation-id={automationId}
            onPointerDown={(event) => { (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId); seekFromEvent(event); }}
            onPointerMove={(event) => { if (event.buttons & 1) seekFromEvent(event); }}
        >
            {segments?.map((segment, index) => index > 0 && <span key={segment.mediaId + index} className="cutp-scrub__seg" style={{ left: pct(segment.tapeStart) }} />)}
            {marks && (marks.in !== null || marks.out !== null) && (
                <span className="cutp-scrub__range" style={{ left: pct(marks.in ?? 0), width: `calc(${pct(marks.out ?? span)} - ${pct(marks.in ?? 0)})` }} />
            )}
            {marks?.in != null && <span className="cutp-scrub__mark cutp-scrub__mark--in" style={{ left: pct(marks.in) }} />}
            {marks?.out != null && <span className="cutp-scrub__mark cutp-scrub__mark--out" style={{ left: pct(marks.out) }} />}
            <span className="cutp-scrub__head" style={{ left: pct(time) }} />
        </div>
    );
};

/* ─── Trim view ─── */

export type TrimFrame = { media: MediaItem | null; time: number; label: string; caption: string; active: boolean };

export const TrimFrames: React.FC<{ left: TrimFrame; right: TrimFrame; tool: string; offsetFrames: number; onClose: () => void }> = ({ left, right, tool, offsetFrames, onClose }) => (
    <div className="cutp-trimview" data-automation-id="cut-trim-view">
        {[left, right].map((frame, index) => (
            <figure key={index} className={`cutp-trimview__frame ${frame.active ? 'cutp-trimview__frame--active' : ''}`}>
                <MediaSurface media={frame.media} time={frame.time} automationId={index === 0 ? 'cut-trim-frame-out' : 'cut-trim-frame-in'} />
                <figcaption>
                    <strong>{frame.label}</strong>
                    <span>{frame.caption}</span>
                </figcaption>
            </figure>
        ))}
        <div className="cutp-trimview__badge">
            <span>{tool}</span>
            <strong>{offsetFrames > 0 ? '+' : ''}{offsetFrames} Fr</strong>
            <button type="button" className="cutp-btn cutp-btn--ghost" onClick={onClose} title="Trimmen beenden (Esc)" data-automation-id="cut-trim-close">Fertig</button>
        </div>
    </div>
);

/* ─── Viewer ─── */

export interface CutViewerProps {
    mode: ViewerMode;
    onModeChange: (mode: ViewerMode) => void;
    title: string;
    subtitle?: string;
    timecode: number;
    duration: number;
    shuttle: number;
    trimView: React.ReactNode | null;
    // timeline
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    mediaItems: MediaItem[];
    playheadPosition: number;
    isPlaying: boolean;
    onTogglePlayback: () => void;
    canvasWidth?: number;
    canvasHeight?: number;
    // source / tape
    sourceMedia: MediaItem | null;
    sourceTime: number;
    sourceRate: number;
    sourceWaveform?: number[];
    onSourceTime: (time: number) => void;
    onSourceEnded: () => void;
    // scrubber
    scrubDuration: number;
    scrubTime: number;
    scrubMarks: SourceMarks | null;
    scrubSegments?: TapeSegment[];
    onScrub: (time: number) => void;
    // transport
    onShuttle: (key: 'j' | 'k' | 'l') => void;
    onJumpEdit: (direction: -1 | 1) => void;
    onMarkIn: () => void;
    onMarkOut: () => void;
    onClearMarks: () => void;
    onFastReview: () => void;
    fastReviewRate: number;
}

const MODES: Array<{ mode: ViewerMode; label: string; icon: React.FC<{ className?: string }> }> = [
    { mode: 'source', label: 'Quellclip', icon: SourceClipIcon },
    { mode: 'tape', label: 'Quellband', icon: SourceTapeIcon },
    { mode: 'timeline', label: 'Timeline', icon: TimelineViewIcon },
];

const CutViewer: React.FC<CutViewerProps> = (props) => {
    const { mode, shuttle, trimView } = props;
    const shuttleLabel = shuttle === 0 ? '' : `${shuttle > 0 ? '▶' : '◀'} ${Math.abs(shuttle)}×`;
    return (
        <section className="cutp-viewer" data-automation-id="cut-viewer" aria-label="Viewer">
            <header className="cutp-viewer__head">
                <div className="cutp-seg" role="tablist" aria-label="Viewer-Modus">
                    {MODES.map(({ mode: entry, label, icon: Icon }) => (
                        <button key={entry} type="button" role="tab" aria-selected={mode === entry} className={`cutp-btn ${mode === entry ? 'cutp-btn--on' : ''}`} onClick={() => props.onModeChange(entry)} title={label} data-automation-id={`cut-viewer-mode-${entry}`}>
                            <Icon className="w-4 h-4" /><span className="cutp-hide-narrow">{label}</span>
                        </button>
                    ))}
                </div>
                <div className="cutp-viewer__title">
                    <strong>{props.title}</strong>
                    {props.subtitle && <small>{props.subtitle}</small>}
                </div>
                {shuttleLabel && <span className="cutp-viewer__shuttle" data-automation-id="cut-viewer-shuttle">{shuttleLabel}</span>}
                <span className="cutp-tc" data-automation-id="cut-viewer-timecode">{formatTimecode(props.timecode)}</span>
            </header>

            <div className="cutp-viewer__stage">
                {trimView ?? (mode === 'timeline' ? (
                    <div className="cutp-viewer__program">
                        <PreviewPlayer
                            timelineClips={props.timelineClips} timelineTracks={props.timelineTracks} mediaItems={props.mediaItems}
                            playheadPosition={props.playheadPosition} isPlaying={props.isPlaying} onTogglePlayback={props.onTogglePlayback}
                            canvasWidth={props.canvasWidth ?? 1280} canvasHeight={props.canvasHeight ?? 720}
                            aspectStyle={{ aspectRatio: `${props.canvasWidth ?? 1280} / ${props.canvasHeight ?? 720}` }} showControls={false}
                        />
                        {props.timelineClips.length === 0 && (
                            <div className="cutp-viewer__empty">
                                <strong>Die Timeline ist leer</strong>
                                <span>Wähle links einen Clip, setze In/Out (I/O) und nutze Smart Insert oder Anhängen.</span>
                            </div>
                        )}
                    </div>
                ) : (
                    <MediaSurface
                        media={props.sourceMedia} time={props.sourceTime} rate={props.sourceRate} muted={false}
                        waveform={props.sourceWaveform} onTime={props.onSourceTime} onEnded={props.onSourceEnded} automationId="cut-viewer-source"
                    />
                ))}
            </div>

            <Scrubber duration={props.scrubDuration} time={props.scrubTime} marks={props.scrubMarks} segments={props.scrubSegments} onSeek={props.onScrub} automationId={`cut-viewer-scrub-${mode}`} />

            <footer className="cutp-transport" aria-label="Transport">
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={props.onMarkIn} title="In-Punkt setzen (I)" data-automation-id="cut-mark-in"><MarkInGlyph /></button>
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={props.onMarkOut} title="Out-Punkt setzen (O)" data-automation-id="cut-mark-out"><MarkOutGlyph /></button>
                <button type="button" className="cutp-btn cutp-btn--ghost" onClick={props.onClearMarks} title="In und Out löschen (Alt+X)" data-automation-id="cut-mark-clear">I/O ×</button>
                <span className="cutp-spacer" />
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => props.onJumpEdit(-1)} title="Vorheriger Schnitt (Pfeil hoch)" data-automation-id="cut-transport-prev-edit"><PrevEditIcon /></button>
                <button type="button" className={`cutp-btn cutp-btn--icon ${shuttle < 0 ? 'cutp-btn--on' : ''}`} onClick={() => props.onShuttle('j')} title="Rückwärts (J, mehrfach = schneller)" data-automation-id="cut-transport-reverse"><ReverseIcon /></button>
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => props.onShuttle('k')} title="Stopp (K)" data-automation-id="cut-transport-stop"><StopIcon /></button>
                <button type="button" className={`cutp-btn cutp-btn--icon ${shuttle > 0 || (mode === 'timeline' && props.isPlaying) ? 'cutp-btn--on' : ''}`} onClick={() => props.onShuttle('l')} title="Vorwärts (L, mehrfach = schneller)" data-automation-id="cut-transport-forward"><ForwardIcon /></button>
                <button type="button" className="cutp-btn cutp-btn--icon" onClick={() => props.onJumpEdit(1)} title="Nächster Schnitt (Pfeil runter)" data-automation-id="cut-transport-next-edit"><NextEditIcon /></button>
                <span className="cutp-spacer" />
                <button type="button" className="cutp-btn" onClick={props.onFastReview} title={`Schnelldurchsicht: Tempo richtet sich nach der Länge (${props.fastReviewRate}×)`} data-automation-id="cut-fast-review">
                    <FastReviewIcon /><span className="cutp-hide-narrow">Schnelldurchsicht</span>
                </button>
                <span className="cutp-tc cutp-tc--dim">{formatTimecode(props.duration)}</span>
            </footer>
        </section>
    );
};

export default CutViewer;
