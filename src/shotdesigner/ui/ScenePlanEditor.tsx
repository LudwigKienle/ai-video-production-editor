/**
 * Scene Map · Kameraplan: Shot Designer–style top-down blocking editor.
 * Every action goes through the shared command layer (session.dispatch), exactly like the MCP tools.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  Camera, Copy, Download, Eye, FileInput, Grid3x3, Hand, Image as ImageIcon, LayoutTemplate, Maximize, MousePointer2,
  Pause, Play, Redo2, Route, Snowflake, Square, Tag, Trash2, Undo2, User, BrickWall,
} from 'lucide-react';
import type { ReferenceItem, SceneMapState, SetDesignState, ShotPrompt } from '../../types';
import { aimAngles, charactersAt, eyeHeightM, finite, wrapDeg, type StageState } from '../../scene/stageModel.ts';
import { ensureHost, PLAN_LIBRARY, planElementOf, type StageHost } from '../planModel.ts';
import { runBlockingCommand, TEMPLATES } from '../commands.ts';
import { buildPlanScene, pickAt, planBounds, type PlanPrim } from '../planScene.ts';
import { exportSceneMap, type SceneMapExportFormat } from '../exportService.ts';
import { downloadBytes, imageSize } from '../raster.ts';
import { importOverviewScene } from '../overviewImport.ts';
import {
  bindSceneMapBridge, commitHost, dispatch, dispatchBatch, getBridge, getSession, historyState, redo, setTime, subscribeSession, undo, updateSession,
  type SceneMapTool,
} from '../session.ts';
import { ScenePlanInspector, ScenePlanBottom } from './ScenePlanPanels';
import './scenePlan.css';

export type ScenePlanEditorProps = {
  setDesign: SetDesignState | null | undefined;
  onSetDesignChange: (next: SetDesignState) => void;
  shotPrompts: ShotPrompt[];
  onShotPromptsChange?: (next: ShotPrompt[]) => void;
  references: ReferenceItem[];
  sceneMap?: SceneMapState | null;
  projectName?: string;
};

type Drag =
  | { kind: 'pan'; startX: number; startY: number; cx: number; cz: number }
  | { kind: 'move'; id: string; offX: number; offZ: number; base: StageHost; moved: boolean }
  | { kind: 'rotate'; id: string; base: StageHost }
  | { kind: 'resize'; id: string; base: StageHost }
  | { kind: 'key'; id: string; keyId: string; base: StageHost; moved: boolean }
  | null;

const SNAP = 0.25;
const snapV = (v: number, on: boolean) => (on ? Math.round(v / SNAP) * SNAP : v);

export const useSceneMapSession = () => useSyncExternalStore(subscribeSession, getSession, getSession);

const ScenePlanEditor: React.FC<ScenePlanEditorProps> = (props) => {
  const { setDesign, onSetDesignChange, shotPrompts, onShotPromptsChange, references, sceneMap, projectName } = props;
  const session = useSceneMapSession();
  const host = useMemo(() => ensureHost(setDesign as StageHost), [setDesign]);
  const stage = host.stage;

  // Fallback bridge when App.tsx did not bind one (keeps the page usable on its own).
  const propsRef = useRef(props);
  propsRef.current = props;
  useEffect(() => {
    if (getBridge()) return undefined;
    const bridge = {
      getSetDesign: () => propsRef.current.setDesign,
      setSetDesign: (next: StageHost) => propsRef.current.onSetDesignChange(next as unknown as SetDesignState),
      getShotPrompts: () => propsRef.current.shotPrompts,
      setShotPrompts: (next: ShotPrompt[]) => propsRef.current.onShotPromptsChange?.(next),
      getReferences: () => propsRef.current.references,
      getSceneMap: () => propsRef.current.sceneMap,
      getProjectName: () => propsRef.current.projectName || 'Kameraplan',
    };
    bindSceneMapBridge(bridge);
    return () => { if (getBridge() === bridge) bindSceneMapBridge(null); };
  }, []);

  const [status, setStatus] = useState<{ text: string; error?: boolean } | null>(null);
  const flash = useCallback((text: string, error = false) => {
    setStatus({ text, error });
    window.setTimeout(() => setStatus((s) => (s && s.text === text ? null : s)), error ? 6000 : 2500);
  }, []);
  const run = useCallback((id: string, params: Record<string, unknown> = {}) => {
    const out = dispatch(id, params);
    if (!out.ok) flash(out.error || 'Fehler', true);
    return out;
  }, [flash]);

  // ── viewport ──
  const wrapRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  const [view, setView] = useState<{ cx: number; cz: number; s: number }>({ cx: 0, cz: 0, s: 60 });
  const fitted = useRef(false);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(([entry]) => setSize({ w: Math.max(200, entry.contentRect.width), h: Math.max(200, entry.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const fit = useCallback(() => {
    const b = planBounds(host, 1.2);
    const s = Math.max(6, Math.min(240, Math.min(size.w / (b.maxX - b.minX), size.h / (b.maxZ - b.minZ))));
    setView({ cx: (b.minX + b.maxX) / 2, cz: (b.minZ + b.maxZ) / 2, s });
  }, [host, size]);
  // Fit once on open and again after bulk changes (template, import) once the new host has rendered.
  const pendingFit = useRef(false);
  const requestFit = useCallback(() => { pendingFit.current = true; }, []);
  useEffect(() => {
    if ((!fitted.current || pendingFit.current) && size.w > 200) { fitted.current = true; pendingFit.current = false; fit(); }
  }, [fit, size.w]);
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    const x = clientX - (rect?.left ?? 0);
    const y = clientY - (rect?.top ?? 0);
    return { x: view.cx + (x - size.w / 2) / view.s, z: view.cz + (y - size.h / 2) / view.s };
  }, [view, size]);

  // ── preview host during drags ──
  const [preview, setPreview] = useState<StageHost | null>(null);
  const shown = useMemo(() => ensureHost((preview ?? host) as StageHost), [preview, host]);
  const [wallStart, setWallStart] = useState<{ x: number; z: number } | null>(null);
  const [hover, setHover] = useState<{ x: number; z: number } | null>(null);
  const drag = useRef<Drag>(null);

  const viewBounds = useMemo(() => ({ minX: view.cx - size.w / 2 / view.s, maxX: view.cx + size.w / 2 / view.s, minZ: view.cz - size.h / 2 / view.s, maxZ: view.cz + size.h / 2 / view.s }), [view, size]);
  const selection = useMemo(() => new Set(session.selection), [session.selection]);
  const [bgSize, setBgSize] = useState<{ width: number; height: number } | null>(null);
  const bgUrl = stage.plan?.backgroundUrl || null;
  useEffect(() => { let alive = true; if (bgUrl) void imageSize(bgUrl).then((s) => { if (alive) setBgSize(s); }); else setBgSize(null); return () => { alive = false; }; }, [bgUrl]);

  const { prims } = useMemo(() => buildPlanScene(shown, {
    timeS: session.timeS, pxPerM: view.s, selection, selectedKeyId: session.selectedKeyId, view: viewBounds,
    showGrid: session.showGrid, showCones: session.showCones, showPaths: session.showPaths, showLabels: session.showLabels, showFrames: session.showFrames,
  }), [shown, session.timeS, view.s, selection, session.selectedKeyId, viewBounds, session.showGrid, session.showCones, session.showPaths, session.showLabels, session.showFrames]);

  // ── playback ──
  useEffect(() => {
    if (!session.playing) return undefined;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      const s = getSession();
      let t = s.timeS + dt * s.speed;
      if (t > stage.animation.durationS) t = 0;
      setTime(t);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [session.playing, stage.animation.durationS]);

  // ── pointer handling ──
  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* synthetic or already released pointer */ }
    wrapRef.current?.focus();
    const p = toWorld(e.clientX, e.clientY);
    const tool = session.tool;
    if (e.button === 1 || e.button === 2 || tool === 'pan' || e.altKey) {
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, cx: view.cx, cz: view.cz };
      return;
    }
    const snap = host.grid?.snapEnabled !== false && !e.shiftKey;
    if (tool === 'wall') {
      const pt = { x: snapV(p.x, snap), z: snapV(p.z, snap) };
      if (!wallStart) setWallStart(pt);
      else {
        if (Math.hypot(pt.x - wallStart.x, pt.z - wallStart.z) > 0.05) run('plan.addWall', { x1: wallStart.x, z1: wallStart.z, x2: pt.x, z2: pt.z });
        setWallStart(e.detail >= 2 ? null : pt);
      }
      return;
    }
    if (tool === 'character') { run('character.add', { x: snapV(p.x, snap), z: snapV(p.z, snap) }); updateSession({ tool: 'select' }); return; }
    if (tool === 'element') { run('plan.addElement', { category: session.elementCategory, x: snapV(p.x, snap), z: snapV(p.z, snap) }); return; }
    if (tool === 'camera') {
      const chars = charactersAt(stage, session.timeS);
      const nearest = chars.sort((a, b) => Math.hypot(a.position.x - p.x, a.position.z - p.z) - Math.hypot(b.position.x - p.x, b.position.z - p.z))[0];
      run('camera.add', { x: snapV(p.x, snap), z: snapV(p.z, snap), ...(nearest ? { aimAt: nearest.id } : {}) });
      updateSession({ tool: 'select' });
      return;
    }
    const hit = pickAt(prims, p.x, p.z);
    if (!hit?.objectId) {
      updateSession({ selection: [], selectedKeyId: null });
      drag.current = { kind: 'pan', startX: e.clientX, startY: e.clientY, cx: view.cx, cz: view.cz };
      return;
    }
    const id = hit.objectId;
    if (hit.role === 'key' && hit.keyId) {
      const key = stage.animation.tracks[id]?.find((k) => k.id === hit.keyId);
      updateSession({ selection: [id], selectedKeyId: hit.keyId, ...(key ? { timeS: key.timeS } : {}) });
      drag.current = { kind: 'key', id, keyId: hit.keyId, base: host, moved: false };
      return;
    }
    const nextSel = e.shiftKey ? [...new Set([...session.selection, id])] : [id];
    updateSession({ selection: nextSel, selectedKeyId: null });
    const locked = stage.cameras.find((c) => c.id === id)?.locked || stage.characters.find((c) => c.id === id)?.locked;
    if (locked) return;
    if (hit.role === 'rotate') { drag.current = { kind: 'rotate', id, base: host }; return; }
    if (hit.role === 'resize') { drag.current = { kind: 'resize', id, base: host }; return; }
    const pose = currentXZ(host, id, session.timeS);
    drag.current = { kind: 'move', id, offX: p.x - pose.x, offZ: p.z - pose.z, base: host, moved: false };
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const p = toWorld(e.clientX, e.clientY);
    setHover(p);
    const d = drag.current;
    if (!d) return;
    const snap = host.grid?.snapEnabled !== false && !e.shiftKey;
    if (d.kind === 'pan') {
      setView((v) => ({ ...v, cx: d.cx - (e.clientX - d.startX) / v.s, cz: d.cz - (e.clientY - d.startY) / v.s }));
      return;
    }
    let out: ReturnType<typeof runBlockingCommand> | null = null;
    if (d.kind === 'move') {
      d.moved = true;
      out = runBlockingCommand(d.base, 'object.move', { id: d.id, x: snapV(p.x - d.offX, snap), z: snapV(p.z - d.offZ, snap) }, session.timeS);
    } else if (d.kind === 'rotate') {
      const c = currentXZ(d.base, d.id, session.timeS);
      let yaw = wrapDeg((Math.atan2(-(p.x - c.x), -(p.z - c.z)) * 180) / Math.PI);
      const el = d.base.assets.find((a) => a.id === d.id);
      if (el) yaw = wrapDeg(yaw); // elements: handle sits on local -z, same convention
      if (!e.shiftKey) yaw = Math.round(yaw / 15) * 15;
      out = runBlockingCommand(d.base, 'object.rotate', { id: d.id, yawDeg: yaw }, session.timeS);
    } else if (d.kind === 'resize') {
      const asset = d.base.assets.find((a) => a.id === d.id);
      if (asset) {
        const el = planElementOf(asset);
        const a = (el.yawDeg * Math.PI) / 180;
        const dx = p.x - el.x;
        const dz = p.z - el.z;
        const lx = dx * Math.cos(a) - dz * Math.sin(a);
        const lz = dx * Math.sin(a) + dz * Math.cos(a);
        out = el.category === 'wall'
          ? runBlockingCommand(d.base, 'plan.updateElement', { id: d.id, w: Math.max(0.1, snapV(Math.abs(lx) * 2, snap)) }, session.timeS)
          : runBlockingCommand(d.base, 'plan.updateElement', { id: d.id, w: Math.max(0.1, snapV(Math.abs(lx) * 2, snap)), d: Math.max(0.05, snapV(Math.abs(lz) * 2, snap)) }, session.timeS);
      }
    } else if (d.kind === 'key') {
      d.moved = true;
      out = runBlockingCommand(d.base, 'key.update', { id: d.id, keyId: d.keyId, x: snapV(p.x, snap), z: snapV(p.z, snap) }, session.timeS);
    }
    if (out?.ok && out.host) setPreview(out.host);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.kind !== 'pan' && preview) commitHost(preview);
    setPreview(null);
  };

  const onWheel = (e: React.WheelEvent) => {
    const p = toWorld(e.clientX, e.clientY);
    const factor = Math.exp(-e.deltaY * 0.0015);
    setView((v) => {
      const s = Math.max(4, Math.min(400, v.s * factor));
      return { s, cx: p.x - (p.x - v.cx) * (v.s / s), cz: p.z - (p.z - v.cz) * (v.s / s) };
    });
  };

  // ── keyboard ──
  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return;
    const sel = session.selection[0];
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key.toLowerCase();
    if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && key === 'y') { e.preventDefault(); redo(); return; }
    if (mod && key === 'd' && sel) { e.preventDefault(); run('object.duplicate', { id: sel }); return; }
    if (mod) return;
    if (key === 'escape') { setWallStart(null); updateSession({ selection: [], selectedKeyId: null, tool: 'select' }); return; }
    if (key === ' ') { e.preventDefault(); updateSession({ playing: !session.playing }); return; }
    if (key === 'v') updateSession({ tool: 'select' });
    else if (key === 'w') { setWallStart(null); updateSession({ tool: 'wall' }); }
    else if (key === 'f') updateSession({ tool: 'character' });
    else if (key === 'c') updateSession({ tool: 'camera' });
    else if (key === 'h') updateSession({ tool: 'pan' });
    else if (key === '0') fit();
    else if ((key === 'delete' || key === 'backspace') && sel) {
      if (session.selectedKeyId) run('key.delete', { id: sel, keyId: session.selectedKeyId });
      else dispatchBatch(session.selection.map((id) => ({ command: 'object.delete', params: { id } })));
      updateSession({ selection: [], selectedKeyId: null });
    } else if (key === 'k' && sel) { const out = run('key.add', { id: sel }); if (out.ok) flash(`Marke bei ${session.timeS.toFixed(1)} s`); }
    else if (key === 'r' && sel) run('object.rotate', { id: sel, delta: e.shiftKey ? -15 : 15 });
    else if (key === 'l' && sel) {
      const cam = stage.cameras.find((c) => c.id === sel);
      const other = session.selection.find((id) => stage.characters.some((c) => c.id === id));
      const nearest = other || charactersAt(stage, session.timeS).sort((a, b) => dist(a.position, cam?.position) - dist(b.position, cam?.position))[0]?.id;
      if (cam && nearest) run('camera.aimAt', { id: cam.id, targetId: nearest });
    } else if (key === 's' && stage.cameras.some((c) => c.id === sel)) run('shot.add', { cameraId: sel, startS: session.timeS });
    else if (key.startsWith('arrow') && sel) {
      e.preventDefault();
      const step = e.shiftKey ? 1 : 0.1;
      run('object.move', { id: sel, dx: key === 'arrowleft' ? -step : key === 'arrowright' ? step : 0, dz: key === 'arrowup' ? -step : key === 'arrowdown' ? step : 0 });
    } else if (key === '.' || key === ',') {
      const times = [...new Set(Object.values(stage.animation.tracks).flat().map((k) => k.timeS))].sort((a, b) => a - b);
      const t = key === '.' ? times.find((x) => x > session.timeS + 1e-3) : [...times].reverse().find((x) => x < session.timeS - 1e-3);
      if (t !== undefined) setTime(t);
    }
  };

  // ── toolbar actions ──
  const [menu, setMenu] = useState<null | 'library' | 'template' | 'export'>(null);
  const doExport = async (format: SceneMapExportFormat) => {
    setMenu(null);
    try {
      const out = await exportSceneMap(getHostSafe(), format, { title: projectName || 'Kameraplan', timeS: session.timeS });
      downloadBytes(out.data, out.fileName, out.mime);
      flash(`${out.fileName} exportiert${out.note ? ` – ${out.note}` : ''}`);
    } catch (err) {
      flash(err instanceof Error ? err.message : String(err), true);
    }
  };
  const getHostSafe = () => ensureHost((getBridge()?.getSetDesign() ?? setDesign) as StageHost);
  const importOverview = () => {
    const scene = sceneMap?.scenes.find((s) => s.id === sceneMap.activeSceneId) ?? sceneMap?.scenes[0];
    if (!scene || !scene.elements.length) { flash('Die Übersicht dieser Szene ist leer.', true); return; }
    const out = dispatchBatch(importOverviewScene(scene));
    if (out.ok) { flash(`${scene.elements.length} Elemente aus der Übersicht übernommen`); requestFit(); } else flash(out.error || 'Fehler', true);
  };
  const onBackgroundFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { if (typeof reader.result === 'string') run('plan.setBackground', { url: reader.result, mPerPx: 0.01, opacity: 0.5 }); };
    reader.readAsDataURL(file);
  };

  const history = historyState();
  const toolBtn = (tool: SceneMapTool, label: string, Icon: React.ElementType, key: string) => (
    <button type="button" className="sp-btn" aria-pressed={session.tool === tool} title={`${label} (${key})`} data-automation-id={`scene-plan-tool-${tool}`} onClick={() => { setWallStart(null); updateSession({ tool }); }}>
      <Icon className="sp-icon" />{label}
    </button>
  );
  const toggle = (key: 'showCones' | 'showPaths' | 'showGrid' | 'showLabels' | 'showFrames', label: string, Icon: React.ElementType) => (
    <button type="button" className="sp-btn" aria-pressed={session[key]} title={label} data-automation-id={`scene-plan-toggle-${key}`} onClick={() => updateSession({ [key]: !session[key] } as never)}>
      <Icon className="sp-icon" />
    </button>
  );

  const s = view.s;
  const transform = `translate(${size.w / 2 - view.cx * s} ${size.h / 2 - view.cz * s}) scale(${s})`;
  const empty = stage.characters.length === 0 && stage.cameras.length === 0 && host.assets.length === 0;
  const hint = session.tool === 'wall' ? (wallStart ? 'Klick setzt das Wandende, Doppelklick oder Esc beendet' : 'Klick setzt den Wandanfang (Shift = ohne Raster)')
    : session.tool === 'character' ? 'Klick setzt eine Figur'
      : session.tool === 'camera' ? 'Klick setzt eine Kamera – sie richtet sich auf die nächste Figur aus'
        : session.tool === 'element' ? `Klick setzt: ${PLAN_LIBRARY.find((e) => e.category === session.elementCategory)?.label || 'Element'}` : null;

  return (
    <div className="sp-root" data-automation-id="scene-plan">
      <div className="sp-toolbar" role="toolbar" aria-label="Kameraplan">
        {toolBtn('select', 'Auswahl', MousePointer2, 'V')}
        {toolBtn('pan', 'Hand', Hand, 'H')}
        {toolBtn('wall', 'Wand', BrickWall, 'W')}
        <div className="sp-menu">
          <button type="button" className="sp-btn" aria-pressed={session.tool === 'element'} data-automation-id="scene-plan-tool-element" onClick={() => setMenu(menu === 'library' ? null : 'library')}><Square className="sp-icon" />Objekt ▾</button>
          {menu === 'library' && (
            <div className="sp-menu__list" style={{ width: 260 }}>
              <div className="sp-lib">
                {PLAN_LIBRARY.filter((e) => e.category !== 'wall').map((e) => (
                  <button key={e.category} type="button" className="sp-lib__item" data-automation-id={`scene-plan-lib-${e.category}`} onClick={() => { updateSession({ tool: 'element', elementCategory: e.category }); setMenu(null); }}>
                    <span className="sp-lib__swatch" style={{ background: e.color }} />{e.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {toolBtn('character', 'Figur', User, 'F')}
        {toolBtn('camera', 'Kamera', Camera, 'C')}
        <span className="sp-sep" />
        <button type="button" className="sp-btn" disabled={!history.canUndo} title="Rückgängig (⌘Z)" data-automation-id="scene-plan-undo" onClick={() => undo()}><Undo2 className="sp-icon" /></button>
        <button type="button" className="sp-btn" disabled={!history.canRedo} title="Wiederholen (⇧⌘Z)" data-automation-id="scene-plan-redo" onClick={() => redo()}><Redo2 className="sp-icon" /></button>
        <button type="button" className="sp-btn" disabled={!session.selection.length} title="Duplizieren (⌘D)" data-automation-id="scene-plan-duplicate" onClick={() => session.selection[0] && run('object.duplicate', { id: session.selection[0] })}><Copy className="sp-icon" /></button>
        <button type="button" className="sp-btn" disabled={!session.selection.length} title="Löschen (Entf)" data-automation-id="scene-plan-delete" onClick={() => { dispatchBatch(session.selection.map((id) => ({ command: 'object.delete', params: { id } }))); updateSession({ selection: [] }); }}><Trash2 className="sp-icon" /></button>
        <span className="sp-sep" />
        {toggle('showCones', 'Sichtkegel', Eye)}
        {toggle('showPaths', 'Bewegungspfade', Route)}
        {toggle('showGrid', 'Raster', Grid3x3)}
        {toggle('showLabels', 'Beschriftungen', Tag)}
        {toggle('showFrames', 'Storyboard-Frames im Plan', ImageIcon)}
        <button type="button" className="sp-btn" title="Alles zeigen (0)" data-automation-id="scene-plan-fit" onClick={fit}><Maximize className="sp-icon" /></button>
        <span className="sp-sep" />
        <div className="sp-menu">
          <button type="button" className="sp-btn" data-automation-id="scene-plan-templates" onClick={() => setMenu(menu === 'template' ? null : 'template')}><LayoutTemplate className="sp-icon" />Vorlage ▾</button>
          {menu === 'template' && (
            <div className="sp-menu__list">
              {TEMPLATES.map((t) => (
                <button key={t.id} type="button" className="sp-menu__item" data-automation-id={`scene-plan-template-${t.id}`} onClick={() => { setMenu(null); run('scene.applyTemplate', { templateId: t.id, x: Math.round(view.cx), z: Math.round(view.cz) }); requestFit(); }}>
                  {t.label}<small>{t.description}</small>
                </button>
              ))}
            </div>
          )}
        </div>
        <button type="button" className="sp-btn" title="Elemente der klassischen Übersicht übernehmen" data-automation-id="scene-plan-import-overview" onClick={importOverview}><FileInput className="sp-icon" />Aus Übersicht</button>
        <label className="sp-btn" title="Grundriss-Zeichnung als Hintergrund" data-automation-id="scene-plan-background">
          <ImageIcon className="sp-icon" />Hintergrund
          <input type="file" accept="image/*" hidden onChange={(e) => onBackgroundFile(e.target.files?.[0])} />
        </label>
        <button type="button" className="sp-btn" title="Stand einfrieren" data-automation-id="scene-plan-freeze" onClick={() => { const out = run('scene.freeze', {}); if (out.ok) flash(`${String(out.result?.name)} gespeichert`); }}><Snowflake className="sp-icon" /></button>
        <span style={{ flex: 1 }} />
        <button type="button" className="sp-btn" data-automation-id="scene-plan-play" onClick={() => updateSession({ playing: !session.playing })}>{session.playing ? <Pause className="sp-icon" /> : <Play className="sp-icon" />}{session.timeS.toFixed(1).replace('.', ',')} s</button>
        <div className="sp-menu">
          <button type="button" className="sp-btn sp-btn--primary" data-automation-id="scene-plan-export" onClick={() => setMenu(menu === 'export' ? null : 'export')}><Download className="sp-icon" />Export ▾</button>
          {menu === 'export' && (
            <div className="sp-menu__list" style={{ right: 0, left: 'auto' }}>
              {([['pdf', 'PDF', 'Grundriss, Shot-Liste und Storyboard'], ['png', 'PNG', 'Grundriss als Bild'], ['svg', 'SVG', 'Grundriss als Vektorgrafik'], ['xlsx', 'Excel', 'Shot-Liste'], ['csv', 'CSV', 'Shot-Liste'], ['json', 'JSON', 'Ganze Szene']] as Array<[SceneMapExportFormat, string, string]>).map(([f, label, sub]) => (
                <button key={f} type="button" className="sp-menu__item" data-automation-id={`scene-plan-export-${f}`} onClick={() => void doExport(f)}>{label}<small>{sub}</small></button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="sp-main">
        <ScenePlanLeft references={references} onPlace={(ref) => {
          const out = run('character.add', { name: ref.name, x: Math.round(view.cx * 4) / 4, z: Math.round(view.cz * 4) / 4, referenceId: ref.id });
          if (out.ok) flash(`${ref.name} gesetzt – ziehen zum Platzieren`);
        }} stage={stage} />
        <div ref={wrapRef} className="sp-canvas" tabIndex={0} onKeyDown={onKeyDown} onWheel={onWheel} data-automation-id="scene-plan-canvas" onClick={() => setMenu(null)}>
          <svg
            width={size.w}
            height={size.h}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onPointerLeave={() => setHover(null)}
            onContextMenu={(e) => e.preventDefault()}
            style={{ cursor: session.tool === 'pan' ? 'grab' : session.tool === 'select' ? 'default' : 'crosshair' }}
          >
            <g transform={transform}>
              {prims.map((p, i) => <PrimEl key={i} p={p} bgSize={bgSize} />)}
              {session.tool === 'wall' && wallStart && hover && (
                <line x1={wallStart.x} y1={wallStart.z} x2={snapV(hover.x, true)} y2={snapV(hover.z, true)} stroke="#4cc2ff" strokeWidth={0.15} strokeOpacity={0.6} />
              )}
            </g>
          </svg>
          {hint && <div className="sp-hint">{hint}</div>}
          {empty && session.tool === 'select' && (
            <div className="sp-empty">
              <div className="sp-empty__card">
                <strong>Kameraplan</strong>
                <p>Grundriss zeichnen, Figuren und Kameras setzen, Bewegungen über die Zeit merken – die Shot-Liste entsteht dabei von selbst. Dasselbe Set erscheint im 3D-Set-Design.</p>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'center', flexWrap: 'wrap' }}>
                  <button type="button" className="sp-btn sp-btn--primary" data-automation-id="scene-plan-empty-room" onClick={() => { run('plan.addRoom', { width: 7, depth: 5, openSide: 'south' }); requestFit(); }}>Raum anlegen</button>
                  <button type="button" className="sp-btn" data-automation-id="scene-plan-empty-dialog" onClick={() => { dispatchBatch([{ command: 'plan.addRoom', params: { width: 7, depth: 5 } }, { command: 'scene.applyTemplate', params: { templateId: 'dialog-two' } }]); requestFit(); }}>Beispiel: Dialog zu zweit</button>
                  {sceneMap?.scenes.some((sc) => sc.elements.length) && <button type="button" className="sp-btn" onClick={importOverview}>Aus Übersicht übernehmen</button>}
                </div>
              </div>
            </div>
          )}
          <div className="sp-hud">
            <span className="sp-hud__chip">{hover ? `x ${hover.x.toFixed(2).replace('.', ',')} · z ${hover.z.toFixed(2).replace('.', ',')} m` : 'Rad: Zoom · Leertaste: Abspielen'}</span>
            <span className="sp-hud__chip">{Math.round(view.s)} px/m</span>
            <span className="sp-hud__chip">{stage.shots.length} Shots · {stage.cameras.length} Kameras</span>
          </div>
          {status && <div className={`sp-status ${status.error ? 'sp-status--error' : ''}`} role="status">{status.text}</div>}
        </div>
        <ScenePlanInspector host={host} session={session} references={references} shotPrompts={shotPrompts} run={run} flash={flash} />
      </div>
      <ScenePlanBottom host={host} session={session} shotPrompts={shotPrompts} run={run} flash={flash} />
    </div>
  );
};

const dist = (a?: { x: number; z: number }, b?: { x: number; z: number }) => (a && b ? Math.hypot(a.x - b.x, a.z - b.z) : 1e9);

const currentXZ = (host: StageHost, id: string, t: number) => {
  const h = ensureHost(host);
  const out = runBlockingCommand(h, 'object.move', { id, dx: 0, dz: 0 }, t);
  const r = out.result as { x?: number; z?: number } | undefined;
  return { x: finite(r?.x, 0), z: finite(r?.z, 0) };
};

const PrimEl: React.FC<{ p: PlanPrim; bgSize: { width: number; height: number } | null }> = React.memo(({ p, bgSize }) => {
  const common = { opacity: p.opacity, 'data-object-id': p.objectId } as Record<string, unknown>;
  if (p.t === 'poly') {
    const pts = p.pts.map(([x, z]) => `${x},${z}`).join(' ');
    const props = { points: pts, fill: p.closed ? p.fill || 'none' : 'none', stroke: p.stroke, strokeWidth: p.sw, strokeDasharray: p.dash?.join(' '), strokeLinejoin: 'round' as const, strokeLinecap: 'round' as const, ...common };
    return p.closed ? <polygon {...props} /> : <polyline {...props} />;
  }
  if (p.t === 'circle') return <circle cx={p.cx} cy={p.cy} r={p.r} fill={p.fill || 'none'} stroke={p.stroke} strokeWidth={p.sw} strokeDasharray={p.dash?.join(' ')} {...common} />;
  if (p.t === 'text') return <text x={p.x} y={p.y} fontSize={p.size} fill={p.fill} textAnchor={p.anchor || 'start'} fontWeight={p.weight || 400} paintOrder="stroke" stroke={p.halo} strokeWidth={p.halo ? p.size * 0.28 : 0} strokeLinejoin="round" style={{ pointerEvents: 'none', fontFamily: 'Inter, system-ui, sans-serif' }}>{p.text}</text>;
  if (p.role === 'background') {
    if (!bgSize) return null;
    return <image href={p.href} x={p.x} y={p.y} width={bgSize.width * p.w} height={bgSize.height * p.h} opacity={p.opacity} preserveAspectRatio="none" style={{ pointerEvents: 'none' }} />;
  }
  return <image href={p.href} x={p.x} y={p.y} width={p.w} height={p.h} preserveAspectRatio="xMidYMid slice" style={{ pointerEvents: 'none' }} />;
});
PrimEl.displayName = 'PrimEl';

const ScenePlanLeft: React.FC<{ references: ReferenceItem[]; onPlace: (ref: ReferenceItem) => void; stage: StageState }> = ({ references, onPlace, stage }) => {
  const session = useSceneMapSession();
  const cast = references.filter((r) => r.type === 'character');
  const placed = new Set(stage.characters.map((c) => c.referenceId).filter(Boolean));
  return (
    <div className="sp-left" data-automation-id="scene-plan-library">
      <div className="sp-h">Set-Elemente</div>
      <div className="sp-lib">
        {PLAN_LIBRARY.map((e) => (
          <button
            key={e.category}
            type="button"
            className="sp-lib__item"
            aria-pressed={(session.tool === 'element' && session.elementCategory === e.category) || (e.category === 'wall' && session.tool === 'wall')}
            data-automation-id={`scene-plan-palette-${e.category}`}
            title={`${e.label} · ${e.w} × ${e.d} m`}
            onClick={() => updateSession(e.category === 'wall' ? { tool: 'wall' } : { tool: 'element', elementCategory: e.category })}
          >
            <span className="sp-lib__swatch" style={{ background: e.color, width: Math.min(30, 10 + e.w * 6), height: Math.min(20, 6 + e.d * 6) }} />
            {e.label}
          </button>
        ))}
      </div>
      <div className="sp-h">Cast</div>
      {cast.length === 0 && <div style={{ color: 'var(--sp-muted)' }}>Keine Figuren im Projekt. Mit „Figur“ (F) frei setzen.</div>}
      {cast.map((ref) => (
        <button key={ref.id} type="button" className="sp-cast" data-automation-id={`scene-plan-cast-${ref.id}`} onClick={() => onPlace(ref)} title="In den Plan setzen">
          {ref.imageUrl ? <img src={ref.imageUrl} alt="" /> : <span className="sp-cast__dot" />}
          <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>{ref.name}</span>
          {placed.has(ref.id) && <span className="sp-badge">im Plan</span>}
        </button>
      ))}
    </div>
  );
};

export default ScenePlanEditor;
export { aimAngles, eyeHeightM };
