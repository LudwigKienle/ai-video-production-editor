/**
 * After Effects view of the Fusion page (package F2). A functional clean-room
 * layer timeline over the shared composition (fusion-shared/compModel.ts):
 * Project, Composition viewer, Timeline, Effect Controls, Effects & Presets,
 * Info and Preview panels, tools bar and AE-style keyboard.
 *
 * Every action is a named command (AE_COMMANDS in aeOps.ts) dispatched by
 * `run()`; menus, shortcuts, buttons and MCP live commands ("ae.command.run",
 * "ae.state.get") share it. Controls carry data-automation-id attributes.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hand, MousePointer2, PenTool, RotateCw, Search, Type, Move } from 'lucide-react';
import type { FusionViewProps } from '../fusion-shared/viewProps.ts';
import type { Composition } from '../fusion-shared/compModel.ts';
import { getNode } from '../fusion-shared/compModel.ts';
import type { MediaItem } from '../../types.ts';
import { createFxInstance, getFxDefinition } from '../../fx/registry';
import { registerLiveCommands } from '../../mcp/liveCommands';
import type { AeCommandId, AePropId, AeToolId, AeUiState, EaseKind, KeyRef, MaskRect, TimeRange } from './aeOps.ts';
import {
  AE_COMMANDS,
  addFxInstanceToLayer,
  addKeyframeAt,
  addMaskToLayer,
  adjacentTime,
  aeLayers,
  applyEase,
  collectKeyTimes,
  deleteKeyframes,
  deleteLayers,
  duplicateLayer,
  ensureTransform,
  frameDuration,
  isLayerGraph,
  keyframedProps,
  moveLayerInTo,
  moveLayerOutTo,
  moveLayersToIndex,
  newMediaLayer,
  newSolidLayer,
  newTextLayer,
  parseKeyRef,
  patchParams,
  reorderLayers,
  replaceNode,
  resolveAeShortcut,
  revealProps,
  sanitizeUi,
  selectedLayerIds,
  setWorkArea,
  snapToFrame,
  splitLayer,
  trimLayerIn,
  trimLayerOut,
} from './aeOps.ts';
import AeViewer from './AeViewer';
import type { GestureApi, PixelInfo } from './AeViewer';
import AeTimeline from './AeTimeline';
import { EffectControlsPanel, EffectsPresetsPanel, InfoPanel, PreviewPanel, ProjectPanel } from './AePanels';
import { DropMenu } from './aeWidgets';
import type { MenuItem } from './aeWidgets';
import './aeView.css';

const UI_KEY = 'avpe.fusionAe.ui.v1';
const MENUS = ['Bearbeiten', 'Komposition', 'Ebene', 'Animation', 'Ansicht'];
const STRUCTURAL: AeCommandId[] = ['layer.duplicate', 'layer.split', 'layer.forward', 'layer.backward', 'layer.front', 'layer.back', 'edit.delete'];

const TOOLS: { id: AeToolId; label: string; key: string; icon: React.ReactNode }[] = [
  { id: 'selection', label: 'Auswahl-Werkzeug', key: 'V', icon: <MousePointer2 size={14} /> },
  { id: 'hand', label: 'Hand-Werkzeug', key: 'H', icon: <Hand size={14} /> },
  { id: 'zoom', label: 'Zoom-Werkzeug', key: 'Z', icon: <Search size={14} /> },
  { id: 'rotate', label: 'Drehen-Werkzeug', key: 'W', icon: <RotateCw size={14} /> },
  { id: 'anchor', label: 'Ausschnitt-dahinter-Werkzeug (Ankerpunkt)', key: 'Y', icon: <Move size={14} /> },
  { id: 'mask', label: 'Form-/Masken-Werkzeug', key: 'Q', icon: <PenTool size={14} /> },
  { id: 'text', label: 'Text-Werkzeug', key: '⌘T', icon: <Type size={14} /> },
];

function loadUi(): AeUiState {
  try {
    return sanitizeUi(JSON.parse(window.localStorage.getItem(UI_KEY) ?? 'null'));
  } catch {
    return sanitizeUi(null);
  }
}

type RunOptions = { additive?: boolean; layerIds?: string[]; time?: number };

export default function AfterEffectsView(props: FusionViewProps) {
  const { comp, time, mediaItems } = props;
  const [ui, setUiState] = useState<AeUiState>(loadUi);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [localRange, setLocalRange] = useState<TimeRange | null>(null);
  const [localPlaying, setLocalPlaying] = useState(false);
  const [loop, setLoop] = useState(true);
  const [pixel, setPixel] = useState<PixelInfo>(null);
  const [renderMs, setRenderMs] = useState(0);
  const [status, setStatus] = useState<string>('');
  const [solidDialog, setSolidDialog] = useState<{ name: string; color: string } | null>(null);
  const [rightTab, setRightTab] = useState<'effects' | 'info'>('effects');
  const rootRef = useRef<HTMLDivElement>(null);
  const zoomFn = useRef<((dir: 1 | -1) => void) | null>(null);

  const compRef = useRef(comp);
  compRef.current = comp;
  const timeRef = useRef(time);
  timeRef.current = time;

  const setUi = useCallback((patch: Partial<AeUiState>) => {
    setUiState((prev) => {
      const next = { ...prev, ...patch };
      try {
        const { expanded: _e, reveal: _r, ...persist } = next;
        window.localStorage.setItem(UI_KEY, JSON.stringify(persist));
      } catch {
        /* storage unavailable */
      }
      return next;
    });
  }, []);

  const flash = useCallback((text: string) => setStatus(text), []);
  useEffect(() => {
    if (!status) return;
    const t = window.setTimeout(() => setStatus(''), 4000);
    return () => window.clearTimeout(t);
  }, [status]);

  const layers = useMemo(() => aeLayers(comp), [comp]);
  const layerGraph = useMemo(() => isLayerGraph(comp), [comp]);
  const selectedIds = useMemo(() => selectedLayerIds(comp, props.selectedNodeIds), [comp, props.selectedNodeIds]);
  const selRef = useRef(selectedIds);
  selRef.current = selectedIds;
  const primary = layers.find((l) => l.sourceId === selectedIds[0]) ?? null;

  const workArea = useMemo<TimeRange>(() => {
    const raw = props.renderRange ?? localRange ?? { start: 0, end: comp.durationSeconds };
    const start = Math.max(0, Math.min(raw.start, comp.durationSeconds));
    const end = Math.min(comp.durationSeconds, Math.max(raw.end, start + frameDuration(comp.fps)));
    return { start, end };
  }, [props.renderRange, localRange, comp.durationSeconds, comp.fps]);
  const setRange = useCallback((range: TimeRange) => (props.onRenderRangeChange ? props.onRenderRangeChange(range) : setLocalRange(range)), [props]);

  // -------------------------------------------------------------- history (view-local undo)

  const undo = useRef<{ comp: Composition; label: string; at: number }[]>([]);
  const redo = useRef<Composition[]>([]);
  const gestureStart = useRef<Composition | null>(null);

  const pushUndo = useCallback((before: Composition, label: string) => {
    const now = Date.now();
    const last = undo.current[undo.current.length - 1];
    if (last && last.label === label && now - last.at < 700) last.at = now;
    else undo.current = [...undo.current.slice(-99), { comp: before, label, at: now }];
    redo.current = [];
  }, []);

  const commit = useCallback(
    (next: Composition, label: string) => {
      if (next === compRef.current) return;
      pushUndo(compRef.current, label);
      compRef.current = next;
      props.onChange(next);
    },
    [props, pushUndo],
  );

  const gesture = useMemo<GestureApi>(
    () => ({
      begin: () => {
        gestureStart.current = compRef.current;
        return compRef.current;
      },
      update: (next) => {
        compRef.current = next;
        props.onChange(next);
      },
      end: (label) => {
        const start = gestureStart.current;
        gestureStart.current = null;
        if (start && start !== compRef.current) pushUndo(start, label);
      },
    }),
    [props, pushUndo],
  );

  // -------------------------------------------------------------- selection

  const selectLayers = useCallback(
    (ids: string[], mode: 'replace' | 'toggle' | 'range' | boolean = 'replace') => {
      const current = selRef.current;
      let next = ids;
      if (mode === true || mode === 'toggle') next = ids.reduce((acc, id) => (acc.includes(id) ? acc.filter((x) => x !== id) : [...acc, id]), current);
      else if (mode === 'range' && current.length && ids.length) {
        const all = aeLayers(compRef.current);
        const a = all.findIndex((l) => l.sourceId === current[0]);
        const b = all.findIndex((l) => l.sourceId === ids[0]);
        if (a >= 0 && b >= 0) next = all.slice(Math.min(a, b), Math.max(a, b) + 1).map((l) => l.sourceId);
      }
      selRef.current = next;
      props.onSelect(next);
    },
    [props],
  );

  // -------------------------------------------------------------- playback (local only when the shell does not drive it)

  const shellPlays = typeof props.onPlayingChange === 'function';
  const playing = shellPlays ? Boolean(props.playing) : localPlaying;
  useEffect(() => {
    if (shellPlays || !localPlaying) return;
    let raf = 0;
    let last = performance.now();
    let t = timeRef.current >= workArea.end - 1e-6 ? workArea.start : timeRef.current;
    const step = (now: number) => {
      t += (now - last) / 1000;
      last = now;
      if (t >= workArea.end) {
        if (!loop) {
          setLocalPlaying(false);
          props.onTimeChange(snapToFrame(workArea.end, comp.fps));
          return;
        }
        t = workArea.start;
      }
      props.onTimeChange(snapToFrame(t, comp.fps));
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [localPlaying, shellPlays, workArea.start, workArea.end, loop, comp.fps]);

  // -------------------------------------------------------------- media & effects

  const addMedia = useCallback(
    (item: MediaItem, at = 0, index?: number) => {
      if (item.type === 'audio') {
        flash('Audio-Ebenen werden in der Komposition nicht unterstützt.');
        return;
      }
      const r = newMediaLayer(compRef.current, item, { at });
      let next = r.comp;
      if (index && index > 1) next = moveLayersToIndex(next, [r.layerId], index);
      commit(next, 'Footage hinzufügen');
      selectLayers([r.layerId]);
      flash(`„${item.name}“ als Ebene hinzugefügt.`);
    },
    [commit, flash, selectLayers],
  );

  const createText = useCallback(
    (position?: { x: number; y: number }, text = 'Text') => {
      const r = newTextLayer(compRef.current, { text, at: 0, position });
      commit(r.comp, 'Neue Textebene');
      selectLayers([r.layerId]);
      return r.layerId;
    },
    [commit, selectLayers],
  );

  const addMask = useCallback(
    (layerId: string, shape: 'ellipse' | 'rectangle', rect?: MaskRect) => {
      const r = addMaskToLayer(compRef.current, layerId, shape, rect);
      if (!r.maskId) return;
      commit(r.comp, 'Neue Maske');
      setUi({ expanded: { ...ui.expanded, [layerId]: true, [`${layerId}:mask`]: true } });
    },
    [commit, setUi, ui.expanded],
  );

  const applyEffect = useCallback(
    (effectId: string, layerId: string | null) => {
      if (effectId === 'builtin:solid') {
        setSolidDialog({ name: '', color: '#7a7a7a' });
        return;
      }
      if (effectId === 'builtin:text') {
        createText();
        return;
      }
      const target = layerId ?? selRef.current[0] ?? null;
      const layer = aeLayers(compRef.current).find((l) => l.sourceId === target);
      if (!layer) {
        flash('Zuerst eine Ebene auswählen.');
        return;
      }
      if (layer.locked) {
        flash('Die Ebene ist gesperrt.');
        return;
      }
      if (effectId === 'builtin:mask-ellipse' || effectId === 'builtin:mask-rect') {
        addMask(layer.sourceId, effectId === 'builtin:mask-ellipse' ? 'ellipse' : 'rectangle');
        return;
      }
      if (!getFxDefinition(effectId)) {
        flash(`Unbekannter Effekt: ${effectId}`);
        return;
      }
      const r = addFxInstanceToLayer(compRef.current, layer.sourceId, createFxInstance(effectId));
      commit(r.comp, 'Effekt anwenden');
      selectLayers([layer.sourceId]);
      setUi({ leftTab: 'effectControls' });
      flash(`${getFxDefinition(effectId)?.name ?? effectId} → ${layer.source.name}`);
    },
    [addMask, commit, createText, flash, selectLayers, setUi],
  );

  // -------------------------------------------------------------- commands

  const keyRefs = useCallback((): KeyRef[] => selectedKeys.map(parseKeyRef).filter((r): r is KeyRef => Boolean(r)), [selectedKeys]);

  const editKeys = useCallback(
    (fn: (node: NonNullable<ReturnType<typeof getNode>>, refs: { prop: AePropId; time: number }[]) => NonNullable<ReturnType<typeof getNode>>, label: string) => {
      const refs = keyRefs();
      if (!refs.length) {
        flash('Keine Keyframes ausgewählt.');
        return false;
      }
      let next = compRef.current;
      const byNode = new Map<string, { prop: AePropId; time: number }[]>();
      for (const r of refs) byNode.set(r.nodeId, [...(byNode.get(r.nodeId) ?? []), { prop: r.prop, time: r.time }]);
      for (const [nodeId, list] of byNode) {
        const node = getNode(next, nodeId);
        if (node) next = replaceNode(next, fn(node, list));
      }
      commit(next, label);
      return true;
    },
    [commit, flash, keyRefs],
  );

  const run = useCallback(
    (command: string, opts: RunOptions = {}) => {
      const c = compRef.current;
      const t = opts.time ?? timeRef.current;
      const all = aeLayers(c);
      const sel = (opts.layerIds ?? selRef.current).filter((id) => all.some((l) => l.sourceId === id));
      const editable = sel.filter((id) => !all.find((l) => l.sourceId === id)?.locked);
      const targets = sel.length ? sel : all.map((l) => l.sourceId);
      const fps = c.fps;
      const setT = (v: number) => props.onTimeChange(Math.max(0, Math.min(c.durationSeconds, snapToFrame(v, fps))));
      const needSel = () => {
        if (!editable.length) flash(sel.length ? 'Die ausgewählten Ebenen sind gesperrt.' : 'Keine Ebene ausgewählt.');
        return editable.length > 0;
      };
      if (STRUCTURAL.includes(command as AeCommandId) && !(command === 'edit.delete' && selectedKeys.length) && !isLayerGraph(c)) {
        flash('Diese Komposition enthält Knoten außerhalb der Ebenenstruktur (z. B. verschachtelte Merges) – bitte in der Fusion-Ansicht bearbeiten.');
        return;
      }
      const forEach = (label: string, fn: (comp: Composition, id: string) => Composition) => {
        if (!needSel()) return;
        let next = c;
        for (const id of editable) next = fn(next, id);
        commit(next, label);
      };
      const reveal = (props: AePropId[], additive: boolean) => {
        const nextReveal = revealProps(ui.reveal, targets, props, additive);
        const expanded = { ...ui.expanded };
        for (const id of targets) expanded[id] = false;
        setUi({ reveal: nextReveal, expanded });
      };
      const ease = (kind: EaseKind, label: string) => editKeys((node, refs) => applyEase(node, refs, kind), label);
      switch (command as AeCommandId) {
        case 'transport.playToggle':
          if (shellPlays) props.onPlayingChange?.(!props.playing);
          else setLocalPlaying((p) => !p);
          return;
        case 'time.prevFrame':
          return setT(t - frameDuration(fps));
        case 'time.nextFrame':
          return setT(t + frameDuration(fps));
        case 'time.prev10':
          return setT(t - 10 * frameDuration(fps));
        case 'time.next10':
          return setT(t + 10 * frameDuration(fps));
        case 'time.start':
          return setT(0);
        case 'time.end':
          return setT(c.durationSeconds - frameDuration(fps));
        case 'time.prevKeyframe':
        case 'time.nextKeyframe': {
          const nodes = all.filter((l) => targets.includes(l.sourceId)).map((l) => l.transform);
          const next = adjacentTime(collectKeyTimes(nodes), t, command === 'time.prevKeyframe' ? -1 : 1);
          if (next === null) flash('Kein weiterer Keyframe.');
          else setT(next);
          return;
        }
        case 'time.layerIn':
        case 'time.layerOut': {
          const layer = all.find((l) => l.sourceId === sel[0]);
          if (!layer) return flash('Keine Ebene ausgewählt.');
          return setT(command === 'time.layerIn' ? layer.inPoint : layer.outPoint - frameDuration(fps));
        }
        case 'workArea.start':
          return setRange(setWorkArea(workArea, 'start', t, c));
        case 'workArea.end':
          return setRange(setWorkArea(workArea, 'end', t + frameDuration(fps), c));
        case 'layer.inToTime':
          return forEach('In-Point verschieben', (n, id) => moveLayerInTo(n, id, t));
        case 'layer.outToTime':
          return forEach('Out-Point verschieben', (n, id) => moveLayerOutTo(n, id, t));
        case 'layer.trimIn':
          return forEach('In-Point trimmen', (n, id) => trimLayerIn(n, id, t));
        case 'layer.trimOut':
          return forEach('Out-Point trimmen', (n, id) => {
            const layer = all.find((l) => l.sourceId === id);
            const dur = layer?.source.type === 'media' ? mediaItems.find((m) => m.id === layer.source.mediaId)?.duration : undefined;
            return trimLayerOut(n, id, t + frameDuration(fps), dur);
          });
        case 'layer.newSolid':
          setSolidDialog({ name: '', color: '#7a7a7a' });
          return;
        case 'layer.newText':
          createText();
          setUi({ leftTab: 'effectControls' });
          return;
        case 'layer.duplicate': {
          if (!needSel()) return;
          let next = c;
          const created: string[] = [];
          for (const id of editable) {
            const r = duplicateLayer(next, id);
            next = r.comp;
            if (r.layerId) created.push(r.layerId);
          }
          commit(next, 'Duplizieren');
          if (created.length) selectLayers(created);
          return;
        }
        case 'layer.split': {
          if (!needSel()) return;
          let next = c;
          const created: string[] = [];
          for (const id of editable) {
            const r = splitLayer(next, id, t);
            next = r.comp;
            if (r.layerId) created.push(r.layerId);
          }
          if (!created.length) return flash('Die aktuelle Zeit liegt nicht innerhalb der ausgewählten Ebenen.');
          commit(next, 'Ebene teilen');
          selectLayers(created);
          return;
        }
        case 'layer.forward':
        case 'layer.backward':
        case 'layer.front':
        case 'layer.back': {
          if (!needSel()) return;
          const mode = command.split('.')[1] as 'forward';
          commit(reorderLayers(c, editable, mode), 'Ebenenreihenfolge');
          return;
        }
        case 'layer.precompose':
          return flash('Vorkomponieren ist in dieser Version nicht verfügbar (verschachtelte Kompositionen fehlen im gemeinsamen Modell).');
        case 'layer.maskEllipse':
        case 'layer.maskRect':
          if (!needSel()) return;
          addMask(editable[0], command === 'layer.maskEllipse' ? 'ellipse' : 'rectangle');
          return;
        case 'edit.delete':
          if (selectedKeys.length) {
            if (editKeys((node, refs) => deleteKeyframes(node, refs), 'Keyframes löschen')) setSelectedKeys([]);
            return;
          }
          if (!needSel()) return;
          commit(deleteLayers(c, editable), 'Ebenen löschen');
          selectLayers([]);
          return;
        case 'edit.undo':
        case 'edit.redo':
          // Inside the Fusion shell its history owns undo (one stack for all three views).
          if (rootRef.current?.closest('[data-automation-id="fusion-shell"]')) {
            window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', code: 'KeyZ', metaKey: true, ctrlKey: true, shiftKey: command === 'edit.redo', bubbles: true }));
            return;
          }
          if (command === 'edit.redo') {
            const next = redo.current.pop();
            if (!next) return flash('Nichts zu wiederholen.');
            undo.current.push({ comp: c, label: 'Wiederholen', at: 0 });
            compRef.current = next;
            props.onChange(next);
            return;
          }
          {
          const entry = undo.current.pop();
          if (!entry) return flash('Nichts rückgängig zu machen.');
          redo.current.push(c);
          compRef.current = entry.comp;
          props.onChange(entry.comp);
          return flash(`Rückgängig: ${entry.label}`);
          }
        case 'select.all':
          return selectLayers(all.filter((l) => !l.locked).map((l) => l.sourceId));
        case 'select.none':
          setSelectedKeys([]);
          return selectLayers([]);
        case 'select.above':
        case 'select.below': {
          const index = all.findIndex((l) => l.sourceId === sel[0]);
          const nextIndex = index < 0 ? 0 : index + (command === 'select.above' ? -1 : 1);
          const layer = all[Math.max(0, Math.min(all.length - 1, nextIndex))];
          if (layer) selectLayers([layer.sourceId]);
          return;
        }
        case 'reveal.anchor':
        case 'reveal.position':
        case 'reveal.scale':
        case 'reveal.rotation':
        case 'reveal.opacity':
          return reveal([command.split('.')[1] as AePropId], Boolean(opts.additive));
        case 'reveal.keyframed': {
          const nextReveal = { ...ui.reveal };
          const expanded = { ...ui.expanded };
          for (const id of targets) {
            const layer = all.find((l) => l.sourceId === id);
            const props = keyframedProps(layer?.transform);
            const current = ui.reveal[id] ?? [];
            nextReveal[id] = !opts.additive && current.length && props.every((p) => current.includes(p)) && current.length === props.length ? [] : props;
            expanded[id] = false;
          }
          return setUi({ reveal: nextReveal, expanded });
        }
        case 'key.anchor':
        case 'key.position':
        case 'key.scale':
        case 'key.rotation':
        case 'key.opacity': {
          const prop = command.split('.')[1] as AePropId;
          if (!needSel()) return;
          let next = c;
          for (const id of editable) {
            const ensured = ensureTransform(next, id);
            const node = ensured.transformId ? getNode(ensured.comp, ensured.transformId) : null;
            next = node ? replaceNode(ensured.comp, addKeyframeAt(node, prop, snapToFrame(t, fps))) : ensured.comp;
          }
          commit(next, 'Keyframe hinzufügen');
          const nextReveal = { ...ui.reveal };
          for (const id of editable) if (!(nextReveal[id] ?? []).includes(prop)) nextReveal[id] = [...(nextReveal[id] ?? []), prop];
          setUi({ reveal: nextReveal });
          return;
        }
        case 'ease.easy':
          return void ease('easy', 'Easy Ease');
        case 'ease.in':
          return void ease('in', 'Easy Ease In');
        case 'ease.out':
          return void ease('out', 'Easy Ease Out');
        case 'ease.linear':
          return void ease('linear', 'Linear');
        case 'ease.hold':
          return void ease('hold', 'Halten');
        case 'tool.selection':
        case 'tool.hand':
        case 'tool.zoom':
        case 'tool.rotate':
        case 'tool.anchor':
        case 'tool.mask':
        case 'tool.text': {
          const tool = command.split('.')[1] as AeToolId;
          if (tool === 'mask' && ui.tool === 'mask') setUi({ maskShape: ui.maskShape === 'rectangle' ? 'ellipse' : 'rectangle' });
          else setUi({ tool });
          return;
        }
        case 'view.zoomIn':
          return zoomFn.current?.(1);
        case 'view.zoomOut':
          return zoomFn.current?.(-1);
        case 'timeline.zoomIn':
          return setUi({ pxPerSecond: Math.min(2000, ui.pxPerSecond * 1.5) });
        case 'timeline.zoomOut':
          return setUi({ pxPerSecond: Math.max(5, ui.pxPerSecond / 1.5) });
        case 'comp.render':
          if (props.onRenderToMedia) props.onRenderToMedia();
          else flash('Rendern ist in dieser Umgebung nicht verfügbar.');
          return;
        default:
          flash(`Unbekannter Befehl: ${command}`);
      }
    },
    [addMask, commit, createText, editKeys, flash, mediaItems, props, selectLayers, selectedKeys.length, setRange, setUi, shellPlays, ui, workArea],
  );

  const runRef = useRef(run);
  runRef.current = run;

  // -------------------------------------------------------------- MCP live commands

  const stateSummary = useCallback(
    () => ({
      compId: compRef.current.id,
      time: timeRef.current,
      playing,
      selectedLayers: selRef.current,
      selectedKeyframes: selectedKeys.map(parseKeyRef).filter(Boolean),
      workArea,
      tool: ui.tool,
      maskShape: ui.maskShape,
      resolution: ui.resolution,
      viewerZoom: ui.viewerZoom,
      showGrid: ui.showGrid,
      showSafe: ui.showSafe,
      transparency: ui.transparency,
      pxPerSecond: ui.pxPerSecond,
      revealed: ui.reveal,
      expanded: Object.keys(ui.expanded).filter((k) => ui.expanded[k]),
      leftTab: ui.leftTab,
      layerGraph: isLayerGraph(compRef.current),
      commands: AE_COMMANDS.map((c) => c.id),
    }),
    [playing, selectedKeys, ui, workArea],
  );
  const summaryRef = useRef(stateSummary);
  summaryRef.current = stateSummary;

  useEffect(
    () =>
      registerLiveCommands({
        'ae.state.get': () => summaryRef.current(),
        'ae.command.run': (args) => {
          const layerIds = Array.isArray(args.selectLayers) ? (args.selectLayers as unknown[]).filter((v): v is string => typeof v === 'string') : undefined;
          const t = typeof args.time === 'number' && Number.isFinite(args.time) ? args.time : undefined;
          if (layerIds) selectLayers(layerIds);
          if (t !== undefined) props.onTimeChange(t);
          if (args.ui && typeof args.ui === 'object') {
            const patch = sanitizeUi({ ...ui, ...(args.ui as object) });
            setUi({ resolution: patch.resolution, viewerZoom: patch.viewerZoom, showGrid: patch.showGrid, showSafe: patch.showSafe, transparency: patch.transparency, pxPerSecond: patch.pxPerSecond, tool: patch.tool, maskShape: patch.maskShape });
          }
          if (typeof args.command === 'string' && args.command) {
            if (!AE_COMMANDS.some((c) => c.id === args.command)) throw new Error(`Unknown command ${args.command}.`);
            runRef.current(args.command, { additive: args.additive === true, layerIds, time: t });
          }
          return { ...summaryRef.current(), ...(layerIds ? { selectedLayers: layerIds } : {}), ...(t !== undefined ? { time: t } : {}) };
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // -------------------------------------------------------------- keyboard

  const onKeyDown = (e: React.KeyboardEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('input, textarea, select, [contenteditable="true"]')) return;
    const hit = resolveAeShortcut(e.nativeEvent);
    if (!hit) return;
    e.preventDefault();
    e.stopPropagation();
    run(hit.command, { additive: hit.additive });
  };

  // -------------------------------------------------------------- menus

  const menuItems = (menu: string): MenuItem[] => {
    const items: MenuItem[] = AE_COMMANDS.filter((c) => c.menu === menu).map((c) => ({
      id: c.id,
      label: c.label,
      shortcut: c.shortcut,
      disabled: c.id === 'layer.precompose' || (c.id === 'comp.render' && !props.onRenderToMedia),
    }));
    if (menu === 'Ansicht') {
      items.push({ id: 'sep', label: '', separator: true });
      items.push({ id: 'ui.grid', label: 'Raster einblenden', checked: ui.showGrid });
      items.push({ id: 'ui.safe', label: 'Titel-/aktionssichere Ränder', checked: ui.showSafe });
      items.push({ id: 'ui.transparency', label: 'Transparenzraster', checked: ui.transparency });
    }
    if (menu === 'Komposition') {
      items.push({ id: 'sep', label: '', separator: true });
      for (const r of [1, 2, 3, 4] as const) items.push({ id: `ui.res.${r}`, label: `Auflösung: ${['Voll', 'Halb', 'Drittel', 'Viertel'][r - 1]}`, checked: ui.resolution === r });
    }
    return items;
  };
  const pickMenu = (id: string) => {
    if (id === 'ui.grid') return setUi({ showGrid: !ui.showGrid });
    if (id === 'ui.safe') return setUi({ showSafe: !ui.showSafe });
    if (id === 'ui.transparency') return setUi({ transparency: !ui.transparency });
    if (id.startsWith('ui.res.')) return setUi({ resolution: Number(id.slice(7)) as AeUiState['resolution'] });
    run(id);
  };

  // -------------------------------------------------------------- splitter

  const splitDrag = useRef<{ y: number; h: number } | null>(null);

  const anyKeysOnSelection = selectedKeys.length > 0;

  return (
    <div
      className="aev-root"
      ref={rootRef}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onPointerDown={(e) => {
        const target = e.target as HTMLElement;
        if (!target.closest('input, textarea, select')) rootRef.current?.focus({ preventScroll: true });
      }}
      data-automation-id="ae.root"
    >
      <div className="aev-menubar">
        {MENUS.map((menu) => (
          <DropMenu key={menu} label={menu} items={menuItems(menu)} onPick={pickMenu} automationId={`ae.menu.${menu.toLowerCase()}`} />
        ))}
        <span className="aev-spacer" />
        {status && (
          <span className="aev-status" data-automation-id="ae.status">
            {status}
          </span>
        )}
      </div>
      <div className="aev-toolbar" data-automation-id="ae.tools">
        {TOOLS.map((tool) => (
          <button
            key={tool.id}
            type="button"
            className={`aev-tool${ui.tool === tool.id ? ' is-on' : ''}`}
            title={`${tool.label} (${tool.key})`}
            data-automation-id={`ae.tool.${tool.id}`}
            onClick={() => run(`tool.${tool.id}`)}
          >
            {tool.icon}
            {tool.id === 'mask' && <span className="aev-tool-sub">{ui.maskShape === 'rectangle' ? '▭' : '◯'}</span>}
          </button>
        ))}
        <span className="aev-tool-sep" />
        {ui.tool === 'mask' && (
          <span className="aev-seg" data-automation-id="ae.tool.maskShape">
            <button type="button" className={ui.maskShape === 'rectangle' ? 'is-on' : ''} onClick={() => setUi({ maskShape: 'rectangle' })} data-automation-id="ae.tool.maskShape.rectangle">
              Rechteck
            </button>
            <button type="button" className={ui.maskShape === 'ellipse' ? 'is-on' : ''} onClick={() => setUi({ maskShape: 'ellipse' })} data-automation-id="ae.tool.maskShape.ellipse">
              Ellipse
            </button>
          </span>
        )}
        <span className="aev-spacer" />
        <span className="aev-dim">Standard</span>
      </div>
      {!layerGraph && (
        <div className="aev-banner" data-automation-id="ae.banner.nonLayer">
          Diese Komposition enthält Knoten, die nicht als einfache Ebenen darstellbar sind (z. B. verschachtelte Merges). Reihenfolge, Löschen, Duplizieren und Teilen sind hier gesperrt – bitte in der Fusion-Ansicht bearbeiten.
        </div>
      )}
      <div className="aev-main">
        <div className="aev-col aev-left">
          <div className="aev-tabs">
            <button type="button" className={ui.leftTab === 'project' ? 'is-on' : ''} data-automation-id="ae.tab.project" onClick={() => setUi({ leftTab: 'project' })}>
              Projekt
            </button>
            <button type="button" className={ui.leftTab === 'effectControls' ? 'is-on' : ''} data-automation-id="ae.tab.effectControls" onClick={() => setUi({ leftTab: 'effectControls' })}>
              Effekteinstellungen{primary ? `: ${primary.source.name}` : ''}
            </button>
          </div>
          <div className="aev-col-body">
            {ui.leftTab === 'project' ? (
              <ProjectPanel comp={comp} mediaItems={mediaItems} onAddMedia={(item) => addMedia(item, 0)} onAddToTimeline={props.onAddToTimeline} onRender={props.onRenderToMedia} />
            ) : (
              <EffectControlsPanel comp={comp} layer={primary} time={time} commit={commit} />
            )}
          </div>
        </div>
        <div className="aev-center">
          <AeViewer
            comp={comp}
            time={time}
            playing={playing}
            resolveMedia={props.resolveMedia}
            ui={ui}
            setUi={setUi}
            layers={layers}
            selectedIds={selectedIds}
            onSelectLayers={(ids, additive) => selectLayers(ids, additive ? 'toggle' : 'replace')}
            gesture={gesture}
            onCreateText={(pos) => createText(pos)}
            onTextCommit={(id, text) => commit(patchParams({ ...compRef.current, nodes: compRef.current.nodes.map((n) => (n.id === id ? { ...n, name: text } : n)) }, id, { text }), 'Text ändern')}
            onCreateMask={(id, rect, shape) => addMask(id, shape, rect)}
            onDropMedia={(mediaId) => {
              const item = mediaItems.find((m) => m.id === mediaId);
              if (item) addMedia(item, 0);
            }}
            onDropEffect={applyEffect}
            onPixel={setPixel}
            onRenderTime={setRenderMs}
            onStatus={flash}
            registerZoom={(fn) => {
              zoomFn.current = fn;
            }}
          />
        </div>
        <div className="aev-col aev-right">
          <div className="aev-panel-head">
            <span className="aev-panel-title">Vorschau</span>
          </div>
          <PreviewPanel playing={playing} run={run} loop={loop} onLoop={setLoop} />
          <div className="aev-tabs">
            <button type="button" className={rightTab === 'effects' ? 'is-on' : ''} data-automation-id="ae.tab.effects" onClick={() => setRightTab('effects')}>
              Effekte und Vorgaben
            </button>
            <button type="button" className={rightTab === 'info' ? 'is-on' : ''} data-automation-id="ae.tab.info" onClick={() => setRightTab('info')}>
              Info
            </button>
          </div>
          <div className="aev-col-body">
            {rightTab === 'effects' ? <EffectsPresetsPanel onApply={(id) => applyEffect(id, null)} hasSelection={selectedIds.length > 0} /> : <InfoPanel pixel={pixel} layer={primary} comp={comp} time={time} />}
          </div>
          {rightTab === 'effects' && (
            <div className="aev-mini-info">
              <InfoPanel pixel={pixel} layer={primary} comp={comp} time={time} />
            </div>
          )}
        </div>
      </div>
      <div
        className="aev-splitter"
        data-automation-id="ae.splitter"
        onPointerDown={(e) => {
          (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
          splitDrag.current = { y: e.clientY, h: ui.timelineHeight };
        }}
        onPointerMove={(e) => {
          const d = splitDrag.current;
          if (d) setUi({ timelineHeight: Math.max(140, Math.min(900, d.h - (e.clientY - d.y))) });
        }}
        onPointerUp={() => {
          splitDrag.current = null;
        }}
      />
      <div className="aev-bottom" style={{ height: ui.timelineHeight }}>
        <AeTimeline
          comp={comp}
          time={time}
          onTimeChange={props.onTimeChange}
          layers={layers}
          selectedIds={selectedIds}
          onSelectLayers={(ids, mode) => {
            if (!anyKeysOnSelection || mode === 'replace') setSelectedKeys([]);
            selectLayers(ids, mode);
          }}
          selectedKeys={selectedKeys}
          onSelectKeys={(ids) => setSelectedKeys(ids)}
          ui={ui}
          setUi={setUi}
          workArea={workArea}
          onWorkArea={setRange}
          gesture={gesture}
          commit={commit}
          run={(cmd) => run(cmd)}
          mediaItems={mediaItems}
          onDropMedia={(mediaId, at, index) => {
            const item = mediaItems.find((m) => m.id === mediaId);
            if (item) addMedia(item, at, index);
          }}
          onDropEffect={(effectId, layerId) => applyEffect(effectId, layerId)}
          onReorder={(ids, index) => {
            if (!isLayerGraph(compRef.current)) return flash('Reihenfolge ist für diese Komposition gesperrt.');
            commit(moveLayersToIndex(compRef.current, ids, index), 'Ebenenreihenfolge');
          }}
          renderMs={renderMs}
        />
      </div>
      {solidDialog && (
        <div className="aev-modal" role="dialog" aria-label="Einstellungen für Farbfläche" data-automation-id="ae.solidDialog">
          <div className="aev-modal-box">
            <div className="aev-modal-title">Einstellungen für Farbfläche</div>
            <label className="aev-ec-row">
              <span>Name</span>
              <input className="aev-input" autoFocus value={solidDialog.name} placeholder={`Farbfläche ${comp.nodes.filter((n) => n.type === 'solid').length + 1}`} data-automation-id="ae.solidDialog.name" onKeyDown={(e) => e.stopPropagation()} onChange={(e) => setSolidDialog({ ...solidDialog, name: e.target.value })} />
            </label>
            <label className="aev-ec-row">
              <span>Größe</span>
              <span className="aev-dim">
                {comp.width} × {comp.height} (Kompositionsgröße)
              </span>
            </label>
            <label className="aev-ec-row">
              <span>Farbe</span>
              <input type="color" value={solidDialog.color} data-automation-id="ae.solidDialog.color" onChange={(e) => setSolidDialog({ ...solidDialog, color: e.target.value })} />
            </label>
            <div className="aev-modal-actions">
              <button type="button" className="aev-chip" data-automation-id="ae.solidDialog.cancel" onClick={() => setSolidDialog(null)}>
                Abbrechen
              </button>
              <button
                type="button"
                className="aev-chip is-primary"
                data-automation-id="ae.solidDialog.ok"
                onClick={() => {
                  const r = newSolidLayer(compRef.current, { name: solidDialog.name.trim() || undefined, color: solidDialog.color, at: 0 });
                  commit(r.comp, 'Neue Farbfläche');
                  selectLayers([r.layerId]);
                  setSolidDialog(null);
                }}
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

