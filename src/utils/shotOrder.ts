import type { ShotPrompt } from '../types';

/**
 * Shots in screen order: by scene, then by position inside the scene, then by shot number.
 * Shot numbers alone are not screen order — directing scene by scene appends new numbers,
 * so "shot 148" can be the last shot of the last episode while "shot 149" opens the first.
 */
export const screenOrder = <T extends Pick<ShotPrompt, 'shot' | 'sceneNumber' | 'sceneShotNumber'>>(shots: T[]): T[] => {
  const sceneKey = (shot: T) => (Number.isFinite(shot.sceneNumber) ? Number(shot.sceneNumber) : Number.POSITIVE_INFINITY);
  const orderKey = (shot: T) => (Number.isFinite(shot.sceneShotNumber) ? Number(shot.sceneShotNumber) : shot.shot);
  return [...shots].sort((a, b) => sceneKey(a) - sceneKey(b) || orderKey(a) - orderKey(b) || a.shot - b.shot);
};

type NeighbourOptions<T> = {
  /** Only consider shots that satisfy this (e.g. ones that already have a frame). */
  where?: (shot: T) => boolean;
  /** Stay inside the shot's own scene. */
  sameScene?: boolean;
};

const neighbour = <T extends Pick<ShotPrompt, 'shot' | 'sceneNumber' | 'sceneShotNumber'>>(
  shots: T[],
  shotNumber: number,
  direction: -1 | 1,
  options: NeighbourOptions<T> = {},
): T | null => {
  const ordered = screenOrder(shots);
  const index = ordered.findIndex((shot) => shot.shot === shotNumber);
  if (index < 0) return null;
  const scene = ordered[index].sceneNumber;
  for (let i = index + direction; i >= 0 && i < ordered.length; i += direction) {
    const candidate = ordered[i];
    if (options.sameScene && candidate.sceneNumber !== scene) return null;
    if (!options.where || options.where(candidate)) return candidate;
  }
  return null;
};

/** The shot the audience saw just before this one. */
export const previousInScreenOrder = <T extends Pick<ShotPrompt, 'shot' | 'sceneNumber' | 'sceneShotNumber'>>(shots: T[], shotNumber: number, options?: NeighbourOptions<T>) =>
  neighbour(shots, shotNumber, -1, options);

/** The shot the audience sees next. */
export const nextInScreenOrder = <T extends Pick<ShotPrompt, 'shot' | 'sceneNumber' | 'sceneShotNumber'>>(shots: T[], shotNumber: number, options?: NeighbourOptions<T>) =>
  neighbour(shots, shotNumber, 1, options);

/** Every shot before this one in screen order, nearest first. */
export const shotsBeforeInScreenOrder = <T extends Pick<ShotPrompt, 'shot' | 'sceneNumber' | 'sceneShotNumber'>>(shots: T[], shotNumber: number): T[] => {
  const ordered = screenOrder(shots);
  const index = ordered.findIndex((shot) => shot.shot === shotNumber);
  return index <= 0 ? [] : ordered.slice(0, index).reverse();
};

const ESTABLISHING = /\b(wide|establishing|master|full shot|long shot|extreme wide)\b/i;

/**
 * The scene's establishing / wide shot: it defines the geography (who stands, sits or kneels
 * where, where the crowd is) that every other shot of the scene has to agree with.
 */
export const establishingShotOf = <T extends Pick<ShotPrompt, 'shot' | 'sceneNumber' | 'sceneShotNumber' | 'description' | 'prompt' | 'shotTypePresetId'>>(
  shots: T[],
  shotNumber: number,
  where?: (shot: T) => boolean,
): T | null => {
  const current = shots.find((shot) => shot.shot === shotNumber);
  if (!current || !Number.isFinite(current.sceneNumber)) return null;
  return screenOrder(shots).find((shot) => shot.shot !== shotNumber
    && shot.sceneNumber === current.sceneNumber
    && (!where || where(shot))
    && ESTABLISHING.test([shot.shotTypePresetId, shot.description?.slice(0, 40), shot.prompt?.slice(0, 60)].filter(Boolean).join(' '))) || null;
};
