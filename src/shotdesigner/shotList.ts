/**
 * Shot list derived live from the cameras in the plan. Each camera is a setup (1, 2, 3 …); extra
 * shots from the same camera are versions (1A, 1B …). Users can add descriptions and data, change
 * the shooting order and detach shots so they survive camera changes.
 */
import { makeStageId, type StageShot, type StageState } from '../scene/stageModel.ts';
import { shotCode, shotFacts, type ShotFacts } from './shotGeometry.ts';

const letter = (i: number) => {
  let n = Math.max(0, Math.floor(i));
  let out = '';
  do {
    out = String.fromCharCode(65 + (n % 26)) + out;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0 && out.length < 3);
  return out;
};

export const versionIndex = (version: string): number => {
  let n = 0;
  for (const ch of version.toUpperCase()) {
    const c = ch.charCodeAt(0) - 64;
    if (c < 1 || c > 26) return 0;
    n = n * 26 + c;
  }
  return Math.max(0, n - 1);
};

/** Shots ordered by shooting order. */
export const orderedShots = (stage: StageState): StageShot[] => [...stage.shots].sort((a, b) => a.shootOrder - b.shootOrder || a.number - b.number || versionIndex(a.version) - versionIndex(b.version));

/** Shots ordered by setup number then version (script/edit order). */
export const shotsBySetup = (stage: StageState): StageShot[] => [...stage.shots].sort((a, b) => a.number - b.number || versionIndex(a.version) - versionIndex(b.version));

/**
 * Bring the shot list in line with the cameras: every camera has at least one shot, shots of deleted
 * cameras disappear unless detached, setup numbers follow camera order and shooting order is 1..n.
 */
export const syncShots = (stage: StageState): StageState => {
  const camIndex = new Map(stage.cameras.map((c, i) => [c.id, i]));
  const duration = stage.animation.durationS;
  let shots = stage.shots.filter((s) => s.detached || camIndex.has(s.cameraId));
  shots = shots.map((s) => {
    const idx = camIndex.get(s.cameraId);
    const endS = Math.min(Math.max(s.endS, s.startS), duration);
    return { ...s, number: s.detached || idx === undefined ? s.number : idx + 1, startS: Math.min(s.startS, duration), endS };
  });
  let maxOrder = shots.reduce((m, s) => Math.max(m, s.shootOrder), 0);
  for (const cam of stage.cameras) {
    if (shots.some((s) => s.cameraId === cam.id)) continue;
    maxOrder += 1;
    shots.push({ id: makeStageId('shot'), cameraId: cam.id, number: (camIndex.get(cam.id) ?? 0) + 1, version: 'A', startS: 0, endS: duration, shootOrder: maxOrder });
  }
  // Unique versions per setup, stable by previous version.
  const bySetup = new Map<number, StageShot[]>();
  for (const s of shots) bySetup.set(s.number, [...(bySetup.get(s.number) || []), s]);
  const fixed = new Map<string, string>();
  for (const list of bySetup.values()) {
    const seen = new Set<string>();
    let next = 0;
    for (const s of [...list].sort((a, b) => versionIndex(a.version) - versionIndex(b.version))) {
      let v = s.version;
      if (seen.has(v)) {
        while (seen.has(letter(next))) next += 1;
        v = letter(next);
      }
      seen.add(v);
      fixed.set(s.id, v);
    }
  }
  shots = shots.map((s) => ({ ...s, version: fixed.get(s.id) ?? s.version }));
  const order = [...shots].sort((a, b) => a.shootOrder - b.shootOrder || a.number - b.number);
  const orderMap = new Map(order.map((s, i) => [s.id, i + 1]));
  shots = shots.map((s) => ({ ...s, shootOrder: orderMap.get(s.id) ?? s.shootOrder }));
  return { ...stage, shots };
};

/** New version (next letter) of a camera's setup, covering the given time range. */
export const addShotVersion = (stage: StageState, cameraId: string, startS = 0, endS?: number): { stage: StageState; shot: StageShot | null } => {
  const camIdx = stage.cameras.findIndex((c) => c.id === cameraId);
  if (camIdx < 0) return { stage, shot: null };
  const existing = stage.shots.filter((s) => s.cameraId === cameraId);
  const used = new Set(existing.map((s) => s.version));
  let i = 0;
  while (used.has(letter(i))) i += 1;
  const duration = stage.animation.durationS;
  const start = Math.max(0, Math.min(startS, duration));
  const shot: StageShot = {
    id: makeStageId('shot'),
    cameraId,
    number: camIdx + 1,
    version: letter(i),
    startS: start,
    endS: Math.max(start, Math.min(endS ?? duration, duration)),
    shootOrder: stage.shots.length + 1,
  };
  return { stage: syncShots({ ...stage, shots: [...stage.shots, shot] }), shot };
};

/** Move a shot to a new 0-based position in the shooting order. */
export const moveShotInOrder = (stage: StageState, shotId: string, toIndex: number): StageState => {
  const order = orderedShots(stage);
  const from = order.findIndex((s) => s.id === shotId);
  if (from < 0) return stage;
  const [item] = order.splice(from, 1);
  const to = Math.max(0, Math.min(order.length, Math.round(toIndex)));
  order.splice(to, 0, item);
  const pos = new Map(order.map((s, i) => [s.id, i + 1]));
  return { ...stage, shots: stage.shots.map((s) => ({ ...s, shootOrder: pos.get(s.id) ?? s.shootOrder })) };
};

export type ShotRow = ShotFacts & {
  id: string;
  cameraId: string;
  shootOrder: number;
  startS: number;
  endS: number;
  description: string;
  props: string;
  gear: string;
  crew: string;
  notes: string;
  storyboardShot: number | null;
  frameUrl: string | null;
  detached: boolean;
};

export const shotRows = (stage: StageState, order: 'shoot' | 'setup' = 'shoot'): ShotRow[] =>
  (order === 'shoot' ? orderedShots(stage) : shotsBySetup(stage)).map((shot) => {
    const facts = shotFacts(stage, shot);
    return {
      ...facts,
      id: shot.id,
      cameraId: shot.cameraId,
      shootOrder: shot.shootOrder,
      startS: shot.startS,
      endS: shot.endS,
      description: shot.description || facts.autoDescription,
      props: shot.props || '',
      gear: shot.gear || '',
      crew: shot.crew || '',
      notes: shot.notes || '',
      storyboardShot: shot.storyboardShot ?? null,
      frameUrl: shot.frameUrl ?? null,
      detached: !!shot.detached,
    };
  });

export { shotCode };
