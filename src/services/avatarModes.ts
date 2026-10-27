/**
 * Avatar model modes, settings and input checks (no provider imports, so the
 * MCP tools and tests can use them without loading the services).
 */
export type AvatarModelMode = 'omni-human' | 'wan-replace' | 'wan-i2v' | 'kling-26' | 'kling-motion' | 'aurora-fal';

export const AVATAR_MODEL_MODES: Array<{ id: AvatarModelMode; label: string; needs: Array<'audio' | 'video' | 'prompt'>; provider: string }> = [
  { id: 'omni-human', label: 'OmniHuman (talking avatar from audio)', needs: ['audio'], provider: 'replicate' },
  { id: 'aurora-fal', label: 'Creatify Aurora (talking avatar from audio)', needs: ['audio'], provider: 'fal' },
  { id: 'wan-replace', label: 'Wan Animate Replace (put the avatar into a video)', needs: ['video'], provider: 'replicate' },
  { id: 'wan-i2v', label: 'Wan 2.2 image-to-video', needs: ['prompt'], provider: 'replicate' },
  { id: 'kling-26', label: 'Kling 2.6', needs: ['prompt'], provider: 'replicate' },
  { id: 'kling-motion', label: 'Kling Motion Control (avatar follows a motion video)', needs: ['video', 'prompt'], provider: 'replicate' },
];

export type Payload = { base64: string; mimeType: string };

export type AvatarVideoSettings = {
  wanResolution?: '720' | '480';
  wanFps?: number;
  wanRefertNum?: 1 | 5;
  wanMergeAudio?: boolean;
  wanGoFast?: boolean;
  wanFrames?: number;
  wanInterpolate?: boolean;
  klingAspect?: '16:9' | '9:16' | '1:1';
  klingDuration?: 5 | 10;
  klingAudio?: boolean;
  klingMode?: 'std' | 'pro';
  klingKeepSound?: boolean;
  klingOrientation?: 'image' | 'video';
  auroraResolution?: '720p' | '480p';
};

export const DEFAULT_AVATAR_VIDEO_SETTINGS: Required<AvatarVideoSettings> = {
  wanResolution: '720',
  wanFps: 24,
  wanRefertNum: 1,
  wanMergeAudio: true,
  wanGoFast: true,
  wanFrames: 81,
  wanInterpolate: false,
  klingAspect: '16:9',
  klingDuration: 5,
  klingAudio: true,
  klingMode: 'std',
  klingKeepSound: true,
  klingOrientation: 'image',
  auroraResolution: '720p',
};

export type AvatarVideoInput = {
  mode: AvatarModelMode;
  avatarImage: Payload;
  prompt?: string;
  negativePrompt?: string;
  /** omni-human, aurora-fal */
  audio?: Payload | null;
  /** wan-replace (video to replace), kling-motion (motion video) */
  video?: Payload | null;
  /** kling-26: optional start frame; the avatar image is used when omitted. */
  startImage?: Payload | null;
  settings?: AvatarVideoSettings;
  onStatus?: (message: string) => void;
};

/** Checks the inputs a mode needs; returns a user-facing message or null. */
export function checkAvatarVideoInput(input: Pick<AvatarVideoInput, 'mode' | 'prompt' | 'audio' | 'video'>): string | null {
  const mode = AVATAR_MODEL_MODES.find((entry) => entry.id === input.mode);
  if (!mode) return `Unknown avatar mode ${input.mode}.`;
  if (mode.needs.includes('audio') && !input.audio) return 'Provide audio or voiceover text.';
  if (mode.needs.includes('video') && !input.video) return input.mode === 'wan-replace' ? 'Provide a video to replace.' : 'Provide a motion video.';
  if (mode.needs.includes('prompt') && !input.prompt?.trim()) return 'Add a prompt.';
  return null;
}
