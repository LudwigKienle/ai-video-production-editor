import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, Handle, MiniMap, Position } from 'reactflow';
import type { Edge, Node, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { MediaItem } from '../types';
import {
  createNatronCompositeTemplate,
  deriveNatronCompositeSettings,
  natronBlendModeOptions,
  natronViewerChannelOptions,
  summarizeNatronGraph,
  updateNatronNode,
  type NatronCompositorGraph,
  type NatronCompositorNode,
} from '../utils/natronCompositorGraph';

type NatronCompositorPanelProps = {
  mediaItems: MediaItem[];
  onAddGeneratedMedia: (item: MediaItem) => void;
};

type NatronFlowNodeData = {
  node: NatronCompositorNode;
};

const loadCanvasImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be loaded for canvas compositing.'));
    img.src = url;
  });

const clampByte = (value: number) => Math.max(0, Math.min(255, value));

const parseHexColor = (hex: string) => {
  const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex : '#00ff00';
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16),
  };
};

const copyToCanvas = (source: HTMLImageElement | HTMLCanvasElement) => {
  const canvas = document.createElement('canvas');
  canvas.width = 'naturalWidth' in source ? source.naturalWidth || source.width : source.width;
  canvas.height = 'naturalHeight' in source ? source.naturalHeight || source.height : source.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');
  ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas;
};

const applyChromaKey = (
  image: HTMLImageElement,
  keyer: ReturnType<typeof deriveNatronCompositeSettings>['keyer'],
) => {
  const canvas = copyToCanvas(image);
  if (!keyer.enabled) return canvas;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const keyColor = parseHexColor(keyer.keyColor);
  const maxDistance = Math.sqrt(255 * 255 * 3);
  const threshold = keyer.tolerance;
  const softness = keyer.softness;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const distance = Math.sqrt(
      (r - keyColor.r) ** 2 +
      (g - keyColor.g) ** 2 +
      (b - keyColor.b) ** 2,
    ) / maxDistance;

    let matte = 1;
    if (distance <= threshold) {
      matte = 0;
    } else if (softness > 0 && distance < threshold + softness) {
      matte = (distance - threshold) / softness;
    }

    const spillWindow = Math.max(0, 1 - Math.max(0, distance - threshold) / Math.max(softness + 0.2, 0.2));
    const spill = spillWindow * keyer.despill;
    if (keyColor.g >= keyColor.r && keyColor.g >= keyColor.b) {
      data[i + 1] = clampByte(g * (1 - spill) + Math.max(r, b) * spill);
    } else if (keyColor.r >= keyColor.g && keyColor.r >= keyColor.b) {
      data[i] = clampByte(r * (1 - spill) + Math.max(g, b) * spill);
    } else {
      data[i + 2] = clampByte(b * (1 - spill) + Math.max(r, g) * spill);
    }
    data[i + 3] = clampByte(data[i + 3] * matte);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

const gradeImage = (
  image: HTMLImageElement | HTMLCanvasElement,
  grade: ReturnType<typeof deriveNatronCompositeSettings>['grade'],
) => {
  const canvas = copyToCanvas(image);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas not available.');

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  const exposureGain = 2 ** grade.exposure;
  const invGamma = 1 / grade.gamma;

  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] / 255;
    let g = data[i + 1] / 255;
    let b = data[i + 2] / 255;
    const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;

    r = luma + (r - luma) * grade.saturation;
    g = luma + (g - luma) * grade.saturation;
    b = luma + (b - luma) * grade.saturation;

    data[i] = clampByte(Math.pow(Math.max(0, r * exposureGain), invGamma) * 255);
    data[i + 1] = clampByte(Math.pow(Math.max(0, g * exposureGain), invGamma) * 255);
    data[i + 2] = clampByte(Math.pow(Math.max(0, b * exposureGain), invGamma) * 255);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

const applyViewerChannel = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  channel: ReturnType<typeof deriveNatronCompositeSettings>['viewerChannel'],
) => {
  if (channel === 'rgba') return;
  const imageData = ctx.getImageData(0, 0, width, height);
  const data = imageData.data;

  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const a = data[i + 3];
    if (channel === 'red') {
      data[i + 1] = 0;
      data[i + 2] = 0;
    } else if (channel === 'green') {
      data[i] = 0;
      data[i + 2] = 0;
    } else if (channel === 'blue') {
      data[i] = 0;
      data[i + 1] = 0;
    } else if (channel === 'alpha') {
      data[i] = a;
      data[i + 1] = a;
      data[i + 2] = a;
      data[i + 3] = 255;
    } else if (channel === 'matte') {
      const matte = Math.max(a, Math.round((r + g + b) / 3));
      data[i] = Math.round(matte * 0.15);
      data[i + 1] = matte;
      data[i + 2] = Math.round(matte * 0.45);
      data[i + 3] = 255;
    }
  }

  ctx.putImageData(imageData, 0, 0);
};

const NatronFlowNode: React.FC<NodeProps<NatronFlowNodeData>> = ({ data, selected }) => {
  const node = data.node;
  const toneByKind: Record<string, string> = {
    read: 'border-sky-400/55 text-sky-200',
    keyer: 'border-lime-400/55 text-lime-200',
    transform: 'border-cyan-400/55 text-cyan-200',
    grade: 'border-amber-400/55 text-amber-200',
    merge: 'border-emerald-400/55 text-emerald-200',
    viewer: 'border-indigo-400/65 text-indigo-200',
    write: 'border-fuchsia-400/55 text-fuchsia-200',
  };
  const canReceive = node.kind !== 'read';
  const canOutput = node.kind !== 'viewer' && node.kind !== 'write';

  return (
    <div
      className={`min-w-[150px] rounded-lg border bg-gray-950/95 px-3 py-2 shadow-xl ${
        toneByKind[node.kind]
      } ${selected ? 'ring-2 ring-white/50' : ''}`}
    >
      {node.kind === 'merge' && (
        <>
          <Handle type="target" id="A" position={Position.Left} style={{ top: '35%', background: '#34d399' }} />
          <Handle type="target" id="B" position={Position.Left} style={{ top: '68%', background: '#60a5fa' }} />
        </>
      )}
      {canReceive && node.kind !== 'merge' && <Handle type="target" id="input" position={Position.Left} />}
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">{node.kind}</div>
      <div className="mt-1 text-sm font-semibold text-gray-100">{node.label}</div>
      {node.kind === 'read' && (
        <div className="mt-1 text-[10px] text-gray-500">
          {node.role === 'A' ? 'foreground' : 'background'}
        </div>
      )}
      {node.kind === 'merge' && node.disabled && <div className="mt-1 text-[10px] text-amber-300">B passthrough</div>}
      {canOutput && <Handle type="source" id="out" position={Position.Right} />}
    </div>
  );
};

const nodeTypes = { natronNode: NatronFlowNode };

const numberParam = (node: NatronCompositorNode | undefined, key: string, fallback: number) => {
  const value = node?.params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const textForBlendMode = (mode: string) => {
  if (mode === 'source-over') return 'normal';
  return mode;
};

const NatronCompositorPanel: React.FC<NatronCompositorPanelProps> = ({ mediaItems, onAddGeneratedMedia }) => {
  const imageMediaItems = useMemo(() => mediaItems.filter((item) => item.type === 'image'), [mediaItems]);
  const defaultsAppliedRef = useRef(false);
  const [graph, setGraph] = useState<NatronCompositorGraph>(() => createNatronCompositeTemplate());
  const [selectedNodeId, setSelectedNodeId] = useState('merge-main');
  const [status, setStatus] = useState<string | null>(null);
  const [result, setResult] = useState<MediaItem | null>(null);
  const [isRendering, setIsRendering] = useState(false);

  useEffect(() => {
    if (defaultsAppliedRef.current || imageMediaItems.length === 0) return;
    defaultsAppliedRef.current = true;
    setGraph(createNatronCompositeTemplate({
      backgroundMediaId: imageMediaItems[0]?.id || '',
      foregroundMediaId: imageMediaItems[1]?.id || '',
    }));
  }, [imageMediaItems]);

  const settings = useMemo(() => deriveNatronCompositeSettings(graph), [graph]);
  const summary = useMemo(() => summarizeNatronGraph(graph), [graph]);
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) || graph.nodes[0];
  const selectedBackground = imageMediaItems.find((item) => item.id === settings.backgroundMediaId) || null;
  const selectedForeground = imageMediaItems.find((item) => item.id === settings.foregroundMediaId) || null;

  const flowNodes = useMemo<Node<NatronFlowNodeData>[]>(() => graph.nodes.map((node) => ({
    id: node.id,
    type: 'natronNode',
    position: node.position,
    data: { node },
  })), [graph.nodes]);

  const flowEdges = useMemo<Edge[]>(() => graph.edges.map((edge) => ({
    ...edge,
    type: 'smoothstep',
    animated: edge.target === graph.viewerNodeId,
    style: { stroke: edge.targetHandle === 'A' ? '#34d399' : edge.targetHandle === 'B' ? '#60a5fa' : '#818cf8' },
  })), [graph.edges, graph.viewerNodeId]);

  const updateNode = (nodeId: string, updates: Parameters<typeof updateNatronNode>[2]) => {
    setGraph((prev) => updateNatronNode(prev, nodeId, updates));
  };

  const updateSelectedParam = (key: string, value: unknown) => {
    if (!selectedNode) return;
    updateNode(selectedNode.id, { params: { [key]: value } });
  };

  const resetTemplate = () => {
    setGraph(createNatronCompositeTemplate({
      backgroundMediaId: settings.backgroundMediaId,
      foregroundMediaId: settings.foregroundMediaId,
    }));
    setSelectedNodeId('merge-main');
    setStatus('Template graph reset.');
  };

  const swapInputs = () => {
    setGraph((prev) =>
      updateNatronNode(
        updateNatronNode(prev, 'read-bg', { mediaId: settings.foregroundMediaId }),
        'read-fg',
        { mediaId: settings.backgroundMediaId },
      )
    );
  };

  const renderGraph = async () => {
    if (!selectedBackground) {
      setStatus('Choose a Read B background image.');
      return;
    }

    setIsRendering(true);
    setStatus('Rendering node graph...');
    try {
      const background = await loadCanvasImage(selectedBackground.url);
      const canvas = document.createElement('canvas');
      canvas.width = background.naturalWidth || background.width;
      canvas.height = background.naturalHeight || background.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas not available.');

      ctx.drawImage(background, 0, 0, canvas.width, canvas.height);

      if (!settings.mergeDisabled && selectedForeground) {
        const foreground = await loadCanvasImage(selectedForeground.url);
        const keyedForeground = applyChromaKey(foreground, settings.keyer);
        const gradedForeground = gradeImage(keyedForeground, settings.grade);
        const width = canvas.width * settings.transform.scale;
        const height = canvas.height * settings.transform.scale;

        ctx.save();
        ctx.globalCompositeOperation = settings.blendMode;
        ctx.globalAlpha = settings.opacity;
        ctx.translate(
          canvas.width / 2 + settings.transform.translateX,
          canvas.height / 2 + settings.transform.translateY,
        );
        ctx.rotate((settings.transform.rotation * Math.PI) / 180);
        ctx.drawImage(gradedForeground, -width / 2, -height / 2, width, height);
        ctx.restore();
      }

      applyViewerChannel(ctx, canvas.width, canvas.height, settings.viewerChannel);

      const now = Date.now();
      const item: MediaItem = {
        id: `natron-composite-${now}`,
        name: `natron_node_composite_${now}.png`,
        type: 'image',
        url: canvas.toDataURL('image/png'),
        source: 'generated',
        generatedBy: 'Natron-style Node Composite',
        prompt: `${summary.foregroundPath}; ${summary.backgroundPath}; blend ${textForBlendMode(settings.blendMode)} at ${Math.round(settings.opacity * 100)}%.`,
      };

      setResult(item);
      onAddGeneratedMedia(item);
      setStatus('Node graph render added to your project.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Node graph render failed.');
    } finally {
      setIsRendering(false);
    }
  };

  const renderProperties = () => {
    if (!selectedNode) return <div className="text-xs text-gray-500">Select a node.</div>;

    if (selectedNode.kind === 'read') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">{selectedNode.label}</div>
          <select
            value={selectedNode.mediaId || ''}
            onChange={(event) => updateNode(selectedNode.id, { mediaId: event.target.value })}
            className="app-select"
          >
            <option value="">Select project image...</option>
            {imageMediaItems.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </div>
      );
    }

    if (selectedNode.kind === 'transform') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Transform</div>
          <div className="grid grid-cols-2 gap-3">
            <label className="text-xs text-gray-300">X
              <input
                type="number"
                value={numberParam(selectedNode, 'translateX', 0)}
                onChange={(event) => updateSelectedParam('translateX', Number(event.target.value) || 0)}
                className="app-input mt-1"
              />
            </label>
            <label className="text-xs text-gray-300">Y
              <input
                type="number"
                value={numberParam(selectedNode, 'translateY', 0)}
                onChange={(event) => updateSelectedParam('translateY', Number(event.target.value) || 0)}
                className="app-input mt-1"
              />
            </label>
          </div>
          <label className="block text-xs text-gray-300">Scale
            <input
              type="range"
              min={0.1}
              max={2}
              step={0.01}
              value={numberParam(selectedNode, 'scale', 1)}
              onChange={(event) => updateSelectedParam('scale', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="block text-xs text-gray-300">Rotation
            <input
              type="range"
              min={-180}
              max={180}
              step={1}
              value={numberParam(selectedNode, 'rotation', 0)}
              onChange={(event) => updateSelectedParam('rotation', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
        </div>
      );
    }

    if (selectedNode.kind === 'keyer') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Keyer</div>
          <label className="block text-xs text-gray-300">Key color
            <input
              type="color"
              value={String(selectedNode.params.keyColor || '#00ff00')}
              onChange={(event) => updateSelectedParam('keyColor', event.target.value)}
              className="mt-2 h-10 w-full rounded border border-white/10 bg-black/40"
            />
          </label>
          <label className="block text-xs text-gray-300">
            Tolerance {Math.round(settings.keyer.tolerance * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={numberParam(selectedNode, 'tolerance', 0.28)}
              onChange={(event) => updateSelectedParam('tolerance', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="block text-xs text-gray-300">
            Softness {Math.round(settings.keyer.softness * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={numberParam(selectedNode, 'softness', 0.12)}
              onChange={(event) => updateSelectedParam('softness', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="block text-xs text-gray-300">
            Despill {Math.round(settings.keyer.despill * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={numberParam(selectedNode, 'despill', 0.35)}
              onChange={(event) => updateSelectedParam('despill', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={Boolean(selectedNode.disabled)}
              onChange={(event) => updateNode(selectedNode.id, { disabled: event.target.checked })}
            />
            Disable keyer
          </label>
        </div>
      );
    }

    if (selectedNode.kind === 'grade') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Grade</div>
          <label className="block text-xs text-gray-300">Exposure
            <input
              type="range"
              min={-2}
              max={2}
              step={0.05}
              value={numberParam(selectedNode, 'exposure', 0)}
              onChange={(event) => updateSelectedParam('exposure', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="block text-xs text-gray-300">Gamma
            <input
              type="range"
              min={0.2}
              max={3}
              step={0.05}
              value={numberParam(selectedNode, 'gamma', 1)}
              onChange={(event) => updateSelectedParam('gamma', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="block text-xs text-gray-300">Saturation
            <input
              type="range"
              min={0}
              max={2}
              step={0.05}
              value={numberParam(selectedNode, 'saturation', 1)}
              onChange={(event) => updateSelectedParam('saturation', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
        </div>
      );
    }

    if (selectedNode.kind === 'merge') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Merge A over B</div>
          <select
            value={String(selectedNode.params.mode || 'source-over')}
            onChange={(event) => updateSelectedParam('mode', event.target.value)}
            className="app-select"
          >
            {natronBlendModeOptions.map((mode) => (
              <option key={mode} value={mode}>{textForBlendMode(mode)}</option>
            ))}
          </select>
          <label className="block text-xs text-gray-300">Opacity {Math.round(settings.opacity * 100)}%
            <input
              type="range"
              min={0}
              max={1}
              step={0.01}
              value={numberParam(selectedNode, 'opacity', 0.8)}
              onChange={(event) => updateSelectedParam('opacity', Number(event.target.value))}
              className="mt-2 w-full"
            />
          </label>
          <label className="flex items-center gap-2 text-xs text-gray-300">
            <input
              type="checkbox"
              checked={Boolean(selectedNode.disabled)}
              onChange={(event) => updateNode(selectedNode.id, { disabled: event.target.checked })}
            />
            Disable merge
          </label>
        </div>
      );
    }

    if (selectedNode.kind === 'viewer') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Viewer</div>
          <select
            value={String(selectedNode.params.channel || 'rgba')}
            onChange={(event) => updateSelectedParam('channel', event.target.value)}
            className="app-select"
          >
            {natronViewerChannelOptions.map((channel) => (
              <option key={channel} value={channel}>{channel.toUpperCase()}</option>
            ))}
          </select>
        </div>
      );
    }

    return (
      <div className="space-y-2 text-xs text-gray-400">
        <div className="uppercase tracking-[0.18em] text-gray-500">{selectedNode.label}</div>
        <div>{selectedNode.kind === 'write' ? 'PNG output node.' : 'Select a processing node to edit parameters.'}</div>
      </div>
    );
  };

  return (
    <section className="app-panel p-5 space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Natron Node Composite</div>
          <p className="text-xs text-gray-500 mt-1">Read A/B plates, grade the foreground, merge, view, and write a PNG render.</p>
        </div>
        <div className="text-[10px] uppercase tracking-[0.18em] text-indigo-300">Read / Merge / Viewer</div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_360px]">
        <div className="rounded-lg border border-white/10 bg-black/35 overflow-hidden" style={{ width: '100%', height: 360 }}>
          <ReactFlow
            className="h-full w-full"
            nodes={flowNodes}
            edges={flowEdges}
            nodeTypes={nodeTypes}
            fitView
            nodesDraggable={false}
            onNodeClick={(_event, node) => setSelectedNodeId(node.id)}
            proOptions={{ hideAttribution: true }}
          >
            <Background color="#334155" gap={22} />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable nodeStrokeWidth={3} />
          </ReactFlow>
        </div>

        <div className="app-card p-4 space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Properties</div>
              <div className="text-sm text-gray-200">{selectedNode?.label || 'None'}</div>
            </div>
            <button type="button" className="app-button app-secondary text-xs" onClick={resetTemplate}>
              Reset
            </button>
          </div>
          {renderProperties()}
          <div className="grid grid-cols-2 gap-2">
            <button type="button" className="app-button app-secondary text-xs" onClick={swapInputs}>
              Swap A/B
            </button>
            <button
              type="button"
              className="app-button app-primary text-xs disabled:opacity-50"
              onClick={renderGraph}
              disabled={isRendering || !selectedBackground}
            >
              {isRendering ? 'Rendering...' : 'Render Graph'}
            </button>
          </div>
          {status && <p className="text-xs text-gray-300">{status}</p>}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-sky-300">Read B</div>
          <div className="mt-2 aspect-video rounded bg-black/60 overflow-hidden flex items-center justify-center text-xs text-gray-500">
            {selectedBackground ? (
              <img src={selectedBackground.url} alt="Read B preview" className="h-full w-full object-cover" />
            ) : 'No background'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-emerald-300">Read A</div>
          <div className="mt-2 aspect-video rounded bg-black/60 overflow-hidden flex items-center justify-center text-xs text-gray-500">
            {selectedForeground ? (
              <img src={selectedForeground.url} alt="Read A preview" className="h-full w-full object-cover" />
            ) : 'No foreground'}
          </div>
        </div>
        <div className="rounded-lg border border-white/10 bg-black/25 p-3">
          <div className="text-[10px] uppercase tracking-[0.18em] text-indigo-300">Viewer</div>
          <div className="mt-2 aspect-video rounded bg-black/60 overflow-hidden flex items-center justify-center text-xs text-gray-500">
            {result ? (
              <img src={result.url} alt="Node graph render" className="h-full w-full object-cover" />
            ) : 'Render output'}
          </div>
        </div>
      </div>

      <div className="grid gap-2 text-[11px] text-gray-500 md:grid-cols-3">
        <div>{summary.backgroundPath}</div>
        <div>{summary.foregroundPath}</div>
        <div>{summary.writePath}</div>
      </div>
    </section>
  );
};

export default NatronCompositorPanel;
