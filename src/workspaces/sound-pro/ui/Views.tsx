/**
 * The three sound views over one mix document.
 *  - FairlightView: picture + loudness + track index on top, timeline, console below
 *  - ProToolsView:  Edit window (tools, edit modes, automation) ⇄ Mix window (inserts/sends)
 *  - StudioView:    our own condensed layout: AI browser, four stems, timeline, mix check, delivery
 */
import React, { useMemo, useState } from 'react';
import type { MediaItem, TimelineClip, TimelineTrack, WaveformCache } from '../../../types';
import { formatLufs } from '../engine/loudness.ts';
import { formatDb, MIN_DB, STEM_BUS_IDS, STEM_LABELS, STEM_ROLES, trackMixOf, type AutomationMode, type EditMode, type EditTool, type SoundMix, type StemRole } from '../model.ts';
import type { LiveMeters } from '../useSoundPlayback.ts';
import { BusStrip, MasterStrip, TrackStrip, type InsertTarget, type RunCommand } from './ChannelStrip.tsx';
import { InsertEditor } from './InsertEditor.tsx';
import { AdrPanel, LoudnessPanel, MiniViewer } from './Panels.tsx';
import { SoundTimeline } from './SoundTimeline.tsx';
import { formatTime } from './widgets.tsx';

export type ViewProps = {
  mix: SoundMix;
  tracks: TimelineTrack[];
  clips: TimelineClip[];
  media: MediaItem[];
  playhead: number;
  isPlaying: boolean;
  waveformCache: WaveformCache;
  meters: LiveMeters;
  run: RunCommand;
  sourcesVersion: number;
  /** Calls an MCP sound tool handler with the same context the MCP server uses. */
  callTool: (name: string, args: Record<string, unknown>) => Promise<Record<string, unknown>>;
  browser: React.ReactNode;
};

const audibleTracks = (tracks: TimelineTrack[], clips: TimelineClip[], media: MediaItem[]) => {
  const types = new Map(media.map((m) => [m.id, m.type]));
  return tracks.filter((t) => t.type === 'audio' || clips.some((c) => c.trackId === t.id && types.get(c.mediaId) === 'video'));
};

const insertTargetName = (mix: SoundMix, tracks: TimelineTrack[], target: InsertTarget) => {
  if (!target) return '';
  return mix.buses.find((b) => b.id === target.target)?.name ?? tracks.find((t) => t.id === target.target)?.name ?? target.target;
};

const Console: React.FC<ViewProps & { variant: 'fairlight' | 'protools'; editing: InsertTarget; setEditing: (t: InsertTarget) => void }> = (p) => {
  const strips = audibleTracks(p.tracks, p.clips, p.media);
  return (
    <div className="snd-mixer" style={{ flex: 1 }} data-automation-id={`sound-console-${p.variant}`}>
      {strips.map((track) => (
        <TrackStrip key={track.id} track={track} mix={p.mix} meter={p.meters.tracks[track.id]} variant={p.variant} selected={p.mix.ui.selectedTrackId === track.id} run={p.run} editing={p.editing} onEdit={p.setEditing} />
      ))}
      <div style={{ width: 8, flex: 'none' }} />
      {p.mix.buses.map((bus) => (
        <BusStrip key={bus.id} bus={bus} mix={p.mix} meter={p.meters.buses[bus.id]} variant={p.variant} run={p.run} editing={p.editing} onEdit={p.setEditing} />
      ))}
      <MasterStrip mix={p.mix} meter={p.meters.master} run={p.run} />
      <button type="button" className="snd-btn" style={{ alignSelf: 'flex-start' }} data-automation-id="sound-bus-add" onClick={() => p.run('bus.add', { kind: 'aux' })}>+ Aux</button>
    </div>
  );
};

const HeaderButtons: React.FC<{ track: TimelineTrack; mix: SoundMix; run: RunCommand; automation?: boolean }> = ({ track, mix, run, automation }) => {
  const t = trackMixOf(mix, track.id);
  return (
    <div className="snd-tl__head-row">
      <button type="button" className="snd-tog snd-tog--r" aria-pressed={t.recordArm} title="Aufnahmebereit" onClick={() => run('mixer.toggleRecordArm', { trackId: track.id })}>R</button>
      <button type="button" className="snd-tog snd-tog--s" aria-pressed={Boolean(track.isSolo)} title="Solo" data-automation-id={`sound-head-solo-${track.id}`} onClick={() => run('mixer.toggleSolo', { trackId: track.id })}>S</button>
      <button type="button" className="snd-tog snd-tog--m" aria-pressed={track.isMuted} title="Stumm" data-automation-id={`sound-head-mute-${track.id}`} onClick={() => run('mixer.toggleMute', { trackId: track.id })}>M</button>
      <button type="button" className="snd-tog snd-tog--l" aria-pressed={track.isLocked} title="Spur sperren" data-automation-id={`sound-head-lock-${track.id}`} onClick={() => run('mixer.toggleLock', { trackId: track.id })}>L</button>
      {automation ? (
        <select className="snd-select" style={{ width: 62 }} value={t.automationMode} data-automation-id={`sound-head-auto-${track.id}`} onChange={(e) => run('automation.setMode', { trackId: track.id, mode: e.target.value as AutomationMode })}>
          {['off', 'read', 'touch', 'latch', 'write'].map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      ) : (
        <span className="snd-hint" style={{ fontSize: 10 }}>{formatDb(t.gainDb)} dB</span>
      )}
    </div>
  );
};

/* ─── Fairlight ─── */

export const FairlightView: React.FC<ViewProps> = (p) => {
  const [editing, setEditing] = useState<InsertTarget>(null);
  const [consoleHeight, setConsoleHeight] = useState(330);
  const tracks = audibleTracks(p.tracks, p.clips, p.media);
  return (
    <div className="snd-body snd-col" style={{ position: 'relative' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '260px 280px 1fr 1fr', gap: 6, padding: 6, flex: 'none' }}>
        <MiniViewer clips={p.clips} tracks={p.tracks} media={p.media} playhead={p.playhead} isPlaying={p.isPlaying} />
        <LoudnessPanel meters={p.meters} mix={p.mix} run={p.run} />
        <div className="snd-panel snd-col" style={{ minHeight: 0, maxHeight: 160 }} data-automation-id="sound-index">
          <div className="snd-panel__head">Spuren-Index</div>
          <div className="snd-index">
            <table>
              <thead><tr><th>Spur</th><th>Bus</th><th>Fader</th><th>Clips</th></tr></thead>
              <tbody>
                {tracks.map((t) => {
                  const tm = trackMixOf(p.mix, t.id);
                  return (
                    <tr key={t.id} aria-selected={p.mix.ui.selectedTrackId === t.id} onClick={() => p.run('select.track', { trackId: t.id })}>
                      <td>{t.name ?? t.id}</td>
                      <td>{p.mix.buses.find((b) => b.id === tm.outputBusId)?.name ?? tm.outputBusId}</td>
                      <td>{formatDb(tm.gainDb)}</td>
                      <td>{p.clips.filter((c) => c.trackId === t.id).length}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        <div style={{ maxHeight: 160, display: 'flex' }}><AdrPanel mix={p.mix} run={p.run} playhead={p.playhead} /></div>
      </div>
      <SoundTimeline id="sound-fairlight-timeline" mix={p.mix} tracks={p.tracks} clips={p.clips} media={p.media} playhead={p.playhead} isPlaying={p.isPlaying} waveformCache={p.waveformCache} run={p.run} sourcesVersion={p.sourcesVersion} showCues
        renderHeader={(track) => <HeaderButtons track={track} mix={p.mix} run={p.run} />} />
      <div
        className="snd-split-v"
        onPointerDown={(e) => {
          const y0 = e.clientY, h0 = consoleHeight;
          const move = (ev: PointerEvent) => setConsoleHeight(Math.max(200, Math.min(620, h0 - (ev.clientY - y0))));
          const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
          window.addEventListener('pointermove', move);
          window.addEventListener('pointerup', up);
        }}
      />
      <div style={{ height: consoleHeight, display: 'flex', flex: 'none', minHeight: 0 }}>
        <Console {...p} variant="fairlight" editing={editing} setEditing={setEditing} />
      </div>
      {editing && <div className="snd-drawer"><InsertEditor mix={p.mix} target={editing} run={p.run} onClose={() => setEditing(null)} targetName={insertTargetName(p.mix, p.tracks, editing)} /></div>}
    </div>
  );
};

/* ─── Pro Tools ─── */

const EDIT_MODES: Array<[EditMode, string, string]> = [['shuffle', 'Shuffle', 'F1'], ['slip', 'Slip', 'F2'], ['spot', 'Spot', 'F3'], ['grid', 'Grid', 'F4']];
const TOOLS: Array<[EditTool, string, string]> = [['trimmer', 'Trimmer', 'F6'], ['selector', 'Selector', 'F7'], ['grabber', 'Grabber', 'F8'], ['smart', 'Smart', 'F10']];

export const ProToolsView: React.FC<ViewProps> = (p) => {
  const [editing, setEditing] = useState<InsertTarget>(null);
  const [spotTime, setSpotTime] = useState('');
  const ui = p.mix.ui;
  const selectedClip = p.clips.find((c) => c.id === ui.selectedClipIds[0]);
  return (
    <div className="snd-body snd-col" style={{ position: 'relative' }}>
      <div className="snd-bar" style={{ background: 'var(--snd-panel-2)' }}>
        <div className="snd-seg" role="group" aria-label="Fenster">
          <button type="button" aria-pressed={ui.proToolsWindow === 'edit'} data-automation-id="sound-pt-window-edit" onClick={() => p.run('view.toggleMixWindow', { window: 'edit' })}>Edit</button>
          <button type="button" aria-pressed={ui.proToolsWindow === 'mix'} data-automation-id="sound-pt-window-mix" onClick={() => p.run('view.toggleMixWindow', { window: 'mix' })}>Mix</button>
        </div>
        {ui.proToolsWindow === 'edit' && (
          <>
            <div className="snd-seg" role="group" aria-label="Edit-Modus">
              {EDIT_MODES.map(([mode, label, key]) => (
                <button key={mode} type="button" aria-pressed={ui.editMode === mode} title={`${label} (${key})`} data-automation-id={`sound-edit-mode-${mode}`} onClick={() => p.run('edit.setMode', { mode })}>{label}</button>
              ))}
            </div>
            <div className="snd-seg" role="group" aria-label="Werkzeug">
              {TOOLS.map(([tool, label, key]) => (
                <button key={tool} type="button" aria-pressed={ui.tool === tool} title={`${label} (${key})`} data-automation-id={`sound-tool-${tool}`} onClick={() => p.run('edit.setTool', { tool })}>{label}</button>
              ))}
            </div>
            <label className="snd-hint">Grid
              <select className="snd-select" style={{ marginLeft: 4 }} value={ui.gridSec} data-automation-id="sound-grid" onChange={(e) => p.run('edit.setGrid', { gridSec: Number(e.target.value), nudgeSec: Number(e.target.value) })}>
                {[0.04, 0.1, 0.25, 0.5, 1, 2, 5].map((g) => <option key={g} value={g}>{g < 0.05 ? '1 Frame' : `${g} s`}</option>)}
              </select>
            </label>
            <button type="button" className={`snd-btn ${ui.showAutomation ? 'snd-btn--on' : ''}`} data-automation-id="sound-toggle-automation" onClick={() => p.run('view.toggleAutomation')}>Automation</button>
            <button type="button" className="snd-btn" data-automation-id="sound-zoom-out" onClick={() => p.run('view.zoom', { factor: 0.7 })}>−</button>
            <button type="button" className="snd-btn" data-automation-id="sound-zoom-in" onClick={() => p.run('view.zoom', { factor: 1.4 })}>+</button>
            {ui.selection && <span className="snd-hint">Auswahl {formatTime(ui.selection.start)} – {formatTime(ui.selection.end)}</span>}
            {ui.selection && <button type="button" className="snd-btn" data-automation-id="sound-delete-selection" onClick={() => p.run('edit.deleteSelection')}>Auswahl löschen</button>}
            {selectedClip && (
              <>
                <button type="button" className="snd-btn" data-automation-id="sound-crossfade" onClick={() => p.run('clip.crossfade', { clipId: selectedClip.id, duration: 0.5 })}>Crossfade</button>
                <button type="button" className="snd-btn" data-automation-id="sound-split" onClick={() => p.run('clip.split', { clipIds: [selectedClip.id], time: p.playhead })}>Teilen</button>
              </>
            )}
            {ui.editMode === 'spot' && selectedClip && (
              <span className="snd-hint" data-automation-id="sound-spot-dialog" style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                Spot „{p.media.find((m) => m.id === selectedClip.mediaId)?.name ?? selectedClip.id}“ auf
                <input className="snd-input" style={{ width: 70 }} placeholder={selectedClip.start.toFixed(3)} value={spotTime} onChange={(e) => setSpotTime(e.target.value)} data-automation-id="sound-spot-time" />s
                <button type="button" className="snd-btn snd-btn--primary" data-automation-id="sound-spot-apply" onClick={() => { const t = Number(spotTime.replace(',', '.')); if (Number.isFinite(t)) p.run('clip.move', { clipId: selectedClip.id, start: t, mode: 'spot' }); setSpotTime(''); }}>Platzieren</button>
              </span>
            )}
          </>
        )}
      </div>
      {ui.proToolsWindow === 'edit' ? (
        <SoundTimeline id="sound-protools-timeline" mix={p.mix} tracks={p.tracks} clips={p.clips} media={p.media} playhead={p.playhead} isPlaying={p.isPlaying} waveformCache={p.waveformCache} run={p.run} sourcesVersion={p.sourcesVersion} headerWidth={210} laneHeight={72}
          renderHeader={(track) => <HeaderButtons track={track} mix={p.mix} run={p.run} automation />} />
      ) : (
        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}><Console {...p} variant="protools" editing={editing} setEditing={setEditing} /></div>
      )}
      {editing && <div className="snd-drawer"><InsertEditor mix={p.mix} target={editing} run={p.run} onClose={() => setEditing(null)} targetName={insertTargetName(p.mix, p.tracks, editing)} /></div>}
    </div>
  );
};

/* ─── Studio (own layout, ArtCraft way) ─── */

type CheckItem = { level: 'ok' | 'warn' | 'bad'; text: string };

export const StudioView: React.FC<ViewProps> = (p) => {
  const [busy, setBusy] = useState<string | null>(null);
  const [measure, setMeasure] = useState<Record<string, unknown> | null>(null);
  const [delivery, setDelivery] = useState<Record<string, unknown> | null>(null);
  const [normalize, setNormalize] = useState(false);
  const [stems, setStems] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const tracks = audibleTracks(p.tracks, p.clips, p.media);
  const unrouted = tracks.filter((t) => !trackMixOf(p.mix, t.id).role);

  const checks = useMemo<CheckItem[]>(() => {
    const list: CheckItem[] = [];
    if (unrouted.length) list.push({ level: 'warn', text: `${unrouted.length} Spur(en) ohne Stem-Rolle: ${unrouted.map((t) => t.name ?? t.id).join(', ')}` });
    else if (tracks.length) list.push({ level: 'ok', text: 'Alle Spuren sind Stems zugeordnet.' });
    if (measure) {
      const lufs = measure.integratedLufs as number | null;
      const tp = measure.truePeakDbtp as number | null;
      const target = p.mix.master.targetLufs;
      if (lufs === null) list.push({ level: 'warn', text: 'Im Bereich ist nur Stille.' });
      else {
        const off = lufs - target;
        list.push({ level: Math.abs(off) <= 1 ? 'ok' : Math.abs(off) <= 3 ? 'warn' : 'bad', text: `Loudness ${formatLufs(lufs)} LUFS, Ziel ${target} (${off > 0 ? '+' : ''}${off.toFixed(1)} LU)` });
      }
      if (tp !== null) list.push({ level: tp > p.mix.master.truePeakLimitDb ? 'bad' : 'ok', text: `True Peak ${tp.toFixed(1)} dBTP (Grenze ${p.mix.master.truePeakLimitDb})` });
      list.push({ level: 'ok', text: `Loudness Range ${measure.rangeLu} LU` });
    } else list.push({ level: 'warn', text: 'Noch nicht gemessen: „Mischung messen“.' });
    const music = tracks.filter((t) => trackMixOf(p.mix, t.id).role === 'music');
    if (music.length && tracks.some((t) => trackMixOf(p.mix, t.id).role === 'dialog')) {
      const ducked = music.some((t) => (trackMixOf(p.mix, t.id).automation.volume?.length ?? 0) > 0);
      list.push({ level: ducked ? 'ok' : 'warn', text: ducked ? 'Musik wird unter Dialog abgesenkt.' : 'Musik läuft unter Dialog in voller Lautstärke.' });
    }
    return list;
  }, [unrouted, tracks, measure, p.mix]);

  const call = async (label: string, name: string, args: Record<string, unknown>, set: (r: Record<string, unknown>) => void) => {
    setBusy(label);
    setNote(null);
    try {
      const r = await p.callTool(name, args);
      if (r.ok === false) setNote(String(r.message));
      else set(r);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="snd-body">
      <div className="snd-browser" data-automation-id="sound-studio-browser">{p.browser}</div>
      <div className="snd-col" style={{ flex: 1 }}>
        <div className="snd-stems" data-automation-id="sound-stems">
          {STEM_ROLES.map((role: StemRole) => {
            const bus = p.mix.buses.find((b) => b.id === STEM_BUS_IDS[role]);
            const members = tracks.filter((t) => trackMixOf(p.mix, t.id).role === role);
            const m = p.meters.buses[STEM_BUS_IDS[role]];
            return (
              <div key={role} className="snd-stem" style={{ ['--snd-role' as string]: `var(--snd-role-${role})` }} data-automation-id={`sound-stem-${role}`}>
                <div className="snd-stem__head">
                  <span>{STEM_LABELS[role]}</span>
                  <span className="snd-hint">{members.length} Spur{members.length === 1 ? '' : 'en'}</span>
                  <span style={{ flex: 1 }} />
                  {bus && <button type="button" className="snd-tog snd-tog--s" aria-pressed={bus.solo} onClick={() => p.run('bus.set', { busId: bus.id, solo: !bus.solo })}>S</button>}
                  {bus && <button type="button" className="snd-tog snd-tog--m" aria-pressed={bus.mute} onClick={() => p.run('bus.set', { busId: bus.id, mute: !bus.mute })}>M</button>}
                </div>
                {bus ? (
                  <div className="snd-stem__fader">
                    <input type="range" min={-40} max={12} step={0.5} value={Math.max(-40, bus.gainDb)} data-automation-id={`sound-stem-${role}-fader`} onChange={(e) => p.run('bus.set', { busId: bus.id, gainDb: Number(e.target.value) <= -40 ? MIN_DB : Number(e.target.value) })} onDoubleClick={() => p.run('bus.set', { busId: bus.id, gainDb: 0 })} />
                    <span style={{ width: 44, textAlign: 'right' }}>{formatDb(bus.gainDb)}</span>
                  </div>
                ) : <span className="snd-hint">Bus fehlt – „Stems zuordnen“ legt ihn an.</span>}
                <div className="snd-loud__bar"><div className="snd-loud__fill" style={{ width: `${m ? Math.max(0, Math.min(1, (m.rmsDb[0] + 60) / 66)) * 100 : 0}%` }} /></div>
              </div>
            );
          })}
        </div>
        <SoundTimeline id="sound-studio-timeline" mix={p.mix} tracks={p.tracks} clips={p.clips} media={p.media} playhead={p.playhead} isPlaying={p.isPlaying} waveformCache={p.waveformCache} run={p.run} sourcesVersion={p.sourcesVersion} headerWidth={170}
          renderHeader={(track) => (
            <div className="snd-tl__head-row">
              <select className="snd-select" style={{ width: 80 }} value={trackMixOf(p.mix, track.id).role ?? 'none'} data-automation-id={`sound-studio-role-${track.id}`} onChange={(e) => p.run('mixer.setRole', { trackId: track.id, role: e.target.value })}>
                <option value="none">Rolle –</option>
                {STEM_ROLES.map((r) => <option key={r} value={r}>{STEM_LABELS[r]}</option>)}
              </select>
              <button type="button" className="snd-tog snd-tog--s" aria-pressed={Boolean(track.isSolo)} onClick={() => p.run('mixer.toggleSolo', { trackId: track.id })}>S</button>
              <button type="button" className="snd-tog snd-tog--m" aria-pressed={track.isMuted} onClick={() => p.run('mixer.toggleMute', { trackId: track.id })}>M</button>
              <button type="button" className="snd-tog snd-tog--l" aria-pressed={track.isLocked} title="Spur sperren" data-automation-id={`sound-studio-lock-${track.id}`} onClick={() => p.run('mixer.toggleLock', { trackId: track.id })}>L</button>
            </div>
          )} />
      </div>
      <div className="snd-col" style={{ width: 300, flex: 'none', borderLeft: '1px solid var(--snd-line)', padding: 6, gap: 6, overflow: 'auto' }}>
        <LoudnessPanel meters={p.meters} mix={p.mix} run={p.run} compact />
        <div className="snd-panel" data-automation-id="sound-studio-check">
          <div className="snd-panel__head">Mischung prüfen</div>
          <div className="snd-check">
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
              <button type="button" className="snd-btn" data-automation-id="sound-studio-autoroute" onClick={() => p.run('studio.autoRoute')}>Stems zuordnen</button>
              <button type="button" className="snd-btn" data-automation-id="sound-studio-duck" onClick={() => p.run('studio.duckMusic', { amountDb: -10 })}>Musik unter Dialog −10 dB</button>
              <button type="button" className="snd-btn snd-btn--primary" disabled={Boolean(busy)} data-automation-id="sound-studio-measure" onClick={() => call('measure', 'sound_measure_loudness', {}, setMeasure)}>{busy === 'measure' ? 'Messe…' : 'Mischung messen'}</button>
            </div>
            {checks.map((c, i) => (
              <div key={i} className="snd-check__item"><span className={`snd-check__dot snd-check__dot--${c.level}`} /><span>{c.text}</span></div>
            ))}
          </div>
        </div>
        <div className="snd-panel" data-automation-id="sound-studio-delivery">
          <div className="snd-panel__head">Ausgabe</div>
          <div className="snd-check">
            <label><input type="checkbox" checked={normalize} onChange={(e) => setNormalize(e.target.checked)} data-automation-id="sound-studio-normalize" /> auf {p.mix.master.targetLufs} LUFS normalisieren</label>
            <label><input type="checkbox" checked={stems} onChange={(e) => setStems(e.target.checked)} data-automation-id="sound-studio-stems" /> Stems mitliefern (Dialog, Musik, Effekte, Atmo)</label>
            <button type="button" className="snd-btn snd-btn--primary" disabled={Boolean(busy)} data-automation-id="sound-studio-mixdown" onClick={() => call('mixdown', 'sound_mixdown', { normalize, stems }, setDelivery)}>{busy === 'mixdown' ? 'Rendere…' : 'Mixdown als WAV'}</button>
            {delivery && (
              <div className="snd-hint">
                {(delivery.files as Array<{ name: string; integratedLufs: number | null; truePeakDbtp: number | null }>).map((f) => (
                  <div key={f.name}>{f.name}: {formatLufs(f.integratedLufs ?? -Infinity)} LUFS · TP {f.truePeakDbtp ?? '−∞'}</div>
                ))}
                <div>Im Medienpool abgelegt.</div>
              </div>
            )}
            {note && <div className="snd-error" style={{ whiteSpace: 'normal' }}>{note}</div>}
          </div>
        </div>
      </div>
    </div>
  );
};
