import type { MediaItem } from '../types';
import { LOCAL_MODEL_CATALOG, type LocalModelEntry, type LocalWorkflowKind } from '../data/localModelCatalog';
import { uploadComfyImage } from './comfyUiService';
import { fillWorkflow, type LocalRunOptions } from './localWorkflowFill';

export { sizeForAspect, type LocalRunOptions } from './localWorkflowFill';

/**
 * Open-weights image/video models run through a local ComfyUI: download the files
 * into ComfyUI's models folder (resumable, from Hugging Face), then run the model's
 * official workflow through ComfyUI's API with the prompt, size, seed and references
 * filled in.
 */

const SETTINGS_KEY = 'local_models_settings_v1';
const COMFY_CONFIG_KEY = 'comfyui_config_v1';

export type LocalModelSettings = {
  /** ComfyUI's "models" folder (the one with diffusion_models/, text_encoders/, vae/ …). */
  modelsRoot: string;
  /** Needed for gated repositories (e.g. FLUX.3 Klein); only sent to huggingface.co. */
  hfToken: string;
};

export const getLocalModelSettings = (): LocalModelSettings => {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { modelsRoot: String(parsed.modelsRoot || ''), hfToken: String(parsed.hfToken || '') };
  } catch {
    return { modelsRoot: '', hfToken: '' };
  }
};

export const setLocalModelSettings = (patch: Partial<LocalModelSettings>) => {
  const next = { ...getLocalModelSettings(), ...patch };
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable */
  }
  return next;
};

/** The ComfyUI address the Image workspace already uses. */
export const getComfyBaseUrl = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(COMFY_CONFIG_KEY) || '{}');
    return String(parsed.baseUrl || 'http://127.0.0.1:8188').replace(/\/+$/, '');
  } catch {
    return 'http://127.0.0.1:8188';
  }
};

type LocalModelsBridge = {
  download: (payload: { id: string; url: string; root: string; relativePath: string; token?: string; expectedSize?: number }) => Promise<{ ok: boolean; path?: string; cancelled?: boolean; error?: string }>;
  cancel: (payload: { id: string }) => Promise<{ ok: boolean }>;
  check: (payload: { root: string; files: string[] }) => Promise<Record<string, { exists: boolean; size?: number; partialSize?: number }>>;
  remove: (payload: { root: string; files: string[] }) => Promise<{ ok: boolean }>;
  pickFolder: (payload?: { title?: string }) => Promise<{ canceled: boolean; path?: string }>;
  openFolder: (payload: { path: string }) => Promise<{ ok: boolean; error?: string }>;
  onProgress: (callback: (event: DownloadProgressEvent) => void) => () => void;
};

export type DownloadProgressEvent = {
  id: string;
  state: 'downloading' | 'done' | 'error' | 'cancelled';
  received?: number;
  total?: number;
  bytesPerSecond?: number;
  error?: string;
  path?: string;
};

export const localModelsBridge = (): LocalModelsBridge | undefined =>
  (typeof window !== 'undefined' ? (window as any).electron?.localModels : undefined);

export const isLocalModelDownloadAvailable = () => Boolean(localModelsBridge());

export const getLocalModel = (id: string) => LOCAL_MODEL_CATALOG.find((model) => model.id === id);

export const modelFilePath = (file: { folder: string; name: string }) => `${file.folder}/${file.name}`;

export const requiredFiles = (model: LocalModelEntry) => model.files.filter((file) => !file.optional);

export const modelDownloadSize = (model: LocalModelEntry) => requiredFiles(model).reduce((sum, file) => sum + file.size, 0);

export type ModelInstallState = {
  installed: boolean;
  /** Bytes already on disk, complete files plus partial downloads. */
  presentBytes: number;
  missing: string[];
};

export const checkModelInstalled = async (model: LocalModelEntry, root = getLocalModelSettings().modelsRoot): Promise<ModelInstallState> => {
  const bridge = localModelsBridge();
  const files = requiredFiles(model);
  if (!bridge || !root) return { installed: false, presentBytes: 0, missing: files.map(modelFilePath) };
  const status = await bridge.check({ root, files: files.map(modelFilePath) });
  let presentBytes = 0;
  const missing: string[] = [];
  for (const file of files) {
    const entry = status[modelFilePath(file)];
    if (entry?.exists) presentBytes += entry.size || file.size;
    else {
      presentBytes += entry?.partialSize || 0;
      missing.push(modelFilePath(file));
    }
  }
  return { installed: missing.length === 0, presentBytes, missing };
};

export type ModelDownloadProgress = {
  modelId: string;
  file: string;
  fileIndex: number;
  fileCount: number;
  /** Bytes of all required files that are on disk. */
  received: number;
  total: number;
  bytesPerSecond?: number;
};

const activeDownloads = new Map<string, { cancelled: boolean; currentId: string | null }>();

/** Download every missing file of a model, one after the other. Resolves when all are on disk. */
export const downloadLocalModel = async (model: LocalModelEntry, onProgress: (progress: ModelDownloadProgress) => void) => {
  const bridge = localModelsBridge();
  if (!bridge) throw new Error('Model downloads need the desktop app.');
  const { modelsRoot, hfToken } = getLocalModelSettings();
  if (!modelsRoot) throw new Error('Choose ComfyUI\'s models folder first.');
  if (activeDownloads.has(model.id)) return;
  const files = requiredFiles(model);
  const total = modelDownloadSize(model);
  const state = { cancelled: false, currentId: null as string | null };
  activeDownloads.set(model.id, state);
  try {
    const status = await bridge.check({ root: modelsRoot, files: files.map(modelFilePath) });
    let done = files.reduce((sum, file) => sum + (status[modelFilePath(file)]?.exists ? file.size : 0), 0);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index];
      const relativePath = modelFilePath(file);
      if (status[relativePath]?.exists) continue;
      if (state.cancelled) throw new Error('cancelled');
      const id = `${model.id}:${relativePath}`;
      state.currentId = id;
      const unsubscribe = bridge.onProgress((event) => {
        if (event.id !== id || event.state !== 'downloading') return;
        onProgress({ modelId: model.id, file: file.name, fileIndex: index, fileCount: files.length, received: done + (event.received || 0), total, bytesPerSecond: event.bytesPerSecond });
      });
      onProgress({ modelId: model.id, file: file.name, fileIndex: index, fileCount: files.length, received: done, total });
      const result = await bridge.download({ id, url: file.url, root: modelsRoot, relativePath, token: hfToken || undefined, expectedSize: file.size });
      unsubscribe();
      if (result.cancelled || state.cancelled) throw new Error('cancelled');
      if (!result.ok) throw new Error(`${file.name}: ${result.error || 'download failed'}`);
      done += file.size;
      onProgress({ modelId: model.id, file: file.name, fileIndex: index, fileCount: files.length, received: done, total });
    }
  } finally {
    activeDownloads.delete(model.id);
  }
};

export const cancelLocalModelDownload = async (modelId: string) => {
  const state = activeDownloads.get(modelId);
  if (!state) return;
  state.cancelled = true;
  if (state.currentId) await localModelsBridge()?.cancel({ id: state.currentId });
};

export const isLocalModelDownloading = (modelId: string) => activeDownloads.has(modelId);

/** Remove a model's files. Files shared with another installed model (e.g. a VAE) are kept. */
export const removeLocalModel = async (model: LocalModelEntry) => {
  const bridge = localModelsBridge();
  const { modelsRoot } = getLocalModelSettings();
  if (!bridge || !modelsRoot) return;
  const shared = new Set(
    LOCAL_MODEL_CATALOG.filter((other) => other.id !== model.id).flatMap((other) => other.files.map(modelFilePath))
  );
  const others = await Promise.all(
    LOCAL_MODEL_CATALOG.filter((other) => other.id !== model.id).map(async (other) => ({ other, state: await checkModelInstalled(other, modelsRoot) }))
  );
  const keep = new Set(others.filter(({ state }) => state.installed).flatMap(({ other }) => other.files.map(modelFilePath)));
  const files = model.files.map(modelFilePath).filter((file) => !(shared.has(file) && keep.has(file)));
  await bridge.remove({ root: modelsRoot, files });
};

// ---------------------------------------------------------------------------
// Running a workflow
// ---------------------------------------------------------------------------


const dataToBlob = (image: { base64: string; mimeType: string }) => {
  const binary = atob(image.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: image.mimeType || 'image/png' });
};

const comfyJson = async (baseUrl: string, path: string, init?: RequestInit) => {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let data: any = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) {
    const nodeErrors = data?.node_errors ? Object.values(data.node_errors).map((entry: any) => entry?.errors?.map((e: any) => `${e.message}: ${e.details}`).join('; ')).join(' | ') : '';
    throw new Error(`ComfyUI: ${data?.error?.message || text || response.status}${nodeErrors ? ` (${nodeErrors})` : ''}`);
  }
  return data;
};

/** Which class types the running ComfyUI is missing (outdated ComfyUI → new models' nodes absent). */
export const findMissingNodes = async (baseUrl: string, graph: Record<string, any>) => {
  const info = await comfyJson(baseUrl, '/object_info');
  const types = new Set(Object.values(graph).map((node: any) => String(node.class_type)));
  return Array.from(types).filter((type) => !info?.[type]);
};

const collectOutputs = (history: any) => {
  const files: Array<{ filename: string; subfolder?: string; type?: string; video: boolean }> = [];
  for (const output of Object.values(history?.outputs || {}) as any[]) {
    for (const key of ['videos', 'gifs', 'images', 'animated']) {
      for (const file of Array.isArray(output?.[key]) ? output[key] : []) {
        if (!file?.filename) continue;
        files.push({ ...file, video: key !== 'images' || /\.(mp4|webm|mov|gif|webp)$/i.test(file.filename) && key !== 'images' });
      }
    }
  }
  return files;
};

/**
 * Run a catalog model in ComfyUI. Model loading on the first run can take minutes, so
 * the wait is long; `onStatus` reports queue position and progress.
 */
export const runLocalModel = async (
  modelId: string,
  kind: LocalWorkflowKind,
  options: LocalRunOptions,
  onStatus?: (status: string) => void,
): Promise<MediaItem> => {
  const model = getLocalModel(modelId);
  if (!model) throw new Error(`Unknown local model: ${modelId}`);
  const template = model.workflows[kind];
  if (!template) throw new Error(`${model.label} has no ${kind} workflow.`);
  const baseUrl = getComfyBaseUrl();

  onStatus?.('Checking ComfyUI…');
  const missingNodes = await findMissingNodes(baseUrl, template.graph).catch((error) => {
    throw new Error(`ComfyUI is not reachable at ${baseUrl}. Start ComfyUI (Local AI → Images & video) and try again. ${error?.message || ''}`);
  });
  if (missingNodes.length) {
    throw new Error(`Your ComfyUI is missing nodes for ${model.label} (${missingNodes.join(', ')}). Update ComfyUI to the latest version.`);
  }

  const uploaded: string[] = [];
  for (const [index, image] of (options.images || []).slice(0, Math.max(1, template.bindings.images?.length || 0)).entries()) {
    onStatus?.(`Uploading reference ${index + 1}…`);
    const result = await uploadComfyImage(baseUrl, dataToBlob(image), `ref_${Date.now()}_${index}.png`);
    uploaded.push(result.subfolder ? `${result.subfolder}/${result.name}` : result.name);
  }
  if ((template.bindings.images?.length || 0) > 0 && uploaded.length === 0) {
    throw new Error(`${model.label} ${kind} needs a reference image.`);
  }

  let enhance = Boolean(options.enhance && template.bindings.enhancer);
  if (enhance && template.bindings.enhancer) {
    const { modelsRoot } = getLocalModelSettings();
    const bridge = localModelsBridge();
    const status = bridge && modelsRoot ? await bridge.check({ root: modelsRoot, files: [template.bindings.enhancer.file] }) : null;
    // Without the file ComfyUI would reject the whole graph; run with the prompt as typed.
    if (status && !status[template.bindings.enhancer.file]?.exists) enhance = false;
  }
  const graph = fillWorkflow(template, { ...options, enhance }, uploaded);
  onStatus?.('Queued in ComfyUI…');
  const queued = await comfyJson(baseUrl, '/prompt', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: graph, client_id: `ai-video-local-${Date.now()}` }),
  });
  const promptId = String(queued?.prompt_id || '');
  if (!promptId) throw new Error('ComfyUI did not return a prompt id.');

  const started = Date.now();
  const timeoutMs = model.kind === 'video' ? 60 * 60 * 1000 : 20 * 60 * 1000;
  while (Date.now() - started < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 1500));
    const history = await comfyJson(baseUrl, `/history/${encodeURIComponent(promptId)}`).catch(() => null);
    const entry = history?.[promptId];
    if (entry?.status?.status_str === 'error') {
      const message = (entry.status.messages || []).find((m: any) => m?.[0] === 'execution_error')?.[1];
      throw new Error(`ComfyUI failed in ${message?.node_type || 'a node'}: ${message?.exception_message || 'see the ComfyUI log'}`);
    }
    if (entry?.outputs && Object.keys(entry.outputs).length) {
      const files = collectOutputs(entry);
      const file = files.find((item) => item.video) || files[0];
      if (!file) throw new Error('ComfyUI finished without an output file.');
      const url = new URL('/view', baseUrl);
      url.searchParams.set('filename', file.filename);
      if (file.subfolder) url.searchParams.set('subfolder', file.subfolder);
      url.searchParams.set('type', file.type || 'output');
      const isVideo = model.kind === 'video' || /\.(mp4|webm|mov)$/i.test(file.filename);
      return {
        id: `local-${model.id}-${Date.now()}`,
        name: `${model.id}_${options.prompt.slice(0, 16) || 'local'}.${isVideo ? 'mp4' : 'png'}`,
        type: isVideo ? 'video' : 'image',
        url: url.toString(),
        source: 'generated',
        generatedBy: `${model.label} (local)`,
        prompt: options.prompt,
      } as MediaItem;
    }
    const queue = await comfyJson(baseUrl, '/queue').catch(() => null);
    const running = Array.isArray(queue?.queue_running) && queue.queue_running.some((item: any) => item?.[1] === promptId);
    const pendingIndex = Array.isArray(queue?.queue_pending) ? queue.queue_pending.findIndex((item: any) => item?.[1] === promptId) : -1;
    const elapsed = Math.round((Date.now() - started) / 1000);
    onStatus?.(running ? `Generating locally… ${elapsed}s (the first run loads the model)` : pendingIndex >= 0 ? `Waiting in the ComfyUI queue (position ${pendingIndex + 1})…` : `Working… ${elapsed}s`);
  }
  throw new Error('The local generation took too long. Check ComfyUI.');
};
