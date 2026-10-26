/**
 * Program viewer used by both Export views: fitted preview canvas, burn-in preview, scrub bar
 * with In/Out range, transport. The same PreviewPlayer canvas is recorded by "Schnell (Browser)".
 */
import React from 'react';
import { Pause, Play, SkipBack, SkipForward, StepBack, StepForward } from 'lucide-react';
import PreviewPlayer, { type PreviewPlayerHandle } from '../../components/PreviewPlayer';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../types';
import { formatTimecode, type EffectsSettings, type OverlayPosition } from './deliveryModel';

export type ExportViewerProps = {
    playerRef: React.RefObject<PreviewPlayerHandle | null>;
    timelineClips: TimelineClip[];
    timelineTracks: TimelineTrack[];
    mediaItems: MediaItem[];
    time: number;
    duration: number;
    fps: number;
    playing: boolean;
    recording: boolean;
    canvasWidth: number;
    canvasHeight: number;
    rangeStart: number;
    rangeEnd: number;
    showRange: boolean;
    inPoint: number | null;
    outPoint: number | null;
    effects?: EffectsSettings;
    filename: string;
    onSeek: (seconds: number) => void;
    onTogglePlay: () => void;
    onMarkIn: () => void;
    onMarkOut: () => void;
    onClearMarks: () => void;
    automationPrefix: string;
};

const burnStyle = (position: OverlayPosition, sizePercent: number, frameHeight: number): React.CSSProperties => {
    const [vertical, horizontal] = position === 'center' ? ['center', 'center'] : position.split('-');
    const style: React.CSSProperties = { fontSize: Math.max(7, (frameHeight * sizePercent) / 100) };
    const margin = '3%';
    if (vertical === 'top') style.top = margin;
    else if (vertical === 'bottom') style.bottom = margin;
    else { style.top = '50%'; style.transform = 'translateY(-50%)'; }
    if (horizontal === 'left') style.left = margin;
    else if (horizontal === 'right') style.right = margin;
    else { style.left = '50%'; style.transform = `${style.transform ?? ''} translateX(-50%)`; }
    return style;
};

const ExportViewer: React.FC<ExportViewerProps> = (props) => {
    const {
        playerRef, timelineClips, timelineTracks, mediaItems, time, duration, fps, playing, recording,
        canvasWidth, canvasHeight, rangeStart, rangeEnd, showRange, inPoint, outPoint, effects, filename,
        onSeek, onTogglePlay, onMarkIn, onMarkOut, onClearMarks, automationPrefix,
    } = props;
    const stageRef = React.useRef<HTMLDivElement>(null);
    const scrubRef = React.useRef<HTMLDivElement>(null);
    const [box, setBox] = React.useState({ width: 320, height: 180 });

    React.useLayoutEffect(() => {
        const stage = stageRef.current;
        if (!stage) return undefined;
        const measure = () => {
            const availW = Math.max(40, stage.clientWidth - 20);
            const availH = Math.max(40, stage.clientHeight - 20);
            const ratio = canvasWidth / Math.max(1, canvasHeight);
            const width = Math.min(availW, availH * ratio);
            setBox({ width: Math.round(width), height: Math.round(width / ratio) });
        };
        measure();
        const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(measure) : null;
        observer?.observe(stage);
        return () => observer?.disconnect();
    }, [canvasWidth, canvasHeight]);

    const frame = 1 / Math.max(1, fps);
    const pct = (seconds: number) => `${duration > 0 ? Math.max(0, Math.min(100, (seconds / duration) * 100)) : 0}%`;
    const seekFromPointer = (clientX: number) => {
        const bar = scrubRef.current;
        if (!bar || duration <= 0) return;
        const rect = bar.getBoundingClientRect();
        onSeek(Math.max(0, Math.min(duration, ((clientX - rect.left) / rect.width) * duration)));
    };

    return (
        <div className="xp-viewer">
            <div className="xp-viewer__stage" ref={stageRef}>
                {timelineClips.length === 0 ? (
                    <div className="xp-viewer__empty">Die Timeline ist leer – im Schnitt Clips anlegen, dann hier exportieren.</div>
                ) : (
                    <div className="xp-viewer__frame" style={{ width: box.width, height: box.height }}>
                        <PreviewPlayer
                            ref={playerRef as React.RefObject<PreviewPlayerHandle>}
                            timelineClips={timelineClips}
                            timelineTracks={timelineTracks}
                            mediaItems={mediaItems}
                            playheadPosition={time}
                            isPlaying={playing}
                            canvasWidth={canvasWidth}
                            canvasHeight={canvasHeight}
                            aspectClassName=""
                            aspectStyle={{ border: 'none', borderRadius: 0 }}
                            showControls={false}
                        />
                        {effects?.timecode.enabled ? (
                            <span className="xp-viewer__burn" style={burnStyle(effects.timecode.position, effects.timecode.sizePercent, box.height)}>{formatTimecode(time, fps)}</span>
                        ) : null}
                        {effects?.name.enabled ? (
                            <span className="xp-viewer__burn" style={burnStyle(effects.name.position, effects.name.sizePercent, box.height)}>{effects.name.text || filename}</span>
                        ) : null}
                        {recording ? <span className="xp-viewer__rec">REC</span> : null}
                    </div>
                )}
            </div>
            <div className="xp-transport">
                <span className="xp-transport__tc" data-automation-id={`${automationPrefix}.timecode`}>{formatTimecode(time, fps)}</span>
                <button type="button" className="xp-btn xp-btn--icon" title="Zum Anfang (Pos1)" data-automation-id={`${automationPrefix}.home`} onClick={() => onSeek(showRange ? rangeStart : 0)}><SkipBack size={13} /></button>
                <button type="button" className="xp-btn xp-btn--icon" title="Ein Bild zurück (←)" data-automation-id={`${automationPrefix}.stepBack`} onClick={() => onSeek(Math.max(0, time - frame))}><StepBack size={13} /></button>
                <button type="button" className="xp-btn xp-btn--icon" title="Wiedergabe (Leertaste)" data-automation-id={`${automationPrefix}.play`} disabled={recording} onClick={onTogglePlay}>{playing ? <Pause size={13} /> : <Play size={13} />}</button>
                <button type="button" className="xp-btn xp-btn--icon" title="Ein Bild vor (→)" data-automation-id={`${automationPrefix}.stepForward`} onClick={() => onSeek(Math.min(duration, time + frame))}><StepForward size={13} /></button>
                <button type="button" className="xp-btn xp-btn--icon" title="Zum Ende (Ende)" data-automation-id={`${automationPrefix}.end`} onClick={() => onSeek(showRange ? rangeEnd : duration)}><SkipForward size={13} /></button>
                <div
                    className="xp-scrub"
                    ref={scrubRef}
                    data-automation-id={`${automationPrefix}.scrub`}
                    role="slider"
                    aria-label="Vorschau-Position"
                    aria-valuemin={0}
                    aria-valuemax={duration}
                    aria-valuenow={time}
                    tabIndex={0}
                    onPointerDown={(event) => {
                        (event.target as HTMLElement).setPointerCapture?.(event.pointerId);
                        seekFromPointer(event.clientX);
                    }}
                    onPointerMove={(event) => { if (event.buttons & 1) seekFromPointer(event.clientX); }}
                >
                    <div className="xp-scrub__track" />
                    {showRange ? <div className="xp-scrub__range" style={{ left: pct(rangeStart), width: `calc(${pct(rangeEnd)} - ${pct(rangeStart)})` }} /> : null}
                    {inPoint !== null ? <div className="xp-scrub__mark xp-scrub__mark--in" style={{ left: pct(inPoint) }} /> : null}
                    {outPoint !== null ? <div className="xp-scrub__mark xp-scrub__mark--out" style={{ left: pct(outPoint) }} /> : null}
                    <div className="xp-scrub__head" style={{ left: pct(time) }} />
                </div>
                <span className="xp-transport__tc xp-transport__tc--dim">{formatTimecode(duration, fps)}</span>
                <button type="button" className="xp-btn xp-btn--sm" title="In-Punkt setzen (I)" data-automation-id={`${automationPrefix}.markIn`} onClick={onMarkIn}>In</button>
                <button type="button" className="xp-btn xp-btn--sm" title="Out-Punkt setzen (O)" data-automation-id={`${automationPrefix}.markOut`} onClick={onMarkOut}>Out</button>
                <button type="button" className="xp-btn xp-btn--sm" title="In/Out löschen" data-automation-id={`${automationPrefix}.clearMarks`} disabled={inPoint === null && outPoint === null} onClick={onClearMarks}>×</button>
            </div>
        </div>
    );
};

export default ExportViewer;
