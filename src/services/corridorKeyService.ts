export type CorridorKeyStatus = {
  ready: boolean;
  available: boolean;
  repoPath?: string | null;
  uvPath?: string | null;
  workerPath?: string | null;
  version?: string | null;
  error?: string | null;
};

export type CorridorKeyPayload = {
  base64: string;
  mimeType: string;
  name?: string;
};

export type CorridorKeyOptions = {
  device?: 'auto' | 'cuda' | 'mps' | 'cpu';
  backend?: 'auto' | 'torch' | 'mlx';
  inputColorSpace?: 'srgb' | 'linear';
  despill?: number;
  autoDespeckle?: boolean;
  despeckleSize?: number;
  refiner?: number;
  imageSize?: 512 | 1024 | 2048;
  maxFrames?: number | null;
  generateComp?: boolean;
  gpuPost?: boolean;
  tiledInference?: boolean;
};

export type CorridorKeyResult = {
  ok: true;
  outputPath?: string | null;
  outputName: string;
  outputFolder: string;
  url?: string | null;
  mediaType?: 'video' | 'image' | 'folder';
  logLines?: string[];
};

type CorridorKeyApi = NonNullable<typeof window.electron.corridorKey>;

const getCorridorKeyApi = (): CorridorKeyApi => {
  const api = window.electron?.corridorKey;
  if (!api) {
    throw new Error('CorridorKey is available in the desktop app.');
  }
  return api;
};

export const getCorridorKeyStatus = async (repoPath?: string | null): Promise<CorridorKeyStatus> => {
  return getCorridorKeyApi().status({ repoPath });
};

export const setupCorridorKeyEnvironment = async (repoPath?: string | null): Promise<CorridorKeyStatus> => {
  return getCorridorKeyApi().setup({ repoPath });
};

export const runCorridorKey = async (request: {
  repoPath: string;
  projectPath?: string | null;
  source: CorridorKeyPayload;
  alpha: CorridorKeyPayload;
  options?: CorridorKeyOptions;
}): Promise<CorridorKeyResult> => {
  return getCorridorKeyApi().process(request);
};
