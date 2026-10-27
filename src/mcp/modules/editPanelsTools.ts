/**
 * MCP tools: Edit page library panels (edit_*). Complements timeline_/cut_/
 * effect_controls_/fx_: CSS effects, effect stacks, native effects,
 * transitions, titles & subtitles, saved layouts, gap matching, Editor Agent
 * (via useEditLegacyLiveCommands in EditWorkspace), plus the Music Assistant
 * and the clip-based AI effects (Flux/Qwen edit, Clarity upscale, Gemini TTS)
 * as direct service tools. The other AI effect models are the same services as
 * the Images, Video and Avatar pages — see edit_ai_effects.
 */
import type { MediaItem, TimelineClip } from '../../types';
import { invokeLiveCommand } from '../liveCommands.ts';
import { createLivePageModule } from '../livePageTools.ts';
import { urlToPayload, type Base64Payload } from '../mediaInput.ts';
import { CONFIRM_PROP, guardPaidTools, requireConfirm } from '../paidGuard.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { findClip, numArg, registerStudioToolModule, str, type StudioToolContext, type StudioTool } from '../toolModules.ts';

type EditServices = {
  generateMusicPromptForTimeline: (clips: TimelineClip[], media: MediaItem[]) => Promise<{ prompt: string; duration: number; mood: string; bpm?: number; instruments?: string[]; mixNotes?: string }>;
  generateMusicWithLyria2: (prompt: string, opts?: { duration?: number }) => Promise<MediaItem>;
  generateSpeechWithElevenLabs: (text: string, opts?: { voiceId?: string; modelId?: string; outputFormat?: string }) => Promise<MediaItem>;
  generateSpeechWithTTS: (prompt: string) => Promise<MediaItem>;
  editImageWithFlux: (prompt: string, image: Base64Payload) => Promise<MediaItem>;
  editImageWithQwen: (prompt: string, image: Base64Payload, opts?: { aspectRatio?: string }) => Promise<MediaItem>;
  upscaleImage: (image: Base64Payload) => Promise<MediaItem>;
};

export const editServices = createServiceLoader<EditServices>(async () => {
  const [gemini, replicate, eleven] = await Promise.all([
    import('../../services/geminiService.ts'),
    import('../../services/replicateService.ts'),
    import('../../services/elevenLabsService.ts'),
  ]);
  return {
    generateMusicPromptForTimeline: gemini.generateMusicPromptForTimeline,
    generateSpeechWithTTS: (prompt) => gemini.generateSpeechWithTTS(prompt),
    generateMusicWithLyria2: replicate.generateMusicWithLyria2,
    editImageWithFlux: (prompt, image) => replicate.editImageWithFlux(prompt, image),
    editImageWithQwen: replicate.editImageWithQwen,
    upscaleImage: (image) => replicate.upscaleImage(image),
    generateSpeechWithElevenLabs: eleven.generateSpeechWithElevenLabs,
  };
});

const clipProp = { clipId: { type: 'string' as const, description: 'Timeline clip (default: selected clip).' } };
const summary = (item: MediaItem) => ({ id: item.id, name: item.name, type: item.type, url: item.url, duration: item.duration });

const clipImage = async (ctx: StudioToolContext, clipId: unknown): Promise<Base64Payload> => {
  const clip = findClip(ctx, clipId);
  const media = ctx.getState().mediaItems.find((item) => item.id === clip.mediaId);
  if (!media || media.type !== 'image') throw new Error('Select an image clip first.');
  return urlToPayload(media.url, 'image/png');
};

/** Which tool runs each AI effect of the Effects panel (same provider services). */
export const AI_EFFECT_TOOLS: Record<string, { tool: string; args: Record<string, unknown>; note?: string }> = {
  'Generate Video (Veo)': { tool: 'video_gen_generate', args: { settings: { modelId: 'veo-fast' } } },
  'Generate Image (Flux Pro)': { tool: 'image_gen_generate', args: { settings: { modelId: 'flux-pro' } } },
  'Generate Image (Seedream 4.5)': { tool: 'image_gen_generate', args: { settings: { modelId: 'seedream' } } },
  'Generate Image (Imagen)': { tool: 'image_gen_generate', args: { settings: { modelId: 'imagen' } } },
  'Generate Image (Gemini 3 Pro)': { tool: 'image_gen_generate', args: { settings: { modelId: 'gemini-pro' } } },
  'Edit Image (Flux Fill)': { tool: 'edit_ai_edit_clip_image', args: { model: 'flux' } },
  'Edit Image (Qwen)': { tool: 'edit_ai_edit_clip_image', args: { model: 'qwen' } },
  'Clarity Upscaler': { tool: 'edit_ai_upscale_clip_image', args: {} },
  'Generate Speech (TTS)': { tool: 'edit_ai_tts', args: {} },
  'Avatar Video (OmniHuman)': { tool: 'avatar_generate_video', args: { mode: 'omni-human' } },
  'Avatar Replace (Wan Animate)': { tool: 'avatar_generate_video', args: { mode: 'wan-replace' } },
  'Animate Image (Wan 2.2)': { tool: 'avatar_generate_video', args: { mode: 'wan-i2v' } },
  'Generate Video (Kling 2.6)': { tool: 'video_gen_generate', args: { settings: { modelId: 'kling-26' } } },
  'Motion Control (Kling 2.6)': { tool: 'avatar_generate_video', args: { mode: 'kling-motion' } },
  // These three panel entries have no handler in the app (clicking them does nothing); the same models run here:
  'Generate Image (Nano Banana 2)': { tool: 'image_gen_generate', args: { settings: { modelId: 'nano-banana-2-fal' } }, note: 'No function on the Edit page; same model on the Images page.' },
  'Edit Image (Nano Banana 2)': { tool: 'image_gen_generate', args: { settings: { modelId: 'nano-banana-2-fal-edit' } }, note: 'No function on the Edit page; add the clip image as reference (image_gen_add_reference).' },
  'Generate Video from Image': { tool: 'video_gen_generate', args: {}, note: 'No function on the Edit page; set the start frame with video_gen_set_frame.' },
};

const serviceTools: StudioTool[] = [
  {
    name: 'edit_ai_effects',
    description: 'The AI effects of the Edit page Effects panel and the MCP tool that runs each of them (same models/services, results land in the media bin).',
    parameters: { type: 'object', properties: {} },
    handler: () => ({ effects: Object.entries(AI_EFFECT_TOOLS).map(([effect, target]) => ({ effect, ...target })) }),
  },
  {
    name: 'edit_ai_edit_clip_image',
    description: 'Edit the selected image clip with a prompt ("Edit Image (Flux)" / "Edit Image (Qwen)"); the edited image lands in the media bin.',
    writes: true,
    cost: 'paid',
    parameters: { type: 'object', properties: { ...clipProp, model: { type: 'string', enum: ['flux', 'qwen'] }, prompt: { type: 'string' }, aspectRatio: { type: 'string', description: 'qwen: match_input_image, 16:9, 1:1 …' } }, required: ['model', 'prompt'] },
    handler: async (args, ctx) => {
      const image = await clipImage(ctx, args.clipId);
      const services = await editServices.get();
      const prompt = str(args, 'prompt');
      const item = args.model === 'qwen'
        ? await services.editImageWithQwen(prompt, image, { aspectRatio: typeof args.aspectRatio === 'string' ? args.aspectRatio : undefined })
        : await services.editImageWithFlux(prompt, image);
      ctx.actions.addMediaItem(item);
      return { mediaItem: summary(item) };
    },
  },
  {
    name: 'edit_ai_upscale_clip_image',
    description: 'Upscale the selected image clip 4× ("Upscale Image (Clarity)"); the result lands in the media bin.',
    writes: true,
    cost: 'paid',
    parameters: { type: 'object', properties: { ...clipProp } },
    handler: async (args, ctx) => {
      const item = await (await editServices.get()).upscaleImage(await clipImage(ctx, args.clipId));
      ctx.actions.addMediaItem(item);
      return { mediaItem: summary(item) };
    },
  },
  {
    name: 'edit_ai_tts',
    description: '"Generate Speech (TTS)": text to speech with Gemini or ElevenLabs (voiceId/modelId/outputFormat); the audio lands in the media bin.',
    writes: true,
    cost: 'paid',
    parameters: { type: 'object', properties: { text: { type: 'string' }, provider: { type: 'string', enum: ['gemini', 'elevenlabs'] }, voiceId: { type: 'string' }, modelId: { type: 'string' }, outputFormat: { type: 'string' } }, required: ['text'] },
    handler: async (args, ctx) => {
      const services = await editServices.get();
      const text = str(args, 'text');
      const item = args.provider === 'elevenlabs'
        ? await services.generateSpeechWithElevenLabs(text, { voiceId: args.voiceId as string | undefined, modelId: args.modelId as string | undefined, outputFormat: args.outputFormat as string | undefined })
        : await services.generateSpeechWithTTS(text);
      ctx.actions.addMediaItem(item);
      return { mediaItem: summary(item) };
    },
  },
  {
    name: 'edit_music_brief',
    description: 'Music Assistant "Analyze cut": Gemini writes a music brief for the current timeline (prompt, duration, mood, bpm, instruments, mix notes).',
    cost: 'paid',
    parameters: { type: 'object', properties: {} },
    handler: async (_args, ctx) => {
      const state = ctx.getState();
      if (state.timelineClips.length === 0) throw new Error('The timeline is empty.');
      return { brief: await (await editServices.get()).generateMusicPromptForTimeline(state.timelineClips, state.mediaItems) };
    },
  },
  {
    name: 'edit_music_generate',
    description: 'Music Assistant "Generate music": Lyria 2 (Replicate) composes 4-120 s from a prompt; the track lands in the media bin.',
    writes: true,
    cost: 'paid',
    parameters: { type: 'object', properties: { prompt: { type: 'string' }, duration: { type: 'number', minimum: 4, maximum: 120 } }, required: ['prompt'] },
    handler: async (args, ctx) => {
      const duration = Math.max(4, Math.min(120, Math.round(numArg(args, 'duration', 30))));
      const item = await (await editServices.get()).generateMusicWithLyria2(str(args, 'prompt'), { duration });
      ctx.actions.addMediaItem(item);
      return { mediaItem: summary(item) };
    },
  },
  {
    name: 'edit_music_voice',
    description: 'Music Assistant "Generate voice": ElevenLabs speech from text; the audio lands in the media bin.',
    writes: true,
    cost: 'paid',
    parameters: { type: 'object', properties: { text: { type: 'string' }, voiceId: { type: 'string' }, modelId: { type: 'string' }, outputFormat: { type: 'string' } }, required: ['text'] },
    handler: async (args, ctx) => {
      const item = await (await editServices.get()).generateSpeechWithElevenLabs(str(args, 'text'), { voiceId: args.voiceId as string | undefined, modelId: args.modelId as string | undefined, outputFormat: args.outputFormat as string | undefined });
      ctx.actions.addMediaItem(item);
      return { mediaItem: summary(item) };
    },
  },
];

const clipId = { clipId: { type: 'string' as const, description: 'Timeline clip (default: selected clip).' } };

const pageModule = createLivePageModule({
  id: 'edit_panels',
  label: 'Edit: library panels (effects, titles, agent …)',
  prefix: 'edit_',
  ns: 'edit_legacy',
  workspace: 'EDIT',
  pageName: 'Edit',
  settingsHelp: 'This part has no free-form settings; read catalogs, layouts, gaps and agent plans with edit_get_state.',
  actions: [
    { name: 'open_panel', description: 'Dock/show a panel in the pro layouts (autocut, agent, titles, music, transitions, effects, lookbook …) so its tools work; not available in the classic layout.', parameters: { panel: { type: 'string' } }, required: ['panel'] },
    { name: 'apply_css_effect', description: 'Apply a CSS look effect (Grayscale … Glitch) to a clip; applying an active one removes it (toggle, as in the panel).', parameters: { ...clipId, effect: { type: 'string' } }, required: ['effect'] },
    { name: 'apply_effect_stack', description: 'Apply an effect stack preset (Cinematic Punch, Noir Detective …) to a clip; overwrites matching layers and look values.', parameters: { ...clipId, stackId: { type: 'string' } }, required: ['stackId'] },
    { name: 'apply_native_effect', description: 'Native effects: Solid Color (value = CSS colour, adds a colour still to the media bin), Text Overlay and Chroma Key (toggle on the clip).', parameters: { ...clipId, effect: { type: 'string' }, value: { type: 'string' } }, required: ['effect'] },
    { name: 'apply_transition', description: 'Set the outgoing transition of a clip (Cross Fade, Fade to Black, …; see catalogs.transitions). Replaces the existing one.', parameters: { ...clipId, type: { type: 'string' } }, required: ['type'] },
    { name: 'title_add', description: 'Add a title clip from a preset (lower thirds, kinetic, subtitle styles) at the playhead, optionally with your text.', parameters: { presetId: { type: 'string' }, text: { type: 'string' } }, required: ['presetId'] },
    { name: 'title_apply_preset', description: 'Restyle a text clip with a title preset (keeps its text).', parameters: { ...clipId, presetId: { type: 'string' } }, required: ['presetId'] },
    { name: 'title_treatment', description: 'Title treatment: subtitle-plate, lower-third-bar or clear.', parameters: { ...clipId, treatment: { type: 'string', enum: ['subtitle-plate', 'lower-third-bar', 'clear'] } }, required: ['treatment'] },
    { name: 'title_motion', description: 'Title motion: slide-in, soft-fade, blur-settle or clear (rewrites the title keyframes).', parameters: { ...clipId, motion: { type: 'string', enum: ['slide-in', 'soft-fade', 'blur-settle', 'clear'] } }, required: ['motion'] },
    { name: 'title_auto_contrast', description: 'Turn automatic text contrast on/off for a title clip.', parameters: { ...clipId, enabled: { type: 'boolean' } }, required: ['enabled'] },
    { name: 'subtitles_generate', description: 'Generate subtitle clips from a video/audio clip (Gemini transcription with word timings).', parameters: { ...clipId }, cost: 'paid' },
    { name: 'subtitle_set_text', description: 'Change the text of a subtitle clip.', parameters: { ...clipId, text: { type: 'string' } }, required: ['text'] },
    { name: 'subtitle_split', description: 'Split a subtitle clip in two.', parameters: { ...clipId } },
    { name: 'subtitle_merge', description: 'Merge a subtitle clip with its previous or next one (one clip is removed).', parameters: { ...clipId, direction: { type: 'string', enum: ['previous', 'next'] } }, destructive: true },
    { name: 'layout_apply', description: 'Apply a panel layout (built-in or saved; classic layout).', parameters: { name: { type: 'string' } }, required: ['name'] },
    { name: 'layout_save', description: 'Save the current panel layout under a name (overwrites a saved layout with that name).', parameters: { name: { type: 'string' } }, required: ['name'] },
    { name: 'layout_delete', description: 'Delete a saved panel layout.', parameters: { name: { type: 'string' } }, required: ['name'], destructive: true },
    { name: 'gap_match', description: 'Fill a timeline gap with the best matching shot from the project/library ("Match gap"); pass trackId and start from info.gaps (default: first gap).', parameters: { trackId: { type: 'string' }, start: { type: 'number' } } },
    { name: 'agent_plan', description: 'Editor Agent: Gemini writes an edit plan for an objective (operations on the timeline). Returns planId and the plan.', parameters: { objective: { type: 'string' } }, required: ['objective'], cost: 'paid' },
    { name: 'agent_preview', description: 'Editor Agent: preview what a plan (or selected operation ids) would change.', parameters: { planId: { type: 'string' }, operationIds: { type: 'array', items: { type: 'string' } } }, writes: false },
    { name: 'agent_apply', description: 'Editor Agent: apply a plan (or selected operations) to the timeline; undo with edit_agent_undo.', parameters: { planId: { type: 'string' }, operationIds: { type: 'array', items: { type: 'string' } } } },
    { name: 'agent_undo', description: 'Editor Agent: undo the last applied batch (only while the timeline is unchanged since).' },
    { name: 'agent_review', description: 'Editor Agent review pass: Gemini reviews the draft against an objective and proposes a follow-up plan.', parameters: { objective: { type: 'string' } }, required: ['objective'], cost: 'paid' },
  ],
});

export const EDIT_PANELS_TOOL_MODULE = guardPaidTools({ ...pageModule, tools: [...pageModule.tools, ...serviceTools] });
registerStudioToolModule(EDIT_PANELS_TOOL_MODULE);

/** Opens the Edit page and docks the AutoCut panel (pro layouts). */
const openAutoCut = (ctx: StudioToolContext) => {
  ctx.actions.setActiveWorkspace('EDIT');
  setTimeout(() => {
    void invokeLiveCommand('edit_legacy.action', { action: 'open_panel', args: { panel: 'autocut' } }, { workspace: 'EDIT', timeoutMs: 10000 }).catch(() => undefined);
  }, 0);
};

const autoCutBase = createLivePageModule({
  id: 'edit_autocut',
  label: 'Edit: AutoCut',
  prefix: 'edit_autocut_',
  ns: 'edit_autocut',
  workspace: 'EDIT',
  pageName: 'Edit › AutoCut',
  open: openAutoCut,
  settingsHelp:
    'Keys: scope clip|timeline|pool, config (AutoCut criteria, merged: thresholds, min/max length, top count …), localMode silence|scenes|filler, localSettings {margin, minCut, minClip, threshold, sceneSensitivity, minScene, removePauses} (merged), customModelId, unusedOnlyInPool, scriptSourceMode project|custom, customScriptText.',
  actions: [
    { name: 'analyze', description: 'AI analysis (Gemini Pro, or local LLM if set up) of the selected clip, the timeline or the media pool into scored segments matched to the script.', parameters: { scope: { type: 'string', enum: ['clip', 'timeline', 'pool'] } }, cost: 'paid' },
    { name: 'apply_local', description: 'Apply the local detection result to the selected clip.' },
    {
      name: 'select',
      description: 'Select segments to keep: ids (clip scope: segment ids; timeline: "clipId::segmentId"; pool: "mediaId::segmentId"), all:true, or bestPerScene:true.',
      parameters: { scope: { type: 'string', enum: ['clip', 'timeline', 'pool'] }, ids: { type: 'array', items: { type: 'string' } }, all: { type: 'boolean' }, bestPerScene: { type: 'boolean' } },
    },
    { name: 'apply', description: 'Apply the selected segments: clip scope trims the clip, timeline/pool scope builds the cut on a track (adds clips).', parameters: { scope: { type: 'string', enum: ['clip', 'timeline', 'pool'] } } },
    { name: 'trim_to_segment', description: 'Trim the selected clip to one analysed segment.', parameters: { segmentId: { type: 'string' } }, required: ['segmentId'] },
  ],
});

const localDetect: StudioTool = {
  name: 'edit_autocut_local_detect',
  description: 'Local detection on the selected clip: silence and scenes run locally (free); filler words need a Gemini transcription (spends credits: requires confirm: true). Then edit_autocut_apply_local.',
  writes: true,
  cost: 'paid',
  parameters: { type: 'object', properties: { mode: { type: 'string', enum: ['silence', 'scenes', 'filler'] }, ...CONFIRM_PROP } },
  handler: async (args, ctx) => {
    if (args.mode === 'filler') requireConfirm(args, 'edit_autocut_local_detect (filler)');
    const { confirm: _confirm, ...rest } = args;
    return (await invokeLiveCommand('edit_autocut.action', { action: 'local_detect', args: rest }, { openWorkspace: () => openAutoCut(ctx), workspace: 'EDIT', timeoutMs: 10000 })) as Record<string, unknown>;
  },
};

registerStudioToolModule({ ...autoCutBase, tools: [...autoCutBase.tools, localDetect] });
