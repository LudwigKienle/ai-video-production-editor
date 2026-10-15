// Foley for the motion scenes and on-screen typing, placed on the narration with wt().
// Mouse clicks and scene-change whooshes are handled in Root.tsx from the recorder events.
import { FPS, SceneData, wt } from './timeline';

export type Cue = { src: string; at: number; frames?: number; volume: number };

const POP = 'audio/sfx/pop-one.wav';
const TYPING = 'audio/sfx/typing-bed.wav';
const PASTE = 'audio/sfx/paste-one.wav';
const SHIMMER = 'audio/sfx/shimmer-one.wav';
const TWINKLE = 'audio/sfx/twinkle-one.wav';

// Terminal lines type at 1.4 characters per frame (see TerminalLine in scenes/Motion.tsx).
const typingFrames = (text: string) => Math.ceil(text.length / 1.4);

export const foley: Record<string, (s: SceneData) => Cue[]> = {
  s01_intro: (s) => [
    { src: SHIMMER, at: 2, volume: 0.32 },
    // Pipeline stages light up as they are named.
    ...['script', 'storyboard,', 'generated', 'edit', 'export.'].map((w) => ({ src: POP, at: wt(s, w, 1, -0.1), volume: 0.22 })),
    // Checklist at the end.
    ...['install', 'connect', 'set'].map((w) => ({ src: POP, at: wt(s, w, 1, -0.15), volume: 0.24 })),
  ],
  s02_install: (s) => [
    { src: POP, at: wt(s, 'desktop', 1, -0.3), volume: 0.2 },
    { src: TYPING, at: wt(s, 'Clone', 1, -0.1), frames: typingFrames('git clone https://github.com/LudwigKienle/ai-video-production-editor'), volume: 0.3 },
    { src: TYPING, at: wt(s, 'npm install,', 1, -0.1), frames: typingFrames('cd ai-video-production-editor && npm install'), volume: 0.3 },
    { src: TYPING, at: wt(s, 'npm run', 1, -0.1), frames: typingFrames('npm run electron:dev'), volume: 0.3 },
  ],
  s06_script: (s) => [
    // The script is pasted, then "Rainline" is typed at 12 characters per second (record/scenes.mjs).
    { src: PASTE, at: wt(s, 'Rainline,', 1, 0.1) - 4, volume: 0.45 },
    { src: TYPING, at: wt(s, 'story', 1, -0.1), frames: Math.ceil(('Rainline'.length / 12) * FPS), volume: 0.32 },
  ],
  s10_outro: (s) => [
    ...[wt(s, 'First', 2, -0.2), wt(s, 'Rainline', 1, -0.2), wt(s, 'open', 2, -0.2)].map((at) => ({ src: POP, at, volume: 0.22 })),
    { src: TWINKLE, at: wt(s, 'star', 1, -0.2), volume: 0.4 },
  ],
};
