import catalog from './localModelCatalog.generated.json';

/**
 * Open-weights models the studio can download and run in a local ComfyUI.
 *
 * The data lives in localModelCatalog.generated.json: file lists checked against the
 * Hugging Face file trees (names and exact byte sizes), and the official Comfy-Org
 * workflow templates converted to ComfyUI's API format (no custom nodes; validated
 * with ComfyUI's validate_prompt). `bindings` say which node input takes the prompt,
 * size, seed and reference images.
 */

export type LocalModelFolder = 'diffusion_models' | 'text_encoders' | 'vae' | 'loras' | 'checkpoints' | 'model_patches' | 'latent_upscale_models';

export type LocalModelFile = {
  folder: LocalModelFolder;
  name: string;
  url: string;
  /** Exact size in bytes from the Hugging Face file tree. */
  size: number;
  /** Optional add-ons (prompt enhancers); the model runs without them. */
  optional?: boolean;
  note?: string;
};

export type ComfyNodeInputRef = { node: string; input: string };

export type LocalWorkflowTemplate = {
  source: string;
  minComfyUI?: string;
  graph: Record<string, { class_type: string; inputs: Record<string, unknown>; _meta?: Record<string, unknown> }>;
  bindings: {
    positive: ComfyNodeInputRef;
    negative?: ComfyNodeInputRef;
    width?: ComfyNodeInputRef;
    height?: ComfyNodeInputRef;
    seed?: ComfyNodeInputRef;
    steps?: ComfyNodeInputRef;
    /** Video length in frames (Wan: 4n+1). */
    frames?: ComfyNodeInputRef;
    /** Video length in seconds (LTX computes frames as seconds × fps + 1). */
    durationSeconds?: ComfyNodeInputRef;
    fps?: ComfyNodeInputRef;
    images?: ComfyNodeInputRef[];
    /** A prompt enhancer behind a simple on/off value (its files are always installed). */
    enhanceFlag?: ComfyNodeInputRef & { enabledValue: boolean };
    /**
     * Built-in prompt enhancer (an LLM that expands the prompt). Turning it off removes
     * its nodes, because ComfyUI validates their model file even when a switch skips them.
     */
    enhancer?: ComfyNodeInputRef & { enabledValue: boolean; rawPromptSide: string; removeNodes: string[]; file: string };
  };
};

export type LocalWorkflowKind = 't2i' | 'edit' | 't2v' | 'i2v';

export type LocalModelEntry = {
  id: string;
  label: string;
  vendor: string;
  kind: 'image' | 'video';
  summary: string;
  capabilities: string[];
  vram: string;
  license: { name: string; commercial: 'yes' | 'no' | 'limited'; url: string; note?: string };
  /** The repository asks you to accept its license and download with a Hugging Face token. */
  gated: boolean;
  homepage: string;
  files: LocalModelFile[];
  workflows: Partial<Record<LocalWorkflowKind, LocalWorkflowTemplate>>;
};

export const LOCAL_MODEL_CATALOG = catalog as unknown as LocalModelEntry[];
