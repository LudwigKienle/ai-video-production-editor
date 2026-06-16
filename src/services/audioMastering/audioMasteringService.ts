import {
  localAudioMasteringProvider,
} from './providers/localAudioMasteringProvider';
import {
  remoteAudioMasteringProvider,
} from './providers/remoteAudioMasteringProvider';
import type {
  AudioMasteringProvider,
  AudioMasteringRequest,
  AudioMasteringResult,
  AudioMasteringStatus,
} from './types';

const resolveProvider = (provider: AudioMasteringProvider) => {
  return provider === 'remote' ? remoteAudioMasteringProvider : localAudioMasteringProvider;
};

export const getAudioMasteringStatus = async (provider: AudioMasteringProvider = 'local'): Promise<AudioMasteringStatus> => {
  return resolveProvider(provider).status();
};

export const setupAudioMasteringEnvironment = async (
  provider: AudioMasteringProvider = 'local'
): Promise<AudioMasteringStatus> => {
  return resolveProvider(provider).setup();
};

export const runAudioMasteringJob = async (request: AudioMasteringRequest): Promise<AudioMasteringResult> => {
  return resolveProvider(request.provider).run(request);
};

export type {
  AudioMasteringAdvancedOptions,
  AudioMasteringPayload,
  AudioMasteringProgress,
  AudioMasteringProgressPhase,
  AudioMasteringProvider,
  AudioMasteringRequest,
  AudioMasteringResult,
  AudioMasteringStatus,
} from './types';
