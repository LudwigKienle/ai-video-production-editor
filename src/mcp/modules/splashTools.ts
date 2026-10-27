/**
 * MCP tools: start animation (logo splash) and start sound.
 *
 * Settings live in localStorage (splashSettings.ts) and are read/written here
 * directly. Playing the animation or the sound needs the mounted SplashHost,
 * reached through the live commands `splash.play` and `splash.sound.preview`.
 */
import { invokeLiveCommand } from '../liveCommands.ts';
import { numArg, registerStudioToolModule, type JsonSchema } from '../toolModules.ts';
import { SPLASH_LAYERS, SPLASH_TIMELINE, SPLASH_VARIANTS, splashDuration } from '../../splash/renderSplashFrame.ts';
import { loadSplashSettings, saveSplashSettings, type SplashSettings } from '../../splash/splashSettings.ts';
import { START_SOUND, measureLoudness, synthStartSound } from '../../splash/startSound.ts';

const VARIANT_IDS = SPLASH_VARIANTS.map((v) => v.id);

const SETTINGS_PROPS: Record<string, JsonSchema> = {
  enabled: { type: 'boolean', description: 'Show the start animation once per app start.' },
  sound: { type: 'boolean', description: 'Play the start sound with it.' },
  volume: { type: 'number', minimum: 0, maximum: 1, description: 'Start sound volume, 0..1.' },
  variant: { type: 'string', enum: VARIANT_IDS, description: 'A = gold line (Diana + Hermes wings), B = green silhouettes, C = minimal (arrow and wings only).' },
  background: { type: 'string', enum: ['auto', 'dark', 'light'], description: 'auto = follow the app theme (dark → black, light → cream), or force dark/light.' },
};

const describe = (settings: SplashSettings) => ({
  settings,
  variants: SPLASH_VARIANTS,
  durationSeconds: splashDuration(),
  layers: SPLASH_LAYERS,
});

let soundMetrics: { lufs: number; peakDb: number; durationSeconds: number; sampleRate: number } | null = null;
const metrics = () => {
  if (!soundMetrics) {
    const sampleRate = 48000;
    const samples = synthStartSound(sampleRate);
    const { lufs, peakDb } = measureLoudness(samples, sampleRate);
    soundMetrics = { lufs: Math.round(lufs * 10) / 10, peakDb: Math.round(peakDb * 10) / 10, durationSeconds: samples.length / 2 / sampleRate, sampleRate };
  }
  return soundMetrics;
};

registerStudioToolModule({
  id: 'splash',
  label: 'Start animation',
  tools: [
    {
      name: 'splash_settings_get',
      description: 'Read the start animation settings (enabled, sound, volume 0..1, variant A/B/C), the variants and the animation length in seconds.',
      parameters: { type: 'object', properties: {} },
      handler: () => describe(loadSplashSettings()),
    },
    {
      name: 'splash_settings_set',
      description: 'Change start animation settings (app preference, stored on this machine). Pass only the fields to change.',
      parameters: { type: 'object', properties: SETTINGS_PROPS },
      handler: (args) => {
        const patch: Partial<SplashSettings> = {};
        if (typeof args.enabled === 'boolean') patch.enabled = args.enabled;
        if (typeof args.sound === 'boolean') patch.sound = args.sound;
        if (args.volume !== undefined) {
          const volume = numArg(args, 'volume');
          if (volume < 0 || volume > 1) throw new Error('volume must be between 0 and 1.');
          patch.volume = volume;
        }
        if (args.variant !== undefined) {
          if (!VARIANT_IDS.includes(args.variant as never)) throw new Error(`Unknown variant ${String(args.variant)} (use ${VARIANT_IDS.join(', ')}).`);
          patch.variant = args.variant as SplashSettings['variant'];
        }
        if (args.background !== undefined) {
          if (!['auto', 'dark', 'light'].includes(String(args.background))) throw new Error(`Unknown background ${String(args.background)} (use auto, dark or light).`);
          patch.background = args.background as SplashSettings['background'];
        }
        if (!Object.keys(patch).length) throw new Error('Nothing to change: pass enabled, sound, volume, variant or background.');
        return describe(saveSplashSettings(patch));
      },
    },
    {
      name: 'splash_play',
      description: 'Play the start animation now in the open app window (overlay, about 3.4 s, skippable). Optional variant and sound override this one run only.',
      parameters: {
        type: 'object',
        properties: {
          variant: SETTINGS_PROPS.variant,
          background: SETTINGS_PROPS.background,
          sound: { type: 'boolean', description: 'Override the sound setting for this run.' },
          reducedMotion: { type: 'boolean', description: 'Show the short static fade used for prefers-reduced-motion.' },
        },
      },
      handler: async (args) => {
        if (args.variant !== undefined && !VARIANT_IDS.includes(args.variant as never)) throw new Error(`Unknown variant ${String(args.variant)}.`);
        const result = (await invokeLiveCommand('splash.play', args, { timeoutMs: 1500 })) as Record<string, unknown>;
        return { ...result, timeline: SPLASH_TIMELINE };
      },
    },
    {
      name: 'splash_sound_preview',
      description: 'Play the start sound alone (about 3 s) and report its measured loudness (LUFS) and sample peak (dBFS). If the app cannot play audio it stays silent and says so.',
      parameters: { type: 'object', properties: { volume: { type: 'number', minimum: 0, maximum: 1, description: 'Volume for this preview, default = setting.' } } },
      handler: async (args) => {
        const measured = metrics();
        let playback: Record<string, unknown>;
        try {
          playback = (await invokeLiveCommand('splash.sound.preview', args, { timeoutMs: 1500 })) as Record<string, unknown>;
        } catch (error) {
          playback = { played: false, reason: error instanceof Error ? error.message : String(error) };
        }
        return { ...playback, sound: { ...measured, targetLufs: START_SOUND.targetLufs, marks: START_SOUND.marks } };
      },
    },
  ],
});
