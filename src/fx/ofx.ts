/**
 * Native OpenFX plugins in the FX engine.
 *
 * The Electron main process runs `native/ofx-host` (a CPU OpenFX host). Here
 * its scanned plugins become FxDefinitions (`ofx:<plugin id>`), and stacks
 * that contain them render asynchronously: WebGL effects on the GPU, OFX
 * effects through the host, in stack order.
 */
import { getFxDefinition, hasActiveFx, needsNativeHost, registerFx, resolveParams, resolveStackAtTime } from './registry.ts';
import { FxRenderer } from './renderer.ts';
import type { FxCategory, FxDefinition, FxGroup, FxParamDef, FxParamValues, FxStack } from './types.ts';

type OfxResult<T> = ({ ok: true; error?: undefined } & T) | { ok: false; error?: string; crashed?: boolean; timeout?: boolean; cancelled?: boolean };

export type OfxParamDescriptor = {
  name: string;
  type: string;
  label?: string;
  hint?: string;
  parent?: string;
  order?: number;
  secret?: boolean;
  dimension?: number;
  default?: unknown;
  min?: number | null;
  max?: number | null;
  displayMin?: number | null;
  displayMax?: number | null;
  options?: string[];
  groupOpen?: boolean;
};

export type OfxPluginDescriptor = {
  id: string;
  versionString?: string;
  label?: string;
  grouping?: string;
  description?: string;
  supported?: boolean;
  temporalClipAccess?: boolean;
  params?: OfxParamDescriptor[];
};

export type OfxBridge = {
  status: () => Promise<OfxResult<Record<string, unknown>>>;
  scan: (payload?: { force?: boolean; refresh?: boolean; paths?: string[] }) => Promise<OfxResult<{ plugins: OfxPluginDescriptor[] }>>;
  render: (payload: {
    pluginId: string;
    instanceId: string;
    params: FxParamValues;
    time: number;
    width: number;
    height: number;
    format: 'rgba8' | 'rgba16' | 'rgba32f';
    pixels: ArrayBufferView | ArrayBuffer;
  }) => Promise<OfxResult<{ pixels: Uint8Array; renderMs?: number; warnings?: string[] }>>;
  framesNeeded?: (payload: unknown) => Promise<unknown>;
  destroyInstance?: (payload: { instanceId: string }) => Promise<unknown>;
  bake: (payload: {
    jobId: string;
    input: string;
    output: string;
    chain: Array<{ pluginId: string; params: FxParamValues }>;
    codec?: string;
    startTime?: number;
    duration?: number;
    fps?: number;
    audio?: boolean;
  }) => Promise<OfxResult<{ output?: string }>>;
  cancelBake?: (payload: { jobId: string }) => Promise<unknown>;
  onBakeProgress?: (callback: (progress: { jobId: string; status: string; percent?: number; frame?: number; totalFrames?: number }) => void) => () => void;
};

export const ofxBridge = (): OfxBridge | undefined =>
  typeof window !== 'undefined' ? (window as unknown as { electron?: { ofx?: OfxBridge } }).electron?.ofx : undefined;

const guessCategory = (plugin: OfxPluginDescriptor): FxCategory => {
  const text = `${plugin.label ?? ''} ${plugin.id}`.toLowerCase();
  if (/lens|optic|bokeh|glass/.test(text)) return 'lens';
  if (/film|grain|halation|stock/.test(text)) return 'film';
  if (/deband|denoise|jitter|repair|recover|integrity|stabil/.test(text)) return 'repair';
  if (/diagnos|scope|analy/.test(text)) return 'diagnostic';
  if (/grade|color|colour|look|lut|relight/.test(text)) return 'color';
  return 'stylize';
};

const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** Maps an OFX parameter to the engine's schema; unsupported types are skipped. */
export function mapOfxParam(param: OfxParamDescriptor): FxParamDef | null {
  const base = { id: param.name, label: param.label || param.name, group: param.parent || undefined, hint: param.hint || undefined, hidden: Boolean(param.secret) };
  if ((param.dimension ?? 1) !== 1) return null;
  switch (param.type) {
    case 'double': {
      const def = finite(param.default) ? param.default : 0;
      const min = finite(param.min) ? param.min : finite(param.displayMin) ? param.displayMin : Math.min(0, def);
      const max = finite(param.max) ? param.max : finite(param.displayMax) ? param.displayMax : Math.max(1, def * 2 || 1);
      return {
        ...base,
        type: 'float',
        default: def,
        min,
        max,
        displayMin: finite(param.displayMin) ? param.displayMin : undefined,
        displayMax: finite(param.displayMax) ? param.displayMax : undefined,
      };
    }
    case 'int': {
      const def = finite(param.default) ? Math.round(param.default) : 0;
      return { ...base, type: 'int', default: def, min: finite(param.min) ? param.min : Math.min(0, def), max: finite(param.max) ? param.max : Math.max(100, def) };
    }
    case 'bool':
      return { ...base, type: 'bool', default: Boolean(param.default) };
    case 'choice':
      return { ...base, type: 'choice', default: finite(param.default) ? param.default : 0, options: param.options?.length ? param.options : ['–'] };
    default:
      return null;
  }
}

export function ofxPluginToDefinition(plugin: OfxPluginDescriptor): FxDefinition {
  const all = plugin.params ?? [];
  const groups: FxGroup[] = all
    .filter((param) => param.type === 'group')
    .map((param) => ({ id: param.name, label: param.label || param.name, collapsed: param.groupOpen === false }));
  const params = all
    .slice()
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map(mapOfxParam)
    .filter((param): param is FxParamDef => Boolean(param));
  const ungrouped = params.some((param) => !param.group || !groups.some((group) => group.id === param.group));
  if (ungrouped) {
    groups.unshift({ id: '__main', label: 'Parameter' });
    params.forEach((param) => {
      if (!param.group || !groups.some((group) => group.id === param.group)) param.group = '__main';
    });
  }
  return {
    id: `ofx:${plugin.id}`,
    name: plugin.label || plugin.id,
    vendor: `${plugin.grouping || 'OFX'} · OFX`,
    version: plugin.versionString || '',
    category: guessCategory(plugin),
    description: plugin.description || `Native OpenFX plugin ${plugin.id} (CPU, via the OFX host).`,
    ofxIdentifier: plugin.id,
    groups,
    params,
    passes: [],
    temporal: Boolean(plugin.temporalClipAccess),
    native: 'ofx',
  };
}

let scanPromise: Promise<FxDefinition[]> | null = null;

/** Scans installed OFX plugins once (cached by the host) and registers them. */
export function loadOfxDefinitions(force = false): Promise<FxDefinition[]> {
  const bridge = ofxBridge();
  if (!bridge) return Promise.resolve([]);
  if (scanPromise && !force) return scanPromise;
  scanPromise = bridge
    .scan(force ? { force: true } : undefined)
    .then((result) => {
      if (!result.ok) {
        console.warn('[fx] OFX scan failed', result.error);
        return [];
      }
      const definitions = result.plugins.filter((plugin) => plugin.supported !== false).map(ofxPluginToDefinition);
      definitions.forEach(registerFx);
      return definitions;
    })
    .catch((error) => {
      console.warn('[fx] OFX scan failed', error);
      scanPromise = null;
      return [];
    });
  return scanPromise;
}

/** OFX plugin id an instance renders with on the native host (GPU ports map to their original). */
export function nativePluginId(effectId: string): string | null {
  if (effectId.startsWith('ofx:')) return effectId.slice(4);
  const definition = getFxDefinition(effectId);
  return definition?.ofxIdentifier ?? null;
}

const toCanvas = (source: CanvasImageSource, width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(source, 0, 0, width, height);
  return { canvas, ctx };
};

let asyncRenderer: FxRenderer | null = null;

/**
 * Renders a stack that may contain native OFX effects. Consecutive WebGL
 * effects run as one GPU segment; OFX effects go through the host (RGBA8,
 * top-down). Resolves to a canvas of `width`×`height`. FX keyframes are
 * evaluated at `keyframeTime` (clip-local seconds; photo editor = 0) and sent
 * to the host as constant params for this frame.
 */
export async function renderStackAsync(
  source: CanvasImageSource,
  fullStack: FxStack,
  options: { width: number; height: number; frameIndex: number; keyframeTime?: number },
): Promise<HTMLCanvasElement> {
  const { width, height, frameIndex } = options;
  const stack = resolveStackAtTime(fullStack, options.keyframeTime ?? 0);
  const { canvas, ctx } = toCanvas(source, width, height);
  if (!hasActiveFx(stack)) return canvas;
  const bridge = ofxBridge();
  let pending: FxStack = [];

  const flushGpu = () => {
    if (pending.length === 0) return;
    asyncRenderer ??= new FxRenderer();
    const result = asyncRenderer.render(canvas, pending, { frameIndex, quality: 'full' });
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(result as CanvasImageSource, 0, 0, width, height);
    pending = [];
  };

  for (const instance of stack) {
    if (!instance.enabled || (instance.mix ?? 1) <= 0.0001) continue;
    const definition = getFxDefinition(instance.effectId);
    if (definition && !definition.native) {
      pending.push(instance);
      continue;
    }
    flushGpu();
    const pluginId = nativePluginId(instance.effectId);
    if (!bridge || !pluginId) throw new Error(`OFX-Plugin ${instance.effectId} ist nicht verfügbar (Desktop-App nötig).`);
    const input = ctx.getImageData(0, 0, width, height);
    const result = await bridge.render({
      pluginId,
      instanceId: `${instance.id}@${width}x${height}`,
      params: resolveParams(instance),
      time: frameIndex,
      width,
      height,
      format: 'rgba8',
      pixels: input.data,
    });
    if (!result.ok) throw new Error(result.error || `OFX render failed (${pluginId})`);
    const mix = Math.min(1, Math.max(0, instance.mix ?? 1));
    const out = new Uint8ClampedArray(result.pixels.buffer, result.pixels.byteOffset, result.pixels.byteLength);
    if (mix < 0.9999) {
      for (let i = 0; i < out.length; i += 1) out[i] = input.data[i] + (out[i] - input.data[i]) * mix;
    }
    ctx.putImageData(new ImageData(new Uint8ClampedArray(out), width, height), 0, 0);
  }
  flushGpu();
  return canvas;
}

/**
 * Preview cache for stacks with OFX effects: `drawImage`-able result for the
 * latest finished request, re-requested when frame/stack/size change.
 */
export class OfxPreviewCache {
  private key = '';
  private busy = false;
  private result: HTMLCanvasElement | null = null;
  private resultKey = '';
  private readonly onUpdate: () => void;
  private readonly maxDimension: number;
  constructor(onUpdate: () => void, maxDimension = 960) {
    this.onUpdate = onUpdate;
    this.maxDimension = maxDimension;
  }

  get(source: CanvasImageSource, stack: FxStack, frameIndex: number, naturalWidth: number, naturalHeight: number): CanvasImageSource | null {
    if (!needsNativeHost(stack) || !naturalWidth || !naturalHeight) return null;
    const scale = Math.min(1, this.maxDimension / Math.max(naturalWidth, naturalHeight));
    const width = Math.max(2, Math.round(naturalWidth * scale));
    const height = Math.max(2, Math.round(naturalHeight * scale));
    const key = `${JSON.stringify(stack)}|${frameIndex}|${width}x${height}`;
    this.key = key;
    if (!this.busy && this.resultKey !== key) {
      this.busy = true;
      renderStackAsync(source, stack, { width, height, frameIndex })
        .then((canvas) => {
          this.result = canvas;
          this.resultKey = key;
          this.onUpdate();
        })
        .catch((error) => console.warn('[fx] OFX preview failed', error))
        .finally(() => {
          this.busy = false;
          if (this.key !== this.resultKey) this.onUpdate();
        });
    }
    return this.result;
  }
}
