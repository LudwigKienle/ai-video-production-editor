export type SurfaceMapStatus = {
  ready: boolean;
  available: boolean;
  repoPath?: string | null;
  pythonPath?: string | null;
  runPath?: string | null;
  version?: string | null;
  canvasReady?: boolean;
  depthGradientReady?: boolean;
  error?: string | null;
};

export type SurfaceMapPayload = {
  base64: string;
  mimeType: string;
  name?: string;
};

export type SurfaceMapOptions = {
  kind?: 'depth' | 'normal';
  engine?: 'depth-anything-v2' | 'depth-gradient' | 'dsine';
  encoder?: 'vits' | 'vitb' | 'vitl';
  device?: 'auto' | 'cuda' | 'mps' | 'cpu';
  inputSize?: number;
  normalStrength?: number;
};

export type SurfaceMapResult = {
  ok: true;
  outputPath: string;
  outputName: string;
  outputFolder: string;
  url: string;
  mediaType: 'image';
  kind: 'depth' | 'normal';
  engine: 'depth-anything-v2' | 'depth-gradient' | 'dsine';
  logLines?: string[];
};

type SurfaceMapApi = NonNullable<typeof window.electron.surfaceMaps>;

const getSurfaceMapApi = (): SurfaceMapApi => {
  const api = window.electron?.surfaceMaps;
  if (!api) {
    throw new Error('Surface map generation is available in the desktop app.');
  }
  return api;
};

export const getSurfaceMapStatus = async (repoPath?: string | null): Promise<SurfaceMapStatus> => {
  return getSurfaceMapApi().status({ repoPath });
};

export const setupSurfaceMapEnvironment = async (repoPath?: string | null): Promise<SurfaceMapStatus> => {
  return getSurfaceMapApi().setup({ repoPath });
};

export const runSurfaceMap = async (request: {
  repoPath?: string | null;
  projectPath?: string | null;
  source: SurfaceMapPayload;
  options?: SurfaceMapOptions;
}): Promise<SurfaceMapResult> => {
  return getSurfaceMapApi().process(request);
};
