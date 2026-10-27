/**
 * Node-graph surface shared by the Fusion flow (left → right) and the Nuke
 * DAG (top → bottom). The views decide how a node looks and where its ports
 * sit (`look`); this component handles pan/zoom, selection (click, Shift/Cmd
 * click, box select), dragging nodes, and connecting by dragging from an
 * output onto an input / node — or from an input to re-route or disconnect.
 */
import React, { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type { CompNode, Composition } from '../fusion-shared/compModel';
import { getNode } from '../fusion-shared/compModel';
import type { NodePos } from '../fusion-shared/compModelExt';

export type PortDir = 'left' | 'right' | 'top' | 'bottom';
export type GraphPort = { port: string; x: number; y: number; dir: PortDir; color: string; label?: string };
export type GraphNodeLook = {
  w: number;
  h: number;
  label: string;
  sub?: string;
  color: string;
  shape: 'rect' | 'dot';
  inputs: GraphPort[];
  output: { x: number; y: number } | null;
  title?: string;
};

export type ExtraWire = { from: NodePos; to: NodePos; color: string; label?: string; dashed?: boolean };

export type NodeGraphHandle = {
  fit(): void;
  /** Graph coordinates of the visible centre. */
  center(): NodePos;
};

export type NodeGraphProps = {
  comp: Composition;
  variant: 'fusion' | 'nuke';
  positionOf(node: CompNode): NodePos;
  look(node: CompNode): GraphNodeLook;
  selectedIds: string[];
  onSelect(ids: string[]): void;
  onMove(positions: Map<string, NodePos>): void;
  onConnect(from: string, to: string, port: string | null): void;
  onDisconnect(to: string, port: string): void;
  onOpen?(id: string): void;
  /** Fusion: viewer slots (1/2) shown as dots under each node. */
  viewerSlotsOf?(id: string): number[];
  onViewerSlot?(id: string, slot: number): void;
  extraWires?: ExtraWire[];
  /** Rendered inside the graph space (Nuke Viewer node). */
  decorations?: React.ReactNode;
  onBackgroundDoubleClick?(pos: NodePos): void;
  automationId: string;
  emptyHint?: string;
};

type View = { tx: number; ty: number; zoom: number };

type Drag =
  | { kind: 'pan'; startX: number; startY: number; view: View }
  | { kind: 'move'; ids: string[]; startX: number; startY: number; origin: Map<string, NodePos>; moved: boolean; clickedId: string; additive: boolean }
  | { kind: 'box'; startX: number; startY: number; additive: boolean }
  | { kind: 'wire'; fromId: string | null; toId: string | null; toPort: string | null; detach: { nodeId: string; port: string } | null };

const DIR: Record<PortDir, [number, number]> = { left: [-1, 0], right: [1, 0], top: [0, -1], bottom: [0, 1] };

const NodeGraph = forwardRef<NodeGraphHandle, NodeGraphProps>(function NodeGraph(props, ref) {
  const { comp, variant, positionOf, look, selectedIds, onSelect, onMove, onConnect, onDisconnect, onOpen, viewerSlotsOf, onViewerSlot, extraWires, decorations, automationId } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const [view, setView] = useState<View>({ tx: 40, ty: 40, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const dragRef = useRef<Drag | null>(null);
  const [moveOffset, setMoveOffset] = useState<{ ids: Set<string>; dx: number; dy: number } | null>(null);
  const [box, setBox] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const [wire, setWire] = useState<{ from: NodePos | null; to: NodePos | null; cursor: NodePos } | null>(null);

  const looks = useMemo(() => new Map(comp.nodes.map((node) => [node.id, look(node)])), [comp.nodes, look]);
  const basePositions = useMemo(() => new Map(comp.nodes.map((node) => [node.id, positionOf(node)])), [comp.nodes, positionOf]);
  const posOf = useCallback(
    (id: string): NodePos => {
      const base = basePositions.get(id) ?? { x: 0, y: 0 };
      return moveOffset?.ids.has(id) ? { x: base.x + moveOffset.dx, y: base.y + moveOffset.dy } : base;
    },
    [basePositions, moveOffset],
  );

  const toGraph = useCallback((clientX: number, clientY: number): NodePos => {
    const rect = rootRef.current?.getBoundingClientRect();
    const v = viewRef.current;
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - v.tx) / v.zoom, y: (clientY - rect.top - v.ty) / v.zoom };
  }, []);

  const fit = useCallback(() => {
    const rect = rootRef.current?.getBoundingClientRect();
    if (!rect || !comp.nodes.length) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const node of comp.nodes) {
      const p = basePositions.get(node.id)!;
      const l = looks.get(node.id)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + l.w);
      maxY = Math.max(maxY, p.y + l.h);
    }
    const pad = 70;
    const zoom = Math.min(1.4, Math.max(0.25, Math.min(rect.width / (maxX - minX + pad * 2), rect.height / (maxY - minY + pad * 2))));
    setView({ zoom, tx: rect.width / 2 - ((minX + maxX) / 2) * zoom, ty: rect.height / 2 - ((minY + maxY) / 2) * zoom });
  }, [comp.nodes, basePositions, looks]);

  useImperativeHandle(ref, () => ({
    fit,
    center: () => {
      const rect = rootRef.current?.getBoundingClientRect();
      return rect ? toGraph(rect.left + rect.width / 2, rect.top + rect.height / 2) : { x: 0, y: 0 };
    },
  }), [fit, toGraph]);

  // Fit once when the graph first gets a size.
  const fitted = useRef(false);
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => {
      if (!fitted.current && root.clientWidth > 50 && root.clientHeight > 50) {
        fitted.current = true;
        fit();
      }
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, [fit]);

  // Wheel: Ctrl/⌘ or mouse wheel zooms around the cursor, trackpad scroll pans.
  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const rect = root.getBoundingClientRect();
      const v = viewRef.current;
      const isMouseWheel = event.deltaMode === 1 || (Math.abs(event.deltaY) >= 40 && event.deltaX === 0 && Number.isInteger(event.deltaY));
      if (event.ctrlKey || event.metaKey || isMouseWheel) {
        const factor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015));
        const zoom = Math.min(3, Math.max(0.15, v.zoom * factor));
        const cx = event.clientX - rect.left;
        const cy = event.clientY - rect.top;
        setView({ zoom, tx: cx - ((cx - v.tx) / v.zoom) * zoom, ty: cy - ((cy - v.ty) / v.zoom) * zoom });
      } else setView({ ...v, tx: v.tx - event.deltaX, ty: v.ty - event.deltaY });
    };
    root.addEventListener('wheel', onWheel, { passive: false });
    return () => root.removeEventListener('wheel', onWheel);
  }, []);

  const portPos = useCallback(
    (nodeId: string, port: string): NodePos | null => {
      const l = looks.get(nodeId);
      const p = posOf(nodeId);
      const def = l?.inputs.find((entry) => entry.port === port);
      return def ? { x: p.x + def.x, y: p.y + def.y } : null;
    },
    [looks, posOf],
  );
  const outPos = useCallback(
    (nodeId: string): NodePos | null => {
      const l = looks.get(nodeId);
      const p = posOf(nodeId);
      return l?.output ? { x: p.x + l.output.x, y: p.y + l.output.y } : null;
    },
    [looks, posOf],
  );

  const hitTest = (clientX: number, clientY: number) => {
    const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const portEl = el?.closest<HTMLElement>('[data-gport]');
    if (portEl && rootRef.current?.contains(portEl)) return { nodeId: portEl.dataset.gnodeid!, port: portEl.dataset.gport!, kind: 'input' as const };
    const outEl = el?.closest<HTMLElement>('[data-gout]');
    if (outEl && rootRef.current?.contains(outEl)) return { nodeId: outEl.dataset.gout!, port: null, kind: 'output' as const };
    const nodeEl = el?.closest<HTMLElement>('[data-gnode]');
    if (nodeEl && rootRef.current?.contains(nodeEl)) return { nodeId: nodeEl.dataset.gnode!, port: null, kind: 'node' as const };
    return null;
  };

  const endDrag = (event: PointerEvent) => {
    const drag = dragRef.current;
    dragRef.current = null;
    window.removeEventListener('pointermove', onWindowMove);
    window.removeEventListener('pointerup', endDrag);
    if (!drag) return;
    if (drag.kind === 'move') {
      setMoveOffset(null);
      if (drag.moved) {
        const v = viewRef.current;
        const dx = (event.clientX - drag.startX) / v.zoom;
        const dy = (event.clientY - drag.startY) / v.zoom;
        const next = new Map<string, NodePos>();
        for (const id of drag.ids) {
          const o = drag.origin.get(id)!;
          next.set(id, { x: Math.round(o.x + dx), y: Math.round(o.y + dy) });
        }
        onMove(next);
      } else if (!drag.additive) onSelect([drag.clickedId]);
    } else if (drag.kind === 'box') {
      setBox(null);
      const a = toGraph(drag.startX, drag.startY);
      const b = toGraph(event.clientX, event.clientY);
      const moved = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 4;
      if (!moved) {
        if (!drag.additive) onSelect([]);
        return;
      }
      const x0 = Math.min(a.x, b.x);
      const x1 = Math.max(a.x, b.x);
      const y0 = Math.min(a.y, b.y);
      const y1 = Math.max(a.y, b.y);
      const hits = comp.nodes
        .filter((node) => {
          const p = basePositions.get(node.id)!;
          const l = looks.get(node.id)!;
          return p.x < x1 && p.x + l.w > x0 && p.y < y1 && p.y + l.h > y0;
        })
        .map((node) => node.id);
      onSelect(drag.additive ? [...new Set([...selectedIds, ...hits])] : hits);
    } else if (drag.kind === 'wire') {
      setWire(null);
      const hit = hitTest(event.clientX, event.clientY);
      if (drag.fromId) {
        // Dragging a wire end towards an input.
        if (hit && hit.nodeId !== drag.fromId && hit.kind !== 'output') {
          if (drag.detach && (drag.detach.nodeId !== hit.nodeId || drag.detach.port !== hit.port)) onDisconnect(drag.detach.nodeId, drag.detach.port);
          onConnect(drag.fromId, hit.nodeId, hit.kind === 'input' ? hit.port : null);
        } else if (drag.detach && !hit) onDisconnect(drag.detach.nodeId, drag.detach.port);
      } else if (drag.toId && drag.toPort && hit && hit.nodeId !== drag.toId) {
        // Dragging from an empty input towards a source.
        onConnect(hit.nodeId, drag.toId, drag.toPort);
      }
    }
  };

  const onWindowMove = (event: PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    if (drag.kind === 'pan') {
      setView({ ...drag.view, tx: drag.view.tx + event.clientX - drag.startX, ty: drag.view.ty + event.clientY - drag.startY });
    } else if (drag.kind === 'move') {
      const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (!drag.moved && distance < 3) return;
      drag.moved = true;
      const v = viewRef.current;
      setMoveOffset({ ids: new Set(drag.ids), dx: (event.clientX - drag.startX) / v.zoom, dy: (event.clientY - drag.startY) / v.zoom });
    } else if (drag.kind === 'box') {
      const a = toGraph(drag.startX, drag.startY);
      const b = toGraph(event.clientX, event.clientY);
      setBox({ x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y), x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y) });
    } else if (drag.kind === 'wire') {
      const cursor = toGraph(event.clientX, event.clientY);
      setWire({ from: drag.fromId ? outPos(drag.fromId) : null, to: drag.toId && drag.toPort ? portPos(drag.toId, drag.toPort) : null, cursor });
    }
  };

  const beginDrag = (drag: Drag) => {
    dragRef.current = drag;
    window.addEventListener('pointermove', onWindowMove);
    window.addEventListener('pointerup', endDrag);
  };

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button === 2) return;
    const target = event.target as HTMLElement;
    rootRef.current?.focus({ preventScroll: true });
    if (event.button === 1 || event.altKey) {
      event.preventDefault();
      beginDrag({ kind: 'pan', startX: event.clientX, startY: event.clientY, view: viewRef.current });
      return;
    }
    const slotEl = target.closest<HTMLElement>('[data-gslot]');
    if (slotEl) {
      event.stopPropagation();
      onViewerSlot?.(slotEl.dataset.gslotnode!, Number(slotEl.dataset.gslot));
      return;
    }
    const portEl = target.closest<HTMLElement>('[data-gport]');
    if (portEl) {
      event.preventDefault();
      const nodeId = portEl.dataset.gnodeid!;
      const port = portEl.dataset.gport!;
      const src = getNode(comp, nodeId)?.inputs[port] ?? null;
      if (src) beginDrag({ kind: 'wire', fromId: src, toId: null, toPort: null, detach: { nodeId, port } });
      else beginDrag({ kind: 'wire', fromId: null, toId: nodeId, toPort: port, detach: null });
      setWire({ from: src ? outPos(src) : null, to: src ? null : portPos(nodeId, port), cursor: toGraph(event.clientX, event.clientY) });
      return;
    }
    const outEl = target.closest<HTMLElement>('[data-gout]');
    if (outEl) {
      event.preventDefault();
      const nodeId = outEl.dataset.gout!;
      beginDrag({ kind: 'wire', fromId: nodeId, toId: null, toPort: null, detach: null });
      setWire({ from: outPos(nodeId), to: null, cursor: toGraph(event.clientX, event.clientY) });
      return;
    }
    const nodeEl = target.closest<HTMLElement>('[data-gnode]');
    if (nodeEl) {
      event.preventDefault();
      const id = nodeEl.dataset.gnode!;
      const additive = event.shiftKey || event.metaKey || event.ctrlKey;
      let ids = selectedIds;
      if (additive) {
        ids = selectedIds.includes(id) ? selectedIds.filter((entry) => entry !== id) : [...selectedIds, id];
        onSelect(ids);
      } else if (!selectedIds.includes(id)) {
        ids = [id];
        onSelect(ids);
      }
      const moving = ids.includes(id) ? ids : [id];
      beginDrag({ kind: 'move', ids: moving, startX: event.clientX, startY: event.clientY, origin: new Map(moving.map((entry) => [entry, basePositions.get(entry) ?? { x: 0, y: 0 }])), moved: false, clickedId: id, additive });
      return;
    }
    event.preventDefault();
    beginDrag({ kind: 'box', startX: event.clientX, startY: event.clientY, additive: event.shiftKey || event.metaKey || event.ctrlKey });
  };

  const onDoubleClick = (event: React.MouseEvent) => {
    const nodeEl = (event.target as HTMLElement).closest<HTMLElement>('[data-gnode]');
    if (nodeEl) onOpen?.(nodeEl.dataset.gnode!);
    else props.onBackgroundDoubleClick?.(toGraph(event.clientX, event.clientY));
  };

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const wirePath = (from: NodePos, to: NodePos, dir: PortDir) => {
    if (variant === 'nuke') return `M${from.x},${from.y} L${to.x},${to.y}`;
    const k = Math.max(30, Math.hypot(to.x - from.x, to.y - from.y) * 0.45);
    const [dx, dy] = DIR[dir];
    return `M${from.x},${from.y} C${from.x + k},${from.y} ${to.x + dx * k},${to.y + dy * k} ${to.x},${to.y}`;
  };

  const wires: React.ReactNode[] = [];
  for (const node of comp.nodes) {
    const l = looks.get(node.id)!;
    for (const input of l.inputs) {
      const src = node.inputs[input.port];
      const end = portPos(node.id, input.port)!;
      const detached = dragRef.current?.kind === 'wire' && dragRef.current.detach?.nodeId === node.id && dragRef.current.detach.port === input.port;
      if (src && !detached) {
        const start = outPos(src);
        if (!start) continue;
        const hot = selected.has(src) || selected.has(node.id);
        wires.push(
          <path
            key={`${node.id}:${input.port}`}
            d={wirePath(start, end, input.dir)}
            className={`ng-wire ${hot ? 'ng-wire--hot' : ''}`}
            stroke={variant === 'fusion' ? input.color : undefined}
            markerEnd={variant === 'nuke' ? `url(#${automationId}-arrow${hot ? '-hot' : ''})` : undefined}
          />,
        );
        if (variant === 'nuke' && input.label) {
          const t = 0.72;
          wires.push(
            <text key={`${node.id}:${input.port}:l`} className="ng-wire-label" x={start.x + (end.x - start.x) * t + 6} y={start.y + (end.y - start.y) * t}>
              {input.label}
            </text>,
          );
        }
      } else if (variant === 'nuke') {
        // Dangling input stub with arrow (Nuke style).
        const [dx, dy] = DIR[input.dir];
        const tail = { x: end.x + dx * 26, y: end.y + dy * 26 };
        wires.push(<path key={`${node.id}:${input.port}:stub`} d={`M${tail.x},${tail.y} L${end.x},${end.y}`} className="ng-wire ng-wire--stub" markerEnd={`url(#${automationId}-arrow)`} />);
        if (input.label)
          wires.push(
            <text key={`${node.id}:${input.port}:sl`} className="ng-wire-label" x={tail.x + (dx < 0 ? -10 : dx > 0 ? 4 : 4)} y={tail.y + (dy < 0 ? -2 : 4)}>
              {input.label}
            </text>,
          );
      }
    }
  }
  for (const [index, extra] of (extraWires ?? []).entries()) {
    wires.push(<path key={`extra-${index}`} d={`M${extra.from.x},${extra.from.y} L${extra.to.x},${extra.to.y}`} className={`ng-wire ng-wire--extra ${extra.dashed ? 'ng-wire--dashed' : ''}`} stroke={extra.color} markerEnd={`url(#${automationId}-arrow)`} />);
    if (extra.label) wires.push(<text key={`extra-l-${index}`} className="ng-wire-label" x={(extra.from.x + extra.to.x) / 2 + 5} y={(extra.from.y + extra.to.y) / 2}>{extra.label}</text>);
  }

  if (wire) {
    const from = wire.from ?? wire.cursor;
    const to = wire.to ?? wire.cursor;
    wires.push(<path key="__drag" d={variant === 'nuke' ? `M${from.x},${from.y} L${to.x},${to.y}` : wirePath(from, to, 'left')} className="ng-wire ng-wire--drag" />);
  }

  return (
    <div
      ref={rootRef}
      className={`ng-root ng-root--${variant}`}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      onContextMenu={(event) => event.preventDefault()}
      data-automation-id={automationId}
      aria-label="Knoteneditor"
    >
      <div className="ng-grid" style={{ backgroundPosition: `${view.tx}px ${view.ty}px`, backgroundSize: `${24 * view.zoom}px ${24 * view.zoom}px` }} />
      <div className="ng-layer" style={{ transform: `translate(${view.tx}px, ${view.ty}px) scale(${view.zoom})` }}>
        <svg className="ng-wires" width="1" height="1">
          <defs>
            <marker id={`${automationId}-arrow`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="ng-arrow" />
            </marker>
            <marker id={`${automationId}-arrow-hot`} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
              <path d="M0,0 L10,5 L0,10 z" className="ng-arrow ng-arrow--hot" />
            </marker>
          </defs>
          {wires}
          {box && <rect className="ng-box" x={box.x0} y={box.y0} width={box.x1 - box.x0} height={box.y1 - box.y0} />}
        </svg>
        {decorations}
        {comp.nodes.map((node) => {
          const l = looks.get(node.id)!;
          const p = posOf(node.id);
          const slots = viewerSlotsOf?.(node.id) ?? [];
          const isSel = selected.has(node.id);
          return (
            <div
              key={node.id}
              className={`ng-node ng-node--${l.shape} ${isSel ? 'ng-node--selected' : ''} ${selectedIds[selectedIds.length - 1] === node.id ? 'ng-node--active' : ''} ${node.enabled ? '' : 'ng-node--bypassed'}`}
              style={{ left: p.x, top: p.y, width: l.w, height: l.h, ['--ng-color' as string]: l.color }}
              data-gnode={node.id}
              data-automation-id={`${automationId}-node-${node.name}`}
              title={l.title ?? node.name}
            >
              {l.shape === 'rect' && (
                <span className="ng-node__label">
                  {l.label}
                  {l.sub && <small>{l.sub}</small>}
                </span>
              )}
              {!node.enabled && <span className="ng-node__bypass" aria-hidden />}
              {l.inputs.map((input) => (
                <span
                  key={input.port}
                  className={`ng-port ng-port--in ng-port--${input.dir}`}
                  style={{ left: input.x, top: input.y, ['--ng-port' as string]: input.color }}
                  data-gport={input.port}
                  data-gnodeid={node.id}
                  data-automation-id={`${automationId}-port-${node.name}-${input.port}`}
                  title={input.label || input.port}
                />
              ))}
              {l.output && <span className="ng-port ng-port--out" style={{ left: l.output.x, top: l.output.y }} data-gout={node.id} data-automation-id={`${automationId}-out-${node.name}`} title="Ausgang" />}
              {onViewerSlot && (
                <span className="ng-slots">
                  {[1, 2].map((slot) => (
                    <span key={slot} className={`ng-slot ${slots.includes(slot) ? 'ng-slot--on' : ''}`} data-gslot={slot} data-gslotnode={node.id} data-automation-id={`${automationId}-slot-${node.name}-${slot}`} title={`In Viewer ${slot} anzeigen (${slot})`} />
                  ))}
                </span>
              )}
            </div>
          );
        })}
      </div>
      {comp.nodes.length <= 1 && props.emptyHint && <div className="ng-empty">{props.emptyHint}</div>}
      <div className="ng-zoom" aria-hidden>{Math.round(view.zoom * 100)} %</div>
    </div>
  );
});

export default NodeGraph;
