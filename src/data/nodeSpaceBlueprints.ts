export type NodeKind =
  | 'prompt'
  | 'imageInput'
  | 'model'
  | 'sampler'
  | 'output'
  | 'video'
  | 'upscale'
  | 'filter'
  | 'chroma'
  | 'blend'
  | 'sketch'
  | 'openpose'
  | 'llm'
  | 'depth'
  | 'faceRestore'
  | 'bgRemove'
  | 'rife'
  | 'music'
  | 'sfx';

export type PaletteGroupId = 'io' | 'models' | 'generation' | 'processing' | 'comp' | 'output';

export type PaletteItem = {
  type: NodeKind;
  label: string;
  group: PaletteGroupId;
  description: string;
  portLabel: string;
  tone: string;
};

export type QuickTemplateOption = {
  id: string;
  label: string;
  description: string;
  backend: 'Local' | 'Cloud' | 'Hybrid';
  nodeCount: number;
};

export const paletteGroupLabels: Record<PaletteGroupId, string> = {
  io: 'Inputs',
  models: 'Models & Agents',
  generation: 'Generation',
  processing: 'Processing',
  comp: 'Composite',
  output: 'Outputs',
};

export const paletteGroupOrder: PaletteGroupId[] = ['io', 'models', 'generation', 'processing', 'comp', 'output'];

export const paletteItems: PaletteItem[] = [
  {
    type: 'prompt',
    label: 'Prompt',
    group: 'io',
    description: 'Text context for image, video, and agent nodes.',
    portLabel: 'text -> prompt',
    tone: 'from-indigo-500/24 to-indigo-500/5 border-indigo-400/35',
  },
  {
    type: 'imageInput',
    label: 'Media In',
    group: 'io',
    description: 'Image or video source from upload, URL, or library.',
    portLabel: 'media -> graph',
    tone: 'from-sky-500/24 to-sky-500/5 border-sky-400/35',
  },
  {
    type: 'llm',
    label: 'LLM Agent',
    group: 'models',
    description: 'Prompt expansion, task planning, and text transforms.',
    portLabel: 'prompt -> text',
    tone: 'from-teal-500/24 to-teal-500/5 border-teal-400/35',
  },
  {
    type: 'model',
    label: 'Image Model',
    group: 'models',
    description: 'Model-agnostic image generation with references and LoRA.',
    portLabel: 'prompt/media -> image',
    tone: 'from-emerald-500/24 to-emerald-500/5 border-emerald-400/35',
  },
  {
    type: 'sampler',
    label: 'Sampler',
    group: 'generation',
    description: 'Quality and speed pass for image model outputs.',
    portLabel: 'model -> image',
    tone: 'from-amber-500/24 to-amber-500/5 border-amber-400/35',
  },
  {
    type: 'video',
    label: 'Video Model',
    group: 'generation',
    description: 'Prompt or image-to-video generation with aspect control.',
    portLabel: 'prompt/media -> video',
    tone: 'from-rose-500/24 to-rose-500/5 border-rose-400/35',
  },
  {
    type: 'music',
    label: 'Music Model',
    group: 'generation',
    description: 'Original track generated from a rendered video (Sonilo).',
    portLabel: 'video -> audio',
    tone: 'from-pink-500/24 to-pink-500/5 border-pink-400/35',
  },
  {
    type: 'sfx',
    label: 'SFX Model',
    group: 'generation',
    description: 'Royalty-free sound effects generated from a rendered video (Sonilo).',
    portLabel: 'video -> audio',
    tone: 'from-teal-500/24 to-teal-500/5 border-teal-400/35',
  },
  {
    type: 'upscale',
    label: 'Upscale',
    group: 'processing',
    description: 'Crystal, Topaz, Clarity, ESRGAN, and video upscale paths.',
    portLabel: 'media -> media',
    tone: 'from-cyan-500/24 to-cyan-500/5 border-cyan-400/35',
  },
  {
    type: 'filter',
    label: 'Look Filter',
    group: 'processing',
    description: 'Brightness, LUT, grain, halation, bloom, and vignette.',
    portLabel: 'image -> image',
    tone: 'from-violet-500/24 to-violet-500/5 border-violet-400/35',
  },
  {
    type: 'chroma',
    label: 'Chroma Key',
    group: 'processing',
    description: 'Key a color range and output transparency.',
    portLabel: 'image -> alpha',
    tone: 'from-lime-500/24 to-lime-500/5 border-lime-400/35',
  },
  {
    type: 'bgRemove',
    label: 'Background Remove',
    group: 'processing',
    description: 'Subject cutout for transparent compositing.',
    portLabel: 'image -> cutout',
    tone: 'from-teal-500/24 to-teal-500/5 border-teal-400/35',
  },
  {
    type: 'faceRestore',
    label: 'Face Restore',
    group: 'processing',
    description: 'GFPGAN and RestoreFormer repair pass.',
    portLabel: 'image -> image',
    tone: 'from-emerald-500/24 to-emerald-500/5 border-emerald-400/35',
  },
  {
    type: 'depth',
    label: 'Depth Map',
    group: 'processing',
    description: 'Depth or normal-style utility output for relight and VFX.',
    portLabel: 'image -> depth',
    tone: 'from-blue-500/24 to-blue-500/5 border-blue-400/35',
  },
  {
    type: 'openpose',
    label: 'OpenPose',
    group: 'processing',
    description: 'Pose extraction for controlled generation.',
    portLabel: 'image -> pose',
    tone: 'from-fuchsia-500/24 to-fuchsia-500/5 border-fuchsia-400/35',
  },
  {
    type: 'sketch',
    label: 'Sketch',
    group: 'processing',
    description: 'Pencil-edge control pass for image workflows.',
    portLabel: 'image -> sketch',
    tone: 'from-slate-500/24 to-slate-500/5 border-slate-400/35',
  },
  {
    type: 'rife',
    label: 'RIFE Interpolate',
    group: 'processing',
    description: 'Generate in-between frames for smoother motion.',
    portLabel: 'video -> video',
    tone: 'from-rose-500/24 to-rose-500/5 border-rose-400/35',
  },
  {
    type: 'blend',
    label: 'Composite',
    group: 'comp',
    description: 'Two-input blend with screen, multiply, overlay, and opacity.',
    portLabel: 'A+B -> image',
    tone: 'from-orange-500/24 to-orange-500/5 border-orange-400/35',
  },
  {
    type: 'output',
    label: 'Output',
    group: 'output',
    description: 'Preview and collect final graph output.',
    portLabel: 'image -> result',
    tone: 'from-purple-500/24 to-purple-500/5 border-purple-400/35',
  },
];

export const quickTemplateOptions: QuickTemplateOption[] = [
  {
    id: 'text-image',
    label: 'Text -> Image',
    description: 'Prompt, model, sampler, and output for fast still generation.',
    backend: 'Hybrid',
    nodeCount: 4,
  },
  {
    id: 'image-video',
    label: 'Image -> Video',
    description: 'Reference image plus prompt into a video model.',
    backend: 'Cloud',
    nodeCount: 3,
  },
  {
    id: 'image-polish',
    label: 'Image Polish',
    description: 'Media input through look filter, upscale, and output.',
    backend: 'Hybrid',
    nodeCount: 4,
  },
  {
    id: 'agent-concept',
    label: 'Agent Concept Pass',
    description: 'LLM expands a creative brief before image generation.',
    backend: 'Hybrid',
    nodeCount: 6,
  },
  {
    id: 'vfx-matte',
    label: 'VFX Matte Stack',
    description: 'Cutout, color treatment, upscale, and final plate output.',
    backend: 'Hybrid',
    nodeCount: 5,
  },
  {
    id: 'two-plate-comp',
    label: 'Two-Plate Composite',
    description: 'Base and overlay media with blend, look, and output.',
    backend: 'Local',
    nodeCount: 5,
  },
  {
    id: 'video-polish',
    label: 'Video Polish',
    description: 'Video input through interpolation and video upscale.',
    backend: 'Cloud',
    nodeCount: 3,
  },
  {
    id: 'video-soundtrack',
    label: 'Video Soundtrack',
    description: 'Rendered cut into a Sonilo-generated original track.',
    backend: 'Cloud',
    nodeCount: 2,
  },
  {
    id: 'video-sfx',
    label: 'Video SFX',
    description: 'Rendered cut into Sonilo-generated sound effects.',
    backend: 'Cloud',
    nodeCount: 2,
  },
];

export const getQuickTemplateById = (id: string): QuickTemplateOption | undefined => {
  return quickTemplateOptions.find((item) => item.id === id);
};

export const getPaletteItemsByGroup = (group: PaletteGroupId): PaletteItem[] => {
  return paletteItems.filter((item) => item.group === group);
};
