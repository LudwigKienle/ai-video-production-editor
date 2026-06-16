export type AudioRemasterPayload = {
  base64: string;
  mimeType: string;
  name?: string;
};

export type AudioRemasterStatus = {
  ready: boolean;
  available: boolean;
  pythonPath?: string | null;
  envPath?: string | null;
  repoPath?: string | null;
  workerPath?: string | null;
  version?: string | null;
  error?: string | null;
};

export type AudioRemasterResult = {
  ok: true;
  outputPath: string;
  outputName: string;
  url: string;
  previewPath?: string | null;
  previewUrl?: string | null;
  logLines?: string[];
};

type ElectronAudioRemasterApi = {
  status: () => Promise<AudioRemasterStatus>;
  setup: () => Promise<AudioRemasterStatus>;
  process: (payload: {
    target: AudioRemasterPayload;
    reference: AudioRemasterPayload;
    outputName?: string;
    projectPath?: string | null;
  }) => Promise<AudioRemasterResult>;
};

const getAudioRemasterApi = (): ElectronAudioRemasterApi => {
  const api = window.electron?.audioRemaster;
  if (!api) {
    throw new Error('Local audio remastering is only available in the desktop app.');
  }
  return api;
};

export const getAudioRemasterStatus = async (): Promise<AudioRemasterStatus> => {
  return getAudioRemasterApi().status();
};

export const setupAudioRemasterEnvironment = async (): Promise<AudioRemasterStatus> => {
  return getAudioRemasterApi().setup();
};

export const runAudioRemaster = async (payload: {
  target: AudioRemasterPayload;
  reference: AudioRemasterPayload;
  outputName?: string;
  projectPath?: string | null;
}): Promise<AudioRemasterResult> => {
  return getAudioRemasterApi().process(payload);
};
