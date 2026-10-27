/**
 * MCP tools: Avatar (Create › Avatar). Saved avatars live in the project's
 * `avatars`; generation uses the same entry point as the page
 * (services/avatarGeneration.ts). Results land in the media bin.
 */
import { guardPaidTools } from '../paidGuard.ts';
import type { AvatarProfile, MediaItem } from '../../types';
import { AVATAR_MODEL_MODES, DEFAULT_AVATAR_VIDEO_SETTINGS, checkAvatarVideoInput, type AvatarModelMode, type AvatarVideoInput } from '../../services/avatarModes.ts';
import { getExtra, setExtra } from '../projectExtras.ts';
import { mediaInputSchema, payloadToDataUrl, pickMediaUrl, urlToPayload } from '../mediaInput.ts';
import { createServiceLoader } from '../serviceLoader.ts';
import { registerStudioToolModule, str, type StudioToolContext, type StudioToolModule } from '../toolModules.ts';

type AvatarServices = {
  generateAvatarVideo: (input: AvatarVideoInput) => Promise<MediaItem>;
  generateSpeechWithElevenLabs: (text: string, opts?: { voiceId?: string; modelId?: string; outputFormat?: string }) => Promise<MediaItem>;
  fetchElevenLabsVoices: () => Promise<Array<{ voice_id: string; name: string; category?: string }>>;
};

export const avatarServices = createServiceLoader<AvatarServices>(async () => {
  const [generation, eleven] = await Promise.all([import('../../services/avatarGeneration.ts'), import('../../services/elevenLabsService.ts')]);
  return {
    generateAvatarVideo: generation.generateAvatarVideo,
    generateSpeechWithElevenLabs: eleven.generateSpeechWithElevenLabs,
    fetchElevenLabsVoices: eleven.fetchElevenLabsVoices,
  };
});

const MODES = AVATAR_MODEL_MODES.map((mode) => mode.id);
const VOICE_MODELS = ['eleven_multilingual_v2', 'eleven_turbo_v2_5', 'eleven_monolingual_v1'];
const VOICE_FORMATS = ['mp3_44100_128', 'mp3_22050_32', 'pcm_16000', 'ulaw_8000'];

const avatarsOf = (ctx: StudioToolContext): AvatarProfile[] => getExtra(ctx, 'avatars') ?? [];
const findAvatar = (ctx: StudioToolContext, id: unknown) => {
  const avatar = avatarsOf(ctx).find((entry) => entry.id === id || entry.name === id);
  if (!avatar) throw new Error(`Avatar ${String(id)} not found (see avatar_list).`);
  return avatar;
};

const VOICE_PROPS = {
  voiceId: { type: 'string' as const, description: 'ElevenLabs voice id (avatar_list_voices).' },
  voiceModelId: { type: 'string' as const, enum: VOICE_MODELS },
  voiceOutputFormat: { type: 'string' as const, enum: VOICE_FORMATS },
};

const voiceOpts = (args: Record<string, unknown>) => ({
  voiceId: typeof args.voiceId === 'string' && args.voiceId ? args.voiceId : undefined,
  modelId: typeof args.voiceModelId === 'string' && args.voiceModelId ? args.voiceModelId : VOICE_MODELS[0],
  outputFormat: typeof args.voiceOutputFormat === 'string' && args.voiceOutputFormat ? args.voiceOutputFormat : VOICE_FORMATS[0],
});

const mediaSummary = (item: MediaItem) => ({ id: item.id, name: item.name, type: item.type, url: item.url, duration: item.duration });

export const AVATAR_TOOL_MODULE: StudioToolModule = {
  id: 'avatar',
  label: 'Create: Avatar studio',
  tools: [
    {
      name: 'avatar_list',
      description: 'List saved avatars (id, name, created) and the video modes with what each needs (audio, motion video, prompt) and their settings with defaults.',
      parameters: { type: 'object', properties: {} },
      handler: (_args, ctx) => ({
        avatars: avatarsOf(ctx).map(({ id, name, createdAt, imageUrl }) => ({ id, name, createdAt, hasImage: Boolean(imageUrl) })),
        modes: AVATAR_MODEL_MODES,
        defaultSettings: DEFAULT_AVATAR_VIDEO_SETTINGS,
        voiceModels: VOICE_MODELS,
        voiceOutputFormats: VOICE_FORMATS,
      }),
    },
    {
      name: 'avatar_create',
      description: 'Save a new avatar from a reference image ("Create Avatar"). The image is stored in the project.',
      writes: true,
      parameters: { type: 'object', properties: { name: { type: 'string' }, ...mediaInputSchema('image', 'Avatar reference image') }, required: ['name'] },
      handler: async (args, ctx) => {
        const name = str(args, 'name');
        const url = pickMediaUrl(ctx, args, 'image');
        if (!url) throw new Error('Pass imageUrl, imagePath or imageMediaId.');
        const payload = await urlToPayload(url, 'image/png');
        if (!payload.mimeType.startsWith('image/')) throw new Error('The avatar reference must be an image.');
        const avatar: AvatarProfile = { id: `avatar-${Date.now()}`, name, imageUrl: payloadToDataUrl(payload), createdAt: new Date().toISOString() };
        setExtra(ctx, 'avatars', [...avatarsOf(ctx), avatar]);
        return { avatar: { id: avatar.id, name: avatar.name, createdAt: avatar.createdAt } };
      },
    },
    {
      name: 'avatar_rename',
      description: 'Rename a saved avatar.',
      writes: true,
      parameters: { type: 'object', properties: { avatarId: { type: 'string' }, name: { type: 'string' } }, required: ['avatarId', 'name'] },
      handler: (args, ctx) => {
        const avatar = findAvatar(ctx, args.avatarId);
        const name = str(args, 'name');
        setExtra(ctx, 'avatars', avatarsOf(ctx).map((entry) => (entry.id === avatar.id ? { ...entry, name } : entry)));
        return { avatar: { id: avatar.id, name } };
      },
    },
    {
      name: 'avatar_delete',
      description: 'Delete a saved avatar (its reference image is removed from the project).',
      writes: true,
      destructive: true,
      parameters: { type: 'object', properties: { avatarId: { type: 'string' } }, required: ['avatarId'] },
      handler: (args, ctx) => {
        const avatar = findAvatar(ctx, args.avatarId);
        setExtra(ctx, 'avatars', avatarsOf(ctx).filter((entry) => entry.id !== avatar.id));
        return { removed: avatar.id };
      },
    },
    {
      name: 'avatar_list_voices',
      description: 'List the ElevenLabs voices available for voiceovers.',
      parameters: { type: 'object', properties: {} },
      handler: async () => {
        const voices = await (await avatarServices.get()).fetchElevenLabsVoices();
        return { voices: voices.map(({ voice_id, name, category }) => ({ voiceId: voice_id, name, category: category ?? null })) };
      },
    },
    {
      name: 'avatar_generate_voiceover',
      description: 'Turn text into speech with ElevenLabs ("Generate Voiceover") and add the audio to the media bin; pass its id as audioMediaId to avatar_generate_video.',
      writes: true,
      cost: 'paid',
      parameters: { type: 'object', properties: { text: { type: 'string' }, ...VOICE_PROPS }, required: ['text'] },
      handler: async (args, ctx) => {
        const item = await (await avatarServices.get()).generateSpeechWithElevenLabs(str(args, 'text'), voiceOpts(args));
        ctx.actions.addMediaItem(item);
        return { mediaItem: mediaSummary(item) };
      },
    },
    {
      name: 'avatar_generate_video',
      description:
        'Generate an avatar video ("Generate") and add it to the media bin. Modes: omni-human / aurora-fal (talking avatar; needs audio or voiceText, voiceText costs an extra ElevenLabs call), wan-replace (needs a video to put the avatar into), wan-i2v and kling-26 (need a prompt), kling-motion (needs prompt and a motion video). Settings override the page defaults (avatar_list).',
      writes: true,
      cost: 'paid',
      parameters: {
        type: 'object',
        properties: {
          avatarId: { type: 'string' },
          mode: { type: 'string', enum: MODES },
          prompt: { type: 'string' },
          negativePrompt: { type: 'string', description: 'kling-26.' },
          voiceText: { type: 'string', description: 'omni-human / aurora-fal: generated with ElevenLabs when no audio is given.' },
          ...VOICE_PROPS,
          ...mediaInputSchema('audio', 'Speech audio'),
          ...mediaInputSchema('video', 'Video to replace (wan-replace) or motion video (kling-motion)'),
          ...mediaInputSchema('startFrame', 'kling-26 start frame (default: the avatar image)'),
          settings: { type: 'object', description: 'wanResolution 720|480, wanFps, wanRefertNum 1|5, wanMergeAudio, wanGoFast, wanFrames, wanInterpolate, klingAspect 16:9|9:16|1:1, klingDuration 5|10, klingAudio, klingMode std|pro, klingKeepSound, klingOrientation image|video, auroraResolution 720p|480p.' },
        },
        required: ['avatarId', 'mode'],
      },
      handler: async (args, ctx) => {
        const avatar = findAvatar(ctx, args.avatarId);
        const mode = str(args, 'mode') as AvatarModelMode;
        if (!MODES.includes(mode)) throw new Error(`mode must be one of ${MODES.join(', ')}.`);
        const prompt = typeof args.prompt === 'string' ? args.prompt : '';
        const audioUrl = pickMediaUrl(ctx, args, 'audio');
        const videoUrl = pickMediaUrl(ctx, args, 'video');
        const startUrl = pickMediaUrl(ctx, args, 'startFrame');
        const voiceText = typeof args.voiceText === 'string' ? args.voiceText.trim() : '';
        const usesAudio = mode === 'omni-human' || mode === 'aurora-fal';
        // Validate before spending anything.
        const problem = checkAvatarVideoInput({ mode, prompt, audio: usesAudio && (audioUrl || voiceText) ? { base64: '', mimeType: '' } : null, video: videoUrl ? { base64: '', mimeType: '' } : null });
        if (problem) throw new Error(problem);
        const services = await avatarServices.get();
        let voiceover: MediaItem | null = null;
        let audio = null;
        if (usesAudio) {
          if (audioUrl) audio = await urlToPayload(audioUrl, 'audio/mpeg');
          else {
            voiceover = await services.generateSpeechWithElevenLabs(voiceText, voiceOpts(args));
            ctx.actions.addMediaItem(voiceover);
            audio = await urlToPayload(voiceover.url, 'audio/mpeg');
          }
        }
        const item = await services.generateAvatarVideo({
          mode,
          avatarImage: await urlToPayload(avatar.imageUrl, 'image/png'),
          prompt,
          negativePrompt: typeof args.negativePrompt === 'string' ? args.negativePrompt : '',
          audio,
          video: videoUrl ? await urlToPayload(videoUrl, 'video/mp4') : null,
          startImage: startUrl ? await urlToPayload(startUrl, 'image/png') : null,
          settings: (args.settings && typeof args.settings === 'object' ? args.settings : {}) as AvatarVideoInput['settings'],
        });
        ctx.actions.addMediaItem(item);
        return { mediaItem: mediaSummary(item), voiceover: voiceover ? mediaSummary(voiceover) : null };
      },
    },
  ],
};

registerStudioToolModule(guardPaidTools(AVATAR_TOOL_MODULE));
