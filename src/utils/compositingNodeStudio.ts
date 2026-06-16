export type CompositingWorkspaceView = 'tools' | 'nodeStudio';

export type CompositingWorkspaceViewOption = {
  id: CompositingWorkspaceView;
  label: string;
  description: string;
};

export type NodeStudioEffect = {
  id: string;
  label: string;
  kind: 'io' | 'matte' | 'tracking' | 'transform' | 'color' | 'effect' | 'ai' | 'composite' | 'output';
  description: string;
};

export type NodeStudioEffectGroup = {
  id: string;
  label: string;
  effects: NodeStudioEffect[];
};

export type NodeStudioTimelineTrack = {
  id: string;
  label: string;
  lane: number;
  color: string;
};

export type NodeStudioPaletteViewMode = 'gallery' | 'list' | 'compact';

export type NodeStudioPaletteViewModeOption = {
  id: NodeStudioPaletteViewMode;
  label: string;
};

export type NodeStudioResizablePanel = 'palette' | 'inspector';

export type NodeStudioPreviewPlan = {
  foregroundFilter: string;
  backgroundFilter: string;
  foregroundOpacityMultiplier: number;
  glowEnabled: boolean;
  grainOpacity: number;
  noiseOpacity: number;
  flareEnabled: boolean;
  aiLayerOverlay: boolean;
  inpaintOverlay: boolean;
  matteOverlay: boolean;
  motionOverlay: boolean;
  activeLabels: string[];
};

export type NodeStudioRenderSummaryInput = {
  blendMode: string;
  opacity: number;
  viewerChannel: string;
  frame: number;
  effectLabels: string[];
};

export type NodeStudioRenderSummary = {
  namePrefix: string;
  prompt: string;
};

type PreviewEffectInput = Pick<NodeStudioEffect, 'id' | 'label' | 'kind'>;

const formatCssNumber = (value: number) => Number(value.toFixed(2)).toString();

const buildViewerFilter = (blurPx: number, brightness: number, contrast: number, saturate: number) => {
  if (blurPx === 0 && brightness === 1 && contrast === 1 && saturate === 1) {
    return 'none';
  }

  return [
    `blur(${formatCssNumber(blurPx)}px)`,
    `brightness(${formatCssNumber(brightness)})`,
    `contrast(${formatCssNumber(contrast)})`,
    `saturate(${formatCssNumber(saturate)})`,
  ].join(' ');
};

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);

export const NODE_STUDIO_PALETTE_VIEW_MODES: NodeStudioPaletteViewModeOption[] = [
  { id: 'gallery', label: 'Gallery' },
  { id: 'list', label: 'List' },
  { id: 'compact', label: 'Compact' },
];

export const NODE_STUDIO_PANEL_LIMITS: Record<NodeStudioResizablePanel, { min: number; max: number; default: number }> = {
  palette: { min: 220, max: 520, default: 300 },
  inspector: { min: 260, max: 560, default: 340 },
};

export const NODE_STUDIO_GRAPH_HEIGHT_LIMITS = {
  min: 420,
  max: 900,
  default: 620,
};

export const clampNodeStudioPanelWidth = (panel: NodeStudioResizablePanel, width: number) => {
  const limits = NODE_STUDIO_PANEL_LIMITS[panel];
  return clamp(Number.isFinite(width) ? width : limits.default, limits.min, limits.max);
};

export const clampNodeStudioGraphHeight = (height: number) =>
  clamp(Number.isFinite(height) ? height : NODE_STUDIO_GRAPH_HEIGHT_LIMITS.default, NODE_STUDIO_GRAPH_HEIGHT_LIMITS.min, NODE_STUDIO_GRAPH_HEIGHT_LIMITS.max);

export const COMPOSITING_WORKSPACE_VIEWS: CompositingWorkspaceViewOption[] = [
  {
    id: 'tools',
    label: 'Tools',
    description: 'Current guided compositing tools.',
  },
  {
    id: 'nodeStudio',
    label: 'Node Studio',
    description: 'Viewer, node graph, effects, and timeline.',
  },
];

export const NODE_STUDIO_EFFECT_GROUPS: NodeStudioEffectGroup[] = [
  {
    id: 'io',
    label: 'I/O',
    effects: [
      { id: 'read', label: 'Read / Media In', kind: 'io', description: 'Load plates or generated media.' },
      { id: 'reference', label: 'Reference', kind: 'io', description: 'Side-by-side reference input.' },
      { id: 'viewer', label: 'Viewer', kind: 'io', description: 'Send the graph output to the player.' },
    ],
  },
  {
    id: 'matte',
    label: 'Matte & Key',
    effects: [
      { id: 'keyer', label: 'Chroma Keyer', kind: 'matte', description: 'Remove a keyed color with despill.' },
      { id: 'luma-key', label: 'Luma Key', kind: 'matte', description: 'Generate alpha from luminance.' },
      { id: 'roto', label: 'Roto Mask', kind: 'matte', description: 'Draw and feather holdout shapes.' },
      { id: 'edge-matte', label: 'Edge Matte', kind: 'matte', description: 'Shrink, erode, or soften alpha edges.' },
      { id: 'garbage-matte', label: 'Garbage Matte', kind: 'matte', description: 'Block unwanted frame regions.' },
    ],
  },
  {
    id: 'motion',
    label: 'Track & Stabilize',
    effects: [
      { id: 'tracker', label: 'Tracker', kind: 'tracking', description: 'Track points or planar regions.' },
      { id: 'stabilize', label: 'Stabilize', kind: 'tracking', description: 'Apply inverted tracking motion.' },
      { id: 'match-move', label: 'Match Move', kind: 'tracking', description: 'Drive transforms from track data.' },
    ],
  },
  {
    id: 'layout',
    label: 'Transform',
    effects: [
      { id: 'transform', label: 'Transform', kind: 'transform', description: 'Move, scale, and rotate a layer.' },
      { id: 'corner-pin', label: 'Corner Pin', kind: 'transform', description: 'Pin a plate into perspective.' },
      { id: 'reformat', label: 'Reformat', kind: 'transform', description: 'Fit output to another aspect.' },
      { id: 'crop', label: 'Crop', kind: 'transform', description: 'Crop or pad the working frame.' },
    ],
  },
  {
    id: 'color',
    label: 'Color',
    effects: [
      { id: 'grade', label: 'Grade', kind: 'color', description: 'Exposure, gamma, saturation.' },
      { id: 'color-match', label: 'Color Match', kind: 'color', description: 'Match foreground to plate.' },
      { id: 'lut', label: 'LUT', kind: 'color', description: 'Apply a look transform.' },
    ],
  },
  {
    id: 'fx',
    label: 'Nuke FX',
    effects: [
      { id: 'blur', label: 'Blur', kind: 'effect', description: 'Defocus or soften a layer.' },
      { id: 'glow', label: 'Glow', kind: 'effect', description: 'Bloom highlights after merge.' },
      { id: 'grain', label: 'Grain', kind: 'effect', description: 'Unify plates with film grain.' },
      { id: 'noise', label: 'Noise', kind: 'effect', description: 'Procedural texture, matte breakup, or animated noise.' },
      { id: 'lens-flare', label: 'Lens Flare', kind: 'effect', description: 'Add anamorphic streaks or source flares.' },
      { id: 'light-wrap', label: 'Light Wrap', kind: 'effect', description: 'Wrap background light around keyed foreground edges.' },
      { id: 'chromatic-aberration', label: 'Chromatic Aberration', kind: 'effect', description: 'Offset RGB channels for lens edge separation.' },
      { id: 'vignette', label: 'Vignette', kind: 'effect', description: 'Shape attention with edge falloff.' },
      { id: 'defocus', label: 'Defocus', kind: 'effect', description: 'Lens-style depth softness.' },
      { id: 'sharpen', label: 'Sharpen', kind: 'effect', description: 'Restore detail after transforms.' },
    ],
  },
  {
    id: 'ai-layer',
    label: 'AI Layer',
    effects: [
      { id: 'ai-image-generate', label: 'AI Image Generate', kind: 'ai', description: 'Generate a still plate from a prompt inside the node tree.' },
      { id: 'ai-image-edit', label: 'AI Image Edit', kind: 'ai', description: 'Edit the selected plate with prompt and reference context.' },
      { id: 'ai-image-inpaint', label: 'AI Inpaint', kind: 'ai', description: 'Fill or replace masked image regions.' },
      { id: 'ai-video-generate', label: 'AI Video Generate', kind: 'ai', description: 'Generate a motion plate from prompt, image, or shot context.' },
      { id: 'ai-video-edit', label: 'AI Video Edit', kind: 'ai', description: 'Apply prompt-based changes to selected motion footage.' },
      { id: 'ai-video-inpaint', label: 'AI Video Inpaint', kind: 'ai', description: 'Remove or replace masked regions across frames.' },
      { id: 'ai-mask', label: 'AI Mask', kind: 'ai', description: 'Segment subject, sky, face, product, or custom prompt regions.' },
      { id: 'ai-roto', label: 'AI Roto', kind: 'ai', description: 'Propagate roto shapes and soft alpha through the shot.' },
      { id: 'ai-depth-normal', label: 'AI Depth / Normal', kind: 'ai', description: 'Estimate depth or normals for relighting and depth compositing.' },
      { id: 'ai-matte-refine', label: 'AI Matte Refine', kind: 'ai', description: 'Clean hair, transparent edges, and difficult alpha detail.' },
    ],
  },
  {
    id: 'merge',
    label: 'Composite',
    effects: [
      { id: 'merge', label: 'Merge', kind: 'composite', description: 'A over B with blend modes.' },
      { id: 'premult', label: 'Premult', kind: 'composite', description: 'Premultiply color by alpha.' },
      { id: 'unpremult', label: 'Unpremult', kind: 'composite', description: 'Separate color from alpha.' },
      { id: 'write', label: 'Write / Render', kind: 'output', description: 'Export the comp result.' },
    ],
  },
];

export const NODE_STUDIO_TIMELINE_TRACKS: NodeStudioTimelineTrack[] = [
  { id: 'source', label: 'Source Plates', lane: 0, color: '#60a5fa' },
  { id: 'matte', label: 'Matte / Roto', lane: 1, color: '#84cc16' },
  { id: 'ai', label: 'AI Layer', lane: 2, color: '#a78bfa' },
  { id: 'comp', label: 'Composite', lane: 3, color: '#34d399' },
  { id: 'render', label: 'Render Output', lane: 4, color: '#c084fc' },
];

export const getNodeStudioEffectCount = () =>
  NODE_STUDIO_EFFECT_GROUPS.reduce((count, group) => count + group.effects.length, 0);

export const buildNodeStudioRenderSummary = ({
  blendMode,
  opacity,
  viewerChannel,
  frame,
  effectLabels,
}: NodeStudioRenderSummaryInput): NodeStudioRenderSummary => {
  const blendLabel = blendMode === 'source-over' ? 'normal' : blendMode;
  const safeOpacity = Math.max(0, Math.min(1, opacity));
  const safeFrame = Number.isFinite(frame) ? Math.max(0, Math.round(frame)) : 0;
  const effects = effectLabels.length > 0 ? effectLabels.join(' -> ') : 'none';

  return {
    namePrefix: 'node_studio_composite',
    prompt: `Node Studio render at frame ${safeFrame}; blend ${blendLabel} at ${Math.round(safeOpacity * 100)}%; channel ${viewerChannel.toUpperCase()}; live effects ${effects}.`,
  };
};

export const deriveNodeStudioPreviewPlan = (effects: PreviewEffectInput[]): NodeStudioPreviewPlan => {
  let blurPx = 0;
  let brightness = 1;
  let contrast = 1;
  let saturate = 1;
  let foregroundOpacityMultiplier = 1;
  let glowEnabled = false;
  let grainOpacity = 0;
  let noiseOpacity = 0;
  let flareEnabled = false;
  let aiLayerOverlay = false;
  let inpaintOverlay = false;
  let matteOverlay = false;
  let motionOverlay = false;

  effects.forEach((effect) => {
    switch (effect.id) {
      case 'blur':
        blurPx += 2;
        break;
      case 'defocus':
        blurPx += 4;
        brightness -= 0.02;
        break;
      case 'glow':
        glowEnabled = true;
        brightness += 0.08;
        saturate += 0.05;
        break;
      case 'grain':
        grainOpacity = Math.max(grainOpacity, 0.18);
        break;
      case 'noise':
        noiseOpacity = Math.max(noiseOpacity, 0.12);
        break;
      case 'lens-flare':
        flareEnabled = true;
        brightness += 0.04;
        contrast += 0.04;
        break;
      case 'light-wrap':
        glowEnabled = true;
        brightness += 0.03;
        break;
      case 'chromatic-aberration':
        contrast += 0.04;
        break;
      case 'vignette':
        contrast += 0.05;
        break;
      case 'sharpen':
        contrast += 0.12;
        break;
      case 'grade':
        contrast += 0.06;
        saturate += 0.08;
        break;
      case 'color-match':
        brightness -= 0.02;
        saturate -= 0.04;
        break;
      case 'lut':
        contrast += 0.1;
        saturate += 0.12;
        break;
      case 'keyer':
      case 'luma-key':
      case 'roto':
      case 'edge-matte':
      case 'garbage-matte':
        matteOverlay = true;
        foregroundOpacityMultiplier = Math.min(foregroundOpacityMultiplier, 0.92);
        break;
      case 'ai-mask':
      case 'ai-roto':
      case 'ai-matte-refine':
        aiLayerOverlay = true;
        matteOverlay = true;
        foregroundOpacityMultiplier = Math.min(foregroundOpacityMultiplier, 0.9);
        break;
      case 'ai-image-inpaint':
      case 'ai-video-inpaint':
        aiLayerOverlay = true;
        inpaintOverlay = true;
        break;
      case 'ai-image-generate':
      case 'ai-image-edit':
      case 'ai-video-generate':
      case 'ai-video-edit':
      case 'ai-depth-normal':
        aiLayerOverlay = true;
        break;
      case 'tracker':
      case 'stabilize':
      case 'match-move':
        motionOverlay = true;
        break;
      default:
        break;
    }
  });

  return {
    foregroundFilter: buildViewerFilter(blurPx, brightness, contrast, saturate),
    backgroundFilter: 'none',
    foregroundOpacityMultiplier,
    glowEnabled,
    grainOpacity,
    noiseOpacity,
    flareEnabled,
    aiLayerOverlay,
    inpaintOverlay,
    matteOverlay,
    motionOverlay,
    activeLabels: effects.map((effect) => effect.label),
  };
};
