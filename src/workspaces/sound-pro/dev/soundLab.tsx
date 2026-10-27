/**
 * Sound Lab (dev only, like fx-lab): mounts the real Sound page with
 * synthetic test audio (dialog-like bursts, a chord bed, effects hits and a
 * room tone) so all three views can be checked in a browser without a
 * project or provider credits. `window.__soundLab.callTool(name, args)` runs
 * the MCP sound tools against the lab state.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { MediaItem, TimelineClip, TimelineTrack } from '../../../types';
import SoundWorkspace from '../../SoundWorkspace';
import { encodeWav } from '../engine/wav.ts';
import { createSoundMix, type SoundMix } from '../model.ts';
import { collectStudioTools, type StudioToolContext } from '../../../mcp/toolModules.ts';
import '../../../mcp/modules/soundTools.ts';

const SR = 48000;
let seed = 7;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };

const wavUrl = (channels: Float32Array[]) => URL.createObjectURL(new Blob([encodeWav(channels, SR, 'pcm16').buffer as ArrayBuffer], { type: 'audio/wav' }));

const makeDialog = (seconds: number) => {
  const out = new Float32Array(seconds * SR);
  let lp = 0, bp = 0;
  for (let i = 0; i < out.length; i++) {
    const t = i / SR;
    const word = Math.max(0, Math.sin(2 * Math.PI * 3.1 * t)) * (Math.sin(2 * Math.PI * 0.23 * t) > -0.3 ? 1 : 0);
    const n = rand();
    lp += 0.12 * (n - lp);
    bp += 0.3 * (lp - bp);
    const voiced = 0.6 * Math.sin(2 * Math.PI * 140 * t) * Math.sin(2 * Math.PI * 420 * t + Math.sin(2 * Math.PI * 5 * t));
    out[i] = 0.32 * word * (voiced + 2.5 * (lp - bp));
  }
  return [out];
};
const makeMusic = (seconds: number) => {
  const l = new Float32Array(seconds * SR), r = new Float32Array(seconds * SR);
  const notes = [220, 261.63, 329.63, 440, 523.25];
  for (let i = 0; i < l.length; i++) {
    const t = i / SR;
    const trem = 0.7 + 0.3 * Math.sin(2 * Math.PI * 0.5 * t);
    let a = 0, b = 0;
    notes.forEach((f, k) => { const s = Math.sin(2 * Math.PI * f * t + k); a += s * (k % 2 ? 0.6 : 1); b += s * (k % 2 ? 1 : 0.6); });
    l[i] = 0.07 * trem * a;
    r[i] = 0.07 * trem * b;
  }
  return [l, r];
};
const makeHits = (seconds: number) => {
  const out = new Float32Array(seconds * SR);
  for (const at of [0.2, 2.2, 4.2]) {
    const s = Math.round(at * SR);
    for (let i = 0; i < 0.6 * SR && s + i < out.length; i++) out[s + i] += 0.6 * rand() * Math.exp(-i / (0.08 * SR)) + 0.4 * Math.sin(2 * Math.PI * 60 * i / SR) * Math.exp(-i / (0.2 * SR));
  }
  return [out];
};
const makeRoom = (seconds: number) => {
  const l = new Float32Array(seconds * SR), r = new Float32Array(seconds * SR);
  let a = 0, b = 0;
  for (let i = 0; i < l.length; i++) { a += 0.02 * (rand() - a); b += 0.02 * (rand() - b); l[i] = 0.25 * a; r[i] = 0.25 * b; }
  return [l, r];
};

const media: MediaItem[] = [
  { id: 'm-dialog', name: 'Dialog Szene 4 (TTS).wav', type: 'audio', url: wavUrl(makeDialog(16)), source: 'generated', generatedBy: 'ElevenLabs Voiceover', duration: 16 },
  { id: 'm-music', name: 'Score Cue 1.wav', type: 'audio', url: wavUrl(makeMusic(26)), source: 'generated', generatedBy: 'Lyria 2 Music', duration: 26 },
  { id: 'm-sfx', name: 'Impacts.wav', type: 'audio', url: wavUrl(makeHits(5)), source: 'generated', generatedBy: 'Lyria 2 SFX', duration: 5 },
  { id: 'm-room', name: 'Raumton Halle.wav', type: 'audio', url: wavUrl(makeRoom(26)), source: 'upload', duration: 26 },
];
const tracksInit: TimelineTrack[] = [
  { id: 'a1', name: 'Dialog', type: 'audio', isLocked: false, isMuted: false },
  { id: 'a2', name: 'Musik', type: 'audio', isLocked: false, isMuted: false },
  { id: 'a3', name: 'Effekte', type: 'audio', isLocked: false, isMuted: false },
  { id: 'a4', name: 'Atmo', type: 'audio', isLocked: false, isMuted: false },
];
const clip = (id: string, mediaId: string, trackId: string, start: number, end: number, sourceIn = 0): TimelineClip => ({
  id, mediaId, trackId, start, end, duration: end - start, speed: 1, sourceIn, sourceOut: sourceIn + end - start, effect: null, volume: 1,
});
const clipsInit: TimelineClip[] = [
  clip('d1', 'm-dialog', 'a1', 2, 6.5, 0),
  clip('d2', 'm-dialog', 'a1', 8, 12, 5),
  clip('d3', 'm-dialog', 'a1', 15, 19, 10),
  clip('mu1', 'm-music', 'a2', 0, 24, 0),
  clip('fx1', 'm-sfx', 'a3', 4.8, 9.8, 0),
  clip('at1', 'm-room', 'a4', 0, 24, 0),
];

const Lab: React.FC = () => {
  const [clips, setClips] = useState(clipsInit);
  const [tracks, setTracks] = useState(tracksInit);
  const [items, setItems] = useState(media);
  const [mix, setMix] = useState<SoundMix>(() => {
    const params = new URLSearchParams(location.search);
    const m = createSoundMix();
    const view = params.get('view');
    if (view === 'fairlight' || view === 'protools' || view === 'studio') m.ui.view = view;
    return m;
  });
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const playRef = useRef(playhead);
  playRef.current = playhead;

  useEffect(() => {
    if (!isPlaying) return;
    let last = performance.now();
    let raf = 0;
    const tick = () => {
      const now = performance.now();
      const next = playRef.current + (now - last) / 1000;
      last = now;
      if (next >= 24) { setPlaying(false); setPlayhead(24); return; }
      setPlayhead(next);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying]);

  // MCP sound tools against the lab state (for agent-style checks in the browser)
  const stateRef = useRef({ clips, tracks, items, mix, playhead, selected });
  stateRef.current = { clips, tracks, items, mix, playhead, selected };
  const ctx = useMemo<StudioToolContext>(() => ({
    getState: () => ({
      activeWorkspace: 'SOUND', timelineClips: stateRef.current.clips, timelineTracks: stateRef.current.tracks, mediaItems: stateRef.current.items,
      playheadPosition: stateRef.current.playhead, selectedClipId: stateRef.current.selected, projectPath: null, extras: { soundMix: stateRef.current.mix },
    }),
    actions: {
      setActiveWorkspace: () => undefined,
      updateClip: (c) => { stateRef.current.clips = stateRef.current.clips.map((x) => (x.id === c.id ? c : x)); setClips(stateRef.current.clips); },
      setTimelineClips: (c) => { stateRef.current.clips = c; setClips(c); },
      setTimelineTracks: (t) => { stateRef.current.tracks = t; setTracks(t); },
      addMediaItem: (m) => { stateRef.current.items = [...stateRef.current.items, m]; setItems(stateRef.current.items); },
      setPlayhead: (s) => { stateRef.current.playhead = s; setPlayhead(s); },
      selectClip: (id) => setSelected(id),
      setExtra: (k, v) => { if (k === 'soundMix') { stateRef.current.mix = v as SoundMix; setMix(v as SoundMix); } },
    },
  }), []);
  useEffect(() => {
    const { executor, declarations } = collectStudioTools(() => ctx);
    (window as unknown as { __soundLab: unknown }).__soundLab = {
      tools: declarations.filter((d) => d.name.startsWith('sound_')).map((d) => d.name),
      callTool: (name: string, args: Record<string, unknown> = {}) => executor[name]?.(args) ?? Promise.resolve({ ok: false, message: 'unknown tool' }),
      state: () => stateRef.current,
    };
  }, [ctx]);

  return (
    <div style={{ height: '100%' }}>
      <SoundWorkspace
        mediaItems={items}
        timelineClips={clips}
        timelineTracks={tracks}
        activeTrackId={null}
        selectedClipId={selected}
        playheadPosition={playhead}
        isPlaying={isPlaying}
        isSnappingEnabled
        waveformCache={{}}
        trimMode={'ripple' as never}
        onSelectClip={setSelected}
        onUpdateClip={(c) => setClips((prev) => prev.map((x) => (x.id === c.id ? c : x)))}
        onBatchUpdateClips={(c) => setClips(c)}
        onTrimModeChange={() => undefined}
        onPlayheadUpdate={(s) => setPlayhead(Math.max(0, s))}
        onTogglePlayback={() => setPlaying((p) => !p)}
        onSnappingToggle={() => undefined}
        onSplitClip={() => undefined}
        onAddTrack={(type) => setTracks((prev) => [...prev, { id: `${type}-${prev.length + 1}`, name: `A${prev.length + 1}`, type, isLocked: false, isMuted: false }])}
        onUpdateTrack={(id, u) => setTracks((prev) => prev.map((t) => (t.id === id ? { ...t, ...u } : t)))}
        onSetActiveTrack={() => undefined}
        onAddGeneratedMedia={(m) => setItems((prev) => [...prev, m])}
        apiKeyReady={false}
        currentProjectName="Sound Lab"
        currentProjectPath={null}
        soundMix={mix}
        onSoundMixChange={setMix}
      />
    </div>
  );
};

createRoot(document.getElementById('root')!).render(<Lab />);
