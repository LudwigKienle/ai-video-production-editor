/**
 * Storage adapter between the shared set design document (owned by the 3D set design) and the
 * blocking view model used by the Scene Map.
 *
 * Storage (one source of truth, no copies):
 *   - cameras      → SetDesignState.cameras (SetDesignCameraObject: position, rotation = three.js
 *                    Euler XYZ in degrees looking along local -Z, lensMm, sensor …), activeCameraId
 *   - characters   → SetDesignAssets with primitive 'person' (1.75 m stand-in, centred at half
 *                    height, nose along local +Z) plus optional `character` data
 *   - blocking     → SetDesignState.stage: animation tracks, shots, axisLine … referencing the ids above
 *
 * View (what commands, renderers and MCP tools work on): StageState with cameras/characters in
 * yaw/pitch/roll form. readStageHost() builds the view, writeStageHost() writes it back while
 * keeping every field the 3D side owns (shift, clip, materials …).
 *
 * The rotation maths matches the set design's coords.ts (cameraAngles/lookAtRotation) and the FOV
 * maths its cameraMath.ts; after both branches are merged these helpers can delegate to them.
 */
import * as THREE from 'three';
import {
  CAMERA_COLORS,
  CHARACTER_COLORS,
  DEFAULT_CHARACTER_HEIGHT_M,
  finite,
  normalizeCamera,
  normalizeCharacter,
  normalizeStage,
  wrapDeg,
  type StageCamera,
  type StageCharacter,
  type StagePosture,
  type StageState,
  type StageVec3,
} from './stageModel.ts';

const DEG = Math.PI / 180;

/** Mirrors SetDesignCameraObject in the set design branch (structural, so both type-check). */
export type StoredCameraObject = {
  id: string;
  name: string;
  position: StageVec3;
  rotation: StageVec3;
  lensMm: number;
  sensorWidthMm: number;
  sensorHeightMm?: number;
  sensorFit?: 'auto' | 'horizontal' | 'vertical';
  shiftX?: number;
  shiftY?: number;
  clipStart?: number;
  clipEnd?: number;
  focusDistance?: number;
  fStop?: number;
  hidden?: boolean;
  locked?: boolean;
};

export type StoredCharacterInfo = { referenceId?: string; heightM?: number; pose?: StagePosture; color?: string };

/** Blocking data stored in SetDesignState.stage – only references, never camera/character copies. */
export type StoredStage = Omit<StageState, 'cameras' | 'characters' | 'activeCameraId' | 'lineOfAction'> & {
  axisLine?: { aId: string; bId: string } | null;
  /** Camera id → character id the camera pans to follow. */
  cameraFollow?: Record<string, string>;
  /** Plan colour per camera id (3D has its own materials). */
  cameraColors?: Record<string, string>;
};

type AnyAsset = { id: string; name?: string; kind?: string; primitive?: string; position: StageVec3; rotation: StageVec3; scale: StageVec3; material?: { color?: string } & Record<string, unknown>; character?: StoredCharacterInfo; hidden?: boolean; locked?: boolean } & Record<string, unknown>;
export type StoredDocument = { assets: AnyAsset[]; cameras?: StoredCameraObject[]; activeCameraId?: string | null; stage?: unknown } & Record<string, unknown>;

export const PERSON_BASE_HEIGHT_M = 1.75;

// ── rotation conversion (three.js, Y up) ─────────────────────────────────────

/** Camera yaw/pitch/roll (yaw 0 = −Z, + = CCW from above, pitch + = up, roll + = right side up) → Euler XYZ degrees. */
export const cameraRotationFromAngles = (yawDeg: number, pitchDeg: number, rollDeg = 0): StageVec3 => {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(pitchDeg * DEG, yawDeg * DEG, rollDeg * DEG, 'YXZ'));
  const e = new THREE.Euler().setFromRotationMatrix(m, 'XYZ');
  const r = (v: number) => { const x = Math.round((v / DEG) * 1000) / 1000; return Object.is(x, -0) ? 0 : x; };
  return { x: r(e.x), y: r(e.y), z: r(e.z) };
};

/** Euler XYZ degrees → yaw/pitch/roll in the blocking convention. */
export const cameraAnglesFromRotation = (rotation: StageVec3): { yawDeg: number; pitchDeg: number; rollDeg: number } => {
  const m = new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(finite(rotation?.x, 0) * DEG, finite(rotation?.y, 0) * DEG, finite(rotation?.z, 0) * DEG, 'XYZ'));
  const forward = new THREE.Vector3(0, 0, -1).applyMatrix4(m);
  const right = new THREE.Vector3(1, 0, 0).applyMatrix4(m);
  const pitch = Math.asin(Math.max(-1, Math.min(1, forward.y))) / DEG;
  const yaw = Math.atan2(-forward.x, -forward.z) / DEG;
  const up = new THREE.Vector3(0, 1, 0).applyMatrix4(m);
  // Exact inverse of the YXZ build (the set design shows horizon tilt, which equals this at pitch 0).
  const roll = Math.atan2(right.y, up.y) / DEG;
  const r = (v: number) => Math.round(v * 1000) / 1000;
  return { yawDeg: wrapDeg(r(yaw)), pitchDeg: r(pitch), rollDeg: r(roll) || 0 };
};

/** Person stand-in faces local +Z: blocking yaw = rotation.y + 180°. */
export const personYawFromRotationY = (rotationY: number) => wrapDeg(finite(rotationY, 0) + 180);
export const personRotationYFromYaw = (yawDeg: number) => wrapDeg(finite(yawDeg, 0) - 180);

// ── read ────────────────────────────────────────────────────────────────────

export const isPersonAsset = (asset: { kind?: string; primitive?: string } | null | undefined) => !!asset && asset.kind === 'primitive' && asset.primitive === 'person';

const cameraFromStored = (c: StoredCameraObject, i: number, follow: Record<string, string>, colors: Record<string, string>): StageCamera => {
  const angles = cameraAnglesFromRotation(c.rotation);
  return normalizeCamera({
    id: c.id,
    name: c.name,
    position: c.position,
    ...angles,
    focalLengthMm: c.lensMm,
    sensorWidthMm: c.sensorWidthMm,
    sensorHeightMm: c.sensorHeightMm ?? (finite(c.sensorWidthMm, 36) * 2) / 3,
    sensorFit: c.sensorFit,
    shiftX: c.shiftX,
    shiftY: c.shiftY,
    clipStartM: c.clipStart,
    clipEndM: c.clipEnd,
    focusDistanceM: c.focusDistance,
    fStop: c.fStop,
    hidden: c.hidden,
    locked: c.locked,
    followId: follow[c.id],
    color: colors[c.id] || CAMERA_COLORS[i % CAMERA_COLORS.length],
  }, i);
};

const characterFromPerson = (a: AnyAsset, i: number): StageCharacter => {
  const info = a.character || {};
  const heightM = finite(info.heightM, PERSON_BASE_HEIGHT_M * Math.abs(finite(a.scale?.y, 1, -100, 100) || 1), 0.3, 3);
  const pose = info.pose || 'standing';
  // Stored position is the stand-in's centre; the view uses the feet.
  const centreOffset = pose === 'lying' ? 0.15 : heightM / 2;
  return normalizeCharacter({
    id: a.id,
    name: a.name,
    referenceId: info.referenceId,
    position: { x: finite(a.position?.x, 0), y: Math.max(0, finite(a.position?.y, centreOffset) - centreOffset), z: finite(a.position?.z, 0) },
    yawDeg: personYawFromRotationY(a.rotation?.y ?? 0),
    heightM,
    posture: pose,
    color: info.color || (a.material?.color as string | undefined) || CHARACTER_COLORS[i % CHARACTER_COLORS.length],
    hidden: a.hidden,
    locked: a.locked,
  }, i);
};

/**
 * Build the blocking view from the stored document. Also migrates documents that still carry
 * cameras/characters inside `stage` (early Scene Map builds) into the shared lists.
 */
export const readStageHost = <T extends StoredDocument>(doc: T): T & { stage: StageState } => {
  const rawStage = (doc.stage && typeof doc.stage === 'object' ? doc.stage : {}) as Record<string, unknown>;
  const follow = (rawStage.cameraFollow && typeof rawStage.cameraFollow === 'object' ? rawStage.cameraFollow : {}) as Record<string, string>;
  const colors = (rawStage.cameraColors && typeof rawStage.cameraColors === 'object' ? rawStage.cameraColors : {}) as Record<string, string>;
  const assets = Array.isArray(doc.assets) ? doc.assets : [];
  const storedCams = Array.isArray(doc.cameras) ? doc.cameras : null;
  const legacy = normalizeStage(rawStage);
  const cameras = storedCams ? storedCams.map((c, i) => cameraFromStored(c, i, follow, colors)) : legacy.cameras;
  const persons = assets.filter(isPersonAsset);
  const characters = persons.length || !legacy.characters.length ? persons.map(characterFromPerson) : legacy.characters;
  const stage = normalizeStage({
    ...rawStage,
    cameras,
    characters,
    activeCameraId: doc.activeCameraId ?? (rawStage.activeCameraId as string | undefined),
    lineOfAction: rawStage.axisLine ?? rawStage.lineOfAction ?? null,
  });
  // Keep camera extras normalizeStage does not know about.
  stage.cameras = stage.cameras.map((c) => ({ ...c, ...(follow[c.id] ? { followId: follow[c.id] } : {}) }));
  // The view holds cameras/characters only in `stage`; the stored lists are rebuilt on write.
  const { cameras: _storedCameras, activeCameraId: _storedActive, ...restDoc } = doc;
  return { ...(restDoc as T), assets: assets.filter((a) => !isPersonAsset(a)), stage };
};

// ── write ───────────────────────────────────────────────────────────────────

const cameraToStored = (c: StageCamera, prev: StoredCameraObject | undefined): StoredCameraObject => {
  const out: StoredCameraObject = {
    ...(prev || {}),
    id: c.id,
    name: c.name,
    position: { ...c.position },
    rotation: cameraRotationFromAngles(c.yawDeg, c.pitchDeg, c.rollDeg),
    lensMm: Math.round(c.focalLengthMm * 100) / 100,
    sensorWidthMm: c.sensorWidthMm,
    sensorHeightMm: c.sensorHeightMm,
    sensorFit: c.sensorFit,
  };
  for (const [from, to] of [['shiftX', 'shiftX'], ['shiftY', 'shiftY'], ['clipStartM', 'clipStart'], ['clipEndM', 'clipEnd'], ['focusDistanceM', 'focusDistance'], ['fStop', 'fStop']] as const) {
    const v = c[from];
    if (v !== undefined) (out as Record<string, unknown>)[to] = v;
  }
  if (c.hidden) out.hidden = true; else delete out.hidden;
  if (c.locked) out.locked = true; else delete out.locked;
  return out;
};

const personFromCharacter = (c: StageCharacter, prev: AnyAsset | undefined): AnyAsset => {
  const pose = c.posture || 'standing';
  const s = c.heightM / PERSON_BASE_HEIGHT_M;
  const centreOffset = pose === 'lying' ? 0.15 : c.heightM / 2;
  const prevScale = prev?.scale || { x: 1, y: 1, z: 1 };
  const uniform = Math.abs(prevScale.x - prevScale.y) < 1e-6 && Math.abs(prevScale.z - prevScale.y) < 1e-6;
  const next: AnyAsset = {
    ...(prev || { kind: 'primitive', primitive: 'person', material: { color: c.color || '#b8a48f', roughness: 0.8, metalness: 0 } }),
    id: c.id,
    name: c.name,
    kind: 'primitive',
    primitive: 'person',
    position: { x: c.position.x, y: c.position.y + centreOffset, z: c.position.z },
    rotation: { ...(prev?.rotation || { x: 0, z: 0 }), y: personRotationYFromYaw(c.yawDeg) } as StageVec3,
    scale: uniform ? { x: s, y: s, z: s } : { ...prevScale, y: s },
    character: {
      ...(prev?.character || {}),
      heightM: c.heightM,
      pose,
      ...(c.referenceId ? { referenceId: c.referenceId } : {}),
      ...(c.color ? { color: c.color } : {}),
    },
  };
  if (!c.referenceId && next.character) delete next.character.referenceId;
  if (c.hidden) next.hidden = true; else delete next.hidden;
  if (c.locked) next.locked = true; else delete next.locked;
  return next;
};

/**
 * Write the view back into the stored document. `base` is the current stored document: fields the
 * 3D side owns (camera shift/clip, person materials, other assets' extras) are preserved.
 */
export const writeStageHost = <T extends StoredDocument>(view: T & { stage: StageState }, base?: StoredDocument | null): T => {
  const prevCams = new Map((base?.cameras || []).map((c) => [c.id, c]));
  const prevPersons = new Map((base?.assets || []).filter(isPersonAsset).map((a) => [a.id, a]));
  const { cameras, characters, activeCameraId, lineOfAction, ...rest } = view.stage;
  const cameraFollow: Record<string, string> = {};
  const cameraColors: Record<string, string> = {};
  for (const c of cameras) {
    if (c.followId) cameraFollow[c.id] = c.followId;
    if (c.color) cameraColors[c.id] = c.color;
  }
  const stored: StoredStage = { ...rest, axisLine: lineOfAction ?? null, cameraFollow, cameraColors };
  const persons = characters.map((c) => personFromCharacter(c, prevPersons.get(c.id)));
  return {
    ...view,
    assets: mergeAssetOrder(base?.assets, view.assets.filter((a) => !isPersonAsset(a)), persons),
    cameras: cameras.map((c) => cameraToStored(c, prevCams.get(c.id))),
    activeCameraId: activeCameraId ?? null,
    stage: stored,
  } as unknown as T;
};

/** Keep the stored order (outliner) and append new objects at the end. */
const mergeAssetOrder = (baseAssets: AnyAsset[] | undefined, others: AnyAsset[], persons: AnyAsset[]): AnyAsset[] => {
  const byId = new Map([...others, ...persons].map((a) => [a.id, a]));
  const out: AnyAsset[] = [];
  for (const a of baseAssets || []) {
    const next = byId.get(a.id);
    if (next) { out.push(next); byId.delete(a.id); }
  }
  return [...out, ...byId.values()];
};

export const DEFAULT_PERSON_HEIGHT = DEFAULT_CHARACTER_HEIGHT_M;
