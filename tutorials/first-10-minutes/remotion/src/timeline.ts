import data from './data.generated.json';

export const FPS = 30;
export const WIDTH = 1920;
export const HEIGHT = 1080;
/** Picture before the first word and after the last one; must match record/recorder.mjs. */
export const LEAD = 0.5;
export const TAIL = 0.9;
/** Cross-fade between consecutive scenes, in frames. */
export const XFADE = 8;

export type Word = { word: string; start: number; end: number };
export type Mark = { name: string; t: number; x: number; y: number; w: number; h: number };
export type SceneData = {
  id: string;
  kind: 'motion' | 'screen';
  text: string;
  words: Word[];
  duration: number;
  estimated: boolean;
  audio: string | null;
  hasScreen: boolean;
  marks: Mark[];
  events: Array<{ type: string; t: number; x: number; y: number }>;
  viewport: { width: number; height: number; scale: number } | null;
};

export const scenes = data.scenes as SceneData[];
export const music = data.music as string | null;
export const sfx = (data as { sfx?: { click: string | null; whoosh: string | null } }).sfx ?? { click: null, whoosh: null };

export const sceneFrames = (s: SceneData) => Math.ceil((LEAD + s.duration + TAIL) * FPS);

/** Start frame of every scene; scenes overlap by XFADE frames. */
export const timeline = (() => {
  let from = 0;
  return scenes.map((s) => {
    const entry = { scene: s, from, frames: sceneFrames(s) };
    from += entry.frames - XFADE;
    return entry;
  });
})();

export const totalFrames = timeline.length
  ? timeline[timeline.length - 1].from + timeline[timeline.length - 1].frames
  : 1;

export const sceneById = (id: string) => {
  const s = scenes.find((x) => x.id === id);
  if (!s) throw new Error(`unknown scene ${id}`);
  return s;
};

const norm = (w: string) => w.toLowerCase().replace(/[^a-z0-9']/g, '');

/** Scene-local frame at which a word (or phrase) is spoken: wt(scene, 'install'). */
export const wt = (scene: SceneData, phrase: string, n = 1, offset = 0) => {
  const parts = phrase.split(/\s+/).map(norm);
  let seen = 0;
  for (let i = 0; i <= scene.words.length - parts.length; i++) {
    if (parts.every((p, k) => norm(scene.words[i + k].word) === p) && ++seen === n) {
      return Math.round((LEAD + scene.words[i].start + offset) * FPS);
    }
  }
  throw new Error(`${scene.id}: "${phrase}" #${n} not in narration`);
};

/** Most recent mark with this name at or before scene time t (s), else the first one. */
export const markAt = (scene: SceneData, name: string, t = Infinity) => {
  const list = scene.marks.filter((m) => m.name === name);
  if (!list.length) throw new Error(`${scene.id}: no mark "${name}"`);
  return [...list].reverse().find((m) => m.t <= t) ?? list[0];
};
