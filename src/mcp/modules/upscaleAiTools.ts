/**
 * MCP tools: Upscale page extras (upscale_ai_*). Complements upscale_*:
 * color science (LTX ACES HDR / Runway Ruby incl. EXR and ProRes HDR output),
 * output folder, inputs from URL/path/library, input fps, job display,
 * folder, bin and cleanup. Rendering stays with upscale_queue_add /
 * upscale_preview_render (paid, confirm). Runs through useUpscaleAiLiveCommands.
 */
import { createLivePageModule } from '../livePageTools.ts';
import { registerStudioToolModule } from '../toolModules.ts';

const RUBY_FORMATS = ['hdr10', 'hlg', 'hdr_prores', 'hdr_exr_sequence', 'hdr_exr_acescg_sequence_1_3'];
const jobId = { jobId: { type: 'string' as const, description: 'Job id from upscale_queue_list.' } };
const inputId = { inputId: { type: 'string' as const, description: 'Input id from upscale_state_get.' } };

export const UPSCALE_AI_TOOL_MODULE = createLivePageModule({
  id: 'upscale_ai',
  label: 'Edit: Upscale extras',
  prefix: 'upscale_ai_',
  ns: 'upscale_ai',
  workspace: 'UPSCALE',
  pageName: 'Upscale',
  settingsHelp: 'This page part has no free-form settings; use the dedicated actions.',
  actions: [
    {
      name: 'set_color_science',
      description: 'Color science (videos): enable HDR conversion with engine ltx (ACES HDR, EXR zip, max 7 s) or runway-ruby (SDR→HDR, max 30 s; rubyFormat hdr10|hlg|hdr_prores|hdr_exr_sequence|hdr_exr_acescg_sequence_1_3, rubyProres for hdr_prores). keepEnhance:false = color science only, no resolution upscale. Then run with upscale_queue_add (paid).',
      parameters: {
        enabled: { type: 'boolean' },
        engine: { type: 'string', enum: ['ltx', 'runway-ruby'] },
        rubyFormat: { type: 'string', enum: RUBY_FORMATS },
        rubyProres: { type: 'string', enum: ['422', '422 HQ', '4444'] },
        keepEnhance: { type: 'boolean' },
      },
    },
    { name: 'set_output_folder', description: 'Also save results into this folder (empty: media bin only).', parameters: { path: { type: 'string' } } },
    {
      name: 'add_input_url',
      description: 'Add an input from a URL or local file (image or video), like dropping a file.',
      parameters: { url: { type: 'string' }, videoPath: { type: 'string' }, imagePath: { type: 'string' }, kind: { type: 'string', enum: ['image', 'video'] }, name: { type: 'string' } },
    },
    { name: 'add_library_asset', description: 'Add a library asset (get_state info.library) as input.', parameters: { assetId: { type: 'string' } }, required: ['assetId'] },
    { name: 'remove_input', description: 'Remove an input from the queue (its preview is dropped).', parameters: inputId, required: ['inputId'], destructive: true },
    { name: 'set_input_fps', description: 'Override the detected frame rate of a video input.', parameters: { ...inputId, fps: { type: 'number', minimum: 1, maximum: 240 } }, required: ['inputId', 'fps'] },
    { name: 'job_show', description: 'Show a finished job in the compare viewer.', parameters: jobId, required: ['jobId'] },
    { name: 'job_add_to_bin', description: 'Add a job result (e.g. a preview) to the media bin.', parameters: jobId, required: ['jobId'] },
    { name: 'job_open_folder', description: 'Open the folder of a saved job result in Finder.', parameters: jobId, required: ['jobId'] },
    { name: 'job_remove', description: 'Remove a job from the list (the result stays in the media bin).', parameters: jobId, required: ['jobId'], destructive: true },
    { name: 'clear_finished_jobs', description: 'Remove all finished jobs from the list.', destructive: true },
  ],
});

registerStudioToolModule(UPSCALE_AI_TOOL_MODULE);
