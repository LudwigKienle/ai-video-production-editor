
export { };



declare global {
    interface Window {
        electron: {
            project: {
                selectFolder: () => Promise<string | null>;
                selectFile: () => Promise<string | null>;
                probeFolder: (payload: { folderPath: string }) => Promise<{ exists: boolean }>;
                initFolder: (payload: { folderPath: string }) => Promise<{ ok: boolean }>;
                saveProject: (payload: { folderPath: string; project: any; assets?: any[] }) => Promise<{ ok: boolean }>;
                loadProject: (payload: { folderPath: string }) => Promise<{ project: any }>;
                readFile: (payload: { filePath: string }) => Promise<Uint8Array>;
                prepareVideoForEditing?: (payload: { filePath: string; fileName?: string }) => Promise<{
                    ok: boolean;
                    sourcePath: string;
                    sourceUrl: string;
                    proxyPath: string;
                    proxyUrl: string;
                    durationSeconds?: number | null;
                }>;
                openFolder: (payload: { folderPath: string }) => Promise<{ ok: boolean; error: string | null }>;
                listSystemFonts: () => Promise<{ fonts: string[]; error?: string }>;
                exportVideo: (payload: { folderPath: string; project: any; settings: any }) => Promise<{ ok: boolean; outputPath?: string; error?: string }>;
                exportStoryboardPdf: (payload: { folderPath?: string | null; defaultFileName?: string; html: string }) => Promise<{ ok: boolean; canceled?: boolean; outputPath?: string; error?: string }>;
                onExportProgress: (callback: (progress: any) => void) => void;
                removeExportProgressListener: () => void;
            };
            mcp?: {
                init: () => Promise<{ ok: boolean; error?: string }>;
                listTools: () => Promise<any>;
                callTool: (name: string, args: any) => Promise<any>;
                listResources: () => Promise<any>;
                readResource: (uri: string) => Promise<any>;
            };
            comfyui?: {
                start: (options: { command: string; args?: string[]; cwd?: string }) => Promise<any>;
                stop: () => Promise<any>;
                status: () => Promise<any>;
                getLogs: () => Promise<{ lines: string[] }>;
                clearLogs: () => Promise<{ ok: boolean }>;
            };
            audioRemaster?: {
                status: () => Promise<{
                    ready: boolean;
                    available: boolean;
                    pythonPath?: string | null;
                    envPath?: string | null;
                    repoPath?: string | null;
                    workerPath?: string | null;
                    version?: string | null;
                    error?: string | null;
                }>;
                setup: () => Promise<{
                    ready: boolean;
                    available: boolean;
                    pythonPath?: string | null;
                    envPath?: string | null;
                    repoPath?: string | null;
                    workerPath?: string | null;
                    version?: string | null;
                    error?: string | null;
                }>;
                process: (payload: {
                    target: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    };
                    reference: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    };
                    outputName?: string;
                    projectPath?: string | null;
                }) => Promise<{
                    ok: true;
                    outputPath: string;
                    outputName: string;
                    url: string;
                    previewPath?: string | null;
                    previewUrl?: string | null;
                    logLines?: string[];
                }>;
            };
            audioMastering?: {
                status: () => Promise<{
                    ready: boolean;
                    available: boolean;
                    pythonPath?: string | null;
                    envPath?: string | null;
                    workerPath?: string | null;
                    version?: string | null;
                    error?: string | null;
                }>;
                setup: () => Promise<{
                    ready: boolean;
                    available: boolean;
                    pythonPath?: string | null;
                    envPath?: string | null;
                    workerPath?: string | null;
                    version?: string | null;
                    error?: string | null;
                }>;
                process: (payload: {
                    provider: 'local' | 'remote';
                    mode?: 'manual' | 'spotify_auto';
                    target: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    };
                    reference?: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    } | null;
                    compressionStrength: number;
                    stereoWidthPercent: number;
                    targetLufs: number;
                    advanced?: {
                        eqMatchAmount?: number;
                        limiterCeilingDbtp?: number;
                        lowMidCrossoverHz?: number;
                        midHighCrossoverHz?: number;
                    };
                    projectPath?: string | null;
                }) => Promise<{
                    ok: true;
                    outputPath: string;
                    outputName: string;
                    url: string;
                    beforeLufs: number | null;
                    afterLufs: number | null;
                    beforeTruePeakDbtp: number | null;
                    afterTruePeakDbtp: number | null;
                    spotifyReady?: boolean;
                    autoProfile?: string | null;
                    correctionApplied?: boolean;
                    warnings?: string[];
                    processingSummary?: string | null;
                    logLines?: string[];
                }>;
            };
            corridorKey?: {
                status: (payload?: { repoPath?: string | null }) => Promise<{
                    ready: boolean;
                    available: boolean;
                    repoPath?: string | null;
                    uvPath?: string | null;
                    workerPath?: string | null;
                    version?: string | null;
                    error?: string | null;
                }>;
                setup: (payload: { repoPath?: string | null }) => Promise<{
                    ready: boolean;
                    available: boolean;
                    repoPath?: string | null;
                    uvPath?: string | null;
                    workerPath?: string | null;
                    version?: string | null;
                    error?: string | null;
                }>;
                process: (payload: {
                    repoPath: string;
                    projectPath?: string | null;
                    source: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    };
                    alpha: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    };
                    options?: {
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
                }) => Promise<{
                    ok: true;
                    outputPath?: string | null;
                    outputName: string;
                    outputFolder: string;
                    url?: string | null;
                    mediaType?: 'video' | 'image' | 'folder';
                    logLines?: string[];
                }>;
            };
            surfaceMaps?: {
                status: (payload?: { repoPath?: string | null }) => Promise<{
                    ready: boolean;
                    available: boolean;
                    repoPath?: string | null;
                    pythonPath?: string | null;
                    runPath?: string | null;
                    version?: string | null;
                    canvasReady?: boolean;
                    depthGradientReady?: boolean;
                    error?: string | null;
                }>;
                setup: (payload: { repoPath?: string | null }) => Promise<{
                    ready: boolean;
                    available: boolean;
                    repoPath?: string | null;
                    pythonPath?: string | null;
                    runPath?: string | null;
                    version?: string | null;
                    canvasReady?: boolean;
                    depthGradientReady?: boolean;
                    error?: string | null;
                }>;
                process: (payload: {
                    repoPath?: string | null;
                    projectPath?: string | null;
                    source: {
                        base64: string;
                        mimeType: string;
                        name?: string;
                    };
                    options?: {
                        kind?: 'depth' | 'normal';
                        engine?: 'depth-anything-v2' | 'depth-gradient' | 'dsine';
                        encoder?: 'vits' | 'vitb' | 'vitl';
                        device?: 'auto' | 'cuda' | 'mps' | 'cpu';
                        inputSize?: number;
                        normalStrength?: number;
                    };
                }) => Promise<{
                    ok: true;
                    outputPath: string;
                    outputName: string;
                    outputFolder: string;
                    url: string;
                    mediaType: 'image';
                    kind: 'depth' | 'normal';
                    engine: 'depth-anything-v2' | 'depth-gradient' | 'dsine';
                    logLines?: string[];
                }>;
            };
        };
    }
}
