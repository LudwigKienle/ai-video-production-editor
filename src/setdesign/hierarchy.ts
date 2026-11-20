/**
 * Scene graph of set design assets: parent/child links (`SetDesignAsset.parentId`) and world
 * transforms. Transforms are stored relative to the parent in three.js space (Y up, degrees);
 * world matrix = parentWorld · T · R · S, exactly as three.js nests objects. Assets without a
 * parentId are top level, so scenes from before groups existed are unchanged.
 * Pure functions (three.js math only, no DOM).
 */
import * as THREE from 'three';
import type { SetDesignAsset, SetDesignState, SetDesignTransform } from '../types';

const DEG = Math.PI / 180;

const clean = (value: number, digits = 6) => {
  const rounded = Number(value.toFixed(digits));
  return Object.is(rounded, -0) ? 0 : rounded;
};
const cleanVec = (v: { x: number; y: number; z: number }, digits = 6): SetDesignTransform => ({ x: clean(v.x, digits), y: clean(v.y, digits), z: clean(v.z, digits) });

export type LocalTransform = { position: SetDesignTransform; rotation: SetDesignTransform; scale: SetDesignTransform };

export const localMatrix = (t: LocalTransform) => new THREE.Matrix4().compose(
  new THREE.Vector3(t.position.x, t.position.y, t.position.z),
  new THREE.Quaternion().setFromEuler(new THREE.Euler(t.rotation.x * DEG, t.rotation.y * DEG, t.rotation.z * DEG, 'XYZ')),
  new THREE.Vector3(t.scale.x, t.scale.y, t.scale.z),
);

/** Matrix → stored transform (three.js space, rotation in degrees XYZ). */
export const transformFromMatrix = (matrix: THREE.Matrix4): LocalTransform => {
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const euler = new THREE.Euler().setFromQuaternion(quaternion, 'XYZ');
  return {
    position: cleanVec(position),
    rotation: cleanVec({ x: euler.x / DEG, y: euler.y / DEG, z: euler.z / DEG }, 4),
    scale: cleanVec(scale),
  };
};

export const assetMap = (scene: SetDesignState) => new Map(scene.assets.map((asset) => [asset.id, asset]));

/** The valid parent of an asset (null when missing, itself, or part of a cycle). */
export const parentOf = (scene: SetDesignState, asset: SetDesignAsset, map = assetMap(scene)): SetDesignAsset | null => {
  if (!asset.parentId) return null;
  const parent = map.get(asset.parentId);
  if (!parent || parent.id === asset.id) return null;
  // Guard against cycles in hand-edited documents.
  const seen = new Set<string>([asset.id]);
  let cursor: SetDesignAsset | undefined = parent;
  while (cursor) {
    if (seen.has(cursor.id)) return null;
    seen.add(cursor.id);
    cursor = cursor.parentId ? map.get(cursor.parentId) : undefined;
  }
  return parent;
};

/** Drop parent links that point nowhere or form a cycle (used by normalize). */
export const sanitizeParents = (assets: SetDesignAsset[]): SetDesignAsset[] => {
  const scene = { assets } as SetDesignState;
  const map = assetMap(scene);
  return assets.map((asset) => {
    if (asset.parentId === undefined) return asset;
    if (asset.parentId && parentOf(scene, asset, map)) return asset;
    const { parentId: _drop, ...rest } = asset;
    return rest as SetDesignAsset;
  });
};

export const childrenOf = (scene: SetDesignState, id: string | null): SetDesignAsset[] => {
  const map = assetMap(scene);
  return scene.assets.filter((asset) => (id === null ? !parentOf(scene, asset, map) : parentOf(scene, asset, map)?.id === id));
};

/** All descendants of an asset, depth first (parents before their children). */
export const descendantIds = (scene: SetDesignState, id: string): string[] => {
  const map = assetMap(scene);
  const byParent = new Map<string, string[]>();
  for (const asset of scene.assets) {
    const parent = parentOf(scene, asset, map);
    if (!parent) continue;
    byParent.set(parent.id, [...(byParent.get(parent.id) || []), asset.id]);
  }
  const out: string[] = [];
  const visit = (current: string) => {
    for (const child of byParent.get(current) || []) {
      if (out.includes(child)) continue;
      out.push(child);
      visit(child);
    }
  };
  visit(id);
  return out;
};

export const ancestorIds = (scene: SetDesignState, id: string): string[] => {
  const map = assetMap(scene);
  const out: string[] = [];
  let cursor = map.get(id);
  while (cursor) {
    const parent = parentOf(scene, cursor, map);
    if (!parent) break;
    out.push(parent.id);
    cursor = parent;
  }
  return out;
};

/** Leaves the ids whose ancestors are not also in the list (Blender transforms parents only). */
export const topLevelOf = (scene: SetDesignState, list: string[]) => {
  const set = new Set(list);
  return list.filter((id) => !ancestorIds(scene, id).some((ancestor) => set.has(ancestor)));
};

/** Hidden itself or through a hidden ancestor (a hidden group hides its contents). */
export const isEffectivelyHidden = (scene: SetDesignState, id: string) => {
  const map = assetMap(scene);
  const asset = map.get(id);
  if (!asset) return false;
  return !!asset.hidden || ancestorIds(scene, id).some((ancestor) => !!map.get(ancestor)?.hidden);
};

/** World matrix of an asset (three.js space). Unknown ids give identity. */
export const worldMatrix = (scene: SetDesignState, id: string | null | undefined, cache?: Map<string, THREE.Matrix4>): THREE.Matrix4 => {
  if (!id) return new THREE.Matrix4();
  const cached = cache?.get(id);
  if (cached) return cached.clone();
  const map = assetMap(scene);
  const asset = map.get(id);
  if (!asset) return new THREE.Matrix4();
  const parent = parentOf(scene, asset, map);
  const result = (parent ? worldMatrix(scene, parent.id, cache) : new THREE.Matrix4()).multiply(localMatrix(asset));
  cache?.set(id, result.clone());
  return result;
};

/** Stored (parent-relative) transform that puts an asset at `world` under `parentId`. */
export const localFromWorld = (scene: SetDesignState, parentId: string | null | undefined, world: THREE.Matrix4): LocalTransform => {
  const parentWorld = worldMatrix(scene, parentId);
  return transformFromMatrix(parentWorld.invert().multiply(world));
};

/** World position (three.js space) of an asset's origin. */
export const worldPosition = (scene: SetDesignState, id: string): SetDesignTransform => {
  const v = new THREE.Vector3().setFromMatrixPosition(worldMatrix(scene, id));
  return { x: v.x, y: v.y, z: v.z };
};

/** The asset moved by a world-space offset (three.js space), keeping rotation and scale. */
export const translateWorld = (scene: SetDesignState, asset: SetDesignAsset, delta: SetDesignTransform): SetDesignAsset => {
  const world = worldMatrix(scene, asset.id);
  const target = new THREE.Vector3().setFromMatrixPosition(world).add(new THREE.Vector3(delta.x, delta.y, delta.z));
  const parent = parentOf(scene, asset);
  const local = target.applyMatrix4(worldMatrix(scene, parent?.id).invert());
  return { ...asset, position: cleanVec(local) };
};

/** Replace assets by id (immutably). */
export const patchAssets = (scene: SetDesignState, patches: Map<string, SetDesignAsset>): SetDesignState => (
  patches.size ? { ...scene, assets: scene.assets.map((asset) => patches.get(asset.id) || asset) } : scene
);

/** Rotation in degrees about the world vertical (three.js Y = Blender Z) composed onto an asset. */
export const rotateAboutWorldUp = (scene: SetDesignState, asset: SetDesignAsset, degrees: number): SetDesignAsset => {
  const world = worldMatrix(scene, asset.id);
  const position = new THREE.Vector3().setFromMatrixPosition(world);
  const turn = new THREE.Matrix4().makeRotationY(degrees * DEG);
  const moved = new THREE.Matrix4().makeTranslation(position.x, position.y, position.z)
    .multiply(turn)
    .multiply(new THREE.Matrix4().makeTranslation(-position.x, -position.y, -position.z))
    .multiply(world);
  const parent = parentOf(scene, asset);
  return { ...asset, ...localFromWorld(scene, parent?.id, moved) };
};
