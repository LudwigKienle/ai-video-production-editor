/**
 * Shared stage model for 2D blocking (Shot Designer–style floor plan) and 3D set design.
 *
 * One source of truth: `SetDesignState.stage`. Units are metres, Y-up (three.js), the floor is the
 * XZ plane. Angles are degrees. `yawDeg` rotates about +Y; yaw 0 looks down -Z, positive yaw turns
 * counter-clockwise seen from above (three.js `rotation.y`). In the floor plan, screen x = world x and
 * screen y = world z, so yaw 0 points up the page.
 *
 * Everything here is pure and defensive: inputs from files, agents or old projects are treated as
 * hostile and normalised instead of trusted.
 */

export type StageVec3 = { x: number; y: number; z: number };

export type StageSensorFit = 'auto' | 'horizontal' | 'vertical';

export type StageCamera = {
  id: string;
  /** Display name, e.g. "A" or "Cam 1". */
  name: string;
  /** Lens position. y = lens height above the floor. */
  position: StageVec3;
  yawDeg: number;
  /** Positive pitch tilts up. */
  pitchDeg: number;
  rollDeg: number;
  focalLengthMm: number;
  sensorWidthMm: number;
  sensorHeightMm: number;
  sensorFit: StageSensorFit;
  shiftX?: number;
  shiftY?: number;
  clipStartM?: number;
  clipEndM?: number;
  focusDistanceM?: number;
  fStop?: number;
  color?: string;
  hidden?: boolean;
  locked?: boolean;
  /** Character id the camera keeps aimed at while it or the character moves (pan follows). */
  followId?: string | null;
};

export type StagePosture = 'standing' | 'sitting' | 'lying';

export type StageCharacter = {
  id: string;
  name: string;
  /** Linked cast reference (ReferenceItem.id). */
  referenceId?: string;
  /** Feet position, y = floor height (normally 0). */
  position: StageVec3;
  yawDeg: number;
  /** Body height in metres. */
  heightM: number;
  posture?: StagePosture;
  color?: string;
  hidden?: boolean;
  locked?: boolean;
};

export type StageEasing = 'linear' | 'smooth' | 'hold';

export type StageKeyframe = {
  id: string;
  timeS: number;
  position: StageVec3;
  yawDeg: number;
  pitchDeg?: number;
  focalLengthMm?: number;
  /** How the segment that starts at this key moves to the next key. */
  easing?: StageEasing;
  label?: string;
};

export type StageAnimation = {
  durationS: number;
  fps: number;
  /** One track per object id (camera, character or SetDesignAsset). */
  tracks: Record<string, StageKeyframe[]>;
};

export type StageShotSize = 'EWS' | 'WS' | 'FS' | 'MLS' | 'MS' | 'MCU' | 'CU' | 'ECU';
export type StageCameraMove = 'static' | 'pan' | 'tilt' | 'zoom' | 'dolly' | 'track' | 'crane' | 'handheld';

export type StageShot = {
  id: string;
  cameraId: string;
  /** Setup number (1, 2, 3 …) – one per camera by default. */
  number: number;
  /** Version letter within the setup: A, B, C … */
  version: string;
  startS: number;
  endS: number;
  description?: string;
  /** Manual overrides; empty means "derived from the plan". */
  sizeOverride?: StageShotSize | null;
  moveOverride?: StageCameraMove | null;
  lensOverrideMm?: number | null;
  subjectIds?: string[] | null;
  props?: string;
  gear?: string;
  crew?: string;
  notes?: string;
  /** Position in the shooting order (1-based). */
  shootOrder: number;
  /** Linked storyboard shot (ShotPrompt.shot). */
  storyboardShot?: number | null;
  /** Storyboard frame shown next to the camera in the plan. */
  frameUrl?: string | null;
  /** Detached shots survive when their camera is deleted and are not re-derived. */
  detached?: boolean;
};

export type StageLineOfAction = { aId: string; bId: string };

export type StagePlanInfo = {
  backgroundUrl?: string | null;
  /** Metres per background image pixel. */
  backgroundMPerPx?: number;
  backgroundOffset?: { x: number; z: number };
  backgroundOpacity?: number;
  pageName?: string;
};

export type StageSnapshot = { id: string; name: string; createdAt: string; data: string };

export type StageState = {
  version: 1;
  cameras: StageCamera[];
  activeCameraId?: string | null;
  characters: StageCharacter[];
  animation: StageAnimation;
  shots: StageShot[];
  lineOfAction?: StageLineOfAction | null;
  plan?: StagePlanInfo;
  /** "Freeze" snapshots of the whole set design to return to while experimenting. */
  snapshots?: StageSnapshot[];
  aspectRatio?: number;
};

export const SENSOR_PRESETS: Array<{ id: string; label: string; widthMm: number; heightMm: number }> = [
  { id: 'super35', label: 'Super 35', widthMm: 24.89, heightMm: 18.66 },
  { id: 'fullframe', label: 'Vollformat', widthMm: 36, heightMm: 24 },
  { id: 'alexa-lf', label: 'Large Format (LF)', widthMm: 36.7, heightMm: 25.54 },
  { id: 'aps-c', label: 'APS-C', widthMm: 23.6, heightMm: 15.6 },
  { id: 'mft', label: 'Micro Four Thirds', widthMm: 17.3, heightMm: 13 },
  { id: 's16', label: 'Super 16', widthMm: 12.52, heightMm: 7.41 },
];

export const LENS_PRESETS_MM = [12, 14, 18, 21, 25, 28, 32, 35, 40, 50, 65, 75, 85, 100, 135, 200];

export const DEFAULT_CAMERA_HEIGHT_M = 1.6;
export const DEFAULT_CHARACTER_HEIGHT_M = 1.75;
export const DEFAULT_ASPECT = 16 / 9;
export const MAX_DURATION_S = 3600;
const MAX_ITEMS = 500;
const MAX_KEYS = 2000;

export const CAMERA_COLORS = ['#e5484d', '#3e8ef7', '#30a46c', '#f5a524', '#8e4ec6', '#12a594', '#e93d82', '#978365'];
export const CHARACTER_COLORS = ['#f76b15', '#0090ff', '#46a758', '#d6409f', '#ffc53d', '#6e56cf', '#00a2c7', '#a18072'];

// ── number hygiene ──────────────────────────────────────────────────────────

export const finite = (value: unknown, fallback: number, min = -1e6, max = 1e6): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

const str = (value: unknown, fallback = '', max = 500): string =>
  typeof value === 'string' ? value.slice(0, max) : typeof value === 'number' && Number.isFinite(value) ? String(value) : fallback;

const optStr = (value: unknown, max = 2000): string | undefined => (typeof value === 'string' && value.length > 0 ? value.slice(0, max) : undefined);

export const vec3 = (value: unknown, fallback: StageVec3 = { x: 0, y: 0, z: 0 }): StageVec3 => {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return { x: finite(v.x, fallback.x), y: finite(v.y, fallback.y), z: finite(v.z, fallback.z) };
};

/** Wrap to (-180, 180]. */
export const wrapDeg = (deg: number): number => {
  if (!Number.isFinite(deg)) return 0;
  let d = deg % 360;
  if (d <= -180) d += 360;
  if (d > 180) d -= 360;
  return d === -0 ? 0 : d;
};

export const degToRad = (deg: number) => (deg * Math.PI) / 180;
export const radToDeg = (rad: number) => (rad * 180) / Math.PI;

let idCounter = 0;
export const makeStageId = (prefix: string): string => {
  idCounter = (idCounter + 1) % 1e6;
  return `${prefix}-${Date.now().toString(36)}${idCounter.toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
};

// ── factories ───────────────────────────────────────────────────────────────

export const createStage = (): StageState => ({
  version: 1,
  cameras: [],
  activeCameraId: null,
  characters: [],
  animation: { durationS: 10, fps: 24, tracks: {} },
  shots: [],
  lineOfAction: null,
  plan: {},
  snapshots: [],
  aspectRatio: DEFAULT_ASPECT,
});

export const createCamera = (input: Partial<StageCamera> & { id?: string } = {}, index = 0): StageCamera => normalizeCamera({
  name: String.fromCharCode(65 + (index % 26)),
  color: CAMERA_COLORS[index % CAMERA_COLORS.length],
  ...input,
  id: input.id || makeStageId('cam'),
}, index);

export const createCharacter = (input: Partial<StageCharacter> & { id?: string } = {}, index = 0): StageCharacter => normalizeCharacter({
  name: `Figur ${index + 1}`,
  color: CHARACTER_COLORS[index % CHARACTER_COLORS.length],
  ...input,
  id: input.id || makeStageId('chr'),
}, index);

// ── normalisers ─────────────────────────────────────────────────────────────

const SENSOR_FITS: StageSensorFit[] = ['auto', 'horizontal', 'vertical'];
const POSTURES: StagePosture[] = ['standing', 'sitting', 'lying'];
const EASINGS: StageEasing[] = ['linear', 'smooth', 'hold'];
export const SHOT_SIZES: StageShotSize[] = ['EWS', 'WS', 'FS', 'MLS', 'MS', 'MCU', 'CU', 'ECU'];
export const CAMERA_MOVES: StageCameraMove[] = ['static', 'pan', 'tilt', 'zoom', 'dolly', 'track', 'crane', 'handheld'];

const oneOf = <T extends string>(value: unknown, options: readonly T[], fallback: T): T =>
  typeof value === 'string' && (options as readonly string[]).includes(value) ? (value as T) : fallback;

export const normalizeCamera = (raw: unknown, index = 0): StageCamera => {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cam: StageCamera = {
    id: str(c.id, '', 120) || makeStageId('cam'),
    name: str(c.name, String.fromCharCode(65 + (index % 26)), 60),
    position: vec3(c.position, { x: 0, y: DEFAULT_CAMERA_HEIGHT_M, z: 4 }),
    yawDeg: wrapDeg(finite(c.yawDeg, 0)),
    pitchDeg: finite(c.pitchDeg, 0, -90, 90),
    rollDeg: wrapDeg(finite(c.rollDeg, 0)),
    focalLengthMm: finite(c.focalLengthMm, 35, 1, 2000),
    sensorWidthMm: finite(c.sensorWidthMm, 24.89, 1, 100),
    sensorHeightMm: finite(c.sensorHeightMm, 18.66, 1, 100),
    sensorFit: oneOf(c.sensorFit, SENSOR_FITS, 'auto'),
    color: optStr(c.color, 40) || CAMERA_COLORS[index % CAMERA_COLORS.length],
  };
  if (c.shiftX !== undefined) cam.shiftX = finite(c.shiftX, 0, -2, 2);
  if (c.shiftY !== undefined) cam.shiftY = finite(c.shiftY, 0, -2, 2);
  if (c.clipStartM !== undefined) cam.clipStartM = finite(c.clipStartM, 0.1, 0.001, 1000);
  if (c.clipEndM !== undefined) cam.clipEndM = finite(c.clipEndM, 1000, 0.01, 1e6);
  if (c.focusDistanceM !== undefined) cam.focusDistanceM = finite(c.focusDistanceM, 3, 0.01, 1e5);
  if (c.fStop !== undefined) cam.fStop = finite(c.fStop, 2.8, 0.5, 64);
  if (c.hidden === true) cam.hidden = true;
  if (c.locked === true) cam.locked = true;
  if (typeof c.followId === 'string' && c.followId) cam.followId = c.followId.slice(0, 120);
  return cam;
};

export const normalizeCharacter = (raw: unknown, index = 0): StageCharacter => {
  const c = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const chr: StageCharacter = {
    id: str(c.id, '', 120) || makeStageId('chr'),
    name: str(c.name, `Figur ${index + 1}`, 120),
    position: vec3(c.position, { x: 0, y: 0, z: 0 }),
    yawDeg: wrapDeg(finite(c.yawDeg, 0)),
    heightM: finite(c.heightM, DEFAULT_CHARACTER_HEIGHT_M, 0.3, 3),
    posture: oneOf(c.posture, POSTURES, 'standing'),
    color: optStr(c.color, 40) || CHARACTER_COLORS[index % CHARACTER_COLORS.length],
  };
  const ref = optStr(c.referenceId, 120);
  if (ref) chr.referenceId = ref;
  if (c.hidden === true) chr.hidden = true;
  if (c.locked === true) chr.locked = true;
  return chr;
};

export const normalizeKeyframe = (raw: unknown, durationS = MAX_DURATION_S): StageKeyframe => {
  const k = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const key: StageKeyframe = {
    id: str(k.id, '', 120) || makeStageId('key'),
    timeS: finite(k.timeS, 0, 0, Math.max(0, durationS)),
    position: vec3(k.position),
    yawDeg: wrapDeg(finite(k.yawDeg, 0)),
    easing: oneOf(k.easing, EASINGS, 'smooth'),
  };
  if (k.pitchDeg !== undefined) key.pitchDeg = finite(k.pitchDeg, 0, -90, 90);
  if (k.focalLengthMm !== undefined) key.focalLengthMm = finite(k.focalLengthMm, 35, 1, 2000);
  const label = optStr(k.label, 120);
  if (label) key.label = label;
  return key;
};

export const sortKeys = (keys: StageKeyframe[]): StageKeyframe[] => [...keys].sort((a, b) => a.timeS - b.timeS);

const normalizeShot = (raw: unknown, index: number): StageShot | null => {
  const s = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!s) return null;
  const cameraId = str(s.cameraId, '', 120);
  if (!cameraId) return null;
  const startS = finite(s.startS, 0, 0, MAX_DURATION_S);
  const shot: StageShot = {
    id: str(s.id, '', 120) || makeStageId('shot'),
    cameraId,
    number: Math.round(finite(s.number, index + 1, 1, 9999)),
    version: (str(s.version, 'A', 3).toUpperCase().replace(/[^A-Z]/g, '') || 'A'),
    startS,
    endS: finite(s.endS, startS, startS, MAX_DURATION_S),
    shootOrder: Math.round(finite(s.shootOrder, index + 1, 1, 9999)),
  };
  for (const key of ['description', 'props', 'gear', 'crew', 'notes'] as const) {
    const v = optStr(s[key], 4000);
    if (v) shot[key] = v;
  }
  if (typeof s.sizeOverride === 'string') shot.sizeOverride = oneOf(s.sizeOverride, SHOT_SIZES, 'MS');
  if (typeof s.moveOverride === 'string') shot.moveOverride = oneOf(s.moveOverride, CAMERA_MOVES, 'static');
  if (s.lensOverrideMm !== undefined && s.lensOverrideMm !== null) shot.lensOverrideMm = finite(s.lensOverrideMm, 35, 1, 2000);
  if (Array.isArray(s.subjectIds)) shot.subjectIds = s.subjectIds.filter((v): v is string => typeof v === 'string').slice(0, 50);
  if (s.storyboardShot !== undefined && s.storyboardShot !== null) {
    const n = finite(s.storyboardShot, NaN, 1, 99999);
    if (Number.isFinite(n)) shot.storyboardShot = Math.round(n);
  }
  const frame = optStr(s.frameUrl, 8_000_000);
  if (frame) shot.frameUrl = frame;
  if (s.detached === true) shot.detached = true;
  return shot;
};

/** Accepts anything (old project, agent input, null) and returns a valid StageState. Never throws. */
export const normalizeStage = (raw: unknown): StageState => {
  const base = createStage();
  if (!raw || typeof raw !== 'object') return base;
  const r = raw as Record<string, unknown>;
  const cameras = Array.isArray(r.cameras) ? r.cameras.slice(0, MAX_ITEMS).map((c, i) => normalizeCamera(c, i)) : [];
  const characters = Array.isArray(r.characters) ? r.characters.slice(0, MAX_ITEMS).map((c, i) => normalizeCharacter(c, i)) : [];
  dedupeIds(cameras);
  dedupeIds(characters);
  const anim = (r.animation && typeof r.animation === 'object' ? r.animation : {}) as Record<string, unknown>;
  const durationS = finite(anim.durationS, base.animation.durationS, 0.1, MAX_DURATION_S);
  const tracks: Record<string, StageKeyframe[]> = {};
  if (anim.tracks && typeof anim.tracks === 'object') {
    let budget = MAX_KEYS;
    for (const [id, keys] of Object.entries(anim.tracks as Record<string, unknown>).slice(0, MAX_ITEMS)) {
      if (!Array.isArray(keys) || budget <= 0) continue;
      const list = sortKeys(keys.slice(0, budget).map((k) => normalizeKeyframe(k, durationS)));
      budget -= list.length;
      if (list.length) tracks[id.slice(0, 120)] = list;
    }
  }
  const shots = Array.isArray(r.shots)
    ? r.shots.slice(0, MAX_ITEMS).map((s, i) => normalizeShot(s, i)).filter((s): s is StageShot => !!s)
    : [];
  const loa = r.lineOfAction as Record<string, unknown> | null | undefined;
  const lineOfAction = loa && typeof loa.aId === 'string' && typeof loa.bId === 'string' && loa.aId !== loa.bId
    ? { aId: loa.aId, bId: loa.bId }
    : null;
  const planRaw = (r.plan && typeof r.plan === 'object' ? r.plan : {}) as Record<string, unknown>;
  const plan: StagePlanInfo = {};
  const bg = optStr(planRaw.backgroundUrl, 20_000_000);
  if (bg) plan.backgroundUrl = bg;
  if (planRaw.backgroundMPerPx !== undefined) plan.backgroundMPerPx = finite(planRaw.backgroundMPerPx, 0.01, 1e-5, 100);
  if (planRaw.backgroundOffset && typeof planRaw.backgroundOffset === 'object') {
    const o = planRaw.backgroundOffset as Record<string, unknown>;
    plan.backgroundOffset = { x: finite(o.x, 0), z: finite(o.z, 0) };
  }
  if (planRaw.backgroundOpacity !== undefined) plan.backgroundOpacity = finite(planRaw.backgroundOpacity, 0.5, 0, 1);
  const pageName = optStr(planRaw.pageName, 120);
  if (pageName) plan.pageName = pageName;
  const snapshots = Array.isArray(r.snapshots)
    ? r.snapshots.slice(0, 50).flatMap((s) => {
      const o = (s && typeof s === 'object' ? s : null) as Record<string, unknown> | null;
      if (!o || typeof o.data !== 'string') return [];
      return [{ id: str(o.id, '', 120) || makeStageId('snap'), name: str(o.name, 'Stand', 120), createdAt: str(o.createdAt, '', 40), data: o.data.slice(0, 20_000_000) }];
    })
    : [];
  const activeCameraId = typeof r.activeCameraId === 'string' && cameras.some((c) => c.id === r.activeCameraId) ? r.activeCameraId : (cameras[0]?.id ?? null);
  return {
    version: 1,
    cameras,
    activeCameraId,
    characters,
    animation: { durationS, fps: Math.round(finite(anim.fps, 24, 1, 240)), tracks },
    shots,
    lineOfAction,
    plan,
    snapshots,
    aspectRatio: finite(r.aspectRatio, DEFAULT_ASPECT, 0.2, 5),
  };
};

const dedupeIds = (items: Array<{ id: string }>) => {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) item.id = makeStageId('dup');
    seen.add(item.id);
  }
};

// ── optics ──────────────────────────────────────────────────────────────────

/** Horizontal and vertical field of view (degrees) for an output aspect ratio (width / height). */
export const cameraFovDeg = (
  cam: Pick<StageCamera, 'focalLengthMm' | 'sensorWidthMm' | 'sensorHeightMm' | 'sensorFit'>,
  aspect = DEFAULT_ASPECT,
): { horizontal: number; vertical: number } => {
  const f = Math.max(0.1, finite(cam.focalLengthMm, 35, 0.1, 5000));
  const a = Math.max(0.05, finite(aspect, DEFAULT_ASPECT, 0.05, 20));
  const fit = cam.sensorFit === 'vertical' ? 'vertical' : cam.sensorFit === 'horizontal' ? 'horizontal' : (a >= 1 ? 'horizontal' : 'vertical');
  // Like a CG camera: the fitted sensor side defines one FOV, the frame aspect gives the other.
  let hHalf: number;
  let vHalf: number;
  if (fit === 'horizontal') {
    hHalf = Math.atan(finite(cam.sensorWidthMm, 24.89, 0.1, 500) / 2 / f);
    vHalf = Math.atan(Math.tan(hHalf) / a);
  } else {
    vHalf = Math.atan(finite(cam.sensorHeightMm, 18.66, 0.1, 500) / 2 / f);
    hHalf = Math.atan(Math.tan(vHalf) * a);
  }
  return { horizontal: radToDeg(2 * hHalf), vertical: radToDeg(2 * vHalf) };
};

/** Focal length that gives the requested horizontal FOV on the camera's sensor width. */
export const focalForHorizontalFov = (fovDeg: number, sensorWidthMm = 24.89): number => {
  const half = degToRad(finite(fovDeg, 40, 0.1, 179.9) / 2);
  return sensorWidthMm / 2 / Math.tan(half);
};

/** Unit forward vector for yaw/pitch. */
export const forwardVector = (yawDeg: number, pitchDeg = 0): StageVec3 => {
  const y = degToRad(yawDeg);
  const p = degToRad(pitchDeg);
  return { x: -Math.sin(y) * Math.cos(p), y: Math.sin(p), z: -Math.cos(y) * Math.cos(p) };
};

/** A point `distance` metres in front of the camera (for three.js lookAt / old target-based cameras). */
export const cameraTarget = (cam: Pick<StageCamera, 'position' | 'yawDeg' | 'pitchDeg'>, distance = 5): StageVec3 => {
  const f = forwardVector(cam.yawDeg, cam.pitchDeg);
  return { x: cam.position.x + f.x * distance, y: cam.position.y + f.y * distance, z: cam.position.z + f.z * distance };
};

/** Yaw and pitch that aim from `from` towards `to`. */
export const aimAngles = (from: StageVec3, to: StageVec3): { yawDeg: number; pitchDeg: number } => {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dz = to.z - from.z;
  const flat = Math.hypot(dx, dz);
  if (flat < 1e-9 && Math.abs(dy) < 1e-9) return { yawDeg: 0, pitchDeg: 0 };
  return { yawDeg: wrapDeg(radToDeg(Math.atan2(-dx, -dz))), pitchDeg: radToDeg(Math.atan2(dy, flat)) };
};

/** Eye height of a character for its posture. */
export const eyeHeightM = (chr: Pick<StageCharacter, 'heightM' | 'posture' | 'position'>): number => {
  const h = finite(chr.heightM, DEFAULT_CHARACTER_HEIGHT_M, 0.3, 3);
  const base = finite(chr.position?.y, 0);
  if (chr.posture === 'sitting') return base + h * 0.68;
  if (chr.posture === 'lying') return base + 0.25;
  return base + h * 0.93;
};

// ── time ────────────────────────────────────────────────────────────────────

const smooth = (t: number) => t * t * (3 - 2 * t);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpAngle = (a: number, b: number, t: number) => wrapDeg(a + wrapDeg(b - a) * t);

export type StagePose = { position: StageVec3; yawDeg: number; pitchDeg?: number; focalLengthMm?: number };

/** Pose of a track at time t, or null for an empty track. Keys must be sorted by time. */
export const sampleTrack = (keys: StageKeyframe[] | undefined, t: number): StagePose | null => {
  if (!keys || keys.length === 0) return null;
  const time = finite(t, 0, -MAX_DURATION_S, MAX_DURATION_S * 2);
  const pose = (k: StageKeyframe): StagePose => ({ position: { ...k.position }, yawDeg: k.yawDeg, pitchDeg: k.pitchDeg, focalLengthMm: k.focalLengthMm });
  if (time <= keys[0].timeS) return pose(keys[0]);
  const last = keys[keys.length - 1];
  if (time >= last.timeS) return pose(last);
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].timeS <= time) i += 1;
  const a = keys[i];
  const b = keys[i + 1];
  const span = b.timeS - a.timeS;
  if (span <= 1e-9 || a.easing === 'hold') return pose(a);
  const raw = (time - a.timeS) / span;
  const u = a.easing === 'linear' ? raw : smooth(raw);
  const mix = (x: number | undefined, y: number | undefined) => (x === undefined && y === undefined ? undefined : lerp(x ?? y ?? 0, y ?? x ?? 0, u));
  const pitch = a.pitchDeg === undefined && b.pitchDeg === undefined ? undefined : lerp(a.pitchDeg ?? b.pitchDeg ?? 0, b.pitchDeg ?? a.pitchDeg ?? 0, u);
  return {
    position: { x: lerp(a.position.x, b.position.x, u), y: lerp(a.position.y, b.position.y, u), z: lerp(a.position.z, b.position.z, u) },
    yawDeg: lerpAngle(a.yawDeg, b.yawDeg, u),
    pitchDeg: pitch,
    focalLengthMm: mix(a.focalLengthMm, b.focalLengthMm),
  };
};

/** Characters at time t (animated pose applied). */
export const charactersAt = (stage: StageState, t: number): StageCharacter[] => stage.characters.map((chr) => {
  const pose = sampleTrack(stage.animation.tracks[chr.id], t);
  return pose ? { ...chr, position: pose.position, yawDeg: pose.yawDeg } : chr;
});

/** Cameras at time t (animated pose and zoom applied, follow-aim resolved). */
export const camerasAt = (stage: StageState, t: number, characters = charactersAt(stage, t)): StageCamera[] => stage.cameras.map((cam) => {
  const pose = sampleTrack(stage.animation.tracks[cam.id], t);
  let next: StageCamera = pose
    ? { ...cam, position: pose.position, yawDeg: pose.yawDeg, pitchDeg: pose.pitchDeg ?? cam.pitchDeg, focalLengthMm: pose.focalLengthMm ?? cam.focalLengthMm }
    : cam;
  if (cam.followId) {
    const target = characters.find((c) => c.id === cam.followId);
    if (target) {
      const eye = { x: target.position.x, y: eyeHeightM(target), z: target.position.z };
      const aim = aimAngles(next.position, eye);
      next = { ...next, yawDeg: aim.yawDeg, pitchDeg: aim.pitchDeg };
    }
  }
  return next;
});

/** Generic pose for any object id (asset tracks included) at time t. */
export const objectPoseAt = (stage: StageState, id: string, t: number): StagePose | null => sampleTrack(stage.animation.tracks[id], t);

/** Sorted, unique key times across all tracks (for timeline ticks and stepping). */
export const allKeyTimes = (stage: StageState): number[] => {
  const set = new Set<number>();
  for (const keys of Object.values(stage.animation.tracks)) for (const k of keys) set.add(Math.round(k.timeS * 1000) / 1000);
  return [...set].sort((a, b) => a - b);
};
