/**
 * Floor-plan view of the shared set design: set elements (walls, doors, furniture …) are ordinary
 * SetDesignAssets (box primitives) carrying optional `plan` metadata, so the 3D set design shows
 * them without extra work. Cameras, characters and blocking live in `SetDesignState.stage`.
 */
import type { SetDesignAsset, SetDesignState } from '../types';
import { finite, makeStageId, normalizeStage, wrapDeg, type StageState } from '../scene/stageModel.ts';
import { readStageHost, writeStageHost } from '../scene/setDesignAdapter.ts';

export type PlanCategory =
  | 'wall' | 'door' | 'window' | 'table' | 'chair' | 'sofa' | 'bed' | 'desk' | 'counter' | 'shelf'
  | 'cabinet' | 'tv' | 'lamp' | 'plant' | 'tree' | 'car' | 'stairs' | 'column' | 'rug' | 'bathtub'
  | 'box' | 'light' | 'track' | 'set' | 'other';

export type SetDesignPlanInfo = {
  category: PlanCategory;
  label?: string;
  /** Footprint in metres (width along local x, depth along local z). */
  footprintM?: { w: number; d: number };
  heightM?: number;
};

export type PlanAsset = SetDesignAsset & { plan?: SetDesignPlanInfo };
/** SetDesignState as seen by the blocking tools (stage + plan metadata are optional extras). */
export type StageHost = Omit<SetDesignState, 'assets'> & { assets: PlanAsset[]; stage?: StageState };

export type PlanElementSpec = {
  category: PlanCategory;
  label: string;
  w: number;
  d: number;
  h: number;
  color: string;
  /** Height of the element's bottom above the floor (windows sit higher). */
  elevation?: number;
};

/** Own element library (sizes in metres). */
export const PLAN_LIBRARY: PlanElementSpec[] = [
  { category: 'wall', label: 'Wand', w: 4, d: 0.15, h: 2.6, color: '#9aa0a6' },
  { category: 'door', label: 'Tür', w: 0.9, d: 0.1, h: 2.05, color: '#b08d57' },
  { category: 'window', label: 'Fenster', w: 1.2, d: 0.12, h: 1.3, color: '#8ecae6', elevation: 0.9 },
  { category: 'table', label: 'Tisch', w: 1.6, d: 0.9, h: 0.75, color: '#a47551' },
  { category: 'chair', label: 'Stuhl', w: 0.48, d: 0.5, h: 0.9, color: '#7f5539' },
  { category: 'sofa', label: 'Sofa', w: 2.1, d: 0.9, h: 0.85, color: '#6d597a' },
  { category: 'bed', label: 'Bett', w: 1.6, d: 2.05, h: 0.55, color: '#b5838d' },
  { category: 'desk', label: 'Schreibtisch', w: 1.4, d: 0.7, h: 0.75, color: '#8d6e63' },
  { category: 'counter', label: 'Theke', w: 2.4, d: 0.6, h: 1.05, color: '#795548' },
  { category: 'shelf', label: 'Regal', w: 1.2, d: 0.4, h: 2, color: '#8b6f47' },
  { category: 'cabinet', label: 'Schrank', w: 1, d: 0.6, h: 2, color: '#6f5b4b' },
  { category: 'tv', label: 'Bildschirm', w: 1.3, d: 0.12, h: 0.8, color: '#37474f', elevation: 0.6 },
  { category: 'lamp', label: 'Stehlampe', w: 0.4, d: 0.4, h: 1.7, color: '#e9c46a' },
  { category: 'plant', label: 'Pflanze', w: 0.6, d: 0.6, h: 1.2, color: '#52b788' },
  { category: 'tree', label: 'Baum', w: 2.5, d: 2.5, h: 5, color: '#2d6a4f' },
  { category: 'car', label: 'Auto', w: 1.85, d: 4.6, h: 1.45, color: '#457b9d' },
  { category: 'stairs', label: 'Treppe', w: 1.1, d: 3, h: 2.6, color: '#a8a29e' },
  { category: 'column', label: 'Säule', w: 0.4, d: 0.4, h: 2.6, color: '#bdbdbd' },
  { category: 'rug', label: 'Teppich', w: 2.4, d: 1.7, h: 0.02, color: '#c9ada7' },
  { category: 'bathtub', label: 'Wanne', w: 0.8, d: 1.75, h: 0.6, color: '#e0e0e0' },
  { category: 'box', label: 'Kiste', w: 0.6, d: 0.6, h: 0.6, color: '#c8a165' },
  { category: 'light', label: 'Scheinwerfer', w: 0.5, d: 0.5, h: 2.2, color: '#ffd166' },
  { category: 'track', label: 'Kameraschiene', w: 0.6, d: 4, h: 0.12, color: '#adb5bd' },
];

export const PLAN_CATEGORIES = PLAN_LIBRARY.map((e) => e.category);

export const specFor = (category: string | undefined): PlanElementSpec =>
  PLAN_LIBRARY.find((e) => e.category === category) ?? { category: 'other', label: 'Objekt', w: 1, d: 1, h: 1, color: '#9e9e9e' };

export const DEFAULT_HOST: StageHost = {
  assets: [],
  lights: [{ id: 'ambient', type: 'ambient', color: '#ffffff', intensity: 0.6 }],
  grid: { enabled: true, size: 30, divisions: 30, snapEnabled: true, snap: 0.5 },
  camera: { position: { x: 6, y: 4, z: 6 }, target: { x: 0, y: 1, z: 0 }, fov: 45 },
};

/**
 * Always returns a usable blocking view (host with a normalised stage holding cameras and
 * characters). Stored documents (cameras in SetDesignState.cameras, characters as 'person' assets)
 * are read through the shared adapter; views pass through unchanged.
 */
export const ensureHost = (raw: SetDesignState | StageHost | null | undefined): StageHost & { stage: StageState } => {
  const base = (raw && typeof raw === 'object' ? raw : DEFAULT_HOST) as StageHost & { cameras?: unknown };
  const filled = {
    ...DEFAULT_HOST,
    ...base,
    assets: Array.isArray(base.assets) ? base.assets : [],
    lights: Array.isArray(base.lights) ? base.lights : DEFAULT_HOST.lights,
    grid: base.grid && typeof base.grid === 'object' ? base.grid : DEFAULT_HOST.grid,
    camera: base.camera && typeof base.camera === 'object' ? base.camera : DEFAULT_HOST.camera,
  };
  if (isStageView(base)) return { ...filled, stage: normalizeStage(base.stage) };
  return readStageHost(filled as never) as unknown as StageHost & { stage: StageState };
};

/** A view carries cameras inside `stage`; a stored document keeps them in `cameras`. */
export const isStageView = (doc: unknown): boolean => {
  const d = doc as { cameras?: unknown; stage?: { cameras?: unknown } } | null;
  return !!d && !Array.isArray(d.cameras) && !!d.stage && Array.isArray(d.stage.cameras);
};

/** Blocking view → stored document (keeps fields the 3D side owns from `base`). */
export const toStoredHost = (view: StageHost & { stage: StageState }, base?: unknown): StageHost => {
  const stored = writeStageHost(view as never, (base && typeof base === 'object' && !isStageView(base) ? base : null) as never) as unknown as StageHost;
  return stored;
};

export type PlanElement = {
  id: string;
  category: PlanCategory;
  label: string;
  x: number;
  z: number;
  /** Bottom height above floor. */
  y: number;
  w: number;
  d: number;
  h: number;
  yawDeg: number;
  color: string;
  /** 'plan' = drawn in the floor plan; 'model' = imported 3D asset shown as footprint. */
  source: 'plan' | 'model';
};

/** Floor-plan reading of an asset. */
export const planElementOf = (asset: PlanAsset): PlanElement => {
  const info = asset.plan;
  const spec = specFor(info?.category);
  const sx = Math.abs(finite(asset.scale?.x, 1, -1e4, 1e4)) || 1;
  const sy = Math.abs(finite(asset.scale?.y, 1, -1e4, 1e4)) || 1;
  const sz = Math.abs(finite(asset.scale?.z, 1, -1e4, 1e4)) || 1;
  const isBox = asset.kind === 'primitive' && (asset.primitive === 'box' || !asset.primitive);
  const isSphere = asset.kind === 'primitive' && asset.primitive === 'sphere';
  const isPlane = asset.kind === 'primitive' && asset.primitive === 'plane';
  const w = info?.footprintM?.w ?? (isSphere ? 1.2 * sx : isPlane ? 3 * sx : isBox ? sx : sx);
  const d = info?.footprintM?.d ?? (isSphere ? 1.2 * sz : isPlane ? 3 * sz : isBox ? sz : sz);
  const h = info?.heightM ?? (isSphere ? 1.2 * sy : isPlane ? 0.01 : sy);
  const centerY = finite(asset.position?.y, 0);
  return {
    id: asset.id,
    category: (info?.category as PlanCategory) || (isPlane ? 'rug' : 'other'),
    label: info?.label || asset.name || spec.label,
    x: finite(asset.position?.x, 0),
    z: finite(asset.position?.z, 0),
    y: isBox || isSphere ? Math.max(0, centerY - h / 2) : Math.max(0, centerY),
    w: Math.max(0.01, w),
    d: Math.max(0.01, d),
    h: Math.max(0.005, h),
    yawDeg: wrapDeg(finite(asset.rotation?.y, 0)),
    color: asset.material?.color || spec.color,
    source: info ? 'plan' : 'model',
  };
};

export const planElements = (host: StageHost): PlanElement[] => host.assets.map(planElementOf);

/** New box asset for a plan element. */
export const createPlanAsset = (input: {
  category: PlanCategory | string;
  x: number;
  z: number;
  w?: number;
  d?: number;
  h?: number;
  yawDeg?: number;
  label?: string;
  color?: string;
  elevation?: number;
  id?: string;
}): PlanAsset => {
  const spec = specFor(input.category);
  const w = finite(input.w, spec.w, 0.01, 500);
  const d = finite(input.d, spec.d, 0.01, 500);
  const h = finite(input.h, spec.h, 0.005, 100);
  const elevation = finite(input.elevation, spec.elevation ?? 0, 0, 100);
  return {
    id: input.id || makeStageId(spec.category),
    name: input.label || spec.label,
    kind: 'primitive',
    primitive: 'box',
    position: { x: finite(input.x, 0), y: elevation + h / 2, z: finite(input.z, 0) },
    rotation: { x: 0, y: wrapDeg(finite(input.yawDeg, 0)), z: 0 },
    scale: { x: w, y: h, z: d },
    material: { color: input.color || spec.color, roughness: 0.8, metalness: 0 },
    plan: { category: spec.category, label: input.label || spec.label, footprintM: { w, d }, heightM: h },
  };
};

/** Patch an element's plan geometry and keep the 3D box in step. */
export const updatePlanAsset = (asset: PlanAsset, patch: Partial<Pick<PlanElement, 'x' | 'z' | 'w' | 'd' | 'h' | 'yawDeg' | 'label' | 'color' | 'y'>>): PlanAsset => {
  const el = planElementOf(asset);
  const w = patch.w !== undefined ? finite(patch.w, el.w, 0.01, 500) : el.w;
  const d = patch.d !== undefined ? finite(patch.d, el.d, 0.01, 500) : el.d;
  const h = patch.h !== undefined ? finite(patch.h, el.h, 0.005, 100) : el.h;
  const bottom = patch.y !== undefined ? finite(patch.y, el.y, 0, 100) : el.y;
  const isPrimitiveBox = asset.kind === 'primitive' && (asset.primitive === 'box' || !asset.primitive);
  const next: PlanAsset = {
    ...asset,
    position: {
      x: patch.x !== undefined ? finite(patch.x, el.x) : asset.position.x,
      y: isPrimitiveBox ? bottom + h / 2 : asset.position.y,
      z: patch.z !== undefined ? finite(patch.z, el.z) : asset.position.z,
    },
    rotation: { ...asset.rotation, y: patch.yawDeg !== undefined ? wrapDeg(finite(patch.yawDeg, el.yawDeg)) : asset.rotation.y },
  };
  if (isPrimitiveBox && (patch.w !== undefined || patch.d !== undefined || patch.h !== undefined)) next.scale = { x: w, y: h, z: d };
  if (patch.color) next.material = { ...(asset.material || {}), color: patch.color };
  if (patch.label !== undefined) next.name = patch.label || asset.name;
  if (asset.plan || isPrimitiveBox) {
    next.plan = {
      category: asset.plan?.category || 'box',
      ...(asset.plan || {}),
      label: patch.label !== undefined ? patch.label : asset.plan?.label,
      footprintM: { w, d },
      heightM: h,
    };
  }
  return next;
};

/** Wall asset between two floor points. */
export const createWall = (x1: number, z1: number, x2: number, z2: number, thickness = 0.15, height = 2.6): PlanAsset => {
  const len = Math.max(0.05, Math.hypot(x2 - x1, z2 - z1));
  // Box local x runs along the wall: yaw so that local +x maps to (dx, dz).
  const yawDeg = (Math.atan2(-(z2 - z1), x2 - x1) * 180) / Math.PI;
  return createPlanAsset({ category: 'wall', x: (x1 + x2) / 2, z: (z1 + z2) / 2, w: len, d: thickness, h: height, yawDeg });
};

/** The four floor corners of an element (world XZ), counter-clockwise from front-left. */
export const elementCorners = (el: Pick<PlanElement, 'x' | 'z' | 'w' | 'd' | 'yawDeg'>): Array<[number, number]> => {
  const a = (el.yawDeg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  // three.js rotation.y: local (lx, lz) → world (lx·cos + lz·sin, −lx·sin + lz·cos)
  const toWorld = (lx: number, lz: number): [number, number] => [el.x + lx * cos + lz * sin, el.z - lx * sin + lz * cos];
  const hw = el.w / 2;
  const hd = el.d / 2;
  return [toWorld(-hw, -hd), toWorld(hw, -hd), toWorld(hw, hd), toWorld(-hw, hd)];
};

/** Wall endpoints (world XZ) of a wall element. */
export const wallEnds = (el: PlanElement): [[number, number], [number, number]] => {
  const a = (el.yawDeg * Math.PI) / 180;
  const hx = (Math.cos(a) * el.w) / 2;
  const hz = (-Math.sin(a) * el.w) / 2;
  return [[el.x - hx, el.z - hz], [el.x + hx, el.z + hz]];
};
