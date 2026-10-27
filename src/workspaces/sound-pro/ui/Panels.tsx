/** Loudness meter, mini picture monitor and ADR cue list. */
import React, { useEffect, useRef } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../../types';
import { formatLufs } from '../engine/loudness.ts';
import { clamp, formatDb, type SoundMix } from '../model.ts';
import type { LiveMeters } from '../useSoundPlayback.ts';
import type { RunCommand } from './ChannelStrip.tsx';
import { formatTime } from './widgets.tsx';

const lufsFrac = (lufs: number) => clamp((lufs + 50) / 50, 0, 1); // −50 … 0 LUFS

export const LoudnessPanel: React.FC<{ meters: LiveMeters; mix: SoundMix; run: RunCommand; compact?: boolean }> = ({ meters, mix, run, compact }) => {
  const target = mix.master.targetLufs;
  const rows: Array<[string, number, string]> = [
    ['Momentary', meters.momentaryLufs, 'M'],
    ['Short-term', meters.shortTermLufs, 'S'],
    ['Integrated', meters.integratedLufs, 'I'],
  ];
  return (
    <div className="snd-panel" data-automation-id="sound-loudness">
      <div className="snd-panel__head">
        <span>Loudness (EBU R128)</span>
        <span style={{ flex: 1 }} />
        <select className="snd-select" value={target} data-automation-id="sound-loudness-target" onChange={(e) => run('master.set', { targetLufs: Number(e.target.value) })} title="Ziel">
          <option value={-23}>−23 LUFS (Broadcast)</option>
          <option value={-24}>−24 LUFS (ATSC)</option>
          <option value={-27}>−27 LUFS (Kino-Dialog)</option>
          <option value={-16}>−16 LUFS (Podcast)</option>
          <option value={-14}>−14 LUFS (Streaming)</option>
        </select>
      </div>
      <div className="snd-loud">
        {rows.map(([label, value, key]) => (
          <React.Fragment key={key}>
            <span className="snd-loud__label">{compact ? key : label}</span>
            <div className="snd-loud__bar">
              <div className={`snd-loud__fill ${value > target + 1 ? 'snd-loud__fill--over' : ''}`} style={{ width: `${lufsFrac(value) * 100}%` }} />
              <div className="snd-loud__target" style={{ left: `${lufsFrac(target) * 100}%` }} />
            </div>
            <span className="snd-loud__value">{formatLufs(value)}</span>
          </React.Fragment>
        ))}
        <span className="snd-loud__label">LRA</span><span />
        <span className="snd-loud__value">{meters.rangeLu.toFixed(1)} LU</span>
        <span className="snd-loud__label">True Peak</span><span />
        <span className="snd-loud__value" style={{ color: meters.truePeakDb > mix.master.truePeakLimitDb ? 'var(--snd-hot)' : undefined }}>{Number.isFinite(meters.truePeakDb) ? formatDb(meters.truePeakDb) : '−∞'} dBTP</span>
      </div>
    </div>
  );
};

/** Muted picture monitor (the sound engine plays the audio). */
export const MiniViewer: React.FC<{ clips: TimelineClip[]; tracks: TimelineTrack[]; media: MediaItem[]; playhead: number; isPlaying: boolean }> = ({ clips, tracks, media, playhead, isPlaying }) => {
  const order = new Map(tracks.map((t, i) => [t.id, i]));
  const visual = clips
    .filter((c) => playhead >= c.start && playhead < c.end && !tracks.find((t) => t.id === c.trackId)?.isMuted)
    .map((c) => ({ c, m: media.find((x) => x.id === c.mediaId) }))
    .filter((x) => x.m && (x.m.type === 'video' || x.m.type === 'image'))
    .sort((a, b) => (order.get(b.c.trackId) ?? 0) - (order.get(a.c.trackId) ?? 0))[0];
  const ref = useRef<HTMLVideoElement | null>(null);
  const local = visual ? (visual.c.sourceIn ?? 0) + (playhead - visual.c.start) * (visual.c.speed || 1) : 0;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (Math.abs(el.currentTime - local) > (isPlaying ? 0.3 : 0.04)) el.currentTime = local;
    if (isPlaying && el.paused) void el.play().catch(() => undefined);
    if (!isPlaying && !el.paused) el.pause();
  }, [local, isPlaying]);
  return (
    <div className="snd-viewer" data-automation-id="sound-viewer">
      {!visual && <span className="snd-viewer__empty">Kein Bild an der Position</span>}
      {visual?.m?.type === 'video' && <video ref={ref} src={visual.m.url} muted playsInline preload="auto" />}
      {visual?.m?.type === 'image' && <img src={visual.m.url} alt="" draggable={false} />}
    </div>
  );
};

export const AdrPanel: React.FC<{ mix: SoundMix; run: RunCommand; playhead: number }> = ({ mix, run, playhead }) => (
  <div className="snd-panel snd-col" style={{ minHeight: 0, flex: 1 }} data-automation-id="sound-adr">
    <div className="snd-panel__head">
      <span>ADR-Cues</span>
      <span style={{ flex: 1 }} />
      <button type="button" className="snd-btn" data-automation-id="sound-adr-add" onClick={() => run('adr.addCue', { character: 'Rolle', line: '' })}>+ Cue</button>
    </div>
    <div className="snd-index">
      <table>
        <thead><tr><th>✓</th><th>In</th><th>Rolle</th><th>Text</th><th /></tr></thead>
        <tbody>
          {mix.adrCues.map((cue) => (
            <tr key={cue.id} aria-selected={playhead >= cue.start && playhead < cue.end}>
              <td><input type="checkbox" checked={cue.done} onChange={() => run('adr.updateCue', { cueId: cue.id, done: !cue.done })} /></td>
              <td style={{ cursor: 'pointer' }} onClick={() => run('transport.locate', { time: cue.start })}>{formatTime(cue.start)}</td>
              <td><input className="snd-input" style={{ width: 70 }} value={cue.character} onChange={(e) => run('adr.updateCue', { cueId: cue.id, character: e.target.value })} /></td>
              <td><input className="snd-input" style={{ width: '100%' }} value={cue.line} onChange={(e) => run('adr.updateCue', { cueId: cue.id, line: e.target.value })} /></td>
              <td><button type="button" className="snd-btn" onClick={() => run('adr.removeCue', { cueId: cue.id })}>×</button></td>
            </tr>
          ))}
          {mix.adrCues.length === 0 && <tr><td colSpan={5} className="snd-hint">Noch keine Cues. Bereich mit dem Selector wählen und „+ Cue“.</td></tr>}
        </tbody>
      </table>
    </div>
  </div>
);
