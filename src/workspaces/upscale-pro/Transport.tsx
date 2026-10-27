import React, { useRef } from 'react';
import { Pause, Play, Sparkles, StepBack, StepForward } from 'lucide-react';
import { clampRange, formatTimecode, frameAt, type Range } from './upscaleOps.ts';
import type { QueueInput } from './upscaleRuntime.ts';

type Props = {
  input: QueueInput | null;
  time: number;
  playing: boolean;
  io: Range | null;
  previewLength: number;
  previewSpan: Range | null;
  canPreview: boolean;
  previewHint: string | null;
  onTime: (time: number) => void;
  onPlaying: (playing: boolean) => void;
  onIo: (range: Range) => void;
  onPreviewLength: (length: number) => void;
  onRenderPreview: () => void;
};

const PREVIEW_LENGTHS = [
  { value: 0, label: 'Einzelbild' },
  { value: 1, label: '1 s' },
  { value: 2, label: '2 s' },
  { value: 3, label: '3 s' },
];

const Transport: React.FC<Props> = ({
  input, time, playing, io, previewLength, previewSpan, canPreview, previewHint,
  onTime, onPlaying, onIo, onPreviewLength, onRenderPreview,
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const isVideo = input?.kind === 'video';
  const duration = isVideo ? Math.max(0.001, input!.duration) : 0;
  const fps = input?.fps || 24;
  const frame = 1 / fps;
  const range = io ?? { start: 0, end: duration };
  const pct = (seconds: number) => `${(Math.min(duration, Math.max(0, seconds)) / duration) * 100}%`;

  const timeFromPointer = (clientX: number) => {
    const box = trackRef.current?.getBoundingClientRect();
    if (!box || box.width <= 0) return 0;
    const t = ((clientX - box.left) / box.width) * duration;
    return Math.min(duration, Math.max(0, Math.round(t * fps) / fps));
  };

  const dragFrom = (event: React.PointerEvent, apply: (t: number) => void) => {
    event.preventDefault();
    event.stopPropagation();
    const el = event.currentTarget as HTMLElement;
    el.setPointerCapture(event.pointerId);
    apply(timeFromPointer(event.clientX));
    const move = (e: PointerEvent) => apply(timeFromPointer(e.clientX));
    const up = () => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerup', up); };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };

  const setIn = (t: number) => onIo(clampRange({ start: t, end: range.end }, duration, fps));
  const setOut = (t: number) => onIo(clampRange({ start: range.start, end: t }, duration, fps));

  const totalFrames = Math.max(1, Math.round(duration * fps));
  const currentFrame = Math.min(totalFrames, frameAt(time, fps) + 1);

  return (
    <div className="ups-transport" data-automation-id="upscale-transport">
      {isVideo && (
        <div
          ref={trackRef}
          className="ups-track"
          onPointerDown={(event) => { onPlaying(false); dragFrom(event, onTime); }}
          data-automation-id="upscale-scrubber"
        >
          <div className="ups-track-ticks" />
          <div className="ups-track-range" style={{ left: pct(range.start), width: `calc(${pct(range.end)} - ${pct(range.start)})` }} />
          {previewSpan && <div className="ups-track-preview" style={{ left: pct(previewSpan.start), width: `max(2px, calc(${pct(previewSpan.end)} - ${pct(previewSpan.start)}))` }} />}
          <div className="ups-track-handle" style={{ left: pct(range.start) }} onPointerDown={(event) => dragFrom(event, setIn)} title="In-Punkt ziehen" data-automation-id="upscale-in-handle" />
          <div className="ups-track-handle" style={{ left: pct(range.end) }} onPointerDown={(event) => dragFrom(event, setOut)} title="Out-Punkt ziehen" data-automation-id="upscale-out-handle" />
          <div className="ups-track-head" style={{ left: pct(time) }} />
        </div>
      )}
      <div className="ups-transport-row">
        {isVideo ? (
          <>
            <button type="button" className="ups-icon-btn" title="Bild zurück (←)" onClick={() => { onPlaying(false); onTime(Math.max(0, time - frame)); }} data-automation-id="upscale-frame-back"><StepBack /></button>
            <button type="button" className="ups-icon-btn" title="Wiedergabe (Leertaste)" onClick={() => onPlaying(!playing)} data-automation-id="upscale-play">{playing ? <Pause /> : <Play />}</button>
            <button type="button" className="ups-icon-btn" title="Bild vor (→)" onClick={() => { onPlaying(false); onTime(Math.min(duration, time + frame)); }} data-automation-id="upscale-frame-forward"><StepForward /></button>
            <span className="ups-tc" data-automation-id="upscale-timecode">{formatTimecode(time, fps)}</span>
            <span className="ups-dim ups-tc" data-automation-id="upscale-frame-counter">Bild {currentFrame} / {totalFrames}</span>
            <button type="button" className="ups-icon-btn" title="In-Punkt setzen (I)" onClick={() => setIn(time)} data-automation-id="upscale-set-in">In</button>
            <span className="ups-tc ups-faint">{formatTimecode(range.start, fps)}</span>
            <button type="button" className="ups-icon-btn" title="Out-Punkt setzen (O)" onClick={() => setOut(time)} data-automation-id="upscale-set-out">Out</button>
            <span className="ups-tc ups-faint">{formatTimecode(range.end, fps)}</span>
          </>
        ) : (
          <span className="ups-dim">{input ? 'Bild · keine Zeitachse' : 'Kein Eingang gewählt'}</span>
        )}
        <span className="ups-spacer" />
        {isVideo && (
          <select className="ups-select" value={previewLength} onChange={(event) => onPreviewLength(Number(event.target.value))} aria-label="Vorschaulänge" data-automation-id="upscale-preview-length">
            {PREVIEW_LENGTHS.map((entry) => <option key={entry.value} value={entry.value}>{entry.label}</option>)}
          </select>
        )}
        {previewHint && <span className="ups-faint" data-automation-id="upscale-preview-hint">{previewHint}</span>}
        <button type="button" className="ups-btn" disabled={!canPreview} onClick={onRenderPreview} data-automation-id="upscale-render-preview">
          <Sparkles /> Vorschau rendern
        </button>
      </div>
    </div>
  );
};

export default Transport;
