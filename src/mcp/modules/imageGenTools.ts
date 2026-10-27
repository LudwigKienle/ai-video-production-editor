/**
 * MCP tools: Images (Create › Images). Every setting and button of the page
 * (Generate, Moodboard, Relight, Photoreal, Director tabs, LoRA training,
 * ComfyUI) runs through the page's own handlers via live commands.
 */
import { createLivePageModule } from '../livePageTools.ts';
import { registerStudioToolModule } from '../toolModules.ts';

const url = { type: 'string' as const, description: 'https or data: URL.' };
const imagePath = { type: 'string' as const, description: 'Local image file (instead of url).' };

export const IMAGE_GEN_TOOL_MODULE = createLivePageModule({
  id: 'image_gen',
  label: 'Create: Images',
  prefix: 'image_gen_',
  ns: 'image_gen',
  workspace: 'IMAGE_GEN',
  pageName: 'Images',
  settingsHelp:
    'Keys: activeTab, prompt, negativePrompt, customStyle, modelId (52 models, see get_state catalogs), aspectRatio, imageSize 1K|2K|4K, selectedStyleId/ShotTypeId/LightingId, cameraPresetId, lensPresetId, customCameraNote, customLensNote, smartRouterGoal, loraUrl, loraScale, trainer* (LoRA training), relight* (relight tab), photorealSourceUrl, directorScript, librarySearch, comfy* (ComfyUI server, checkpoint, sampler, steps, seed, workflow, chain, presets, launch).',
  actions: [
    { name: 'generate', description: 'Create Image with the current settings (merge `settings` first, e.g. prompt and modelId). Uses references/moodboard and @character tags; the image lands in the media bin. Local models (ComfyUI, *-local, Draw Things) are free.', cost: 'paid', producesMedia: true },
    { name: 'apply_smart_route', description: 'Smart Model Router: pick model and size for a goal (e.g. "photoreal portrait", "fast draft").', parameters: { goal: { type: 'string' } } },
    { name: 'add_reference', description: 'Add a reference image (Reference images › Upload), up to the model limit.', parameters: { url, imagePath, name: { type: 'string' } } },
    { name: 'remove_reference', description: 'Remove one reference image (id from get_state info.references).', parameters: { id: { type: 'string' } }, required: ['id'] },
    { name: 'clear_references', description: 'Remove all reference images.', destructive: true },
    { name: 'add_moodboard_image', description: 'Add an image to the moodboard (used as references when none are set).', parameters: { url, imagePath, name: { type: 'string' } } },
    { name: 'remove_moodboard_image', description: 'Remove one moodboard image.', parameters: { id: { type: 'string' } }, required: ['id'] },
    { name: 'clear_moodboard', description: 'Clear the moodboard.', destructive: true },
    { name: 'use_library_asset', description: 'Use a library asset (get_state info.library) as reference, moodboard image, relight source or photoreal source.', parameters: { assetId: { type: 'string' }, target: { type: 'string', enum: ['reference', 'moodboard', 'relight', 'photoreal'] } }, required: ['assetId', 'target'] },
    { name: 'relight', description: 'Relight tab: relight relightSourceUrl with the relight* settings (Gemini or Replicate); result goes to the media bin.', cost: 'paid', producesMedia: true },
    { name: 'photoreal_check', description: 'Photoreal tab: Gemini rates how photorealistic photorealSourceUrl looks (info.photorealResult).', cost: 'paid' },
    { name: 'director_plan', description: 'Director tab: Gemini plans shots from directorScript (info.directorTreatment).', cost: 'paid' },
    { name: 'director_apply_shot', description: 'Load a planned director shot into the generator (prompt, shot type, lighting).', parameters: { shotNumber: { type: 'number' } }, required: ['shotNumber'] },
    { name: 'start_lora_training', description: 'Start a Replicate Flux LoRA training with trainerDestination, trainerInputImagesUrl (zip), trainerTriggerWord, trainerType.', cost: 'paid' },
    { name: 'refresh_lora_training', description: 'Refresh the status of trainerId.' },
    { name: 'reuse_history', description: 'Load the settings of a previous generation (history id from get_state).', parameters: { historyId: { type: 'string' } }, required: ['historyId'] },
    { name: 'reuse_prompt', description: 'Load a prompt into the generator.', parameters: { prompt: { type: 'string' } }, required: ['prompt'] },
    { name: 'clear_completed_jobs', description: 'Clear finished jobs from the job list.' },
    { name: 'animate_in_video_gen', description: 'Send an image to Create › Video as start frame ("Animate in Video Gen").', parameters: { mediaId: { type: 'string' } }, required: ['mediaId'] },
    { name: 'comfy_connect', description: 'ComfyUI: connect to comfyUrl and load its models.' },
    { name: 'comfy_start', description: 'ComfyUI: start the local ComfyUI process (comfyLaunchCommand/Args/Cwd).' },
    { name: 'comfy_stop', description: 'ComfyUI: stop the local ComfyUI process.', destructive: true },
    { name: 'comfy_refresh_status', description: 'ComfyUI: refresh the process status.', writes: false },
    { name: 'comfy_health_check', description: 'ComfyUI: health check (GPU, queue).', writes: false },
    { name: 'comfy_load_logs', description: 'ComfyUI: load the process log (info.comfy.logLines).', writes: false },
    { name: 'comfy_clear_logs', description: 'ComfyUI: clear the process log.', destructive: true },
    { name: 'comfy_save_preset', description: 'ComfyUI: save the current ComfyUI settings as preset comfyPresetName.' },
    { name: 'comfy_apply_preset', description: 'ComfyUI: apply a saved preset.', parameters: { presetId: { type: 'string' } }, required: ['presetId'] },
    { name: 'comfy_delete_preset', description: 'ComfyUI: delete the preset selectedComfyPresetId.', destructive: true },
    { name: 'comfy_toggle_favorite', description: 'ComfyUI: star/unstar a checkpoint, VAE, CLIP or LoRA.', parameters: { group: { type: 'string', enum: ['checkpoints', 'vae', 'clips', 'loras'] }, value: { type: 'string' } }, required: ['group', 'value'] },
    { name: 'comfy_apply_chain_template', description: 'ComfyUI: load a chain template (multi-step workflow).', parameters: { templateId: { type: 'string' } }, required: ['templateId'] },
    { name: 'comfy_add_chain_step', description: 'ComfyUI: add a chain step (edit steps via settings.comfyChainSteps).' },
    { name: 'comfy_remove_chain_step', description: 'ComfyUI: remove a chain step.', parameters: { stepId: { type: 'string' } }, required: ['stepId'] },
    { name: 'comfy_export_workflow', description: 'ComfyUI: return the workflow JSON the Export button downloads.', writes: false },
  ],
});

registerStudioToolModule(IMAGE_GEN_TOOL_MODULE);
