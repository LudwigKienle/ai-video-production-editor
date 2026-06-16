export type NatronNodeKind = 'read' | 'keyer' | 'transform' | 'grade' | 'merge' | 'viewer' | 'write';

export type NatronBlendMode = 'source-over' | 'screen' | 'multiply' | 'overlay' | 'soft-light';

export type NatronViewerChannel = 'rgba' | 'red' | 'green' | 'blue' | 'alpha' | 'matte';

export type NatronNodeRole = 'A' | 'B';

export type NatronCompositorNode = {
  id: string;
  kind: NatronNodeKind;
  label: string;
  position: { x: number; y: number };
  role?: NatronNodeRole;
  mediaId?: string;
  disabled?: boolean;
  params: Record<string, unknown>;
};

export type NatronCompositorEdge = {
  id: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
  targetHandle?: string | null;
};

export type NatronCompositorGraph = {
  nodes: NatronCompositorNode[];
  edges: NatronCompositorEdge[];
  viewerNodeId: string;
};

export type NatronCompositeTemplateOptions = {
  backgroundMediaId?: string;
  foregroundMediaId?: string;
};

export type NatronCompositeSettings = {
  backgroundMediaId: string;
  foregroundMediaId: string;
  blendMode: NatronBlendMode;
  opacity: number;
  mergeDisabled: boolean;
  viewerChannel: NatronViewerChannel;
  transform: {
    translateX: number;
    translateY: number;
    scale: number;
    rotation: number;
  };
  keyer: {
    enabled: boolean;
    keyColor: string;
    tolerance: number;
    softness: number;
    despill: number;
  };
  grade: {
    exposure: number;
    gamma: number;
    saturation: number;
  };
};

const BLEND_MODES: NatronBlendMode[] = ['source-over', 'screen', 'multiply', 'overlay', 'soft-light'];
const VIEWER_CHANNELS: NatronViewerChannel[] = ['rgba', 'red', 'green', 'blue', 'alpha', 'matte'];

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

const readNumber = (value: unknown, fallback: number) => {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
};

const coerceBlendMode = (value: unknown): NatronBlendMode => {
  return BLEND_MODES.includes(value as NatronBlendMode) ? (value as NatronBlendMode) : 'source-over';
};

const coerceViewerChannel = (value: unknown): NatronViewerChannel => {
  return VIEWER_CHANNELS.includes(value as NatronViewerChannel) ? (value as NatronViewerChannel) : 'rgba';
};

const coerceHexColor = (value: unknown, fallback = '#00ff00') => {
  if (typeof value !== 'string') return fallback;
  return /^#[0-9a-f]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : fallback;
};

const getNode = (graph: NatronCompositorGraph, id: string) => graph.nodes.find((node) => node.id === id);

export const createNatronCompositeTemplate = (
  options: NatronCompositeTemplateOptions = {},
): NatronCompositorGraph => ({
  nodes: [
    {
      id: 'read-bg',
      kind: 'read',
      label: 'Read B',
      role: 'B',
      mediaId: options.backgroundMediaId || '',
      position: { x: 20, y: 190 },
      params: { premultiplied: true },
    },
    {
      id: 'read-fg',
      kind: 'read',
      label: 'Read A',
      role: 'A',
      mediaId: options.foregroundMediaId || '',
      position: { x: 20, y: 20 },
      params: { premultiplied: true },
    },
    {
      id: 'keyer-fg',
      kind: 'keyer',
      label: 'Keyer',
      position: { x: 250, y: 20 },
      params: { keyColor: '#00ff00', tolerance: 0.28, softness: 0.12, despill: 0.35 },
    },
    {
      id: 'transform-fg',
      kind: 'transform',
      label: 'Transform',
      position: { x: 480, y: 20 },
      params: { translateX: 0, translateY: 0, scale: 1, rotation: 0 },
    },
    {
      id: 'grade-fg',
      kind: 'grade',
      label: 'Grade',
      position: { x: 710, y: 20 },
      params: { exposure: 0, gamma: 1, saturation: 1 },
    },
    {
      id: 'merge-main',
      kind: 'merge',
      label: 'Merge',
      position: { x: 940, y: 118 },
      params: { mode: 'source-over', opacity: 0.8 },
    },
    {
      id: 'viewer-1',
      kind: 'viewer',
      label: 'Viewer',
      position: { x: 1190, y: 80 },
      params: { channel: 'rgba', zoom: 1 },
    },
    {
      id: 'write-1',
      kind: 'write',
      label: 'Write',
      position: { x: 1190, y: 220 },
      params: { format: 'png' },
    },
  ],
  edges: [
    { id: 'read-bg-merge-main', source: 'read-bg', target: 'merge-main', sourceHandle: 'out', targetHandle: 'B' },
    { id: 'read-fg-keyer-fg', source: 'read-fg', target: 'keyer-fg', sourceHandle: 'out', targetHandle: 'input' },
    { id: 'keyer-fg-transform-fg', source: 'keyer-fg', target: 'transform-fg', sourceHandle: 'out', targetHandle: 'input' },
    { id: 'transform-fg-grade-fg', source: 'transform-fg', target: 'grade-fg', sourceHandle: 'out', targetHandle: 'input' },
    { id: 'grade-fg-merge-main', source: 'grade-fg', target: 'merge-main', sourceHandle: 'out', targetHandle: 'A' },
    { id: 'merge-main-viewer-1', source: 'merge-main', target: 'viewer-1', sourceHandle: 'out', targetHandle: 'input' },
    { id: 'merge-main-write-1', source: 'merge-main', target: 'write-1', sourceHandle: 'out', targetHandle: 'input' },
  ],
  viewerNodeId: 'viewer-1',
});

export const deriveNatronCompositeSettings = (graph: NatronCompositorGraph): NatronCompositeSettings => {
  const backgroundRead = getNode(graph, 'read-bg');
  const foregroundRead = getNode(graph, 'read-fg');
  const keyer = getNode(graph, 'keyer-fg');
  const transform = getNode(graph, 'transform-fg');
  const grade = getNode(graph, 'grade-fg');
  const merge = getNode(graph, 'merge-main');
  const viewer = getNode(graph, graph.viewerNodeId);

  return {
    backgroundMediaId: backgroundRead?.mediaId || '',
    foregroundMediaId: foregroundRead?.mediaId || '',
    blendMode: coerceBlendMode(merge?.params.mode),
    opacity: clamp(readNumber(merge?.params.opacity, 0.8), 0, 1),
    mergeDisabled: Boolean(merge?.disabled),
    viewerChannel: coerceViewerChannel(viewer?.params.channel),
    transform: {
      translateX: readNumber(transform?.params.translateX, 0),
      translateY: readNumber(transform?.params.translateY, 0),
      scale: clamp(readNumber(transform?.params.scale, 1), 0.01, 4),
      rotation: readNumber(transform?.params.rotation, 0),
    },
    keyer: {
      enabled: !keyer?.disabled,
      keyColor: coerceHexColor(keyer?.params.keyColor),
      tolerance: clamp(readNumber(keyer?.params.tolerance, 0.28), 0, 1),
      softness: clamp(readNumber(keyer?.params.softness, 0.12), 0, 1),
      despill: clamp(readNumber(keyer?.params.despill, 0.35), 0, 1),
    },
    grade: {
      exposure: clamp(readNumber(grade?.params.exposure, 0), -4, 4),
      gamma: clamp(readNumber(grade?.params.gamma, 1), 0.1, 4),
      saturation: clamp(readNumber(grade?.params.saturation, 1), 0, 2),
    },
  };
};

export const updateNatronNode = (
  graph: NatronCompositorGraph,
  nodeId: string,
  updates: Partial<Omit<NatronCompositorNode, 'id' | 'kind' | 'position'>>,
): NatronCompositorGraph => ({
  ...graph,
  nodes: graph.nodes.map((node) =>
    node.id === nodeId
      ? {
          ...node,
          ...updates,
          params: updates.params ? { ...node.params, ...updates.params } : node.params,
        }
      : node,
  ),
});

export const summarizeNatronGraph = (_graph: NatronCompositorGraph) => ({
  backgroundPath: 'Read B -> Merge -> Viewer',
  foregroundPath: 'Read A -> Keyer -> Transform -> Grade -> Merge -> Viewer',
  writePath: 'Merge -> Write',
});

export const natronBlendModeOptions = BLEND_MODES;

export const natronViewerChannelOptions = VIEWER_CHANNELS;
