/**
 * Fusion view of the shared composition (layout and behaviour after the
 * DaVinci Resolve Fusion page, own implementation): two viewers on top
 * (assign the selected node with 1 / 2), time ruler with render range, tool
 * bar, left → right node editor and the inspector on the right.
 *
 * Shortcuts: 1/2 viewer, Shift+Space "Select Tool", Ctrl/⌘+T swap inputs,
 * Ctrl/⌘+P pass-through, Entf/⌫ delete, Ctrl/⌘+D duplicate, Ctrl/⌘+A all,
 * F fit, ←/→ frame step. Space (play) and undo are handled by the shell.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { type LucideIcon, Blend, Circle, Contrast, Droplets, Film, LayoutGrid, Maximize2, Move, RectangleHorizontal, Repeat, Sparkles, Square, Trash2, Type, ToggleLeft, MonitorPlay } from 'lucide-react';
import type { CompNode } from '../fusion-shared/compModel';
import { getNode } from '../fusion-shared/compModel';
import {
  addSourceWithMerge,
  arrangeFlow,
  attachMask,
  duplicateNodes,
  getRenderRange,
  insertNodeAfter,
  isSourceType,
  keyframeTimes,
  moveNodes,
  removeNodes,
  setRenderRange,
  snapToFrame,
  clampTime,
  swapMergeInputs,
  togglePassthrough,
  uniqueNodeName,
  type NodePos,
} from '../fusion-shared/compModelExt';
import { createNode, connect } from '../fusion-shared/compModel';
import type { FusionViewProps } from '../fusion-shared/viewProps';
import { FUSION_TOOLS, buildToolNode, type ToolDef } from '../fusion-shared/toolCatalog';
import { searchTools } from '../fusion-shared/nodeSearch';
import { nodeClassOf, type CompNodeClass } from '../fusion-shared/nodeClass';
import { fxStackFor } from '../fusion-shared/compFx';
import { registerLiveCommands } from '../../mcp/liveCommands';
import CompViewer, { type ViewerChannel } from './CompViewer';
import NodeGraph, { type GraphNodeLook, type NodeGraphHandle } from './NodeGraph';
import ParamEditor from './ParamEditor';
import TimeBar from './TimeBar';
import { isTypingTarget } from './keys';

const PORT_COLOR = { bg: '#e2a43b', fg: '#57b65f', mask: '#4f86e3', input: '#e2a43b' } as const;

const CLASS_COLOR: Record<CompNodeClass, string> = {
  media: '#4f6f93',
  solid: '#5f5f63',
  text: '#7a5f9c',
  transform: '#5d7d52',
  merge: '#4f5f8f',
  mask: '#3f6f80',
  output: '#7a5a3a',
  grade: '#6d7f3c',
  blur: '#8a5a45',
  dot: '#555',
  fx: '#806c3a',
};

const TOOL_ICON: Record<string, LucideIcon> = {
  Background: Square,
  TextPlus: Type,
  Merge: Blend,
  Transform: Move,
  EllipseMask: Circle,
  RectangleMask: RectangleHorizontal,
  ColorCorrector: Contrast,
  Blur: Droplets,
  FX: Sparkles,
  MediaIn: Film,
  MediaOut: MonitorPlay,
};

const W = 104;
const H = 28;

const fusionLook = (node: CompNode): GraphNodeLook => {
  const cls = nodeClassOf(node);
  const inputs: GraphNodeLook['inputs'] = [];
  if (node.type === 'merge') {
    inputs.push({ port: 'bg', x: -1, y: H / 2, dir: 'left', color: PORT_COLOR.bg, label: 'Hintergrund' });
    inputs.push({ port: 'fg', x: W / 2, y: -1, dir: 'top', color: PORT_COLOR.fg, label: 'Vordergrund' });
    inputs.push({ port: 'mask', x: W / 2, y: H + 1, dir: 'bottom', color: PORT_COLOR.mask, label: 'Effektmaske' });
  } else if (!isSourceType(node.type)) inputs.push({ port: 'input', x: -1, y: H / 2, dir: 'left', color: PORT_COLOR.input, label: 'Eingang' });
  return {
    w: W,
    h: H,
    label: node.name,
    color: CLASS_COLOR[cls],
    shape: 'rect',
    inputs,
    output: node.type === 'output' ? null : { x: W + 1, y: H / 2 },
    title: `${node.name}${node.enabled ? '' : ' (durchgeleitet)'}`,
  };
};

type ViewerState = { nodeId: string | null; channel: ViewerChannel; checker: boolean };

const FusionView: React.FC<FusionViewProps> = (props) => {
  const { comp, onChange, time, onTimeChange, mediaItems, resolveMedia, selectedNodeIds, onSelect } = props;
  const graphRef = useRef<NodeGraphHandle | null>(null);
  const initialViewers = (): [ViewerState, ViewerState] => [
    { nodeId: comp.nodes.find((node) => node.type === 'media')?.id ?? null, channel: 'rgb', checker: false },
    { nodeId: comp.outputNodeId, channel: 'rgb', checker: false },
  ];
  const [viewers, setViewers] = useState<[ViewerState, ViewerState]>(initialViewers);
  const [search, setSearch] = useState<{ query: string; index: number } | null>(null);
  const compId = comp.id;
  useEffect(() => setViewers(initialViewers()), [compId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Keep viewer assignments valid after deletes.
  useEffect(() => {
    setViewers((prev) => prev.map((viewer) => (viewer.nodeId && !getNode(comp, viewer.nodeId) ? { ...viewer, nodeId: null } : viewer)) as [ViewerState, ViewerState]);
  }, [comp]);

  const activeId = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  const active = getNode(comp, activeId);
  const visualMedia = useMemo(() => mediaItems.filter((item) => item.type !== 'audio'), [mediaItems]);

  const assignViewer = useCallback((slot: 1 | 2, nodeId: string | null) => {
    setViewers((prev) => {
      const next = [...prev] as [ViewerState, ViewerState];
      next[slot - 1] = { ...next[slot - 1], nodeId };
      return next;
    });
  }, []);

  const freePos = useCallback(
    (wanted: NodePos): NodePos => {
      const pos = { ...wanted };
      for (let guard = 0; guard < 40; guard += 1) {
        if (!comp.nodes.some((node) => Math.abs(node.x - pos.x) < W && Math.abs(node.y - pos.y) < H + 12)) return pos;
        pos.y += H + 22;
      }
      return pos;
    },
    [comp.nodes],
  );

  // ------------------------------------------------------------ commands
  const addTool = useCallback(
    (def: ToolDef) => {
      if (def.type === 'output') {
        onSelect([comp.outputNodeId]);
        return;
      }
      const selected = active && active.id !== comp.outputNodeId ? active : null;
      const center = graphRef.current?.center() ?? { x: 0, y: 0 };
      const base = selected ? { x: selected.x + 170, y: selected.y } : { x: Math.round(center.x - W / 2), y: Math.round(center.y - H / 2) };
      const node = buildToolNode(def, comp, { fxStack: fxStackFor, defaultMediaId: visualMedia[0]?.id ?? null }, freePos(base));
      if (!node) return;
      let next;
      if (def.mask) {
        if (active?.type === 'merge') Object.assign(node, freePos({ x: active.x, y: active.y + 70 }));
        next = attachMask(comp, node, active?.id ?? null);
      } else if (isSourceType(node.type) && selected) {
        const merge = createNode('merge', { name: uniqueNodeName(comp, 'Merge'), ...freePos({ x: selected.x + 170, y: selected.y }) });
        Object.assign(node, freePos({ x: selected.x, y: selected.y - 70 }));
        next = addSourceWithMerge(comp, node, selected.id, merge);
      } else if (active?.id === comp.outputNodeId && !isSourceType(node.type)) {
        // Processing tool with MediaOut selected: goes in front of MediaOut.
        const upstream = active.inputs.input ?? null;
        Object.assign(node, freePos({ x: active.x - 20, y: active.y + 60 }));
        next = upstream ? insertNodeAfter(comp, node, upstream) : connect(insertNodeAfter(comp, node, null), node.id, comp.outputNodeId, 'input');
      } else next = insertNodeAfter(comp, node, selected?.id ?? null);
      onChange(next);
      onSelect([node.id]);
      if (!viewers[0].nodeId) assignViewer(1, node.id);
    },
    [active, comp, onChange, onSelect, freePos, visualMedia, viewers, assignViewer],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedNodeIds.length) return;
    onChange(removeNodes(comp, selectedNodeIds));
    onSelect([]);
  }, [comp, selectedNodeIds, onChange, onSelect]);
  const swapInputs = useCallback(() => onChange(swapMergeInputs(comp, selectedNodeIds)), [comp, selectedNodeIds, onChange]);
  const passthrough = useCallback(() => onChange(togglePassthrough(comp, selectedNodeIds)), [comp, selectedNodeIds, onChange]);
  const duplicate = useCallback(() => {
    const result = duplicateNodes(comp, selectedNodeIds);
    onChange(result.comp);
    onSelect(result.ids);
  }, [comp, selectedNodeIds, onChange, onSelect]);
  const arrange = useCallback(() => {
    onChange(arrangeFlow(comp));
    window.setTimeout(() => graphRef.current?.fit(), 30);
  }, [comp, onChange]);
  const stepFrame = useCallback((delta: number) => onTimeChange(clampTime(comp, snapToFrame(comp, time) + delta / comp.fps)), [comp, time, onTimeChange]);

  // ------------------------------------------------------------ keyboard
  const handlers = useRef({ addTool, deleteSelected, swapInputs, passthrough, duplicate, stepFrame, assignViewer, activeId, comp, onSelect });
  handlers.current = { addTool, deleteSelected, swapInputs, passthrough, duplicate, stepFrame, assignViewer, activeId, comp, onSelect };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const h = handlers.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      let handled = true;
      if (event.shiftKey && event.code === 'Space') setSearch({ query: '', index: 0 });
      else if (!mod && (key === '1' || key === '2')) h.assignViewer(key === '1' ? 1 : 2, h.activeId);
      else if (mod && key === 't') h.swapInputs();
      else if (mod && key === 'p') h.passthrough();
      else if (mod && key === 'd') h.duplicate();
      else if (mod && key === 'a') h.onSelect(h.comp.nodes.map((node) => node.id));
      else if (!mod && (key === 'delete' || key === 'backspace')) h.deleteSelected();
      else if (!mod && key === 'f') graphRef.current?.fit();
      else if (!mod && key === 'arrowleft') h.stepFrame(-1);
      else if (!mod && key === 'arrowright') h.stepFrame(1);
      else if (key === 'escape') h.onSelect([]);
      else handled = false;
      if (handled) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  // ------------------------------------------------------------ MCP live command
  useEffect(
    () =>
      registerLiveCommands({
        'fusion.viewer.set': (args) => {
          const ref = String(args.nodeId ?? '');
          const node = handlers.current.comp.nodes.find((entry) => entry.id === ref || entry.name === ref);
          if (!node) throw new Error(`Node ${ref} not found.`);
          const slot = Number(args.viewer) === 2 ? 2 : 1;
          handlers.current.assignViewer(slot, node.id);
          return { viewer: slot, nodeId: node.id };
        },
      }),
    [],
  );

  const results = search ? searchTools(FUSION_TOOLS, search.query) : [];
  const range = getRenderRange(comp);
  const viewerSlotsOf = useCallback((id: string) => viewers.flatMap((viewer, index) => (viewer.nodeId === id ? [index + 1] : [])), [viewers]);
  const positionOf = useCallback((node: CompNode) => ({ x: node.x, y: node.y }), []);

  const viewerPanel = (slot: 1 | 2) => {
    const viewer = viewers[slot - 1];
    const node = getNode(comp, viewer.nodeId);
    const set = (patch: Partial<ViewerState>) =>
      setViewers((prev) => {
        const next = [...prev] as [ViewerState, ViewerState];
        next[slot - 1] = { ...next[slot - 1], ...patch };
        return next;
      });
    return (
      <div className="fxp-viewer" data-automation-id={`fusion-viewer-${slot}`}>
        <div className="fxp-viewer__bar">
          <span className="fxp-viewer__slot">{slot}</span>
          <select className="fxp-select" value={viewer.nodeId ?? ''} onChange={(event) => set({ nodeId: event.target.value || null })} data-automation-id={`fusion-viewer-${slot}-node`} title="Knoten im Viewer">
            <option value="">– leer –</option>
            {comp.nodes.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name}
              </option>
            ))}
          </select>
          <span className="fxp-spacer" />
          {(['rgb', 'a'] as ViewerChannel[]).map((channel) => (
            <button key={channel} type="button" className={`fxp-chip ${viewer.channel === channel ? 'fxp-chip--on' : ''}`} onClick={() => set({ channel })} data-automation-id={`fusion-viewer-${slot}-channel-${channel}`} title={channel === 'a' ? 'Alphakanal' : 'Farbe'}>
              {channel.toUpperCase()}
            </button>
          ))}
          <button type="button" className={`fxp-chip ${viewer.checker ? 'fxp-chip--on' : ''}`} onClick={() => set({ checker: !viewer.checker })} data-automation-id={`fusion-viewer-${slot}-checker`} title="Schachbrett für Transparenz">
            <LayoutGrid size={12} />
          </button>
        </div>
        <CompViewer
          comp={comp}
          nodeId={node?.id ?? null}
          time={time}
          resolveMedia={resolveMedia}
          channel={viewer.channel}
          checker={viewer.checker}
          automationId={`fusion-viewer-${slot}-stage`}
          emptyHint={`Knoten wählen und ${slot} drücken`}
        />
        <div className="fxp-viewer__foot">
          <span>{node ? node.name : '—'}</span>
          <span>
            {comp.width}×{comp.height}
          </span>
        </div>
      </div>
    );
  };

  return (
    <div className="fxp-root" data-automation-id="fusion-view">
      <div className="fxp-viewers">
        {viewerPanel(1)}
        {viewerPanel(2)}
      </div>
      <div className="fxp-time">
        <TimeBar
          comp={comp}
          time={time}
          onTimeChange={onTimeChange}
          range={props.renderRange ?? range}
          onRangeChange={(next) => (props.onRenderRangeChange ? props.onRenderRangeChange(next) : onChange(setRenderRange(comp, next)))}
          keyTimes={keyframeTimes(active)}
          playing={props.playing}
          onPlayingChange={props.onPlayingChange}
          variant="fusion"
          automationId="fusion-timebar"
        />
      </div>
      <div className="fxp-toolbar" role="toolbar" aria-label="Werkzeuge">
        {FUSION_TOOLS.map((def) => {
          const Icon = TOOL_ICON[def.id] ?? Sparkles;
          return (
            <button key={def.id} type="button" className="fxp-tool" onClick={() => addTool(def)} title={`${def.label} – ${def.description}`} data-automation-id={`fusion-tool-${def.id}`}>
              <Icon size={15} />
              <span>{def.short}</span>
            </button>
          );
        })}
        <span className="fxp-spacer" />
        <button type="button" className="fxp-tool fxp-tool--text" onClick={() => setSearch({ query: '', index: 0 })} title="Werkzeug suchen (Shift+Leertaste)" data-automation-id="fusion-select-tool">
          Werkzeug …
        </button>
        <button type="button" className="fxp-tool" onClick={swapInputs} disabled={!active || active.type !== 'merge'} title="Eingänge tauschen (Ctrl/⌘+T)" data-automation-id="fusion-swap-inputs">
          <Repeat size={14} />
        </button>
        <button type="button" className="fxp-tool" onClick={passthrough} disabled={!selectedNodeIds.length} title="Durchleiten an/aus (Ctrl/⌘+P)" data-automation-id="fusion-passthrough">
          <ToggleLeft size={14} />
        </button>
        <button type="button" className="fxp-tool" onClick={deleteSelected} disabled={!selectedNodeIds.length} title="Löschen (Entf)" data-automation-id="fusion-delete">
          <Trash2 size={14} />
        </button>
        <button type="button" className="fxp-tool fxp-tool--text" onClick={arrange} title="Knoten automatisch anordnen" data-automation-id="fusion-arrange">
          Anordnen
        </button>
        <button type="button" className="fxp-tool" onClick={() => graphRef.current?.fit()} title="Einpassen (F)" data-automation-id="fusion-fit">
          <Maximize2 size={14} />
        </button>
      </div>
      <div className="fxp-nodes">
        <NodeGraph
          ref={graphRef}
          comp={comp}
          variant="fusion"
          positionOf={positionOf}
          look={fusionLook}
          selectedIds={selectedNodeIds}
          onSelect={onSelect}
          onMove={(positions) => onChange(moveNodes(comp, positions))}
          onConnect={(from, to, port) => {
            const target = getNode(comp, to);
            if (!target) return;
            const chosen = port ?? Object.keys(target.inputs).find((entry) => !target.inputs[entry]) ?? Object.keys(target.inputs)[0];
            if (chosen) onChange(connect(comp, from, to, chosen));
          }}
          onDisconnect={(to, port) => onChange(connect(comp, null, to, port))}
          viewerSlotsOf={viewerSlotsOf}
          onViewerSlot={(id, slot) => assignViewer(slot as 1 | 2, viewerSlotsOf(id).includes(slot) ? null : id)}
          automationId="fusion-nodes"
          emptyHint="Werkzeug in der Leiste wählen oder Shift+Leertaste drücken"
        />
        {search && (
          <div className="fxp-search" role="dialog" aria-label="Werkzeug wählen" data-automation-id="fusion-select-tool-popup">
            <div className="fxp-search__title">Werkzeug wählen</div>
            <input
              autoFocus
              className="fxp-search__input"
              value={search.query}
              placeholder="Suchen …"
              onChange={(event) => setSearch({ query: event.target.value, index: 0 })}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setSearch(null);
                else if (event.key === 'ArrowDown') setSearch({ ...search, index: Math.min(results.length - 1, search.index + 1) });
                else if (event.key === 'ArrowUp') setSearch({ ...search, index: Math.max(0, search.index - 1) });
                else if (event.key === 'Enter' && results[search.index]) {
                  addTool(results[search.index]);
                  setSearch(null);
                } else return;
                event.preventDefault();
                event.stopPropagation();
              }}
              data-automation-id="fusion-select-tool-input"
            />
            <div className="fxp-search__list">
              {results.map((def, index) => (
                <button
                  key={def.id}
                  type="button"
                  className={`fxp-search__item ${index === search.index ? 'fxp-search__item--on' : ''}`}
                  onMouseEnter={() => setSearch({ ...search, index })}
                  onClick={() => {
                    addTool(def);
                    setSearch(null);
                  }}
                  data-automation-id={`fusion-select-tool-item-${def.id}`}
                >
                  <strong>{def.label}</strong>
                  <small>{def.description}</small>
                </button>
              ))}
              {!results.length && <p className="pe-hint">Kein Werkzeug gefunden.</p>}
            </div>
          </div>
        )}
      </div>
      <aside className="fxp-inspector" data-automation-id="fusion-inspector">
        <div className="fxp-inspector__head">
          <span>Inspektor</span>
          {active && (
            <label className="fxp-inspector__bypass" title="Durchleiten (Ctrl/⌘+P)">
              <input type="checkbox" checked={active.enabled} disabled={active.id === comp.outputNodeId} onChange={passthrough} data-automation-id="fusion-inspector-enabled" />
              aktiv
            </label>
          )}
        </div>
        {active ? (
          <>
            <input className="fxp-inspector__name" value={active.name} onChange={(event) => onChange({ ...comp, nodes: comp.nodes.map((node) => (node.id === active.id ? { ...node, name: event.target.value } : node)) })} data-automation-id="fusion-inspector-name" />
            <div className="fxp-inspector__body">
              <ParamEditor comp={comp} node={active} time={time} mediaItems={mediaItems} variant="fusion" onNodeChange={(next) => onChange({ ...comp, nodes: comp.nodes.map((node) => (node.id === next.id ? next : node)) })} onCompChange={onChange} onTimeChange={onTimeChange} automationId="fusion-inspector" />
            </div>
          </>
        ) : (
          <div className="fxp-inspector__body">
            <p className="pe-hint">Kein Knoten ausgewählt. Klicke einen Knoten im Knoteneditor.</p>
            <ParamEditor comp={comp} node={getNode(comp, comp.outputNodeId)!} time={time} mediaItems={mediaItems} variant="fusion" onNodeChange={() => undefined} onCompChange={onChange} automationId="fusion-inspector-comp" />
          </div>
        )}
      </aside>
    </div>
  );
};

export default FusionView;
