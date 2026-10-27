/**
 * MCP (photo_ai_* tools): generative fill with a chosen resolution, local
 * canvas expand, neural looks, image size and PNG export of the Photo page.
 * PhotoWorkspace calls this hook once; every action runs the page's own
 * handler. Complements the photo_* tools (layers, selection, crop …).
 */
import { useRef } from 'react';
import { useLivePage } from '../../mcp/livePage';
import { parseDataUrl, urlToPayload } from '../../mcp/mediaInput';

type NeuralPresetLike = { id: string; label: string; description: string; requiresReference?: boolean; aiPrompt?: string; fallback?: Record<string, number> };
type NeuralReference = { file: File; url: string; base64: string; mimeType: string } | null;
type DocLike = { width: number; height: number; layers: unknown[]; selection?: unknown; name: string } | null;

export const PHOTO_INPAINT_MODELS = ['nano-banana-pro', 'nano-banana-2-fal', 'flux-2-pro', 'z-turbo-inpaint'] as const;
export const PHOTO_RESOLUTIONS = ['1K', '2K', '4K', 'match_input_image', '0.5 MP', '1 MP', '2 MP', '4 MP'] as const;
/** Valid resolutions per inpaint model (Z-Turbo picks its own size). */
export const PHOTO_RESOLUTIONS_BY_MODEL: Record<(typeof PHOTO_INPAINT_MODELS)[number], readonly string[]> = {
  'nano-banana-pro': ['1K', '2K', '4K'],
  'nano-banana-2-fal': ['1K', '2K', '4K'],
  'flux-2-pro': ['match_input_image', '0.5 MP', '1 MP', '2 MP', '4 MP'],
  'z-turbo-inpaint': [],
};

export type PhotoAiLiveProps = {
  inpaintPrompt: string; setInpaintPrompt: (v: string) => void;
  inpaintModel: string; setInpaintModel: (v: never) => void;
  resolution: string; setResolution: (v: never) => void;
  expandPadding: number; setExpandPadding: (v: number) => void;
  expandPrompt: string; setExpandPrompt: (v: string) => void;
  neuralIntensity: number; setNeuralIntensity: (v: number) => void;
  neuralPrompt: string; setNeuralPrompt: (v: string) => void;
  neuralReference: NeuralReference; setNeuralReference: (v: NeuralReference) => void;
  neuralPresets: NeuralPresetLike[];
  busy: string | null;
  statusRef: { current: string | null | undefined };
  docRef: { current: DocLike };
  runInpaint: (prompt: string | undefined, opts: { label: string; layerName: string }) => Promise<boolean>;
  handleHeal: () => Promise<boolean>;
  expandCanvas: (pad: number) => unknown;
  expandAndFill: () => Promise<void>;
  applyNeuralPreset: (preset: never) => Promise<void>;
  resizeImage: (width: number, height: number) => void;
  exportFlattened: () => Promise<HTMLCanvasElement | null>;
};

export function usePhotoAiLiveCommands(props: PhotoAiLiveProps): void {
  const latest = useRef(props);
  latest.current = props;

  const requireDoc = () => {
    const doc = latest.current.docRef.current;
    if (!doc) throw new Error('Kein Dokument geöffnet (photo_open oder photo_new_document).');
    return doc;
  };
  const layerCount = () => latest.current.docRef.current?.layers.length ?? 0;
  const failIfUnchanged = (before: number, fallback: string) => {
    if (layerCount() <= before) throw new Error(latest.current.statusRef.current || fallback);
  };

  useLivePage('photo_ai', {
    settings: {
      inpaintPrompt: { value: props.inpaintPrompt, set: props.setInpaintPrompt as never, type: 'string' },
      expandPadding: { value: props.expandPadding, set: props.setExpandPadding as never, type: 'number', min: 1, max: 4096 },
      expandPrompt: { value: props.expandPrompt, set: props.setExpandPrompt as never, type: 'string' },
      neuralIntensity: { value: props.neuralIntensity, set: props.setNeuralIntensity as never, type: 'number', min: 0, max: 100 },
      neuralPrompt: { value: props.neuralPrompt, set: props.setNeuralPrompt as never, type: 'string' },
    },
    info: () => ({
      busy: props.busy,
      status: props.statusRef.current ?? null,
      inpaintModel: props.inpaintModel,
      resolution: props.resolution,
      resolutionsByModel: PHOTO_RESOLUTIONS_BY_MODEL,
      neuralReference: props.neuralReference ? { mimeType: props.neuralReference.mimeType } : null,
      neuralPresets: props.neuralPresets.map(({ id, label, description, requiresReference, fallback }) => ({ id, label, description, requiresReference: Boolean(requiresReference), paid: !fallback })),
      document: props.docRef.current ? { name: props.docRef.current.name, width: props.docRef.current.width, height: props.docRef.current.height, hasSelection: Boolean(props.docRef.current.selection) } : null,
    }),
    actions: {
      /** Generative fill / heal with an explicit model and resolution (photo_generative_fill always uses 2K). */
      inpaint: async (args, { waitForCommit }) => {
        requireDoc();
        const model = String(args.model ?? latest.current.inpaintModel) as (typeof PHOTO_INPAINT_MODELS)[number];
        if (!PHOTO_INPAINT_MODELS.includes(model)) throw new Error(`model must be one of ${PHOTO_INPAINT_MODELS.join(', ')}.`);
        const allowed = PHOTO_RESOLUTIONS_BY_MODEL[model];
        const resolution = args.resolution === undefined ? null : String(args.resolution);
        if (resolution !== null && !allowed.includes(resolution)) {
          throw new Error(allowed.length ? `${model} takes resolution ${allowed.join(', ')}.` : `${model} chooses the size itself; omit resolution.`);
        }
        if (model !== latest.current.inpaintModel) {
          latest.current.setInpaintModel(model as never);
          await waitForCommit(); // the page resets the resolution when the model changes
        }
        if (resolution !== null && resolution !== latest.current.resolution) {
          latest.current.setResolution(resolution as never);
          await waitForCommit();
        }
        const before = layerCount();
        const heal = args.heal === true;
        const ok = heal
          ? await latest.current.handleHeal()
          : await latest.current.runInpaint(String(args.prompt ?? latest.current.inpaintPrompt ?? ''), { label: 'Generative Füllung', layerName: 'Generative Füllung' });
        if (!ok) throw new Error(latest.current.statusRef.current || 'Generative fill failed.');
        await waitForCommit();
        failIfUnchanged(before, 'Generative fill added no layer.');
        return { model, resolution: latest.current.resolution, layers: layerCount() };
      },
      /** Grow the canvas on every side and select the new border (no AI). */
      expand_canvas: (args) => {
        requireDoc();
        const pad = Number(args.padding ?? latest.current.expandPadding);
        const next = latest.current.expandCanvas(pad);
        if (!next) throw new Error(latest.current.statusRef.current || 'Expand failed.');
        const doc = latest.current.docRef.current;
        return { padding: pad, width: (next as { width?: number }).width ?? doc?.width, height: (next as { height?: number }).height ?? doc?.height };
      },
      /** Expand + generative fill of the new border ("Erweitern und füllen"). */
      expand_and_fill: async (_args, { waitForCommit }) => {
        requireDoc();
        const before = layerCount();
        await latest.current.expandAndFill();
        await waitForCommit();
        failIfUnchanged(before, 'Expand and fill added no layer.');
        return { layers: layerCount() };
      },
      set_neural_reference: async (args) => {
        const url = String(args.url ?? args.imagePath ?? '');
        if (!url) { latest.current.setNeuralReference(null); return { reference: null }; }
        const payload = parseDataUrl(url) ?? (await urlToPayload(url, 'image/png'));
        const bytes = Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0));
        const file = new File([bytes], 'reference', { type: payload.mimeType });
        latest.current.setNeuralReference({ file, url: URL.createObjectURL(file), base64: payload.base64, mimeType: payload.mimeType });
        return { reference: { mimeType: payload.mimeType } };
      },
      /** Apply a neural look as adjustment layer (opacity = intensity). */
      neural_look: async (args, { waitForCommit }) => {
        requireDoc();
        const preset = latest.current.neuralPresets.find((entry) => entry.id === args.preset);
        if (!preset) throw new Error(`preset must be one of ${latest.current.neuralPresets.map((entry) => entry.id).join(', ')}.`);
        if (typeof args.prompt === 'string') { latest.current.setNeuralPrompt(args.prompt); await waitForCommit(); }
        if (preset.requiresReference && !latest.current.neuralReference) throw new Error('Harmonize needs a reference image (photo_ai_set_neural_reference).');
        const before = layerCount();
        await latest.current.applyNeuralPreset(preset as never);
        await waitForCommit();
        failIfUnchanged(before, 'The neural look produced no layer.');
        return { preset: preset.id, layers: layerCount() };
      },
      resize_image: (args) => {
        requireDoc();
        const width = Math.round(Number(args.width));
        const height = Math.round(Number(args.height));
        if (!(width > 0 && height > 0)) throw new Error('width and height must be positive pixel values.');
        latest.current.resizeImage(width, height);
        return { width, height };
      },
      /** The flattened image as PNG data URL ("Als PNG herunterladen" without a download). */
      export_png: async () => {
        requireDoc();
        const canvas = await latest.current.exportFlattened();
        if (!canvas) throw new Error('Nothing to export.');
        return { width: canvas.width, height: canvas.height, dataUrl: canvas.toDataURL('image/png') };
      },
    },
  });
}
