/**
 * MCP tools: GPU lens/film effects (Buckswood Post Plugins ports), native
 * OFX plugins and the Burst Frame prompt builder.
 */
import { createFxInstance, getFxDefinition, listFxDefinitions, resolveParams } from '../../fx/registry.ts';
import { loadOfxDefinitions } from '../../fx/ofx.ts';
import type { FxDefinition, FxInstance, FxParamValues } from '../../fx/types.ts';
import { buildBurstFramePrompt, checkBurstFramePrompt, type BurstLighting, type BurstSubjectKind } from '../../services/burstFrame.ts';
import { findClip, numArg, registerStudioToolModule, str, type StudioToolModule } from '../toolModules.ts';

const summarize = (definition: FxDefinition, withParams: boolean) => ({
  id: definition.id,
  name: definition.name,
  vendor: definition.vendor,
  category: definition.category,
  native: definition.native ?? 'webgl',
  ofxIdentifier: definition.ofxIdentifier ?? null,
  description: definition.description,
  presets: (definition.presets ?? []).map((preset) => ({ id: preset.id, name: preset.name })),
  ...(withParams
    ? {
        params: definition.params
          .filter((param) => !param.hidden)
          .map((param) => ({
            id: param.id,
            label: param.label,
            type: param.type,
            default: param.default,
            ...(param.type === 'float' || param.type === 'int' ? { min: param.min, max: param.max } : {}),
            ...(param.type === 'choice' ? { options: param.options } : {}),
          })),
      }
    : {}),
});

const values = (raw: unknown): FxParamValues => {
  if (!raw || typeof raw !== 'object') return {};
  const out: FxParamValues = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') out[key] = value;
  }
  return out;
};

const stackOf = (clip: { fxStack?: FxInstance[] }) => clip.fxStack ?? [];

export const FX_TOOL_MODULE: StudioToolModule = {
  id: 'fx',
  label: 'Lens & Film FX / OFX',
  tools: [
    {
      name: 'fx_list_effects',
      description: 'List GPU effects (Optics Lab, Film Emulation, Lens Physics, AI Photorealizer, Deband, Fake Diagnostic, …) and scanned native OFX plugins. Pass effectId to get its full parameter list.',
      parameters: { type: 'object', properties: { effectId: { type: 'string', description: 'Optional effect id for details.' }, includeOfx: { type: 'boolean', description: 'Scan installed OFX plugins too (desktop app).' } } },
      handler: async (args) => {
        if (args.includeOfx) await loadOfxDefinitions();
        if (typeof args.effectId === 'string') {
          const definition = getFxDefinition(args.effectId);
          if (!definition) throw new Error(`Unknown effect ${args.effectId}.`);
          return { effect: summarize(definition, true) };
        }
        return { effects: listFxDefinitions().map((definition) => summarize(definition, false)) };
      },
    },
    {
      name: 'fx_get_clip_stack',
      description: 'Read the GPU/OFX effect stack of a timeline clip (selected clip if clipId is omitted).',
      parameters: { type: 'object', properties: { clipId: { type: 'string' } } },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        return { clipId: clip.id, stack: stackOf(clip).map((instance) => ({ ...instance, params: resolveParams(instance) })) };
      },
    },
    {
      name: 'fx_add_effect',
      description: 'Add an effect to a clip (e.g. effectId "buckswood-post-plugins.optics-lab", preset "ai-natural"). Optional params override values.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { clipId: { type: 'string' }, effectId: { type: 'string' }, preset: { type: 'string', description: 'Preset id from fx_list_effects.' }, params: { type: 'object', description: 'Param id → value.' }, mix: { type: 'number', minimum: 0, maximum: 1 } },
        required: ['effectId'],
      },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const effectId = str(args, 'effectId');
        if (effectId.startsWith('ofx:')) await loadOfxDefinitions();
        const definition = getFxDefinition(effectId);
        if (!definition) throw new Error(`Unknown effect ${effectId}.`);
        const preset = typeof args.preset === 'string' ? definition.presets?.find((entry) => entry.id === args.preset) : undefined;
        if (typeof args.preset === 'string' && !preset) throw new Error(`Unknown preset ${args.preset}.`);
        const instance = createFxInstance(effectId, { ...(preset?.values ?? {}), ...values(args.params) });
        if (args.mix !== undefined) instance.mix = Math.min(1, Math.max(0, numArg(args, 'mix')));
        ctx.actions.updateClip({ ...clip, fxStack: [...stackOf(clip), instance] });
        return { clipId: clip.id, instanceId: instance.id, message: `${definition.name} added.` };
      },
    },
    {
      name: 'fx_update_effect',
      description: 'Change params, mix or enabled state of an effect instance on a clip.',
      writes: true,
      parameters: {
        type: 'object',
        properties: { clipId: { type: 'string' }, instanceId: { type: 'string' }, params: { type: 'object' }, mix: { type: 'number', minimum: 0, maximum: 1 }, enabled: { type: 'boolean' } },
        required: ['instanceId'],
      },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const instanceId = str(args, 'instanceId');
        const stack = stackOf(clip);
        if (!stack.some((entry) => entry.id === instanceId)) throw new Error(`Effect ${instanceId} not on clip ${clip.id}.`);
        const next = stack.map((entry) =>
          entry.id === instanceId
            ? {
                ...entry,
                params: { ...entry.params, ...values(args.params) },
                ...(args.mix !== undefined ? { mix: Math.min(1, Math.max(0, numArg(args, 'mix'))) } : {}),
                ...(typeof args.enabled === 'boolean' ? { enabled: args.enabled } : {}),
              }
            : entry,
        );
        ctx.actions.updateClip({ ...clip, fxStack: next });
        return { clipId: clip.id, instanceId };
      },
    },
    {
      name: 'fx_remove_effect',
      description: 'Remove an effect instance from a clip.',
      writes: true,
      parameters: { type: 'object', properties: { clipId: { type: 'string' }, instanceId: { type: 'string' } }, required: ['instanceId'] },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const instanceId = str(args, 'instanceId');
        const stack = stackOf(clip);
        if (!stack.some((entry) => entry.id === instanceId)) throw new Error(`Effect ${instanceId} not on clip ${clip.id}.`);
        ctx.actions.updateClip({ ...clip, fxStack: stack.filter((entry) => entry.id !== instanceId) });
        return { clipId: clip.id, removed: instanceId };
      },
    },
    {
      name: 'fx_move_effect',
      description: 'Reorder an effect within the clip stack (0 = first, applied first).',
      writes: true,
      parameters: { type: 'object', properties: { clipId: { type: 'string' }, instanceId: { type: 'string' }, index: { type: 'integer', minimum: 0 } }, required: ['instanceId', 'index'] },
      handler: (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const stack = [...stackOf(clip)];
        const from = stack.findIndex((entry) => entry.id === args.instanceId);
        if (from < 0) throw new Error(`Effect ${String(args.instanceId)} not on clip ${clip.id}.`);
        const [item] = stack.splice(from, 1);
        stack.splice(Math.min(stack.length, Math.max(0, Math.round(numArg(args, 'index')))), 0, item);
        ctx.actions.updateClip({ ...clip, fxStack: stack });
        return { clipId: clip.id, order: stack.map((entry) => entry.id) };
      },
    },
    {
      name: 'ofx_scan_plugins',
      description: 'Scan installed native OFX plugins (/Library/OFX/Plugins …) via the OFX host and return them as effects (desktop app only).',
      parameters: { type: 'object', properties: { force: { type: 'boolean', description: 'Re-scan instead of using the cache.' } } },
      handler: async (args) => {
        const definitions = await loadOfxDefinitions(Boolean(args.force));
        return { plugins: definitions.map((definition) => summarize(definition, false)), count: definitions.length };
      },
    },
    {
      name: 'burst_frame_build_prompt',
      description: 'Build a Burst Frame prompt (Phil Langer workflow: 20 static shots, hard cuts every 0.25 s, 5 s, audio off) from continuity and style descriptions of a start frame; returns the prompt and the specification check.',
      parameters: {
        type: 'object',
        properties: {
          continuity: { type: 'string', description: "Completes 'Preserve exactly the same …': subject, pose, wardrobe, props, environment." },
          style: { type: 'string', description: 'Light, palette, texture, depth of field, lens.' },
          subjectKind: { type: 'string', enum: ['person', 'object', 'animal', 'landscape', 'architecture'] },
          lighting: { type: 'string', enum: ['continuous', 'time-of-day'] },
          compact: { type: 'boolean' },
          shots: { type: 'array', items: { type: 'string' }, description: 'Optional custom list of 20 shots.' },
        },
        required: ['continuity', 'style'],
      },
      handler: (args) => {
        const prompt = buildBurstFramePrompt({
          continuity: str(args, 'continuity'),
          style: str(args, 'style'),
          subjectKind: args.subjectKind as BurstSubjectKind | undefined,
          lighting: args.lighting as BurstLighting | undefined,
          compact: Boolean(args.compact),
          shots: Array.isArray(args.shots) ? (args.shots as unknown[]).filter((s): s is string => typeof s === 'string') : undefined,
        });
        return { prompt, check: checkBurstFramePrompt(prompt), durationSeconds: 5, audio: false };
      },
    },
  ],
};

registerStudioToolModule(FX_TOOL_MODULE);
