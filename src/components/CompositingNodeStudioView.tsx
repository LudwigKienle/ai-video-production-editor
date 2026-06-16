import React, { useEffect, useMemo, useRef, useState } from 'react';
import ReactFlow, { Background, Controls, Handle, MiniMap, Position } from 'reactflow';
import type { Edge, Node, NodeProps } from 'reactflow';
import 'reactflow/dist/style.css';
import { MediaItem } from '../types';
import {
  NODE_STUDIO_EFFECT_GROUPS,
  NODE_STUDIO_GRAPH_HEIGHT_LIMITS,
  NODE_STUDIO_PALETTE_VIEW_MODES,
  NODE_STUDIO_PANEL_LIMITS,
  NODE_STUDIO_TIMELINE_TRACKS,
  buildNodeStudioRenderSummary,
  clampNodeStudioGraphHeight,
  clampNodeStudioPanelWidth,
  deriveNodeStudioPreviewPlan,
  type NodeStudioEffect,
  type NodeStudioPaletteViewMode,
  type NodeStudioResizablePanel,
} from '../utils/compositingNodeStudio';
import {
  createNatronCompositeTemplate,
  deriveNatronCompositeSettings,
  natronBlendModeOptions,
  natronViewerChannelOptions,
  updateNatronNode,
  type NatronCompositorGraph,
  type NatronCompositorNode,
} from '../utils/natronCompositorGraph';

type CompositingNodeStudioViewProps = {
  mediaItems: MediaItem[];
  onAddGeneratedMedia: (item: MediaItem) => void;
};

type StudioNodeData = {
  label: string;
  kind: string;
  role?: string;
  description?: string;
  muted?: boolean;
};

type AiNodeSettings = {
  prompt: string;
  model: string;
  strength: number;
  maskMode: string;
  status: 'draft' | 'queued';
};

const kindTone: Record<string, string> = {
  read: 'border-sky-400/60 text-sky-200',
  keyer: 'border-lime-400/60 text-lime-200',
  transform: 'border-cyan-400/60 text-cyan-200',
  grade: 'border-amber-400/60 text-amber-200',
  merge: 'border-emerald-400/60 text-emerald-200',
  viewer: 'border-indigo-400/70 text-indigo-200',
  write: 'border-fuchsia-400/60 text-fuchsia-200',
  matte: 'border-lime-400/60 text-lime-200',
  tracking: 'border-orange-400/60 text-orange-200',
  color: 'border-amber-400/60 text-amber-200',
  effect: 'border-violet-400/60 text-violet-200',
  ai: 'border-cyan-300/70 text-cyan-100',
  composite: 'border-emerald-400/60 text-emerald-200',
  output: 'border-fuchsia-400/60 text-fuchsia-200',
  io: 'border-sky-400/60 text-sky-200',
};

const StudioFlowNode: React.FC<NodeProps<StudioNodeData>> = ({ data, selected }) => {
  const canReceive = data.kind !== 'read' && data.kind !== 'io';
  const canOutput = data.kind !== 'viewer' && data.kind !== 'write' && data.kind !== 'output';
  const tone = kindTone[data.kind] || 'border-gray-500/70 text-gray-200';

  return (
    <div
      className={`min-w-[150px] rounded-lg border bg-gray-950/95 px-3 py-2 shadow-xl ${tone} ${
        selected ? 'ring-2 ring-white/50' : ''
      } ${data.muted ? 'opacity-50' : ''}`}
    >
      {data.kind === 'merge' && (
        <>
          <Handle type="target" id="A" position={Position.Left} style={{ top: '35%', background: '#34d399' }} />
          <Handle type="target" id="B" position={Position.Left} style={{ top: '68%', background: '#60a5fa' }} />
        </>
      )}
      {canReceive && data.kind !== 'merge' && <Handle type="target" id="input" position={Position.Left} />}
      <div className="text-[10px] uppercase tracking-[0.18em] opacity-70">{data.kind}</div>
      <div className="mt-1 text-sm font-semibold text-gray-100">{data.label}</div>
      {data.role && <div className="mt-1 text-[10px] text-gray-500">{data.role}</div>}
      {canOutput && <Handle type="source" id="out" position={Position.Right} />}
    </div>
  );
};

const nodeTypes = { studioNode: StudioFlowNode };

const textForBlendMode = (mode: string) => (mode === 'source-over' ? 'normal' : mode);

const numberParam = (node: NatronCompositorNode | undefined, key: string, fallback: number) => {
  const value = node?.params[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const loadCanvasImage = (url: string): Promise<HTMLImageElement> =>
  new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image could not be loaded for node studio rendering.'));
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

const drawViewerGuides = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  options: { matteOverlay: boolean; motionOverlay: boolean },
) => {
  if (options.matteOverlay) {
    const insetX = width * 0.09;
    const insetY = height * 0.09;
    ctx.save();
    ctx.strokeStyle = 'rgba(190, 242, 100, 0.86)';
    ctx.fillStyle = 'rgba(132, 204, 22, 0.06)';
    ctx.lineWidth = Math.max(2, width * 0.003);
    ctx.fillRect(insetX, insetY, width - insetX * 2, height - insetY * 2);
    ctx.strokeRect(insetX, insetY, width - insetX * 2, height - insetY * 2);
    ctx.restore();
  }

  if (options.motionOverlay) {
    const points = [
      { x: width * 0.31, y: height * 0.36 },
      { x: width * 0.58, y: height * 0.52 },
    ];
    ctx.save();
    ctx.strokeStyle = 'rgba(251, 146, 60, 0.9)';
    ctx.lineWidth = Math.max(2, width * 0.0025);
    points.forEach((point) => {
      ctx.beginPath();
      ctx.arc(point.x, point.y, Math.max(9, width * 0.012), 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(point.x - 12, point.y);
      ctx.lineTo(point.x + 12, point.y);
      ctx.moveTo(point.x, point.y - 12);
      ctx.lineTo(point.x, point.y + 12);
      ctx.stroke();
    });
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    ctx.lineTo(points[1].x, points[1].y);
    ctx.stroke();
    ctx.restore();
  }
};

const drawDeterministicGrain = (
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  opacity: number,
) => {
  if (opacity <= 0) return;
  ctx.save();
  ctx.globalAlpha = opacity;
  ctx.globalCompositeOperation = 'overlay';
  const spacing = Math.max(4, Math.round(Math.min(width, height) / 110));
  for (let y = 0; y < height; y += spacing) {
    for (let x = 0; x < width; x += spacing) {
      const value = (x * 13 + y * 17 + x * y) % 255;
      ctx.fillStyle = value > 127 ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.75)';
      ctx.fillRect(x, y, 1, 1);
    }
  }
  ctx.restore();
};

const drawLensFlare = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const gradient = ctx.createRadialGradient(width * 0.23, height * 0.28, 0, width * 0.23, height * 0.28, width * 0.32);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  gradient.addColorStop(0.18, 'rgba(125, 211, 252, 0.36)');
  gradient.addColorStop(1, 'rgba(125, 211, 252, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = 'rgba(186, 230, 253, 0.52)';
  ctx.lineWidth = Math.max(2, width * 0.004);
  ctx.beginPath();
  ctx.moveTo(width * 0.08, height * 0.31);
  ctx.lineTo(width * 0.94, height * 0.45);
  ctx.stroke();
  [
    { x: 0.43, y: 0.38, r: 0.035 },
    { x: 0.58, y: 0.41, r: 0.02 },
    { x: 0.72, y: 0.44, r: 0.045 },
  ].forEach((flare) => {
    ctx.beginPath();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
    ctx.arc(width * flare.x, height * flare.y, width * flare.r, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
};

const drawInpaintOverlay = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
  ctx.save();
  ctx.strokeStyle = 'rgba(34, 211, 238, 0.88)';
  ctx.fillStyle = 'rgba(34, 211, 238, 0.08)';
  ctx.lineWidth = Math.max(2, width * 0.003);
  const x = width * 0.34;
  const y = height * 0.28;
  const w = width * 0.28;
  const h = height * 0.28;
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(8, width * 0.012));
  ctx.fill();
  ctx.stroke();
  ctx.restore();
};

const CompositingNodeStudioView: React.FC<CompositingNodeStudioViewProps> = ({ mediaItems, onAddGeneratedMedia }) => {
  const imageMediaItems = useMemo(() => mediaItems.filter((item) => item.type === 'image'), [mediaItems]);
  const videoMediaItems = useMemo(() => mediaItems.filter((item) => item.type === 'video'), [mediaItems]);
  const defaultsAppliedRef = useRef(false);
  const effectInstanceCounterRef = useRef(0);
  const [graph, setGraph] = useState<NatronCompositorGraph>(() => createNatronCompositeTemplate());
  const [selectedNodeId, setSelectedNodeId] = useState('viewer-1');
  const [addedEffects, setAddedEffects] = useState<Array<NodeStudioEffect & { instanceId: string }>>([]);
  const [selectedEffectId, setSelectedEffectId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(36);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isRendering, setIsRendering] = useState(false);
  const [renderStatus, setRenderStatus] = useState<string | null>(null);
  const [renderResult, setRenderResult] = useState<MediaItem | null>(null);
  const [aiNodeSettings, setAiNodeSettings] = useState<Record<string, AiNodeSettings>>({});
  const [paletteViewMode, setPaletteViewMode] = useState<NodeStudioPaletteViewMode>('gallery');
  const [paletteWidth, setPaletteWidth] = useState(NODE_STUDIO_PANEL_LIMITS.palette.default);
  const [inspectorWidth, setInspectorWidth] = useState(NODE_STUDIO_PANEL_LIMITS.inspector.default);
  const [graphHeight, setGraphHeight] = useState(NODE_STUDIO_GRAPH_HEIGHT_LIMITS.default);

  useEffect(() => {
    if (defaultsAppliedRef.current || imageMediaItems.length === 0) return;
    defaultsAppliedRef.current = true;
    setGraph(createNatronCompositeTemplate({
      backgroundMediaId: imageMediaItems[0]?.id || '',
      foregroundMediaId: imageMediaItems[1]?.id || '',
    }));
  }, [imageMediaItems]);

  const settings = useMemo(() => deriveNatronCompositeSettings(graph), [graph]);
  const selectedBackground = imageMediaItems.find((item) => item.id === settings.backgroundMediaId) || null;
  const selectedForeground = imageMediaItems.find((item) => item.id === settings.foregroundMediaId) || null;
  const selectedNode = graph.nodes.find((node) => node.id === selectedNodeId) || null;
  const selectedEffect = addedEffects.find((effect) => effect.instanceId === selectedEffectId) || null;
  const previewPlan = useMemo(() => deriveNodeStudioPreviewPlan(addedEffects), [addedEffects]);
  const mixBlendMode = textForBlendMode(settings.blendMode) as React.CSSProperties['mixBlendMode'];
  const foregroundOpacity = Math.max(0, Math.min(1, settings.opacity * previewPlan.foregroundOpacityMultiplier));
  const foregroundFilter = [
    previewPlan.foregroundFilter === 'none' ? '' : previewPlan.foregroundFilter,
    previewPlan.glowEnabled ? 'drop-shadow(0 0 18px rgba(125, 211, 252, 0.72))' : '',
  ].filter(Boolean).join(' ') || undefined;
  const aiNodes = addedEffects.filter((effect) => effect.kind === 'ai');

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => (current >= 120 ? 0 : current + 1));
    }, 120);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const updateNode = (nodeId: string, updates: Parameters<typeof updateNatronNode>[2]) => {
    setGraph((prev) => updateNatronNode(prev, nodeId, updates));
  };

  const updateSelectedParam = (key: string, value: unknown) => {
    if (!selectedNode) return;
    updateNode(selectedNode.id, { params: { [key]: value } });
  };

  const addEffectNode = (effect: NodeStudioEffect) => {
    effectInstanceCounterRef.current += 1;
    const instanceId = `${effect.id}-${Date.now()}-${effectInstanceCounterRef.current}`;
    setAddedEffects((prev) => [...prev, { ...effect, instanceId }]);
    if (effect.kind === 'ai') {
      setAiNodeSettings((prev) => ({
        ...prev,
        [instanceId]: {
          prompt: '',
          model: effect.id.includes('video') ? 'Video generation model' : 'Image generation/edit model',
          strength: effect.id.includes('inpaint') ? 0.65 : 0.5,
          maskMode: effect.id.includes('mask') || effect.id.includes('roto') || effect.id.includes('inpaint')
            ? 'Prompt mask'
            : 'Full frame',
          status: 'draft',
        },
      }));
    }
    setSelectedEffectId(instanceId);
    setSelectedNodeId(instanceId);
  };

  const updateAiNodeSetting = (instanceId: string, updates: Partial<AiNodeSettings>) => {
    setAiNodeSettings((prev) => ({
      ...prev,
      [instanceId]: {
        ...(prev[instanceId] || {
          prompt: '',
          model: 'Image generation/edit model',
          strength: 0.5,
          maskMode: 'Full frame',
          status: 'draft',
        }),
        ...updates,
      },
    }));
  };

  const queueAiNode = (instanceId: string) => {
    const effect = addedEffects.find((item) => item.instanceId === instanceId);
    if (!effect) return;
    updateAiNodeSetting(instanceId, { status: 'queued' });
    setRenderStatus(`${effect.label} staged in the AI layer.`);
  };

  const startPanelResize = (panel: NodeStudioResizablePanel, event: React.PointerEvent<HTMLButtonElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = panel === 'palette' ? paletteWidth : inspectorWidth;

    const handlePointerMove = (moveEvent: PointerEvent) => {
      const delta = moveEvent.clientX - startX;
      const nextWidth = panel === 'palette' ? startWidth + delta : startWidth - delta;
      if (panel === 'palette') {
        setPaletteWidth(clampNodeStudioPanelWidth('palette', nextWidth));
      } else {
        setInspectorWidth(clampNodeStudioPanelWidth('inspector', nextWidth));
      }
    };

    const stopResize = () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', stopResize);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', stopResize);
  };

  const resetPanelLayout = () => {
    setPaletteWidth(NODE_STUDIO_PANEL_LIMITS.palette.default);
    setInspectorWidth(NODE_STUDIO_PANEL_LIMITS.inspector.default);
    setGraphHeight(NODE_STUDIO_GRAPH_HEIGHT_LIMITS.default);
  };

  const renderViewerStill = async () => {
    if (!selectedBackground) {
      setRenderStatus('Choose a Read B background image before rendering.');
      return;
    }

    setIsRendering(true);
    setRenderStatus('Rendering Node Studio viewer...');
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
        ctx.globalAlpha = foregroundOpacity;
        ctx.filter = previewPlan.foregroundFilter === 'none' ? 'none' : previewPlan.foregroundFilter;
        if (previewPlan.glowEnabled) {
          ctx.shadowBlur = Math.max(18, Math.round(Math.min(canvas.width, canvas.height) * 0.035));
          ctx.shadowColor = 'rgba(125, 211, 252, 0.72)';
        }
        ctx.translate(
          canvas.width / 2 + settings.transform.translateX,
          canvas.height / 2 + settings.transform.translateY,
        );
        ctx.rotate((settings.transform.rotation * Math.PI) / 180);
        ctx.drawImage(gradedForeground, -width / 2, -height / 2, width, height);
        ctx.restore();
      }

      applyViewerChannel(ctx, canvas.width, canvas.height, settings.viewerChannel);
      drawViewerGuides(ctx, canvas.width, canvas.height, {
        matteOverlay: previewPlan.matteOverlay,
        motionOverlay: previewPlan.motionOverlay,
      });
      drawDeterministicGrain(ctx, canvas.width, canvas.height, previewPlan.grainOpacity);
      drawDeterministicGrain(ctx, canvas.width, canvas.height, previewPlan.noiseOpacity);
      if (previewPlan.flareEnabled) drawLensFlare(ctx, canvas.width, canvas.height);
      if (previewPlan.inpaintOverlay) drawInpaintOverlay(ctx, canvas.width, canvas.height);

      const now = Date.now();
      const summary = buildNodeStudioRenderSummary({
        blendMode: settings.blendMode,
        opacity: foregroundOpacity,
        viewerChannel: settings.viewerChannel,
        frame: playhead,
        effectLabels: previewPlan.activeLabels,
      });
      const item: MediaItem = {
        id: `node-studio-composite-${now}`,
        name: `${summary.namePrefix}_${now}.png`,
        type: 'image',
        url: canvas.toDataURL('image/png'),
        source: 'generated',
        generatedBy: 'Node Studio Composite',
        prompt: summary.prompt,
      };

      setRenderResult(item);
      onAddGeneratedMedia(item);
      setRenderStatus('Viewer render added to your project media.');
    } catch (error) {
      setRenderStatus(error instanceof Error ? error.message : 'Node Studio render failed.');
    } finally {
      setIsRendering(false);
    }
  };

  const flowNodes = useMemo<Node<StudioNodeData>[]>(() => {
    const base = graph.nodes.map((node) => ({
      id: node.id,
      type: 'studioNode',
      position: node.position,
      data: {
        label: node.label,
        kind: node.kind,
        role: node.role === 'A' ? 'foreground' : node.role === 'B' ? 'background' : undefined,
        muted: node.disabled,
      },
    }));
    const extras = addedEffects.map((effect, index) => ({
      id: effect.instanceId,
      type: 'studioNode',
      position: { x: 260 + index * 165, y: 330 },
      data: {
        label: effect.label,
        kind: effect.kind,
        description: effect.description,
      },
    }));
    return [...base, ...extras];
  }, [addedEffects, graph.nodes]);

  const flowEdges = useMemo<Edge[]>(() => {
    const hasInsertedEffects = addedEffects.length > 0;
    const effectChainEdges: Edge[] = [];

    if (hasInsertedEffects) {
      effectChainEdges.push({
        id: `merge-main-${addedEffects[0].instanceId}`,
        source: 'merge-main',
        target: addedEffects[0].instanceId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#a78bfa' },
      });
      addedEffects.slice(1).forEach((effect, index) => {
        effectChainEdges.push({
          id: `${addedEffects[index].instanceId}-${effect.instanceId}`,
          source: addedEffects[index].instanceId,
          target: effect.instanceId,
          type: 'smoothstep',
          animated: true,
          style: { stroke: '#a78bfa' },
        });
      });
      effectChainEdges.push({
        id: `${addedEffects[addedEffects.length - 1].instanceId}-${graph.viewerNodeId}`,
        source: addedEffects[addedEffects.length - 1].instanceId,
        target: graph.viewerNodeId,
        type: 'smoothstep',
        animated: true,
        style: { stroke: '#a78bfa' },
      });
    }

    return [
      ...graph.edges.map((edge) => {
        const bypassedViewerEdge = hasInsertedEffects && edge.source === 'merge-main' && edge.target === graph.viewerNodeId;
        return {
          ...edge,
          type: 'smoothstep',
          animated: edge.target === graph.viewerNodeId && !bypassedViewerEdge,
          style: {
            stroke: edge.targetHandle === 'A' ? '#34d399' : edge.targetHandle === 'B' ? '#60a5fa' : '#818cf8',
            opacity: bypassedViewerEdge ? 0.22 : 1,
            strokeDasharray: bypassedViewerEdge ? '6 6' : undefined,
          },
        };
      }),
      ...effectChainEdges,
    ];
  }, [addedEffects, graph.edges, graph.viewerNodeId]);

  const nodeStudioPanelStyle = {
    '--node-studio-palette-width': `${paletteWidth}px`,
    '--node-studio-inspector-width': `${inspectorWidth}px`,
  } as React.CSSProperties;

  const renderPaletteEffectButton = (effect: NodeStudioEffect) => {
    if (paletteViewMode === 'compact') {
      return (
        <button
          key={effect.id}
          type="button"
          title={effect.description}
          onClick={() => addEffectNode(effect)}
          className="rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-left text-[11px] font-medium text-gray-200 hover:border-indigo-400/50"
        >
          {effect.label}
        </button>
      );
    }

    if (paletteViewMode === 'list') {
      return (
        <button
          key={effect.id}
          type="button"
          onClick={() => addEffectNode(effect)}
          className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md border border-white/10 bg-white/[0.03] px-2 py-1.5 text-left text-xs text-gray-200 hover:border-indigo-400/50"
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{effect.label}</span>
            <span className="block truncate text-[10px] text-gray-500">{effect.description}</span>
          </span>
          <span className="rounded border border-white/10 px-1.5 py-0.5 text-[9px] uppercase tracking-[0.14em] text-gray-500">
            {effect.kind}
          </span>
        </button>
      );
    }

    return (
      <button
        key={effect.id}
        type="button"
        onClick={() => addEffectNode(effect)}
        className="rounded-lg border border-white/10 bg-white/[0.03] p-2 text-left text-xs text-gray-200 hover:border-indigo-400/50"
      >
        <div className="font-medium">{effect.label}</div>
        <div className="mt-1 text-[11px] text-gray-500">{effect.description}</div>
      </button>
    );
  };

  const renderInspector = () => {
    if (selectedNode?.kind === 'read') {
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

    if (selectedNode?.kind === 'keyer') {
      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Keyer</div>
          <input
            type="color"
            value={String(selectedNode.params.keyColor || '#00ff00')}
            onChange={(event) => updateSelectedParam('keyColor', event.target.value)}
            className="h-10 w-full rounded border border-white/10 bg-black/40"
          />
          <label className="block text-xs text-gray-300">Tolerance {Math.round(settings.keyer.tolerance * 100)}%
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
          <label className="block text-xs text-gray-300">Softness {Math.round(settings.keyer.softness * 100)}%
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
          <label className="block text-xs text-gray-300">Despill {Math.round(settings.keyer.despill * 100)}%
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
        </div>
      );
    }

    if (selectedNode?.kind === 'merge') {
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
        </div>
      );
    }

    if (selectedNode?.kind === 'viewer') {
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

    if (selectedEffect) {
      if (selectedEffect.kind === 'ai') {
        const aiSettings = aiNodeSettings[selectedEffect.instanceId] || {
          prompt: '',
          model: selectedEffect.id.includes('video') ? 'Video generation model' : 'Image generation/edit model',
          strength: selectedEffect.id.includes('inpaint') ? 0.65 : 0.5,
          maskMode: selectedEffect.id.includes('mask') || selectedEffect.id.includes('roto') || selectedEffect.id.includes('inpaint')
            ? 'Prompt mask'
            : 'Full frame',
          status: 'draft' as const,
        };

        return (
          <div className="space-y-3">
            <div className="text-xs uppercase tracking-[0.18em] text-cyan-200">AI Layer</div>
            <div className="text-sm text-gray-200">{selectedEffect.label}</div>
            <p className="text-xs text-gray-500">{selectedEffect.description}</p>
            <label className="block text-xs text-gray-300">Prompt
              <textarea
                value={aiSettings.prompt}
                onChange={(event) => updateAiNodeSetting(selectedEffect.instanceId, { prompt: event.target.value })}
                className="app-input mt-1 min-h-[92px] resize-none"
                placeholder="Describe generation, edit, inpaint, mask, or roto intent..."
              />
            </label>
            <label className="block text-xs text-gray-300">Model Route
              <select
                value={aiSettings.model}
                onChange={(event) => updateAiNodeSetting(selectedEffect.instanceId, { model: event.target.value })}
                className="app-select mt-1"
              >
                <option>Image generation model</option>
                <option>Image generation/edit model</option>
                <option>Video generation model</option>
                <option>Video edit/inpaint model</option>
                <option>Segmentation / roto model</option>
                <option>Depth / normal estimation model</option>
              </select>
            </label>
            <label className="block text-xs text-gray-300">Mask Mode
              <select
                value={aiSettings.maskMode}
                onChange={(event) => updateAiNodeSetting(selectedEffect.instanceId, { maskMode: event.target.value })}
                className="app-select mt-1"
              >
                <option>Full frame</option>
                <option>Prompt mask</option>
                <option>Viewer rectangle</option>
                <option>Foreground alpha</option>
                <option>Tracked roto</option>
              </select>
            </label>
            <label className="block text-xs text-gray-300">Strength {Math.round(aiSettings.strength * 100)}%
              <input
                type="range"
                min={0}
                max={1}
                step={0.01}
                value={aiSettings.strength}
                onChange={(event) => updateAiNodeSetting(selectedEffect.instanceId, { strength: Number(event.target.value) })}
                className="mt-2 w-full"
              />
            </label>
            <div className="rounded border border-cyan-300/20 bg-cyan-300/10 p-2 text-xs text-cyan-100">
              {aiSettings.status === 'queued' ? 'Queued in AI layer' : 'Ready to stage as an AI node job'}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                className="app-button app-primary text-xs"
                onClick={() => queueAiNode(selectedEffect.instanceId)}
              >
                Stage AI Node
              </button>
              <button
                type="button"
                className="app-button app-secondary text-xs"
                onClick={() => {
                  setAddedEffects((prev) => prev.filter((effect) => effect.instanceId !== selectedEffect.instanceId));
                  setAiNodeSettings((prev) => {
                    const next = { ...prev };
                    delete next[selectedEffect.instanceId];
                    return next;
                  });
                }}
              >
                Remove
              </button>
            </div>
          </div>
        );
      }

      return (
        <div className="space-y-3">
          <div className="text-xs uppercase tracking-[0.18em] text-gray-400">{selectedEffect.kind}</div>
          <div className="text-sm text-gray-200">{selectedEffect.label}</div>
          <p className="text-xs text-gray-500">{selectedEffect.description}</p>
          <div className="rounded border border-indigo-400/20 bg-indigo-400/10 p-2 text-xs text-indigo-100">
            Active in viewer preview
          </div>
          <button
            type="button"
            className="app-button app-secondary text-xs"
            onClick={() => setAddedEffects((prev) => prev.filter((effect) => effect.instanceId !== selectedEffect.instanceId))}
          >
            Remove Node
          </button>
        </div>
      );
    }

    return (
      <div className="space-y-2 text-xs text-gray-500">
        <div className="uppercase tracking-[0.18em]">Inspector</div>
        <div>Select a node or add an effect from the palette.</div>
      </div>
    );
  };

  return (
    <section className="space-y-4">
      <div className="app-panel p-4 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Node Studio</div>
            <h3 className="text-xl font-semibold text-gray-100">Composite Viewer</h3>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            <div className="hidden items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-gray-400 sm:flex">
              <span>A/B</span>
              <span>Nodes</span>
              <span>Timeline</span>
            </div>
            <button
              type="button"
              className="app-button app-primary text-xs"
              onClick={renderViewerStill}
              disabled={isRendering || !selectedBackground}
            >
              {isRendering ? 'Rendering...' : 'Render Still'}
            </button>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,2fr)_340px]">
          <div className="relative aspect-video overflow-hidden rounded-lg border border-white/10 bg-black">
            {selectedBackground ? (
              <img
                src={selectedBackground.url}
                alt="Composite background"
                className="absolute inset-0 h-full w-full object-cover"
                style={{ filter: previewPlan.backgroundFilter === 'none' ? undefined : previewPlan.backgroundFilter }}
              />
            ) : (
              <div className="absolute inset-0 grid place-items-center text-sm text-gray-500">No Read B plate selected</div>
            )}
            {selectedForeground && (
              <img
                src={selectedForeground.url}
                alt="Composite foreground"
                className="absolute inset-0 h-full w-full object-cover"
                style={{
                  opacity: foregroundOpacity,
                  mixBlendMode,
                  filter: foregroundFilter,
                  transform: `translate(${settings.transform.translateX / 8}px, ${settings.transform.translateY / 8}px) scale(${settings.transform.scale}) rotate(${settings.transform.rotation}deg)`,
                }}
              />
            )}
            {previewPlan.matteOverlay && (
              <div className="pointer-events-none absolute inset-[9%] rounded-lg border border-lime-300/80 bg-lime-400/[0.06] shadow-[0_0_24px_rgba(132,204,22,0.28)]">
                <div className="absolute -top-6 left-0 rounded bg-lime-400/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-lime-100">
                  Matte
                </div>
              </div>
            )}
            {previewPlan.motionOverlay && (
              <div className="pointer-events-none absolute inset-0">
                <div className="absolute left-[31%] top-[36%] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-300 shadow-[0_0_14px_rgba(251,146,60,0.65)]" />
                <div className="absolute left-[58%] top-[52%] h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-orange-300 shadow-[0_0_14px_rgba(251,146,60,0.65)]" />
                <div className="absolute left-[31%] top-[36%] h-px w-[27%] origin-left rotate-[22deg] bg-orange-300/70" />
              </div>
            )}
            {previewPlan.aiLayerOverlay && (
              <div className="pointer-events-none absolute right-3 top-12 w-44 rounded border border-cyan-300/30 bg-cyan-950/70 p-2 text-[10px] text-cyan-100 shadow-[0_0_22px_rgba(34,211,238,0.18)]">
                <div className="uppercase tracking-[0.18em] text-cyan-200">AI Layer</div>
                <div className="mt-1 text-cyan-100/80">{aiNodes.length} node{aiNodes.length === 1 ? '' : 's'} staged</div>
              </div>
            )}
            {previewPlan.inpaintOverlay && (
              <div className="pointer-events-none absolute left-[34%] top-[28%] h-[28%] w-[28%] rounded-lg border border-cyan-300/80 bg-cyan-300/[0.08] shadow-[0_0_22px_rgba(34,211,238,0.35)]">
                <div className="absolute -top-6 left-0 rounded bg-cyan-400/20 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-cyan-100">
                  Inpaint
                </div>
              </div>
            )}
            {previewPlan.flareEnabled && (
              <div className="pointer-events-none absolute inset-0 mix-blend-screen">
                <div className="absolute left-[10%] top-[28%] h-px w-[82%] rotate-[8deg] bg-cyan-100/60 shadow-[0_0_20px_rgba(125,211,252,0.8)]" />
                <div className="absolute left-[18%] top-[18%] h-32 w-32 rounded-full bg-cyan-100/20 blur-2xl" />
                <div className="absolute left-[57%] top-[37%] h-9 w-9 rounded-full border border-white/25 bg-white/10" />
                <div className="absolute left-[72%] top-[42%] h-16 w-16 rounded-full border border-cyan-100/25 bg-cyan-100/10" />
              </div>
            )}
            {previewPlan.grainOpacity > 0 && (
              <div
                className="pointer-events-none absolute inset-0 mix-blend-overlay"
                style={{
                  opacity: previewPlan.grainOpacity,
                  backgroundImage:
                    'radial-gradient(circle at 20% 30%, rgba(255,255,255,0.9) 0 1px, transparent 1px), radial-gradient(circle at 70% 60%, rgba(0,0,0,0.9) 0 1px, transparent 1px)',
                  backgroundSize: '7px 7px, 11px 11px',
                }}
              />
            )}
            {previewPlan.noiseOpacity > 0 && (
              <div
                className="pointer-events-none absolute inset-0 mix-blend-soft-light"
                style={{
                  opacity: previewPlan.noiseOpacity,
                  backgroundImage:
                    'linear-gradient(45deg, rgba(255,255,255,0.7) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.65) 75%), linear-gradient(-45deg, rgba(255,255,255,0.45) 25%, transparent 25%, transparent 75%, rgba(0,0,0,0.45) 75%)',
                  backgroundSize: '10px 10px',
                }}
              />
            )}
            <div className="absolute left-3 top-3 rounded bg-black/70 px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-gray-300">
              Viewer 1 · {String(settings.viewerChannel).toUpperCase()}
            </div>
            <div className="absolute bottom-3 left-3 right-3 flex items-center justify-between rounded bg-black/70 px-3 py-2 text-xs text-gray-300">
              <button type="button" className="text-gray-100 hover:text-white" onClick={() => setIsPlaying((prev) => !prev)}>
                {isPlaying ? 'Pause' : 'Play'}
              </button>
              <div>Frame {String(playhead).padStart(3, '0')} / 120</div>
              <div>{selectedBackground ? selectedBackground.name : 'No plate'}</div>
            </div>
          </div>

          <div className="space-y-3 rounded-lg border border-white/10 bg-black/25 p-4">
            <div className="text-xs uppercase tracking-[0.18em] text-gray-400">Comp Stack</div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="rounded border border-sky-400/25 bg-sky-400/10 p-2 text-sky-100">Read B</div>
              <div className="rounded border border-lime-400/25 bg-lime-400/10 p-2 text-lime-100">Read A + Keyer</div>
              <div className="rounded border border-cyan-300/25 bg-cyan-300/10 p-2 text-cyan-100">AI Layer</div>
              <div className="rounded border border-amber-400/25 bg-amber-400/10 p-2 text-amber-100">Grade</div>
              <div className="rounded border border-emerald-400/25 bg-emerald-400/10 p-2 text-emerald-100">Merge</div>
            </div>
            <div className="text-xs text-gray-500">
              {imageMediaItems.length} images · {videoMediaItems.length} videos in project media.
            </div>
            {renderStatus && (
              <div className="rounded border border-white/10 bg-white/[0.03] p-2 text-xs text-gray-300">
                {renderStatus}
              </div>
            )}
            {renderResult && (
              <div className="overflow-hidden rounded border border-emerald-400/20 bg-emerald-400/10">
                <img src={renderResult.url} alt="Latest node studio render" className="h-24 w-full object-cover" />
                <div className="px-2 py-1 text-[11px] text-emerald-100">{renderResult.name}</div>
              </div>
            )}
            {addedEffects.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">Live Effects</div>
                <div className="flex flex-wrap gap-2">
                  {addedEffects.map((effect) => (
                    <button
                      key={effect.instanceId}
                      type="button"
                      onClick={() => {
                        setSelectedEffectId(effect.instanceId);
                        setSelectedNodeId(effect.instanceId);
                      }}
                      className="rounded border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-gray-200"
                    >
                      {effect.label}
                    </button>
                  ))}
                </div>
                <div className="text-[11px] text-gray-500">
                  {previewPlan.activeLabels.join(' -> ')}
                </div>
              </div>
            )}
            {aiNodes.length > 0 && (
              <div className="space-y-2">
                <div className="text-[10px] uppercase tracking-[0.18em] text-cyan-200/80">AI Jobs</div>
                <div className="space-y-1">
                  {aiNodes.map((node) => {
                    const settingsForNode = aiNodeSettings[node.instanceId];
                    return (
                      <button
                        key={node.instanceId}
                        type="button"
                        onClick={() => {
                          setSelectedEffectId(node.instanceId);
                          setSelectedNodeId(node.instanceId);
                        }}
                        className="w-full rounded border border-cyan-300/15 bg-cyan-300/[0.06] px-2 py-1 text-left text-[11px] text-cyan-100"
                      >
                        <div>{node.label}</div>
                        <div className="text-cyan-100/55">{settingsForNode?.status === 'queued' ? 'queued' : 'draft'} · {settingsForNode?.maskMode || 'Full frame'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="app-panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Timeline</div>
          <input
            type="range"
            min={0}
            max={120}
            value={playhead}
            onChange={(event) => setPlayhead(Number(event.target.value))}
            className="w-48"
          />
        </div>
        <div className="relative space-y-2 overflow-hidden rounded-lg border border-white/10 bg-black/25 p-3">
          <div className="absolute bottom-2 top-2 w-px bg-white/80" style={{ left: `${(playhead / 120) * 100}%` }} />
          {NODE_STUDIO_TIMELINE_TRACKS.map((track) => (
            <div key={track.id} className="grid grid-cols-[140px_1fr] items-center gap-3 text-xs">
              <div className="text-gray-400">{track.label}</div>
              <div className="h-7 rounded bg-white/5 p-1">
                <div
                  className="h-full rounded"
                  style={{
                    width: track.id === 'source' ? '96%' : track.id === 'render' ? '78%' : track.id === 'ai' ? '72%' : '88%',
                    marginLeft: track.id === 'matte' ? '6%' : track.id === 'render' ? '18%' : track.id === 'ai' ? '14%' : '0',
                    backgroundColor: track.color,
                    opacity: 0.72,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        className="grid grid-cols-1 gap-4 xl:grid-cols-[var(--node-studio-palette-width)_8px_minmax(0,1fr)_8px_var(--node-studio-inspector-width)] xl:gap-0"
        style={nodeStudioPanelStyle}
      >
        <div className="app-panel space-y-4 overflow-auto p-4" style={{ maxHeight: graphHeight + 92 }}>
          <div className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Nodes & Effects</div>
                <p className="mt-1 text-xs text-gray-500">Add classic comp, Nuke FX, and AI layer nodes.</p>
              </div>
              <button
                type="button"
                onClick={resetPanelLayout}
                className="rounded border border-white/10 px-2 py-1 text-[10px] uppercase tracking-[0.14em] text-gray-400 hover:text-gray-100"
              >
                Reset
              </button>
            </div>
            <div className="flex rounded-lg border border-white/10 bg-black/30 p-1">
              {NODE_STUDIO_PALETTE_VIEW_MODES.map((mode) => (
                <button
                  key={mode.id}
                  type="button"
                  onClick={() => setPaletteViewMode(mode.id)}
                  className={`flex-1 rounded-md px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] ${
                    paletteViewMode === mode.id
                      ? 'bg-indigo-500 text-white'
                      : 'text-gray-500 hover:text-gray-200'
                  }`}
                >
                  {mode.label}
                </button>
              ))}
            </div>
          </div>
          {NODE_STUDIO_EFFECT_GROUPS.map((group) => (
            <div key={group.id} className="space-y-2">
              <div className="text-[10px] uppercase tracking-[0.18em] text-gray-500">{group.label}</div>
              <div className={paletteViewMode === 'compact' ? 'grid grid-cols-2 gap-1.5' : 'grid gap-2'}>
                {group.effects.map((effect) => renderPaletteEffectButton(effect))}
              </div>
            </div>
          ))}
        </div>

        <button
          type="button"
          aria-label="Resize node palette panel"
          aria-orientation="vertical"
          onPointerDown={(event) => startPanelResize('palette', event)}
          className="hidden cursor-col-resize items-center justify-center bg-white/[0.03] text-[10px] text-gray-600 hover:bg-indigo-400/10 hover:text-indigo-200 xl:flex"
        >
          ||
        </button>

        <div className="app-panel overflow-hidden p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-3 py-2">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Node Graph</div>
              <div className="text-[11px] text-gray-500">Drag panel edges or resize graph height.</div>
            </div>
            <label className="flex items-center gap-2 text-[10px] uppercase tracking-[0.14em] text-gray-500">
              Height
              <input
                type="range"
                min={NODE_STUDIO_GRAPH_HEIGHT_LIMITS.min}
                max={NODE_STUDIO_GRAPH_HEIGHT_LIMITS.max}
                step={20}
                value={graphHeight}
                onChange={(event) => setGraphHeight(clampNodeStudioGraphHeight(Number(event.target.value)))}
                className="w-32"
              />
              <span className="w-10 text-right text-gray-400">{graphHeight}</span>
            </label>
          </div>
          <div style={{ width: '100%', height: graphHeight }}>
            <ReactFlow
              className="h-full w-full"
              nodes={flowNodes}
              edges={flowEdges}
              nodeTypes={nodeTypes}
              fitView
              onNodeClick={(_event, node) => {
                setSelectedNodeId(node.id);
                setSelectedEffectId(node.id);
              }}
              proOptions={{ hideAttribution: true }}
            >
              <Background color="#334155" gap={22} />
              <Controls showInteractive={false} />
              <MiniMap pannable zoomable nodeStrokeWidth={3} />
            </ReactFlow>
          </div>
        </div>

        <button
          type="button"
          aria-label="Resize inspector panel"
          aria-orientation="vertical"
          onPointerDown={(event) => startPanelResize('inspector', event)}
          className="hidden cursor-col-resize items-center justify-center bg-white/[0.03] text-[10px] text-gray-600 hover:bg-indigo-400/10 hover:text-indigo-200 xl:flex"
        >
          ||
        </button>

        <div className="app-panel space-y-4 p-4" style={{ maxHeight: graphHeight + 52, overflow: 'auto' }}>
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-gray-400">Inspector</div>
            <div className="mt-1 text-sm text-gray-200">{selectedNode?.label || selectedEffect?.label || 'No node selected'}</div>
          </div>
          {renderInspector()}
        </div>
      </div>
    </section>
  );
};

export default CompositingNodeStudioView;
