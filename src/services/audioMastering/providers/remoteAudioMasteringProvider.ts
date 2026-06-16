import type {
  AudioMasteringRequest,
  AudioMasteringResult,
  AudioMasteringStatus,
} from '../types';

export const remoteAudioMasteringProvider = {
  async status(): Promise<AudioMasteringStatus> {
    return {
      ready: false,
      available: false,
      error: 'Remote audio mastering is not configured yet.',
    };
  },
  async setup(): Promise<AudioMasteringStatus> {
    return {
      ready: false,
      available: false,
      error: 'Remote audio mastering is not configured yet.',
    };
  },
  async run(_request: AudioMasteringRequest): Promise<AudioMasteringResult> {
    throw new Error('Remote audio mastering is not configured yet.');
  },
};
