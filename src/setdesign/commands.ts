/**
 * Every set design action is a command: an id, a German label, a menu path, an optional
 * Blender-style shortcut, parameters, and a pure `run`. The UI (buttons, menus, keys) and the
 * agent tools (MCP "ai-video-studio") execute the same commands through the bus in bus.ts.
 *
 * Coordinates in command arguments use the Blender convention (Z up, metres, Euler XYZ in
 * degrees); the scene document stores three.js values (see coords.ts).
 */
import type { SetDesignAsset, SetDesignCamera, SetDesignCameraKeyframe, SetDesignCameraObject, SetDesignLight, SetDesignPrimitive, SetDesignShading, SetDesignState, SetDesignTransform } from '../types';
import { lensForVerticalFov, SENSOR_PRESETS, verticalFovDeg as verticalFov } from './cameraMath.ts';
import { buildPresetKeyframes, cameraFromShot, CAMERA_MOVE_PRESETS, DEFAULT_CAMERA_PATH, evaluateCameraPath, lensMmFromPreset, nextKeyframeTime, sortKeyframes } from './cameraPath.ts';
import { BUILTIN_ASSET_PACKS, getAssetPackItemsByType } from '../data/assetPacks.ts';
import {
  forwardFromRotation,
  fromBlenderLocation,
  fromBlenderRotation,
  fromBlenderScale,
  lookAtRotation,
  toBlenderLocation,
  toBlenderRotation,
  type RotationKind,
} from './coords.ts';
import {
  LIGHT_TYPES,
  PRIMITIVES,
  cameraObjectFromView,
  findSceneObject,
  getActiveCamera,
  getObjectTransform,
  removeSceneObjects,
  replaceSceneObject,
  uniqueName,
  type SceneObjectRef,
} from './sceneModel.ts';

export type ViewPreset = 'user' | 'front' | 'back' | 'right' | 'left' | 'top' | 'bottom';
export type TransformTool = 'select' | 'move' | 'rotate' | 'scale' | 'transform';
export type WorkspaceTab = 'layout' | 'camera' | 'lighting' | 'assets' | 'classic';

/** UI state that agents can also drive (not saved in the project). */
export type SetDesignUiState = {
  selectedIds: string[];
  activeId: string | null;
  lookThroughCamera: boolean;
  ortho: boolean;
  viewPreset: ViewPreset;
  tool: TransformTool;
  workspaceTab: WorkspaceTab;
  overlays: { grid: boolean; thirds: boolean; safeAreas: boolean; passepartout: number; cameraFrames: boolean };
  sidebar: boolean;
  toolbar: boolean;
  /** Navigating in camera view moves the camera (Blender: Lock Camera to View). */
  lockCameraToView: boolean;
  /** Digit row acts as numpad in the viewport. */
  emulateNumpad: boolean;
  /** Transform gizmo orientation. */
  orientation: 'global' | 'local';
  /** Ctrl-free snapping of moves to the grid step. */
  snap: boolean;
};

export const DEFAULT_UI_STATE: SetDesignUiState = {
  selectedIds: [],
  activeId: null,
  lookThroughCamera: false,
  ortho: false,
  viewPreset: 'user',
  tool: 'select',
  workspaceTab: 'layout',
  overlays: { grid: true, thirds: false, safeAreas: false, passepartout: 0.8, cameraFrames: true },
  sidebar: false,
  toolbar: true,
  lockCameraToView: false,
  emulateNumpad: true,
  orientation: 'global',
  snap: false,
};

export type Bounds = { min: SetDesignTransform; max: SetDesignTransform };

/** Capabilities a mounted viewport (or the headless renderer) adds; commands work without them. */
export type CommandServices = {
  /** Real world-space bounds of objects (three.js space); null when unknown. */
  bounds?: (ids: string[] | null) => Bounds | null;
  /** Viewport aspect ratio (width / height). */
  viewportAspect?: () => number;
  /** Storyboard shots of the open project (for camera.from_shot). */
  getShots?: () => Array<{ shot: number; description?: string; lensPresetId?: string; cameraYaw?: number; cameraPitch?: number }>;
};

export type CommandContext = {
  scene: SetDesignState;
  ui: SetDesignUiState;
  makeId: (prefix: string) => string;
  services: CommandServices;
};

export type CommandOutcome = {
  scene?: SetDesignState;
  ui?: Partial<SetDesignUiState>;
  result?: unknown;
  /** Defaults to true when the scene changed. View changes are not undo steps. */
  undoable?: boolean;
};

export type ParamSpec = {
  type: 'string' | 'number' | 'boolean' | 'object' | 'array';
  description: string;
  enum?: string[];
  items?: ParamSpec | { type: string };
  properties?: Record<string, ParamSpec>;
};

export type SetDesignCommand = {
  id: string;
  label: string;
  /** Menu path in the viewport header, e.g. ['Hinzufügen', 'Mesh']. */
  menu?: string[];
  /** Blender-style key, e.g. 'Shift+D'. Display only; keymap.ts binds keys. */
  shortcut?: string;
  description: string;
  params?: Record<string, ParamSpec>;
  required?: string[];
  run: (ctx: CommandContext, args: Record<string, unknown>) => CommandOutcome;
};

// ---------------------------------------------------------------------------
// Argument helpers

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);
const asNumber = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : typeof value === 'string' && value.trim() && Number.isFinite(Number(value)) ? Number(value) : undefined);
const asBool = (value: unknown) => (typeof value === 'boolean' ? value : undefined);

/** Accepts {x,y,z}, [x,y,z] or a single number (uniform). Missing axes come from `fallback`. */
export const asVec = (value: unknown, fallback?: SetDesignTransform): SetDesignTransform | undefined => {
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'number' && Number.isFinite(value)) return { x: value, y: value, z: value };
  if (Array.isArray(value)) {
    const [x, y, z] = value.map((entry) => asNumber(entry));
    if (x === undefined && y === undefined && z === undefined) return undefined;
    return { x: x ?? fallback?.x ?? 0, y: y ?? fallback?.y ?? 0, z: z ?? fallback?.z ?? 0 };
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    const x = asNumber(v.x); const y = asNumber(v.y); const z = asNumber(v.z);
    if (x === undefined && y === undefined && z === undefined) return undefined;
    return { x: x ?? fallback?.x ?? 0, y: y ?? fallback?.y ?? 0, z: z ?? fallback?.z ?? 0 };
  }
  return undefined;
};

const ids = (value: unknown): string[] => {
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === 'string' && !!entry.trim()).map((entry) => entry.trim());
  return [];
};

const requireObject = (ctx: CommandContext, key: unknown): SceneObjectRef => {
  const name = asString(key);
  const ref = name ? findSceneObject(ctx.scene, name) : (ctx.ui.activeId ? findSceneObject(ctx.scene, ctx.ui.activeId) : null);
  if (!ref) throw new Error(name ? `No object "${name}" in the set. Call setdesign_get_scene for ids and names.` : 'No object given and nothing is selected.');
  return ref;
};

const targetIds = (ctx: CommandContext, value: unknown) => {
  const given = ids(value);
  const list = given.length ? given : ctx.ui.selectedIds;
  return list.map((key) => {
    const ref = findSceneObject(ctx.scene, key);
    if (!ref) throw new Error(`No object "${key}" in the set.`);
    return ref.object.id;
  });
};

const rotationKind = (ref: SceneObjectRef): RotationKind => (ref.kind === 'asset' ? 'mesh' : ref.kind);

/** Blender-convention description of one object for agents. */
export const describeObject = (scene: SetDesignState, ref: SceneObjectRef) => {
  const t = getObjectTransform(ref);
  const base = {
    id: ref.object.id,
    name: ref.object.name || ref.object.id,
    location: toBlenderLocation(t.position),
    rotation: toBlenderRotation(t.rotation, rotationKind(ref)),
  };
  if (ref.kind === 'asset') {
    const a = ref.object;
    return {
      ...base,
      type: a.kind === 'model' ? 'model' : a.primitive || 'box',
      scale: { x: a.scale.x, y: a.scale.z, z: a.scale.y },
      ...(a.url ? { url: a.url.startsWith('data:') ? '(embedded)' : a.url } : {}),
      ...(a.material ? { material: a.material } : {}),
      hidden: !!a.hidden,
      locked: !!a.locked,
    };
  }
  if (ref.kind === 'camera') {
    const c = ref.object;
    return {
      ...base,
      type: 'camera',
      active: c.id === scene.activeCameraId,
      lensMm: c.lensMm,
      sensorWidthMm: c.sensorWidthMm,
      sensorHeightMm: c.sensorHeightMm,
      sensorFit: c.sensorFit || 'auto',
      shiftX: c.shiftX || 0,
      shiftY: c.shiftY || 0,
      clipStart: c.clipStart ?? 0.1,
      clipEnd: c.clipEnd ?? 1000,
      focusDistance: c.focusDistance,
      fStop: c.fStop,
      hidden: !!c.hidden,
    };
  }
  const l = ref.object;
  return {
    ...base,
    type: l.type === 'directional' ? 'sun' : l.type,
    color: l.color,
    power: l.power,
    intensity: l.intensity,
    temperature: l.useTemperature ? l.temperature : undefined,
    spotSize: l.spotSize,
    spotBlend: l.spotBlend,
    size: l.size,
    castShadow: l.castShadow ?? true,
    hidden: !!l.hidden,
  };
};

const placeOnFloor = (primitive: SetDesignPrimitive, scale: SetDesignTransform) => {
  const def = PRIMITIVES.find((entry) => entry.id === primitive);
  const height = (def?.size.y ?? 1) * scale.y;
  return primitive === 'plane' ? 0.001 : height / 2;
};

/** Patch fields shared by update commands; returns the patched object. */
const applyObjectPatch = (ref: SceneObjectRef, args: Record<string, unknown>) => {
  const name = asString(args.name);
  const hidden = asBool(args.hidden);
  const locked = asBool(args.locked);
  if (ref.kind === 'asset') {
    const a: SetDesignAsset = { ...ref.object };
    if (name) a.name = name;
    if (hidden !== undefined) a.hidden = hidden;
    if (locked !== undefined) a.locked = locked;
    const material = { ...(a.material || {}) };
    const color = asString(args.color); if (color) material.color = color;
    const roughness = asNumber(args.roughness); if (roughness !== undefined) material.roughness = Math.min(1, Math.max(0, roughness));
    const metalness = asNumber(args.metalness); if (metalness !== undefined) material.metalness = Math.min(1, Math.max(0, metalness));
    const opacity = asNumber(args.opacity); if (opacity !== undefined) { material.opacity = Math.min(1, Math.max(0, opacity)); material.transparent = material.opacity < 1; }
    if (Object.keys(material).length) a.material = material;
    return a;
  }
  if (ref.kind === 'camera') {
    const c: SetDesignCameraObject = { ...ref.object };
    if (name) c.name = name;
    if (hidden !== undefined) c.hidden = hidden;
    if (locked !== undefined) c.locked = locked;
    const lensMm = asNumber(args.lensMm); if (lensMm !== undefined) c.lensMm = Math.min(2000, Math.max(1, lensMm));
    const preset = asString(args.sensorPreset);
    if (preset) {
      const found = SENSOR_PRESETS.find((entry) => entry.id === preset);
      if (!found) throw new Error(`sensorPreset must be one of ${SENSOR_PRESETS.map((entry) => entry.id).join(', ')}.`);
      c.sensorWidthMm = found.widthMm;
      c.sensorHeightMm = found.heightMm;
    }
    const sw = asNumber(args.sensorWidthMm); if (sw !== undefined && sw > 0) c.sensorWidthMm = sw;
    const sh = asNumber(args.sensorHeightMm); if (sh !== undefined && sh > 0) c.sensorHeightMm = sh;
    const fit = asString(args.sensorFit);
    if (fit) {
      if (!['auto', 'horizontal', 'vertical'].includes(fit)) throw new Error('sensorFit must be auto, horizontal or vertical.');
      c.sensorFit = fit as SetDesignCameraObject['sensorFit'];
    }
    const shiftX = asNumber(args.shiftX); if (shiftX !== undefined) c.shiftX = Math.max(-2, Math.min(2, shiftX));
    const shiftY = asNumber(args.shiftY); if (shiftY !== undefined) c.shiftY = Math.max(-2, Math.min(2, shiftY));
    const clipStart = asNumber(args.clipStart); if (clipStart !== undefined && clipStart > 0) c.clipStart = clipStart;
    const clipEnd = asNumber(args.clipEnd); if (clipEnd !== undefined && clipEnd > 0) c.clipEnd = clipEnd;
    const focus = asNumber(args.focusDistance); if (focus !== undefined && focus > 0) c.focusDistance = focus;
    const fStop = asNumber(args.fStop); if (fStop !== undefined && fStop > 0) c.fStop = fStop;
    return c;
  }
  const l: SetDesignLight = { ...ref.object };
  if (name) l.name = name;
  if (hidden !== undefined) l.hidden = hidden;
  const type = asString(args.lightType);
  if (type) {
    if (!['point', 'sun', 'spot', 'area', 'ambient'].includes(type)) throw new Error('lightType must be point, sun, spot, area or ambient.');
    l.type = type as SetDesignLight['type'];
  }
  const color = asString(args.color); if (color) { l.color = color; l.useTemperature = false; }
  const temperature = asNumber(args.temperature); if (temperature !== undefined) { l.temperature = Math.min(20000, Math.max(1000, temperature)); l.useTemperature = true; }
  const power = asNumber(args.power); if (power !== undefined) l.power = Math.max(0, power);
  const intensity = asNumber(args.intensity); if (intensity !== undefined) l.intensity = Math.max(0, intensity);
  const spotSize = asNumber(args.spotSize); if (spotSize !== undefined) l.spotSize = Math.min(180, Math.max(1, spotSize));
  const spotBlend = asNumber(args.spotBlend); if (spotBlend !== undefined) l.spotBlend = Math.min(1, Math.max(0, spotBlend));
  const size = asNumber(args.size); if (size !== undefined) l.size = Math.max(0.01, size);
  const sizeY = asNumber(args.sizeY); if (sizeY !== undefined) l.sizeY = Math.max(0.01, sizeY);
  const castShadow = asBool(args.castShadow); if (castShadow !== undefined) l.castShadow = castShadow;
  return l;
};

const vecParam = (description: string): ParamSpec => ({ type: 'array', description: `${description} [x, y, z]`, items: { type: 'number' } });
const OBJECT_PARAM: ParamSpec = { type: 'string', description: 'Object id or name (default: the active/selected object).' };

const VIEW_DIRECTIONS: Record<Exclude<ViewPreset, 'user'>, SetDesignTransform> = {
  // Direction from target to eye, three.js space (Blender front view looks along +Y_b = -Z_three).
  front: { x: 0, y: 0, z: 1 },
  back: { x: 0, y: 0, z: -1 },
  right: { x: 1, y: 0, z: 0 },
  left: { x: -1, y: 0, z: 0 },
  top: { x: 0, y: 1, z: 0.0001 },
  bottom: { x: 0, y: -1, z: 0.0001 },
};

const approxBounds = (scene: SetDesignState, onlyIds: string[] | null): Bounds | null => {
  const points: SetDesignTransform[] = [];
  const consider = (id: string) => !onlyIds || onlyIds.includes(id);
  for (const asset of scene.assets) {
    if (!consider(asset.id) || asset.hidden) continue;
    const def = PRIMITIVES.find((entry) => entry.id === asset.primitive);
    const half = { x: ((def?.size.x ?? 1) * asset.scale.x) / 2, y: ((def?.size.y || 1) * asset.scale.y) / 2, z: ((def?.size.z ?? 1) * asset.scale.z) / 2 };
    points.push({ x: asset.position.x - half.x, y: asset.position.y - half.y, z: asset.position.z - half.z });
    points.push({ x: asset.position.x + half.x, y: asset.position.y + half.y, z: asset.position.z + half.z });
  }
  for (const camera of scene.cameras || []) if (consider(camera.id)) points.push(camera.position);
  for (const light of scene.lights) if (consider(light.id) && light.position) points.push(light.position);
  if (!points.length) return null;
  return {
    min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: Math.min(...points.map((p) => p.z)) },
    max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: Math.max(...points.map((p) => p.z)) },
  };
};

/** Viewport camera that frames the bounds, keeping the current viewing direction. */
export const frameBounds = (scene: SetDesignState, bounds: Bounds) => {
  const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 };
  const radius = Math.max(0.5, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2);
  const view = scene.camera;
  let dir = { x: view.position.x - view.target.x, y: view.position.y - view.target.y, z: view.position.z - view.target.z };
  const len = Math.hypot(dir.x, dir.y, dir.z) || 1;
  dir = { x: dir.x / len, y: dir.y / len, z: dir.z / len };
  const distance = radius / Math.sin(((view.fov || 45) * Math.PI) / 360) * 1.1;
  return { ...view, target: center, position: { x: center.x + dir.x * distance, y: center.y + dir.y * distance, z: center.z + dir.z * distance } };
};

// ---------------------------------------------------------------------------
// The registry

export const SET_DESIGN_COMMANDS: SetDesignCommand[] = [
  {
    id: 'object.add_primitive',
    label: 'Grundkörper hinzufügen',
    menu: ['Hinzufügen', 'Mesh'],
    shortcut: 'Shift+A',
    description: 'Add a primitive: box, plane, sphere, cylinder, cone, torus, wall (4 × 2.6 m) or person (1.75 m stand-in). It stands on the floor unless a location is given.',
    params: {
      primitive: { type: 'string', description: 'Primitive type.', enum: PRIMITIVES.map((entry) => entry.id) },
      name: { type: 'string', description: 'Object name (default: German type name, made unique).' },
      location: vecParam('Location in metres, Blender convention (Z up).'),
      rotation: vecParam('Rotation in degrees, Blender Euler XYZ.'),
      scale: vecParam('Scale factors.'),
      color: { type: 'string', description: 'Material colour, e.g. #a0a0a0.' },
    },
    required: ['primitive'],
    run: (ctx, args) => {
      const primitive = asString(args.primitive) as SetDesignPrimitive | undefined;
      const def = PRIMITIVES.find((entry) => entry.id === primitive);
      if (!def) throw new Error(`primitive must be one of ${PRIMITIVES.map((entry) => entry.id).join(', ')}.`);
      const scale = fromBlenderScale(asVec(args.scale, { x: 1, y: 1, z: 1 }) || { x: 1, y: 1, z: 1 });
      const location = asVec(args.location);
      const position = location ? fromBlenderLocation(location) : { x: 0, y: placeOnFloor(def.id, scale), z: 0 };
      const asset: SetDesignAsset = {
        id: ctx.makeId('obj'),
        name: uniqueName(ctx.scene, asString(args.name) || def.label),
        kind: 'primitive',
        primitive: def.id,
        position,
        rotation: fromBlenderRotation(asVec(args.rotation) || { x: 0, y: 0, z: 0 }, 'mesh'),
        scale,
        material: { color: asString(args.color) || (def.id === 'person' ? '#b8a48f' : '#b4b4b8'), roughness: 0.8, metalness: 0 },
      };
      return {
        scene: { ...ctx.scene, assets: [...ctx.scene.assets, asset] },
        ui: { selectedIds: [asset.id], activeId: asset.id },
        result: { id: asset.id, name: asset.name },
      };
    },
  },
  {
    id: 'object.add_model',
    label: '3D-Modell importieren',
    menu: ['Hinzufügen', 'Importieren'],
    description: 'Import a 3D model (GLB, glTF, OBJ or FBX) from an https/file URL or a local file path (filePath).',
    params: {
      url: { type: 'string', description: 'https://, file:// or data: URL of the model.' },
      filePath: { type: 'string', description: 'Local file path (the server turns it into a file:// URL).' },
      name: { type: 'string', description: 'Object name.' },
      format: { type: 'string', description: 'glb, gltf, obj or fbx (default: from the file extension).', enum: ['glb', 'gltf', 'obj', 'fbx'] },
      mediaId: { type: 'string', description: 'Project media item that holds the file (keeps imported files with the project).' },
      attribution: { type: 'object', description: 'Credit for downloaded models: { author, license, url }.' },
      location: vecParam('Location in metres, Blender convention (Z up).'),
      rotation: vecParam('Rotation in degrees, Blender Euler XYZ.'),
      scale: vecParam('Scale factors.'),
    },
    run: (ctx, args) => {
      const url = asString(args.url) || asString(args.filePath);
      if (!url) throw new Error('Pass url or filePath.');
      const extension = (asString(args.format) || url.split('?')[0].split('#')[0].split('.').pop() || '').toLowerCase();
      if (!['glb', 'gltf', 'obj', 'fbx'].includes(extension)) throw new Error('Supported formats: glb, gltf, obj, fbx. Pass format when the URL has no extension.');
      const fileName = decodeURIComponent(url.split('?')[0].split('/').pop() || 'Modell').replace(/\.[a-z0-9]+$/i, '');
      const asset: SetDesignAsset = {
        id: ctx.makeId('obj'),
        name: uniqueName(ctx.scene, asString(args.name) || fileName || 'Modell'),
        kind: 'model',
        format: extension as SetDesignAsset['format'],
        url,
        ...(asString(args.mediaId) ? { mediaId: asString(args.mediaId) } : {}),
        ...(args.attribution && typeof args.attribution === 'object' ? { attribution: { author: String((args.attribution as Record<string, unknown>).author || ''), license: String((args.attribution as Record<string, unknown>).license || ''), ...((args.attribution as Record<string, unknown>).url ? { url: String((args.attribution as Record<string, unknown>).url) } : {}) } } : {}),
        position: fromBlenderLocation(asVec(args.location) || { x: 0, y: 0, z: 0 }),
        rotation: fromBlenderRotation(asVec(args.rotation) || { x: 0, y: 0, z: 0 }, 'mesh'),
        scale: fromBlenderScale(asVec(args.scale, { x: 1, y: 1, z: 1 }) || { x: 1, y: 1, z: 1 }),
      };
      return {
        scene: { ...ctx.scene, assets: [...ctx.scene.assets, asset] },
        ui: { selectedIds: [asset.id], activeId: asset.id },
        result: { id: asset.id, name: asset.name },
      };
    },
  },
  {
    id: 'object.add_camera',
    label: 'Kamera hinzufügen',
    menu: ['Hinzufügen', 'Kamera'],
    description: 'Add a scene camera with focal length and sensor. Aim it with lookAt (a point or an object name) or rotation. By default it becomes the active camera.',
    params: {
      name: { type: 'string', description: 'Camera name.' },
      location: vecParam('Location in metres, Blender convention (Z up). Default: the current viewport position.'),
      rotation: vecParam('Rotation in degrees, Blender Euler XYZ (90, 0, 0 looks level along +Y).'),
      lookAt: { type: 'string', description: 'Object id/name to aim at (alternative: lookAtPoint).' },
      lookAtPoint: vecParam('Point to aim at, Blender convention.'),
      lensMm: { type: 'number', description: 'Focal length in mm (default 35).' },
      sensorPreset: { type: 'string', description: 'Sensor size preset.', enum: SENSOR_PRESETS.map((entry) => entry.id) },
      sensorWidthMm: { type: 'number', description: 'Sensor width in mm (default 24.89, Super 35).' },
      makeActive: { type: 'boolean', description: 'Make it the active camera (default true).' },
    },
    run: (ctx, args) => {
      const location = asVec(args.location);
      const base = cameraObjectFromView(ctx.scene.camera, ctx.makeId('cam'), 'Kamera');
      let camera: SetDesignCameraObject = {
        ...base,
        name: uniqueName(ctx.scene, asString(args.name) || 'Kamera'),
        position: location ? fromBlenderLocation(location) : base.position,
        lensMm: 35,
        sensorWidthMm: 24.89,
        sensorHeightMm: 18.66,
      };
      const rotation = asVec(args.rotation);
      if (rotation) camera.rotation = fromBlenderRotation(rotation, 'camera');
      const target = resolveAimTarget(ctx, args);
      if (target) camera.rotation = lookAtRotation(camera.position, target);
      else if (!rotation && location) camera.rotation = lookAtRotation(camera.position, ctx.scene.camera.target);
      camera = applyObjectPatch({ kind: 'camera', index: -1, object: camera }, { ...args, name: undefined }) as SetDesignCameraObject;
      const makeActive = asBool(args.makeActive) ?? true;
      return {
        scene: { ...ctx.scene, cameras: [...(ctx.scene.cameras || []), camera], activeCameraId: makeActive ? camera.id : ctx.scene.activeCameraId },
        ui: { selectedIds: [camera.id], activeId: camera.id },
        result: { id: camera.id, name: camera.name, active: makeActive },
      };
    },
  },
  {
    id: 'object.add_light',
    label: 'Licht hinzufügen',
    menu: ['Hinzufügen', 'Licht'],
    description: 'Add a light: point, sun, spot or area. Power in watts like Blender (sun: W/m², about 3–10 for daylight). Aim spot/area/sun with lookAt or rotation.',
    params: {
      lightType: { type: 'string', description: 'Light type.', enum: ['point', 'sun', 'spot', 'area'] },
      name: { type: 'string', description: 'Light name.' },
      location: vecParam('Location in metres, Blender convention (Z up).'),
      rotation: vecParam('Rotation in degrees, Blender Euler XYZ (0, 0, 0 shines straight down).'),
      lookAt: { type: 'string', description: 'Object id/name to aim at.' },
      lookAtPoint: vecParam('Point to aim at, Blender convention.'),
      power: { type: 'number', description: 'Power in W (sun: W/m²).' },
      color: { type: 'string', description: 'Light colour, e.g. #ffd9b0.' },
      temperature: { type: 'number', description: 'Colour temperature in kelvin (replaces color), e.g. 3200 tungsten, 5600 daylight.' },
      spotSize: { type: 'number', description: 'Spot cone angle in degrees.' },
      spotBlend: { type: 'number', description: 'Spot edge softness 0..1.' },
      size: { type: 'number', description: 'Area light size in metres.' },
      castShadow: { type: 'boolean', description: 'Cast shadows (default true).' },
    },
    required: ['lightType'],
    run: (ctx, args) => {
      const type = asString(args.lightType) as SetDesignLight['type'] | undefined;
      const def = LIGHT_TYPES.find((entry) => entry.id === type);
      if (!def) throw new Error('lightType must be point, sun, spot or area.');
      const position = fromBlenderLocation(asVec(args.location) || { x: 2, y: -2, z: 3 });
      let light: SetDesignLight = {
        id: ctx.makeId('light'),
        name: uniqueName(ctx.scene, asString(args.name) || def.label),
        type: def.id,
        color: '#ffffff',
        intensity: 1,
        power: def.defaultPower,
        position,
        rotation: lookAtRotation(position, { x: 0, y: 0, z: 0 }),
        castShadow: true,
        ...(def.id === 'spot' ? { spotSize: 45, spotBlend: 0.15 } : {}),
        ...(def.id === 'area' ? { size: 1 } : {}),
      };
      const rotation = asVec(args.rotation);
      if (rotation) light.rotation = fromBlenderRotation(rotation, 'light');
      const target = resolveAimTarget(ctx, args);
      if (target) light.rotation = lookAtRotation(position, target);
      light = applyObjectPatch({ kind: 'light', index: -1, object: light }, { ...args, name: undefined, lightType: undefined }) as SetDesignLight;
      return {
        scene: { ...ctx.scene, lights: [...ctx.scene.lights, light] },
        ui: { selectedIds: [light.id], activeId: light.id },
        result: { id: light.id, name: light.name },
      };
    },
  },
  {
    id: 'object.transform',
    label: 'Transformieren',
    menu: ['Objekt', 'Transformieren'],
    shortcut: 'G / R / S',
    description: 'Set location, rotation and/or scale of an object (Blender convention: Z up, metres, degrees). With relative=true the values are added (location, rotation) or multiplied (scale).',
    params: {
      object: OBJECT_PARAM,
      location: vecParam('Location in metres.'),
      rotation: vecParam('Rotation in degrees, Euler XYZ.'),
      scale: vecParam('Scale factors (meshes and models only).'),
      relative: { type: 'boolean', description: 'Add/multiply instead of set.' },
    },
    run: (ctx, args) => {
      const ref = requireObject(ctx, args.object);
      if ('locked' in ref.object && ref.object.locked) throw new Error(`${ref.object.name} is locked.`);
      const kind = rotationKind(ref);
      const t = getObjectTransform(ref);
      const relative = asBool(args.relative) ?? false;
      const currentLoc = toBlenderLocation(t.position);
      const currentRot = toBlenderRotation(t.rotation, kind);
      const currentScale = { x: t.scale.x, y: t.scale.z, z: t.scale.y };
      const loc = asVec(args.location, relative ? { x: 0, y: 0, z: 0 } : currentLoc);
      const rot = asVec(args.rotation, relative ? { x: 0, y: 0, z: 0 } : currentRot);
      const scl = asVec(args.scale, relative ? { x: 1, y: 1, z: 1 } : currentScale);
      if (!loc && !rot && !scl) throw new Error('Pass location, rotation or scale.');
      const next: Record<string, unknown> = { ...ref.object };
      if (loc) next.position = fromBlenderLocation(relative ? { x: currentLoc.x + loc.x, y: currentLoc.y + loc.y, z: currentLoc.z + loc.z } : loc);
      if (rot) next.rotation = fromBlenderRotation(relative ? { x: currentRot.x + rot.x, y: currentRot.y + rot.y, z: currentRot.z + rot.z } : rot, kind);
      if (scl) {
        if (ref.kind !== 'asset') throw new Error('Only meshes and models have a scale. Change lensMm (cameras) or size/power (lights) instead.');
        next.scale = fromBlenderScale(relative ? { x: currentScale.x * scl.x, y: currentScale.y * scl.y, z: currentScale.z * scl.z } : scl);
      }
      const scene = replaceSceneObject(ctx.scene, ref, next as never);
      return { scene, result: describeObject(scene, findSceneObject(scene, ref.object.id)!) };
    },
  },
  {
    id: 'object.update',
    label: 'Eigenschaften ändern',
    menu: ['Objekt'],
    description: 'Change object properties: name, hidden, locked; meshes: color, roughness, metalness, opacity; cameras: lensMm, sensorPreset, sensorWidthMm, sensorHeightMm, sensorFit, shiftX, shiftY, clipStart, clipEnd, focusDistance, fStop; lights: lightType, power, color, temperature, spotSize, spotBlend, size, sizeY, castShadow.',
    params: {
      object: OBJECT_PARAM,
      name: { type: 'string', description: 'New name.' },
      hidden: { type: 'boolean', description: 'Hide in viewport and renders.' },
      locked: { type: 'boolean', description: 'Lock against selection/moving in the viewport.' },
      color: { type: 'string', description: 'Material or light colour.' },
      roughness: { type: 'number', description: 'Material roughness 0..1.' },
      metalness: { type: 'number', description: 'Material metalness 0..1.' },
      opacity: { type: 'number', description: 'Material opacity 0..1.' },
      lensMm: { type: 'number', description: 'Camera focal length in mm.' },
      sensorPreset: { type: 'string', description: 'Camera sensor preset.', enum: SENSOR_PRESETS.map((entry) => entry.id) },
      sensorWidthMm: { type: 'number', description: 'Camera sensor width in mm.' },
      sensorHeightMm: { type: 'number', description: 'Camera sensor height in mm.' },
      sensorFit: { type: 'string', description: 'auto, horizontal or vertical.', enum: ['auto', 'horizontal', 'vertical'] },
      shiftX: { type: 'number', description: 'Lens shift X (fraction of the larger frame side).' },
      shiftY: { type: 'number', description: 'Lens shift Y.' },
      clipStart: { type: 'number', description: 'Near clip in metres.' },
      clipEnd: { type: 'number', description: 'Far clip in metres.' },
      focusDistance: { type: 'number', description: 'Focus distance in metres.' },
      fStop: { type: 'number', description: 'Aperture f-stop.' },
      lightType: { type: 'string', description: 'Light type.', enum: ['point', 'sun', 'spot', 'area'] },
      power: { type: 'number', description: 'Light power in W (sun: W/m²).' },
      temperature: { type: 'number', description: 'Light colour temperature in kelvin.' },
      spotSize: { type: 'number', description: 'Spot cone angle in degrees.' },
      spotBlend: { type: 'number', description: 'Spot softness 0..1.' },
      size: { type: 'number', description: 'Area light size in metres.' },
      sizeY: { type: 'number', description: 'Area light height in metres (rectangle).' },
      castShadow: { type: 'boolean', description: 'Light casts shadows.' },
    },
    run: (ctx, args) => {
      const ref = requireObject(ctx, args.object);
      const patch = { ...args };
      if (patch.name) patch.name = uniqueName({ ...ctx.scene, assets: ctx.scene.assets.filter((a) => a.id !== ref.object.id), cameras: (ctx.scene.cameras || []).filter((c) => c.id !== ref.object.id), lights: ctx.scene.lights.filter((l) => l.id !== ref.object.id) }, String(patch.name));
      const next = applyObjectPatch(ref, patch);
      const scene = replaceSceneObject(ctx.scene, ref, next);
      const hiddenNow = 'hidden' in next && next.hidden;
      return {
        scene,
        ui: hiddenNow ? { selectedIds: ctx.ui.selectedIds.filter((id) => id !== ref.object.id), activeId: ctx.ui.activeId === ref.object.id ? null : ctx.ui.activeId } : undefined,
        result: describeObject(scene, findSceneObject(scene, ref.object.id)!),
      };
    },
  },
  {
    id: 'object.duplicate',
    label: 'Duplizieren',
    menu: ['Objekt'],
    shortcut: 'Shift+D',
    description: 'Duplicate objects (default: the selection). The copies are offset by `offset` (Blender convention, default [0.5, 0.5, 0]) and become the selection.',
    params: {
      objects: { type: 'array', description: 'Object ids or names.', items: { type: 'string' } },
      offset: vecParam('Offset in metres.'),
    },
    run: (ctx, args) => {
      const list = targetIds(ctx, args.objects);
      if (!list.length) throw new Error('Nothing to duplicate: pass objects or select something.');
      const offset = fromBlenderLocation(asVec(args.offset) || { x: 0.5, y: 0.5, z: 0 });
      let scene = ctx.scene;
      const created: Array<{ id: string; name: string }> = [];
      for (const id of list) {
        const ref = findSceneObject(scene, id)!;
        const copyId = ctx.makeId(ref.kind === 'asset' ? 'obj' : ref.kind === 'camera' ? 'cam' : 'light');
        const position = ref.object.position || { x: 0, y: 0, z: 0 };
        const copy = { ...ref.object, id: copyId, name: uniqueName(scene, ref.object.name || 'Objekt'), position: { x: position.x + offset.x, y: position.y + offset.y, z: position.z + offset.z } };
        if (ref.kind === 'asset') scene = { ...scene, assets: [...scene.assets, copy as SetDesignAsset] };
        else if (ref.kind === 'camera') scene = { ...scene, cameras: [...(scene.cameras || []), copy as SetDesignCameraObject] };
        else scene = { ...scene, lights: [...scene.lights, copy as SetDesignLight] };
        created.push({ id: copyId, name: copy.name || copyId });
      }
      return { scene, ui: { selectedIds: created.map((c) => c.id), activeId: created[created.length - 1].id }, result: { created } };
    },
  },
  {
    id: 'object.delete',
    label: 'Löschen',
    menu: ['Objekt'],
    shortcut: 'X / Entf',
    description: 'Delete objects (default: the selection). The last camera cannot be deleted.',
    params: { objects: { type: 'array', description: 'Object ids or names.', items: { type: 'string' } } },
    run: (ctx, args) => {
      const list = targetIds(ctx, args.objects);
      if (!list.length) throw new Error('Nothing to delete: pass objects or select something.');
      const cameras = (ctx.scene.cameras || []).filter((camera) => !list.includes(camera.id));
      if ((ctx.scene.cameras || []).length > 0 && cameras.length === 0) throw new Error('The set needs at least one camera.');
      const scene = removeSceneObjects(ctx.scene, list);
      return { scene, ui: { selectedIds: [], activeId: null }, result: { deleted: list } };
    },
  },
  {
    id: 'select.set',
    label: 'Auswählen',
    menu: ['Auswahl'],
    description: 'Select objects. mode: replace (default), add, remove or toggle. An empty list with mode replace deselects all.',
    params: {
      objects: { type: 'array', description: 'Object ids or names.', items: { type: 'string' } },
      mode: { type: 'string', description: 'Selection mode.', enum: ['replace', 'add', 'remove', 'toggle'] },
    },
    run: (ctx, args) => {
      const given = ids(args.objects).map((key) => {
        const ref = findSceneObject(ctx.scene, key);
        if (!ref) throw new Error(`No object "${key}" in the set.`);
        return ref.object.id;
      });
      const mode = asString(args.mode) || 'replace';
      let selected = [...ctx.ui.selectedIds];
      if (mode === 'replace') selected = given;
      else if (mode === 'add') selected = [...new Set([...selected, ...given])];
      else if (mode === 'remove') selected = selected.filter((id) => !given.includes(id));
      else if (mode === 'toggle') for (const id of given) selected = selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id];
      else throw new Error('mode must be replace, add, remove or toggle.');
      const activeId = mode === 'remove' ? (selected.includes(ctx.ui.activeId || '') ? ctx.ui.activeId : selected[selected.length - 1] || null) : given[given.length - 1] || (selected.includes(ctx.ui.activeId || '') ? ctx.ui.activeId : null);
      return { ui: { selectedIds: selected, activeId }, undoable: false, result: { selected } };
    },
  },
  {
    id: 'select.all',
    label: 'Alles auswählen / abwählen',
    menu: ['Auswahl'],
    shortcut: 'A / Alt+A',
    description: 'Select all visible, unlocked objects, or deselect all with deselect=true.',
    params: { deselect: { type: 'boolean', description: 'Deselect everything.' } },
    run: (ctx, args) => {
      if (asBool(args.deselect)) return { ui: { selectedIds: [], activeId: null }, undoable: false, result: { selected: [] } };
      const all = [...ctx.scene.assets.filter((a) => !a.hidden && !a.locked), ...(ctx.scene.cameras || []).filter((c) => !c.hidden && !c.locked), ...ctx.scene.lights.filter((l) => !l.hidden && l.type !== 'ambient')].map((o) => o.id);
      return { ui: { selectedIds: all, activeId: ctx.ui.activeId && all.includes(ctx.ui.activeId) ? ctx.ui.activeId : all[all.length - 1] || null }, undoable: false, result: { selected: all } };
    },
  },
  {
    id: 'object.hide',
    label: 'Ausblenden / Einblenden',
    menu: ['Objekt', 'Sichtbarkeit'],
    shortcut: 'H / Alt+H',
    description: 'Hide objects (default: the selection), or with unhideAll=true show every hidden object again.',
    params: {
      objects: { type: 'array', description: 'Object ids or names.', items: { type: 'string' } },
      unhideAll: { type: 'boolean', description: 'Show all hidden objects.' },
    },
    run: (ctx, args) => {
      if (asBool(args.unhideAll)) {
        const shown = [...ctx.scene.assets, ...(ctx.scene.cameras || []), ...ctx.scene.lights].filter((o) => o.hidden).map((o) => o.id);
        return {
          scene: {
            ...ctx.scene,
            assets: ctx.scene.assets.map((a) => (a.hidden ? { ...a, hidden: false } : a)),
            cameras: (ctx.scene.cameras || []).map((c) => (c.hidden ? { ...c, hidden: false } : c)),
            lights: ctx.scene.lights.map((l) => (l.hidden ? { ...l, hidden: false } : l)),
          },
          ui: { selectedIds: shown, activeId: shown[shown.length - 1] || null },
          result: { shown },
        };
      }
      const list = targetIds(ctx, args.objects);
      if (!list.length) throw new Error('Nothing to hide: pass objects or select something.');
      const hide = <T extends { id: string; hidden?: boolean }>(o: T) => (list.includes(o.id) ? { ...o, hidden: true } : o);
      return {
        scene: { ...ctx.scene, assets: ctx.scene.assets.map(hide), cameras: (ctx.scene.cameras || []).map(hide), lights: ctx.scene.lights.map(hide) },
        ui: { selectedIds: ctx.ui.selectedIds.filter((id) => !list.includes(id)), activeId: list.includes(ctx.ui.activeId || '') ? null : ctx.ui.activeId },
        result: { hidden: list },
      };
    },
  },
  {
    id: 'object.aim',
    label: 'Ausrichten auf …',
    menu: ['Objekt'],
    description: 'Point a camera or light at a point or another object (no roll).',
    params: {
      object: OBJECT_PARAM,
      lookAt: { type: 'string', description: 'Object id/name to aim at.' },
      lookAtPoint: vecParam('Point to aim at, Blender convention.'),
    },
    run: (ctx, args) => {
      const ref = requireObject(ctx, args.object);
      if (ref.kind === 'asset') throw new Error('Only cameras and lights can be aimed.');
      const target = resolveAimTarget(ctx, args);
      if (!target) throw new Error('Pass lookAt or lookAtPoint.');
      const scene = replaceSceneObject(ctx.scene, ref, { ...ref.object, rotation: lookAtRotation(ref.object.position || { x: 0, y: 0, z: 0 }, target) } as never);
      return { scene, result: describeObject(scene, findSceneObject(scene, ref.object.id)!) };
    },
  },
  {
    id: 'camera.set_active',
    label: 'Als aktive Kamera setzen',
    menu: ['Ansicht', 'Kameras'],
    shortcut: 'Strg+Num0',
    description: 'Make a camera the active scene camera (used for camera view and reference frames).',
    params: { object: OBJECT_PARAM },
    run: (ctx, args) => {
      const ref = requireObject(ctx, args.object);
      if (ref.kind !== 'camera') throw new Error(`${ref.object.name} is not a camera.`);
      return { scene: { ...ctx.scene, activeCameraId: ref.object.id }, result: { activeCamera: ref.object.name } };
    },
  },
  {
    id: 'camera.from_view',
    label: 'Aktive Kamera an Ansicht ausrichten',
    menu: ['Ansicht', 'Kameras'],
    shortcut: 'Strg+Alt+Num0',
    description: 'Move and aim the active camera so it sees what the viewport sees.',
    run: (ctx) => {
      const camera = getActiveCamera(ctx.scene);
      if (!camera) throw new Error('The set has no camera.');
      const ref = findSceneObject(ctx.scene, camera.id)!;
      const view = ctx.scene.camera;
      const scene = replaceSceneObject(ctx.scene, ref, { ...camera, position: { ...view.position }, rotation: lookAtRotation(view.position, view.target) });
      return { scene, ui: { lookThroughCamera: true }, result: describeObject(scene, findSceneObject(scene, camera.id)!) };
    },
  },
  {
    id: 'view.camera',
    label: 'Durch Kamera schauen',
    menu: ['Ansicht'],
    shortcut: 'Num0',
    description: 'Look through the active camera (on=true), back to the free viewport (on=false), or toggle. Optionally pick the camera.',
    params: { on: { type: 'boolean', description: 'true = camera view, false = free view; omit to toggle.' }, object: { type: 'string', description: 'Camera id/name to activate first.' } },
    run: (ctx, args) => {
      let scene: SetDesignState | undefined;
      if (asString(args.object)) {
        const ref = requireObject(ctx, args.object);
        if (ref.kind !== 'camera') throw new Error(`${ref.object.name} is not a camera.`);
        scene = { ...ctx.scene, activeCameraId: ref.object.id };
      }
      const on = asBool(args.on) ?? !ctx.ui.lookThroughCamera;
      return { scene, ui: { lookThroughCamera: on, viewPreset: on ? ctx.ui.viewPreset : 'user' }, undoable: false, result: { lookThroughCamera: on, camera: getActiveCamera(scene || ctx.scene)?.name } };
    },
  },
  {
    id: 'view.preset',
    label: 'Ansicht wählen',
    menu: ['Ansicht', 'Blickpunkt'],
    shortcut: 'Num1 / Num3 / Num7 (+Strg)',
    description: 'Viewport angle like Blender numpad views: front, back, right, left, top, bottom. Leaves camera view.',
    params: { view: { type: 'string', description: 'View.', enum: ['front', 'back', 'right', 'left', 'top', 'bottom'] }, ortho: { type: 'boolean', description: 'Orthographic (default true for these views, like Blender auto-perspective).' } },
    required: ['view'],
    run: (ctx, args) => {
      const view = asString(args.view) as Exclude<ViewPreset, 'user'> | undefined;
      if (!view || !(view in VIEW_DIRECTIONS)) throw new Error('view must be front, back, right, left, top or bottom.');
      const dir = VIEW_DIRECTIONS[view];
      const current = ctx.scene.camera;
      const distance = Math.max(2, Math.hypot(current.position.x - current.target.x, current.position.y - current.target.y, current.position.z - current.target.z));
      const camera = { ...current, position: { x: current.target.x + dir.x * distance, y: current.target.y + dir.y * distance, z: current.target.z + dir.z * distance } };
      return { scene: { ...ctx.scene, camera }, ui: { viewPreset: view, ortho: asBool(args.ortho) ?? true, lookThroughCamera: false }, undoable: false, result: { view } };
    },
  },
  {
    id: 'view.toggle_ortho',
    label: 'Perspektive / Orthografisch',
    menu: ['Ansicht'],
    shortcut: 'Num5',
    description: 'Switch the viewport between perspective and orthographic.',
    params: { ortho: { type: 'boolean', description: 'Set explicitly instead of toggling.' } },
    run: (ctx, args) => {
      const ortho = asBool(args.ortho) ?? !ctx.ui.ortho;
      return { ui: { ortho }, undoable: false, result: { ortho } };
    },
  },
  {
    id: 'view.frame',
    label: 'Ansicht einpassen',
    menu: ['Ansicht'],
    shortcut: 'Pos1 / Num,',
    description: 'Frame all objects (what=all) or the selection (what=selected) in the viewport.',
    params: { what: { type: 'string', description: 'all or selected.', enum: ['all', 'selected'] } },
    run: (ctx, args) => {
      const selected = asString(args.what) === 'selected';
      const only = selected ? ctx.ui.selectedIds : null;
      if (selected && !only?.length) throw new Error('Nothing selected.');
      const bounds = ctx.services.bounds?.(only) || approxBounds(ctx.scene, only) || { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 2, z: 2 } };
      return { scene: { ...ctx.scene, camera: frameBounds(ctx.scene, bounds) }, ui: { lookThroughCamera: false }, undoable: false, result: { framed: selected ? 'selected' : 'all' } };
    },
  },
  {
    id: 'view.set',
    label: 'Ansicht setzen',
    menu: ['Ansicht'],
    description: 'Place the free viewport camera: eye location, target point (Blender convention) and vertical field of view.',
    params: { location: vecParam('Eye location.'), target: vecParam('Point to look at.'), fov: { type: 'number', description: 'Vertical field of view in degrees.' } },
    run: (ctx, args) => {
      const location = asVec(args.location);
      const target = asVec(args.target);
      const fov = asNumber(args.fov);
      const camera = {
        position: location ? fromBlenderLocation(location) : ctx.scene.camera.position,
        target: target ? fromBlenderLocation(target) : ctx.scene.camera.target,
        fov: fov !== undefined ? Math.min(120, Math.max(5, fov)) : ctx.scene.camera.fov,
      };
      return { scene: { ...ctx.scene, camera }, ui: { lookThroughCamera: false, viewPreset: 'user' }, undoable: false, result: { location: toBlenderLocation(camera.position), target: toBlenderLocation(camera.target), fov: camera.fov } };
    },
  },
  {
    id: 'view.options',
    label: 'Ansichtsoptionen',
    menu: ['Ansicht'],
    description: 'Viewport options: lockCameraToView (navigating in camera view moves the camera), emulateNumpad (digit row = numpad), orientation (global/local gizmo), snap (moves snap to the grid step).',
    params: {
      lockCameraToView: { type: 'boolean', description: 'Navigating in camera view moves the active camera.' },
      emulateNumpad: { type: 'boolean', description: 'Digit row acts as numpad.' },
      orientation: { type: 'string', description: 'Gizmo orientation.', enum: ['global', 'local'] },
      snap: { type: 'boolean', description: 'Snap moves to the grid step.' },
    },
    run: (ctx, args) => {
      const patch: Partial<SetDesignUiState> = {};
      for (const key of ['lockCameraToView', 'emulateNumpad', 'snap'] as const) {
        const value = asBool(args[key]);
        if (value !== undefined) patch[key] = value;
      }
      const orientation = asString(args.orientation);
      if (orientation) {
        if (orientation !== 'global' && orientation !== 'local') throw new Error('orientation must be global or local.');
        patch.orientation = orientation;
      }
      return { ui: patch, undoable: false, result: { ...ctx.ui, ...patch } };
    },
  },
  {
    id: 'view.shading',
    label: 'Shading',
    menu: ['Ansicht', 'Shading'],
    shortcut: 'Z',
    description: 'Viewport shading: wireframe, solid (clay, no scene lights), material (materials + environment) or rendered (scene lights and shadows). Also used for reference frames.',
    params: { mode: { type: 'string', description: 'Shading mode.', enum: ['wireframe', 'solid', 'material', 'rendered'] } },
    required: ['mode'],
    run: (ctx, args) => {
      const mode = asString(args.mode) as SetDesignShading | undefined;
      if (!mode || !['wireframe', 'solid', 'material', 'rendered'].includes(mode)) throw new Error('mode must be wireframe, solid, material or rendered.');
      return { scene: { ...ctx.scene, shading: mode }, undoable: false, result: { shading: mode } };
    },
  },
  {
    id: 'view.overlays',
    label: 'Überlagerungen',
    menu: ['Ansicht', 'Überlagerungen'],
    description: 'Viewport overlays: grid, rule-of-thirds guides and safe areas in camera view, passepartout darkness (0..1) outside the camera frame, camera frustums.',
    params: {
      grid: { type: 'boolean', description: 'Floor grid.' },
      thirds: { type: 'boolean', description: 'Rule-of-thirds guides in camera view.' },
      safeAreas: { type: 'boolean', description: 'Title/action safe areas in camera view.' },
      passepartout: { type: 'number', description: 'Darkening outside the camera frame, 0..1.' },
      cameraFrames: { type: 'boolean', description: 'Show camera frustums.' },
    },
    run: (ctx, args) => {
      const overlays = { ...ctx.ui.overlays };
      for (const key of ['grid', 'thirds', 'safeAreas', 'cameraFrames'] as const) {
        const value = asBool(args[key]);
        if (value !== undefined) overlays[key] = value;
      }
      const passepartout = asNumber(args.passepartout);
      if (passepartout !== undefined) overlays.passepartout = Math.min(1, Math.max(0, passepartout));
      return { ui: { overlays }, undoable: false, result: overlays };
    },
  },
  {
    id: 'scene.output',
    label: 'Ausgabeformat',
    menu: ['Ansicht', 'Ausgabe'],
    description: 'Size of the camera frame and reference frames in pixels, e.g. 1920×1080 (16:9), 2048×858 (2.39:1), 1080×1920 (9:16).',
    params: { width: { type: 'number', description: 'Width in px.' }, height: { type: 'number', description: 'Height in px.' } },
    required: ['width', 'height'],
    run: (ctx, args) => {
      const width = asNumber(args.width); const height = asNumber(args.height);
      if (!width || !height || width < 16 || height < 16 || width > 8192 || height > 8192) throw new Error('width and height must be between 16 and 8192 px.');
      const output = { width: Math.round(width), height: Math.round(height) };
      return { scene: { ...ctx.scene, output }, result: output };
    },
  },
  {
    id: 'scene.world',
    label: 'Welt / Umgebung',
    menu: ['Ansicht', 'Welt'],
    description: 'World background colour and ambient strength.',
    params: { color: { type: 'string', description: 'Background colour.' }, strength: { type: 'number', description: 'Ambient strength 0..5.' } },
    run: (ctx, args) => {
      const world = { ...(ctx.scene.world || { color: '#3d3d40', strength: 0.6 }) };
      const color = asString(args.color); if (color) world.color = color;
      const strength = asNumber(args.strength); if (strength !== undefined) world.strength = Math.min(5, Math.max(0, strength));
      return { scene: { ...ctx.scene, world }, result: world };
    },
  },
  {
    id: 'cameraPath.add_keyframe',
    label: 'Kamerafahrt: Keyframe setzen',
    menu: ['Ansicht', 'Kamerafahrt'],
    shortcut: 'I',
    description: 'Add a keyframe to the camera move (viewport camera path). from=view (default) takes the free view, from=camera the active scene camera; or pass location/target/fov. time defaults to 2 s after the last keyframe.',
    params: {
      time: { type: 'number', description: 'Time in seconds.' },
      from: { type: 'string', description: 'Pose source.', enum: ['view', 'camera'] },
      location: vecParam('Eye location (Blender convention).'),
      target: vecParam('Look-at point (Blender convention).'),
      fov: { type: 'number', description: 'Vertical field of view in degrees.' },
      label: { type: 'string', description: 'Keyframe label.' },
    },
    run: (ctx, args) => {
      const path = ctx.scene.cameraPath || DEFAULT_CAMERA_PATH;
      const pose = keyframePose(ctx, args);
      const time = asNumber(args.time) ?? nextKeyframeTime(path);
      if (time < 0) throw new Error('time must be 0 or more.');
      const keyframe: SetDesignCameraKeyframe = { id: ctx.makeId('kf'), time, camera: pose, ...(asString(args.label) ? { label: asString(args.label) } : {}) };
      const cameraPath = { ...path, keyframes: sortKeyframes([...path.keyframes, keyframe]), durationSeconds: Math.max(path.durationSeconds, time) };
      return { scene: { ...ctx.scene, cameraPath }, result: { id: keyframe.id, time, keyframes: cameraPath.keyframes.length } };
    },
  },
  {
    id: 'cameraPath.update_keyframe',
    label: 'Kamerafahrt: Keyframe ändern',
    menu: ['Ansicht', 'Kamerafahrt'],
    description: 'Change a camera move keyframe: time, label, location/target (Blender convention) or fov.',
    params: {
      id: { type: 'string', description: 'Keyframe id (see setdesign_get_camera_path).' },
      time: { type: 'number', description: 'Time in seconds.' },
      label: { type: 'string', description: 'Label.' },
      location: vecParam('Eye location.'),
      target: vecParam('Look-at point.'),
      fov: { type: 'number', description: 'Vertical field of view in degrees.' },
    },
    required: ['id'],
    run: (ctx, args) => {
      const path = ctx.scene.cameraPath || DEFAULT_CAMERA_PATH;
      const id = asString(args.id);
      const existing = path.keyframes.find((kf) => kf.id === id);
      if (!existing) throw new Error(`No keyframe ${id}.`);
      const location = asVec(args.location); const target = asVec(args.target); const fov = asNumber(args.fov); const time = asNumber(args.time);
      const updated: SetDesignCameraKeyframe = {
        ...existing,
        ...(time !== undefined ? { time: Math.max(0, time) } : {}),
        ...(asString(args.label) ? { label: asString(args.label) } : {}),
        camera: {
          position: location ? fromBlenderLocation(location) : existing.camera.position,
          target: target ? fromBlenderLocation(target) : existing.camera.target,
          fov: fov !== undefined ? Math.min(120, Math.max(5, fov)) : existing.camera.fov,
        },
      };
      const keyframes = sortKeyframes(path.keyframes.map((kf) => (kf.id === id ? updated : kf)));
      return { scene: { ...ctx.scene, cameraPath: { ...path, keyframes, durationSeconds: Math.max(path.durationSeconds, updated.time) } }, result: { id, time: updated.time } };
    },
  },
  {
    id: 'cameraPath.remove_keyframes',
    label: 'Kamerafahrt: Keyframes löschen',
    menu: ['Ansicht', 'Kamerafahrt'],
    description: 'Remove camera move keyframes by id, or all with all=true.',
    params: { ids: { type: 'array', description: 'Keyframe ids.', items: { type: 'string' } }, all: { type: 'boolean', description: 'Remove every keyframe.' } },
    run: (ctx, args) => {
      const path = ctx.scene.cameraPath || DEFAULT_CAMERA_PATH;
      const all = asBool(args.all) === true;
      const remove = all ? path.keyframes.map((kf) => kf.id) : ids(args.ids);
      if (!all && !remove.length) throw new Error('Pass ids or all=true.');
      const unknown = remove.filter((id) => !path.keyframes.some((kf) => kf.id === id));
      if (unknown.length) throw new Error(`No keyframe ${unknown.join(', ')}.`);
      const keyframes = path.keyframes.filter((kf) => !remove.includes(kf.id));
      return { scene: { ...ctx.scene, cameraPath: { ...path, keyframes } }, result: { removed: path.keyframes.length - keyframes.length, keyframes: keyframes.length } };
    },
  },
  {
    id: 'cameraPath.settings',
    label: 'Kamerafahrt: Einstellungen',
    menu: ['Ansicht', 'Kamerafahrt'],
    description: 'Camera move settings: durationSeconds, fps, loop, easing (smooth or linear). With preset (push-in, orbit, crane-up, dolly-left) the keyframes are replaced by that move, starting from the free view (from=view) or the active camera (from=camera).',
    params: {
      durationSeconds: { type: 'number', description: 'Length in seconds.' },
      fps: { type: 'number', description: 'Frames per second for recording.' },
      loop: { type: 'boolean', description: 'Loop playback.' },
      easing: { type: 'string', description: 'Timing between keyframes.', enum: ['smooth', 'linear'] },
      preset: { type: 'string', description: 'Replace keyframes with a move preset.', enum: CAMERA_MOVE_PRESETS.map((p) => p.id) },
      from: { type: 'string', description: 'Start pose for the preset.', enum: ['view', 'camera'] },
    },
    run: (ctx, args) => {
      let path = { ...(ctx.scene.cameraPath || DEFAULT_CAMERA_PATH) };
      const duration = asNumber(args.durationSeconds); if (duration !== undefined) path.durationSeconds = Math.min(600, Math.max(0.5, duration));
      const fps = asNumber(args.fps); if (fps !== undefined) path.fps = Math.round(Math.min(120, Math.max(1, fps)));
      const loop = asBool(args.loop); if (loop !== undefined) path.loop = loop;
      const easing = asString(args.easing);
      if (easing) {
        if (easing !== 'smooth' && easing !== 'linear') throw new Error('easing must be smooth or linear.');
        path.easing = easing;
      }
      const preset = asString(args.preset);
      if (preset) path = { ...path, keyframes: buildPresetKeyframes(preset, keyframePose(ctx, { from: args.from }), Math.max(2, path.durationSeconds || 6), () => ctx.makeId('kf')) };
      return { scene: { ...ctx.scene, cameraPath: path }, result: { durationSeconds: path.durationSeconds, fps: path.fps, loop: !!path.loop, easing: path.easing || 'smooth', keyframes: path.keyframes.length } };
    },
  },
  {
    id: 'cameraPath.seek',
    label: 'Kamerafahrt: Zeitpunkt zeigen',
    menu: ['Ansicht', 'Kamerafahrt'],
    description: 'Show the camera move at a time: the free viewport jumps to the pose at that second (leaves camera view).',
    params: { time: { type: 'number', description: 'Time in seconds.' } },
    required: ['time'],
    run: (ctx, args) => {
      const path = ctx.scene.cameraPath;
      const time = asNumber(args.time) ?? 0;
      const pose = evaluateCameraPath(path, Math.max(0, time));
      if (!pose) throw new Error('The camera move has no keyframes yet.');
      return { scene: { ...ctx.scene, camera: pose }, ui: { lookThroughCamera: false, viewPreset: 'user' }, undoable: false, result: { time, location: toBlenderLocation(pose.position), target: toBlenderLocation(pose.target), fov: pose.fov } };
    },
  },
  {
    id: 'camera.from_shot',
    label: 'Kamera aus Storyboard-Shot',
    menu: ['Ansicht', 'Kameras'],
    description: 'Set up the view from a storyboard shot (its lens preset, camera yaw and pitch). apply=view moves the free view (as the classic page did), apply=camera also moves the active camera and sets its focal length.',
    params: { shotNumber: { type: 'number', description: 'Storyboard shot number.' }, apply: { type: 'string', description: 'What to move.', enum: ['view', 'camera'] } },
    required: ['shotNumber'],
    run: (ctx, args) => {
      const number = asNumber(args.shotNumber);
      const shots = ctx.services.getShots?.() || [];
      const shot = shots.find((entry) => entry.shot === number);
      if (!shot) throw new Error(shots.length ? `No storyboard shot ${number}. Shots: ${shots.map((s) => s.shot).join(', ')}.` : 'The project has no storyboard shots.');
      const pose = cameraFromShot(shot);
      let scene: SetDesignState = { ...ctx.scene, camera: pose };
      const result: Record<string, unknown> = { shot: shot.shot, location: toBlenderLocation(pose.position), target: toBlenderLocation(pose.target), fov: pose.fov };
      if (asString(args.apply) === 'camera') {
        const active = getActiveCamera(scene);
        if (!active) throw new Error('The set has no camera.');
        const ref = findSceneObject(scene, active.id)!;
        const lensMm = lensMmFromPreset(shot.lensPresetId) ?? lensForVerticalFov(pose.fov, active, (scene.output?.width || 16) / (scene.output?.height || 9));
        scene = replaceSceneObject(scene, ref, { ...active, position: { ...pose.position }, rotation: lookAtRotation(pose.position, pose.target), lensMm });
        result.camera = active.name;
        result.lensMm = lensMm;
      }
      return { scene, ui: { lookThroughCamera: asString(args.apply) === 'camera' }, result };
    },
  },
  {
    id: 'material.preset',
    label: 'Material-Preset anwenden',
    menu: ['Objekt', 'Material'],
    description: 'Apply a material preset from the built-in packs (see setdesign_list_presets) to meshes (default: the selection).',
    params: { preset: { type: 'string', description: 'Material preset id.' }, objects: { type: 'array', description: 'Object ids or names.', items: { type: 'string' } } },
    required: ['preset'],
    run: (ctx, args) => {
      const presets = getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'material').filter((item) => item.metadata);
      const item = presets.find((entry) => entry.id === asString(args.preset) || entry.label.toLowerCase() === String(args.preset).toLowerCase());
      if (!item) throw new Error(`Unknown material preset. Use one of: ${presets.map((p) => p.id).join(', ')}.`);
      const meta = item.metadata as Record<string, unknown>;
      const list = targetIds(ctx, args.objects).filter((id) => findSceneObject(ctx.scene, id)?.kind === 'asset');
      if (!list.length) throw new Error('Select or pass meshes/models.');
      const scene = { ...ctx.scene, assets: ctx.scene.assets.map((asset) => (list.includes(asset.id) ? { ...asset, material: { ...asset.material, ...(typeof meta.color === 'string' ? { color: meta.color } : {}), ...(typeof meta.roughness === 'number' ? { roughness: meta.roughness } : {}), ...(typeof meta.metalness === 'number' ? { metalness: meta.metalness } : {}) } } : asset)) };
      return { scene, result: { preset: item.label, objects: list.length } };
    },
  },
  {
    id: 'scene.hdri',
    label: 'Umgebungs-HDRI',
    menu: ['Ansicht', 'Welt'],
    description: 'Environment map for lighting (material preview, rendered, reference frames and the classic page): a .hdr/.exr URL or local file (filePath), shown as background or not; clear=true removes it.',
    params: {
      url: { type: 'string', description: 'https:// or file:// URL of a .hdr/.exr file.' },
      filePath: { type: 'string', description: 'Local .hdr/.exr path.' },
      background: { type: 'boolean', description: 'Show it as background.' },
      strength: { type: 'number', description: 'Lighting strength (default 1).' },
      clear: { type: 'boolean', description: 'Remove the environment map.' },
    },
    run: (ctx, args) => {
      const world = { ...(ctx.scene.world || { color: '#3d3d40', strength: 1 }) };
      if (asBool(args.clear)) {
        delete world.hdriUrl; delete world.hdriBackground; delete world.hdriStrength;
        return { scene: { ...ctx.scene, world }, result: { hdri: null } };
      }
      const url = asString(args.url) || asString(args.filePath);
      if (url) {
        if (!/\.(hdr|exr)(\?|#|$)/i.test(url)) throw new Error('Use a .hdr or .exr file.');
        world.hdriUrl = url;
      }
      if (!world.hdriUrl) throw new Error('Pass url or filePath (or clear=true).');
      const background = asBool(args.background); if (background !== undefined) world.hdriBackground = background;
      const strength = asNumber(args.strength); if (strength !== undefined) world.hdriStrength = Math.min(10, Math.max(0, strength));
      return { scene: { ...ctx.scene, world }, result: { hdri: world.hdriUrl, background: !!world.hdriBackground, strength: world.hdriStrength ?? 1 } };
    },
  },
  {
    id: 'tool.set',
    label: 'Werkzeug wählen',
    menu: ['Werkzeuge'],
    shortcut: 'W / G / R / S / T',
    description: 'Active viewport tool: select, move, rotate, scale or transform (gizmos).',
    params: { tool: { type: 'string', description: 'Tool.', enum: ['select', 'move', 'rotate', 'scale', 'transform'] } },
    required: ['tool'],
    run: (ctx, args) => {
      const tool = asString(args.tool) as TransformTool | undefined;
      if (!tool || !['select', 'move', 'rotate', 'scale', 'transform'].includes(tool)) throw new Error('tool must be select, move, rotate, scale or transform.');
      return { ui: { tool }, undoable: false, result: { tool } };
    },
  },
  {
    id: 'workspace.tab',
    label: 'Arbeitsbereich wechseln',
    description: 'Switch the set design tab: layout, camera, lighting, assets (AI and library imports) or classic (the previous page).',
    params: { tab: { type: 'string', description: 'Tab.', enum: ['layout', 'camera', 'lighting', 'assets', 'classic'] } },
    required: ['tab'],
    run: (ctx, args) => {
      const tab = asString(args.tab) as WorkspaceTab | undefined;
      if (!tab || !['layout', 'camera', 'lighting', 'assets', 'classic'].includes(tab)) throw new Error('tab must be layout, camera, lighting, assets or classic.');
      return { ui: { workspaceTab: tab }, undoable: false, result: { tab } };
    },
  },
];

/** Pose for a camera move keyframe from args (explicit), the active camera or the free view. */
function keyframePose(ctx: CommandContext, args: Record<string, unknown>): SetDesignCamera {
  const view = ctx.scene.camera;
  let pose: SetDesignCamera = { position: { ...view.position }, target: { ...view.target }, fov: view.fov || 45 };
  if (asString(args.from) === 'camera') {
    const camera = getActiveCamera(ctx.scene);
    if (!camera) throw new Error('The set has no camera.');
    const forward = forwardFromRotation(camera.rotation);
    const distance = camera.focusDistance || 5;
    const output = ctx.scene.output || { width: 1920, height: 1080 };
    pose = {
      position: { ...camera.position },
      target: { x: camera.position.x + forward.x * distance, y: camera.position.y + forward.y * distance, z: camera.position.z + forward.z * distance },
      fov: verticalFov(camera, output.width / output.height),
    };
  }
  const location = asVec(args.location); const target = asVec(args.target); const fov = asNumber(args.fov);
  if (location) pose.position = fromBlenderLocation(location);
  if (target) pose.target = fromBlenderLocation(target);
  if (fov !== undefined) pose.fov = Math.min(120, Math.max(5, fov));
  return pose;
}

/** Resolve lookAt (object) or lookAtPoint (Blender coords) to a three.js point. */
function resolveAimTarget(ctx: CommandContext, args: Record<string, unknown>): SetDesignTransform | null {
  const objectKey = asString(args.lookAt);
  if (objectKey) {
    const ref = findSceneObject(ctx.scene, objectKey);
    if (!ref) throw new Error(`No object "${objectKey}" to aim at.`);
    // Primitives are centred on their position, so this aims at their middle.
    return { ...(ref.object.position || { x: 0, y: 0, z: 0 }) };
  }
  const point = asVec(args.lookAtPoint);
  return point ? fromBlenderLocation(point) : null;
}

export const getCommand = (id: string) => SET_DESIGN_COMMANDS.find((command) => command.id === id);

/** Short list for agents and the command search. */
export const listCommands = () => SET_DESIGN_COMMANDS.map((command) => ({
  id: command.id,
  label: command.label,
  menu: command.menu?.join(' › '),
  shortcut: command.shortcut,
  description: command.description,
  params: command.params ? Object.fromEntries(Object.entries(command.params).map(([key, spec]) => [key, spec.description + (spec.enum ? ` (${spec.enum.join(', ')})` : '')])) : {},
  required: command.required || [],
}));

/** Look direction of the active camera, Blender convention (for agents). */
export const activeCameraForward = (scene: SetDesignState) => {
  const camera = getActiveCamera(scene);
  return camera ? toBlenderLocation(forwardFromRotation(camera.rotation)) : null;
};
