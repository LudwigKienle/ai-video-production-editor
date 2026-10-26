/**
 * Timeline panel of the After Effects view: layer outline with switches,
 * label, number, source name, mode and (optional) parent column; time ruler
 * with work area and current-time indicator; layer bars (move/trim);
 * twirl-down Transform / Masks / Effects with stopwatches and keyframes.
 */
import React, { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, Eye, Lock } from 'lucide-react';
import type { CompBlendMode, CompNode, Composition } from '../fusion-shared/compModel.ts';
import { getNode, paramsAt } from '../fusion-shared/compModel.ts';
import type { MediaItem } from '../../types.ts';
import { getFxDefinition } from '../../fx/registry';
import type { FxInstance, FxParamDef } from '../../fx/types';
import type { AeLayer, AePropId, AeUiState, KeyRef, TimeRange } from './aeOps.ts';
import {
  AE_PROPS,
  ensureTransform,
  formatRotation,
  formatTimecode,
  fromDisplay,
  isPropAnimated,
  keyRefId,
  keyframeShape,
  LABEL_COLORS,
  layerColor,
  moveKeyframes,
  moveLayerTime,
  parseKeyRef,
  parseTimecode,
  propDef,
  propKeyframeTimes,
  propValueAt,
  renameLayer,
  setLayerBlend,
  setLayerLabel,
  setLayerSwitch,
  setPropValue,
  setWorkArea,
  snapToFrame,
  toDisplay,
  toggleKeyframeAt,
  toggleStopwatch,
  trimLayerIn,
  trimLayerOut,
  adjacentTime,
  patchParams,
  replaceNode,
} from './aeOps.ts';
import type { GestureApi } from './AeViewer';
import { ContextMenu, KeyGlyph, ScrubNumber, SoloIcon, StopwatchIcon } from './aeWidgets';
import type { MenuItem } from './aeWidgets';

export const BLEND_LABELS: Record<CompBlendMode, string> = {
  normal: 'Normal',
  darken: 'Abdunkeln',
  multiply: 'Multiplizieren',
  lighten: 'Aufhellen',
  screen: 'Negativ multiplizieren',
  add: 'Addieren',
  overlay: 'Ineinanderkopieren',
  'soft-light': 'Weiches Licht',
  difference: 'Differenz',
};

const ROW_H = 22;

type Row =
  | { kind: 'layer'; layer: AeLayer }
  | { kind: 'group'; layer: AeLayer; key: string; label: string; open: boolean; depth: number; reset?: boolean }
  | { kind: 'prop'; layer: AeLayer; prop: AePropId; depth: number }
  | { kind: 'fx'; layer: AeLayer; node: CompNode; inst: FxInstance; key: string; open: boolean }
  | { kind: 'fxparam'; layer: AeLayer; node: CompNode; inst: FxInstance; param: FxParamDef }
  | { kind: 'mask'; layer: AeLayer; node: CompNode; key: string; open: boolean }
  | { kind: 'maskparam'; layer: AeLayer; node: CompNode; param: 'path' | 'feather' };

type Props = {
  comp: Composition;
  time: number;
  onTimeChange(t: number): void;
  layers: AeLayer[];
  selectedIds: string[];
  onSelectLayers(ids: string[], mode: 'replace' | 'toggle' | 'range'): void;
  selectedKeys: string[];
  onSelectKeys(ids: string[], additive: boolean): void;
  ui: AeUiState;
  setUi(patch: Partial<AeUiState>): void;
  workArea: TimeRange;
  onWorkArea(range: TimeRange): void;
  gesture: GestureApi;
  commit(next: Composition, label: string): void;
  run(command: string): void;
  mediaItems: MediaItem[];
  onDropMedia(mediaId: string, at: number, index: number): void;
  onDropEffect(effectId: string, layerId: string): void;
  onReorder(ids: string[], index: number): void;
  renderMs: number;
};

const niceStep = (pps: number) => {
  const steps = [1 / 25, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pps >= 64) ?? 600;
};

export default function AeTimeline(props: Props) {
  const { comp, time, layers, ui, selectedIds } = props;
  const pps = ui.pxPerSecond;
  const left = 54 + 18 + 18 + 30 + 170 + 44 + 110 + (ui.showParentColumn ? 100 : 0);
  const width = Math.max(1, comp.durationSeconds * pps);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [tcEdit, setTcEdit] = useState<string | null>(null);
  const [rename, setRename] = useState<{ id: string; value: string } | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[]; onPick(id: string): void } | null>(null);
  const drag = useRef<null | { kind: string; x: number; snapshot?: Composition; data?: unknown }>(null);
  const selectedKeySet = useMemo(() => new Set(props.selectedKeys), [props.selectedKeys]);

  const isOpen = (key: string) => ui.expanded[key] === true;
  const toggle = (key: string, value?: boolean) => props.setUi({ expanded: { ...ui.expanded, [key]: value ?? !isOpen(key) } });

  const rows = useMemo(() => {
    const out: Row[] = [];
    for (const layer of layers) {
      out.push({ kind: 'layer', layer });
      const id = layer.sourceId;
      if (isOpen(id)) {
        if (layer.maskNodes.length) {
          const key = `${id}:mask`;
          out.push({ kind: 'group', layer, key, label: 'Masken', open: isOpen(key), depth: 1 });
          if (isOpen(key))
            for (const node of layer.maskNodes) {
              const mk = `${id}:mask:${node.id}`;
              out.push({ kind: 'mask', layer, node, key: mk, open: isOpen(mk) });
              if (isOpen(mk)) {
                out.push({ kind: 'maskparam', layer, node, param: 'path' });
                out.push({ kind: 'maskparam', layer, node, param: 'feather' });
              }
            }
        }
        const stacks = layer.fxNodes.flatMap((node) => (node.fxStack ?? []).map((inst) => ({ node, inst })));
        if (stacks.length) {
          const key = `${id}:fx`;
          out.push({ kind: 'group', layer, key, label: 'Effekte', open: isOpen(key), depth: 1 });
          if (isOpen(key))
            for (const { node, inst } of stacks) {
              const fk = `${id}:fx:${inst.id}`;
              out.push({ kind: 'fx', layer, node, inst, key: fk, open: isOpen(fk) });
              if (isOpen(fk)) for (const param of getFxDefinition(inst.effectId)?.params ?? []) out.push({ kind: 'fxparam', layer, node, inst, param });
            }
        }
        const tk = `${id}:tr`;
        out.push({ kind: 'group', layer, key: tk, label: 'Transformieren', open: isOpen(tk), depth: 1, reset: true });
        if (isOpen(tk)) for (const p of AE_PROPS) out.push({ kind: 'prop', layer, prop: p.id, depth: 2 });
      } else {
        for (const prop of ui.reveal[id] ?? []) out.push({ kind: 'prop', layer, prop, depth: 1 });
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layers, ui.expanded, ui.reveal]);

  const xToTime = (clientX: number) => {
    const el = scrollRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    return Math.max(0, Math.min(comp.durationSeconds, (clientX - rect.left + el.scrollLeft - left) / pps));
  };

  // -------------------------------------------------------------- edits

  const editProp = (layer: AeLayer, prop: AePropId, display: number[], phase: 'start' | 'move' | 'end' | 'set') => {
    if (layer.locked) return;
    if (phase === 'start') {
      props.gesture.begin();
      return;
    }
    if (phase === 'end') {
      props.gesture.end(`${propDef(prop).label} ändern`);
      return;
    }
    const ensured = ensureTransform(props.comp, layer.sourceId);
    const node = ensured.transformId ? getNode(ensured.comp, ensured.transformId) : null;
    if (!node) return;
    const next = replaceNode(ensured.comp, setPropValue(node, prop, fromDisplay(prop, display, comp), time));
    if (phase === 'move') props.gesture.update(next);
    else props.commit(next, `${propDef(prop).label} ändern`);
  };

  const withTransform = (layer: AeLayer, fn: (node: CompNode) => CompNode, label: string) => {
    if (layer.locked) return;
    const ensured = ensureTransform(props.comp, layer.sourceId);
    const node = ensured.transformId ? getNode(ensured.comp, ensured.transformId) : null;
    if (node) props.commit(replaceNode(ensured.comp, fn(node)), label);
  };

  const setFxParam = (node: CompNode, inst: FxInstance, paramId: string, value: number | boolean | string, phase: 'start' | 'move' | 'end' | 'set') => {
    if (phase === 'start') {
      props.gesture.begin();
      return;
    }
    if (phase === 'end') {
      props.gesture.end('Effektwert ändern');
      return;
    }
    const current = getNode(props.comp, node.id);
    if (!current) return;
    const stack = (current.fxStack ?? []).map((entry) => (entry.id === inst.id ? { ...entry, params: { ...entry.params, [paramId]: value } } : entry));
    const next = replaceNode(props.comp, { ...current, fxStack: stack });
    if (phase === 'move') props.gesture.update(next);
    else props.commit(next, 'Effektwert ändern');
  };

  const setMaskParams = (node: CompNode, params: Record<string, number | boolean>, phase: 'start' | 'move' | 'end' | 'set') => {
    if (phase === 'start') {
      props.gesture.begin();
      return;
    }
    if (phase === 'end') {
      props.gesture.end('Maske ändern');
      return;
    }
    const next = patchParams(props.comp, node.id, params);
    if (phase === 'move') props.gesture.update(next);
    else props.commit(next, 'Maske ändern');
  };

  // -------------------------------------------------------------- pointer: ruler, bars, keys

  const startScrub = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: 'scrub', x: e.clientX };
    props.onTimeChange(snapToFrame(xToTime(e.clientX), comp.fps));
  };

  const startWorkArea = (e: React.PointerEvent, edge: 'start' | 'end' | 'move') => {
    e.stopPropagation();
    if (e.button !== 0) return;
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    drag.current = { kind: `wa-${edge}`, x: e.clientX, data: { ...props.workArea } };
  };

  const startBar = (e: React.PointerEvent, layer: AeLayer, mode: 'move' | 'in' | 'out') => {
    e.stopPropagation();
    if (e.button !== 0 || layer.locked) return;
    if (!selectedIds.includes(layer.sourceId)) props.onSelectLayers([layer.sourceId], e.metaKey || e.ctrlKey ? 'toggle' : 'replace');
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const snapshot = props.gesture.begin();
    drag.current = { kind: `bar-${mode}`, x: e.clientX, snapshot, data: { layer } };
  };

  const startKey = (e: React.PointerEvent, ref: KeyRef) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    const id = keyRefId(ref);
    let selection = props.selectedKeys;
    if (!selectedKeySet.has(id) || e.shiftKey) {
      selection = e.shiftKey ? (selectedKeySet.has(id) ? props.selectedKeys.filter((k) => k !== id) : [...props.selectedKeys, id]) : [id];
      props.onSelectKeys(selection, false);
    }
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const snapshot = props.gesture.begin();
    drag.current = { kind: 'keys', x: e.clientX, snapshot, data: { selection, moved: 0 } };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dt = (e.clientX - d.x) / pps;
    if (d.kind === 'scrub') {
      let t = snapToFrame(xToTime(e.clientX), comp.fps);
      if (e.shiftKey) {
        const keyTimes = layers.flatMap((l) => [l.inPoint, l.outPoint, ...AE_PROPS.flatMap((p) => propKeyframeTimes(l.transform, p.id))]);
        const near = keyTimes.find((k) => Math.abs(k - t) * pps < 6);
        if (near !== undefined) t = near;
      }
      props.onTimeChange(t);
      return;
    }
    if (d.kind.startsWith('wa-')) {
      const r0 = d.data as TimeRange;
      if (d.kind === 'wa-move') {
        const len = r0.end - r0.start;
        const start = Math.max(0, Math.min(comp.durationSeconds - len, snapToFrame(r0.start + dt, comp.fps)));
        props.onWorkArea({ start, end: start + len });
      } else props.onWorkArea(setWorkArea(r0, d.kind === 'wa-start' ? 'start' : 'end', xToTime(e.clientX), comp));
      return;
    }
    const snapshot = d.snapshot!;
    if (d.kind.startsWith('bar-')) {
      const { layer } = d.data as { layer: AeLayer };
      const snapT = (t: number) => (e.shiftKey && Math.abs(t - time) * pps < 8 ? time : t);
      const sourceDuration = props.mediaItems.find((m) => m.id === layer.source.mediaId)?.duration;
      let next = snapshot;
      if (d.kind === 'bar-move') {
        const ids = selectedIds.includes(layer.sourceId) ? selectedIds : [layer.sourceId];
        let delta = snapToFrame(dt, comp.fps);
        if (e.shiftKey) {
          const target = snapT(layer.inPoint + delta);
          if (target === time) delta = time - layer.inPoint;
        }
        for (const id of ids) if (!layers.find((l) => l.sourceId === id)?.locked) next = moveLayerTime(next, id, delta);
      } else if (d.kind === 'bar-in') next = trimLayerIn(snapshot, layer.sourceId, snapT(layer.inPoint + dt));
      else next = trimLayerOut(snapshot, layer.sourceId, snapT(layer.outPoint + dt), layer.source.type === 'media' ? sourceDuration : undefined);
      props.gesture.update(next);
      return;
    }
    if (d.kind === 'keys') {
      const info = d.data as { selection: string[]; moved: number };
      const delta = snapToFrame(dt, comp.fps);
      info.moved = delta;
      const byNode = new Map<string, { prop: AePropId; time: number }[]>();
      for (const id of info.selection) {
        const ref = parseKeyRef(id);
        if (ref) byNode.set(ref.nodeId, [...(byNode.get(ref.nodeId) ?? []), { prop: ref.prop, time: ref.time }]);
      }
      let next = snapshot;
      for (const [nodeId, refs] of byNode) {
        const node = getNode(snapshot, nodeId);
        if (node) next = replaceNode(next, moveKeyframes(node, refs, delta, comp.fps));
      }
      props.gesture.update(next);
    }
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'bar-move') props.gesture.end('Ebene zeitlich verschieben');
    else if (d.kind === 'bar-in' || d.kind === 'bar-out') props.gesture.end('Ebene trimmen');
    else if (d.kind === 'keys') {
      props.gesture.end('Keyframes verschieben');
      const info = d.data as { selection: string[]; moved: number };
      if (Math.abs(info.moved) > 1e-9)
        props.onSelectKeys(
          info.selection
            .map(parseKeyRef)
            .filter((r): r is KeyRef => Boolean(r))
            .map((r) => keyRefId({ ...r, time: Math.max(0, snapToFrame(r.time + info.moved, comp.fps)) })),
          false,
        );
    }
  };

  // -------------------------------------------------------------- drops

  const onRowDragOver = (e: React.DragEvent) => {
    const types = e.dataTransfer.types;
    if (types.includes('application/x-avpe-media-id') || types.includes('application/x-ae-effect') || types.includes('application/x-ae-layer')) e.preventDefault();
  };

  const onRowDrop = (e: React.DragEvent, layer: AeLayer | null) => {
    const mediaId = e.dataTransfer.getData('application/x-avpe-media-id');
    const effectId = e.dataTransfer.getData('application/x-ae-effect');
    const layerIds = e.dataTransfer.getData('application/x-ae-layer');
    if (!mediaId && !effectId && !layerIds) return;
    e.preventDefault();
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const below = e.clientY > rect.top + rect.height / 2;
    const index = layer ? layer.index + (below ? 1 : 0) : layers.length + 1;
    if (mediaId) props.onDropMedia(mediaId, snapToFrame(xToTime(e.clientX), comp.fps), layer ? index : 1);
    else if (effectId && layer) props.onDropEffect(effectId, layer.sourceId);
    else if (layerIds) {
      try {
        const ids = JSON.parse(layerIds) as string[];
        if (Array.isArray(ids)) props.onReorder(ids, index);
      } catch {
        /* ignore malformed drag data */
      }
    }
  };

  // -------------------------------------------------------------- render helpers

  const keyMenu = (e: React.MouseEvent, ref: KeyRef) => {
    e.preventDefault();
    const id = keyRefId(ref);
    if (!selectedKeySet.has(id)) props.onSelectKeys([id], false);
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { id: 'ease.easy', label: 'Easy Ease', shortcut: 'F9' },
        { id: 'ease.in', label: 'Easy Ease In', shortcut: '⇧ F9' },
        { id: 'ease.out', label: 'Easy Ease Out', shortcut: '⇧⌘ F9' },
        { id: 'sep1', label: '', separator: true },
        { id: 'ease.linear', label: 'Linear' },
        { id: 'ease.hold', label: 'Halten umschalten', shortcut: '⌥⌘ H' },
        { id: 'sep2', label: '', separator: true },
        { id: 'edit.delete', label: 'Keyframe löschen', shortcut: '⌫' },
      ],
      onPick: (cmd) => props.run(cmd),
    });
  };

  const labelMenu = (e: React.MouseEvent, layer: AeLayer) => {
    e.stopPropagation();
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: LABEL_COLORS.map((c) => ({ id: c.color, label: `● ${c.name}`, checked: layerColor(layer) === c.color })),
      onPick: (color) => props.commit(setLayerLabel(props.comp, layer.sourceId, color), 'Beschriftung ändern'),
    });
  };

  const propValue = (row: Extract<Row, { kind: 'prop' }>) => {
    const { layer, prop } = row;
    const display = toDisplay(prop, propValueAt(layer.transform, prop, time), comp);
    const aid = `ae.tl.layer.${layer.index}.${prop}`;
    const common = { disabled: layer.locked };
    if (prop === 'position' || prop === 'anchor')
      return (
        <>
          <ScrubNumber {...common} value={display[0]} digits={1} automationId={`${aid}.x`} onChange={(v, ph) => editProp(layer, prop, [v, display[1]], ph)} />
          <span className="aev-dim">,</span>
          <ScrubNumber {...common} value={display[1]} digits={1} automationId={`${aid}.y`} onChange={(v, ph) => editProp(layer, prop, [display[0], v], ph)} />
        </>
      );
    if (prop === 'scale')
      return (
        <>
          <span className="aev-link-icon" title="Proportional (nur einheitliche Skalierung)">⛓</span>
          <ScrubNumber {...common} value={display[0]} step={0.5} digits={1} automationId={`${aid}.x`} onChange={(v, ph) => editProp(layer, prop, [v], ph)} />
          <span className="aev-dim">,</span>
          <ScrubNumber {...common} value={display[0]} step={0.5} digits={1} suffix=" %" automationId={`${aid}.y`} onChange={(v, ph) => editProp(layer, prop, [v], ph)} />
        </>
      );
    if (prop === 'rotation') return <ScrubNumber {...common} value={display[0]} step={0.5} format={formatRotation} automationId={aid} onChange={(v, ph) => editProp(layer, prop, [v], ph)} />;
    return <ScrubNumber {...common} value={display[0]} step={0.5} min={0} max={100} digits={0} suffix=" %" automationId={aid} onChange={(v, ph) => editProp(layer, prop, [v], ph)} />;
  };

  const renderLeft = (row: Row) => {
    const layer = row.layer;
    const indent = (depth: number) => ({ paddingLeft: 54 + 18 + depth * 16 });
    switch (row.kind) {
      case 'layer': {
        const sel = selectedIds.includes(layer.sourceId);
        const aid = `ae.tl.layer.${layer.index}`;
        return (
          <>
            <span className="aev-sw">
              <button type="button" className={`aev-sw-btn${layer.visible ? ' is-on' : ''}`} title="Video (Ebene ein-/ausblenden)" data-automation-id={`${aid}.visible`} onClick={(e) => { e.stopPropagation(); props.commit(setLayerSwitch(props.comp, layer.sourceId, 'visible', !layer.visible), 'Sichtbarkeit'); }}>
                {layer.visible ? <Eye size={12} /> : null}
              </button>
              <button type="button" className={`aev-sw-btn${layer.solo ? ' is-on' : ''}`} title="Solo" data-automation-id={`${aid}.solo`} onClick={(e) => { e.stopPropagation(); props.commit(setLayerSwitch(props.comp, layer.sourceId, 'solo', !layer.solo), 'Solo'); }}>
                {layer.solo ? <SoloIcon /> : null}
              </button>
              <button type="button" className={`aev-sw-btn${layer.locked ? ' is-on' : ''}`} title="Sperren" data-automation-id={`${aid}.lock`} onClick={(e) => { e.stopPropagation(); props.commit(setLayerSwitch(props.comp, layer.sourceId, 'lock', !layer.locked), 'Sperren'); }}>
                {layer.locked ? <Lock size={11} /> : null}
              </button>
            </span>
            <button type="button" className="aev-twirl" data-automation-id={`${aid}.twirl`} onClick={(e) => { e.stopPropagation(); props.setUi({ expanded: { ...ui.expanded, [layer.sourceId]: !isOpen(layer.sourceId) }, reveal: { ...ui.reveal, [layer.sourceId]: [] } }); }}>
              {isOpen(layer.sourceId) ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <button type="button" className="aev-label" style={{ background: layerColor(layer) }} title="Beschriftung" data-automation-id={`${aid}.label`} onClick={(e) => labelMenu(e, layer)} />
            <span className="aev-col-nr">{layer.index}</span>
            <span
              className={`aev-col-name${sel ? ' is-sel' : ''}`}
              draggable={!layer.locked}
              data-automation-id={`${aid}.name`}
              onDragStart={(e) => {
                const ids = sel ? selectedIds : [layer.sourceId];
                e.dataTransfer.setData('application/x-ae-layer', JSON.stringify(ids));
                e.dataTransfer.effectAllowed = 'move';
              }}
              onDoubleClick={(e) => { e.stopPropagation(); setRename({ id: layer.sourceId, value: layer.source.name }); }}
            >
              <span className="aev-type-glyph" aria-hidden>{layer.source.type === 'text' ? 'T' : layer.source.type === 'solid' ? '■' : '▶'}</span>
              {rename?.id === layer.sourceId ? (
                <input
                  className="aev-rename"
                  autoFocus
                  value={rename.value}
                  data-automation-id={`${aid}.rename`}
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => setRename({ id: layer.sourceId, value: e.target.value })}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    if (e.key === 'Escape') setRename(null);
                  }}
                  onBlur={() => {
                    if (rename) props.commit(renameLayer(props.comp, layer.sourceId, rename.value), 'Ebene umbenennen');
                    setRename(null);
                  }}
                />
              ) : (
                <span className="aev-ellipsis">{layer.source.name}</span>
              )}
            </span>
            <span className="aev-col-switch">
              {layer.fxNodes.length > 0 && (
                <button type="button" className={`aev-fx-btn${layer.fxEnabled ? ' is-on' : ''}`} title="Effekte ein/aus" data-automation-id={`${aid}.fx`} onClick={(e) => { e.stopPropagation(); props.commit(setLayerSwitch(props.comp, layer.sourceId, 'fx', !layer.fxEnabled), 'Effekte umschalten'); }}>
                  fx
                </button>
              )}
            </span>
            <span className="aev-col-mode">
              <select
                className="aev-select aev-select-sm"
                value={layer.blend}
                disabled={layer.locked}
                data-automation-id={`${aid}.mode`}
                onClick={(e) => e.stopPropagation()}
                onChange={(e) => props.commit(setLayerBlend(props.comp, layer.sourceId, e.target.value as CompBlendMode), 'Ebenenmodus')}
              >
                {(Object.keys(BLEND_LABELS) as CompBlendMode[]).map((b) => (
                  <option key={b} value={b}>
                    {BLEND_LABELS[b]}
                  </option>
                ))}
              </select>
            </span>
            {ui.showParentColumn && (
              <span className="aev-col-parent">
                <select className="aev-select aev-select-sm" disabled value="none" title="Übergeordnete Ebenen werden noch nicht unterstützt" data-automation-id={`${aid}.parent`}>
                  <option value="none">Ohne</option>
                </select>
              </span>
            )}
          </>
        );
      }
      case 'group':
        return (
          <span className="aev-prop-left" style={indent(row.depth)}>
            <button type="button" className="aev-twirl" data-automation-id={`ae.tl.layer.${layer.index}.group.${row.key.split(':')[1]}`} onClick={() => toggle(row.key)}>
              {row.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <span className="aev-group-label">{row.label}</span>
            {row.reset && (
              <button
                type="button"
                className="aev-link"
                data-automation-id={`ae.tl.layer.${layer.index}.reset`}
                onClick={() =>
                  withTransform(layer, (node) => ({ ...node, keyframes: undefined, params: { ...node.params, x: 0, y: 0, scale: 1, rotation: 0, anchorX: 0, anchorY: 0, opacity: 1 } }), 'Transformation zurücksetzen')
                }
              >
                Zurück
              </button>
            )}
          </span>
        );
      case 'prop': {
        const animated = isPropAnimated(layer.transform, row.prop);
        const times = propKeyframeTimes(layer.transform, row.prop);
        const onKey = times.some((t) => Math.abs(t - time) < 1e-6);
        const aid = `ae.tl.layer.${layer.index}.${row.prop}`;
        return (
          <span className="aev-prop-left" style={indent(row.depth)}>
            <span className="aev-kfnav">
              {animated && (
                <>
                  <button type="button" title="Zum vorherigen Keyframe" data-automation-id={`${aid}.prevKey`} disabled={adjacentTime(times, time, -1) === null} onClick={() => { const t = adjacentTime(times, time, -1); if (t !== null) props.onTimeChange(t); }}>
                    ‹
                  </button>
                  <button type="button" title="Keyframe hinzufügen/entfernen" data-automation-id={`${aid}.toggleKey`} onClick={() => withTransform(layer, (node) => toggleKeyframeAt(node, row.prop, snapToFrame(time, comp.fps)), 'Keyframe')}>
                    <KeyGlyph shape="linear" selected={onKey} size={9} />
                  </button>
                  <button type="button" title="Zum nächsten Keyframe" data-automation-id={`${aid}.nextKey`} disabled={adjacentTime(times, time, 1) === null} onClick={() => { const t = adjacentTime(times, time, 1); if (t !== null) props.onTimeChange(t); }}>
                    ›
                  </button>
                </>
              )}
            </span>
            <button type="button" className={`aev-stopwatch${animated ? ' is-on' : ''}`} title="Stoppuhr (Zeitabhängige Änderung)" data-automation-id={`${aid}.stopwatch`} onClick={() => withTransform(layer, (node) => toggleStopwatch(node, row.prop, snapToFrame(time, comp.fps)), 'Stoppuhr')}>
              <StopwatchIcon on={animated} />
            </button>
            <span className="aev-prop-label">{propDef(row.prop).label}</span>
            <span className="aev-prop-values">{propValue(row)}</span>
          </span>
        );
      }
      case 'fx': {
        const def = getFxDefinition(row.inst.effectId);
        return (
          <span className="aev-prop-left" style={indent(2)}>
            <button type="button" className="aev-twirl" data-automation-id={`ae.tl.layer.${layer.index}.fx.${row.inst.id}.twirl`} onClick={() => toggle(row.key)}>
              {row.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <span className={`aev-group-label${row.inst.enabled ? '' : ' is-off'}`}>{def?.name ?? row.inst.effectId}</span>
            <button
              type="button"
              className={`aev-fx-btn${row.inst.enabled ? ' is-on' : ''}`}
              title="Effekt ein/aus"
              data-automation-id={`ae.tl.layer.${layer.index}.fx.${row.inst.id}.enabled`}
              onClick={() => {
                const node = getNode(props.comp, row.node.id);
                if (node) props.commit(replaceNode(props.comp, { ...node, fxStack: (node.fxStack ?? []).map((f) => (f.id === row.inst.id ? { ...f, enabled: !f.enabled } : f)) }), 'Effekt umschalten');
              }}
            >
              fx
            </button>
          </span>
        );
      }
      case 'fxparam': {
        const value = row.inst.params[row.param.id] ?? row.param.default;
        const aid = `ae.tl.layer.${layer.index}.fx.${row.inst.id}.${row.param.id}`;
        let control: React.ReactNode = null;
        if (row.param.type === 'float' || row.param.type === 'int') {
          const p = row.param;
          const span = (p.type === 'float' ? (p.displayMax ?? p.max) - (p.displayMin ?? p.min) : p.max - p.min) || 1;
          control = <ScrubNumber value={Number(value)} min={p.min} max={p.max} step={p.type === 'int' ? 1 : span / 200} digits={p.type === 'int' ? 0 : span >= 100 ? 0 : 2} automationId={aid} onChange={(v, ph) => setFxParam(row.node, row.inst, p.id, p.type === 'int' ? Math.round(v) : v, ph)} />;
        } else if (row.param.type === 'bool') {
          control = <input type="checkbox" checked={Boolean(value)} data-automation-id={aid} onChange={(e) => setFxParam(row.node, row.inst, row.param.id, e.target.checked, 'set')} />;
        } else if (row.param.type === 'choice') {
          const p = row.param;
          control = (
            <select className="aev-select aev-select-sm" value={String(value)} data-automation-id={aid} onChange={(e) => setFxParam(row.node, row.inst, p.id, Number(e.target.value), 'set')}>
              {p.options.map((label, index) => (
                <option key={index} value={String(index)}>
                  {label}
                </option>
              ))}
            </select>
          );
        }
        return (
          <span className="aev-prop-left" style={indent(3)}>
            <span className="aev-prop-label">{row.param.label}</span>
            <span className="aev-prop-values">{control}</span>
          </span>
        );
      }
      case 'mask': {
        const p = row.node.params;
        return (
          <span className="aev-prop-left" style={indent(2)}>
            <button type="button" className="aev-twirl" data-automation-id={`ae.tl.layer.${layer.index}.mask.${row.node.id}.twirl`} onClick={() => toggle(row.key)}>
              {row.open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </button>
            <span className="aev-mask-swatch" />
            <span className="aev-group-label">{row.node.name}</span>
            <label className="aev-check" title="Umgekehrt">
              <input type="checkbox" checked={p.invert === true} data-automation-id={`ae.tl.layer.${layer.index}.mask.${row.node.id}.invert`} onChange={(e) => setMaskParams(row.node, { invert: e.target.checked }, 'set')} /> Umgekehrt
            </label>
          </span>
        );
      }
      case 'maskparam': {
        const p = paramsAt(row.node, time);
        const aid = `ae.tl.layer.${layer.index}.mask.${row.node.id}.${row.param}`;
        if (row.param === 'feather') {
          const px = Number(p.feather ?? 0) * Math.max(comp.width, comp.height);
          return (
            <span className="aev-prop-left" style={indent(3)}>
              <span className="aev-prop-label">Weiche Maskenkante</span>
              <span className="aev-prop-values">
                <ScrubNumber value={px} min={0} digits={1} suffix=" px" automationId={aid} onChange={(v, ph) => setMaskParams(row.node, { feather: v / Math.max(comp.width, comp.height) }, ph)} />
              </span>
            </span>
          );
        }
        const W = comp.width;
        const H = comp.height;
        const vals = [Number(p.cx ?? 0.5) * W, Number(p.cy ?? 0.5) * H, Number(p.w ?? 0.5) * W, Number(p.h ?? 0.5) * H];
        const set = (i: number, v: number, ph: 'start' | 'move' | 'end' | 'set') => {
          const keys = ['cx', 'cy', 'w', 'h'];
          const scaleBy = i % 2 === 0 ? W : H;
          setMaskParams(row.node, { [keys[i]]: i >= 2 ? Math.max(1, v) / scaleBy : v / scaleBy }, ph);
        };
        return (
          <span className="aev-prop-left" style={indent(3)}>
            <span className="aev-prop-label">Maskenpfad</span>
            <span className="aev-prop-values">
              {vals.map((v, i) => (
                <ScrubNumber key={i} value={v} digits={0} title={['Mitte X', 'Mitte Y', 'Breite', 'Höhe'][i]} automationId={`${aid}.${i}`} onChange={(nv, ph) => set(i, nv, ph)} />
              ))}
            </span>
          </span>
        );
      }
    }
  };

  const renderRight = (row: Row) => {
    if (row.kind === 'layer') {
      const layer = row.layer;
      const color = layerColor(layer);
      const sel = selectedIds.includes(layer.sourceId);
      return (
        <div
          className={`aev-bar${sel ? ' is-sel' : ''}${layer.visible ? '' : ' is-hidden'}${layer.locked ? ' is-locked' : ''}`}
          style={{ left: layer.inPoint * pps, width: Math.max(2, (layer.outPoint - layer.inPoint) * pps), ['--bar' as string]: color }}
          data-automation-id={`ae.tl.layer.${layer.index}.bar`}
          onPointerDown={(e) => startBar(e, layer, 'move')}
        >
          <span className="aev-bar-trim is-in" data-automation-id={`ae.tl.layer.${layer.index}.trimIn`} onPointerDown={(e) => startBar(e, layer, 'in')} />
          <span className="aev-bar-trim is-out" data-automation-id={`ae.tl.layer.${layer.index}.trimOut`} onPointerDown={(e) => startBar(e, layer, 'out')} />
        </div>
      );
    }
    if (row.kind === 'prop' && row.layer.transform) {
      const node = row.layer.transform;
      return propKeyframeTimes(node, row.prop).map((t) => {
        const ref = { nodeId: node.id, prop: row.prop, time: t };
        const id = keyRefId(ref);
        return (
          <span
            key={id}
            className="aev-key"
            style={{ left: t * pps }}
            title={formatTimecode(t, comp.fps)}
            data-automation-id={`ae.tl.layer.${row.layer.index}.${row.prop}.key.${Math.round(t * comp.fps)}`}
            onPointerDown={(e) => startKey(e, ref)}
            onDoubleClick={() => props.onTimeChange(t)}
            onContextMenu={(e) => keyMenu(e, ref)}
          >
            <KeyGlyph shape={keyframeShape(node, row.prop, t)} selected={selectedKeySet.has(id)} />
          </span>
        );
      });
    }
    return null;
  };

  // -------------------------------------------------------------- ruler

  const step = niceStep(pps);
  const ticks: number[] = [];
  for (let t = 0; t <= comp.durationSeconds + 1e-6 && ticks.length < 2000; t += step) ticks.push(t);
  const label = (t: number) => (step < 1 ? `${Math.floor(t)}:${String(Math.round((t % 1) * comp.fps)).padStart(2, '0')}f` : t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Math.round(t)}s`);
  const wa = props.workArea;

  return (
    <div className="aev-timeline" data-automation-id="ae.timeline">
      <div className="aev-panel-head">
        <span className="aev-panel-title">{comp.name}</span>
        <span className="aev-dim">Zeitleiste</span>
      </div>
      <div className="aev-tl-top">
        <div className="aev-tl-tc" style={{ width: left }}>
          {tcEdit !== null ? (
            <input
              className="aev-tc-input"
              autoFocus
              value={tcEdit}
              data-automation-id="ae.tl.timecode.input"
              onChange={(e) => setTcEdit(e.target.value)}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                if (e.key === 'Escape') setTcEdit(null);
              }}
              onBlur={() => {
                const t = parseTimecode(tcEdit ?? '', comp.fps);
                if (t !== null) props.onTimeChange(Math.min(comp.durationSeconds, t));
                setTcEdit(null);
              }}
            />
          ) : (
            <button type="button" className="aev-tc" title="Aktuelle Zeit (klicken zum Eingeben)" data-automation-id="ae.tl.timecode" onClick={() => setTcEdit(formatTimecode(time, comp.fps))}>
              {formatTimecode(time, comp.fps)}
            </button>
          )}
          <span className="aev-dim aev-tc-frames">
            {String(Math.round(time * comp.fps)).padStart(5, '0')} ({comp.fps.toFixed(2).replace('.', ',')} fps)
          </span>
          <span className="aev-spacer" />
          <button type="button" className={`aev-chip${ui.showParentColumn ? ' is-on' : ''}`} data-automation-id="ae.tl.parentColumn" onClick={() => props.setUi({ showParentColumn: !ui.showParentColumn })} title="Spalte „Übergeordnet“ ein/aus">
            Übergeordnet
          </button>
        </div>
      </div>
      <div className="aev-tl-scroll" ref={scrollRef} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onDragOver={onRowDragOver} onDrop={(e) => onRowDrop(e, null)}>
        <div className="aev-tl-grid" style={{ width: left + width + 40, ['--left' as string]: `${left}px` }}>
          <div className="aev-tl-row aev-tl-head">
            <div className="aev-tl-left aev-tl-colheads" style={{ width: left }}>
              <span className="aev-sw aev-colhead" title="Video / Solo / Sperren">
                <Eye size={11} />
                <SoloIcon />
                <Lock size={10} />
              </span>
              <span className="aev-twirl-space" />
              <span className="aev-label-space" />
              <span className="aev-col-nr aev-colhead">Nr.</span>
              <span className="aev-col-name aev-colhead">Quellenname</span>
              <span className="aev-col-switch aev-colhead">fx</span>
              <span className="aev-col-mode aev-colhead">Modus</span>
              {ui.showParentColumn && <span className="aev-col-parent aev-colhead">Übergeordnet</span>}
            </div>
            <div className="aev-tl-right aev-ruler" style={{ width }} onPointerDown={startScrub} data-automation-id="ae.tl.ruler">
              <div className="aev-workarea" style={{ left: wa.start * pps, width: Math.max(2, (wa.end - wa.start) * pps) }} onPointerDown={(e) => startWorkArea(e, 'move')} data-automation-id="ae.tl.workArea">
                <span className="aev-wa-handle is-start" onPointerDown={(e) => startWorkArea(e, 'start')} data-automation-id="ae.tl.workArea.start" />
                <span className="aev-wa-handle is-end" onPointerDown={(e) => startWorkArea(e, 'end')} data-automation-id="ae.tl.workArea.end" />
              </div>
              {ticks.map((t) => (
                <span key={t} className="aev-tick" style={{ left: t * pps }}>
                  <span className="aev-tick-label">{label(t)}</span>
                </span>
              ))}
              <span className="aev-cti-head" style={{ left: time * pps }} />
            </div>
          </div>
          {rows.map((row, i) => {
            const layer = row.layer;
            const sel = row.kind === 'layer' && selectedIds.includes(layer.sourceId);
            const key = row.kind === 'layer' ? layer.sourceId : `${layer.sourceId}-${row.kind}-${i}`;
            return (
              <div
                key={key}
                className={`aev-tl-row${row.kind === 'layer' ? ' is-layer' : ' is-prop'}${sel ? ' is-sel' : ''}`}
                style={{ height: ROW_H }}
                onDragOver={row.kind === 'layer' ? onRowDragOver : undefined}
                onDrop={row.kind === 'layer' ? (e) => onRowDrop(e, layer) : undefined}
                onPointerDown={
                  row.kind === 'layer'
                    ? (e) => {
                        if (e.button !== 0 || layer.locked) return;
                        props.onSelectLayers([layer.sourceId], e.shiftKey ? 'range' : e.metaKey || e.ctrlKey ? 'toggle' : 'replace');
                      }
                    : undefined
                }
              >
                <div className="aev-tl-left" style={{ width: left }}>
                  {renderLeft(row)}
                </div>
                <div className="aev-tl-right" style={{ width }}>
                  {renderRight(row)}
                </div>
              </div>
            );
          })}
          {!layers.length && (
            <div className="aev-tl-empty" style={{ width: left + width }}>
              Footage aus dem Projekt hierher ziehen oder Ebene › Neu › Farbfläche (⌘ Y) wählen.
            </div>
          )}
          <div className="aev-cti-line" style={{ left: left + time * pps }} />
          {wa.end < comp.durationSeconds - 1e-6 && <div className="aev-wa-shade" style={{ left: left + wa.end * pps, width: (comp.durationSeconds - wa.end) * pps }} />}
          {wa.start > 1e-6 && <div className="aev-wa-shade" style={{ left, width: wa.start * pps }} />}
        </div>
      </div>
      <div className="aev-tl-foot">
        <span className="aev-dim" data-automation-id="ae.tl.renderTime">
          Zeit für das Frame-Rendering: {Math.round(props.renderMs)} ms
        </span>
        <span className="aev-spacer" />
        <button type="button" className="aev-icon-btn" title="Auszoomen (-)" data-automation-id="ae.tl.zoomOut" onClick={() => props.run('timeline.zoomOut')}>
          −
        </button>
        <input
          type="range"
          className="aev-zoom"
          min={Math.log(5)}
          max={Math.log(2000)}
          step={0.01}
          value={Math.log(pps)}
          data-automation-id="ae.tl.zoom"
          onChange={(e) => props.setUi({ pxPerSecond: Math.exp(Number(e.target.value)) })}
        />
        <button type="button" className="aev-icon-btn" title="Einzoomen (=)" data-automation-id="ae.tl.zoomIn" onClick={() => props.run('timeline.zoomIn')}>
          +
        </button>
        <button
          type="button"
          className="aev-chip"
          data-automation-id="ae.tl.zoomFit"
          onClick={() => {
            const w = (scrollRef.current?.clientWidth ?? 800) - left - 40;
            props.setUi({ pxPerSecond: Math.max(5, w / Math.max(0.1, comp.durationSeconds)) });
          }}
        >
          Einpassen
        </button>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onPick={menu.onPick} onClose={() => setMenu(null)} automationId="ae.tl.menu" />}
    </div>
  );
}

export { ROW_H };
