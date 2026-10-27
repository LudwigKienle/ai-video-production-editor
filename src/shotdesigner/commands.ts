/**
 * Every blocking action is a command (id, label, group, shortcut, parameters). The UI, keyboard
 * shortcuts and the MCP tools all call `runBlockingCommand`, so an agent can do exactly what a user
 * can do. Commands are pure: (host, params, time) → new host.
 */
import {
  aimAngles,
  cameraFovDeg,
  camerasAt,
  charactersAt,
  createCamera,
  createCharacter,
  eyeHeightM,
  finite,
  focalForHorizontalFov,
  makeStageId,
  normalizeKeyframe,
  normalizeStage,
  sampleTrack,
  sortKeys,
  wrapDeg,
  CAMERA_MOVES,
  SENSOR_PRESETS,
  SHOT_SIZES,
  MAX_DURATION_S,
  type StageCamera,
  type StageCharacter,
  type StageKeyframe,
  type StagePose,
  type StageState,
} from '../scene/stageModel.ts';
import {
  createPlanAsset,
  createWall,
  ensureHost,
  planElementOf,
  updatePlanAsset,
  PLAN_CATEGORIES,
  type PlanAsset,
  type StageHost,
} from './planModel.ts';
import { addShotVersion, moveShotInOrder, syncShots } from './shotList.ts';

export type ParamType = 'number' | 'string' | 'boolean' | 'array' | 'object';
export type ParamSpec = { type: ParamType; description: string; required?: boolean; enum?: readonly string[] };

export type CommandContext = { host: StageHost & { stage: StageState }; timeS: number };
export type CommandOutput = { host: StageHost; result?: Record<string, unknown>; select?: string[] };

export type BlockingCommand = {
  id: string;
  label: string;
  group: 'Grundriss' | 'Figur' | 'Kamera' | 'Objekt' | 'Zeit' | 'Shots' | 'Szene';
  shortcut?: string;
  description: string;
  params: Record<string, ParamSpec>;
  run: (ctx: CommandContext, p: Record<string, unknown>) => CommandOutput;
};

/** ok=true carries host and result; ok=false carries error. (Flat shape: the build runs without strict narrowing.) */
export type CommandResult = { ok: boolean; host?: StageHost; result?: Record<string, unknown>; select?: string[]; error?: string };

const num = (description: string, required = false): ParamSpec => ({ type: 'number', description, required });
const text = (description: string, required = false, values?: readonly string[]): ParamSpec => ({ type: 'string', description, required, enum: values });
const bool = (description: string): ParamSpec => ({ type: 'boolean', description });

const fail = (message: string): never => { throw new Error(message); };

// ── helpers ─────────────────────────────────────────────────────────────────

type Kind = 'camera' | 'character' | 'element';
const findObject = (host: StageHost & { stage: StageState }, id: unknown, prefer?: Kind): { kind: Kind; id: string } => {
  const key = typeof id === 'string' ? id : '';
  if (!key) fail('Objekt-ID fehlt.');
  if (host.stage.cameras.some((c) => c.id === key)) return { kind: 'camera', id: key };
  if (host.stage.characters.some((c) => c.id === key)) return { kind: 'character', id: key };
  if (host.assets.some((a) => a.id === key)) return { kind: 'element', id: key };
  // Friendly lookup by name for agents ("A", "Anna").
  const byName = (list: Array<{ id: string; name: string }>) => list.find((o) => o.name.toLowerCase() === key.toLowerCase());
  if (prefer === 'character') { const c = byName(host.stage.characters); if (c) return { kind: 'character', id: c.id }; }
  if (prefer === 'camera') { const c = byName(host.stage.cameras); if (c) return { kind: 'camera', id: c.id }; }
  const cam = byName(host.stage.cameras);
  const chr = byName(host.stage.characters);
  const asset = host.assets.find((a) => (a.name || '').toLowerCase() === key.toLowerCase());
  const hits = [cam && `Kamera ${cam.id}`, chr && `Figur ${chr.id}`, asset && `Element ${asset.id}`].filter(Boolean);
  if (hits.length > 1) fail(`„${key}“ ist mehrdeutig (${hits.join(', ')}) – bitte die ID angeben.`);
  if (cam) return { kind: 'camera', id: cam.id };
  if (chr) return { kind: 'character', id: chr.id };
  if (asset) return { kind: 'element', id: asset.id };
  return fail(`Kein Objekt mit ID oder Name „${key}“.`);
};

/** Current pose of any object at time t (animated if it has a track). */
export const poseAt = (host: StageHost & { stage: StageState }, id: string, t: number): StagePose | null => {
  const chr = charactersAt(host.stage, t).find((c) => c.id === id);
  if (chr) return { position: chr.position, yawDeg: chr.yawDeg };
  const cam = camerasAt(host.stage, t).find((c) => c.id === id);
  if (cam) return { position: cam.position, yawDeg: cam.yawDeg, pitchDeg: cam.pitchDeg, focalLengthMm: cam.focalLengthMm };
  const asset = host.assets.find((a) => a.id === id);
  if (!asset) return null;
  const keys = host.stage.animation.tracks[id];
  if (keys?.length) {
    const sampled = sampleTrack(keys, t);
    if (sampled) return { position: sampled.position, yawDeg: sampled.yawDeg };
  }
  return { position: { ...asset.position }, yawDeg: wrapDeg(asset.rotation?.y ?? 0) };
};

const withStage = (host: StageHost & { stage: StageState }, stage: StageState): StageHost & { stage: StageState } => ({ ...host, stage });

const setTrack = (stage: StageState, id: string, keys: StageKeyframe[]): StageState => {
  const tracks = { ...stage.animation.tracks };
  if (keys.length) tracks[id] = sortKeys(keys);
  else delete tracks[id];
  return { ...stage, animation: { ...stage.animation, tracks } };
};

const keyTolerance = (stage: StageState) => 0.5 / Math.max(1, stage.animation.fps);

/** Write a pose change: into the key at time t if the object is animated, else into its base pose. */
const applyPose = (
  host: StageHost & { stage: StageState },
  target: { kind: Kind; id: string },
  t: number,
  patch: Partial<{ x: number; y: number; z: number; yawDeg: number; pitchDeg: number; focalLengthMm: number }>,
): StageHost & { stage: StageState } => {
  const keys = host.stage.animation.tracks[target.id];
  if (keys && keys.length) {
    const current = poseAt(host, target.id, t);
    if (!current) return host;
    const tol = keyTolerance(host.stage);
    const existing = keys.find((k) => Math.abs(k.timeS - t) <= tol);
    const base: StageKeyframe = existing ?? { id: makeStageId('key'), timeS: t, position: current.position, yawDeg: current.yawDeg, pitchDeg: current.pitchDeg, focalLengthMm: current.focalLengthMm, easing: 'smooth' };
    const next: StageKeyframe = {
      ...base,
      position: { x: patch.x ?? base.position.x, y: patch.y ?? base.position.y, z: patch.z ?? base.position.z },
      yawDeg: patch.yawDeg !== undefined ? wrapDeg(patch.yawDeg) : base.yawDeg,
      pitchDeg: patch.pitchDeg ?? base.pitchDeg,
      focalLengthMm: patch.focalLengthMm ?? base.focalLengthMm,
    };
    const list = existing ? keys.map((k) => (k.id === existing.id ? next : k)) : [...keys, next];
    return withStage(host, setTrack(host.stage, target.id, list));
  }
  if (target.kind === 'camera') {
    return withStage(host, {
      ...host.stage,
      cameras: host.stage.cameras.map((c) => (c.id === target.id ? {
        ...c,
        position: { x: patch.x ?? c.position.x, y: patch.y ?? c.position.y, z: patch.z ?? c.position.z },
        yawDeg: patch.yawDeg !== undefined ? wrapDeg(patch.yawDeg) : c.yawDeg,
        pitchDeg: patch.pitchDeg !== undefined ? Math.max(-90, Math.min(90, patch.pitchDeg)) : c.pitchDeg,
        focalLengthMm: patch.focalLengthMm !== undefined ? Math.max(1, Math.min(2000, patch.focalLengthMm)) : c.focalLengthMm,
      } : c)),
    });
  }
  if (target.kind === 'character') {
    return withStage(host, {
      ...host.stage,
      characters: host.stage.characters.map((c) => (c.id === target.id ? {
        ...c,
        position: { x: patch.x ?? c.position.x, y: patch.y ?? c.position.y, z: patch.z ?? c.position.z },
        yawDeg: patch.yawDeg !== undefined ? wrapDeg(patch.yawDeg) : c.yawDeg,
      } : c)),
    });
  }
  return {
    ...host,
    assets: host.assets.map((a) => (a.id === target.id ? updatePlanAsset(a, { x: patch.x, z: patch.z, yawDeg: patch.yawDeg }) : a)),
  };
};

const ensureCameraName = (stage: StageState): string => {
  const used = new Set(stage.cameras.map((c) => c.name));
  for (let i = 0; i < 26 * 4; i += 1) {
    const name = i < 26 ? String.fromCharCode(65 + i) : `${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26) + 1}`;
    if (!used.has(name)) return name;
  }
  return `Cam ${stage.cameras.length + 1}`;
};

const addCameraTo = (stage: StageState, input: Partial<StageCamera>): { stage: StageState; camera: StageCamera } => {
  const camera = createCamera({ name: ensureCameraName(stage), ...input }, stage.cameras.length);
  const next = syncShots({ ...stage, cameras: [...stage.cameras, camera], activeCameraId: stage.activeCameraId ?? camera.id });
  return { stage: next, camera };
};

/** Camera that looks at `target` from `distance` metres, `bearingDeg` around it (0 = in front of the subject). */
export const cameraAround = (target: StageCharacter, bearingDeg: number, distance: number, focalLengthMm: number, heightM?: number): Partial<StageCamera> => {
  const facing = (target.yawDeg + bearingDeg) * (Math.PI / 180);
  const fx = -Math.sin(facing);
  const fz = -Math.cos(facing);
  const position = { x: target.position.x + fx * distance, y: heightM ?? Math.max(0.3, eyeHeightM(target) - 0.05), z: target.position.z + fz * distance };
  const aim = aimAngles(position, { x: target.position.x, y: eyeHeightM(target), z: target.position.z });
  return { position, yawDeg: aim.yawDeg, pitchDeg: Math.round(aim.pitchDeg * 10) / 10, focalLengthMm };
};

/**
 * Over-the-shoulder camera: behind `other`'s shoulder looking at `subject`, on the same side of the
 * subject–other line as `sideRef` (e.g. the master camera) so cutting stays on one side of the 180° line.
 */
export const otsCamera = (subject: StageCharacter, other: StageCharacter, focalLengthMm = 50, sideRef?: { x: number; z: number }): Partial<StageCamera> => {
  const dx = other.position.x - subject.position.x;
  const dz = other.position.z - subject.position.z;
  const len = Math.hypot(dx, dz) || 1;
  const ux = dx / len;
  const uz = dz / len;
  let px = -uz;
  let pz = ux;
  if (sideRef) {
    const cross = dx * (sideRef.z - subject.position.z) - dz * (sideRef.x - subject.position.x);
    const mine = dx * pz - dz * px;
    if (Math.sign(cross) !== 0 && Math.sign(cross) !== Math.sign(mine)) { px = -px; pz = -pz; }
  }
  // Back far enough that the foreground shoulder sits at the frame edge for this lens.
  const back = 1.2;
  const halfFov = (cameraFovDeg({ focalLengthMm, sensorWidthMm: 24.89, sensorHeightMm: 18.66, sensorFit: 'auto' }).horizontal / 2) * (Math.PI / 180);
  const lateral = Math.max(0.2, back * Math.tan(halfFov) * 0.9);
  const position = { x: other.position.x + ux * back + px * lateral, y: eyeHeightM(other) + 0.05, z: other.position.z + uz * back + pz * lateral };
  const aim = aimAngles(position, { x: subject.position.x, y: eyeHeightM(subject), z: subject.position.z });
  return { position, yawDeg: aim.yawDeg, pitchDeg: Math.round(aim.pitchDeg * 10) / 10, focalLengthMm };
};

// ── templates ───────────────────────────────────────────────────────────────

export const TEMPLATES: Array<{ id: string; label: string; description: string }> = [
  { id: 'dialog-two', label: 'Dialog zu zweit', description: 'Zwei Figuren gegenüber, Master plus zwei Over-Shoulder, 180°-Linie.' },
  { id: 'walk-talk', label: 'Walk & Talk', description: 'Zwei Figuren gehen nebeneinander, Kamera fährt rückwärts vor ihnen her.' },
  { id: 'table-three', label: 'Dreier am Tisch', description: 'Drei Figuren um einen Tisch, Master und drei Einzel.' },
  { id: 'interview', label: 'Interview', description: 'Eine Person, A-Kamera halbnah, B-Kamera seitlich lang.' },
];

const applyTemplate = (host: StageHost & { stage: StageState }, id: string, origin: { x: number; z: number }): StageHost & { stage: StageState } => {
  let stage = host.stage;
  let assets = host.assets;
  const addChr = (name: string, x: number, z: number, yawDeg: number, extra: Partial<StageCharacter> = {}) => {
    const chr = createCharacter({ name, position: { x: origin.x + x, y: 0, z: origin.z + z }, yawDeg, ...extra }, stage.characters.length);
    stage = { ...stage, characters: [...stage.characters, chr] };
    return chr;
  };
  const addCam = (input: Partial<StageCamera>) => {
    const out = addCameraTo(stage, input);
    stage = out.stage;
    return out.camera;
  };
  if (id === 'dialog-two') {
    const a = addChr('Anna', -0.9, 0, -90);
    const b = addChr('Ben', 0.9, 0, 90);
    const master = addCam({ ...cameraAround({ ...a, position: { x: origin.x, y: 0, z: origin.z }, yawDeg: 0 }, 180, 4.2, 28), name: 'A' });
    // Over-shoulder pair on the master's side of the line.
    addCam({ ...otsCamera(a, b, 50, master.position), name: 'B' });
    addCam({ ...otsCamera(b, a, 50, master.position), name: 'C' });
    stage = { ...stage, lineOfAction: { aId: a.id, bId: b.id } };
    assets = [...assets, createPlanAsset({ category: 'table', x: origin.x, z: origin.z - 0.9, w: 1.2, d: 0.6 })];
  } else if (id === 'walk-talk') {
    const a = addChr('Anna', -0.45, 3, 0);
    const b = addChr('Ben', 0.45, 3, 0);
    const d = Math.min(stage.animation.durationS, 8);
    for (const chr of [a, b]) {
      stage = setTrack(stage, chr.id, [
        normalizeKeyframe({ timeS: 0, position: chr.position, yawDeg: 0, easing: 'linear' }),
        normalizeKeyframe({ timeS: d, position: { ...chr.position, z: chr.position.z - 6 }, yawDeg: 0, easing: 'linear' }),
      ]);
    }
    const cam = addCam({ position: { x: origin.x, y: 1.55, z: origin.z + 0.6 }, yawDeg: 180, focalLengthMm: 35, name: 'A' });
    stage = setTrack(stage, cam.id, [
      normalizeKeyframe({ timeS: 0, position: cam.position, yawDeg: 180, easing: 'linear' }),
      normalizeKeyframe({ timeS: d, position: { ...cam.position, z: cam.position.z - 6 }, yawDeg: 180, easing: 'linear' }),
    ]);
    stage = { ...stage, lineOfAction: { aId: a.id, bId: b.id } };
    assets = [
      ...assets,
      createWall(origin.x - 1.6, origin.z + 4, origin.x - 1.6, origin.z - 4),
      createWall(origin.x + 1.6, origin.z + 4, origin.x + 1.6, origin.z - 4),
    ];
  } else if (id === 'table-three') {
    assets = [...assets, createPlanAsset({ category: 'table', x: origin.x, z: origin.z, w: 1.4, d: 1.4 })];
    const people = [
      addChr('Anna', 0, -1.05, 180, { posture: 'sitting' }),
      addChr('Ben', 1.0, 0.45, 60, { posture: 'sitting' }),
      addChr('Clara', -1.0, 0.45, -60, { posture: 'sitting' }),
    ];
    addCam({ position: { x: origin.x, y: 1.7, z: origin.z + 4.5 }, yawDeg: 0, pitchDeg: -12, focalLengthMm: 24, name: 'A' });
    people.forEach((p, i) => addCam({ ...cameraAround(p, 0, 1.9, 65), name: String.fromCharCode(66 + i) }));
  } else if (id === 'interview') {
    const p = addChr('Gast', 0, 0, 30, { posture: 'sitting' });
    addCam({ ...cameraAround(p, -30, 2.2, 50), name: 'A' });
    addCam({ ...cameraAround(p, 55, 3.2, 85), name: 'B' });
    assets = [...assets, createPlanAsset({ category: 'chair', x: origin.x, z: origin.z, yawDeg: 30 })];
  } else {
    fail(`Unbekannte Vorlage „${id}“.`);
  }
  return { ...host, assets, stage: syncShots(stage) };
};

// ── registry ────────────────────────────────────────────────────────────────

const pickNumber = (p: Record<string, unknown>, key: string, fallback?: number, min?: number, max?: number) =>
  p[key] === undefined || p[key] === null || p[key] === '' ? fallback : finite(p[key], fallback ?? 0, min, max);

export const BLOCKING_COMMANDS: BlockingCommand[] = [
  // Grundriss
  {
    id: 'plan.addElement', label: 'Element hinzufügen', group: 'Grundriss',
    description: 'Set-Element (Möbel, Tür, Fenster, Requisite) in den Grundriss setzen. Erscheint auch im 3D-Set-Design als Box.',
    params: { category: text('Elementart', true, PLAN_CATEGORIES), x: num('Mitte x in m', true), z: num('Mitte z in m', true), w: num('Breite in m'), d: num('Tiefe in m'), h: num('Höhe in m'), yawDeg: num('Drehung in Grad'), label: text('Bezeichnung') },
    run: ({ host }, p) => {
      const asset = createPlanAsset({ category: String(p.category), x: finite(p.x, 0), z: finite(p.z, 0), w: pickNumber(p, 'w'), d: pickNumber(p, 'd'), h: pickNumber(p, 'h'), yawDeg: pickNumber(p, 'yawDeg'), label: typeof p.label === 'string' ? p.label : undefined });
      return { host: { ...host, assets: [...host.assets, asset] }, result: { id: asset.id }, select: [asset.id] };
    },
  },
  {
    id: 'plan.addWall', label: 'Wand ziehen', group: 'Grundriss', shortcut: 'W',
    description: 'Wand von Punkt 1 nach Punkt 2 (Meter). Mehrere Segmente = mehrere Aufrufe.',
    params: { x1: num('Start x', true), z1: num('Start z', true), x2: num('Ende x', true), z2: num('Ende z', true), thickness: num('Wandstärke in m (0,15)'), height: num('Wandhöhe in m (2,6)') },
    run: ({ host }, p) => {
      const wall = createWall(finite(p.x1, 0), finite(p.z1, 0), finite(p.x2, 1), finite(p.z2, 0), finite(p.thickness, 0.15, 0.02, 2), finite(p.height, 2.6, 0.1, 20));
      return { host: { ...host, assets: [...host.assets, wall] }, result: { id: wall.id }, select: [wall.id] };
    },
  },
  {
    id: 'plan.addRoom', label: 'Raum anlegen', group: 'Grundriss',
    description: 'Rechteckiger Raum aus vier Wänden um einen Mittelpunkt.',
    params: { x: num('Mitte x'), z: num('Mitte z'), width: num('Breite in m', true), depth: num('Tiefe in m', true), height: num('Wandhöhe'), openSide: text('Offene Seite für die Kamera', false, ['none', 'south', 'north', 'east', 'west']) },
    run: ({ host }, p) => {
      const cx = finite(p.x, 0);
      const cz = finite(p.z, 0);
      const w = finite(p.width, 6, 0.5, 200) / 2;
      const d = finite(p.depth, 5, 0.5, 200) / 2;
      const h = finite(p.height, 2.6, 0.1, 20);
      const open = typeof p.openSide === 'string' ? p.openSide : 'south';
      const walls = [
        open !== 'north' ? createWall(cx - w, cz - d, cx + w, cz - d, 0.15, h) : null,
        open !== 'east' ? createWall(cx + w, cz - d, cx + w, cz + d, 0.15, h) : null,
        open !== 'south' ? createWall(cx + w, cz + d, cx - w, cz + d, 0.15, h) : null,
        open !== 'west' ? createWall(cx - w, cz + d, cx - w, cz - d, 0.15, h) : null,
      ].filter((x): x is PlanAsset => !!x);
      return { host: { ...host, assets: [...host.assets, ...walls] }, result: { ids: walls.map((w2) => w2.id) } };
    },
  },
  {
    id: 'plan.updateElement', label: 'Element ändern', group: 'Grundriss',
    description: 'Maße, Lage, Drehung oder Beschriftung eines Set-Elements ändern.',
    params: { id: text('Element-ID', true), x: num('x'), z: num('z'), w: num('Breite'), d: num('Tiefe'), h: num('Höhe'), yawDeg: num('Drehung'), label: text('Bezeichnung'), color: text('Farbe (#rrggbb)') },
    run: ({ host }, p) => {
      const id = String(p.id || '');
      if (!host.assets.some((a) => a.id === id)) fail(`Kein Element „${id}“.`);
      return {
        host: { ...host, assets: host.assets.map((a) => (a.id === id ? updatePlanAsset(a, { x: pickNumber(p, 'x'), z: pickNumber(p, 'z'), w: pickNumber(p, 'w', undefined, 0.01, 500), d: pickNumber(p, 'd', undefined, 0.01, 500), h: pickNumber(p, 'h', undefined, 0.005, 100), yawDeg: pickNumber(p, 'yawDeg'), label: typeof p.label === 'string' ? p.label : undefined, color: typeof p.color === 'string' ? p.color : undefined }) : a)) },
        result: { id },
      };
    },
  },
  {
    id: 'plan.setBackground', label: 'Hintergrundplan', group: 'Grundriss',
    description: 'Grundriss-Zeichnung als Hintergrund (Bild-URL oder data-URL) mit Maßstab in Meter pro Pixel. Leere URL entfernt ihn.',
    params: { url: text('Bild-URL'), mPerPx: num('Meter pro Bildpixel (z. B. 0,01)'), opacity: num('Deckkraft 0–1'), x: num('Versatz x'), z: num('Versatz z') },
    run: ({ host }, p) => {
      const plan = { ...(host.stage.plan || {}) };
      if (typeof p.url === 'string') plan.backgroundUrl = p.url || null;
      if (p.mPerPx !== undefined) plan.backgroundMPerPx = finite(p.mPerPx, 0.01, 1e-5, 100);
      if (p.opacity !== undefined) plan.backgroundOpacity = finite(p.opacity, 0.5, 0, 1);
      if (p.x !== undefined || p.z !== undefined) plan.backgroundOffset = { x: finite(p.x, plan.backgroundOffset?.x ?? 0), z: finite(p.z, plan.backgroundOffset?.z ?? 0) };
      return { host: withStage(host, { ...host.stage, plan }) };
    },
  },
  // Figur
  {
    id: 'character.add', label: 'Figur hinzufügen', group: 'Figur', shortcut: 'F',
    description: 'Figur in den Plan setzen. referenceId verknüpft eine Cast-Referenz des Projekts.',
    params: { name: text('Name'), x: num('x', true), z: num('z', true), yawDeg: num('Blickrichtung in Grad (0 = nach oben/Norden)'), heightM: num('Körpergröße in m'), posture: text('Haltung', false, ['standing', 'sitting', 'lying']), referenceId: text('Cast-Referenz-ID'), color: text('Farbe') },
    run: ({ host }, p) => {
      const chr = createCharacter({
        name: typeof p.name === 'string' && p.name ? p.name : undefined,
        position: { x: finite(p.x, 0), y: 0, z: finite(p.z, 0) },
        yawDeg: finite(p.yawDeg, 0),
        heightM: pickNumber(p, 'heightM', undefined, 0.3, 3),
        posture: p.posture as StageCharacter['posture'],
        referenceId: typeof p.referenceId === 'string' ? p.referenceId : undefined,
        color: typeof p.color === 'string' ? p.color : undefined,
      }, host.stage.characters.length);
      return { host: withStage(host, { ...host.stage, characters: [...host.stage.characters, chr] }), result: { id: chr.id, name: chr.name }, select: [chr.id] };
    },
  },
  {
    id: 'character.update', label: 'Figur ändern', group: 'Figur',
    description: 'Name, Größe, Haltung, Farbe oder Cast-Verknüpfung einer Figur ändern.',
    params: { id: text('Figur-ID oder Name', true), name: text('Name'), heightM: num('Körpergröße'), posture: text('Haltung', false, ['standing', 'sitting', 'lying']), referenceId: text('Cast-Referenz-ID'), color: text('Farbe') },
    run: ({ host }, p) => {
      const target = findObject(host, p.id, 'character');
      if (target.kind !== 'character') fail('Das Objekt ist keine Figur.');
      const characters = host.stage.characters.map((c) => (c.id === target.id ? {
        ...c,
        ...(typeof p.name === 'string' && p.name ? { name: p.name.slice(0, 120) } : {}),
        ...(p.heightM !== undefined ? { heightM: finite(p.heightM, c.heightM, 0.3, 3) } : {}),
        ...(typeof p.posture === 'string' && ['standing', 'sitting', 'lying'].includes(p.posture) ? { posture: p.posture as StageCharacter['posture'] } : {}),
        ...(typeof p.referenceId === 'string' ? { referenceId: p.referenceId || undefined } : {}),
        ...(typeof p.color === 'string' && p.color ? { color: p.color } : {}),
      } : c));
      return { host: withStage(host, { ...host.stage, characters }), result: { id: target.id } };
    },
  },
  // Kamera
  {
    id: 'camera.add', label: 'Kamera hinzufügen', group: 'Kamera', shortcut: 'C',
    description: 'Kamera setzen. Mit aimAt (Figur-ID/Name) richtet sie sich auf die Figur aus. Erscheint auch im 3D-Set-Design.',
    params: { x: num('x', true), z: num('z', true), yawDeg: num('Blickrichtung'), heightM: num('Objektivhöhe in m (1,6)'), pitchDeg: num('Neigung in Grad (+ = hoch)'), focalLengthMm: num('Brennweite in mm (35)'), name: text('Name, z. B. A'), aimAt: text('Auf Figur ausrichten (ID oder Name)'), follow: bool('Kamera schwenkt der Figur nach') },
    run: ({ host, timeS }, p) => {
      const position = { x: finite(p.x, 0), y: finite(p.heightM, 1.6, 0, 100), z: finite(p.z, 4) };
      let yawDeg = finite(p.yawDeg, 0);
      let pitchDeg = finite(p.pitchDeg, 0, -90, 90);
      let followId: string | null = null;
      if (typeof p.aimAt === 'string' && p.aimAt) {
        const target = findObject(host, p.aimAt, 'character');
        const chr = charactersAt(host.stage, timeS).find((c) => c.id === target.id);
        if (chr) {
          const aim = aimAngles(position, { x: chr.position.x, y: eyeHeightM(chr), z: chr.position.z });
          yawDeg = aim.yawDeg;
          if (p.pitchDeg === undefined) pitchDeg = Math.round(aim.pitchDeg * 10) / 10;
          if (p.follow === true) followId = chr.id;
        }
      }
      const out = addCameraTo(host.stage, {
        position, yawDeg, pitchDeg, followId,
        focalLengthMm: finite(p.focalLengthMm, 35, 1, 2000),
        ...(typeof p.name === 'string' && p.name ? { name: p.name.slice(0, 60) } : {}),
      });
      return { host: withStage(host, out.stage), result: { id: out.camera.id, name: out.camera.name }, select: [out.camera.id] };
    },
  },
  {
    id: 'camera.update', label: 'Kamera einstellen', group: 'Kamera',
    description: 'Brennweite, Höhe, Neigung, Sensor oder Name einer Kamera. Brennweite/Neigung werden bei animierter Kamera als Key zur aktuellen Zeit gesetzt (Zoom).',
    params: { id: text('Kamera-ID oder Name', true), focalLengthMm: num('Brennweite mm'), horizontalFovDeg: num('Alternativ: horizontaler Bildwinkel in Grad'), heightM: num('Objektivhöhe m'), pitchDeg: num('Neigung'), rollDeg: num('Rollen'), sensor: text('Sensor-Preset', false, SENSOR_PRESETS.map((s) => s.id)), name: text('Name'), color: text('Farbe') },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.id, 'camera');
      if (target.kind !== 'camera') fail('Das Objekt ist keine Kamera.');
      const cam = host.stage.cameras.find((c) => c.id === target.id) as StageCamera;
      const preset = SENSOR_PRESETS.find((s) => s.id === p.sensor);
      let focal = pickNumber(p, 'focalLengthMm', undefined, 1, 2000);
      if (focal === undefined && p.horizontalFovDeg !== undefined) focal = focalForHorizontalFov(finite(p.horizontalFovDeg, 40, 1, 179), preset?.widthMm ?? cam.sensorWidthMm);
      let next = withStage(host, {
        ...host.stage,
        cameras: host.stage.cameras.map((c) => (c.id === target.id ? {
          ...c,
          ...(preset ? { sensorWidthMm: preset.widthMm, sensorHeightMm: preset.heightMm } : {}),
          ...(typeof p.name === 'string' && p.name ? { name: p.name.slice(0, 60) } : {}),
          ...(typeof p.color === 'string' && p.color ? { color: p.color } : {}),
          ...(p.rollDeg !== undefined ? { rollDeg: wrapDeg(finite(p.rollDeg, 0)) } : {}),
        } : c)),
      });
      const posePatch: Record<string, number> = {};
      if (focal !== undefined) posePatch.focalLengthMm = focal;
      if (p.pitchDeg !== undefined) posePatch.pitchDeg = finite(p.pitchDeg, 0, -90, 90);
      if (p.heightM !== undefined) posePatch.y = finite(p.heightM, 1.6, 0, 100);
      if (Object.keys(posePatch).length) next = applyPose(next, target, timeS, posePatch);
      return { host: next, result: { id: target.id, focalLengthMm: focal ?? cam.focalLengthMm } };
    },
  },
  {
    id: 'camera.aimAt', label: 'Kamera ausrichten', group: 'Kamera', shortcut: 'L',
    description: 'Kamera auf eine Figur oder einen Punkt richten. follow=true: sie schwenkt der Figur über die Zeit nach.',
    params: { id: text('Kamera-ID oder Name', true), targetId: text('Figur-ID oder Name'), x: num('oder Zielpunkt x'), z: num('Zielpunkt z'), follow: bool('Nachführen') },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.id, 'camera');
      if (target.kind !== 'camera') fail('Das Objekt ist keine Kamera.');
      const cam = camerasAt(host.stage, timeS).find((c) => c.id === target.id) as StageCamera;
      let aimPoint: { x: number; y: number; z: number } | null = null;
      let followId: string | null | undefined;
      if (typeof p.targetId === 'string' && p.targetId) {
        const t2 = findObject(host, p.targetId, 'character');
        const chr = charactersAt(host.stage, timeS).find((c) => c.id === t2.id);
        if (chr) aimPoint = { x: chr.position.x, y: eyeHeightM(chr), z: chr.position.z };
        else {
          const pose = poseAt(host, t2.id, timeS);
          if (pose) aimPoint = { ...pose.position, y: 1 };
        }
        followId = p.follow === true && chr ? chr.id : p.follow === false ? null : undefined;
      } else if (p.x !== undefined && p.z !== undefined) {
        aimPoint = { x: finite(p.x, 0), y: 1.5, z: finite(p.z, 0) };
        followId = null;
      }
      if (!aimPoint) fail('Ziel fehlt (targetId oder x/z).');
      const aim = aimAngles(cam.position, aimPoint as { x: number; y: number; z: number });
      let next = applyPose(host, target, timeS, { yawDeg: aim.yawDeg, pitchDeg: Math.round(aim.pitchDeg * 10) / 10 });
      if (followId !== undefined) next = withStage(next, { ...next.stage, cameras: next.stage.cameras.map((c) => (c.id === target.id ? { ...c, followId } : c)) });
      return { host: next, result: { id: target.id, yawDeg: aim.yawDeg } };
    },
  },
  {
    id: 'camera.setActive', label: 'Aktive Kamera', group: 'Kamera',
    description: 'Kamera für Sucher, Storyboard und 3D-Kameraansicht wählen.',
    params: { id: text('Kamera-ID oder Name', true) },
    run: ({ host }, p) => {
      const target = findObject(host, p.id, 'camera');
      if (target.kind !== 'camera') fail('Das Objekt ist keine Kamera.');
      return { host: withStage(host, { ...host.stage, activeCameraId: target.id }), result: { id: target.id }, select: [target.id] };
    },
  },
  {
    id: 'camera.cover', label: 'Abdeckung erzeugen', group: 'Kamera',
    description: 'Kameras für eine Figur anlegen: single (frontal halbnah), ots (über die Schulter einer zweiten Figur), profile (seitlich).',
    params: { targetId: text('Figur-ID oder Name', true), pattern: text('Muster', true, ['single', 'ots', 'profile', 'closeup']), otherId: text('Zweite Figur für OTS'), focalLengthMm: num('Brennweite') },
    run: ({ host, timeS }, p) => {
      const chars = charactersAt(host.stage, timeS);
      const t = findObject(host, p.targetId, 'character');
      const chr = chars.find((c) => c.id === t.id);
      if (!chr) fail('Ziel ist keine Figur.');
      const subject = chr as StageCharacter;
      const pattern = String(p.pattern);
      let input: Partial<StageCamera>;
      if (pattern === 'ots') {
        const otherKey = p.otherId ? findObject(host, p.otherId, 'character').id : null;
        const other = chars.find((c) => c.id === otherKey) ?? chars.find((c) => c.id !== subject.id);
        if (!other) fail('Für OTS fehlt eine zweite Figur.');
        const ref = camerasAt(host.stage, timeS).find((c) => c.id === host.stage.activeCameraId) ?? camerasAt(host.stage, timeS)[0];
        input = otsCamera(subject, other as StageCharacter, finite(p.focalLengthMm, 50, 1, 2000), ref?.position);
      } else if (pattern === 'profile') {
        input = cameraAround(subject, 90, 2.6, finite(p.focalLengthMm, 50, 1, 2000));
      } else if (pattern === 'closeup') {
        input = cameraAround(subject, -15, 1.4, finite(p.focalLengthMm, 85, 1, 2000));
      } else {
        input = cameraAround(subject, -10, 2.2, finite(p.focalLengthMm, 50, 1, 2000));
      }
      const out = addCameraTo(host.stage, input);
      return { host: withStage(host, out.stage), result: { id: out.camera.id, name: out.camera.name }, select: [out.camera.id] };
    },
  },
  // Objekt (alle Arten)
  {
    id: 'object.move', label: 'Verschieben', group: 'Objekt', shortcut: 'G',
    description: 'Figur, Kamera oder Element verschieben. Ist das Objekt animiert, wird die Position zur aktuellen Zeit als Key gesetzt.',
    params: { id: text('Objekt-ID oder Name', true), x: num('x'), z: num('z'), dx: num('oder relativ dx'), dz: num('relativ dz'), timeS: num('Zeitpunkt (Standard: Playhead)') },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.id);
      const t = pickNumber(p, 'timeS', timeS, 0, host.stage.animation.durationS) as number;
      const pose = poseAt(host, target.id, t);
      if (!pose) fail('Objekt nicht gefunden.');
      const x = p.x !== undefined ? finite(p.x, 0) : (pose as StagePose).position.x + finite(p.dx, 0);
      const z = p.z !== undefined ? finite(p.z, 0) : (pose as StagePose).position.z + finite(p.dz, 0);
      return { host: applyPose(host, target, t, { x, z }), result: { id: target.id, x, z } };
    },
  },
  {
    id: 'object.rotate', label: 'Drehen', group: 'Objekt', shortcut: 'R',
    description: 'Blickrichtung/Drehung setzen (Grad, 0 = Norden/oben, positiv = gegen den Uhrzeigersinn) oder relativ um delta drehen.',
    params: { id: text('Objekt-ID oder Name', true), yawDeg: num('Absolute Richtung'), delta: num('Relative Drehung'), timeS: num('Zeitpunkt') },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.id);
      const t = pickNumber(p, 'timeS', timeS, 0, host.stage.animation.durationS) as number;
      const pose = poseAt(host, target.id, t);
      if (!pose) fail('Objekt nicht gefunden.');
      const yaw = p.yawDeg !== undefined ? finite(p.yawDeg, 0) : (pose as StagePose).yawDeg + finite(p.delta, 0);
      let next = applyPose(host, target, t, { yawDeg: yaw });
      // Turning a following camera by hand releases the follow.
      if (target.kind === 'camera') next = withStage(next, { ...next.stage, cameras: next.stage.cameras.map((c) => (c.id === target.id ? { ...c, followId: null } : c)) });
      return { host: next, result: { id: target.id, yawDeg: wrapDeg(yaw) } };
    },
  },
  {
    id: 'object.delete', label: 'Löschen', group: 'Objekt', shortcut: 'Entf',
    description: 'Objekt mit seiner Bewegungsspur löschen. Shots der Kamera verschwinden, außer sie sind abgelöst.',
    params: { id: text('Objekt-ID oder Name', true) },
    run: ({ host }, p) => {
      const target = findObject(host, p.id);
      let stage = setTrack(host.stage, target.id, []);
      stage = {
        ...stage,
        cameras: stage.cameras.filter((c) => c.id !== target.id).map((c) => (c.followId === target.id ? { ...c, followId: null } : c)),
        characters: stage.characters.filter((c) => c.id !== target.id),
        lineOfAction: stage.lineOfAction && (stage.lineOfAction.aId === target.id || stage.lineOfAction.bId === target.id) ? null : stage.lineOfAction,
      };
      if (stage.activeCameraId === target.id) stage.activeCameraId = stage.cameras[0]?.id ?? null;
      return { host: { ...host, assets: host.assets.filter((a) => a.id !== target.id), stage: syncShots(stage) }, result: { deleted: target.id }, select: [] };
    },
  },
  {
    id: 'object.duplicate', label: 'Duplizieren', group: 'Objekt', shortcut: 'Strg+D',
    description: 'Objekt um 1 m versetzt kopieren (ohne Bewegungsspur).',
    params: { id: text('Objekt-ID oder Name', true) },
    run: ({ host }, p) => {
      const target = findObject(host, p.id);
      if (target.kind === 'element') {
        const src = host.assets.find((a) => a.id === target.id) as PlanAsset;
        const copy: PlanAsset = { ...src, id: makeStageId(src.plan?.category || 'asset'), position: { ...src.position, x: src.position.x + 1, z: src.position.z + 1 } };
        return { host: { ...host, assets: [...host.assets, copy] }, result: { id: copy.id }, select: [copy.id] };
      }
      if (target.kind === 'character') {
        const src = host.stage.characters.find((c) => c.id === target.id) as StageCharacter;
        const copy = createCharacter({ ...src, id: undefined, name: `${src.name} 2`, position: { ...src.position, x: src.position.x + 1 } }, host.stage.characters.length);
        return { host: withStage(host, { ...host.stage, characters: [...host.stage.characters, copy] }), result: { id: copy.id }, select: [copy.id] };
      }
      const src = host.stage.cameras.find((c) => c.id === target.id) as StageCamera;
      const out = addCameraTo(host.stage, { ...src, id: undefined, name: undefined, followId: src.followId, position: { ...src.position, x: src.position.x + 1 } });
      return { host: withStage(host, out.stage), result: { id: out.camera.id }, select: [out.camera.id] };
    },
  },
  {
    id: 'object.setFlags', label: 'Sperren/Ausblenden', group: 'Objekt',
    description: 'Figur oder Kamera sperren (nicht verschiebbar) oder ausblenden.',
    params: { id: text('Objekt-ID oder Name', true), locked: bool('Gesperrt'), hidden: bool('Ausgeblendet') },
    run: ({ host }, p) => {
      const target = findObject(host, p.id);
      const patch = (o: { locked?: boolean; hidden?: boolean }) => ({ ...o, ...(typeof p.locked === 'boolean' ? { locked: p.locked } : {}), ...(typeof p.hidden === 'boolean' ? { hidden: p.hidden } : {}) });
      return {
        host: withStage(host, {
          ...host.stage,
          cameras: host.stage.cameras.map((c) => (c.id === target.id ? patch(c) as StageCamera : c)),
          characters: host.stage.characters.map((c) => (c.id === target.id ? patch(c) as StageCharacter : c)),
        }),
      };
    },
  },
  // Zeit
  {
    id: 'key.add', label: 'Position merken', group: 'Zeit', shortcut: 'K',
    description: 'Neue Bewegungsmarke (Keyframe) für ein Objekt zum Zeitpunkt timeS. Ohne x/z wird die aktuelle Lage übernommen. Ist die Spur leer, entsteht zusätzlich die Startmarke bei 0 s.',
    params: { id: text('Objekt-ID oder Name', true), timeS: num('Zeit in s (Standard: Playhead)'), x: num('x'), z: num('z'), yawDeg: num('Richtung'), pitchDeg: num('Kamera: Neigung'), focalLengthMm: num('Kamera: Brennweite (Zoom)'), easing: text('Übergang zur nächsten Marke', false, ['linear', 'smooth', 'hold']), label: text('Beschriftung') },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.id);
      const t = pickNumber(p, 'timeS', timeS, 0, host.stage.animation.durationS) as number;
      const current = poseAt(host, target.id, t) as StagePose;
      let keys = [...(host.stage.animation.tracks[target.id] || [])];
      if (keys.length === 0 && t > keyTolerance(host.stage)) {
        const start = poseAt(host, target.id, 0) as StagePose;
        keys.push(normalizeKeyframe({ timeS: 0, position: start.position, yawDeg: start.yawDeg, pitchDeg: start.pitchDeg, focalLengthMm: start.focalLengthMm, easing: 'smooth' }));
      }
      const key = normalizeKeyframe({
        timeS: t,
        position: { x: finite(p.x, current.position.x), y: current.position.y, z: finite(p.z, current.position.z) },
        yawDeg: finite(p.yawDeg, current.yawDeg),
        pitchDeg: p.pitchDeg !== undefined ? finite(p.pitchDeg, 0) : current.pitchDeg,
        focalLengthMm: p.focalLengthMm !== undefined ? finite(p.focalLengthMm, 35) : current.focalLengthMm,
        easing: p.easing,
        label: p.label,
      }, host.stage.animation.durationS);
      const tol = keyTolerance(host.stage);
      keys = keys.filter((k) => Math.abs(k.timeS - t) > tol);
      keys.push(key);
      return { host: withStage(host, setTrack(host.stage, target.id, keys)), result: { id: target.id, keyId: key.id, timeS: key.timeS } };
    },
  },
  {
    id: 'key.update', label: 'Marke ändern', group: 'Zeit',
    description: 'Zeit, Lage oder Übergang einer Bewegungsmarke ändern.',
    params: { id: text('Objekt-ID oder Name', true), keyId: text('Marken-ID', true), timeS: num('Neue Zeit'), x: num('x'), z: num('z'), yawDeg: num('Richtung'), pitchDeg: num('Neigung'), focalLengthMm: num('Brennweite'), easing: text('Übergang', false, ['linear', 'smooth', 'hold']) },
    run: ({ host }, p) => {
      const target = findObject(host, p.id);
      const keys = host.stage.animation.tracks[target.id] || [];
      const key = keys.find((k) => k.id === p.keyId);
      if (!key) fail('Marke nicht gefunden.');
      const k0 = key as StageKeyframe;
      const next = normalizeKeyframe({
        ...k0,
        timeS: p.timeS !== undefined ? finite(p.timeS, k0.timeS) : k0.timeS,
        position: { x: finite(p.x, k0.position.x), y: k0.position.y, z: finite(p.z, k0.position.z) },
        yawDeg: finite(p.yawDeg, k0.yawDeg),
        pitchDeg: p.pitchDeg !== undefined ? finite(p.pitchDeg, 0) : k0.pitchDeg,
        focalLengthMm: p.focalLengthMm !== undefined ? finite(p.focalLengthMm, 35) : k0.focalLengthMm,
        easing: p.easing ?? k0.easing,
      }, host.stage.animation.durationS);
      return { host: withStage(host, setTrack(host.stage, target.id, keys.map((k) => (k.id === k0.id ? next : k)))), result: { keyId: next.id, timeS: next.timeS } };
    },
  },
  {
    id: 'key.delete', label: 'Marke löschen', group: 'Zeit',
    description: 'Eine Bewegungsmarke löschen. Bleibt nur eine übrig, wird die Spur aufgelöst und die Lage zur Grundposition.',
    params: { id: text('Objekt-ID oder Name', true), keyId: text('Marken-ID', true) },
    run: ({ host }, p) => {
      const target = findObject(host, p.id);
      const keys = (host.stage.animation.tracks[target.id] || []).filter((k) => k.id !== p.keyId);
      let next = withStage(host, setTrack(host.stage, target.id, keys.length > 1 ? keys : []));
      if (keys.length === 1) next = applyPose(next, target, 0, { x: keys[0].position.x, z: keys[0].position.z, yawDeg: keys[0].yawDeg, ...(keys[0].focalLengthMm ? { focalLengthMm: keys[0].focalLengthMm } : {}) });
      return { host: next };
    },
  },
  {
    id: 'track.clear', label: 'Bewegung entfernen', group: 'Zeit',
    description: 'Alle Bewegungsmarken eines Objekts löschen; es bleibt an seiner Lage zur aktuellen Zeit stehen.',
    params: { id: text('Objekt-ID oder Name', true) },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.id);
      const pose = poseAt(host, target.id, timeS) as StagePose;
      let next = withStage(host, setTrack(host.stage, target.id, []));
      next = applyPose(next, target, timeS, { x: pose.position.x, z: pose.position.z, yawDeg: pose.yawDeg, ...(pose.focalLengthMm ? { focalLengthMm: pose.focalLengthMm } : {}) });
      return { host: next };
    },
  },
  {
    id: 'track.retime', label: 'Tempo ändern', group: 'Zeit',
    description: 'Bewegung schneller/langsamer: alle Marken eines Objekts (oder aller, ohne id) ab der ersten Marke mit factor strecken (0,5 = doppelt so schnell).',
    params: { id: text('Objekt-ID oder Name (leer = alle)'), factor: num('Zeitfaktor', true) },
    run: ({ host }, p) => {
      const factor = finite(p.factor, 1, 0.05, 20);
      const ids = p.id ? [findObject(host, p.id).id] : Object.keys(host.stage.animation.tracks);
      let stage = host.stage;
      let maxT = stage.animation.durationS;
      for (const id of ids) {
        const keys = stage.animation.tracks[id];
        if (!keys?.length) continue;
        const t0 = keys[0].timeS;
        const scaled = keys.map((k) => ({ ...k, timeS: Math.min(MAX_DURATION_S, t0 + (k.timeS - t0) * factor) }));
        maxT = Math.max(maxT, scaled[scaled.length - 1].timeS);
        stage = setTrack(stage, id, scaled);
      }
      stage = { ...stage, animation: { ...stage.animation, durationS: Math.min(MAX_DURATION_S, maxT) } };
      return { host: withStage(host, syncShots(stage)) };
    },
  },
  {
    id: 'anim.setDuration', label: 'Szenenlänge', group: 'Zeit',
    description: 'Länge der Szene in Sekunden (und optional fps).',
    params: { durationS: num('Länge in s', true), fps: num('Bilder pro Sekunde') },
    run: ({ host }, p) => {
      const durationS = finite(p.durationS, 10, 0.5, MAX_DURATION_S);
      const fps = Math.round(finite(p.fps, host.stage.animation.fps, 1, 240));
      return { host: withStage(host, syncShots({ ...host.stage, animation: { ...host.stage.animation, durationS, fps } })) };
    },
  },
  // Shots
  {
    id: 'shot.add', label: 'Shot-Version anlegen', group: 'Shots', shortcut: 'S',
    description: 'Weitere Version (1B, 1C …) einer Kamera für einen Zeitbereich der Szene.',
    params: { cameraId: text('Kamera-ID oder Name', true), startS: num('Beginn in s'), endS: num('Ende in s'), description: text('Beschreibung') },
    run: ({ host, timeS }, p) => {
      const target = findObject(host, p.cameraId, 'camera');
      if (target.kind !== 'camera') fail('Das Objekt ist keine Kamera.');
      const out = addShotVersion(host.stage, target.id, finite(p.startS, timeS, 0), pickNumber(p, 'endS'));
      if (!out.shot) fail('Shot konnte nicht angelegt werden.');
      let stage = out.stage;
      if (typeof p.description === 'string') stage = { ...stage, shots: stage.shots.map((s) => (s.id === out.shot?.id ? { ...s, description: String(p.description) } : s)) };
      return { host: withStage(host, stage), result: { id: out.shot?.id, code: `${out.shot?.number}${out.shot?.version}` } };
    },
  },
  {
    id: 'shot.update', label: 'Shot bearbeiten', group: 'Shots',
    description: 'Beschreibung, Zeitbereich, Einstellungsgröße, Bewegung, Objektiv, Requisiten, Technik, Crew oder Notizen eines Shots. null/leer setzt Überschreibungen zurück.',
    params: {
      id: text('Shot-ID oder Code wie 2B', true), description: text('Beschreibung'), startS: num('Beginn'), endS: num('Ende'),
      size: text('Einstellungsgröße', false, [...SHOT_SIZES, 'auto']), move: text('Bewegung', false, [...CAMERA_MOVES, 'auto']), lensMm: num('Objektiv mm (0 = von Kamera)'),
      props: text('Requisiten'), gear: text('Technik/Gerät'), crew: text('Crew'), notes: text('Notizen'),
    },
    run: ({ host }, p) => {
      const shot = findShot(host.stage, p.id);
      const patch: Record<string, unknown> = {};
      for (const key of ['description', 'props', 'gear', 'crew', 'notes'] as const) if (typeof p[key] === 'string') patch[key] = (p[key] as string).slice(0, 4000);
      if (p.startS !== undefined) patch.startS = finite(p.startS, shot.startS, 0, host.stage.animation.durationS);
      if (p.endS !== undefined) patch.endS = finite(p.endS, shot.endS, 0, host.stage.animation.durationS);
      if (typeof p.size === 'string') patch.sizeOverride = p.size === 'auto' ? null : (SHOT_SIZES as readonly string[]).includes(p.size) ? p.size : shot.sizeOverride;
      if (typeof p.move === 'string') patch.moveOverride = p.move === 'auto' ? null : (CAMERA_MOVES as readonly string[]).includes(p.move) ? p.move : shot.moveOverride;
      if (p.lensMm !== undefined) patch.lensOverrideMm = finite(p.lensMm, 0) > 0 ? finite(p.lensMm, 35, 1, 2000) : null;
      const shots = host.stage.shots.map((s) => (s.id === shot.id ? { ...s, ...patch } : s));
      return { host: withStage(host, syncShots({ ...host.stage, shots })), result: { id: shot.id } };
    },
  },
  {
    id: 'shot.delete', label: 'Shot löschen', group: 'Shots',
    description: 'Shot entfernen. Hat die Kamera danach keinen Shot mehr, entsteht wieder ein Standard-Shot – ablösen oder Kamera löschen, um das zu vermeiden.',
    params: { id: text('Shot-ID oder Code', true) },
    run: ({ host }, p) => {
      const shot = findShot(host.stage, p.id);
      return { host: withStage(host, syncShots({ ...host.stage, shots: host.stage.shots.filter((s) => s.id !== shot.id) })) };
    },
  },
  {
    id: 'shot.reorder', label: 'Drehreihenfolge', group: 'Shots',
    description: 'Shot in der Drehreihenfolge an Position toIndex (0-basiert) schieben.',
    params: { id: text('Shot-ID oder Code', true), toIndex: num('Neue Position (0 = zuerst)', true) },
    run: ({ host }, p) => {
      const shot = findShot(host.stage, p.id);
      return { host: withStage(host, moveShotInOrder(host.stage, shot.id, finite(p.toIndex, 0, 0, 9999))) };
    },
  },
  {
    id: 'shot.detach', label: 'Shot ablösen', group: 'Shots',
    description: 'Abgelöste Shots bleiben bestehen, wenn ihre Kamera gelöscht wird (wie ein fertiges Storyboard-Panel).',
    params: { id: text('Shot-ID oder Code', true), detached: bool('Abgelöst') },
    run: ({ host }, p) => {
      const shot = findShot(host.stage, p.id);
      const detached = p.detached === undefined ? !shot.detached : p.detached === true;
      return { host: withStage(host, { ...host.stage, shots: host.stage.shots.map((s) => (s.id === shot.id ? { ...s, detached } : s)) }) };
    },
  },
  {
    id: 'shot.link', label: 'Mit Storyboard verknüpfen', group: 'Shots',
    description: 'Shot mit einem Storyboard-Shot (Nummer) verknüpfen oder Bild-Frame setzen. storyboardShot 0 löst die Verknüpfung.',
    params: { id: text('Shot-ID oder Code', true), storyboardShot: num('Storyboard-Shot-Nummer'), frameUrl: text('Frame-Bild-URL') },
    run: ({ host }, p) => {
      const shot = findShot(host.stage, p.id);
      const patch: Record<string, unknown> = {};
      if (p.storyboardShot !== undefined) patch.storyboardShot = finite(p.storyboardShot, 0) > 0 ? Math.round(finite(p.storyboardShot, 1, 1, 99999)) : null;
      if (typeof p.frameUrl === 'string') patch.frameUrl = p.frameUrl || null;
      return { host: withStage(host, { ...host.stage, shots: host.stage.shots.map((s) => (s.id === shot.id ? { ...s, ...patch } : s)) }), result: { id: shot.id } };
    },
  },
  // Szene
  {
    id: 'scene.setLineOfAction', label: '180°-Linie', group: 'Szene',
    description: 'Handlungsachse zwischen zwei Figuren setzen (oder ohne Parameter entfernen). Shots, die sie überspringen, werden markiert.',
    params: { aId: text('Figur 1'), bId: text('Figur 2') },
    run: ({ host }, p) => {
      if (!p.aId || !p.bId) return { host: withStage(host, { ...host.stage, lineOfAction: null }) };
      const a = findObject(host, p.aId, 'character');
      const b = findObject(host, p.bId, 'character');
      if (a.kind !== 'character' || b.kind !== 'character' || a.id === b.id) fail('Die 180°-Linie braucht zwei verschiedene Figuren.');
      return { host: withStage(host, { ...host.stage, lineOfAction: { aId: a.id, bId: b.id } }) };
    },
  },
  {
    id: 'scene.applyTemplate', label: 'Vorlage einsetzen', group: 'Szene',
    description: 'Fertige Auflösung einsetzen: dialog-two, walk-talk, table-three, interview.',
    params: { templateId: text('Vorlage', true, TEMPLATES.map((t) => t.id)), x: num('Mitte x'), z: num('Mitte z') },
    run: ({ host }, p) => ({ host: applyTemplate(host, String(p.templateId), { x: finite(p.x, 0), z: finite(p.z, 0) }) }),
  },
  {
    id: 'scene.freeze', label: 'Stand einfrieren', group: 'Szene',
    description: 'Momentaufnahme der ganzen Szene speichern, um später dorthin zurückzukehren.',
    params: { name: text('Name des Stands') },
    run: ({ host }, p) => {
      const { stage, ...rest } = host;
      const data = JSON.stringify({ assets: rest.assets, stage: { ...stage, snapshots: [] } });
      const snap = { id: makeStageId('snap'), name: typeof p.name === 'string' && p.name ? p.name.slice(0, 120) : `Stand ${(stage.snapshots?.length || 0) + 1}`, createdAt: new Date().toISOString(), data };
      return { host: withStage(host, { ...stage, snapshots: [...(stage.snapshots || []), snap].slice(-50) }), result: { id: snap.id, name: snap.name } };
    },
  },
  {
    id: 'scene.restore', label: 'Stand wiederherstellen', group: 'Szene',
    description: 'Eingefrorenen Stand zurückholen (Rückgängig bleibt möglich).',
    params: { id: text('Stand-ID oder Name', true) },
    run: ({ host }, p) => {
      const snap = (host.stage.snapshots || []).find((s) => s.id === p.id || s.name === p.id);
      if (!snap) fail('Stand nicht gefunden.');
      let parsed: { assets?: PlanAsset[]; stage?: unknown } = {};
      try { parsed = JSON.parse((snap as { data: string }).data); } catch { fail('Stand ist beschädigt.'); }
      const restored = normalizeStage(parsed.stage);
      return { host: { ...host, assets: Array.isArray(parsed.assets) ? parsed.assets : host.assets, stage: { ...restored, snapshots: host.stage.snapshots } } };
    },
  },
  {
    id: 'scene.setAspect', label: 'Bildformat', group: 'Szene',
    description: 'Seitenverhältnis des Ausgabebildes (z. B. 1.7778, 2.39, 0.5625) für Sichtkegel, Sucher und Shot-Größen.',
    params: { aspectRatio: num('Breite/Höhe', true) },
    run: ({ host }, p) => ({ host: withStage(host, { ...host.stage, aspectRatio: finite(p.aspectRatio, 16 / 9, 0.2, 5) }) }),
  },
];

const findShot = (stage: StageState, key: unknown) => {
  const k = typeof key === 'string' ? key.trim() : '';
  const shot = stage.shots.find((s) => s.id === k) ?? stage.shots.find((s) => `${s.number}${s.version}`.toUpperCase() === k.toUpperCase());
  if (!shot) fail(`Kein Shot „${k}“.`);
  return shot as NonNullable<typeof shot>;
};

export const commandById = (id: string) => BLOCKING_COMMANDS.find((c) => c.id === id);

const coerce = (spec: ParamSpec, value: unknown): unknown => {
  if (value === undefined || value === null) return value;
  if (spec.type === 'number') return typeof value === 'number' || typeof value === 'string' ? value : undefined;
  if (spec.type === 'boolean') return value === true || value === 'true' ? true : value === false || value === 'false' ? false : undefined;
  if (spec.type === 'string') return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : undefined;
  return value;
};

/** Run one command. Never throws: errors come back as { ok: false }. */
export const runBlockingCommand = (
  raw: StageHost | null | undefined,
  id: string,
  params: Record<string, unknown> = {},
  timeS = 0,
): CommandResult => {
  const command = commandById(id);
  if (!command) return { ok: false, error: `Unbekannter Befehl „${id}“. blocking_list_commands zeigt alle.` };
  try {
    const host = ensureHost(raw);
    const p: Record<string, unknown> = {};
    for (const [key, spec] of Object.entries(command.params)) {
      const value = coerce(spec, params?.[key]);
      if (spec.required && (value === undefined || value === null || value === '')) return { ok: false, error: `${command.label}: Parameter „${key}“ fehlt.` };
      if (value !== undefined) p[key] = value;
    }
    const t = finite(timeS, 0, 0, host.stage.animation.durationS);
    const out = command.run({ host, timeS: t }, p);
    return { ok: true, host: out.host, result: out.result || {}, select: out.select };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
};

/** Several commands as one step (one undo entry); stops at the first error. */
export const runBlockingBatch = (
  raw: StageHost | null | undefined,
  commands: Array<{ command: string; params?: Record<string, unknown> }>,
  timeS = 0,
): CommandResult & { results?: Array<Record<string, unknown>> } => {
  let host: StageHost = ensureHost(raw);
  const results: Array<Record<string, unknown>> = [];
  let select: string[] | undefined;
  for (const [i, step] of (Array.isArray(commands) ? commands : []).slice(0, 200).entries()) {
    const out = runBlockingCommand(host, String(step?.command || ''), step?.params || {}, timeS);
    if (!out.ok) return { ok: false, error: `Schritt ${i + 1} (${step?.command}): ${out.error}` };
    host = out.host as StageHost;
    results.push(out.result || {});
    select = out.select ?? select;
  }
  return { ok: true, host, result: { steps: results.length }, results, select };
};

/** JSON schema for one command's parameters (MCP). */
export const commandJsonSchema = (command: BlockingCommand) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(command.params).map(([key, spec]) => [key, { type: spec.type, description: spec.description, ...(spec.enum ? { enum: spec.enum } : {}) }])),
  required: Object.entries(command.params).filter(([, spec]) => spec.required).map(([key]) => key),
});

export const describeCommands = () => BLOCKING_COMMANDS.map((c) => ({
  id: c.id, label: c.label, group: c.group, shortcut: c.shortcut, description: c.description, params: commandJsonSchema(c),
}));
