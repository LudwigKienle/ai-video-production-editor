/**
 * Time ruler with render range (Fusion) / frame range bar (Nuke): transport,
 * current frame, scrubbable ruler with the render range shaded and draggable
 * in/out handles, and keyframe ticks of the selected node. Times are seconds;
 * the UI shows frames.
 */
import React, { useRef } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import type { Composition } from '../fusion-shared/compModel';
import { clampTime, frameToTime, getRenderRange, timeToFrame, totalFrames, type CompRange } from '../fusion-shared/compModelExt';

export type TimeBarProps = {
  comp: Composition;
  time: number;
  onTimeChange(t: number): void;
  range?: CompRange;
  onRangeChange?(range: CompRange): void;
  keyTimes?: number[];
  playing?: boolean;
  onPlayingChange?(playing: boolean): void;
  variant: 'fusion' | 'nuke';
  automationId: string;
};

const TimeBar: React.FC<TimeBarProps> = ({ comp, time, onTimeChange, range, onRangeChange, keyTimes = [], playing, onPlayingChange, variant, automationId }) => {
  const rulerRef = useRef<HTMLDivElement | null>(null);
  const frames = totalFrames(comp);
  const last = Math.max(1, frames - 1);
  const current = timeToFrame(comp, time);
  const r = range ?? getRenderRange(comp);
  const rs = timeToFrame(comp, r.start);
  const re = timeToFrame(comp, r.end);
  const pct = (frame: number) => `${(Math.min(last, Math.max(0, frame)) / last) * 100}%`;

  const frameAt = (clientX: number) => {
    const rect = rulerRef.current?.getBoundingClientRect();
    if (!rect) return 0;
    return Math.round(Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width))) * last);
  };

  const drag = (event: React.PointerEvent, what: 'time' | 'start' | 'end') => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    const apply = (clientX: number) => {
      const frame = frameAt(clientX);
      if (what === 'time') onTimeChange(frameToTime(comp, frame));
      else if (what === 'start') onRangeChange?.({ start: frameToTime(comp, Math.min(frame, re)), end: r.end });
      else onRangeChange?.({ start: r.start, end: frameToTime(comp, Math.max(frame, rs)) });
    };
    apply(event.clientX);
    const move = (ev: PointerEvent) => apply(ev.clientX);
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const step = Math.max(1, Math.ceil(frames / 12 / 5) * 5);
  const ticks: number[] = [];
  for (let frame = 0; frame <= last; frame += step) ticks.push(frame);

  const setFrame = (frame: number) => onTimeChange(clampTime(comp, frameToTime(comp, frame)));
  const frameInput = (value: number, onValue: (frame: number) => void, id: string, title: string) => (
    <input
      className="tb-frame"
      type="number"
      value={value}
      min={0}
      max={last}
      onChange={(event) => {
        const next = Math.round(Number(event.target.value));
        if (Number.isFinite(next)) onValue(Math.min(last, Math.max(0, next)));
      }}
      title={title}
      data-automation-id={`${automationId}-${id}`}
    />
  );

  return (
    <div className={`tb tb--${variant}`} data-automation-id={automationId}>
      {onRangeChange && frameInput(rs, (frame) => onRangeChange({ start: frameToTime(comp, Math.min(frame, re)), end: r.end }), 'range-start', variant === 'nuke' ? 'In-Frame' : 'Render-Start')}
      <div className="tb-ruler" ref={rulerRef} onPointerDown={(event) => drag(event, 'time')} data-automation-id={`${automationId}-ruler`}>
        <div className="tb-range" style={{ left: pct(rs), width: `calc(${pct(re)} - ${pct(rs)})` }} />
        {ticks.map((frame) => (
          <span key={frame} className="tb-tick" style={{ left: pct(frame) }}>
            <small>{frame}</small>
          </span>
        ))}
        {keyTimes.map((t) => (
          <span key={t} className="tb-key" style={{ left: pct(timeToFrame(comp, t)) }} />
        ))}
        {onRangeChange && (
          <>
            <span className="tb-handle tb-handle--start" style={{ left: pct(rs) }} onPointerDown={(event) => drag(event, 'start')} title="Render-Start ziehen" data-automation-id={`${automationId}-handle-start`} />
            <span className="tb-handle tb-handle--end" style={{ left: pct(re) }} onPointerDown={(event) => drag(event, 'end')} title="Render-Ende ziehen" data-automation-id={`${automationId}-handle-end`} />
          </>
        )}
        <span className="tb-playhead" style={{ left: pct(current) }} />
      </div>
      {onRangeChange && frameInput(re, (frame) => onRangeChange({ start: r.start, end: frameToTime(comp, Math.max(frame, rs)) }), 'range-end', variant === 'nuke' ? 'Out-Frame' : 'Render-Ende')}
      <div className="tb-transport">
        <button type="button" onClick={() => setFrame(rs)} title="Zum Anfang" data-automation-id={`${automationId}-to-start`}><SkipBack size={13} /></button>
        <button type="button" onClick={() => setFrame(current - 1)} title="Ein Frame zurück (←)" data-automation-id={`${automationId}-prev-frame`}><ChevronLeft size={14} /></button>
        <button type="button" className={playing ? 'tb-on' : ''} onClick={() => onPlayingChange?.(!playing)} title="Wiedergabe (Leertaste)" data-automation-id={`${automationId}-play`}>
          {playing ? <Pause size={13} /> : <Play size={13} />}
        </button>
        <button type="button" onClick={() => setFrame(current + 1)} title="Ein Frame vor (→)" data-automation-id={`${automationId}-next-frame`}><ChevronRight size={14} /></button>
        <button type="button" onClick={() => setFrame(re)} title="Zum Ende" data-automation-id={`${automationId}-to-end`}><SkipForward size={13} /></button>
      </div>
      {frameInput(current, setFrame, 'current', 'Aktueller Frame')}
      <span className="tb-fps">{comp.fps} fps</span>
    </div>
  );
};

export default TimeBar;
