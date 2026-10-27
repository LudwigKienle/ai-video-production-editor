/**
 * MCP tools: Video (Create › Video). Settings, frames, references, Burst
 * Frame and "Generate video" run through the page's own handlers.
 * (Building a Burst Frame prompt without the page: burst_frame_build_prompt.)
 */
import { createLivePageModule } from '../livePageTools.ts';
import { registerStudioToolModule } from '../toolModules.ts';

const mediaId = { type: 'string' as const, description: 'Media bin or library asset id.' };

export const VIDEO_GEN_TOOL_MODULE = createLivePageModule({
  id: 'video_gen',
  label: 'Create: Video',
  prefix: 'video_gen_',
  ns: 'video_gen',
  workspace: 'VIDEO_GEN',
  pageName: 'Video',
  settingsHelp:
    'Keys: prompt, modelId (41 models, see get_state catalogs), aspectRatio, videoDurationSeconds, burstMode, referenceUrl (start frame), endFrameUrl, motionReferenceUrl, elements (string array, Veo/Kling), ltx* (resolution, fps, camera motion, audio), pVideo*, seedance* (audio, resolution), pixverseGenerateAudio, kling* (audio, shot type, negative prompt, cfg, voice ids, multi-prompt "secs|prompt" lines, O3 reference video), librarySearch.',
  actions: [
    { name: 'generate', description: 'Generate video with the current settings (merge `settings` first). Checks the inputs the model needs (start frame, audio, motion video); the clip lands in the media bin. Local models (*-local) are free.', cost: 'paid', producesMedia: true },
    {
      name: 'set_frame',
      description: 'Set the start frame, end frame or motion/reference video from a URL, a local file or a media bin item ("Use as Start/End Frame", "Use as Motion Ref"). Empty clears it.',
      parameters: { target: { type: 'string', enum: ['start', 'end', 'motion'] }, url: { type: 'string' }, imagePath: { type: 'string' }, videoPath: { type: 'string' }, mediaId },
      required: ['target'],
    },
    { name: 'set_audio', description: 'Set the audio track (models that animate to audio, e.g. LTX audio-to-video, Aurora). Empty clears it.', parameters: { url: { type: 'string' }, audioPath: { type: 'string' }, mediaId, name: { type: 'string' } } },
    { name: 'add_storyboard_reference', description: 'Add an image as storyboard reference (Seedance/PixVerse, max 9).', parameters: { mediaId }, required: ['mediaId'] },
    { name: 'remove_storyboard_reference', description: 'Remove a storyboard reference.', parameters: { mediaId }, required: ['mediaId'] },
    { name: 'add_element_reference', description: 'Add an image as element reference (Veo, max 3).', parameters: { mediaId }, required: ['mediaId'] },
    { name: 'remove_element_reference', description: 'Remove an element reference.', parameters: { mediaId }, required: ['mediaId'] },
    { name: 'burst_analyze', description: 'Burst Frame "Analyze": Gemini describes the start frame (continuity, style, subject kind, 20 shots) for burst_apply.', cost: 'paid', writes: false },
    {
      name: 'burst_apply',
      description: 'Burst Frame "Apply": build the 20-shot burst prompt and set it (5 s, audio off, aspect).',
      parameters: {
        continuity: { type: 'string' },
        style: { type: 'string' },
        subjectKind: { type: 'string', enum: ['person', 'object', 'animal', 'landscape', 'architecture'] },
        lighting: { type: 'string', enum: ['continuous', 'time-of-day'] },
        compact: { type: 'boolean' },
        shots: { type: 'array', items: { type: 'string' } },
        aspectRatio: { type: 'string' },
      },
      required: ['continuity'],
    },
  ],
});

registerStudioToolModule(VIDEO_GEN_TOOL_MODULE);
