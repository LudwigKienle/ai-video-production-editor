/**
 * MCP tools: Color page extras (color_ai_*). Complements color_* (nodes,
 * primaries, curves, stills, scopes): the clip look (film LUTs, look presets,
 * sliders), .cube import / plugin LUTs / remove, .cube export of the grade
 * nodes, the AI Colorist (analyse, match reference, describe a look) and the
 * Smart Audio analyzer. Works on project data; no page needed.
 */
import type { ClipFilters, MediaItem, TimelineClip } from '../../types';
import { bakeGradeToCube } from '../../workspaces/color-pro/cubeExport.ts';
import { audioReferenceClips, describeTimelineForAudio } from '../../utils/audioCueContext.ts';
import { getExtra } from '../projectExtras.ts';
import { mediaInputSchema, pickMediaUrl, urlToPayload, type Base64Payload } from '../mediaInput.ts';
import { guardPaidTools } from '../paidGuard.ts';
import { safeFileName, writeProjectTextFile } from '../projectFiles.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { findClip, numArg, registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

type Suggestion = { name: string; filters: Partial<ClipFilters> };
type ColorLib = {
  normalizeFilters: (filters?: Partial<ClipFilters> | null) => ClipFilters;
  FILM_LUTS: Array<{ id: string; name?: string; label?: string }>;
  LOOK_PRESETS: Array<{ id: string; name: string; category?: string; description?: string; filters: Partial<ClipFilters> }>;
  parseCubeLut: (text: string) => ClipFilters['customLut'];
  getInstalledPluginLuts: () => Array<{ id: string; name: string; lut: ClipFilters['customLut'] }>;
  suggestColorGrade: (base64: string, mime: string) => Promise<{ analysis: string; suggestions: Suggestion[] }>;
  matchReferenceGrade: (tB64: string, tMime: string, rB64: string, rMime: string) => Promise<{ filters: Partial<ClipFilters>; analysis?: string }>;
  gradeImageFromPrompt: (b64: string, mime: string, prompt: string) => Promise<{ filters: Partial<ClipFilters>; analysis?: string }>;
  analyzeAudioRequirements: (script: string, description: string, frames?: Base64Payload[]) => Promise<unknown[]>;
  extractFrameFromVideo: (url: string, time: number) => Promise<string>;
};

export const colorLib = createServiceLoader<ColorLib>(async () => {
  const [grading, lut, plugins, gemini, helpers] = await Promise.all([
    import('../../utils/colorGrading.ts'),
    import('../../utils/lut.ts'),
    import('../../services/pluginService.ts'),
    import('../../services/geminiService.ts'),
    import('../../utils/helpers.ts'),
  ]);
  return {
    normalizeFilters: grading.normalizeFilters,
    FILM_LUTS: grading.FILM_LUTS,
    LOOK_PRESETS: grading.LOOK_PRESETS,
    parseCubeLut: lut.parseCubeLut,
    getInstalledPluginLuts: plugins.getInstalledPluginLuts as unknown as ColorLib['getInstalledPluginLuts'],
    suggestColorGrade: gemini.suggestColorGrade,
    matchReferenceGrade: gemini.matchReferenceGrade as unknown as ColorLib['matchReferenceGrade'],
    gradeImageFromPrompt: gemini.gradeImageFromPrompt as unknown as ColorLib['gradeImageFromPrompt'],
    analyzeAudioRequirements: gemini.analyzeAudioRequirements as unknown as ColorLib['analyzeAudioRequirements'],
    extractFrameFromVideo: (url, time) => helpers.extractFrameFromVideo(url, time),
  };
});

const LOOK_FIELDS: Array<keyof ClipFilters> = ['brightness', 'contrast', 'saturate', 'hueRotate', 'grain', 'halation', 'bloom', 'vignette', 'lutIntensity'];
const LOOK_PROPS = Object.fromEntries(LOOK_FIELDS.map((key) => [key, { type: 'number' as const }]));
const clipProp = { clipId: { type: 'string' as const, description: 'Timeline clip (default: selected clip).' } };

const mediaOf = (ctx: StudioToolContext, clip: TimelineClip): MediaItem => {
  const media = ctx.getState().mediaItems.find((item) => item.id === clip.mediaId);
  if (!media) throw new Error(`Clip ${clip.id} has no media.`);
  return media;
};

const writeLook = async (ctx: StudioToolContext, clip: TimelineClip, patch: Partial<ClipFilters>) => {
  const lib = await colorLib.get();
  const filters = lib.normalizeFilters({ ...(clip.filters ?? {}), ...patch });
  ctx.actions.updateClip({ ...clip, filters });
  return filters;
};

const lookSummary = (filters: ClipFilters) => {
  const { customLut, ...rest } = filters as ClipFilters & { customLut?: unknown };
  return { ...rest, customLut: customLut ? { name: filters.customLutName ?? 'custom' } : null };
};

/** Frame of the clip at the playhead (or atSeconds into the clip) as JPEG/PNG payload. */
const clipFrame = async (ctx: StudioToolContext, clip: TimelineClip, atSeconds?: number): Promise<Base64Payload> => {
  const media = mediaOf(ctx, clip);
  if (media.type === 'image') return urlToPayload(media.url, 'image/png');
  if (media.type !== 'video') throw new Error('The clip is not a picture.');
  const state = ctx.getState();
  const local = atSeconds ?? Math.min(Math.max(0, state.playheadPosition - clip.start), Math.max(0, clip.end - clip.start));
  const time = (clip.sourceIn ?? 0) + local * (clip.speed || 1);
  const dataUrl = await (await colorLib.get()).extractFrameFromVideo(media.url, time);
  return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
};

export const COLOR_AI_TOOL_MODULE: StudioToolModule = {
  id: 'color_ai',
  label: 'Edit: Color looks, LUTs & AI Colorist',
  tools: [
    {
      name: 'color_ai_look_get',
      description: 'Read the clip look (applied after the grade nodes): film LUT and strength, custom/plugin LUT, brightness, contrast, saturation, hue, grain, halation, bloom, vignette; plus the film LUT, look preset and installed plugin LUT catalogs.',
      parameters: { type: 'object', properties: { ...clipProp } },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const clip = findClip(ctx, args.clipId);
        return {
          clipId: clip.id,
          look: lookSummary(lib.normalizeFilters(clip.filters)),
          filmLuts: lib.FILM_LUTS.map(({ id, name, label }) => ({ id, name: name ?? label ?? id })),
          lookPresets: lib.LOOK_PRESETS.map(({ id, name, category, description }) => ({ id, name, category, description })),
          pluginLuts: lib.getInstalledPluginLuts().map(({ id, name }) => ({ id, name })),
        };
      },
    },
    {
      name: 'color_ai_look_set',
      description: 'Set look values of a clip (the Looks palette sliders): lut (film LUT id or "none"), lutIntensity, brightness, contrast, saturate, hueRotate, grain, halation, bloom, vignette.',
      writes: true,
      parameters: { type: 'object', properties: { ...clipProp, lut: { type: 'string' }, ...LOOK_PROPS } },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const clip = findClip(ctx, args.clipId);
        const patch: Partial<ClipFilters> = {};
        for (const key of LOOK_FIELDS) if (args[key] !== undefined) (patch as Record<string, number>)[key] = numArg(args, key);
        if (typeof args.lut === 'string') {
          if (args.lut !== 'none' && !lib.FILM_LUTS.some((entry) => entry.id === args.lut)) throw new Error(`Unknown film LUT ${args.lut} (see color_ai_look_get).`);
          Object.assign(patch, { lut: args.lut, customLut: null, customLutName: null });
        }
        if (Object.keys(patch).length === 0) throw new Error('Pass at least one look value.');
        return { clipId: clip.id, look: lookSummary(await writeLook(ctx, clip, patch)) };
      },
    },
    {
      name: 'color_ai_look_preset',
      description: 'Apply a look preset (Kodak 2383 Print, Teal & Orange …) to a clip; overwrites the matching look values.',
      writes: true,
      parameters: { type: 'object', properties: { ...clipProp, presetId: { type: 'string' } }, required: ['presetId'] },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const clip = findClip(ctx, args.clipId);
        const preset = lib.LOOK_PRESETS.find((entry) => entry.id === args.presetId);
        if (!preset) throw new Error(`Unknown look preset ${String(args.presetId)} (see color_ai_look_get).`);
        return { clipId: clip.id, preset: preset.id, look: lookSummary(await writeLook(ctx, clip, preset.filters)) };
      },
    },
    {
      name: 'color_ai_look_reset',
      description: 'Reset the whole clip look to neutral (LUT, sliders); grade nodes are not touched (color_grade_reset).',
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { ...clipProp } },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const clip = findClip(ctx, args.clipId);
        const filters = lib.normalizeFilters(null);
        ctx.actions.updateClip({ ...clip, filters });
        return { clipId: clip.id, look: lookSummary(filters) };
      },
    },
    {
      name: 'color_ai_lut_import',
      description: 'Import a .cube LUT onto a clip (Looks › Import .cube). Pass the file (cubeUrl / cubePath) or its text (cubeText). Replaces the clip LUT.',
      writes: true,
      parameters: { type: 'object', properties: { ...clipProp, ...mediaInputSchema('cube', '.cube file'), cubeText: { type: 'string' }, name: { type: 'string' }, lutIntensity: { type: 'number' } } },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const clip = findClip(ctx, args.clipId);
        let text = typeof args.cubeText === 'string' ? args.cubeText : '';
        const url = pickMediaUrl(ctx, args, 'cube');
        if (!text && url) {
          const payload = await urlToPayload(url, 'text/plain');
          text = new TextDecoder().decode(Uint8Array.from(atob(payload.base64), (c) => c.charCodeAt(0)));
        }
        if (!text.trim()) throw new Error('Pass cubeText, cubeUrl, cubePath or cubeMediaId.');
        const customLut = lib.parseCubeLut(text);
        const name = str(args, 'name', url ? url.split(/[?#]/)[0].split('/').pop() ?? 'custom.cube' : 'custom.cube');
        const patch: Partial<ClipFilters> = { lut: 'custom' as ClipFilters['lut'], customLut, customLutName: name, colorWheels: null };
        if (args.lutIntensity !== undefined) patch.lutIntensity = numArg(args, 'lutIntensity');
        return { clipId: clip.id, look: lookSummary(await writeLook(ctx, clip, patch)) };
      },
    },
    {
      name: 'color_ai_lut_plugin',
      description: 'Apply an installed plugin LUT (Plugins page packs) to a clip.',
      writes: true,
      parameters: { type: 'object', properties: { ...clipProp, lutId: { type: 'string' } }, required: ['lutId'] },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const clip = findClip(ctx, args.clipId);
        const plugin = lib.getInstalledPluginLuts().find((entry) => entry.id === args.lutId);
        if (!plugin) throw new Error(`Plugin LUT ${String(args.lutId)} not installed (see color_ai_look_get).`);
        return { clipId: clip.id, look: lookSummary(await writeLook(ctx, clip, { lut: 'custom' as ClipFilters['lut'], customLut: plugin.lut, customLutName: plugin.name, colorWheels: null })) };
      },
    },
    {
      name: 'color_ai_lut_remove',
      description: 'Remove the clip LUT (film or custom).',
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { ...clipProp } },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        return { clipId: clip.id, look: lookSummary(await writeLook(ctx, clip, { lut: 'none' as ClipFilters['lut'], customLut: null, customLutName: null })) };
      },
    },
    {
      name: 'color_ai_export_cube',
      description: 'Export the grade nodes of a clip as 3D .cube LUT (default 33³) into the project folder exports/luts/. Windows, qualifiers, blur and sizing cannot live in a LUT; such nodes are reported in `masked`. Without a project folder, sizes up to 17 are returned as text.',
      writes: true,
      parameters: { type: 'object', properties: { ...clipProp, size: { type: 'number', minimum: 2, maximum: 65 }, name: { type: 'string' } } },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const size = numArg(args, 'size', 33);
        const name = safeFileName(str(args, 'name', `${clip.id}_grade`));
        const cube = bakeGradeToCube(clip.fxStack, { size, title: name });
        const path = await writeProjectTextFile(ctx, `exports/luts/${name}.cube`, cube.text);
        if (path) return { clipId: clip.id, path, size: cube.size, nodes: cube.nodes, masked: cube.masked };
        if (cube.size > 17) throw new Error('No project folder to write to; open/save a project or pass size ≤ 17 to get the text.');
        return { clipId: clip.id, size: cube.size, nodes: cube.nodes, masked: cube.masked, text: cube.text };
      },
    },
    {
      name: 'color_ai_analyze',
      description: 'AI Colorist "Analyse": Gemini looks at the clip frame (playhead or atSeconds into the clip) and suggests looks. apply = index of a suggestion to apply right away.',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { ...clipProp, atSeconds: { type: 'number' }, apply: { type: 'number' } } },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const frame = await clipFrame(ctx, clip, args.atSeconds === undefined ? undefined : numArg(args, 'atSeconds'));
        const result = await (await colorLib.get()).suggestColorGrade(frame.base64, frame.mimeType);
        if (args.apply === undefined) return { clipId: clip.id, analysis: result.analysis, suggestions: result.suggestions };
        const chosen = result.suggestions[numArg(args, 'apply')];
        if (!chosen) throw new Error(`Suggestion ${String(args.apply)} does not exist (${result.suggestions.length} returned).`);
        return { clipId: clip.id, analysis: result.analysis, suggestions: result.suggestions, applied: chosen.name, look: lookSummary(await writeLook(ctx, clip, chosen.filters)) };
      },
    },
    {
      name: 'color_ai_match_reference',
      description: 'AI Colorist "Match reference still": Gemini matches the clip look to a reference image and applies it.',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { ...clipProp, ...mediaInputSchema('reference', 'Reference still'), atSeconds: { type: 'number' } } },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const refUrl = pickMediaUrl(ctx, args, 'reference');
        if (!refUrl) throw new Error('Pass referenceUrl, referencePath or referenceMediaId.');
        const [frame, ref] = await Promise.all([clipFrame(ctx, clip, args.atSeconds === undefined ? undefined : numArg(args, 'atSeconds')), urlToPayload(refUrl, 'image/png')]);
        const result = await (await colorLib.get()).matchReferenceGrade(frame.base64, frame.mimeType, ref.base64, ref.mimeType);
        return { clipId: clip.id, analysis: result.analysis ?? null, look: lookSummary(await writeLook(ctx, clip, result.filters)) };
      },
    },
    {
      name: 'color_ai_prompt_grade',
      description: 'AI Colorist "Describe a look": Gemini grades the clip towards a text description and applies it.',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { ...clipProp, prompt: { type: 'string' }, atSeconds: { type: 'number' } }, required: ['prompt'] },
      handler: async (args, ctx) => {
        const clip = findClip(ctx, args.clipId);
        const frame = await clipFrame(ctx, clip, args.atSeconds === undefined ? undefined : numArg(args, 'atSeconds'));
        const result = await (await colorLib.get()).gradeImageFromPrompt(frame.base64, frame.mimeType, str(args, 'prompt'));
        return { clipId: clip.id, analysis: result.analysis ?? null, look: lookSummary(await writeLook(ctx, clip, result.filters)) };
      },
    },
    {
      name: 'color_ai_audio_cues',
      description: 'Smart Audio analyzer (Color page › Audio): Gemini Pro suggests music/SFX cues for the timeline (script + clip list + up to 3 frames) or for a named external video. Returns the cue list with prompts.',
      cost: 'paid',
      parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['timeline', 'upload'] }, fileName: { type: 'string', description: 'upload mode: name of the external video.' } } },
      handler: async (args, ctx) => {
        const lib = await colorLib.get();
        const state = ctx.getState();
        const script = getExtra(ctx, 'storyBible')?.script || 'No script provided.';
        if (args.mode === 'upload') {
          const cues = await lib.analyzeAudioRequirements(script, `External Video File: ${str(args, 'fileName')}`, []);
          return { cues };
        }
        if (state.timelineClips.length === 0) throw new Error('Timeline is empty.');
        const frames: Base64Payload[] = [];
        for (const media of audioReferenceClips(state.timelineClips, state.mediaItems)) {
          try {
            const dataUrl = media.type === 'image' ? null : await lib.extractFrameFromVideo(media.url, 0);
            frames.push(dataUrl ? { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' } : await urlToPayload(media.url, 'image/png'));
          } catch { /* skip unreadable frames, as on the page */ }
        }
        return { cues: await lib.analyzeAudioRequirements(script, describeTimelineForAudio(state.timelineClips, state.mediaItems), frames) };
      },
    },
  ],
};

registerStudioToolModule(guardPaidTools(COLOR_AI_TOOL_MODULE));
