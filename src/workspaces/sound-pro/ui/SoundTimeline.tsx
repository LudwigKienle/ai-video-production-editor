/**
 * Sound timeline: track headers + lanes with clips, waveforms, fades, clip
 * gain line, selector range and automation lanes. Every edit is a command
 * (`run`), the drag only previews locally until pointer-up.
 *
 * Tools (Pro Tools convention, also used by the other views):
 *  - smart:    edges trim, top corners fade, gain line sets clip gain, body moves
 *  - trimmer:  drag trims the nearest edge
 *  - selector: drag selects a time range (for delete / ADR cues / writes)
 *  - grabber:  drag moves clips
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack, WaveformCache } from '../../../types';
import { evaluateAutomation } from '../automation.ts';
import { sourceCache } from '../engine/runtime.ts';
import { clamp, clipMixOf, dbToGain, formatDb, gainToDb, MAX_FADER_DB, trackMixOf, type SoundMix, type StemRole } from '../model.ts';
import { snapToGrid } from '../editOps.ts';
import type { RunCommand } from './ChannelStrip.tsx';
import { formatTime } from './widgets.tsx';

const PEAK_RES = 100; // buckets per second
const peakCache = new Map<string, { source: unknown; peaks: Float32Array }>();
const peaksFor = (mediaId: string): Float32Array | null => {
  const src = sourceCache.get(mediaId);
  if (!src) return null;
  const hit = peakCache.get(mediaId);
  if (hit && hit.source === src) return hit.peaks;
  const step = Math.max(1, Math.round(src.sampleRate / PEAK_RES));
  const len = src.channels[0].length;
  const peaks = new Float32Array(Math.ceil(len / step));
  for (let b = 0; b < peaks.length; b++) {
    let m = 0;
    const end = Math.min(len, (b + 1) * step);
    for (const ch of src.channels) for (let i = b * step; i < end; i++) { const v = ch[i] < 0 ? -ch[i] : ch[i]; if (v > m) m = v; }
    peaks[b] = m;
  }
  peakCache.set(mediaId, { source: src, peaks });
  return peaks;
};

/** Clip gain dB → y (0 = top) inside a lane of height h; 0 dB sits at 30 %. */
const GAIN_MIN = -36;
const gainToY = (db: number, h: number) => {
  const d = clamp(db, GAIN_MIN, MAX_FADER_DB);
  return d >= 0 ? h * 0.3 * (1 - d / MAX_FADER_DB) : h * 0.3 + (h * 0.7 - 4) * (d / GAIN_MIN);
};
const yToGain = (y: number, h: number) => {
  if (y <= h * 0.3) return MAX_FADER_DB * (1 - y / (h * 0.3));
  return clamp(((y - h * 0.3) / (h * 0.7 - 4)) * GAIN_MIN, GAIN_MIN, 0);
};
/** Automation volume dB → y in an automation lane. */
const autoToY = (db: number, h: number) => gainToY(db, h);
const yToAuto = (y: number, h: number) => yToGain(y, h);

type WaveProps = { mediaId: string; sourceIn: number; speed: number; gain: number; width: number; h: number; pps: number; sourcesVersion: number; fallback?: number[]; mediaDur: number };

/** Waveform of one clip; memoised so playhead and meter updates do not redraw it. */
const ClipWave = React.memo(({ mediaId, sourceIn, speed, gain, width, h, pps, fallback, mediaDur, sourcesVersion }: WaveProps) => {
  const points = useMemo(() => {
    const peaks = peaksFor(mediaId);
    if (!peaks && !(fallback && fallback.length && mediaDur > 0)) return null;
    const mid = h / 2;
    const top: string[] = [];
    const bottom: string[] = [];
    const step = 2;
    const g = Math.min(4, Math.max(0, gain));
    for (let x = 0; x <= width; x += step) {
      const t0 = sourceIn + (x / pps) * speed;
      const t1 = sourceIn + ((x + step) / pps) * speed;
      let v = 0;
      if (peaks) {
        const b0 = Math.floor(t0 * PEAK_RES), b1 = Math.max(b0 + 1, Math.ceil(t1 * PEAK_RES));
        for (let b = Math.max(0, b0); b < b1 && b < peaks.length; b++) if (peaks[b] > v) v = peaks[b];
      } else if (fallback) {
        v = fallback[Math.min(fallback.length - 1, Math.max(0, Math.floor((t0 / mediaDur) * fallback.length)))] ?? 0;
      }
      const a = Math.min(1, v * g) * (mid - 2);
      top.push(`${x},${(mid - a).toFixed(1)}`);
      bottom.push(`${x},${(mid + a).toFixed(1)}`);
    }
    return [...top, ...bottom.reverse()].join(' ');
    // sourcesVersion re-runs this when decoded audio arrives
  }, [mediaId, sourceIn, speed, gain, width, h, pps, fallback, mediaDur, sourcesVersion]);
  if (!points) return null;
  return <svg className="snd-clip__wave" width={width} height={h} viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none"><polygon points={points} fill="var(--snd-wave)" opacity="0.55" /></svg>;
});

type Drag =
  | { kind: 'move'; clipId: string; startX: number; startY: number; dx: number; dTrack: number; moved: boolean; additive: boolean }
  | { kind: 'trim'; clipId: string; edge: 'start' | 'end'; startX: number; dx: number }
  | { kind: 'fade'; clipId: string; side: 'in' | 'out'; startX: number; dx: number }
  | { kind: 'gain'; clipId: string; startY: number; startDb: number; db: number }
  | { kind: 'select'; trackId: string; t0: number; t1: number }
  | null;

export type TimelineTrackRow = { track: TimelineTrack; clips: TimelineClip[] };

export const SoundTimeline: React.FC<{
  mix: SoundMix;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  media: MediaItem[];
  playhead: number;
  isPlaying: boolean;
  waveformCache: WaveformCache;
  run: RunCommand;
  /** bumps when decoded sources change (re-draw waveforms) */
  sourcesVersion: number;
  headerWidth?: number;
  laneHeight?: number;
  renderHeader?: (track: TimelineTrack) => React.ReactNode;
  /** show these ADR cue ranges on the matching lanes */
  showCues?: boolean;
  id: string;
}> = ({ mix, tracks, clips, media, playhead, isPlaying, waveformCache, run, sourcesVersion, headerWidth = 190, laneHeight = 64, renderHeader, showCues, id }) => {
  const pps = 60 * mix.ui.zoom;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const dragRef = useRef<Drag>(null);
  dragRef.current = drag;
  const mediaById = useMemo(() => new Map(media.map((m) => [m.id, m])), [media]);

  const rows = useMemo<TimelineTrackRow[]>(() => tracks
    .map((track) => ({ track, clips: clips.filter((c) => c.trackId === track.id && ['audio', 'video'].includes(mediaById.get(c.mediaId)?.type ?? '')) }))
    .filter((row) => row.track.type === 'audio' || row.clips.length > 0), [tracks, clips, mediaById]);

  const end = Math.max(30, clips.reduce((m, c) => Math.max(m, c.end), 0) + 10);
  const totalPx = Math.ceil(end * pps);
  const tickStep = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300].find((s) => s * pps >= 70) ?? 600;
  const ticks = Array.from({ length: Math.floor(end / tickStep) + 1 }, (_, i) => i * tickStep);
  const snap = (t: number) => (mix.ui.editMode === 'grid' ? snapToGrid(t, mix.ui.gridSec) : t);
  const tool = mix.ui.tool;
  const selected = new Set(mix.ui.selectedClipIds);

  // keep the playhead in view while playing
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !isPlaying) return;
    const x = playhead * pps + headerWidth;
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft + headerWidth) el.scrollLeft = Math.max(0, x - headerWidth - 60);
  }, [playhead, isPlaying, pps, headerWidth]);

  const timeAt = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, (clientX - rect.left + el.scrollLeft - headerWidth) / pps);
  };

  const startDrag = (next: Drag, e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setDrag(next);
    const rowIndexAt = (clientY: number) => {
      const lanes = scrollRef.current?.querySelectorAll<HTMLElement>('[data-lane-track]') ?? [];
      for (let i = 0; i < lanes.length; i++) {
        const r = lanes[i].getBoundingClientRect();
        if (clientY >= r.top && clientY < r.bottom) return i;
      }
      return -1;
    };
    const originRow = rowIndexAt(e.clientY);
    const move = (ev: PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      if (d.kind === 'move') {
        const row = rowIndexAt(ev.clientY);
        setDrag({ ...d, dx: ev.clientX - d.startX, dTrack: row >= 0 && originRow >= 0 ? row - originRow : d.dTrack, moved: d.moved || Math.abs(ev.clientX - d.startX) > 3 || (row >= 0 && row !== originRow) });
      } else if (d.kind === 'trim' || d.kind === 'fade') setDrag({ ...d, dx: ev.clientX - d.startX });
      else if (d.kind === 'gain') {
        const h = laneHeight - 6;
        const startY = gainToY(d.startDb, h);
        setDrag({ ...d, db: Math.round(yToGain(startY + (ev.clientY - d.startY), h) * 10) / 10 });
      } else if (d.kind === 'select') setDrag({ ...d, t1: snap(timeAt(ev.clientX)) });
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const d = dragRef.current;
      setDrag(null);
      if (!d) return;
      if (d.kind === 'move') {
        const clip = clips.find((c) => c.id === d.clipId);
        if (!clip) return;
        if (!d.moved) {
          run('select.clips', { clipIds: [clip.id], add: d.additive });
          run('select.track', { trackId: clip.trackId });
          return;
        }
        const rowIdx = rows.findIndex((r) => r.track.id === clip.trackId) + d.dTrack;
        const target = rows[clamp(rowIdx, 0, rows.length - 1)]?.track.id ?? clip.trackId;
        run('clip.move', { clipId: clip.id, start: Math.max(0, clip.start + d.dx / pps), trackId: target });
      } else if (d.kind === 'trim') {
        const clip = clips.find((c) => c.id === d.clipId);
        if (clip && Math.abs(d.dx) > 1) run('clip.trim', { clipId: clip.id, edge: d.edge, time: (d.edge === 'start' ? clip.start : clip.end) + d.dx / pps });
      } else if (d.kind === 'fade') {
        const clip = clips.find((c) => c.id === d.clipId);
        if (!clip) return;
        const cm = clipMixOf(mix, clip.id);
        const base = d.side === 'in' ? cm.fadeIn.duration : cm.fadeOut.duration;
        const dur = Math.max(0, base + (d.side === 'in' ? d.dx : -d.dx) / pps);
        run('clip.setFade', { clipIds: [clip.id], side: d.side, duration: dur });
      } else if (d.kind === 'gain') {
        if (Math.abs(d.db - d.startDb) > 0.05) run('clip.setGain', { clipIds: [d.clipId], db: d.db });
      } else if (d.kind === 'select') {
        const a = Math.min(d.t0, d.t1), b = Math.max(d.t0, d.t1);
        if (b - a > 0.01) run('edit.setSelection', { start: a, end: b });
        else { run('edit.setSelection', {}); run('transport.locate', { time: a }); }
        run('select.track', { trackId: d.trackId });
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onClipPointerDown = (e: React.PointerEvent, clip: TimelineClip, width: number) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const h = rect.height;
    if (tool === 'selector') return startDrag({ kind: 'select', trackId: clip.trackId, t0: snap(timeAt(e.clientX)), t1: snap(timeAt(e.clientX)) }, e);
    if (tool === 'trimmer') return startDrag({ kind: 'trim', clipId: clip.id, edge: x < width / 2 ? 'start' : 'end', startX: e.clientX, dx: 0 }, e);
    if (tool === 'smart') {
      const cm = clipMixOf(mix, clip.id);
      const fadeInX = cm.fadeIn.duration * pps;
      const fadeOutX = width - cm.fadeOut.duration * pps;
      if (y < 12 && Math.abs(x - fadeInX) < 10) return startDrag({ kind: 'fade', clipId: clip.id, side: 'in', startX: e.clientX, dx: 0 }, e);
      if (y < 12 && Math.abs(x - fadeOutX) < 10) return startDrag({ kind: 'fade', clipId: clip.id, side: 'out', startX: e.clientX, dx: 0 }, e);
      if (x < 7) return startDrag({ kind: 'trim', clipId: clip.id, edge: 'start', startX: e.clientX, dx: 0 }, e);
      if (x > width - 7) return startDrag({ kind: 'trim', clipId: clip.id, edge: 'end', startX: e.clientX, dx: 0 }, e);
      const db = gainToDb(clip.volume ?? 1);
      if (Math.abs(y - gainToY(db, h)) < 5) return startDrag({ kind: 'gain', clipId: clip.id, startY: e.clientY, startDb: db, db }, e);
    }
    startDrag({ kind: 'move', clipId: clip.id, startX: e.clientX, startY: e.clientY, dx: 0, dTrack: 0, moved: false, additive: e.shiftKey }, e);
  };

  return (
    <div
      ref={scrollRef}
      className={`snd-tl snd-tool--${tool}`}
      style={{ ['--snd-head-w' as string]: `${headerWidth}px`, ['--snd-grid-px' as string]: `${Math.max(8, (mix.ui.editMode === 'grid' ? mix.ui.gridSec : tickStep) * pps)}px` }}
      data-automation-id={id}
      data-sources={sourcesVersion}
    >
      <div className="snd-tl__corner snd-hint" style={{ padding: '5px 6px' }}>{formatTime(playhead)}</div>
      <div
        className="snd-tl__ruler"
        style={{ width: totalPx }}
        data-automation-id={`${id}-ruler`}
        onPointerDown={(e) => {
          run('transport.locate', { time: snap(timeAt(e.clientX)) });
          const move = (ev: PointerEvent) => run('transport.locate', { time: snap(timeAt(ev.clientX)) });
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      >
        {ticks.map((t) => <div key={t} className="snd-tl__tick" style={{ left: t * pps }}>{formatTime(t).slice(3, 8)}</div>)}
        {mix.ui.selection && <div className="snd-tl__sel-ruler" style={{ left: mix.ui.selection.start * pps, width: (mix.ui.selection.end - mix.ui.selection.start) * pps }} />}
        <div className="snd-tl__playhead" style={{ left: playhead * pps }} />
      </div>

      {rows.map(({ track, clips: rowClips }) => {
        const tm = trackMixOf(mix, track.id);
        const isSel = mix.ui.selectedTrackId === track.id;
        const roleColor = tm.role ? `var(--snd-role-${tm.role as StemRole})` : undefined;
        const vol = tm.automation.volume;
        return (
          <React.Fragment key={track.id}>
            <div className={`snd-tl__head ${isSel ? 'snd-tl__head--selected' : ''}`} style={{ height: laneHeight + (mix.ui.showAutomation ? 40 : 0), borderLeft: roleColor ? `3px solid ${roleColor}` : undefined }} data-automation-id={`${id}-head-${track.id}`}>
              <div className="snd-tl__head-row">
                <span className="snd-tl__name" onClick={() => run('select.track', { trackId: track.id })} title={track.name ?? track.id}>{track.name ?? track.id}</span>
              </div>
              {renderHeader?.(track)}
            </div>
            <div className="snd-col" style={{ width: totalPx }}>
              <div
                className="snd-tl__lane"
                data-lane-track={track.id}
                style={{ height: laneHeight }}
                data-automation-id={`${id}-lane-${track.id}`}
                onPointerDown={(e) => {
                  if (e.button !== 0) return;
                  const t = snap(timeAt(e.clientX));
                  if (tool === 'selector' || tool === 'smart') startDrag({ kind: 'select', trackId: track.id, t0: t, t1: t }, e);
                  else { run('transport.locate', { time: t }); run('select.track', { trackId: track.id }); }
                }}
              >
                {showCues && mix.adrCues.filter((c) => !c.trackId || c.trackId === track.id).map((c) => (
                  <div key={c.id} className="snd-tl__cue" style={{ left: c.start * pps, width: (c.end - c.start) * pps }} title={`${c.character}: ${c.line}`} />
                ))}
                {rowClips.map((clip) => {
                  let left = clip.start * pps;
                  let width = Math.max(4, (clip.end - clip.start) * pps);
                  let top: number | undefined;
                  const cm = clipMixOf(mix, clip.id);
                  let fin = cm.fadeIn.duration;
                  let fout = cm.fadeOut.duration;
                  let gainDb = gainToDb(clip.volume ?? 1);
                  if (drag && 'clipId' in drag && drag.clipId === clip.id) {
                    if (drag.kind === 'move' && drag.moved) { left = Math.max(0, left + drag.dx); top = drag.dTrack * (laneHeight + (mix.ui.showAutomation ? 41 : 1)); }
                    if (drag.kind === 'trim') { if (drag.edge === 'start') { left += drag.dx; width -= drag.dx; } else width += drag.dx; }
                    if (drag.kind === 'fade') { if (drag.side === 'in') fin = Math.max(0, fin + drag.dx / pps); else fout = Math.max(0, fout - drag.dx / pps); }
                    if (drag.kind === 'gain') gainDb = drag.db;
                  }
                  width = Math.max(4, width);
                  const h = laneHeight - 6;
                  const media = mediaById.get(clip.mediaId);
                  const finPx = Math.min(width, fin * pps);
                  const foutPx = Math.min(width, fout * pps);
                  return (
                    <div
                      key={clip.id}
                      className={`snd-clip ${selected.has(clip.id) ? 'snd-clip--selected' : ''} ${track.isMuted ? 'snd-clip--muted' : ''}`}
                      style={{ left, width, transform: top ? `translateY(${top}px)` : undefined, zIndex: top ? 8 : undefined }}
                      data-automation-id={`sound-clip-${clip.id}`}
                      onPointerDown={(e) => onClipPointerDown(e, clip, width)}
                      title={`${media?.name ?? 'Clip'} · ${formatTime(clip.start)} → ${formatTime(clip.end)} · Clip-Gain ${formatDb(gainDb)} dB`}
                    >
                      <ClipWave mediaId={clip.mediaId} sourceIn={(clip.sourceIn ?? 0) + (drag?.kind === 'trim' && drag.clipId === clip.id && drag.edge === 'start' ? (drag.dx / pps) * (clip.speed || 1) : 0)} speed={Math.max(0.05, clip.speed || 1)} gain={dbToGain(gainDb)} width={Math.round(width)} h={h} pps={pps} sourcesVersion={sourcesVersion} fallback={waveformCache[clip.mediaId]} mediaDur={mediaById.get(clip.mediaId)?.duration ?? 0} />
                      <svg className="snd-clip__wave" width={width} height={h} viewBox={`0 0 ${Math.max(1, width)} ${h}`} preserveAspectRatio="none" style={{ zIndex: 1 }}>
                        {finPx > 0 && <path d={`M0,0 L${finPx},0 L0,${h} Z`} fill="rgba(0,0,0,0.45)" />}
                        {finPx > 0 && <line x1="0" y1={h} x2={finPx} y2="0" stroke="#fff" strokeWidth="1" opacity="0.7" />}
                        {foutPx > 0 && <path d={`M${width},0 L${width - foutPx},0 L${width},${h} Z`} fill="rgba(0,0,0,0.45)" />}
                        {foutPx > 0 && <line x1={width - foutPx} y1="0" x2={width} y2={h} stroke="#fff" strokeWidth="1" opacity="0.7" />}
                      </svg>
                      <span className="snd-clip__name">{media?.name ?? clip.id}</span>
                      {tool === 'smart' && <>
                        <div className="snd-clip__fade-handle" style={{ left: Math.max(0, finPx - 4) }} />
                        <div className="snd-clip__fade-handle" style={{ left: Math.min(width - 9, width - foutPx - 4) }} />
                        <div className="snd-clip__gainline" style={{ top: gainToY(gainDb, h) }} />
                      </>}
                      {Math.abs(gainDb) > 0.05 && <span className="snd-clip__gaintag">{formatDb(gainDb)} dB</span>}
                      {(tool === 'smart' || tool === 'trimmer') && <><div className="snd-clip__edge snd-clip__edge--l" /><div className="snd-clip__edge snd-clip__edge--r" /></>}
                    </div>
                  );
                })}
                {drag?.kind === 'select' && drag.trackId === track.id && (
                  <div className="snd-tl__selection" style={{ left: Math.min(drag.t0, drag.t1) * pps, width: Math.abs(drag.t1 - drag.t0) * pps }} />
                )}
                {mix.ui.selection && drag?.kind !== 'select' && (!mix.ui.selectedTrackId || mix.ui.selectedTrackId === track.id) && (
                  <div className="snd-tl__selection" style={{ left: mix.ui.selection.start * pps, width: (mix.ui.selection.end - mix.ui.selection.start) * pps }} />
                )}
                <div className="snd-tl__playhead" style={{ left: playhead * pps }} />
              </div>
              {mix.ui.showAutomation && (
                <div
                  className="snd-tl__lane snd-tl__lane--auto"
                  style={{ height: 40 }}
                  data-automation-id={`${id}-auto-${track.id}`}
                  title="Volume-Automation · Klick: Punkt setzen · ⌥-Klick: Punkte im Umkreis löschen"
                  onPointerDown={(e) => {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const t = snap(timeAt(e.clientX));
                    if (e.altKey) run('automation.removePoints', { trackId: track.id, param: 'volume', start: Math.max(0, t - 6 / pps), end: t + 6 / pps });
                    else run('automation.addPoint', { trackId: track.id, param: 'volume', time: t, value: Math.round(yToAuto(e.clientY - rect.top, 40) * 10) / 10 });
                  }}
                >
                  <svg width={totalPx} height={40} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                    {vol && vol.length > 0 ? (
                      <>
                        <polyline fill="none" stroke="var(--snd-auto)" strokeWidth="1.5" points={[[0, vol[0].value], ...vol.map((p) => [p.time, p.value]), [end, vol[vol.length - 1].value]].map(([t, v]) => `${(t as number) * pps},${autoToY(v as number, 40)}`).join(' ')} />
                        {vol.map((p, i) => <circle key={i} cx={p.time * pps} cy={autoToY(p.value, 40)} r={3} fill="var(--snd-auto)" />)}
                      </>
                    ) : (
                      <line x1="0" x2={totalPx} y1={autoToY(tm.gainDb, 40)} y2={autoToY(tm.gainDb, 40)} stroke="var(--snd-auto)" strokeDasharray="3 3" opacity="0.5" />
                    )}
                  </svg>
                  <span className="snd-hint" style={{ position: 'absolute', left: 4, top: 2, fontSize: 9 }}>Volume {tm.automationMode !== 'off' && vol?.length ? `${formatDb(evaluateAutomation(vol, playhead, tm.gainDb))} dB` : ''}</span>
                  <div className="snd-tl__playhead" style={{ left: playhead * pps }} />
                </div>
              )}
            </div>
          </React.Fragment>
        );
      })}
      {rows.length === 0 && <div className="snd-hint" style={{ gridColumn: '1 / -1', padding: 20 }}>Keine Audiospuren. „+ Spur“ oder im Studio-Browser Ton erzeugen.</div>}
    </div>
  );
};
