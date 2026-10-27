/**
 * MCP tools: Photo page AI and canvas extras (photo_ai_*). Complements the
 * photo_* tools: generative fill with a chosen model resolution, canvas expand
 * without AI, expand + fill, neural looks, image size and PNG export. Runs
 * through usePhotoAiLiveCommands in PhotoWorkspace.
 */
import { createLivePageModule } from '../livePageTools.ts';
import { CONFIRM_PROP, requireConfirm } from '../paidGuard.ts';
import { registerStudioToolModule, type StudioToolModule } from '../toolModules.ts';

const INPAINT_MODELS = ['nano-banana-pro', 'nano-banana-2-fal', 'flux-2-pro', 'z-turbo-inpaint'];
const RESOLUTIONS = ['1K', '2K', '4K', 'match_input_image', '0.5 MP', '1 MP', '2 MP', '4 MP'];
const NEURAL_PRESETS = ['harmonize', 'portrait_balance', 'cinematic_pop', 'dehaze', 'soft_skin', 'custom_prompt'];
const FREE_PRESETS = new Set(['dehaze', 'soft_skin']);

const base = createLivePageModule({
  id: 'photo_ai',
  label: 'Edit: Photo AI & canvas extras',
  prefix: 'photo_ai_',
  ns: 'photo_ai',
  workspace: 'PHOTO',
  pageName: 'Photo',
  settingsHelp: 'Keys: inpaintPrompt, expandPadding (px per side), expandPrompt, neuralIntensity 0-100 (opacity of the look layer), neuralPrompt (custom look).',
  actions: [
    {
      name: 'inpaint',
      description: 'Generative fill of the current selection with an explicit model and resolution (nano-banana-pro/nano-banana-2-fal: 1K|2K|4K, flux-2-pro: match_input_image|0.5-4 MP, z-turbo-inpaint: automatic). heal:true reconstructs the area instead ("Bereich reparieren"). Adds a layer. photo_generative_fill does the same at fixed 2K.',
      cost: 'paid',
      parameters: {
        prompt: { type: 'string' },
        model: { type: 'string', enum: INPAINT_MODELS },
        resolution: { type: 'string', enum: RESOLUTIONS },
        heal: { type: 'boolean' },
      },
    },
    { name: 'expand_canvas', description: 'Grow the canvas by padding px on every side and select the new border, without AI ("Arbeitsfläche erweitern").', parameters: { padding: { type: 'number', minimum: 1 } } },
    { name: 'expand_and_fill', description: 'Expand by settings.expandPadding and fill the new border generatively with settings.expandPrompt ("Erweitern und füllen").', cost: 'paid' },
    { name: 'set_neural_reference', description: 'Load the reference image for the "harmonize" look (empty clears it).', parameters: { url: { type: 'string' }, imagePath: { type: 'string' } } },
    { name: 'resize_image', description: 'Set the image size in pixels (Bild › Bildgröße).', parameters: { width: { type: 'number' }, height: { type: 'number' } }, required: ['width', 'height'] },
    { name: 'export_png', description: 'Return the flattened image as PNG data URL (instead of the download button; photo_export_to_media saves it to the media bin).', writes: false },
  ],
});

const neuralLook: StudioToolModule['tools'][number] = {
  name: 'photo_ai_neural_look',
  description:
    'Apply a neural look as adjustment layer with opacity = settings.neuralIntensity: harmonize (match a reference, see photo_ai_set_neural_reference), portrait_balance, cinematic_pop, custom_prompt (Gemini, spends credits: requires confirm: true), dehaze and soft_skin (local, free). Runs the Photo page handler.',
  writes: true,
  cost: 'paid',
  parameters: {
    type: 'object',
    properties: { preset: { type: 'string', enum: NEURAL_PRESETS }, prompt: { type: 'string', description: 'custom_prompt: the look to grade towards.' }, ...CONFIRM_PROP },
    required: ['preset'],
  },
  handler: async (args, ctx) => {
    if (!FREE_PRESETS.has(String(args.preset))) requireConfirm(args, 'photo_ai_neural_look');
    const { confirm: _confirm, ...rest } = args;
    const { invokeLiveCommand } = await import('../liveCommands.ts');
    return (await invokeLiveCommand('photo_ai.action', { action: 'neural_look', args: rest }, {
      openWorkspace: () => ctx.actions.setActiveWorkspace('PHOTO'),
      workspace: 'PHOTO',
      timeoutMs: 10000,
    })) as Record<string, unknown>;
  },
};

export const PHOTO_AI_TOOL_MODULE: StudioToolModule = { ...base, tools: [...base.tools, neuralLook] };
registerStudioToolModule(PHOTO_AI_TOOL_MODULE);
