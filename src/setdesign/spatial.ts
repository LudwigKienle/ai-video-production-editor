/**
 * Spatial queries over a set design: world bounding boxes, floor contact, overlaps, distances
 * and what a camera sees. Used by setdesign_query / setdesign_describe_scene and by the layout
 * commands (drop to floor, align, place on).
 *
 * Bounds:
 * - primitives: analytic (their defined size, see PRIMITIVES; pivot = box centre),
 * - models: the loaded geometry when a viewport/loader has measured it (CommandServices
 *   .modelBounds), otherwise an estimate of 1 × 1 × 1 m standing on its origin, marked 'estimate',
 * - groups: the union of their contents.
 * Boxes are axis-aligned in world space (a rotated object's box encloses its rotated corners).
 * Computation in three.js space; everything returned to agents is in Blender convention.
 */
import * as THREE from 'three';
import type { SetDesignAsset, SetDesignCameraObject, SetDesignState, SetDesignTransform } from '../types';
import type { Bounds, CommandServices } from './commands.ts';
import { verticalFovDeg, viewOffsetForShift } from './cameraMath.ts';
import { assetMap, ancestorIds, isEffectivelyHidden, parentOf, worldMatrix } from './hierarchy.ts';
import { PRIMITIVES, getActiveCamera } from './sceneModel.ts';

export type BoundsSource = 'analytic' | 'geometry' | 'estimate' | 'children' | 'empty';
export type WorldBox = { box: Bounds; source: BoundsSource };

const DEG = Math.PI / 180;
export const CONTACT_TOLERANCE = 0.01;

const r3 = (value: number) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? 0 : rounded;
};

/** Size and pivot of a primitive in its own axes (three.js space, centred on the origin). */
export const primitiveLocalBox = (primitive: SetDesignAsset['primitive']): Bounds => {
  const def = PRIMITIVES.find((entry) => entry.id === primitive) || PRIMITIVES[0];
  const half = { x: def.size.x / 2, y: def.size.y / 2, z: def.size.z / 2 };
  return { min: { x: -half.x, y: -half.y, z: -half.z }, max: half };
};

/** A model whose geometry is unknown: 1 × 1 × 1 m standing on its origin (glTF convention). */
export const MODEL_ESTIMATE: Bounds = { min: { x: -0.5, y: 0, z: -0.5 }, max: { x: 0.5, y: 1, z: 0.5 } };

export const assetLocalBox = (asset: SetDesignAsset, services: CommandServices = {}): WorldBox | null => {
  if (asset.kind === 'group') return null;
  if (asset.kind === 'primitive') return { box: primitiveLocalBox(asset.primitive), source: 'analytic' };
  const measured = services.modelBounds?.(asset);
  return measured ? { box: measured, source: 'geometry' } : { box: MODEL_ESTIMATE, source: 'estimate' };
};

const transformBox = (box: Bounds, matrix: THREE.Matrix4): Bounds => {
  const out = new THREE.Box3();
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) {
    out.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
  }
  return { min: { x: out.min.x, y: out.min.y, z: out.min.z }, max: { x: out.max.x, y: out.max.y, z: out.max.z } };
};

const union = (a: Bounds | null, b: Bounds): Bounds => (!a ? { min: { ...b.min }, max: { ...b.max } } : {
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
});

/** World boxes (three.js space) of every asset. Groups enclose their contents. */
export const worldBoxes = (scene: SetDesignState, services: CommandServices = {}): Map<string, WorldBox> => {
  const cache = new Map<string, THREE.Matrix4>();
  const out = new Map<string, WorldBox>();
  const map = assetMap(scene);
  for (const asset of scene.assets) {
    const local = assetLocalBox(asset, services);
    if (local) out.set(asset.id, { box: transformBox(local.box, worldMatrix(scene, asset.id, cache)), source: local.source });
  }
  // Groups (and parents in general) accumulate their descendants' boxes.
  const groups = new Map<string, { box: Bounds | null; source: BoundsSource }>();
  for (const asset of scene.assets) {
    const own = out.get(asset.id);
    if (!own) continue;
    let cursor = parentOf(scene, asset, map);
    while (cursor) {
      if (cursor.kind === 'group') {
        const current = groups.get(cursor.id) || { box: null, source: 'children' as BoundsSource };
        groups.set(cursor.id, { box: union(current.box, own.box), source: own.source === 'estimate' ? 'estimate' : current.source });
      }
      cursor = parentOf(scene, cursor, map);
    }
  }
  for (const asset of scene.assets) {
    if (asset.kind !== 'group') continue;
    const found = groups.get(asset.id);
    if (found?.box) out.set(asset.id, { box: found.box, source: found.source });
    else {
      const p = new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, asset.id, cache));
      out.set(asset.id, { box: { min: { x: p.x, y: p.y, z: p.z }, max: { x: p.x, y: p.y, z: p.z } }, source: 'empty' });
    }
  }
  return out;
};

export const worldBoxOf = (scene: SetDesignState, id: string, services: CommandServices = {}) => worldBoxes(scene, services).get(id) || null;

// ---------------------------------------------------------------------------
// Blender-convention output

export type BlenderBox = { min: [number, number, number]; max: [number, number, number] };

/** three.js box → Blender box (x, y = -z, z = y). */
export const toBlenderBox = (box: Bounds): BlenderBox => ({
  min: [r3(box.min.x), r3(-box.max.z), r3(box.min.y)],
  max: [r3(box.max.x), r3(-box.min.z), r3(box.max.y)],
});
const dims = (b: BlenderBox): [number, number, number] => [r3(b.max[0] - b.min[0]), r3(b.max[1] - b.min[1]), r3(b.max[2] - b.min[2])];
const centre = (b: BlenderBox): [number, number, number] => [r3((b.max[0] + b.min[0]) / 2), r3((b.max[1] + b.min[1]) / 2), r3((b.max[2] + b.min[2]) / 2)];

/** Size of each axis gap between two boxes (negative = penetration). */
const axisGaps = (a: Bounds, b: Bounds) => ({
  x: Math.max(a.min.x, b.min.x) - Math.min(a.max.x, b.max.x),
  y: Math.max(a.min.y, b.min.y) - Math.min(a.max.y, b.max.y),
  z: Math.max(a.min.z, b.min.z) - Math.min(a.max.z, b.max.z),
});

export const boxDistance = (a: Bounds, b: Bounds) => {
  const g = axisGaps(a, b);
  return Math.hypot(Math.max(0, g.x), Math.max(0, g.y), Math.max(0, g.z));
};

// ---------------------------------------------------------------------------
// Camera view

export type CameraHit = {
  id: string;
  name: string;
  /** Approximate share of the frame covered by the object's screen-space box, in %. */
  framePercent: number;
  horizontal: 'left' | 'center' | 'right';
  vertical: 'top' | 'middle' | 'bottom';
  /** The object's box extends past the frame edge. */
  cropped: boolean;
  distance: number;
};

export const buildQueryCamera = (camera: SetDesignCameraObject, width: number, height: number) => {
  const aspect = width / height;
  const three = new THREE.PerspectiveCamera(verticalFovDeg(camera, aspect), aspect, camera.clipStart ?? 0.1, camera.clipEnd ?? 1000);
  three.position.set(camera.position.x, camera.position.y, camera.position.z);
  three.rotation.set(camera.rotation.x * DEG, camera.rotation.y * DEG, camera.rotation.z * DEG, 'XYZ');
  const offset = viewOffsetForShift(camera.shiftX, camera.shiftY, width, height);
  if (offset.x || offset.y) three.setViewOffset(width, height, offset.x, offset.y, width, height);
  three.updateProjectionMatrix();
  three.updateMatrixWorld();
  return three;
};

/** Screen-space box of a world box in normalised device coordinates, or null when behind the camera. */
const projectBox = (box: Bounds, camera: THREE.PerspectiveCamera) => {
  const view = camera.matrixWorldInverse;
  const corners: THREE.Vector3[] = [];
  for (const x of [box.min.x, box.max.x]) for (const y of [box.min.y, box.max.y]) for (const z of [box.min.z, box.max.z]) corners.push(new THREE.Vector3(x, y, z).applyMatrix4(view));
  const near = -(camera.near || 0.1);
  // Clip the box against the near plane: keep corners in front and edge crossings.
  const points = corners.filter((c) => c.z <= near);
  const edges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  for (const [i, j] of edges) {
    const a = corners[i]; const b = corners[j];
    if ((a.z - near) * (b.z - near) < 0) points.push(a.clone().lerp(b, (near - a.z) / (b.z - a.z)));
  }
  if (!points.length) return null;
  const min = new THREE.Vector2(Infinity, Infinity);
  const max = new THREE.Vector2(-Infinity, -Infinity);
  for (const p of points) {
    const ndc = p.clone().applyMatrix4(camera.projectionMatrix);
    min.x = Math.min(min.x, ndc.x); min.y = Math.min(min.y, ndc.y);
    max.x = Math.max(max.x, ndc.x); max.y = Math.max(max.y, ndc.y);
  }
  return { min, max };
};

export const cameraView = (scene: SetDesignState, camera: SetDesignCameraObject, boxes: Map<string, WorldBox>, ids: string[]) => {
  const output = scene.output || { width: 1920, height: 1080 };
  const three = buildQueryCamera(camera, output.width, output.height);
  const eye = three.position;
  const visible: CameraHit[] = [];
  const outside: string[] = [];
  const map = assetMap(scene);
  for (const id of ids) {
    const asset = map.get(id);
    const entry = boxes.get(id);
    if (!asset || !entry) continue;
    const screen = projectBox(entry.box, three);
    const clipped = screen && {
      minX: Math.max(-1, screen.min.x), maxX: Math.min(1, screen.max.x),
      minY: Math.max(-1, screen.min.y), maxY: Math.min(1, screen.max.y),
    };
    if (!screen || !clipped || clipped.minX >= clipped.maxX || clipped.minY >= clipped.maxY) { outside.push(asset.name); continue; }
    const area = ((clipped.maxX - clipped.minX) * (clipped.maxY - clipped.minY)) / 4;
    const cx = (clipped.minX + clipped.maxX) / 2;
    const cy = (clipped.minY + clipped.maxY) / 2;
    const b = entry.box;
    const closest = new THREE.Vector3(
      Math.min(Math.max(eye.x, b.min.x), b.max.x),
      Math.min(Math.max(eye.y, b.min.y), b.max.y),
      Math.min(Math.max(eye.z, b.min.z), b.max.z),
    );
    visible.push({
      id,
      name: asset.name,
      framePercent: Math.round(area * 1000) / 10,
      horizontal: cx < -1 / 3 ? 'left' : cx > 1 / 3 ? 'right' : 'center',
      vertical: cy > 1 / 3 ? 'top' : cy < -1 / 3 ? 'bottom' : 'middle',
      cropped: screen.min.x < -1 || screen.max.x > 1 || screen.min.y < -1 || screen.max.y > 1,
      distance: r3(closest.distanceTo(eye)),
    });
  }
  visible.sort((a, b) => b.framePercent - a.framePercent);
  return { visible, outside };
};

// ---------------------------------------------------------------------------
// The query

export type QueryOptions = {
  /** Limit the object list and the overlap check to these objects (ids or names). */
  objects?: string[];
  includeHidden?: boolean;
  /** Camera id/name for the visibility check; null skips it; default the active camera. */
  camera?: string | null;
  /** Distances between these pairs of objects. */
  pairs?: Array<[string, string]>;
  /** Distances from this object to every other object. */
  distanceFrom?: string;
  tolerance?: number;
};

export type FloorStatus = 'on_floor' | 'supported' | 'floating' | 'sunk' | 'ground';

export type QueriedObject = {
  id: string;
  name: string;
  type: string;
  parent: string | null;
  hidden: boolean;
  location: [number, number, number];
  bounds: BlenderBox;
  center: [number, number, number];
  dimensions: [number, number, number];
  boundsSource: BoundsSource;
  zMin: number;
  zMax: number;
  floor?: { status: FloorStatus; supportedBy?: string; gap?: number };
};

const typeOf = (asset: SetDesignAsset) => (asset.kind === 'group' ? 'group' : asset.kind === 'model' ? 'model' : asset.primitive || 'box');

export const findAssetId = (scene: SetDesignState, key: string) => {
  const lower = key.trim().toLowerCase();
  return scene.assets.find((asset) => asset.id === key)?.id || scene.assets.find((asset) => asset.name.trim().toLowerCase() === lower)?.id || null;
};

export const querySpatial = (scene: SetDesignState, services: CommandServices = {}, options: QueryOptions = {}) => {
  const tol = options.tolerance ?? CONTACT_TOLERANCE;
  const boxes = worldBoxes(scene, services);
  const map = assetMap(scene);
  const resolve = (key: string) => {
    const id = findAssetId(scene, key);
    if (!id) throw new Error(`No object "${key}" in the set. Call setdesign_get_scene for ids and names.`);
    return id;
  };
  const filter = options.objects?.length ? new Set(options.objects.map(resolve)) : null;
  const hidden = (id: string) => isEffectivelyHidden(scene, id);
  const considered = scene.assets.filter((asset) => options.includeHidden || !hidden(asset.id));
  // Geometry objects (not groups) take part in contact and overlap checks.
  const solids = considered.filter((asset) => asset.kind !== 'group');
  const related = (a: string, b: string) => ancestorIds(scene, a).includes(b) || ancestorIds(scene, b).includes(a);
  const nameOf = (id: string) => map.get(id)?.name || id;

  const floorOf = (asset: SetDesignAsset): QueriedObject['floor'] => {
    const own = boxes.get(asset.id)!.box;
    const zMin = own.min.y; const zMax = own.max.y;
    if (zMax <= tol && zMin < -tol) return { status: 'ground' };
    if (Math.abs(zMin) <= tol) return { status: 'on_floor' };
    if (zMin < -tol) return { status: 'sunk', gap: r3(zMin) };
    // Above the floor: supported when it touches something that reaches further down.
    let support: { name: string; resting: boolean } | null = null;
    let below = 0;
    for (const other of solids) {
      if (other.id === asset.id || related(asset.id, other.id)) continue;
      const box = boxes.get(other.id)!.box;
      const g = axisGaps(own, box);
      const footprint = g.x < 0 && g.z < 0;
      if (footprint && box.max.y <= zMin + tol) below = Math.max(below, box.max.y);
      // Resting on top of something (even a thin sheet) supports; touching at the side only when the
      // other object reaches further down (a lintel beside a wall segment, a picture on a wall).
      const resting = footprint && Math.abs(box.max.y - zMin) <= tol;
      if (resting || (g.x <= tol && g.y <= tol && g.z <= tol && box.min.y < zMin - tol)) {
        if (!support || (resting && !support.resting)) support = { name: other.name, resting };
      }
    }
    if (support) return { status: 'supported', supportedBy: support.name };
    return { status: 'floating', gap: r3(zMin - below) };
  };

  const objects: QueriedObject[] = considered
    .filter((asset) => !filter || filter.has(asset.id))
    .map((asset) => {
      const entry = boxes.get(asset.id)!;
      const b = toBlenderBox(entry.box);
      const origin = new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, asset.id));
      const parent = parentOf(scene, asset, map);
      return {
        id: asset.id,
        name: asset.name,
        type: typeOf(asset),
        parent: parent ? parent.name : null,
        hidden: hidden(asset.id),
        location: [r3(origin.x), r3(-origin.z), r3(origin.y)],
        bounds: b,
        center: centre(b),
        dimensions: dims(b),
        boundsSource: entry.source,
        zMin: b.min[2],
        zMax: b.max[2],
        ...(asset.kind !== 'group' ? { floor: floorOf(asset) } : {}),
      };
    });

  const overlaps: Array<{ a: string; b: string; depth: [number, number, number]; volume: number }> = [];
  for (let i = 0; i < solids.length; i += 1) {
    for (let j = i + 1; j < solids.length; j += 1) {
      const a = solids[i]; const b = solids[j];
      if (filter && !filter.has(a.id) && !filter.has(b.id)) continue;
      if (related(a.id, b.id)) continue;
      const g = axisGaps(boxes.get(a.id)!.box, boxes.get(b.id)!.box);
      if (g.x < -tol && g.y < -tol && g.z < -tol) {
        overlaps.push({ a: a.name, b: b.name, depth: [r3(-g.x), r3(-g.z), r3(-g.y)], volume: Math.round(g.x * g.y * g.z * -1e6) / 1e6 });
      }
    }
  }
  overlaps.sort((p, q) => q.volume - p.volume);

  const distances: Array<{ a: string; b: string; gap: number; centers: number }> = [];
  const measure = (aId: string, bId: string) => {
    const a = boxes.get(aId); const b = boxes.get(bId);
    if (!a || !b) return;
    const ca = new THREE.Box3(new THREE.Vector3(a.box.min.x, a.box.min.y, a.box.min.z), new THREE.Vector3(a.box.max.x, a.box.max.y, a.box.max.z)).getCenter(new THREE.Vector3());
    const cb = new THREE.Box3(new THREE.Vector3(b.box.min.x, b.box.min.y, b.box.min.z), new THREE.Vector3(b.box.max.x, b.box.max.y, b.box.max.z)).getCenter(new THREE.Vector3());
    distances.push({ a: nameOf(aId), b: nameOf(bId), gap: r3(boxDistance(a.box, b.box)), centers: r3(ca.distanceTo(cb)) });
  };
  for (const [a, b] of options.pairs || []) measure(resolve(a), resolve(b));
  if (options.distanceFrom) {
    const from = resolve(options.distanceFrom);
    for (const other of solids) if (other.id !== from && !related(from, other.id)) measure(from, other.id);
    distances.sort((p, q) => p.gap - q.gap);
  }

  let camera: null | { id: string; name: string; visible: CameraHit[]; outside: string[] } = null;
  if (options.camera !== null) {
    const cam = options.camera
      ? (scene.cameras || []).find((c) => c.id === options.camera || c.name.toLowerCase() === String(options.camera).toLowerCase())
      : getActiveCamera(scene);
    if (options.camera && !cam) throw new Error(`No camera "${options.camera}" in the set.`);
    if (cam) {
      const ids = considered.filter((asset) => !filter || filter.has(asset.id)).map((asset) => asset.id);
      camera = { id: cam.id, name: cam.name, ...cameraView(scene, cam, boxes, ids) };
    }
  }

  const leaves = objects.filter((o) => o.floor);
  return {
    objects,
    floating: leaves.filter((o) => o.floor!.status === 'floating').map((o) => ({ name: o.name, gap: o.floor!.gap })),
    sunk: leaves.filter((o) => o.floor!.status === 'sunk').map((o) => ({ name: o.name, depth: o.floor!.gap })),
    overlaps,
    distances,
    camera,
    estimated: objects.filter((o) => o.boundsSource === 'estimate').map((o) => o.name),
  };
};

/** World box centre in three.js space (for aiming at objects). */
export const worldCenter = (scene: SetDesignState, id: string, services: CommandServices = {}): SetDesignTransform | null => {
  const entry = worldBoxOf(scene, id, services);
  if (!entry) return null;
  const b = entry.box;
  return { x: (b.min.x + b.max.x) / 2, y: (b.min.y + b.max.y) / 2, z: (b.min.z + b.max.z) / 2 };
};
