/**
 * MCP tools: Upscale page (AI upscaling, frame interpolation, SDR→HDR,
 * grain add-back, A/B comparison and the render queue).
 *
 * Models and estimates are computed here (pure). Everything that touches the
 * page state (input queue, settings, comparison view, jobs) goes through live
 * commands registered by `UpscaleWorkspace` while it is mounted; the tools
 * open the page when needed. Tools that spend provider credits refuse to run
 * without `confirm: true`.
 */
import { invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, str, type JsonSchema, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';
import {
  DEFAULT_SETTINGS,
  estimateOutputBytes,
  formatBytes,
  OUTPUT_PRESETS,
  planPipeline,
  sanitizeSettings,
  sumPipelineCost,
  type UpscaleSettings,
} from '../../workspaces/upscale-pro/upscaleOps.ts';
import {
  ENHANCE_MODELS,
  HDR_ENGINES,
  INTERPOLATION_MODEL,
  UPSCALE_FALLBACK_RATES,
} from '../../workspaces/upscale-pro/upscaleModels.ts';

const live = (ctx: StudioToolContext, name: string, args: Record<string, unknown>) =>
  invokeLiveCommand(name, args, { openWorkspace: () => ctx.actions.setActiveWorkspace('UPSCALE'), workspace: 'UPSCALE' }) as Promise<Record<string, unknown>>;

/** Settings patch properties shared by estimate / settings_set / queue_add. */
const SETTINGS_PROPS: Record<string, JsonSchema> = {
  sizeMode: { type: 'string', enum: ['scale', 'preset', 'custom'], description: 'How the output size is chosen.' },
  scale: { type: 'number', minimum: 1, maximum: 8, description: 'Scale factor for sizeMode "scale" (e.g. 2 or 4).' },
  preset: { type: 'string', enum: OUTPUT_PRESETS.map((p) => p.id), description: 'Target box for sizeMode "preset".' },
  width: { type: 'integer', minimum: 2, maximum: 16384, description: 'Target width for sizeMode "custom".' },
  height: { type: 'integer', minimum: 2, maximum: 16384, description: 'Target height for sizeMode "custom".' },
  cropToFill: { type: 'boolean', description: 'Fill the target box exactly and crop the overhang.' },
  model: { type: 'string', enum: ENHANCE_MODELS.map((m) => m.id), description: 'Enhancement model (image or video model, see upscale_models_list).' },
  enhance: { type: 'boolean', description: 'Enable the enhancement (upscale) model.' },
  interpolate: { type: 'boolean', description: 'Frame interpolation (RIFE, 2× frame rate), videos only.' },
  hdr: { type: 'boolean', description: 'SDR→HDR step, videos only.' },
  hdrEngine: { type: 'string', enum: HDR_ENGINES.map((e) => e.id) },
  sharpen: { type: 'number', minimum: 0, maximum: 1, description: 'Local sharpening (images).' },
  grain: { type: 'number', minimum: 0, maximum: 1, description: 'Grain add-back amount (Optics Lab sensor grain).' },
  grainSize: { type: 'number', minimum: 0.5, maximum: 4, description: 'Grain size.' },
  videoCodec: { type: 'string', enum: ['h264', 'h265', 'prores'] },
  quality: { type: 'string', enum: ['low', 'medium', 'high'] },
  audio: { type: 'boolean', description: 'Keep the audio track.' },
  imageFormat: { type: 'string', enum: ['png', 'jpeg', 'webp'] },
};

/** Applies a flat tool-args patch onto settings (validated). */
export const applySettingsArgs = (base: UpscaleSettings, args: Record<string, unknown>): UpscaleSettings => {
  const next: UpscaleSettings = JSON.parse(JSON.stringify(base));
  if (typeof args.sizeMode === 'string') next.output.mode = args.sizeMode as UpscaleSettings['output']['mode'];
  if (args.scale !== undefined) { next.output.scale = numArg(args, 'scale'); if (args.sizeMode === undefined) next.output.mode = 'scale'; }
  if (typeof args.preset === 'string') { next.output.preset = args.preset as UpscaleSettings['output']['preset']; if (args.sizeMode === undefined) next.output.mode = 'preset'; }
  if (args.width !== undefined) { next.output.customWidth = numArg(args, 'width'); if (args.sizeMode === undefined) next.output.mode = 'custom'; }
  if (args.height !== undefined) next.output.customHeight = numArg(args, 'height');
  if (typeof args.cropToFill === 'boolean') next.output.cropToFill = args.cropToFill;
  if (typeof args.model === 'string') {
    const model = ENHANCE_MODELS.find((m) => m.id === args.model);
    if (!model) throw new Error(`Unknown model ${args.model}.`);
    if (model.kind === 'image') next.enhance.imageModel = model.id; else next.enhance.videoModel = model.id;
  }
  if (typeof args.enhance === 'boolean') next.enhance.enabled = args.enhance;
  if (typeof args.interpolate === 'boolean') next.interpolation.enabled = args.interpolate;
  if (typeof args.hdr === 'boolean') next.hdr.enabled = args.hdr;
  if (typeof args.hdrEngine === 'string') next.hdr.engine = args.hdrEngine as UpscaleSettings['hdr']['engine'];
  if (args.sharpen !== undefined) next.post.sharpen = numArg(args, 'sharpen');
  if (args.grain !== undefined) next.post.grain = numArg(args, 'grain');
  if (args.grainSize !== undefined) next.post.grainSize = numArg(args, 'grainSize');
  if (typeof args.videoCodec === 'string') next.export.videoCodec = args.videoCodec as UpscaleSettings['export']['videoCodec'];
  if (typeof args.quality === 'string') next.export.quality = args.quality as UpscaleSettings['export']['quality'];
  if (typeof args.audio === 'boolean') next.export.audio = args.audio;
  if (typeof args.imageFormat === 'string') next.export.imageFormat = args.imageFormat as UpscaleSettings['export']['imageFormat'];
  return sanitizeSettings(next);
};

/** Pure estimate for an explicit source (no page needed). Uses the default app rates. */
export const estimateFor = (settings: UpscaleSettings, source: { kind: 'image' | 'video'; width: number; height: number; fps: number; seconds: number; partialRange?: boolean }) => {
  const plan = planPipeline(settings, {
    kind: source.kind,
    source: { width: source.width, height: source.height },
    fps: source.fps,
    rangeSeconds: source.seconds,
    partialRange: Boolean(source.partialRange),
  });
  const size = plan.target ?? { width: source.width, height: source.height };
  const bytes = estimateOutputBytes({
    kind: source.kind,
    width: size.width,
    height: size.height,
    fps: plan.outputFps,
    seconds: source.seconds,
    codec: settings.export.videoCodec,
    quality: settings.export.quality,
    audio: settings.export.audio,
    imageFormat: settings.export.imageFormat,
  });
  const cost = sumPipelineCost(plan.steps, (step) => {
    const rate = UPSCALE_FALLBACK_RATES.find((entry) => entry.model === step.providerModel);
    return rate ? rate.unitCost * (step.units ?? 1) : null;
  });
  return {
    output: { width: size.width, height: size.height, fps: source.kind === 'video' ? plan.outputFps : null, limited: plan.target?.limited ?? false },
    steps: plan.steps.map((step) => ({ id: step.id, label: step.label, paid: step.paid, units: step.units ?? null, unit: step.unitLabel ?? null })),
    estimatedBytes: bytes,
    estimatedSize: formatBytes(bytes),
    estimatedUsd: cost.usd,
    unknownCostSteps: cost.unknown,
    errors: plan.errors,
    warnings: plan.warnings,
    rateSource: 'app default rates',
  };
};

const requireConfirm = (args: Record<string, unknown>, what: string) => {
  if (args.confirm !== true) {
    throw new Error(`${what} spends provider credits. Check upscale_estimate first, then call again with confirm: true.`);
  }
};

export const UPSCALE_TOOL_MODULE: StudioToolModule = {
  id: 'upscale',
  label: 'Upscale',
  tools: [
    {
      name: 'upscale_models_list',
      description: 'List the AI models of the Upscale page: enhancement models (image/video, with output limits), frame interpolation and SDR→HDR engines, plus output presets.',
      parameters: { type: 'object', properties: { kind: { type: 'string', enum: ['image', 'video'], description: 'Only enhancement models for this media kind.' } } },
      handler: (args) => ({
        enhancement: ENHANCE_MODELS
          .filter((model) => (args.kind === 'image' || args.kind === 'video' ? model.kind === args.kind : true))
          .map((model) => ({ id: model.id, label: model.label, kind: model.kind, provider: model.provider, description: model.description, maxLongEdge: model.limits.maxLongEdge, maxScale: model.limits.maxScale })),
        interpolation: [{ id: INTERPOLATION_MODEL.id, label: INTERPOLATION_MODEL.label, factor: INTERPOLATION_MODEL.factor, description: INTERPOLATION_MODEL.description }],
        hdr: HDR_ENGINES.map((engine) => ({ id: engine.id, label: engine.label, description: engine.description, maxSeconds: engine.maxSeconds, maxLongEdge: engine.maxLongEdge })),
        presets: OUTPUT_PRESETS,
        stabilization: null,
        defaults: { imageModel: DEFAULT_SETTINGS.enhance.imageModel, videoModel: DEFAULT_SETTINGS.enhance.videoModel },
      }),
    },
    {
      name: 'upscale_estimate',
      description: 'Estimate output size (pixels, fps, file size) and cost for upscaling. Pass mediaId (uses the Upscale page settings, probes the media) or kind+width+height(+seconds, fps) for a standalone estimate. Settings fields override the page settings for this estimate only.',
      parameters: {
        type: 'object',
        properties: {
          mediaId: { type: 'string', description: 'Media bin item id.' },
          kind: { type: 'string', enum: ['image', 'video'] },
          sourceWidth: { type: 'integer', minimum: 1 },
          sourceHeight: { type: 'integer', minimum: 1 },
          seconds: { type: 'number', minimum: 0, description: 'Range length (videos).' },
          fps: { type: 'number', minimum: 1 },
          ...SETTINGS_PROPS,
        },
      },
      handler: async (args, ctx) => {
        if (typeof args.mediaId === 'string' && args.sourceWidth === undefined) {
          return live(ctx, 'upscale.estimate', args);
        }
        const kind = args.kind === 'video' ? 'video' : 'image';
        const settings = applySettingsArgs(DEFAULT_SETTINGS, args);
        return estimateFor(settings, {
          kind,
          width: numArg(args, 'sourceWidth'),
          height: numArg(args, 'sourceHeight'),
          fps: numArg(args, 'fps', 24),
          seconds: kind === 'video' ? numArg(args, 'seconds', 5) : 0,
        });
      },
    },
    {
      name: 'upscale_state_get',
      description: 'Read the Upscale page: input queue (resolution, fps, duration, status), active input, settings, comparison view, In/Out range and rendered previews.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => live(ctx, 'upscale.state.get', {}),
    },
    {
      name: 'upscale_input_add',
      description: 'Add a media bin item (image or video) to the Upscale input queue and make it active. Free; does not start a job.',
      writes: true,
      parameters: { type: 'object', properties: { mediaId: { type: 'string' } }, required: ['mediaId'] },
      handler: (args, ctx) => {
        const mediaId = str(args, 'mediaId');
        const item = ctx.getState().mediaItems.find((entry) => entry.id === mediaId);
        if (!item) throw new Error(`Media ${mediaId} not found.`);
        if (item.type !== 'image' && item.type !== 'video') throw new Error('Only images and videos can be upscaled.');
        return live(ctx, 'upscale.input.add', { mediaId });
      },
    },
    {
      name: 'upscale_settings_set',
      description: 'Change Upscale page settings: output size (scale/preset/custom, crop to fill), enhancement model, interpolation, SDR→HDR, sharpen, grain add-back, export codec/quality/audio/image format. Returns the full settings.',
      writes: true,
      parameters: { type: 'object', properties: SETTINGS_PROPS },
      handler: (args, ctx) => live(ctx, 'upscale.settings.set', args),
    },
    {
      name: 'upscale_view_set',
      description: 'Control the comparison view: mode (single/side/wipe), which side single mode shows, zoom ("fit" or 1, 2 …), wipe position 0..1, playhead and In/Out (seconds), active input.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          inputId: { type: 'string', description: 'Queue input to activate.' },
          mode: { type: 'string', enum: ['single', 'side', 'wipe'] },
          show: { type: 'string', enum: ['before', 'after'] },
          zoom: { type: 'string', description: '"fit" or a factor like "1", "2".' },
          wipe: { type: 'number', minimum: 0, maximum: 1 },
          time: { type: 'number', minimum: 0 },
          in: { type: 'number', minimum: 0 },
          out: { type: 'number', minimum: 0 },
        },
      },
      handler: (args, ctx) => live(ctx, 'upscale.view.set', args),
    },
    {
      name: 'upscale_preview_render',
      description: 'Render a short preview of the active (or given) input with the current settings: lengthSeconds 0 = single frame, 1–3 = clip from the playhead (or atSeconds). Spends credits: requires confirm: true.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          inputId: { type: 'string' },
          lengthSeconds: { type: 'number', minimum: 0, maximum: 3 },
          atSeconds: { type: 'number', minimum: 0 },
          confirm: { type: 'boolean', description: 'Must be true (spends provider credits).' },
        },
      },
      handler: (args, ctx) => {
        requireConfirm(args, 'Preview rendering');
        return live(ctx, 'upscale.preview.render', args);
      },
    },
    {
      name: 'upscale_queue_add',
      description: 'Queue a full upscale job for a media bin item (added to the input queue if needed) over its In/Out range. Optional settings fields (size, model, grain …) are applied first. Results land in the media bin. Spends credits: requires confirm: true.',
      writes: true,
      parameters: {
        type: 'object',
        properties: {
          mediaId: { type: 'string', description: 'Media bin item id; defaults to the active input.' },
          in: { type: 'number', minimum: 0 },
          out: { type: 'number', minimum: 0 },
          confirm: { type: 'boolean', description: 'Must be true (spends provider credits).' },
          ...SETTINGS_PROPS,
        },
      },
      handler: (args, ctx) => {
        requireConfirm(args, 'An upscale job');
        if (typeof args.mediaId === 'string' && !ctx.getState().mediaItems.some((entry) => entry.id === args.mediaId)) {
          throw new Error(`Media ${args.mediaId} not found.`);
        }
        return live(ctx, 'upscale.queue.add', args);
      },
    },
    {
      name: 'upscale_queue_list',
      description: 'List upscale jobs (previews and exports) with status, progress, step, estimated cost and result media id.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => live(ctx, 'upscale.queue.list', {}),
    },
    {
      name: 'upscale_queue_cancel',
      description: 'Cancel a queued or running upscale job (a running cloud request finishes server-side; its result is discarded). Pass all: true to cancel every active job.',
      writes: true,
      parameters: { type: 'object', properties: { jobId: { type: 'string' }, all: { type: 'boolean' } } },
      handler: (args, ctx) => {
        if (args.all !== true) str(args, 'jobId');
        return live(ctx, 'upscale.queue.cancel', args);
      },
    },
  ],
};

registerStudioToolModule(UPSCALE_TOOL_MODULE);
