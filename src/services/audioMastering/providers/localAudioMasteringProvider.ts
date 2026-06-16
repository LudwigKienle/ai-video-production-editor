import type {
  AudioMasteringRequest,
  AudioMasteringResult,
  AudioMasteringStatus,
} from '../types';

type ElectronAudioMasteringApi = {
  status: () => Promise<AudioMasteringStatus>;
  setup: () => Promise<AudioMasteringStatus>;
  process: (payload: AudioMasteringRequest) => Promise<AudioMasteringResult>;
};

const getElectronAudioMasteringApi = (): ElectronAudioMasteringApi => {
  const api = window.electron?.audioMastering;
  if (!api) {
    throw new Error('Audio mastering is only available in the desktop app.');
  }
  return api;
};

export const localAudioMasteringProvider = {
  status(): Promise<AudioMasteringStatus> {
    return getElectronAudioMasteringApi().status();
  },
  setup(): Promise<AudioMasteringStatus> {
    return getElectronAudioMasteringApi().setup();
  },
  run(request: AudioMasteringRequest): Promise<AudioMasteringResult> {
    return getElectronAudioMasteringApi().process(request);
  },
};
