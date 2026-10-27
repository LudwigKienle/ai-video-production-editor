/**
 * Audio provider services used by the Sound browser and the MCP sound tools:
 * voice (ElevenLabs, MiniMax Speech 02 HD), music (Lyria 2, Sonauto v3), SFX
 * (Lyria 2), stem separation (Demucs) and the local mastering pipeline.
 *
 * Defaults load the real provider modules lazily (they need the browser /
 * Electron runtime); tests install fakes with `setSoundAudioServices`, so no
 * credits are spent while testing.
 */
import type { MediaItem } from '../../types';
import type { AudioMasteringRequest, AudioMasteringResult, AudioMasteringStatus } from '../../services/audioMastering/types';

export type AudioPayload = { base64: string; mimeType: string };

export type SoundAudioServices = {
  elevenLabsSpeech: (text: string, opts: { voiceId?: string; modelId?: string; outputFormat?: string }) => Promise<MediaItem>;
  minimaxSpeech: (text: string, opts: { voice?: string; speed?: number }) => Promise<MediaItem>;
  lyriaMusic: (prompt: string, opts: { duration?: number }) => Promise<MediaItem>;
  sonautoMusic: (prompt: string, opts: { instrumental?: boolean }) => Promise<MediaItem>;
  sonautoAvailable: () => Promise<boolean>;
  demucs: (audio: AudioPayload) => Promise<MediaItem[]>;
  urlToPayload: (url: string) => Promise<AudioPayload>;
  masteringStatus: () => Promise<AudioMasteringStatus>;
  masteringSetup: () => Promise<AudioMasteringStatus>;
  masteringRun: (request: AudioMasteringRequest) => Promise<AudioMasteringResult>;
};

const defaults: SoundAudioServices = {
  elevenLabsSpeech: async (text, opts) => (await import('../../services/elevenLabsService')).generateSpeechWithElevenLabs(text, opts),
  minimaxSpeech: async (text, opts) => (await import('../../services/replicateService')).generateSpeechWithMinimax(text, opts),
  lyriaMusic: async (prompt, opts) => (await import('../../services/replicateService')).generateMusicWithLyria2(prompt, opts),
  sonautoMusic: async (prompt, opts) => (await import('../../services/sonautoService')).generateMusicWithSonauto(prompt, opts),
  sonautoAvailable: async () => (await import('../../services/sonautoService')).hasSonautoApiKey(),
  demucs: async (audio) => (await import('../../services/replicateService')).separateAudioWithDemucs(audio),
  urlToPayload: async (url) => (await import('../../utils/helpers')).getBase64FromUrl(url),
  masteringStatus: async () => (await import('../../services/audioMastering/audioMasteringService')).getAudioMasteringStatus('local'),
  masteringSetup: async () => (await import('../../services/audioMastering/audioMasteringService')).setupAudioMasteringEnvironment('local'),
  masteringRun: async (request) => (await import('../../services/audioMastering/audioMasteringService')).runAudioMasteringJob(request),
};

let services: SoundAudioServices = defaults;

export const getSoundAudioServices = (): SoundAudioServices => services;
export const setSoundAudioServices = (next: Partial<SoundAudioServices>): void => {
  services = { ...services, ...next };
};
export const resetSoundAudioServices = (): void => {
  services = defaults;
};
