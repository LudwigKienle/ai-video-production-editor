/**
 * Scene document for the set design workspace: defaults, migration of older projects, and a
 * single object list (meshes, models, cameras, lights) as the outliner shows it.
 * Pure functions only; three.js objects are built in sceneBuilder.ts.
 */
import type {
  SetDesignAsset,
  SetDesignCamera,
  SetDesignCameraObject,
  SetDesignLight,
  SetDesignPrimitive,
  SetDesignState,
  SetDesignTransform,
} from '../types';
import { lensForVerticalFov } from './cameraMath.ts';
import { lookAtRotation } from './coords.ts';

export type SceneObjectKind = 'asset' | 'camera' | 'light';

export type SceneObjectRef =
  | { kind: 'asset'; index: number; object: SetDesignAsset }
  | { kind: 'camera'; index: number; object: SetDesignCameraObject }
  | { kind: 'light'; index: number; object: SetDesignLight };

export type OutlinerItem = {
  id: string;
  name: string;
  kind: SceneObjectKind;
  /** primitive name, 'model', camera, or light type. */
  type: string;
  hidden: boolean;
  locked: boolean;
  active: boolean;
};

export const DEFAULT_OUTPUT = { width: 1920, height: 1080 };
export const DEFAULT_WORLD = { color: '#3d3d40', strength: 1 };

export const PRIMITIVES: Array<{ id: SetDesignPrimitive; label: string; size: SetDesignTransform; hint: string }> = [
  { id: 'box', label: 'Würfel', size: { x: 1, y: 1, z: 1 }, hint: '1 × 1 × 1 m' },
  { id: 'plane', label: 'Ebene', size: { x: 2, y: 0, z: 2 }, hint: '2 × 2 m, liegt auf dem Boden' },
  { id: 'sphere', label: 'Kugel', size: { x: 1, y: 1, z: 1 }, hint: 'Durchmesser 1 m' },
  { id: 'cylinder', label: 'Zylinder', size: { x: 1, y: 1, z: 1 }, hint: 'Durchmesser 1 m, Höhe 1 m' },
  { id: 'cone', label: 'Kegel', size: { x: 1, y: 1, z: 1 }, hint: 'Durchmesser 1 m, Höhe 1 m' },
  { id: 'torus', label: 'Torus', size: { x: 1.3, y: 0.3, z: 1.3 }, hint: 'Ring, Außendurchmesser 1,3 m' },
  { id: 'wall', label: 'Wand', size: { x: 4, y: 2.6, z: 0.12 }, hint: '4 m breit, 2,60 m hoch, 12 cm stark' },
  { id: 'person', label: 'Stand-in', size: { x: 0.5, y: 1.75, z: 0.3 }, hint: 'Platzhalterfigur, 1,75 m groß' },
];

export const LIGHT_TYPES: Array<{ id: SetDesignLight['type']; label: string; defaultPower: number }> = [
  { id: 'point', label: 'Punktlicht', defaultPower: 1000 },
  { id: 'sun', label: 'Sonne', defaultPower: 3 },
  { id: 'spot', label: 'Spot', defaultPower: 1000 },
  { id: 'area', label: 'Flächenlicht', defaultPower: 200 },
];

const zero = (): SetDesignTransform => ({ x: 0, y: 0, z: 0 });
const one = (): SetDesignTransform => ({ x: 1, y: 1, z: 1 });
const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const vec = (value: unknown, fallback: SetDesignTransform): SetDesignTransform => {
  const v = (value || {}) as Partial<SetDesignTransform>;
  return {
    x: isFiniteNumber(v.x) ? v.x : fallback.x,
    y: isFiniteNumber(v.y) ? v.y : fallback.y,
    z: isFiniteNumber(v.z) ? v.z : fallback.z,
  };
};

export const makeSceneId = (prefix: string) =>
  `${prefix}-${typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(16).slice(2, 10)}`;

/** Viewport camera → a scene camera with the same view (36 mm sensor, 16:9). */
export const cameraObjectFromView = (view: SetDesignCamera, id: string, name = 'Kamera', aspect = 16 / 9): SetDesignCameraObject => ({
  id,
  name,
  position: { ...view.position },
  rotation: lookAtRotation(view.position, view.target),
  lensMm: lensForVerticalFov(view.fov || 45, { sensorWidthMm: 36 }, aspect),
  sensorWidthMm: 36,
  sensorFit: 'auto',
  shiftX: 0,
  shiftY: 0,
  clipStart: 0.1,
  clipEnd: 1000,
});

export const createDefaultSetDesignState = (): SetDesignState => {
  const view: SetDesignCamera = { position: { x: 6, y: 4, z: 6 }, target: { x: 0, y: 1, z: 0 }, fov: 45 };
  const camera: SetDesignCameraObject = {
    ...cameraObjectFromView({ position: { x: 4.5, y: 1.6, z: 5.5 }, target: { x: 0, y: 1.2, z: 0 }, fov: 30 }, 'camera-main'),
    lensMm: 35,
    sensorWidthMm: 24.89,
    sensorHeightMm: 18.66,
  };
  return {
    assets: [],
    lights: [
      { id: 'light-key', name: 'Sonne', type: 'directional', color: '#ffffff', intensity: 1.2, position: { x: 5, y: 8, z: 5 }, rotation: lookAtRotation({ x: 5, y: 8, z: 5 }, zero()), power: 3, castShadow: true },
    ],
    grid: { enabled: true, size: 30, divisions: 30, snapEnabled: false, snap: 0.5 },
    camera: view,
    cameras: [camera],
    activeCameraId: camera.id,
    output: { ...DEFAULT_OUTPUT },
    shading: 'solid',
    world: { ...DEFAULT_WORLD },
  };
};

const lightLabel = (type: SetDesignLight['type']) =>
  type === 'ambient' ? 'Umgebungslicht' : type === 'directional' ? 'Sonne' : LIGHT_TYPES.find((entry) => entry.id === type)?.label || 'Licht';

/**
 * Bring any stored set design (older projects included) into the current shape without
 * dropping fields the workspace does not know about. Projects without scene cameras get one
 * made from their viewport camera, so camera view and reference frames work right away.
 */
export const normalizeSetDesignState = (raw: SetDesignState | null | undefined): SetDesignState => {
  if (!raw || typeof raw !== 'object') return createDefaultSetDesignState();
  const base = createDefaultSetDesignState();
  const view: SetDesignCamera = raw.camera
    ? { position: vec(raw.camera.position, base.camera.position), target: vec(raw.camera.target, base.camera.target), fov: isFiniteNumber(raw.camera.fov) ? raw.camera.fov : 45 }
    : base.camera;
  const assets = (Array.isArray(raw.assets) ? raw.assets : []).filter(Boolean).map((asset, index) => ({
    ...asset,
    id: asset.id || `asset-${index + 1}`,
    name: asset.name || (asset.kind === 'primitive' ? PRIMITIVES.find((p) => p.id === asset.primitive)?.label || 'Objekt' : 'Modell'),
    position: vec(asset.position, zero()),
    rotation: vec(asset.rotation, zero()),
    scale: vec(asset.scale, one()),
  }));
  const lights = (Array.isArray(raw.lights) ? raw.lights : base.lights).filter(Boolean).map((light, index) => ({
    ...light,
    id: light.id || `light-${index + 1}`,
    name: light.name || lightLabel(light.type),
    color: light.color || '#ffffff',
    intensity: isFiniteNumber(light.intensity) ? light.intensity : 1,
  }));
  let cameras = (Array.isArray(raw.cameras) ? raw.cameras : []).filter(Boolean).map((camera, index) => ({
    ...camera,
    id: camera.id || `camera-${index + 1}`,
    name: camera.name || 'Kamera',
    position: vec(camera.position, base.cameras![0].position),
    rotation: vec(camera.rotation, zero()),
    lensMm: isFiniteNumber(camera.lensMm) && camera.lensMm > 0 ? camera.lensMm : 50,
    sensorWidthMm: isFiniteNumber(camera.sensorWidthMm) && camera.sensorWidthMm > 0 ? camera.sensorWidthMm : 36,
  }));
  const output = raw.output && isFiniteNumber(raw.output.width) && isFiniteNumber(raw.output.height) && raw.output.width > 0 && raw.output.height > 0
    ? { width: Math.round(raw.output.width), height: Math.round(raw.output.height) }
    : { ...DEFAULT_OUTPUT };
  if (cameras.length === 0) cameras = [cameraObjectFromView(view, 'camera-main', 'Kamera', output.width / output.height)];
  const activeCameraId = cameras.some((camera) => camera.id === raw.activeCameraId) ? raw.activeCameraId! : cameras[0].id;
  return {
    ...raw,
    assets,
    lights,
    grid: { ...base.grid, ...(raw.grid || {}) },
    camera: view,
    cameras,
    activeCameraId,
    output,
    shading: raw.shading || 'solid',
    world: { ...DEFAULT_WORLD, ...(raw.world || {}) },
  };
};

export const getActiveCamera = (state: SetDesignState): SetDesignCameraObject | null =>
  (state.cameras || []).find((camera) => camera.id === state.activeCameraId) || (state.cameras || [])[0] || null;

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Find an object by id, or else by (case-insensitive) name. */
export const findSceneObject = (state: SetDesignState, key: string | { id?: string; name?: string }): SceneObjectRef | null => {
  const id = typeof key === 'string' ? key : key.id;
  const name = typeof key === 'string' ? key : key.name;
  const lists: Array<[SceneObjectKind, Array<{ id: string; name?: string }>]> = [
    ['asset', state.assets],
    ['camera', state.cameras || []],
    ['light', state.lights],
  ];
  for (const match of [(o: { id: string }) => !!id && o.id === id, (o: { name?: string }) => !!name && !!o.name && sameName(o.name, name)]) {
    for (const [kind, list] of lists) {
      const index = list.findIndex(match as (o: { id: string; name?: string }) => boolean);
      if (index >= 0) return { kind, index, object: list[index] } as SceneObjectRef;
    }
  }
  return null;
};

/** Blender-style unique names: "Würfel", "Würfel.001", "Würfel.002" … */
export const uniqueName = (state: SetDesignState, wanted: string) => {
  const base = wanted.trim().replace(/\.\d{3}$/, '') || 'Objekt';
  const taken = new Set([...state.assets, ...(state.cameras || []), ...state.lights].map((o) => (o.name || '').toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 1; n < 1000; n += 1) {
    const candidate = `${base}.${String(n).padStart(3, '0')}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${base}.${Date.now()}`;
};

export const outlinerItems = (state: SetDesignState): OutlinerItem[] => [
  ...(state.cameras || []).map((camera) => ({
    id: camera.id, name: camera.name, kind: 'camera' as const, type: 'camera', hidden: !!camera.hidden, locked: !!camera.locked, active: camera.id === state.activeCameraId,
  })),
  ...state.lights.map((light) => ({
    id: light.id, name: light.name || lightLabel(light.type), kind: 'light' as const, type: light.type === 'directional' ? 'sun' : light.type, hidden: !!light.hidden, locked: false, active: false,
  })),
  ...state.assets.map((asset) => ({
    id: asset.id, name: asset.name, kind: 'asset' as const, type: asset.kind === 'model' ? 'model' : asset.primitive || 'box', hidden: !!asset.hidden, locked: !!asset.locked, active: false,
  })),
].sort((a, b) => a.name.localeCompare(b.name, 'de'));

/** Position/rotation/scale of any object (lights and cameras have unit scale). */
export const getObjectTransform = (ref: SceneObjectRef) => ({
  position: ref.object.position ? { ...ref.object.position } : zero(),
  rotation: 'rotation' in ref.object && ref.object.rotation ? { ...ref.object.rotation } : zero(),
  scale: ref.kind === 'asset' ? { ...ref.object.scale } : one(),
});

/** Replace one object (found by ref) in the state, immutably. */
export const replaceSceneObject = (state: SetDesignState, ref: SceneObjectRef, next: SetDesignAsset | SetDesignCameraObject | SetDesignLight): SetDesignState => {
  if (ref.kind === 'asset') return { ...state, assets: state.assets.map((o, i) => (i === ref.index ? next as SetDesignAsset : o)) };
  if (ref.kind === 'camera') return { ...state, cameras: (state.cameras || []).map((o, i) => (i === ref.index ? next as SetDesignCameraObject : o)) };
  return { ...state, lights: state.lights.map((o, i) => (i === ref.index ? next as SetDesignLight : o)) };
};

export const removeSceneObjects = (state: SetDesignState, ids: string[]): SetDesignState => {
  const drop = new Set(ids);
  const cameras = (state.cameras || []).filter((camera) => !drop.has(camera.id));
  return {
    ...state,
    assets: state.assets.filter((asset) => !drop.has(asset.id)),
    lights: state.lights.filter((light) => !drop.has(light.id)),
    cameras,
    activeCameraId: cameras.some((camera) => camera.id === state.activeCameraId) ? state.activeCameraId : cameras[0]?.id || null,
  };
};
