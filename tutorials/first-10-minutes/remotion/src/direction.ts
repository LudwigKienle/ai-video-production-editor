// Camera and highlights for the screen scenes, placed on the narration with wt().
// Marks come from the recorder (build/screen/<scene>.marks.json).
import type { Direction } from './components/ScreenScene';
import { SceneData, wt } from './timeline';

type Director = (s: SceneData) => Direction;

export const directions: Record<string, Director> = {
  s03_onboarding: (s) => ({
    chapter: '02 · Welcome guide',
    shots: [
      { at: 0, zoom: 1.45, focus: 'wizard', dur: 1 },
      { at: wt(s, 'Just', 1, -0.3), zoom: 1.7, focus: 'simple-card' },
      { at: wt(s, 'filmmaker', 1, -0.3), zoom: 1.7, focus: 'pro-card' },
      { at: wt(s, 'Next,', 1, -0.2), zoom: 1.6, focus: 'look-dark' },
      { at: wt(s, 'Then', 1, 0), zoom: 1.45, focus: 'providers' },
      { at: wt(s, 'Google', 1, -0.3), zoom: 2.0, focus: 'gemini' },
      { at: wt(s, 'stored', 1, -0.4), zoom: 1.8, focus: 'keys-local' },
      { at: wt(s, 'last', 1, -0.2), zoom: 1.4, focus: 'ready' },
      { at: wt(s, 'With', 1, 0.3), zoom: 1.2, focus: 'settings' },
      { at: wt(s, 'thirteen', 1, -0.4), zoom: 2.0, focus: 'providers-count' },
      { at: wt(s, 'Close', 1, 0.2), zoom: 1, dur: 30 },
    ],
    highlights: [
      { mark: 'gemini', from: wt(s, 'Google', 1, 0.1), to: wt(s, 'stored', 1, -0.3) },
      { mark: 'keys-local', from: wt(s, 'stored', 1), to: wt(s, 'skip', 1) },
      { mark: 'providers-count', from: wt(s, 'thirteen', 1, -0.1), to: wt(s, 'Close', 1) },
    ],
  }),

  s04_interface: (s) => ({
    chapter: '03 · The studio',
    shots: [
      { at: wt(s, 'sidebar', 1, -0.2), zoom: 1.6, focus: { x: 220, y: 420 } },
      { at: wt(s, 'At', 1, -0.1), zoom: 2.2, focus: 'modes' },
      { at: wt(s, 'Simple', 2, 0.3), zoom: 1.5, focus: { x: 300, y: 430 } },
      { at: wt(s, 'Set', 1, -0.4), zoom: 1.6, focus: { x: 220, y: 520 } },
      { at: wt(s, 'Activity', 1, -0.4), zoom: 2.2, focus: 'activity' },
      { at: wt(s, 'AI', 1, -0.3), zoom: 2.2, focus: 'ai-tools' },
    ],
    highlights: [
      { mark: 'modes', from: wt(s, 'Simple,', 1, -0.1), to: wt(s, 'Simple', 2, 0.2) },
      { mark: 'activity', from: wt(s, 'Activity', 1), to: wt(s, 'AI', 1, -0.2) },
      { mark: 'ai-tools', from: wt(s, 'AI', 1, 0.1), to: wt(s, 'assistant.', 1, 0.8) },
    ],
  }),

  s05_folder: (s) => ({
    chapter: '04 · Project folder',
    shots: [
      { at: 0, zoom: 1, dur: 1 },
      { at: wt(s, 'Open', 1, -0.4), zoom: 2.0, focus: 'project-menu' },
      { at: wt(s, 'writes', 1, -0.2), zoom: 1.0 },
      { at: wt(s, 'badge', 1, -0.4), zoom: 2.4, focus: 'saved' },
    ],
    highlights: [
      { mark: 'no-folder', from: wt(s, 'choose', 1), to: wt(s, 'Open', 1, -0.1) },
      { mark: 'saved', from: wt(s, 'Saved.', 1, -0.3), to: wt(s, 'Saved.', 1, 1.6) },
    ],
  }),

  s06_script: (s) => ({
    chapter: '05 · Project Hub',
    shots: [
      { at: 0, zoom: 1, dur: 1 },
      { at: wt(s, 'format:', 1, -0.3), zoom: 2.0, focus: 'format' },
      { at: wt(s, 'seven', 1, -0.3), zoom: 1.7, focus: 'steps' },
      { at: wt(s, 'paste', 1, -0.3), zoom: 1.35, focus: 'script' },
      { at: wt(s, 'title', 1, -0.3), zoom: 1.9, focus: 'title' },
      { at: wt(s, 'Analyze', 1, -0.4), zoom: 2.1, focus: 'analyze' },
    ],
    highlights: [
      { mark: 'steps', from: wt(s, 'seven', 1), to: wt(s, 'script.', 1, 0.3) },
      { mark: 'analyze', from: wt(s, 'Analyze', 1, -0.1), to: wt(s, 'steps.', 2, 0.8) },
    ],
  }),

  s07_phases: (s) => ({
    chapter: '06 · Seven steps',
    shots: [{ at: 0, zoom: 1.25, focus: { x: 900, y: 420 }, dur: 1 }],
    highlights: [],
  }),

  s08_create: (s) => ({
    chapter: '07 · Generators',
    shots: [
      { at: 0, zoom: 1, dur: 1 },
      { at: wt(s, 'needs', 1, -0.4), zoom: 1.9, focus: 'readiness' },
      { at: wt(s, 'estimated', 1, -0.3), zoom: 1.9, focus: 'cost' },
      { at: wt(s, 'Node', 1, -0.2), zoom: 1 },
    ],
    highlights: [
      { mark: 'readiness', from: wt(s, 'needs', 1), to: wt(s, 'estimated', 1, -0.2) },
      { mark: 'cost', from: wt(s, 'estimated', 1), to: wt(s, 'key.', 1, 0.6) },
    ],
  }),

  s09_edit_export: (s) => ({
    chapter: '08 · Edit and export',
    shots: [
      { at: 0, zoom: 1, dur: 1 },
      { at: wt(s, 'cut,', 1, -0.5), zoom: 2.0, focus: 'page-bar' },
      { at: wt(s, 'Export', 1, 0.2), zoom: 1.5, focus: 'preset-TikTok' },
    ],
    highlights: [
      { mark: 'page-bar', from: wt(s, 'cut,', 1, -0.2), to: wt(s, 'Export', 1) },
      { mark: 'preset-YouTube', from: wt(s, 'YouTube,', 1, -0.1), to: wt(s, 'Instagram.', 1, 1.0) },
      { mark: 'preset-TikTok', from: wt(s, 'TikTok', 1, -0.1), to: wt(s, 'Instagram.', 1, 1.0) },
      { mark: 'preset-Instagram', from: wt(s, 'Instagram.', 1, -0.1), to: wt(s, 'Instagram.', 1, 1.0) },
    ],
  }),
};
