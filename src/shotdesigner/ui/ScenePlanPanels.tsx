/**
 * Scene Map · Kameraplan panels: inspector with viewfinder, timeline with blocking marks, shot list.
 */
import React, { useMemo, useRef } from 'react';
import { ArrowDown, ArrowUp, Camera, Clapperboard, Diamond, Link, Lock, Pause, Play, Plus, SkipBack, SkipForward, Trash2, Unlock } from 'lucide-react';
import type { ReferenceItem, ShotPrompt } from '../../types';
import {
  cameraFovDeg, camerasAt, charactersAt, CAMERA_MOVES, LENS_PRESETS_MM, SENSOR_PRESETS, SHOT_SIZES, type StageState,
} from '../../scene/stageModel.ts';
import { PLAN_LIBRARY, planElementOf, type StageHost } from '../planModel.ts';
import { cameraViewToSvg, renderCameraView } from '../cameraView.ts';
import { MOVE_LABELS, SHOT_SIZE_LABELS, axisWarnings } from '../shotGeometry.ts';
import { orderedShots, shotRows } from '../shotList.ts';
import { renderFrameUrl } from '../exportService.ts';
import { syncStoryboard } from '../storyboardLink.ts';
import { dispatchBatch, getBridge, getHost, setTime, updateSession, type SceneMapSession } from '../session.ts';
import type { CommandResult } from '../commands.ts';

type Run = (id: string, params?: Record<string, unknown>) => CommandResult;
type PanelProps = { host: StageHost & { stage: StageState }; session: SceneMapSession; run: Run; flash: (text: string, error?: boolean) => void; shotPrompts: ShotPrompt[] };

const num = (v: string) => (v.trim() === '' ? undefined : Number(v.replace(',', '.')));
const fmt = (v: number, d = 2) => (Math.round(v * 10 ** d) / 10 ** d).toString();

/** Number input that commits on blur/Enter (one undo step per edit). */
const NumField: React.FC<{ value: number; onCommit: (v: number) => void; step?: number; id: string; suffix?: string; min?: number; max?: number }> = ({ value, onCommit, step = 0.1, id, suffix, min, max }) => {
  const [text, setText] = React.useState(fmt(value));
  React.useEffect(() => setText(fmt(value)), [value]);
  const commit = () => {
    const v = num(text);
    if (v === undefined || !Number.isFinite(v)) { setText(fmt(value)); return; }
    if (Math.abs(v - value) > 1e-9) onCommit(v);
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
      <input className="sp-input" type="number" step={step} min={min} max={max} value={text} data-automation-id={id} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />
      {suffix && <span style={{ color: 'var(--sp-muted)' }}>{suffix}</span>}
    </div>
  );
};

const TextField: React.FC<{ value: string; onCommit: (v: string) => void; id: string; multiline?: boolean; placeholder?: string }> = ({ value, onCommit, id, multiline, placeholder }) => {
  const [text, setText] = React.useState(value);
  React.useEffect(() => setText(value), [value]);
  const commit = () => { if (text !== value) onCommit(text); };
  return multiline
    ? <textarea className="sp-input" value={text} placeholder={placeholder} data-automation-id={id} onChange={(e) => setText(e.target.value)} onBlur={commit} />
    : <input className="sp-input" value={text} placeholder={placeholder} data-automation-id={id} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} />;
};

const ASPECTS: Array<[number, string]> = [[16 / 9, '16:9'], [2.39, '2,39:1 Scope'], [1.85, '1,85:1'], [4 / 3, '4:3'], [1, '1:1'], [9 / 16, '9:16 vertikal']];

// ── viewfinder ──
const Viewfinder: React.FC<PanelProps> = ({ host, session, run, flash }) => {
  const stage = host.stage;
  const cams = camerasAt(stage, session.timeS);
  const selectedCam = cams.find((c) => session.selection.includes(c.id));
  const cam = selectedCam ?? cams.find((c) => c.id === stage.activeCameraId) ?? cams[0];
  const svg = useMemo(() => {
    if (!cam) return null;
    const frame = renderCameraView(host, cam.id, session.timeS, 560);
    return frame ? cameraViewToSvg(frame, { info: `${cam.name} · ${Math.round(cam.focalLengthMm)} mm` }) : null;
  }, [host, cam, session.timeS]);
  if (!cam) return <div className="sp-section"><div className="sp-h" style={{ marginTop: 0 }}>Sucher</div><div style={{ color: 'var(--sp-muted)' }}>Noch keine Kamera. Mit „Kamera“ (C) setzen.</div></div>;
  const shot = orderedShots(stage).find((s) => s.cameraId === cam.id && s.startS <= session.timeS + 1e-6 && s.endS >= session.timeS - 1e-6) ?? stage.shots.find((s) => s.cameraId === cam.id);
  const capture = async () => {
    if (!shot) return;
    const url = await renderFrameUrl(getHost(), cam.id, session.timeS, 960, `${shot.number}${shot.version}`);
    if (!url) { flash('Sucherbild konnte nicht erzeugt werden.', true); return; }
    const out = run('shot.link', { id: shot.id, frameUrl: url });
    if (out.ok) flash(`Frame für ${shot.number}${shot.version} gespeichert`);
  };
  return (
    <div className="sp-section" data-automation-id="scene-plan-viewfinder">
      <div className="sp-h" style={{ marginTop: 0 }}>Sucher · Kamera {cam.name}</div>
      {/* Generated by cameraViewToSvg from escaped data only. */}
      <div className="sp-finder" dangerouslySetInnerHTML={{ __html: svg || '' }} />
      <div className="sp-finder__bar">
        <span>{Math.round(cam.focalLengthMm)} mm · {fmt(cameraFovDeg(cam, stage.aspectRatio || 16 / 9).horizontal, 1)}° · {fmt(cam.position.y, 2)} m</span>
        <span style={{ display: 'flex', gap: 3 }}>
          {stage.activeCameraId !== cam.id && <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-set-active" onClick={() => run('camera.setActive', { id: cam.id })}>Aktiv</button>}
          <button type="button" className="sp-btn sp-btn--small" disabled={!shot} data-automation-id="scene-plan-capture-frame" title="Sucherbild als Storyboard-Frame am Shot speichern" onClick={() => void capture()}><Camera className="sp-icon" />Frame</button>
        </span>
      </div>
    </div>
  );
};

export const ScenePlanInspector: React.FC<PanelProps & { references: ReferenceItem[] }> = (props) => {
  const { host, session, run, references } = props;
  const stage = host.stage;
  const id = session.selection[0];
  const chars = charactersAt(stage, session.timeS);
  const cams = camerasAt(stage, session.timeS, chars);
  const chr = chars.find((c) => c.id === id);
  const cam = cams.find((c) => c.id === id);
  const asset = host.assets.find((a) => a.id === id);
  const keys = id ? stage.animation.tracks[id] || [] : [];
  const selKey = keys.find((k) => k.id === session.selectedKeyId);
  const cast = references.filter((r) => r.type === 'character');

  const keysSection = id && (chr || cam) && (
    <div className="sp-section">
      <div className="sp-h" style={{ marginTop: 0 }}>Bewegung</div>
      {keys.length === 0 && <div style={{ color: 'var(--sp-muted)', marginBottom: 6 }}>Statisch. Playhead verschieben, Objekt ziehen und „Position merken“ (K) drücken.</div>}
      {keys.map((k, i) => (
        <div key={k.id} className="sp-row" style={{ gridTemplateColumns: '1fr auto auto' }}>
          <button type="button" className={`sp-btn sp-btn--small ${session.selectedKeyId === k.id ? 'sp-on' : ''}`} data-automation-id={`scene-plan-key-${i}`} onClick={() => updateSession({ selectedKeyId: k.id, timeS: k.timeS })}>
            <Diamond className="sp-icon" />{i + 1} · {fmt(k.timeS, 1)} s · x {fmt(k.position.x, 1)} z {fmt(k.position.z, 1)}
          </button>
          <select className="sp-select" style={{ width: 82 }} value={k.easing || 'smooth'} data-automation-id={`scene-plan-key-easing-${i}`} onChange={(e) => run('key.update', { id, keyId: k.id, easing: e.target.value })}>
            <option value="smooth">weich</option><option value="linear">linear</option><option value="hold">halten</option>
          </select>
          <button type="button" className="sp-btn sp-btn--small" title="Marke löschen" data-automation-id={`scene-plan-key-delete-${i}`} onClick={() => run('key.delete', { id, keyId: k.id })}><Trash2 className="sp-icon" /></button>
        </div>
      ))}
      {selKey && (
        <div className="sp-row"><label>Zeit der Marke</label><NumField id="scene-plan-key-time" value={selKey.timeS} suffix="s" onCommit={(v) => run('key.update', { id, keyId: selKey.id, timeS: v })} /></div>
      )}
      <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
        <button type="button" className="sp-btn sp-btn--small sp-btn--primary" data-automation-id="scene-plan-add-key" onClick={() => run('key.add', { id })}><Plus className="sp-icon" />Position merken (K)</button>
        {keys.length > 0 && <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-slower" onClick={() => run('track.retime', { id, factor: 1.25 })}>langsamer</button>}
        {keys.length > 0 && <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-faster" onClick={() => run('track.retime', { id, factor: 0.8 })}>schneller</button>}
        {keys.length > 0 && <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-clear-track" onClick={() => run('track.clear', { id })}>Bewegung entfernen</button>}
      </div>
    </div>
  );

  return (
    <div className="sp-right" data-automation-id="scene-plan-inspector">
      <Viewfinder {...props} />
      {chr && (
        <div className="sp-section">
          <div className="sp-h" style={{ marginTop: 0 }}>Figur</div>
          <div className="sp-row"><label>Name</label><TextField id="scene-plan-char-name" value={chr.name} onCommit={(v) => run('character.update', { id: chr.id, name: v })} /></div>
          <div className="sp-row"><label>Cast</label>
            <select className="sp-select" value={chr.referenceId || ''} data-automation-id="scene-plan-char-cast" onChange={(e) => { const ref = cast.find((r) => r.id === e.target.value); run('character.update', { id: chr.id, referenceId: e.target.value, ...(ref ? { name: ref.name } : {}) }); }}>
              <option value="">– frei –</option>
              {cast.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="sp-row"><label>Lage x / z</label><div className="sp-pair"><NumField id="scene-plan-char-x" value={chr.position.x} onCommit={(v) => run('object.move', { id: chr.id, x: v })} /><NumField id="scene-plan-char-z" value={chr.position.z} onCommit={(v) => run('object.move', { id: chr.id, z: v })} /></div></div>
          <div className="sp-row"><label>Blickrichtung</label><NumField id="scene-plan-char-yaw" value={chr.yawDeg} step={15} suffix="°" onCommit={(v) => run('object.rotate', { id: chr.id, yawDeg: v })} /></div>
          <div className="sp-row"><label>Größe</label><NumField id="scene-plan-char-height" value={chr.heightM} step={0.05} suffix="m" onCommit={(v) => run('character.update', { id: chr.id, heightM: v })} /></div>
          <div className="sp-row"><label>Haltung</label>
            <select className="sp-select" value={chr.posture || 'standing'} data-automation-id="scene-plan-char-posture" onChange={(e) => run('character.update', { id: chr.id, posture: e.target.value })}>
              <option value="standing">steht</option><option value="sitting">sitzt</option><option value="lying">liegt</option>
            </select>
          </div>
          <div className="sp-row"><label>Farbe</label><input type="color" className="sp-input" value={chr.color || '#f76b15'} data-automation-id="scene-plan-char-color" onChange={(e) => run('character.update', { id: chr.id, color: e.target.value })} /></div>
          <div className="sp-row"><label>180°-Linie</label>
            <select className="sp-select" value={stage.lineOfAction && (stage.lineOfAction.aId === chr.id || stage.lineOfAction.bId === chr.id) ? (stage.lineOfAction.aId === chr.id ? stage.lineOfAction.bId : stage.lineOfAction.aId) : ''} data-automation-id="scene-plan-line-of-action" onChange={(e) => run('scene.setLineOfAction', e.target.value ? { aId: chr.id, bId: e.target.value } : {})}>
              <option value="">– keine –</option>
              {stage.characters.filter((c) => c.id !== chr.id).map((c) => <option key={c.id} value={c.id}>zu {c.name}</option>)}
            </select>
          </div>
          <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-char-lock" onClick={() => run('object.setFlags', { id: chr.id, locked: !chr.locked })}>{chr.locked ? <Lock className="sp-icon" /> : <Unlock className="sp-icon" />}{chr.locked ? 'Gesperrt' : 'Sperren'}</button>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            {(['single', 'ots', 'profile', 'closeup'] as const).map((pattern) => (
              <button key={pattern} type="button" className="sp-btn sp-btn--small" data-automation-id={`scene-plan-cover-${pattern}`} onClick={() => run('camera.cover', { targetId: chr.id, pattern })}>
                <Camera className="sp-icon" />{pattern === 'single' ? 'Einzel' : pattern === 'ots' ? 'Over-Shoulder' : pattern === 'profile' ? 'Profil' : 'Groß'}
              </button>
            ))}
          </div>
        </div>
      )}
      {cam && (
        <div className="sp-section">
          <div className="sp-h" style={{ marginTop: 0 }}>Kamera</div>
          <div className="sp-row"><label>Name</label><TextField id="scene-plan-cam-name" value={cam.name} onCommit={(v) => run('camera.update', { id: cam.id, name: v })} /></div>
          <div className="sp-row"><label>Brennweite</label><NumField id="scene-plan-cam-focal" value={cam.focalLengthMm} step={1} suffix="mm" onCommit={(v) => run('camera.update', { id: cam.id, focalLengthMm: v })} /></div>
          <div className="sp-lens">
            {LENS_PRESETS_MM.map((mm) => <button key={mm} type="button" className={`sp-btn sp-btn--small ${Math.round(cam.focalLengthMm) === mm ? 'sp-on' : ''}`} data-automation-id={`scene-plan-lens-${mm}`} onClick={() => run('camera.update', { id: cam.id, focalLengthMm: mm })}>{mm}</button>)}
          </div>
          <div className="sp-row"><label>Sensor</label>
            <select className="sp-select" value={SENSOR_PRESETS.find((p) => Math.abs(p.widthMm - cam.sensorWidthMm) < 0.01)?.id || ''} data-automation-id="scene-plan-cam-sensor" onChange={(e) => run('camera.update', { id: cam.id, sensor: e.target.value })}>
              <option value="">{fmt(cam.sensorWidthMm, 2)} × {fmt(cam.sensorHeightMm, 2)} mm</option>
              {SENSOR_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </div>
          <div className="sp-row"><label>Lage x / z</label><div className="sp-pair"><NumField id="scene-plan-cam-x" value={cam.position.x} onCommit={(v) => run('object.move', { id: cam.id, x: v })} /><NumField id="scene-plan-cam-z" value={cam.position.z} onCommit={(v) => run('object.move', { id: cam.id, z: v })} /></div></div>
          <div className="sp-row"><label>Höhe</label><NumField id="scene-plan-cam-height" value={cam.position.y} step={0.05} suffix="m" onCommit={(v) => run('camera.update', { id: cam.id, heightM: v })} /></div>
          <div className="sp-row"><label>Schwenk</label><NumField id="scene-plan-cam-yaw" value={cam.yawDeg} step={5} suffix="°" onCommit={(v) => run('object.rotate', { id: cam.id, yawDeg: v })} /></div>
          <div className="sp-row"><label>Neigung</label><NumField id="scene-plan-cam-pitch" value={cam.pitchDeg} step={1} suffix="°" onCommit={(v) => run('camera.update', { id: cam.id, pitchDeg: v })} /></div>
          <div className="sp-row"><label>Folgt</label>
            <select className="sp-select" value={cam.followId || ''} data-automation-id="scene-plan-cam-follow" onChange={(e) => (e.target.value ? run('camera.aimAt', { id: cam.id, targetId: e.target.value, follow: true }) : run('object.rotate', { id: cam.id, delta: 0 }))}>
              <option value="">– niemandem –</option>
              {stage.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
            <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-cam-aim" onClick={() => { const t = chars[0]; if (t) run('camera.aimAt', { id: cam.id, targetId: t.id }); }}>Auf Figur richten (L)</button>
            <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-cam-add-shot" onClick={() => run('shot.add', { cameraId: cam.id, startS: session.timeS })}><Plus className="sp-icon" />Shot-Version (S)</button>
          </div>
        </div>
      )}
      {asset && (() => {
        const el = planElementOf(asset);
        return (
          <div className="sp-section">
            <div className="sp-h" style={{ marginTop: 0 }}>{PLAN_LIBRARY.find((e) => e.category === el.category)?.label || 'Objekt'}{el.source === 'model' ? ' (3D-Modell)' : ''}</div>
            <div className="sp-row"><label>Bezeichnung</label><TextField id="scene-plan-el-label" value={el.label} onCommit={(v) => run('plan.updateElement', { id: el.id, label: v })} /></div>
            <div className="sp-row"><label>Lage x / z</label><div className="sp-pair"><NumField id="scene-plan-el-x" value={el.x} onCommit={(v) => run('plan.updateElement', { id: el.id, x: v })} /><NumField id="scene-plan-el-z" value={el.z} onCommit={(v) => run('plan.updateElement', { id: el.id, z: v })} /></div></div>
            <div className="sp-row"><label>Breite / Tiefe</label><div className="sp-pair"><NumField id="scene-plan-el-w" value={el.w} onCommit={(v) => run('plan.updateElement', { id: el.id, w: v })} /><NumField id="scene-plan-el-d" value={el.d} onCommit={(v) => run('plan.updateElement', { id: el.id, d: v })} /></div></div>
            <div className="sp-row"><label>Höhe</label><NumField id="scene-plan-el-h" value={el.h} suffix="m" onCommit={(v) => run('plan.updateElement', { id: el.id, h: v })} /></div>
            <div className="sp-row"><label>Drehung</label><NumField id="scene-plan-el-yaw" value={el.yawDeg} step={15} suffix="°" onCommit={(v) => run('plan.updateElement', { id: el.id, yawDeg: v })} /></div>
            <div className="sp-row"><label>Farbe</label><input type="color" className="sp-input" value={el.color.startsWith('#') && el.color.length === 7 ? el.color : '#999999'} data-automation-id="scene-plan-el-color" onChange={(e) => run('plan.updateElement', { id: el.id, color: e.target.value })} /></div>
          </div>
        );
      })()}
      {keysSection}
      {!id && (
        <div className="sp-section">
          <div className="sp-h" style={{ marginTop: 0 }}>Szene</div>
          <div className="sp-row"><label>Länge</label><NumField id="scene-plan-duration" value={stage.animation.durationS} step={1} suffix="s" onCommit={(v) => run('anim.setDuration', { durationS: v })} /></div>
          <div className="sp-row"><label>Bildformat</label>
            <select className="sp-select" value={ASPECTS.find(([a]) => Math.abs(a - (stage.aspectRatio || 16 / 9)) < 0.01)?.[0] ?? ''} data-automation-id="scene-plan-aspect" onChange={(e) => run('scene.setAspect', { aspectRatio: Number(e.target.value) })}>
              {ASPECTS.map(([a, label]) => <option key={label} value={a}>{label}</option>)}
            </select>
          </div>
          {stage.plan?.backgroundUrl && (
            <>
              <div className="sp-row"><label>Plan-Maßstab</label><NumField id="scene-plan-bg-scale" value={(stage.plan.backgroundMPerPx || 0.01) * 100} step={0.1} suffix="cm/px" onCommit={(v) => run('plan.setBackground', { mPerPx: v / 100 })} /></div>
              <div className="sp-row"><label>Deckkraft</label><NumField id="scene-plan-bg-opacity" value={stage.plan.backgroundOpacity ?? 0.5} step={0.1} onCommit={(v) => run('plan.setBackground', { opacity: v })} /></div>
              <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-bg-remove" onClick={() => run('plan.setBackground', { url: '' })}>Hintergrund entfernen</button>
            </>
          )}
          {(stage.snapshots || []).length > 0 && <div className="sp-h">Eingefrorene Stände</div>}
          {(stage.snapshots || []).map((snap) => (
            <div key={snap.id} className="sp-row" style={{ gridTemplateColumns: '1fr auto' }}>
              <span>{snap.name}</span>
              <button type="button" className="sp-btn sp-btn--small" data-automation-id={`scene-plan-restore-${snap.id}`} onClick={() => run('scene.restore', { id: snap.id })}>Zurückholen</button>
            </div>
          ))}
          <div className="sp-h">Tastatur</div>
          <div style={{ color: 'var(--sp-muted)', lineHeight: 1.6 }}>V Auswahl · W Wand · F Figur · C Kamera · K Position merken · R drehen · L Kamera ausrichten · S Shot-Version · Pfeile schieben · , . Marke zurück/vor · Leertaste abspielen · ⌘Z/⇧⌘Z · 0 alles zeigen</div>
        </div>
      )}
    </div>
  );
};

// ── bottom: timeline + shot list ──
export const ScenePlanBottom: React.FC<PanelProps> = (props) => {
  const { session } = props;
  return (
    <div className="sp-bottom">
      <div className="sp-tabs" role="tablist">
        <button type="button" role="tab" className="sp-tab" aria-selected={session.bottomTab === 'timeline'} data-automation-id="scene-plan-tab-timeline" onClick={() => updateSession({ bottomTab: 'timeline' })}>Blocking-Timeline</button>
        <button type="button" role="tab" className="sp-tab" aria-selected={session.bottomTab === 'shots'} data-automation-id="scene-plan-tab-shots" onClick={() => updateSession({ bottomTab: 'shots' })}>Shot-Liste ({props.host.stage.shots.length})</button>
      </div>
      {session.bottomTab === 'timeline' ? <Timeline {...props} /> : <ShotList {...props} />}
    </div>
  );
};

const Timeline: React.FC<PanelProps> = ({ host, session, run }) => {
  const stage = host.stage;
  const lanesRef = useRef<HTMLDivElement>(null);
  const duration = stage.animation.durationS;
  const rows = [...stage.characters.map((c) => ({ id: c.id, name: c.name, color: c.color || '#f76b15', kind: 'Figur' })), ...stage.cameras.map((c) => ({ id: c.id, name: `Kamera ${c.name}`, color: c.color || '#e5484d', kind: 'Kamera' }))];
  const [width, setWidth] = React.useState(800);
  React.useEffect(() => {
    const el = lanesRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([e]) => setWidth(Math.max(100, e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const pxPerS = width / Math.max(0.5, duration);
  const timeAt = (clientX: number) => {
    const rect = lanesRef.current?.getBoundingClientRect();
    return Math.max(0, Math.min(duration, (clientX - (rect?.left ?? 0)) / pxPerS));
  };
  const scrub = (e: React.PointerEvent) => {
    try { (e.target as Element).setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    setTime(timeAt(e.clientX));
    const move = (ev: PointerEvent) => setTime(timeAt(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const dragKey = (e: React.PointerEvent, id: string, keyId: string) => {
    e.stopPropagation();
    updateSession({ selection: [id], selectedKeyId: keyId });
    const startX = e.clientX;
    let last = 0;
    const move = (ev: PointerEvent) => { last = timeAt(ev.clientX); };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (Math.abs(ev.clientX - startX) > 3) run('key.update', { id, keyId, timeS: Math.round(last * stage.animation.fps) / stage.animation.fps });
      else { const k = stage.animation.tracks[id]?.find((x) => x.id === keyId); if (k) setTime(k.timeS); }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  const ticks = [];
  const step = duration > 60 ? 10 : duration > 20 ? 5 : 1;
  for (let t = 0; t <= duration + 1e-6; t += step) ticks.push(t);
  const times = [...new Set(Object.values(stage.animation.tracks).flat().map((k) => k.timeS))].sort((a, b) => a - b);
  const jump = (dir: 1 | -1) => {
    const t = dir > 0 ? times.find((x) => x > session.timeS + 1e-3) : [...times].reverse().find((x) => x < session.timeS - 1e-3);
    setTime(t ?? (dir > 0 ? duration : 0));
  };
  return (
    <div style={{ display: 'grid', gridTemplateRows: 'auto 1fr', minHeight: 0 }}>
      <div className="sp-tabs" style={{ borderBottom: 0 }}>
        <button type="button" className="sp-btn sp-btn--small" title="Vorige Marke (,)" data-automation-id="scene-plan-prev-key" onClick={() => jump(-1)}><SkipBack className="sp-icon" /></button>
        <button type="button" className="sp-btn sp-btn--small" data-automation-id="scene-plan-timeline-play" onClick={() => updateSession({ playing: !session.playing })}>{session.playing ? <Pause className="sp-icon" /> : <Play className="sp-icon" />}</button>
        <button type="button" className="sp-btn sp-btn--small" title="Nächste Marke (.)" data-automation-id="scene-plan-next-key" onClick={() => jump(1)}><SkipForward className="sp-icon" /></button>
        <span style={{ fontVariantNumeric: 'tabular-nums', minWidth: 90 }}>{fmt(session.timeS, 2)} / {fmt(duration, 1)} s</span>
        <select className="sp-select" style={{ width: 80 }} value={session.speed} data-automation-id="scene-plan-speed" onChange={(e) => updateSession({ speed: Number(e.target.value) })}>
          {[0.25, 0.5, 1, 2].map((s) => <option key={s} value={s}>{s}×</option>)}
        </select>
        <span style={{ color: 'var(--sp-muted)', marginLeft: 8 }}>Objekt wählen, Playhead setzen, ziehen – „Position merken“ (K) legt eine Marke an.</span>
      </div>
      <div className="sp-timeline" style={{ ['--sp-sec' as string]: `${pxPerS * step}px` }} data-automation-id="scene-plan-timeline">
        <div>
          <div className="sp-tl-ruler" />
          {rows.map((r) => (
            <div key={r.id} className={`sp-tl-name ${session.selection.includes(r.id) ? 'sp-sel' : ''}`} onClick={() => updateSession({ selection: [r.id], selectedKeyId: null })} data-automation-id={`scene-plan-lane-${r.id}`}>
              <span className="sp-swatch" style={{ background: r.color }} />{r.name}
            </div>
          ))}
        </div>
        <div ref={lanesRef} style={{ position: 'relative' }}>
          <div className="sp-tl-ruler" onPointerDown={scrub} data-automation-id="scene-plan-ruler">
            {ticks.map((t) => <div key={t} className="sp-tl-tick" style={{ left: t * pxPerS }}>{t}s</div>)}
          </div>
          {rows.map((r) => {
            const keys = stage.animation.tracks[r.id] || [];
            return (
              <div key={r.id} className="sp-tl-lane" onPointerDown={scrub}>
                {keys.length > 1 && <div className="sp-span" style={{ left: keys[0].timeS * pxPerS, width: (keys[keys.length - 1].timeS - keys[0].timeS) * pxPerS, background: r.color }} />}
                {keys.map((k) => (
                  <div key={k.id} className={`sp-key ${session.selectedKeyId === k.id ? 'sp-sel' : ''}`} style={{ left: k.timeS * pxPerS, background: r.color }} title={`${fmt(k.timeS, 2)} s`} onPointerDown={(e) => dragKey(e, r.id, k.id)} data-automation-id={`scene-plan-timeline-key-${k.id}`} />
                ))}
              </div>
            );
          })}
          <div className="sp-tl-head" style={{ left: session.timeS * pxPerS }} />
        </div>
      </div>
    </div>
  );
};

const ShotList: React.FC<PanelProps> = ({ host, session, run, flash, shotPrompts }) => {
  const stage = host.stage;
  const rows = shotRows(stage);
  const warnings = axisWarnings(stage, orderedShots(stage));
  const warnFor = new Map(warnings.map((w) => [w.toShotId, w.message]));
  const sendAll = async () => {
    const b = getBridge();
    if (!b?.getShotPrompts || !b.setShotPrompts) { flash('Storyboard ist nicht verbunden.', true); return; }
    const h = getHost();
    const frames: Record<string, string> = {};
    for (const s of h.stage.shots) {
      if (s.frameUrl) continue;
      const url = await renderFrameUrl(h, s.cameraId, s.startS, 960, `${s.number}${s.version}`);
      if (url) frames[s.id] = url;
    }
    const out = syncStoryboard(h.stage, b.getShotPrompts(), { frames, references: b.getReferences?.() });
    b.setShotPrompts(out.shotPrompts);
    dispatchBatch(out.links.map((l) => ({ command: 'shot.link', params: { id: l.shotId, storyboardShot: l.storyboardShot, ...(frames[l.shotId] ? { frameUrl: frames[l.shotId] } : {}) } })));
    flash(`${out.links.length} Shots im Storyboard (${out.links.filter((l) => l.created).length} neu)`);
  };
  return (
    <div className="sp-shots" data-automation-id="scene-plan-shot-list">
      <div className="sp-tabs" style={{ borderBottom: 0 }}>
        <button type="button" className="sp-btn sp-btn--small sp-btn--primary" data-automation-id="scene-plan-send-storyboard" onClick={() => void sendAll()}><Clapperboard className="sp-icon" />Alle ins Storyboard</button>
        {warnings.length > 0 && <span className="sp-warn">{warnings.length} Achssprung{warnings.length > 1 ? 'e' : ''} über die 180°-Linie</span>}
        {rows.length === 0 && <span style={{ color: 'var(--sp-muted)' }}>Jede Kamera im Plan ergibt automatisch einen Shot.</span>}
      </div>
      <table>
        <thead><tr><th>#</th><th>Frame</th><th>Shot</th><th>Größe</th><th>mm</th><th>Bewegung</th><th>Figuren</th><th>Zeit</th><th style={{ width: '30%' }}>Beschreibung</th><th>Storyboard</th><th /></tr></thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.id} className={session.selection.includes(r.cameraId) ? 'sp-sel' : ''} data-automation-id={`scene-plan-shot-${r.code}`} onClick={() => updateSession({ selection: [r.cameraId], selectedKeyId: null, timeS: r.startS })}>
              <td>
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  <button type="button" className="sp-btn sp-btn--small" disabled={i === 0} title="Früher drehen" data-automation-id={`scene-plan-shot-up-${r.code}`} onClick={(e) => { e.stopPropagation(); run('shot.reorder', { id: r.id, toIndex: i - 1 }); }}><ArrowUp className="sp-icon" /></button>
                  <button type="button" className="sp-btn sp-btn--small" disabled={i === rows.length - 1} title="Später drehen" data-automation-id={`scene-plan-shot-down-${r.code}`} onClick={(e) => { e.stopPropagation(); run('shot.reorder', { id: r.id, toIndex: i + 1 }); }}><ArrowDown className="sp-icon" /></button>
                </div>
              </td>
              <td>{r.frameUrl ? <img className="sp-thumb" src={r.frameUrl} alt="" /> : <div className="sp-thumb" />}</td>
              <td className="sp-code">{r.code}{r.detached && <span className="sp-badge" title="abgelöst"> ⛓</span>}<div className="sp-warn">{warnFor.has(r.id) ? 'Achssprung' : ''}</div></td>
              <td onClick={(e) => e.stopPropagation()}>
                <select className="sp-select" value={stage.shots.find((s) => s.id === r.id)?.sizeOverride || 'auto'} data-automation-id={`scene-plan-shot-size-${r.code}`} onChange={(e) => run('shot.update', { id: r.id, size: e.target.value })}>
                  <option value="auto">{r.size ? `${SHOT_SIZE_LABELS[r.size]} (auto)` : 'auto'}</option>
                  {SHOT_SIZES.map((s) => <option key={s} value={s}>{SHOT_SIZE_LABELS[s]}</option>)}
                </select>
              </td>
              <td>{Math.round(r.lensMm)}</td>
              <td onClick={(e) => e.stopPropagation()}>
                <select className="sp-select" value={stage.shots.find((s) => s.id === r.id)?.moveOverride || 'auto'} data-automation-id={`scene-plan-shot-move-${r.code}`} onChange={(e) => run('shot.update', { id: r.id, move: e.target.value })}>
                  <option value="auto">{r.moveLabel} (auto)</option>
                  {CAMERA_MOVES.map((m) => <option key={m} value={m}>{MOVE_LABELS[m]}</option>)}
                </select>
              </td>
              <td>{r.subjectNames.join(', ') || '–'}</td>
              <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                <div className="sp-pair" style={{ width: 110 }}>
                  <NumField id={`scene-plan-shot-start-${r.code}`} value={r.startS} step={0.5} onCommit={(v) => run('shot.update', { id: r.id, startS: v })} />
                  <NumField id={`scene-plan-shot-end-${r.code}`} value={r.endS} step={0.5} onCommit={(v) => run('shot.update', { id: r.id, endS: v })} />
                </div>
              </td>
              <td onClick={(e) => e.stopPropagation()}><TextField id={`scene-plan-shot-desc-${r.code}`} value={stage.shots.find((s) => s.id === r.id)?.description || ''} placeholder={r.autoDescription} onCommit={(v) => run('shot.update', { id: r.id, description: v })} /></td>
              <td onClick={(e) => e.stopPropagation()}>
                <select className="sp-select" value={r.storyboardShot ?? ''} data-automation-id={`scene-plan-shot-link-${r.code}`} onChange={(e) => run('shot.link', { id: r.id, storyboardShot: e.target.value ? Number(e.target.value) : 0 })}>
                  <option value="">– verknüpfen –</option>
                  {shotPrompts.map((sp) => <option key={sp.shot} value={sp.shot}>Shot {sp.shot}{sp.shotLabel ? ` (${sp.shotLabel})` : ''}</option>)}
                </select>
                {r.storyboardShot && <span className="sp-badge"><Link className="sp-icon" style={{ width: 11, height: 11, verticalAlign: -2 }} /> {r.storyboardShot}</span>}
              </td>
              <td onClick={(e) => e.stopPropagation()} style={{ whiteSpace: 'nowrap' }}>
                <button type="button" className="sp-btn sp-btn--small" title="Shot ablösen (bleibt, wenn die Kamera gelöscht wird)" data-automation-id={`scene-plan-shot-detach-${r.code}`} onClick={() => run('shot.detach', { id: r.id })}>{r.detached ? 'gelöst' : 'lösen'}</button>
                <button type="button" className="sp-btn sp-btn--small" title="Shot löschen" data-automation-id={`scene-plan-shot-delete-${r.code}`} onClick={() => run('shot.delete', { id: r.id })}><Trash2 className="sp-icon" /></button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
};
