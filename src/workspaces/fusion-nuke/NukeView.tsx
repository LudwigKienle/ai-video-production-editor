/**
 * Nuke view of the shared composition (layout and behaviour after Foundry
 * Nuke, own implementation): Viewer with A/B inputs, wipe and channel
 * buttons on top, the top → bottom node graph (DAG) below, the Properties Bin
 * with stacked node panels on the right and the frame range bar at the bottom.
 *
 * Shortcuts: Tab node menu, M Merge, T Transform, G Grade, B Blur, R Read,
 * O Radial, . Dot, D disable, Shift+X swap A/B, 1/2 viewer A/B, F fit,
 * Entf/⌫ delete, ←/→ frame step.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Columns2, LayoutGrid, Maximize2, X } from 'lucide-react';
import type { CompNode } from '../fusion-shared/compModel';
import { connect, getNode } from '../fusion-shared/compModel';
import {
  arrangeNuke,
  attachMask,
  clampTime,
  flowPosFromNuke,
  getRenderRange,
  insertNodeAfter,
  isSourceType,
  keyframeTimes,
  nukePos,
  removeNodes,
  setNukePositions,
  setRenderRange,
  snapToFrame,
  swapMergeInputs,
  togglePassthrough,
  type NodePos,
} from '../fusion-shared/compModelExt';
import type { FusionViewProps } from '../fusion-shared/viewProps';
import { NUKE_TOOLS, buildToolNode, type ToolDef } from '../fusion-shared/toolCatalog';
import { searchTools } from '../fusion-shared/nodeSearch';
import { nodeClassOf } from '../fusion-shared/nodeClass';
import { fxStackFor } from '../fusion-shared/compFx';
import { registerLiveCommands } from '../../mcp/liveCommands';
import CompViewer from '../fusion-pro/CompViewer';
import NodeGraph, { type ExtraWire, type GraphNodeLook, type NodeGraphHandle } from '../fusion-pro/NodeGraph';
import ParamEditor from '../fusion-pro/ParamEditor';
import TimeBar from '../fusion-pro/TimeBar';
import { isTypingTarget } from '../fusion-pro/keys';
import { NUKE_HOTKEYS, VIEWER_CHANNELS, blendToNukeOp, nukeClassName, nukeColor, nukeInputs, type ViewerChannel } from './nukeModel';

const W = 92;
const H = 22;
const DOT = 12;

const nukeLook = (node: CompNode): GraphNodeLook => {
  const cls = nodeClassOf(node);
  if (cls === 'dot') {
    return { w: DOT, h: DOT, label: '', color: nukeColor(node), shape: 'dot', inputs: [{ port: 'input', x: DOT / 2, y: 0, dir: 'top', color: '#000' }], output: { x: DOT / 2, y: DOT }, title: node.name };
  }
  const inputs: GraphNodeLook['inputs'] = nukeInputs(node).map((input) => {
    if (input.label === 'A') return { port: input.port, x: 0, y: H / 2, dir: 'left' as const, color: '#000', label: 'A' };
    if (input.label === 'mask') return { port: input.port, x: W, y: H / 2, dir: 'right' as const, color: '#000', label: 'mask' };
    return { port: input.port, x: W / 2, y: 0, dir: 'top' as const, color: '#000', label: input.label || undefined };
  });
  const className = nukeClassName(node);
  const sub = node.type === 'merge' ? `(${blendToNukeOp(node.params.blend)})` : node.name.startsWith(className) ? undefined : className;
  return { w: W, h: H, label: node.name, sub, color: nukeColor(node), shape: 'rect', inputs, output: node.type === 'output' ? null : { x: W / 2, y: H }, title: `${node.name} · ${className}${node.enabled ? '' : ' (deaktiviert)'}` };
};

const MAX_PANELS = 6;

const NukeView: React.FC<FusionViewProps> = (props) => {
  const { comp, onChange, time, onTimeChange, mediaItems, resolveMedia, selectedNodeIds, onSelect } = props;
  const graphRef = useRef<NodeGraphHandle | null>(null);
  const [viewerA, setViewerA] = useState<string | null>(comp.outputNodeId);
  const [viewerB, setViewerB] = useState<string | null>(null);
  const [channel, setChannel] = useState<ViewerChannel>('rgb');
  const [wipe, setWipe] = useState(false);
  const [wipePos, setWipePos] = useState(0.5);
  const [checker, setChecker] = useState(false);
  const [panels, setPanels] = useState<string[]>([]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [menu, setMenu] = useState<{ query: string; index: number } | null>(null);
  const compId = comp.id;

  useEffect(() => {
    setViewerA(comp.outputNodeId);
    setViewerB(null);
    setPanels([]);
  }, [compId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop panels / viewer inputs of deleted nodes.
  useEffect(() => {
    setPanels((prev) => prev.filter((id) => getNode(comp, id)));
    if (viewerA && !getNode(comp, viewerA)) setViewerA(null);
    if (viewerB && !getNode(comp, viewerB)) setViewerB(null);
  }, [comp, viewerA, viewerB]);

  // The bin follows the selection (newest on top), like opening panels by double-click.
  const lastSelected = selectedNodeIds[selectedNodeIds.length - 1] ?? null;
  useEffect(() => {
    if (!lastSelected) return;
    setPanels((prev) => [lastSelected, ...prev.filter((id) => id !== lastSelected)].slice(0, MAX_PANELS));
  }, [lastSelected]);

  const openPanel = useCallback((id: string) => setPanels((prev) => [id, ...prev.filter((entry) => entry !== id)].slice(0, MAX_PANELS)), []);
  const active = getNode(comp, lastSelected);
  const visualMedia = useMemo(() => mediaItems.filter((item) => item.type !== 'audio'), [mediaItems]);
  const positionOf = useCallback((node: CompNode) => nukePos(comp, node), [comp]);

  // ------------------------------------------------------------ commands
  const createTool = useCallback(
    (def: ToolDef) => {
      if (def.type === 'output') {
        onSelect([comp.outputNodeId]);
        return;
      }
      const selected = active && active.id !== comp.outputNodeId ? active : null;
      const center = graphRef.current?.center() ?? { x: 0, y: 0 };
      const anchor = selected ? nukePos(comp, selected) : { x: center.x - W / 2, y: center.y - H / 2 };
      let pos: NodePos = selected ? (isSourceType(def.type) ? { x: anchor.x - W - 40, y: anchor.y - 70 } : { x: anchor.x, y: anchor.y + 60 }) : anchor;
      if (def.cls === 'dot') pos = { x: anchor.x + W / 2 - DOT / 2, y: anchor.y + 50 };
      const occupied = (p: NodePos) => comp.nodes.some((node) => { const q = nukePos(comp, node); return Math.abs(q.x - p.x) < W && Math.abs(q.y - p.y) < H + 8; });
      for (let guard = 0; guard < 30 && occupied(pos); guard += 1) pos = { ...pos, x: pos.x + W + 20 };
      const node = buildToolNode(def, comp, { fxStack: fxStackFor, defaultMediaId: visualMedia[0]?.id ?? null }, flowPosFromNuke(pos));
      if (!node) return;
      let next;
      if (def.mask) next = attachMask(comp, node, active?.id ?? null);
      else if (isSourceType(node.type)) next = insertNodeAfter(comp, node, null);
      else if (active?.id === comp.outputNodeId) {
        const upstream = active.inputs.input ?? null;
        next = upstream ? insertNodeAfter(comp, node, upstream) : connect(insertNodeAfter(comp, node, null), node.id, comp.outputNodeId, 'input');
      } else next = insertNodeAfter(comp, node, selected?.id ?? null);
      onChange(setNukePositions(next, { [node.id]: pos }));
      onSelect([node.id]);
      openPanel(node.id);
    },
    [active, comp, onChange, onSelect, openPanel, visualMedia],
  );

  const deleteSelected = useCallback(() => {
    if (!selectedNodeIds.length) return;
    onChange(removeNodes(comp, selectedNodeIds));
    onSelect([]);
  }, [comp, selectedNodeIds, onChange, onSelect]);
  const disable = useCallback(() => onChange(togglePassthrough(comp, selectedNodeIds)), [comp, selectedNodeIds, onChange]);
  const swapAB = useCallback(() => onChange(swapMergeInputs(comp, selectedNodeIds)), [comp, selectedNodeIds, onChange]);
  const arrange = useCallback(() => {
    onChange(arrangeNuke(comp));
    window.setTimeout(() => graphRef.current?.fit(), 30);
  }, [comp, onChange]);
  const stepFrame = useCallback((delta: number) => onTimeChange(clampTime(comp, snapToFrame(comp, time) + delta / comp.fps)), [comp, time, onTimeChange]);
  const setViewerInput = useCallback((slot: 1 | 2, id: string | null) => {
    if (slot === 1) setViewerA(id);
    else {
      setViewerB(id);
      if (id) setWipe(true);
    }
  }, []);

  // ------------------------------------------------------------ keyboard
  const handlers = useRef({ createTool, deleteSelected, disable, swapAB, stepFrame, setViewerInput, lastSelected, comp, onSelect });
  handlers.current = { createTool, deleteSelected, disable, swapAB, stepFrame, setViewerInput, lastSelected, comp, onSelect };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (isTypingTarget(event.target)) return;
      const h = handlers.current;
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      let handled = true;
      if (key === 'tab' && !mod) setMenu({ query: '', index: 0 });
      else if (!mod && event.shiftKey && key === 'x') h.swapAB();
      else if (!mod && !event.shiftKey && NUKE_HOTKEYS[key]) h.createTool(NUKE_TOOLS.find((def) => def.id === NUKE_HOTKEYS[key])!);
      else if (!mod && key === 'd') h.disable();
      else if (!mod && (key === '1' || key === '2')) h.setViewerInput(key === '1' ? 1 : 2, h.lastSelected);
      else if (!mod && (key === 'delete' || key === 'backspace')) h.deleteSelected();
      else if (!mod && key === 'f') graphRef.current?.fit();
      else if (mod && key === 'a') h.onSelect(h.comp.nodes.map((node) => node.id));
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
        'nuke.viewer.set': (args) => {
          const find = (ref: unknown) => {
            if (ref === null || ref === '') return null;
            const node = handlers.current.comp.nodes.find((entry) => entry.id === ref || entry.name === ref);
            if (!node) throw new Error(`Node ${String(ref)} not found.`);
            return node.id;
          };
          if (args.a !== undefined) setViewerA(find(args.a));
          if (args.b !== undefined) setViewerB(find(args.b));
          if (typeof args.channel === 'string' && VIEWER_CHANNELS.some((entry) => entry.id === args.channel)) setChannel(args.channel as ViewerChannel);
          if (typeof args.wipe === 'boolean') setWipe(args.wipe);
          if (typeof args.wipePosition === 'number' && Number.isFinite(args.wipePosition)) setWipePos(Math.min(1, Math.max(0, args.wipePosition)));
          return { ok: true };
        },
      }),
    [],
  );

  // Viewer node (UI only) under the lowest node, wired from A (1) and B (2).
  const viewerPos = useMemo(() => {
    const out = getNode(comp, comp.outputNodeId);
    const p = out ? nukePos(comp, out) : { x: 0, y: 0 };
    return { x: p.x + W + 50, y: p.y + 10 };
  }, [comp]);
  const extraWires: ExtraWire[] = [];
  const outOf = (id: string | null) => {
    const node = getNode(comp, id);
    if (!node) return null;
    const p = nukePos(comp, node);
    const l = nukeLook(node);
    return { x: p.x + (l.output?.x ?? l.w / 2), y: p.y + (l.output?.y ?? l.h) };
  };
  const a = outOf(viewerA);
  const b = outOf(viewerB);
  if (a) extraWires.push({ from: a, to: { x: viewerPos.x + 20, y: viewerPos.y }, color: '#9a9a9a', label: '1', dashed: true });
  if (b) extraWires.push({ from: b, to: { x: viewerPos.x + 50, y: viewerPos.y }, color: '#9a9a9a', label: '2', dashed: true });

  const results = menu ? searchTools(NUKE_TOOLS, menu.query) : [];
  const range = getRenderRange(comp);
  const nodeOptions = comp.nodes.map((node) => (
    <option key={node.id} value={node.id}>
      {node.name}
    </option>
  ));

  return (
    <div className="nk-root" data-automation-id="nuke-view">
      <div className="nk-viewer" data-automation-id="nuke-viewer">
        <div className="nk-viewer__bar">
          <span className="nk-tag">Viewer1</span>
          <label className="nk-field">
            A
            <select value={viewerA ?? ''} onChange={(event) => setViewerA(event.target.value || null)} data-automation-id="nuke-viewer-a">
              <option value="">–</option>
              {nodeOptions}
            </select>
          </label>
          <label className="nk-field">
            B
            <select value={viewerB ?? ''} onChange={(event) => setViewerB(event.target.value || null)} data-automation-id="nuke-viewer-b">
              <option value="">–</option>
              {nodeOptions}
            </select>
          </label>
          <button type="button" className={`nk-btn ${wipe ? 'nk-btn--on' : ''}`} onClick={() => setWipe(!wipe)} disabled={!viewerB} title="A/B-Wipe" data-automation-id="nuke-viewer-wipe">
            <Columns2 size={13} /> Wipe
          </button>
          <span className="nk-spacer" />
          {VIEWER_CHANNELS.map((entry) => (
            <button key={entry.id} type="button" className={`nk-btn nk-btn--ch nk-btn--${entry.id} ${channel === entry.id ? 'nk-btn--on' : ''}`} onClick={() => setChannel(entry.id)} data-automation-id={`nuke-viewer-channel-${entry.id}`} title={`Kanal ${entry.label}`}>
              {entry.label}
            </button>
          ))}
          <button type="button" className={`nk-btn ${checker ? 'nk-btn--on' : ''}`} onClick={() => setChecker(!checker)} title="Schachbrett" data-automation-id="nuke-viewer-checker">
            <LayoutGrid size={12} />
          </button>
        </div>
        <CompViewer
          comp={comp}
          nodeId={viewerA}
          time={time}
          resolveMedia={resolveMedia}
          channel={channel}
          checker={checker}
          wipe={wipe && viewerB ? { nodeId: viewerB, position: wipePos, onPosition: setWipePos } : null}
          automationId="nuke-viewer-stage"
          emptyHint="Knoten wählen und 1 drücken"
        />
        <div className="nk-viewer__foot">
          <span>{getNode(comp, viewerA)?.name ?? '—'}{wipe && viewerB ? ` | ${getNode(comp, viewerB)?.name ?? ''}` : ''}</span>
          <span>
            {comp.width}×{comp.height} · Frame {Math.round(time * comp.fps)}
          </span>
        </div>
      </div>
      <div className="nk-dag">
        <div className="nk-dag__bar">
          <span className="nk-tag">Node Graph</span>
          <button type="button" className="nk-btn" onClick={() => setMenu({ query: '', index: 0 })} title="Knoten erstellen (Tab)" data-automation-id="nuke-tab-menu-open">
            Tab …
          </button>
          {NUKE_TOOLS.filter((def) => ['Read', 'Merge', 'Transform', 'Grade', 'Blur', 'Dot'].includes(def.id)).map((def) => (
            <button key={def.id} type="button" className="nk-btn" onClick={() => createTool(def)} title={`${def.label} (${def.short})`} data-automation-id={`nuke-create-${def.id}`} style={{ borderLeft: `3px solid ${nukeColor(buildToolNode(def, comp, { fxStack: () => [] }, { x: 0, y: 0 }) ?? getNode(comp, comp.outputNodeId)!)}` }}>
              {def.label}
            </button>
          ))}
          <span className="nk-spacer" />
          <button type="button" className="nk-btn" onClick={swapAB} disabled={active?.type !== 'merge'} title="A/B tauschen (Shift+X)" data-automation-id="nuke-swap-ab">A↔B</button>
          <button type="button" className="nk-btn" onClick={disable} disabled={!selectedNodeIds.length} title="Deaktivieren (D)" data-automation-id="nuke-disable">D</button>
          <button type="button" className="nk-btn" onClick={arrange} title="Automatisch anordnen" data-automation-id="nuke-arrange">Anordnen</button>
          <button type="button" className="nk-btn" onClick={() => graphRef.current?.fit()} title="Einpassen (F)" data-automation-id="nuke-fit">
            <Maximize2 size={12} />
          </button>
        </div>
        <div className="nk-dag__body">
          <NodeGraph
            ref={graphRef}
            comp={comp}
            variant="nuke"
            positionOf={positionOf}
            look={nukeLook}
            selectedIds={selectedNodeIds}
            onSelect={onSelect}
            onMove={(positions) => onChange(setNukePositions(comp, positions))}
            onConnect={(from, to, port) => {
              const target = getNode(comp, to);
              if (!target) return;
              const order = nukeInputs(target).map((input) => input.port);
              const chosen = port ?? order.find((entry) => !target.inputs[entry]) ?? order[0];
              if (chosen) onChange(connect(comp, from, to, chosen));
            }}
            onDisconnect={(to, port) => onChange(connect(comp, null, to, port))}
            onOpen={openPanel}
            extraWires={extraWires}
            decorations={
              <div className="nk-viewernode" style={{ left: viewerPos.x, top: viewerPos.y }} title="Viewer (1 = A, 2 = B)">
                Viewer1
              </div>
            }
            automationId="nuke-dag"
            emptyHint="Tab drücken, um einen Knoten zu erstellen"
          />
          {menu && (
            <div className="nk-menu" role="dialog" aria-label="Knoten erstellen" data-automation-id="nuke-tab-menu">
              <input
                autoFocus
                className="nk-menu__input"
                value={menu.query}
                placeholder="Knoten …"
                onChange={(event) => setMenu({ query: event.target.value, index: 0 })}
                onKeyDown={(event) => {
                  if (event.key === 'Escape' || event.key === 'Tab') setMenu(null);
                  else if (event.key === 'ArrowDown') setMenu({ ...menu, index: Math.min(results.length - 1, menu.index + 1) });
                  else if (event.key === 'ArrowUp') setMenu({ ...menu, index: Math.max(0, menu.index - 1) });
                  else if (event.key === 'Enter' && results[menu.index]) {
                    createTool(results[menu.index]);
                    setMenu(null);
                  } else return;
                  event.preventDefault();
                  event.stopPropagation();
                }}
                data-automation-id="nuke-tab-menu-input"
              />
              <div className="nk-menu__list">
                {results.map((def, index) => (
                  <button
                    key={def.id}
                    type="button"
                    className={`nk-menu__item ${index === menu.index ? 'nk-menu__item--on' : ''}`}
                    onMouseEnter={() => setMenu({ ...menu, index })}
                    onClick={() => {
                      createTool(def);
                      setMenu(null);
                    }}
                    data-automation-id={`nuke-tab-menu-item-${def.id}`}
                  >
                    <span>{def.label}</span>
                    <small>{def.description}</small>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
      <aside className="nk-bin" data-automation-id="nuke-properties">
        <div className="nk-bin__bar">
          <span className="nk-tag">Properties</span>
          <span className="nk-spacer" />
          <span className="nk-bin__count" title="Maximal offene Panels">{panels.length}/{MAX_PANELS}</span>
          <button type="button" className="nk-btn" onClick={() => setPanels([])} title="Alle Panels schließen" data-automation-id="nuke-properties-clear">
            <X size={12} />
          </button>
        </div>
        <div className="nk-bin__body">
          {panels.length === 0 && <p className="pe-hint">Knoten doppelklicken oder auswählen, um seine Eigenschaften zu öffnen.</p>}
          {panels.map((id) => {
            const node = getNode(comp, id);
            if (!node) return null;
            const isCollapsed = collapsed.has(id);
            return (
              <section key={id} className={`nk-panel ${selectedNodeIds.includes(id) ? 'nk-panel--selected' : ''}`} data-automation-id={`nuke-panel-${node.name}`}>
                <header className="nk-panel__head" style={{ borderLeftColor: nukeColor(node) }}>
                  <button type="button" className="nk-panel__toggle" onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; })} data-automation-id={`nuke-panel-${node.name}-collapse`} title="Ein-/Ausklappen">
                    {isCollapsed ? '▸' : '▾'}
                  </button>
                  <input className="nk-panel__name" value={node.name} onChange={(event) => onChange({ ...comp, nodes: comp.nodes.map((entry) => (entry.id === id ? { ...entry, name: event.target.value } : entry)) })} data-automation-id={`nuke-panel-${node.name}-name`} />
                  <small>{nukeClassName(node)}</small>
                  {node.id !== comp.outputNodeId && (
                    <label className="nk-panel__disable" title="disable (D)">
                      <input type="checkbox" checked={!node.enabled} onChange={() => onChange(togglePassthrough(comp, [id]))} data-automation-id={`nuke-panel-${node.name}-disable`} />
                      disable
                    </label>
                  )}
                  <button type="button" className="nk-panel__close" onClick={() => setPanels((prev) => prev.filter((entry) => entry !== id))} title="Panel schließen" data-automation-id={`nuke-panel-${node.name}-close`}>
                    <X size={11} />
                  </button>
                </header>
                {!isCollapsed && (
                  <div className="nk-panel__body">
                    <ParamEditor comp={comp} node={node} time={time} mediaItems={mediaItems} variant="nuke" onNodeChange={(next) => onChange({ ...comp, nodes: comp.nodes.map((entry) => (entry.id === next.id ? next : entry)) })} onCompChange={onChange} onTimeChange={onTimeChange} automationId="nuke-panel" />
                    {node.type === 'output' && props.onRenderToMedia && (
                      <button type="button" className="nk-btn nk-btn--render" onClick={props.onRenderToMedia} data-automation-id="nuke-write-render">
                        Render (Frame-Range → Medien)
                      </button>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      </aside>
      <div className="nk-time">
        <TimeBar
          comp={comp}
          time={time}
          onTimeChange={onTimeChange}
          range={props.renderRange ?? range}
          onRangeChange={(next) => (props.onRenderRangeChange ? props.onRenderRangeChange(next) : onChange(setRenderRange(comp, next)))}
          keyTimes={keyframeTimes(active)}
          playing={props.playing}
          onPlayingChange={props.onPlayingChange}
          variant="nuke"
          automationId="nuke-timebar"
        />
      </div>
    </div>
  );
};

export default NukeView;
