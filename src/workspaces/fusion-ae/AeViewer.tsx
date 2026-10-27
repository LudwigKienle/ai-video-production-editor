/**
 * Composition panel of the After Effects view: renders the shared comp at the
 * current time (renderComposition), proxy resolution, zoom, transparency grid,
 * grid / safe-zone overlays and the direct-manipulation tools (selection,
 * hand, zoom, rotate, pan behind, mask, text).
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Composition } from '../fusion-shared/compModel.ts';
import { getNode, paramsAt } from '../fusion-shared/compModel.ts';
import type { MediaResolver } from '../fusion-shared/renderComp.ts';
import { renderComposition } from '../fusion-shared/renderComp.ts';
import type { AeLayer, AeUiState, MaskRect } from './aeOps.ts';
import { ensureTransform, formatTimecode, layerCorners, P_OFFSET, panBehind, prepareForRender, propValueAt, setPropValue, wrapResolver } from './aeOps.ts';

export type GestureApi = {
  /** Starts an undoable drag; returns the comp snapshot to derive from. */
  begin(): Composition;
  update(next: Composition): void;
  end(label: string): void;
};

export type PixelInfo = { x: number; y: number; r: number; g: number; b: number; a: number } | null;

type Props = {
  comp: Composition;
  time: number;
  playing: boolean;
  resolveMedia: MediaResolver;
  ui: AeUiState;
  setUi(patch: Partial<AeUiState>): void;
  layers: AeLayer[];
  selectedIds: string[];
  onSelectLayers(ids: string[], additive: boolean): void;
  gesture: GestureApi;
  onCreateText(pos: { x: number; y: number }): string | null;
  onTextCommit(layerId: string, text: string): void;
  onCreateMask(layerId: string, rect: MaskRect, shape: 'ellipse' | 'rectangle'): void;
  onDropMedia(mediaId: string): void;
  onDropEffect(effectId: string, layerId: string | null): void;
  onPixel(info: PixelInfo): void;
  onRenderTime(ms: number): void;
  onStatus(text: string): void;
  /** Lets the view run "Ansicht vergrößern/verkleinern" with the current fit scale. */
  registerZoom?(fn: (dir: 1 | -1) => void): void;
};

const ZOOMS = [0.125, 0.25, 0.333, 0.5, 0.666, 1, 1.5, 2, 4, 8];
/** Next zoom step in (+1) or out (-1) from the current scale. */
export const stepZoom = (scale: number, dir: 1 | -1) =>
  dir > 0 ? ZOOMS.find((z) => z > scale + 1e-3) ?? ZOOMS[ZOOMS.length - 1] : [...ZOOMS].reverse().find((z) => z < scale - 1e-3) ?? ZOOMS[0];

const RES_LABEL: Record<number, string> = { 1: 'Voll', 2: 'Halb', 3: 'Drittel', 4: 'Viertel' };

const sourceSize = (source: CanvasImageSource | null) => {
  if (!source) return null;
  const s = source as unknown as Record<string, number>;
  const width = s.videoWidth || s.naturalWidth || s.width || 0;
  const height = s.videoHeight || s.naturalHeight || s.height || 0;
  return width && height ? { width, height } : null;
};

const pointInPolygon = (pt: { x: number; y: number }, poly: { x: number; y: number }[]) => {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i, i += 1) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y || 1e-9) + a.x) inside = !inside;
  }
  return inside;
};

let measureCtx: CanvasRenderingContext2D | null = null;

export default function AeViewer(props: Props) {
  const { comp, time, ui, layers, selectedIds } = props;
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 800, h: 450 });
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [maskDraft, setMaskDraft] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [textEdit, setTextEdit] = useState<{ layerId: string; x: number; y: number; value: string } | null>(null);
  const drag = useRef<null | { kind: string; start: { x: number; y: number }; client: { x: number; y: number }; snapshot?: Composition; data?: unknown }>(null);

  const resolver = useMemo(() => wrapResolver(props.resolveMedia), [props.resolveMedia]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => setBox({ w: entry.contentRect.width, h: entry.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const fit = Math.max(0.02, Math.min((box.w - 32) / comp.width, (box.h - 32) / comp.height));
  const scale = ui.viewerZoom > 0 ? ui.viewerZoom : fit;
  const res = ui.resolution;
  const rw = Math.max(2, Math.round(comp.width / res));
  const rh = Math.max(2, Math.round(comp.height / res));

  const { registerZoom, setUi } = props;
  useEffect(() => {
    registerZoom?.((dir) => setUi({ viewerZoom: stepZoom(scale, dir) }));
  }, [registerZoom, setUi, scale]);

  // Follow-up renders catch footage that finishes loading/seeking asynchronously.
  useEffect(() => {
    if (props.playing) return;
    const timers = [150, 450, 1000, 2000].map((ms) => window.setTimeout(() => setTick((v) => v + 1), ms));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [comp, time, props.playing]);

  useEffect(() => {
    const raf = requestAnimationFrame(() => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const t0 = performance.now();
      try {
        const prepared = prepareForRender(comp, { transparent: ui.transparency });
        const out = renderComposition(prepared, time, resolver, { width: rw, height: rh });
        if (canvas.width !== rw) canvas.width = rw;
        if (canvas.height !== rh) canvas.height = rh;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, rw, rh);
          ctx.drawImage(out, 0, 0);
        }
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      props.onRenderTime(performance.now() - t0);
    });
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [comp, time, rw, rh, ui.transparency, resolver, tick]);

  const toComp = useCallback(
    (clientX: number, clientY: number) => {
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect || !rect.width) return { x: 0, y: 0 };
      return { x: ((clientX - rect.left) / rect.width) * comp.width, y: ((clientY - rect.top) / rect.height) * comp.height };
    },
    [comp.width, comp.height],
  );

  /** Layer-space rect of the source (footage fit, text box, full frame). */
  const sourceRect = useCallback(
    (layer: AeLayer) => {
      const full = { x: 0, y: 0, w: comp.width, h: comp.height };
      const src = layer.source;
      if (src.type === 'media' && src.mediaId) {
        let size: { width: number; height: number } | null = null;
        try {
          size = sourceSize(props.resolveMedia(src.mediaId, Math.max(0, time - layer.inPoint + Number(src.params[P_OFFSET] ?? 0))));
        } catch {
          size = null;
        }
        if (!size) return full;
        const f = Math.min(comp.width / size.width, comp.height / size.height);
        const w = size.width * f;
        const h = size.height * f;
        return { x: (comp.width - w) / 2, y: (comp.height - h) / 2, w, h };
      }
      if (src.type === 'text') {
        const p = paramsAt(src, time);
        const size = Number(p.size) || 96;
        if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
        let w = String(p.text ?? '').length * size * 0.55;
        if (measureCtx) {
          measureCtx.font = `${size}px ${String(p.font ?? 'sans-serif')}`;
          w = measureCtx.measureText(String(p.text ?? '')).width;
        }
        const h = size * 1.15;
        return { x: (comp.width - w) / 2, y: (comp.height - h) / 2, w: Math.max(8, w), h };
      }
      return full;
    },
    [comp.width, comp.height, props.resolveMedia, time],
  );

  const quads = useMemo(
    () =>
      layers.map((layer) => {
        const params = layer.transform ? paramsAt(layer.transform, time) : {};
        return { layer, poly: layerCorners(params, comp, sourceRect(layer)), anchor: { x: comp.width / 2 + Number(params.x ?? 0), y: comp.height / 2 + Number(params.y ?? 0) } };
      }),
    [layers, time, comp, sourceRect],
  );

  const hitTest = (pt: { x: number; y: number }) =>
    quads.find(({ layer, poly }) => layer.visible && !layer.locked && time >= layer.inPoint && time < layer.outPoint && pointInPolygon(pt, poly))?.layer ?? null;

  const withTransforms = (snapshot: Composition, ids: string[]) => {
    let next = snapshot;
    for (const id of ids) next = ensureTransform(next, id).comp;
    return next;
  };

  const transformOf = (c: Composition, layerId: string) => {
    const t = ensureTransform(c, layerId);
    return t.transformId ? getNode(t.comp, t.transformId) ?? null : null;
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    const pt = toComp(e.clientX, e.clientY);
    const client = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const tool = ui.tool;
    if (tool === 'hand') {
      drag.current = { kind: 'pan', start: pt, client, data: { ...pan } };
      return;
    }
    if (tool === 'zoom') {
      props.setUi({ viewerZoom: stepZoom(scale, e.altKey ? -1 : 1) });
      return;
    }
    if (tool === 'text') {
      // Keep the browser from moving focus to the panel after the inline editor mounted.
      e.preventDefault();
      const position = { x: pt.x - comp.width / 2, y: pt.y - comp.height / 2 };
      const id = props.onCreateText(position);
      if (id) setTextEdit({ layerId: id, x: client.x, y: client.y, value: '' });
      return;
    }
    if (tool === 'mask') {
      drag.current = { kind: 'mask', start: pt, client };
      setMaskDraft({ x0: pt.x, y0: pt.y, x1: pt.x, y1: pt.y });
      return;
    }
    const hit = hitTest(pt);
    let ids = selectedIds;
    if (tool === 'selection') {
      if (!hit) {
        if (!e.shiftKey) props.onSelectLayers([], false);
        return;
      }
      if (!selectedIds.includes(hit.sourceId) || e.shiftKey) {
        props.onSelectLayers([hit.sourceId], e.shiftKey);
        ids = e.shiftKey ? [...selectedIds, hit.sourceId] : [hit.sourceId];
      }
    } else if (hit && !selectedIds.includes(hit.sourceId)) {
      props.onSelectLayers([hit.sourceId], false);
      ids = [hit.sourceId];
    }
    ids = ids.filter((id) => !layers.find((l) => l.sourceId === id)?.locked);
    if (!ids.length) return;
    const snapshot = withTransforms(props.gesture.begin(), ids);
    if (tool === 'selection') {
      const start = ids.map((id) => ({ id, pos: propValueAt(transformOf(snapshot, id), 'position', time) }));
      drag.current = { kind: 'move', start: pt, client, snapshot, data: start };
    } else if (tool === 'rotate') {
      const id = ids[0];
      const tr = transformOf(snapshot, id);
      const p = tr ? paramsAt(tr, time) : {};
      const center = { x: comp.width / 2 + Number(p.x ?? 0), y: comp.height / 2 + Number(p.y ?? 0) };
      drag.current = { kind: 'rotate', start: pt, client, snapshot, data: { id, center, r0: Number(p.rotation ?? 0), a0: Math.atan2(pt.y - center.y, pt.x - center.x) } };
    } else if (tool === 'anchor') {
      drag.current = { kind: 'anchor', start: pt, client, snapshot, data: { id: ids[0] } };
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const pt = toComp(e.clientX, e.clientY);
    // Info panel: pixel under the cursor.
    const canvas = canvasRef.current;
    if (canvas && pt.x >= 0 && pt.y >= 0 && pt.x < comp.width && pt.y < comp.height) {
      try {
        const data = canvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings)?.getImageData(Math.floor(pt.x / res), Math.floor(pt.y / res), 1, 1).data;
        if (data) props.onPixel({ x: Math.round(pt.x), y: Math.round(pt.y), r: data[0], g: data[1], b: data[2], a: data[3] });
      } catch {
        props.onPixel(null);
      }
    }
    const d = drag.current;
    if (!d) return;
    const dx = pt.x - d.start.x;
    const dy = pt.y - d.start.y;
    if (d.kind === 'pan') {
      const p0 = d.data as { x: number; y: number };
      setPan({ x: p0.x + e.clientX - d.client.x, y: p0.y + e.clientY - d.client.y });
      return;
    }
    if (d.kind === 'mask') {
      setMaskDraft({ x0: d.start.x, y0: d.start.y, x1: pt.x, y1: pt.y });
      return;
    }
    const snapshot = d.snapshot!;
    let next = snapshot;
    if (d.kind === 'move') {
      for (const item of d.data as { id: string; pos: number[] }[]) {
        const tr = transformOf(next, item.id);
        if (!tr) continue;
        const ddx = e.shiftKey && Math.abs(dx) < Math.abs(dy) ? 0 : dx;
        const ddy = e.shiftKey && Math.abs(dy) <= Math.abs(dx) ? 0 : dy;
        next = { ...next, nodes: next.nodes.map((n) => (n.id === tr.id ? setPropValue(tr, 'position', [item.pos[0] + ddx, item.pos[1] + ddy], time) : n)) };
      }
    } else if (d.kind === 'rotate') {
      const info = d.data as { id: string; center: { x: number; y: number }; r0: number; a0: number };
      const tr = transformOf(next, info.id);
      if (tr) {
        let deg = info.r0 + ((Math.atan2(pt.y - info.center.y, pt.x - info.center.x) - info.a0) * 180) / Math.PI;
        if (e.shiftKey) deg = Math.round(deg / 45) * 45;
        next = { ...next, nodes: next.nodes.map((n) => (n.id === tr.id ? setPropValue(tr, 'rotation', [deg], time) : n)) };
      }
    } else if (d.kind === 'anchor') {
      const info = d.data as { id: string };
      const tr = transformOf(next, info.id);
      if (tr) {
        const moved = panBehind(paramsAt(tr, time), dx, dy);
        let node = setPropValue(tr, 'position', [moved.x, moved.y], time);
        node = setPropValue(node, 'anchor', [moved.anchorX, moved.anchorY], time);
        next = { ...next, nodes: next.nodes.map((n) => (n.id === tr.id ? node : n)) };
      }
    }
    props.gesture.update(next);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (d.kind === 'mask') {
      const draft = maskDraft;
      setMaskDraft(null);
      if (!draft) return;
      const w = Math.abs(draft.x1 - draft.x0);
      const h = Math.abs(draft.y1 - draft.y0);
      if (w < 4 || h < 4) return;
      const target = selectedIds.find((id) => !layers.find((l) => l.sourceId === id)?.locked) ?? null;
      if (!target) {
        props.onStatus('Maske: zuerst eine Ebene auswählen (Formebenen sind nicht verfügbar).');
        return;
      }
      props.onCreateMask(
        target,
        { cx: (draft.x0 + draft.x1) / 2 / comp.width, cy: (draft.y0 + draft.y1) / 2 / comp.height, w: w / comp.width, h: h / comp.height },
        ui.maskShape,
      );
      return;
    }
    if (d.kind === 'move') props.gesture.end('Ebene verschieben');
    if (d.kind === 'rotate') props.gesture.end('Ebene drehen');
    if (d.kind === 'anchor') props.gesture.end('Ankerpunkt verschieben');
  };

  const onDrop = (e: React.DragEvent) => {
    const mediaId = e.dataTransfer.getData('application/x-avpe-media-id');
    const effectId = e.dataTransfer.getData('application/x-ae-effect');
    if (!mediaId && !effectId) return;
    e.preventDefault();
    if (mediaId) props.onDropMedia(mediaId);
    else {
      const hit = hitTest(toComp(e.clientX, e.clientY));
      props.onDropEffect(effectId, hit?.sourceId ?? selectedIds[0] ?? null);
    }
  };

  const selected = quads.filter((q) => selectedIds.includes(q.layer.sourceId));
  const stroke = 2 / scale;
  const W = comp.width;
  const H = comp.height;
  const cursor = { selection: 'default', hand: 'grab', zoom: 'zoom-in', rotate: 'crosshair', anchor: 'move', mask: 'crosshair', text: 'text' }[ui.tool];
  const zoomValue = ui.viewerZoom > 0 ? String(ui.viewerZoom) : '0';

  return (
    <div className="aev-viewer" data-automation-id="ae.viewer">
      <div className="aev-panel-head">
        <span className="aev-panel-title">Komposition: {comp.name}</span>
        {error && <span className="aev-error" data-automation-id="ae.viewer.error">Renderfehler: {error}</span>}
      </div>
      <div
        className="aev-viewer-area"
        ref={wrapRef}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes('application/x-avpe-media-id') || e.dataTransfer.types.includes('application/x-ae-effect')) e.preventDefault();
        }}
        onDrop={onDrop}
        onWheel={(e) => {
          if (!e.altKey && !e.ctrlKey) {
            setPan((p) => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }));
            return;
          }
          const next = Math.min(8, Math.max(0.05, scale * (e.deltaY < 0 ? 1.1 : 1 / 1.1)));
          props.setUi({ viewerZoom: next });
        }}
      >
        <div
          ref={stageRef}
          className={`aev-stage${ui.transparency ? ' is-checker' : ''}`}
          style={{ width: W * scale, height: H * scale, transform: `translate(calc(-50% + ${pan.x}px), calc(-50% + ${pan.y}px))`, cursor }}
          data-automation-id="ae.viewer.stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerLeave={() => props.onPixel(null)}
        >
          <canvas ref={canvasRef} className="aev-canvas" width={rw} height={rh} data-automation-id="ae.viewer.canvas" />
          <svg className="aev-overlay" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
            {ui.showGrid &&
              Array.from({ length: 15 }, (_, i) => (
                <g key={i} stroke="rgb(255 255 255 / 0.22)" strokeWidth={1 / scale}>
                  <line x1={((i + 1) * W) / 16} y1={0} x2={((i + 1) * W) / 16} y2={H} />
                  {i < 8 && <line x1={0} y1={((i + 1) * H) / 9} x2={W} y2={((i + 1) * H) / 9} />}
                </g>
              ))}
            {ui.showSafe && (
              <g fill="none" stroke="rgb(120 200 255 / 0.7)" strokeWidth={1 / scale}>
                <rect x={W * 0.05} y={H * 0.05} width={W * 0.9} height={H * 0.9} />
                <rect x={W * 0.1} y={H * 0.1} width={W * 0.8} height={H * 0.8} />
                <line x1={W / 2 - 20} y1={H / 2} x2={W / 2 + 20} y2={H / 2} />
                <line x1={W / 2} y1={H / 2 - 20} x2={W / 2} y2={H / 2 + 20} />
              </g>
            )}
            {selected.map(({ layer, poly, anchor }) => {
              const color = layer.source.color || 'var(--aev-accent)';
              return (
                <g key={layer.sourceId}>
                  <polygon points={poly.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={color} strokeWidth={stroke} />
                  {poly.map((p, i) => (
                    <rect key={i} x={p.x - 4 / scale} y={p.y - 4 / scale} width={8 / scale} height={8 / scale} fill={color} />
                  ))}
                  {layer.maskNodes.map((mask) => {
                    const mp = paramsAt(mask, time);
                    const cx = Number(mp.cx ?? 0.5) * W;
                    const cy = Number(mp.cy ?? 0.5) * H;
                    const w = Number(mp.w ?? 0.5) * W;
                    const h = Number(mp.h ?? 0.5) * H;
                    return mp.shape === 'rectangle' ? (
                      <rect key={mask.id} x={cx - w / 2} y={cy - h / 2} width={w} height={h} fill="none" stroke="#e6d35a" strokeWidth={stroke} strokeDasharray={`${6 / scale} ${3 / scale}`} />
                    ) : (
                      <ellipse key={mask.id} cx={cx} cy={cy} rx={w / 2} ry={h / 2} fill="none" stroke="#e6d35a" strokeWidth={stroke} strokeDasharray={`${6 / scale} ${3 / scale}`} />
                    );
                  })}
                  <g stroke="#fff" strokeWidth={stroke} fill="none">
                    <circle cx={anchor.x} cy={anchor.y} r={7 / scale} />
                    <line x1={anchor.x - 12 / scale} y1={anchor.y} x2={anchor.x + 12 / scale} y2={anchor.y} />
                    <line x1={anchor.x} y1={anchor.y - 12 / scale} x2={anchor.x} y2={anchor.y + 12 / scale} />
                  </g>
                </g>
              );
            })}
            {maskDraft &&
              (ui.maskShape === 'rectangle' ? (
                <rect
                  x={Math.min(maskDraft.x0, maskDraft.x1)}
                  y={Math.min(maskDraft.y0, maskDraft.y1)}
                  width={Math.abs(maskDraft.x1 - maskDraft.x0)}
                  height={Math.abs(maskDraft.y1 - maskDraft.y0)}
                  fill="rgb(230 211 90 / 0.08)"
                  stroke="#e6d35a"
                  strokeWidth={stroke}
                />
              ) : (
                <ellipse
                  cx={(maskDraft.x0 + maskDraft.x1) / 2}
                  cy={(maskDraft.y0 + maskDraft.y1) / 2}
                  rx={Math.abs(maskDraft.x1 - maskDraft.x0) / 2}
                  ry={Math.abs(maskDraft.y1 - maskDraft.y0) / 2}
                  fill="rgb(230 211 90 / 0.08)"
                  stroke="#e6d35a"
                  strokeWidth={stroke}
                />
              ))}
          </svg>
        </div>
        {textEdit && (
          <input
            className="aev-text-edit"
            ref={(el) => {
              if (el && document.activeElement !== el) window.setTimeout(() => el.focus(), 0);
            }}
            placeholder="Text eingeben, Eingabe bestätigt"
            style={{ left: textEdit.x - (wrapRef.current?.getBoundingClientRect().left ?? 0), top: textEdit.y - (wrapRef.current?.getBoundingClientRect().top ?? 0) }}
            value={textEdit.value}
            data-automation-id="ae.viewer.textEdit"
            onChange={(e) => setTextEdit({ ...textEdit, value: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur();
            }}
            onBlur={() => {
              if (textEdit.value.trim()) props.onTextCommit(textEdit.layerId, textEdit.value.trim());
              setTextEdit(null);
            }}
          />
        )}
      </div>
      <div className="aev-viewer-bar">
        <select
          className="aev-select"
          value={ZOOMS.includes(Number(zoomValue)) || zoomValue === '0' ? zoomValue : 'custom'}
          data-automation-id="ae.viewer.zoom"
          title="Vergrößerung"
          onChange={(e) => {
            setPan({ x: 0, y: 0 });
            props.setUi({ viewerZoom: Number(e.target.value) || 0 });
          }}
        >
          <option value="0">Einpassen</option>
          {ZOOMS.map((z) => (
            <option key={z} value={String(z)}>
              {Math.round(z * 1000) / 10} %
            </option>
          ))}
          {!ZOOMS.includes(Number(zoomValue)) && zoomValue !== '0' && <option value="custom">{Math.round(scale * 1000) / 10} %</option>}
        </select>
        <select
          className="aev-select"
          value={String(ui.resolution)}
          data-automation-id="ae.viewer.resolution"
          title="Auflösung/Downsample-Faktor"
          onChange={(e) => props.setUi({ resolution: Number(e.target.value) as AeUiState['resolution'] })}
        >
          {[1, 2, 3, 4].map((r) => (
            <option key={r} value={r}>
              ({RES_LABEL[r]})
            </option>
          ))}
        </select>
        <button type="button" className={`aev-icon-btn${ui.transparency ? ' is-on' : ''}`} title="Transparenzraster ein/aus" data-automation-id="ae.viewer.transparency" onClick={() => props.setUi({ transparency: !ui.transparency })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden>
            <rect x="1" y="1" width="12" height="12" fill="none" stroke="currentColor" />
            <rect x="1" y="1" width="4" height="4" fill="currentColor" />
            <rect x="9" y="1" width="4" height="4" fill="currentColor" />
            <rect x="5" y="5" width="4" height="4" fill="currentColor" />
            <rect x="1" y="9" width="4" height="4" fill="currentColor" />
            <rect x="9" y="9" width="4" height="4" fill="currentColor" />
          </svg>
        </button>
        <button type="button" className={`aev-icon-btn${ui.showGrid ? ' is-on' : ''}`} title="Raster ein/aus" data-automation-id="ae.viewer.grid" onClick={() => props.setUi({ showGrid: !ui.showGrid })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor">
            <rect x="1" y="1" width="12" height="12" />
            <path d="M5 1v12M9 1v12M1 5h12M1 9h12" />
          </svg>
        </button>
        <button type="button" className={`aev-icon-btn${ui.showSafe ? ' is-on' : ''}`} title="Titel-/aktionssichere Ränder" data-automation-id="ae.viewer.safe" onClick={() => props.setUi({ showSafe: !ui.showSafe })}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden fill="none" stroke="currentColor">
            <rect x="1" y="1" width="12" height="12" />
            <rect x="3.5" y="3.5" width="7" height="7" />
          </svg>
        </button>
        <span className="aev-viewer-tc" data-automation-id="ae.viewer.timecode">
          {formatTimecode(time, comp.fps)}
        </span>
        <span className="aev-dim">
          {comp.width} × {comp.height} · {comp.fps} fps · Vorschau {rw} × {rh}
        </span>
      </div>
    </div>
  );
}
