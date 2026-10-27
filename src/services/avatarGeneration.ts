/**
 * Avatar video generation (Create › Avatar): one entry point for the six
 * model modes. AvatarWorkspace and the MCP avatar_ tools both call it.
 * Every mode is a paid provider call.
 */
import type { MediaItem } from '../types';
import {
  generateVideoWithKling26,
  generateVideoWithKlingMotionControl,
  generateVideoWithOmniHuman,
  generateVideoWithWanAnimateReplace,
  generateVideoWithWanI2V,
} from './replicateService';
import { generateVideoWithFalCreatifyAurora } from './falAiService';

import { DEFAULT_AVATAR_VIDEO_SETTINGS, checkAvatarVideoInput, type AvatarVideoInput } from './avatarModes';

export * from './avatarModes';

export async function generateAvatarVideo(input: AvatarVideoInput): Promise<MediaItem> {
  const problem = checkAvatarVideoInput(input);
  if (problem) throw new Error(problem);
  const s = { ...DEFAULT_AVATAR_VIDEO_SETTINGS, ...(input.settings ?? {}) };
  const status = input.onStatus ?? (() => undefined);
  const prompt = input.prompt?.trim() ?? '';
  switch (input.mode) {
    case 'omni-human':
      status('Generating OmniHuman video...');
      return generateVideoWithOmniHuman(input.avatarImage, input.audio!);
    case 'wan-replace':
      status('Running Wan Animate Replace...');
      return generateVideoWithWanAnimateReplace(input.video!, input.avatarImage, {
        resolution: s.wanResolution,
        fps: s.wanFps,
        refertNum: s.wanRefertNum,
        mergeAudio: s.wanMergeAudio,
        goFast: s.wanGoFast,
      });
    case 'wan-i2v':
      status('Animating with Wan 2.2...');
      return generateVideoWithWanI2V(prompt, input.avatarImage, {
        resolution: s.wanResolution === '480' ? '480p' : '720p',
        fps: s.wanFps,
        numFrames: s.wanFrames,
        interpolate: s.wanInterpolate,
      });
    case 'kling-26':
      status('Generating Kling 2.6 video...');
      return generateVideoWithKling26(prompt, {
        startImage: input.startImage ?? input.avatarImage,
        aspectRatio: s.klingAspect,
        duration: s.klingDuration,
        generateAudio: s.klingAudio,
        negativePrompt: input.negativePrompt || '',
      });
    case 'kling-motion':
      status('Driving motion with Kling...');
      return generateVideoWithKlingMotionControl(prompt, input.avatarImage, input.video!, {
        mode: s.klingMode,
        keepOriginalSound: s.klingKeepSound,
        characterOrientation: s.klingOrientation,
      });
    case 'aurora-fal':
      status('Generating Aurora avatar video...');
      return generateVideoWithFalCreatifyAurora(input.avatarImage, input.audio!, {
        prompt: prompt || undefined,
        resolution: s.auroraResolution,
      });
    default:
      throw new Error(`Unknown avatar mode ${String(input.mode)}.`);
  }
}
