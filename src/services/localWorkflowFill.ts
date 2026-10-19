import type { LocalWorkflowTemplate } from '../data/localModelCatalog';

/** Filling ComfyUI workflow templates (pure; see localModelService.ts for running them). */

export type LocalRunOptions = {
  prompt: string;
  negativePrompt?: string;
  width?: number;
  height?: number;
  seed?: number;
  steps?: number;
  /** Video length; turned into frames or seconds depending on the workflow. */
  durationSeconds?: number;
  fps?: number;
  images?: Array<{ base64: string; mimeType: string }>;
  /** Run the model's prompt enhancer (needs its optional file). */
  enhance?: boolean;
};

const ASPECT_SIZES: Record<string, [number, number]> = {
  '16:9': [1344, 768],
  '9:16': [768, 1344],
  '1:1': [1024, 1024],
  '4:3': [1152, 864],
  '3:4': [864, 1152],
  '21:9': [1536, 640],
  '2:1': [1408, 704],
  '235:100': [1504, 640],
  '239:100': [1528, 640],
};

/** Width/height for an aspect ratio at roughly 1 MP (2K/4K scale up, rounded to 16 px). */
export const sizeForAspect = (aspect: string, imageSize: '1K' | '2K' | '4K' = '1K', maxSide = 2048): [number, number] => {
  const [w, h] = ASPECT_SIZES[aspect] || ASPECT_SIZES['16:9'];
  const scale = imageSize === '4K' ? 2 : imageSize === '2K' ? 1.5 : 1;
  const fit = Math.min(scale, maxSide / Math.max(w, h));
  const round = (value: number) => Math.max(256, Math.round((value * fit) / 16) * 16);
  return [round(w), round(h)];
};

const VIDEO_SIZES: Record<string, [number, number]> = {
  '16:9': [1280, 704],
  '9:16': [704, 1280],
  '1:1': [960, 960],
  '4:3': [1088, 832],
  '3:4': [832, 1088],
};

/** 720p-class video sizes; multiples of 64 (LTX renders half size first, then upscales 2x). */
export const videoSizeForAspect = (aspect: string): [number, number] => VIDEO_SIZES[aspect] || VIDEO_SIZES['16:9'];

const deepClone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

const setBinding = (graph: Record<string, any>, binding: { node: string; input: string } | undefined, value: unknown) => {
  if (!binding || value === undefined || value === null) return;
  const node = graph[binding.node];
  if (node?.inputs) node.inputs[binding.input] = value;
};

const isLinkTo = (value: unknown, nodeId: string) => Array.isArray(value) && value.length === 2 && String(value[0]) === nodeId;

/** Delete nodes and every input that was wired to them. */
const removeNodes = (graph: Record<string, any>, ids: string[]) => {
  for (const id of ids) delete graph[id];
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (ids.some((id) => isLinkTo(value, id))) delete node.inputs[key];
    }
  }
};

/** Turn the prompt enhancer off: wire its switch's raw-prompt side through, then drop its nodes. */
const stripEnhancer = (graph: Record<string, any>, enhancer: NonNullable<LocalWorkflowTemplate['bindings']['enhancer']>) => {
  const raw = graph[enhancer.node]?.inputs?.[enhancer.rawPromptSide];
  for (const node of Object.values(graph)) {
    for (const [key, value] of Object.entries(node.inputs || {})) {
      if (isLinkTo(value, enhancer.node)) node.inputs[key] = raw;
    }
  }
  removeNodes(graph, enhancer.removeNodes);
};

/** Fill a workflow template; reference images must already be uploaded (their ComfyUI names). */
export const fillWorkflow = (template: LocalWorkflowTemplate, options: LocalRunOptions, uploadedImages: string[] = []) => {
  const graph = deepClone(template.graph);
  const { bindings } = template;
  if (bindings.enhancer) {
    if (options.enhance) setBinding(graph, bindings.enhancer, bindings.enhancer.enabledValue);
    else stripEnhancer(graph, bindings.enhancer);
  }
  setBinding(graph, bindings.positive, options.prompt);
  if (bindings.negative) setBinding(graph, bindings.negative, options.negativePrompt || '');
  setBinding(graph, bindings.width, options.width);
  setBinding(graph, bindings.height, options.height);
  setBinding(graph, bindings.seed, typeof options.seed === 'number' ? options.seed : Math.floor(Math.random() * 2 ** 31));
  setBinding(graph, bindings.steps, options.steps);
  if (bindings.enhanceFlag) setBinding(graph, bindings.enhanceFlag, options.enhance ? bindings.enhanceFlag.enabledValue : !bindings.enhanceFlag.enabledValue);
  if (typeof options.durationSeconds === 'number') {
    const fps = options.fps || 24;
    setBinding(graph, bindings.durationSeconds, options.durationSeconds);
    // Wan wants 4n+1 frames.
    setBinding(graph, bindings.frames, Math.round((options.durationSeconds * fps) / 4) * 4 + 1);
  }
  setBinding(graph, bindings.fps, options.fps);
  // Fill the reference slots in order; slots without an image are removed with their wiring.
  const imageSlots = bindings.images || [];
  const unused: string[] = [];
  imageSlots.forEach((slot, index) => {
    if (uploadedImages[index]) setBinding(graph, slot, uploadedImages[index]);
    else if (index > 0) unused.push(slot.node);
  });
  if (unused.length) removeNodes(graph, unused);
  return graph;
};

