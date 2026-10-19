import { probeDrawThings } from './drawThingsService';
import { localHttp, probeLocalServer } from './localLlmService';
import { getComfyBaseUrl } from './localModelService';

export type LocalServiceId = 'draw-things' | 'comfyui' | 'ollama' | 'lmstudio';

export type LocalServiceStatus = { id: LocalServiceId; online: boolean; detail?: string };

/** What each local app is for and the one step that turns it on, in the order shown to new users. */
export const LOCAL_SERVICE_GUIDE: Array<{ id: LocalServiceId; label: string; usedFor: string; setup: string; href: string; makesImages: boolean }> = [
    {
        id: 'draw-things',
        label: 'Draw Things',
        usedFor: 'Images on Apple silicon with FLUX, Qwen Image, SDXL and more.',
        setup: 'In Draw Things open Settings → API Server, choose HTTP on port 7860 and turn it on.',
        href: 'https://drawthings.ai',
        makesImages: true,
    },
    {
        id: 'comfyui',
        label: 'ComfyUI',
        usedFor: 'The Local AI models (FLUX.3 Klein, Qwen Image 2.1, Wan, LTX) for images and video.',
        setup: 'Start ComfyUI on port 8188, then download models in Local AI.',
        href: 'https://www.comfy.org/download',
        makesImages: true,
    },
    {
        id: 'ollama',
        label: 'Ollama',
        usedFor: 'Local text models for scripts and the assistant.',
        setup: 'Install Ollama and pull a model, for example: ollama pull qwen3',
        href: 'https://ollama.com/download',
        makesImages: false,
    },
    {
        id: 'lmstudio',
        label: 'LM Studio',
        usedFor: 'Local text models through an OpenAI-compatible server.',
        setup: 'In LM Studio open Developer and start the server on port 1234.',
        href: 'https://lmstudio.ai',
        makesImages: false,
    },
];

const probeComfy = async (): Promise<LocalServiceStatus> => {
    try {
        const result = await localHttp(`${getComfyBaseUrl()}/system_stats`, { timeoutMs: 3000 });
        return { id: 'comfyui', online: result.ok };
    } catch {
        return { id: 'comfyui', online: false };
    }
};

/** Checks the default local ports; every probe is short and failures just read as "not running". */
export const detectLocalServices = async (): Promise<LocalServiceStatus[]> => {
    const [drawThings, comfy, ollama, lmstudio] = await Promise.all([
        probeDrawThings().catch(() => ({ online: false } as { online: boolean; model?: string })),
        probeComfy(),
        probeLocalServer('ollama'),
        probeLocalServer('lmstudio'),
    ]);
    return [
        { id: 'draw-things', online: drawThings.online, detail: 'model' in drawThings && drawThings.model ? `model: ${drawThings.model}` : undefined },
        comfy,
        { id: 'ollama', online: ollama.online, detail: ollama.version ? `v${ollama.version}` : undefined },
        { id: 'lmstudio', online: lmstudio.online },
    ];
};

const PREFERRED_IMAGE_MODEL_KEY = 'preferred_image_model_v1';

/** Default image model for projects and Image Gen that have not picked one yet. */
export const getPreferredImageModel = (): string | null => {
    try {
        return localStorage.getItem(PREFERRED_IMAGE_MODEL_KEY);
    } catch {
        return null;
    }
};

export const setPreferredImageModel = (model: string | null) => {
    try {
        if (model) localStorage.setItem(PREFERRED_IMAGE_MODEL_KEY, model);
        else localStorage.removeItem(PREFERRED_IMAGE_MODEL_KEY);
    } catch {
        /* storage unavailable */
    }
};
