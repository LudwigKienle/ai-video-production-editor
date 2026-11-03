/**
 * Scene-building commands: hierarchy (groups, parenting), PBR materials, layout helpers (drop to
 * floor, align, place on) and procedural blockout pieces (room, array, scatter, stairs,
 * furniture). They run through the same bus as every other command (one undo step each, also
 * inside scene.batch) and are registered in commands.ts.
 *
 * Arguments use the Blender convention (Z up, metres, degrees); stored values are three.js.
 */
import * as THREE from 'three';
import type { SetDesignAsset, SetDesignMaterial, SetDesignMaterialMaps, SetDesignPrimitive, SetDesignState, SetDesignTransform } from '../types';
import type { CommandContext, ParamSpec, SetDesignCommand } from './commands.ts';
import { OBJECTS_PARAM, OBJECT_PARAM, asBool, asNumber, asPair, asString, asVec, clamp, ids, requireObject, targetIds, vecParam } from './commandArgs.ts';
import { fromBlenderLocation, fromBlenderRotation, toBlenderLocation } from './coords.ts';
import { assetMap, descendantIds, localFromWorld, localMatrix, parentOf, patchAssets, topLevelOf, translateWorld, worldMatrix } from './hierarchy.ts';
import { FURNITURE_SIZES, ROOM_DEFAULTS, STAIRS_DEFAULTS, furnitureParts, roomParts, scatterPoints, seededRandom, stairsParts, type FurnitureType, type Opening, type Part, type SurfaceMaterial } from './builders.ts';
import { CONTACT_TOLERANCE, assetLocalBox, worldBoxOf, worldBoxes } from './spatial.ts';
import { PRIMITIVES, findSceneObject, scaleForDimensions, uniqueName } from './sceneModel.ts';

const DEG = Math.PI / 180;

// ---------------------------------------------------------------------------
// Helpers

const requireAsset = (ctx: CommandContext, key: unknown, role = 'object'): SetDesignAsset => {
  const ref = requireObject(ctx, key);
  if (ref.kind !== 'asset') throw new Error(`${ref.object.name} is a ${ref.kind}; the ${role} must be a mesh, model or group.`);
  return ref.object;
};

const assetIdsOf = (ctx: CommandContext, value: unknown) => targetIds(ctx, value).map((id) => {
  const ref = findSceneObject(ctx.scene, id)!;
  if (ref.kind !== 'asset') throw new Error(`${ref.object.name} is a ${ref.kind}; only meshes, models and groups can be used here.`);
  return id;
});

const v = (value: THREE.Vector3): SetDesignTransform => ({ x: value.x, y: value.y, z: value.z });
/** Blender point (local) → three.js vector. */
const threePoint = (x: number, y: number, z: number) => { const p = fromBlenderLocation({ x, y, z }); return new THREE.Vector3(p.x, p.y, p.z); };
const clean = (value: number) => { const r = Number(value.toFixed(4)); return Object.is(r, -0) ? 0 : r; };
const blenderPoint = (p: SetDesignTransform) => { const b = toBlenderLocation(p); return [clean(b.x), clean(b.y), clean(b.z)] as [number, number, number]; };

/** Add assets to the scene (in order). */
const withAssets = (scene: SetDesignState, assets: SetDesignAsset[]): SetDesignState => ({ ...scene, assets: [...scene.assets, ...assets] });

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;
const asColor = (value: unknown, field: string) => {
  const text = asString(value);
  if (text === undefined) return undefined;
  if (!HEX.test(text)) throw new Error(`${field} must be a hex colour like #a0a0a0.`);
  return text.startsWith('#') ? text.toLowerCase() : `#${text.toLowerCase()}`;
};

/** Common placement of a new top-level piece: location (relative to parent), rotation about Z. */
const placement = (ctx: CommandContext, args: Record<string, unknown>, fallbackZ = 0) => {
  const location = asVec(args.location, { x: 0, y: 0, z: fallbackZ }) || { x: 0, y: 0, z: fallbackZ };
  const parentKey = asString(args.parent);
  const parent = parentKey ? requireAsset(ctx, parentKey, 'parent') : null;
  return {
    position: fromBlenderLocation(location),
    rotation: fromBlenderRotation({ x: 0, y: 0, z: asNumber(args.rotationZ) ?? 0 }, 'mesh'),
    parentId: parent?.id ?? null,
  };
};

const makeGroup = (ctx: CommandContext, scene: SetDesignState, name: string, place: { position: SetDesignTransform; rotation: SetDesignTransform; parentId: string | null }): SetDesignAsset => ({
  id: ctx.makeId('grp'),
  name: uniqueName(scene, name),
  kind: 'group',
  ...(place.parentId ? { parentId: place.parentId } : {}),
  position: place.position,
  rotation: place.rotation,
  scale: { x: 1, y: 1, z: 1 },
});

/** A blockout part as a primitive asset inside `parentId` (part coordinates are local Blender). */
const partAsset = (ctx: CommandContext, scene: SetDesignState, part: Part, parentId: string, prefix: string): SetDesignAsset => ({
  id: ctx.makeId('obj'),
  name: uniqueName(scene, `${prefix}/${part.name}`),
  kind: 'primitive',
  primitive: part.primitive,
  parentId,
  position: fromBlenderLocation({ x: part.center[0], y: part.center[1], z: part.center[2] }),
  rotation: { x: 0, y: 0, z: 0 },
  scale: scaleForDimensions(part.primitive, { x: part.size[0], y: part.size[1], z: part.size[2] }),
  material: {
    color: part.color || '#b4b4b8',
    roughness: part.roughness ?? 0.8,
    metalness: part.metalness ?? 0,
    ...(part.opacity !== undefined && part.opacity < 1 ? { opacity: part.opacity, transparent: true } : {}),
  },
});

/** Group + parts in one go; returns the scene and the created assets (group first). */
const buildPiece = (ctx: CommandContext, defaultName: string, args: Record<string, unknown>, parts: Part[], fallbackZ = 0) => {
  const group = makeGroup(ctx, ctx.scene, asString(args.name) || defaultName, placement(ctx, args, fallbackZ));
  let scene = withAssets(ctx.scene, [group]);
  const created: SetDesignAsset[] = [group];
  for (const part of parts) {
    const asset = partAsset(ctx, scene, part, group.id, group.name);
    scene = withAssets(scene, [asset]);
    created.push(asset);
  }
  return { scene, group, created };
};

/** Copy an asset and all its descendants (new ids and unique names; the copy keeps the parent). */
export const cloneSubtree = (scene: SetDesignState, rootId: string, makeId: (prefix: string) => string) => {
  const map = assetMap(scene);
  const order = [rootId, ...descendantIds(scene, rootId)];
  const idMap = new Map<string, string>();
  let working = scene;
  const copies: SetDesignAsset[] = [];
  for (const id of order) {
    const source = map.get(id)!;
    const copyId = makeId(source.kind === 'group' ? 'grp' : 'obj');
    idMap.set(id, copyId);
    const copy: SetDesignAsset = { ...source, id: copyId, name: uniqueName(working, source.name) };
    if (id !== rootId && source.parentId) copy.parentId = idMap.get(source.parentId) || source.parentId;
    copies.push(copy);
    working = withAssets(working, [copy]);
  }
  return copies;
};

/** Leaves (meshes and models) an id stands for: a group stands for all geometry inside it. */
const geometryIds = (scene: SetDesignState, list: string[]) => {
  const map = assetMap(scene);
  const out: string[] = [];
  for (const id of list) {
    const asset = map.get(id);
    if (!asset) continue;
    const ids = asset.kind === 'group' ? descendantIds(scene, id) : [id];
    for (const leaf of ids) if (map.get(leaf)?.kind !== 'group' && !out.includes(leaf)) out.push(leaf);
  }
  return out;
};

// ---------------------------------------------------------------------------
// Materials

const MAP_KEYS: Array<keyof SetDesignMaterialMaps> = ['baseColor', 'normal', 'roughness', 'metalness', 'ao', 'displacement', 'emissive'];

/** Texture source as a URL: https://, http://, file://, data:, blob: or an absolute local path. */
export const normalizeTextureUrl = (value: string, field = 'map') => {
  const text = value.trim();
  if (/^(https?:|file:|data:|blob:)/i.test(text)) return text;
  if (text.startsWith('/')) return `file://${encodeURI(text)}`;
  if (/^[a-z]:[\\/]/i.test(text)) return `file:///${encodeURI(text.replace(/\\/g, '/'))}`;
  throw new Error(`${field} must be a file://, https:// or data: URL (or an absolute file path), got "${text.slice(0, 60)}".`);
};

/** The patched material for material.set (pure; validation errors are readable). */
export const applyMaterialArgs = (current: SetDesignMaterial | undefined, args: Record<string, unknown>, isModel = false): SetDesignMaterial => {
  const next: SetDesignMaterial = { ...(current || {}) };
  if (asBool(args.clearMaps)) { delete next.maps; delete next.displacementScale; }
  const color = asColor(args.color, 'color'); if (color) next.color = color;
  const roughness = asNumber(args.roughness); if (roughness !== undefined) next.roughness = clamp(roughness, 0, 1);
  const metalness = asNumber(args.metalness); if (metalness !== undefined) next.metalness = clamp(metalness, 0, 1);
  const opacity = asNumber(args.opacity); if (opacity !== undefined) { next.opacity = clamp(opacity, 0, 1); next.transparent = next.opacity < 1; }
  const emissive = asColor(args.emissive, 'emissive'); if (emissive) next.emissive = emissive;
  const emissiveIntensity = asNumber(args.emissiveIntensity); if (emissiveIntensity !== undefined) next.emissiveIntensity = clamp(emissiveIntensity, 0, 100);
  if (args.maps !== undefined && args.maps !== null) {
    if (typeof args.maps !== 'object' || Array.isArray(args.maps)) throw new Error('maps must be an object like { baseColor: "https://…/diff.jpg", normal: "…" }.');
    const maps: SetDesignMaterialMaps = { ...(next.maps || {}) };
    for (const [key, value] of Object.entries(args.maps as Record<string, unknown>)) {
      if (!MAP_KEYS.includes(key as keyof SetDesignMaterialMaps)) throw new Error(`Unknown map "${key}". Use ${MAP_KEYS.join(', ')}.`);
      if (value === null || value === '') { delete maps[key as keyof SetDesignMaterialMaps]; continue; }
      if (typeof value !== 'string') throw new Error(`maps.${key} must be a URL string.`);
      maps[key as keyof SetDesignMaterialMaps] = normalizeTextureUrl(value, `maps.${key}`);
    }
    if (Object.keys(maps).length) next.maps = maps; else delete next.maps;
  }
  if (args.repeat !== undefined) {
    const repeat = asPair(args.repeat);
    if (!repeat || repeat[0] <= 0 || repeat[1] <= 0) throw new Error('repeat must be two positive numbers [u, v], e.g. [4, 4].');
    next.repeat = [repeat[0], repeat[1]];
  }
  const displacementScale = asNumber(args.displacementScale); if (displacementScale !== undefined) next.displacementScale = clamp(displacementScale, -10, 10);
  const name = asString(args.name); if (name) next.name = name;
  if (args.attribution !== undefined && args.attribution !== null) {
    const a = args.attribution as Record<string, unknown>;
    const author = asString(a?.author); const license = asString(a?.license);
    if (!author || !license) throw new Error('attribution needs author and license (and optionally url).');
    next.attribution = { author, license, ...(asString(a.url) ? { url: asString(a.url)! } : {}) };
  }
  if (isModel) next.replaceModelMaterials = true;
  return next;
};

// ---------------------------------------------------------------------------
// Layout helpers (Blender boxes, unrounded)

type BBox = { min: [number, number, number]; max: [number, number, number] };
const blenderBox = (box: { min: SetDesignTransform; max: SetDesignTransform }): BBox => ({ min: [box.min.x, -box.max.z, box.min.y], max: [box.max.x, -box.min.z, box.max.y] });
const AXES = { x: 0, y: 1, z: 2 } as const;
const sideValue = (b: BBox, axis: 0 | 1 | 2, side: string) => (side === 'min' ? b.min[axis] : side === 'max' ? b.max[axis] : (b.min[axis] + b.max[axis]) / 2);
/** Blender delta → three.js delta. */
const deltaThree = (dx: number, dy: number, dz: number): SetDesignTransform => ({ x: dx, y: dz, z: -dy });

const moveAssets = (scene: SetDesignState, moves: Array<{ id: string; delta: SetDesignTransform }>) => {
  let next = scene;
  for (const move of moves) {
    const asset = next.assets.find((entry) => entry.id === move.id)!;
    next = patchAssets(next, new Map([[asset.id, translateWorld(next, asset, move.delta)]]));
  }
  return next;
};

const PLACEMENT_PARAMS: Record<string, ParamSpec> = {
  name: { type: 'string', description: 'Group name (made unique). Parts are named "<group>/<part>".' },
  location: vecParam('Where the piece stands: centre of its footprint on the floor, metres, Blender convention (Z up). Relative to `parent` when given. Default [0, 0, 0].'),
  rotationZ: { type: 'number', description: 'Turn about the vertical axis in degrees (counter-clockwise seen from above). 0 = front faces -Y (towards a camera looking along +Y).' },
  parent: { type: 'string', description: 'Optional parent object/group id or name; location is then relative to it.' },
};

const SURFACE: ParamSpec = { type: 'object', description: 'Surface look: { color: "#rrggbb", roughness: 0..1 }.', properties: { color: { type: 'string', description: 'Hex colour.' }, roughness: { type: 'number', description: '0 (glossy) .. 1 (matt).' } } };
const asSurface = (value: unknown, field: string): SurfaceMaterial | undefined => {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  return { color: asColor(v.color, `${field}.color`), roughness: asNumber(v.roughness) !== undefined ? clamp(asNumber(v.roughness)!, 0, 1) : undefined };
};

const resultOf = (scene: SetDesignState, group: SetDesignAsset, created: SetDesignAsset[], services: CommandContext['services']) => {
  const box = worldBoxOf(scene, group.id, services);
  const b = box ? blenderBox(box.box) : null;
  return {
    id: group.id,
    name: group.name,
    parts: created.filter((asset) => asset.id !== group.id).map((asset) => asset.name),
    ...(b ? { bounds: { min: b.min.map(clean), max: b.max.map(clean) }, dimensions: [0, 1, 2].map((i) => clean(b.max[i] - b.min[i])) } : {}),
  };
};

// ---------------------------------------------------------------------------
// Commands

export const BUILDER_COMMANDS: SetDesignCommand[] = [
  {
    id: 'group.create',
    label: 'Gruppieren',
    menu: ['Objekt', 'Gruppe'],
    shortcut: 'Strg+G',
    description: 'Put objects into a new group (an empty without geometry, like a Blender empty). The objects keep their place in the world; afterwards their location/rotation/scale are relative to the group, and moving, rotating, duplicating, hiding or deleting the group affects everything inside. The group origin defaults to the bottom centre of the objects (so it sits on the floor). Pass no objects to create an empty group at `location`.',
    params: {
      objects: OBJECTS_PARAM,
      name: { type: 'string', description: 'Group name (default "Gruppe", made unique).' },
      location: vecParam('Group origin in world metres (Blender convention). Default: bottom centre of the objects.'),
      parent: { type: 'string', description: 'Parent for the new group (default: the objects\' common parent, if any).' },
    },
    run: (ctx, args) => {
      const given = ids(args.objects);
      const list = given.length ? topLevelOf(ctx.scene, assetIdsOf(ctx, given)) : (args.objects === undefined ? topLevelOf(ctx.scene, ctx.ui.selectedIds.filter((id) => findSceneObject(ctx.scene, id)?.kind === 'asset')) : []);
      const map = assetMap(ctx.scene);
      for (const id of list) if (map.get(id)?.locked) throw new Error(`${map.get(id)!.name} is locked.`);
      const parentKey = asString(args.parent);
      const parents = [...new Set(list.map((id) => parentOf(ctx.scene, map.get(id)!, map)?.id || null))];
      const parentId = parentKey ? requireAsset(ctx, parentKey, 'parent').id : parents.length === 1 ? parents[0] : null;
      if (parentId && list.includes(parentId)) throw new Error('A group cannot be its own parent.');
      if (parentId && list.some((id) => descendantIds(ctx.scene, id).includes(parentId))) throw new Error('The parent cannot be inside the grouped objects.');
      // Origin: given world location, or the bottom centre of the objects' world box.
      let world: THREE.Vector3;
      const location = asVec(args.location);
      if (location) world = threePoint(location.x, location.y, location.z);
      else if (list.length) {
        const boxes = worldBoxes(ctx.scene, ctx.services);
        const box = new THREE.Box3();
        for (const id of list) { const b = boxes.get(id)!.box; box.expandByPoint(new THREE.Vector3(b.min.x, b.min.y, b.min.z)).expandByPoint(new THREE.Vector3(b.max.x, b.max.y, b.max.z)); }
        world = new THREE.Vector3((box.min.x + box.max.x) / 2, box.min.y, (box.min.z + box.max.z) / 2);
      } else world = new THREE.Vector3();
      const local = localFromWorld(ctx.scene, parentId, new THREE.Matrix4().makeTranslation(world.x, world.y, world.z));
      const group = makeGroup(ctx, ctx.scene, asString(args.name) || 'Gruppe', { position: local.position, rotation: local.rotation, parentId });
      let scene = withAssets(ctx.scene, [group]);
      const patches = new Map<string, SetDesignAsset>();
      for (const id of list) {
        const asset = map.get(id)!;
        patches.set(id, { ...asset, parentId: group.id, ...localFromWorld(scene, group.id, worldMatrix(scene, id)) });
      }
      scene = patchAssets(scene, patches);
      return { scene, ui: { selectedIds: [group.id], activeId: group.id }, result: { id: group.id, name: group.name, children: list.map((id) => map.get(id)!.name) } };
    },
  },
  {
    id: 'group.ungroup',
    label: 'Gruppe auflösen',
    menu: ['Objekt', 'Gruppe'],
    shortcut: 'Strg+Alt+G',
    description: 'Dissolve groups: their children move to the group\'s parent (keeping their place in the world) and the group itself is removed.',
    params: { objects: { type: 'array', description: 'Group ids or names (default: the selected groups).', items: { type: 'string' } } },
    run: (ctx, args) => {
      const list = assetIdsOf(ctx, args.objects).filter((id) => findSceneObject(ctx.scene, id)?.kind === 'asset');
      const map = assetMap(ctx.scene);
      const groups = list.filter((id) => map.get(id)!.kind === 'group');
      if (!groups.length) throw new Error(list.length ? `${list.map((id) => map.get(id)!.name).join(', ')} is not a group.` : 'Select or pass a group.');
      let scene = ctx.scene;
      const released: string[] = [];
      for (const groupId of groups) {
        const group = scene.assets.find((asset) => asset.id === groupId)!;
        const parentId = parentOf(scene, group)?.id || null;
        const patches = new Map<string, SetDesignAsset>();
        for (const child of scene.assets.filter((asset) => asset.parentId === groupId)) {
          const local = localFromWorld(scene, parentId, worldMatrix(scene, child.id));
          const next: SetDesignAsset = { ...child, ...local };
          if (parentId) next.parentId = parentId; else delete next.parentId;
          patches.set(child.id, next);
          released.push(child.id);
        }
        scene = patchAssets(scene, patches);
        scene = { ...scene, assets: scene.assets.filter((asset) => asset.id !== groupId) };
      }
      return { scene, ui: { selectedIds: released, activeId: released[released.length - 1] || null }, result: { ungrouped: groups.map((id) => map.get(id)!.name), released: released.map((id) => map.get(id)!.name) } };
    },
  },
  {
    id: 'object.parent',
    label: 'Parent setzen',
    menu: ['Objekt', 'Parent'],
    shortcut: 'Strg+P / Alt+P',
    description: 'Make objects children of a parent object or group (parent: id/name), or clear their parent (parent: null). keepWorld=true (default) keeps them where they are in the world, like Blender\'s Ctrl+P "Keep Transform"; keepWorld=false keeps their numbers, so they jump to be relative to the new parent. Cameras and lights cannot be parented.',
    params: {
      objects: OBJECTS_PARAM,
      parent: { type: 'string', description: 'Parent id or name; null or "" clears the parent (top level).' },
      keepWorld: { type: 'boolean', description: 'Keep the world transform (default true).' },
    },
    run: (ctx, args) => {
      const parentKey = asString(args.parent);
      const parent = parentKey ? requireAsset(ctx, parentKey, 'parent') : null;
      const list = assetIdsOf(ctx, args.objects).filter((id) => id !== parent?.id);
      if (!list.length) throw new Error('Pass objects (other than the parent) or select some.');
      const keepWorld = asBool(args.keepWorld) ?? true;
      if (parent) {
        for (const id of list) if (descendantIds(ctx.scene, id).includes(parent.id)) throw new Error(`${parent.name} is inside ${findSceneObject(ctx.scene, id)!.object.name}; that would make a loop.`);
      }
      let scene = ctx.scene;
      for (const id of list) {
        const asset = scene.assets.find((entry) => entry.id === id)!;
        const next: SetDesignAsset = { ...asset, ...(keepWorld ? localFromWorld(scene, parent?.id, worldMatrix(scene, id)) : {}) };
        if (parent) next.parentId = parent.id; else delete next.parentId;
        scene = patchAssets(scene, new Map([[id, next]]));
      }
      return { scene, result: { parent: parent?.name || null, objects: list.map((id) => findSceneObject(scene, id)!.object.name), keepWorld } };
    },
  },
  {
    id: 'material.set',
    label: 'Material setzen',
    menu: ['Objekt', 'Material'],
    description: 'Set a PBR material on meshes and models (groups: on everything inside). Values: color (hex base colour), roughness/metalness/opacity (0..1), emissive (hex) + emissiveIntensity, texture maps { baseColor, normal, roughness, metalness, ao, displacement, emissive } as file://, https:// or data: URLs (baseColor/emissive are sRGB, the others linear; maps that fail to load are skipped), repeat [u, v] tiling (default [1, 1]), displacementScale in metres, a material name and attribution { author, license, url } for downloaded textures. Maps are merged with existing ones; clearMaps=true removes them first; a map set to "" removes it. Solid shading and clay renders ignore maps; material/rendered shading and Blender export use them. On models the material replaces their own materials.',
    params: {
      objects: OBJECTS_PARAM,
      color: { type: 'string', description: 'Base colour as hex, e.g. #8a6f55. With a baseColor map it tints the texture (use #ffffff for the plain texture).' },
      roughness: { type: 'number', description: '0 (mirror) .. 1 (matt). Multiplies the roughness map.' },
      metalness: { type: 'number', description: '0 (dielectric) .. 1 (metal). Multiplies the metalness map.' },
      opacity: { type: 'number', description: '0 (invisible) .. 1 (opaque).' },
      emissive: { type: 'string', description: 'Emission colour as hex (default black = no emission).' },
      emissiveIntensity: { type: 'number', description: 'Emission strength (1 = colour at full brightness).' },
      maps: {
        type: 'object',
        description: 'Texture maps as URLs (file://, https://, data:).',
        properties: Object.fromEntries(MAP_KEYS.map((key) => [key, { type: 'string', description: `${key} map URL${key === 'baseColor' || key === 'emissive' ? ' (sRGB)' : ' (linear)'}.` }])) as Record<string, ParamSpec>,
      },
      repeat: { type: 'array', description: 'Texture tiling [u, v], default [1, 1]; e.g. [4, 4] on a 4 m floor gives 1 m tiles.', items: { type: 'number' } },
      displacementScale: { type: 'number', description: 'Displacement height in metres (viewport geometry is coarse, keep it small; Blender uses it as bump/displacement scale).' },
      name: { type: 'string', description: 'Material label, e.g. "Poly Haven · brown_planks_09".' },
      attribution: { type: 'object', description: 'Credit for downloaded textures: { author, license, url }.', properties: { author: { type: 'string', description: 'Author.' }, license: { type: 'string', description: 'Licence, e.g. CC0.' }, url: { type: 'string', description: 'Source page.' } } },
      clearMaps: { type: 'boolean', description: 'Remove all existing maps first.' },
    },
    run: (ctx, args) => {
      const list = assetIdsOf(ctx, args.objects);
      if (!list.length) throw new Error('Pass objects (ids or names) or select meshes.');
      const leaves = geometryIds(ctx.scene, list);
      if (!leaves.length) throw new Error('The groups are empty: nothing to put a material on.');
      const map = assetMap(ctx.scene);
      const patches = new Map<string, SetDesignAsset>();
      for (const id of leaves) {
        const asset = map.get(id)!;
        patches.set(id, { ...asset, material: applyMaterialArgs(asset.material, args, asset.kind === 'model') });
      }
      const scene = patchAssets(ctx.scene, patches);
      const first = patches.get(leaves[0])!;
      return { scene, result: { objects: leaves.map((id) => map.get(id)!.name), material: first.material } };
    },
  },
  {
    id: 'object.drop_to_floor',
    label: 'Auf den Boden setzen',
    menu: ['Objekt', 'Ausrichten'],
    description: 'Move objects straight down/up so their lowest point touches the floor (z = floorZ, default 0). With toSurface=true they land on the highest object below them instead (table top, shelf board), or on the floor when nothing is below. Groups move as a whole.',
    params: {
      objects: OBJECTS_PARAM,
      floorZ: { type: 'number', description: 'Floor height in metres (default 0).' },
      toSurface: { type: 'boolean', description: 'Land on the highest surface under the object instead of the floor.' },
    },
    run: (ctx, args) => {
      const list = topLevelOf(ctx.scene, assetIdsOf(ctx, args.objects));
      if (!list.length) throw new Error('Pass objects or select some.');
      const floorZ = asNumber(args.floorZ) ?? 0;
      const toSurface = asBool(args.toSurface) ?? false;
      const boxes = worldBoxes(ctx.scene, ctx.services);
      const moves: Array<{ id: string; delta: SetDesignTransform }> = [];
      const report: Array<{ name: string; dz: number; onto: string }> = [];
      for (const id of list) {
        const own = boxes.get(id)!.box;
        let target = floorZ;
        let onto = 'floor';
        if (toSurface) {
          const excluded = new Set([id, ...descendantIds(ctx.scene, id)]);
          for (const asset of ctx.scene.assets) {
            if (excluded.has(asset.id) || asset.kind === 'group' || asset.hidden) continue;
            const b = boxes.get(asset.id)!.box;
            const footprint = b.min.x < own.max.x && b.max.x > own.min.x && b.min.z < own.max.z && b.max.z > own.min.z;
            if (footprint && b.max.y <= own.min.y + CONTACT_TOLERANCE && b.max.y > target) { target = b.max.y; onto = asset.name; }
          }
        }
        const dz = target - own.min.y;
        moves.push({ id, delta: { x: 0, y: dz, z: 0 } });
        report.push({ name: findSceneObject(ctx.scene, id)!.object.name, dz: clean(dz), onto });
      }
      return { scene: moveAssets(ctx.scene, moves), result: { moved: report } };
    },
  },
  {
    id: 'object.align',
    label: 'Ausrichten',
    menu: ['Objekt', 'Ausrichten'],
    description: 'Align objects along one world axis (Blender convention) to a target object or a coordinate. side picks which part of each object is aligned: min (left/front/bottom face), center or max (right/back/top face); targetSide picks the target\'s face (default = side). Examples: bottoms level → axis z, side min, to "Table"; put a cabinet against the left of a wall → axis x, side max, targetSide min, to "Wall". offset adds metres along the axis. Groups move as a whole.',
    params: {
      objects: OBJECTS_PARAM,
      to: { type: 'string', anyType: true, description: 'Target object id/name, or a number (world coordinate in metres along the axis).' },
      axis: { type: 'string', description: 'World axis.', enum: ['x', 'y', 'z'] },
      side: { type: 'string', description: 'Part of each object to align (default center).', enum: ['min', 'center', 'max'] },
      targetSide: { type: 'string', description: 'Part of the target to align to (default = side).', enum: ['min', 'center', 'max'] },
      offset: { type: 'number', description: 'Extra distance in metres along the axis (default 0).' },
    },
    required: ['to', 'axis'],
    run: (ctx, args) => {
      const axisName = asString(args.axis) as keyof typeof AXES | undefined;
      if (!axisName || !(axisName in AXES)) throw new Error('axis must be x, y or z.');
      const axis = AXES[axisName];
      const side = asString(args.side) || 'center';
      const targetSide = asString(args.targetSide) || side;
      if (![side, targetSide].every((s) => ['min', 'center', 'max'].includes(s))) throw new Error('side and targetSide must be min, center or max.');
      const boxes = worldBoxes(ctx.scene, ctx.services);
      const toNumber = typeof args.to === 'number' ? args.to
        : typeof args.to === 'string' && /^-?\d+(\.\d+)?$/.test(args.to.trim()) && !findSceneObject(ctx.scene, args.to) ? Number(args.to) : undefined;
      let targetValue: number;
      let targetId: string | null = null;
      if (toNumber !== undefined) targetValue = toNumber;
      else {
        const target = requireAsset(ctx, args.to, 'target');
        targetId = target.id;
        targetValue = sideValue(blenderBox(boxes.get(target.id)!.box), axis, targetSide);
      }
      targetValue += asNumber(args.offset) ?? 0;
      const list = topLevelOf(ctx.scene, assetIdsOf(ctx, args.objects)).filter((id) => id !== targetId);
      if (!list.length) throw new Error('Pass objects to align (other than the target) or select some.');
      const moves = list.map((id) => {
        const d = targetValue - sideValue(blenderBox(boxes.get(id)!.box), axis, side);
        return { id, delta: deltaThree(axis === 0 ? d : 0, axis === 1 ? d : 0, axis === 2 ? d : 0) };
      });
      const scene = moveAssets(ctx.scene, moves);
      return { scene, result: { axis: axisName, value: clean(targetValue), moved: list.map((id) => findSceneObject(scene, id)!.object.name) } };
    },
  },
  {
    id: 'object.place_on',
    label: 'Auf Objekt stellen',
    menu: ['Objekt', 'Ausrichten'],
    description: 'Put an object on top of another (side: top): its lowest point goes to the target\'s top and it is centred on the target\'s top face, shifted by offset [x, y] metres. keepXY=true only sets the height. Uses bounding boxes (exact for primitives, measured or estimated for models).',
    params: {
      object: OBJECT_PARAM,
      target: { type: 'string', description: 'Object/group id or name to stand on.' },
      side: { type: 'string', description: 'Only top is supported.', enum: ['top'] },
      offset: { type: 'array', description: 'Shift on the top face [x, y] in metres from its centre.', items: { type: 'number' } },
      keepXY: { type: 'boolean', description: 'Keep the horizontal position, only set the height.' },
    },
    required: ['target'],
    run: (ctx, args) => {
      const side = asString(args.side) || 'top';
      if (side !== 'top') throw new Error('side must be top.');
      const object = requireAsset(ctx, args.object);
      const target = requireAsset(ctx, args.target, 'target');
      if (object.id === target.id || descendantIds(ctx.scene, object.id).includes(target.id)) throw new Error('An object cannot stand on itself or on its own parts.');
      const boxes = worldBoxes(ctx.scene, ctx.services);
      const o = blenderBox(boxes.get(object.id)!.box);
      const t = blenderBox(boxes.get(target.id)!.box);
      const offset = asPair(args.offset) || [0, 0];
      const keepXY = asBool(args.keepXY) ?? false;
      const dx = keepXY ? 0 : (t.min[0] + t.max[0]) / 2 + offset[0] - (o.min[0] + o.max[0]) / 2;
      const dy = keepXY ? 0 : (t.min[1] + t.max[1]) / 2 + offset[1] - (o.min[1] + o.max[1]) / 2;
      const dz = t.max[2] - o.min[2];
      const scene = moveAssets(ctx.scene, [{ id: object.id, delta: deltaThree(dx, dy, dz) }]);
      return { scene, result: { object: object.name, on: target.name, z: clean(t.max[2]) } };
    },
  },
  {
    id: 'build.room',
    label: 'Raum bauen',
    menu: ['Hinzufügen', 'Bausteine'],
    description: 'Build a room as a group: floor slab (top at z = 0), four walls standing outside an interior of width (x) × depth (y) and optional ceiling. Openings cut real holes: each wall with doors/windows is split into segments plus sill and lintel pieces (no overlaps). Opening offset = centre of the opening along the wall in metres from the wall centre (north/south walls: + is towards +X/east; east/west walls: + is towards +Y/north). Doors default 0.9 × 2.1 m (sill 0), windows 1.2 × 1.2 m at sill 0.9 m. Names: "<Room>/Floor", "<Room>/Wall North", "<Room>/Wall North A", "<Room>/Wall North Lintel Door 1" … North is +Y, east is +X. The result lists the openings with their world centres, so doors/windows (build.furniture) can be put in.',
    params: {
      ...PLACEMENT_PARAMS,
      name: { type: 'string', description: 'Room name (default "Room").' },
      location: vecParam('Centre of the room\'s floor (top of the floor slab), world metres, Blender convention. Default [0, 0, 0].'),
      width: { type: 'number', description: `Interior width along X in metres (default ${ROOM_DEFAULTS.width}).` },
      depth: { type: 'number', description: `Interior depth along Y in metres (default ${ROOM_DEFAULTS.depth}).` },
      height: { type: 'number', description: `Interior height in metres (default ${ROOM_DEFAULTS.height}; typical 2.5–3).` },
      wallThickness: { type: 'number', description: `Wall thickness in metres (default ${ROOM_DEFAULTS.wallThickness}).` },
      floor: { type: 'boolean', description: 'Build the floor slab (default true).' },
      ceiling: { type: 'boolean', description: 'Build a ceiling (default false, so cameras can look in from above).' },
      openings: {
        type: 'array',
        description: 'Doors and windows: [{ wall: north|south|east|west, type: door|window, offset, width, height, sill }].',
        items: {
          type: 'object',
          description: 'One opening.',
          properties: {
            wall: { type: 'string', description: 'Wall.', enum: ['north', 'south', 'east', 'west'] },
            type: { type: 'string', description: 'door or window.', enum: ['door', 'window'] },
            offset: { type: 'number', description: 'Centre along the wall in metres from the wall centre (default 0).' },
            width: { type: 'number', description: 'Width in metres.' },
            height: { type: 'number', description: 'Height in metres.' },
            sill: { type: 'number', description: 'Height of the bottom edge above the floor in metres.' },
          },
        },
      },
      materials: { type: 'object', description: 'Looks: { floor: {color, roughness}, walls: {…}, ceiling: {…} }.', properties: { floor: SURFACE, walls: SURFACE, ceiling: SURFACE } },
    },
    run: (ctx, args) => {
      const n = (key: string, fallback: number) => asNumber(args[key]) ?? fallback;
      const openings = Array.isArray(args.openings) ? (args.openings as Array<Record<string, unknown>>).map((o) => ({
        wall: asString(o?.wall) as Opening['wall'], type: asString(o?.type) as Opening['type'],
        offset: asNumber(o?.offset), width: asNumber(o?.width), height: asNumber(o?.height), sill: asNumber(o?.sill),
      })) : [];
      const materials = (args.materials && typeof args.materials === 'object' ? args.materials : {}) as Record<string, unknown>;
      const { parts, openings: resolved } = roomParts({
        width: n('width', ROOM_DEFAULTS.width), depth: n('depth', ROOM_DEFAULTS.depth), height: n('height', ROOM_DEFAULTS.height),
        wallThickness: n('wallThickness', ROOM_DEFAULTS.wallThickness), floor: asBool(args.floor) ?? true, ceiling: asBool(args.ceiling) ?? false,
        openings, materials: { floor: asSurface(materials.floor, 'materials.floor'), walls: asSurface(materials.walls, 'materials.walls'), ceiling: asSurface(materials.ceiling, 'materials.ceiling') },
      });
      const { scene, group, created } = buildPiece(ctx, 'Room', args, parts);
      const world = worldMatrix(scene, group.id);
      const rotZ = asNumber(args.rotationZ) ?? 0;
      const facing: Record<string, number> = { north: 0, south: 180, east: -90, west: 90 };
      return {
        scene,
        ui: { selectedIds: [group.id], activeId: group.id },
        result: {
          ...resultOf(scene, group, created, ctx.services),
          interior: { width: n('width', ROOM_DEFAULTS.width), depth: n('depth', ROOM_DEFAULTS.depth), height: n('height', ROOM_DEFAULTS.height) },
          openings: resolved.map((o) => {
            const p = threePoint(o.center[0], o.center[1], o.center[2]).applyMatrix4(world);
            const bottom = threePoint(o.center[0], o.center[1], o.sill).applyMatrix4(world);
            return { wall: o.wall, type: o.type, width: o.width, height: o.height, sill: o.sill, center: blenderPoint(v(p)), bottomCenter: blenderPoint(v(bottom)), rotationZ: clean(((facing[o.wall] + rotZ) % 360 + 360) % 360) };
          }),
        },
      };
    },
  },
  {
    id: 'build.array',
    label: 'Array',
    menu: ['Hinzufügen', 'Bausteine'],
    description: 'Repeat an object (with everything inside, if it is a group) count times in total, each copy shifted by offset [x, y, z] metres in world space (Blender convention) and optionally turned by rotateStep [rx, ry, rz] degrees per copy about its own origin. With group=true (default) the original and the copies are put into a new group "<name> Array". Example: 6 chairs 0.6 m apart → count 6, offset [0.6, 0, 0].',
    params: {
      object: OBJECT_PARAM,
      count: { type: 'number', description: 'Total number including the original (2–500).' },
      offset: vecParam('Step between copies in world metres.'),
      rotateStep: vecParam('Extra rotation per copy in degrees (Blender Euler XYZ).'),
      group: { type: 'boolean', description: 'Group the original and the copies (default true).' },
      name: { type: 'string', description: 'Name of the new group.' },
    },
    required: ['count', 'offset'],
    run: (ctx, args) => {
      const source = requireAsset(ctx, args.object);
      const count = Math.round(asNumber(args.count) ?? 0);
      if (count < 2 || count > 500) throw new Error('count must be 2–500 (it includes the original).');
      const offsetB = asVec(args.offset);
      if (!offsetB) throw new Error('Pass offset [x, y, z] in metres.');
      const offset = fromBlenderLocation(offsetB);
      const step = asVec(args.rotateStep);
      const stepMatrix = step ? localMatrix({ position: { x: 0, y: 0, z: 0 }, rotation: fromBlenderRotation(step, 'mesh'), scale: { x: 1, y: 1, z: 1 } }) : null;
      let scene = ctx.scene;
      const parentId = parentOf(scene, source)?.id || null;
      let group: SetDesignAsset | null = null;
      if (asBool(args.group) ?? true) {
        group = makeGroup(ctx, scene, asString(args.name) || `${source.name} Array`, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, parentId });
        scene = withAssets(scene, [group]);
        scene = patchAssets(scene, new Map([[source.id, { ...source, parentId: group.id }]]));
      }
      const sourceWorld = worldMatrix(scene, source.id);
      const origin = new THREE.Vector3().setFromMatrixPosition(sourceWorld);
      const copyParent = group?.id || parentId;
      const created: string[] = [];
      let rotation = new THREE.Matrix4();
      for (let i = 1; i < count; i += 1) {
        if (stepMatrix) rotation = stepMatrix.clone().multiply(rotation);
        const world = new THREE.Matrix4().makeTranslation(offset.x * i + origin.x, offset.y * i + origin.y, offset.z * i + origin.z)
          .multiply(rotation)
          .multiply(new THREE.Matrix4().makeTranslation(-origin.x, -origin.y, -origin.z))
          .multiply(sourceWorld);
        const copies = cloneSubtree(scene, source.id, ctx.makeId);
        const root = { ...copies[0], ...localFromWorld(scene, copyParent, world) };
        if (copyParent) root.parentId = copyParent; else delete root.parentId;
        copies[0] = root;
        scene = withAssets(scene, copies);
        created.push(root.id);
      }
      const selected = group ? [group.id] : created;
      return { scene, ui: { selectedIds: selected, activeId: selected[selected.length - 1] }, result: { id: group?.id || created[0], name: group?.name, copies: created.map((id) => findSceneObject(scene, id)!.object.name) } };
    },
  },
  {
    id: 'build.scatter',
    label: 'Verstreuen',
    menu: ['Hinzufügen', 'Bausteine'],
    description: 'Scatter copies of an object (or new primitives) over a floor area or the top of an object, deterministically: the same seed gives the same layout. area: { center: [x, y], size: [w, d], z? } in world metres, or { onObject: "Table" } (its top face). Copies stand on the surface (their lowest point at its height), keep at least minDistance metres between centres, get a random turn about Z (randomRotationZ, default true) and a random uniform scale within scaleRange [min, max]. The original object stays where it is. With group=true (default) the copies go into a group "<name> Scatter". Fewer than count are placed when minDistance does not leave room (see placed).',
    params: {
      object: { type: 'string', description: 'Object/group to copy (id or name). Alternative: primitive.' },
      primitive: { type: 'string', description: 'Primitive to scatter instead of an object.', enum: ['box', 'sphere', 'cylinder', 'cone', 'torus', 'person'] },
      dimensions: vecParam('Primitive size in metres (with primitive).'),
      color: { type: 'string', description: 'Primitive colour (with primitive).' },
      area: {
        type: 'object',
        description: 'Where to scatter: { center: [x, y], size: [w, d], z } or { onObject: id/name }.',
        properties: {
          center: { type: 'array', description: 'Area centre [x, y] in metres.', items: { type: 'number' } },
          size: { type: 'array', description: 'Area size [width x, depth y] in metres.', items: { type: 'number' } },
          z: { type: 'number', description: 'Surface height (default 0 = floor).' },
          onObject: { type: 'string', description: 'Scatter on the top face of this object instead.' },
        },
      },
      count: { type: 'number', description: 'How many copies (1–500).' },
      seed: { type: 'number', description: 'Random seed (default 1).' },
      minDistance: { type: 'number', description: 'Minimum distance between copy centres in metres (default 0).' },
      randomRotationZ: { type: 'boolean', description: 'Random turn about the vertical axis (default true).' },
      scaleRange: { type: 'array', description: 'Uniform scale range [min, max] (default [1, 1]).', items: { type: 'number' } },
      group: { type: 'boolean', description: 'Group the copies (default true).' },
      name: { type: 'string', description: 'Group name.' },
    },
    required: ['area', 'count'],
    run: (ctx, args) => {
      const count = Math.round(asNumber(args.count) ?? 0);
      if (count < 1 || count > 500) throw new Error('count must be 1–500.');
      const area = (args.area && typeof args.area === 'object' ? args.area : null) as Record<string, unknown> | null;
      if (!area) throw new Error('Pass area: { center: [x, y], size: [w, d] } or { onObject: "…" }.');
      const boxes = worldBoxes(ctx.scene, ctx.services);
      let center: [number, number]; let size: [number, number]; let surfaceZ: number;
      const onKey = asString(area.onObject);
      if (onKey) {
        const on = requireAsset(ctx, onKey, 'onObject');
        const b = blenderBox(boxes.get(on.id)!.box);
        center = [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2];
        size = [b.max[0] - b.min[0], b.max[1] - b.min[1]];
        surfaceZ = b.max[2];
      } else {
        const c = asPair(area.center); const s = asPair(area.size);
        if (!c || !s || s[0] <= 0 || s[1] <= 0) throw new Error('area needs center [x, y] and size [w, d] (positive), or onObject.');
        center = c; size = s; surfaceZ = asNumber(area.z) ?? 0;
      }
      const seed = Math.round(asNumber(args.seed) ?? 1);
      const points = scatterPoints({ center, size, count, seed, minDistance: Math.max(0, asNumber(args.minDistance) ?? 0) });
      const random = seededRandom(seed * 7919 + 17);
      const rotate = asBool(args.randomRotationZ) ?? true;
      const range = asPair(args.scaleRange) || [1, 1];
      if (range[0] <= 0 || range[1] < range[0]) throw new Error('scaleRange must be [min, max] with 0 < min ≤ max.');
      // Template: an existing object (copied with its contents) or a new primitive.
      const objectKey = asString(args.object);
      const primitive = asString(args.primitive) as SetDesignPrimitive | undefined;
      if (!objectKey && !primitive) throw new Error('Pass object (to copy) or primitive.');
      const source = objectKey ? requireAsset(ctx, objectKey) : null;
      let templateWorld: THREE.Matrix4;
      let templateBox: { min: SetDesignTransform; max: SetDesignTransform };
      let template: SetDesignAsset | null = null;
      if (source) {
        templateWorld = worldMatrix(ctx.scene, source.id);
        templateBox = boxes.get(source.id)!.box;
      } else {
        const dims = asVec(args.dimensions) || { x: 0.3, y: 0.3, z: 0.3 };
        template = {
          id: '', name: '', kind: 'primitive', primitive,
          position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: scaleForDimensions(primitive, dims),
          material: { color: asColor(args.color, 'color') || '#9a9a9e', roughness: 0.8, metalness: 0 },
        };
        const local = assetLocalBox(template, ctx.services);
        if (!local) throw new Error(`Unknown primitive ${primitive}.`);
        templateWorld = localMatrix(template);
        const box = new THREE.Box3(new THREE.Vector3(local.box.min.x, local.box.min.y, local.box.min.z), new THREE.Vector3(local.box.max.x, local.box.max.y, local.box.max.z)).applyMatrix4(templateWorld);
        templateBox = { min: v(box.min), max: v(box.max) };
      }
      const pivot = new THREE.Vector3((templateBox.min.x + templateBox.max.x) / 2, templateBox.min.y, (templateBox.min.z + templateBox.max.z) / 2);
      let scene = ctx.scene;
      let group: SetDesignAsset | null = null;
      if (asBool(args.group) ?? true) {
        group = makeGroup(ctx, scene, asString(args.name) || `${source?.name || PRIMITIVES.find((p) => p.id === primitive)?.label || 'Objekt'} Scatter`, { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, parentId: null });
        scene = withAssets(scene, [group]);
      }
      const parentId = group?.id || (source ? parentOf(scene, source)?.id || null : null);
      const created: string[] = [];
      for (const point of points) {
        const turn = rotate ? random() * 360 : 0;
        const s = range[0] + (range[1] - range[0]) * random();
        const target = fromBlenderLocation({ x: point.x, y: point.y, z: surfaceZ });
        const world = new THREE.Matrix4().makeTranslation(target.x, target.y, target.z)
          .multiply(new THREE.Matrix4().makeRotationY(turn * DEG))
          .multiply(new THREE.Matrix4().makeScale(s, s, s))
          .multiply(new THREE.Matrix4().makeTranslation(-pivot.x, -pivot.y, -pivot.z))
          .multiply(templateWorld);
        const copies = source
          ? cloneSubtree(scene, source.id, ctx.makeId)
          : [{ ...template!, id: ctx.makeId('obj'), name: uniqueName(scene, PRIMITIVES.find((p) => p.id === primitive)?.label || 'Objekt') }];
        const root = { ...copies[0], ...localFromWorld(scene, parentId, world) };
        if (parentId) root.parentId = parentId; else delete root.parentId;
        copies[0] = root;
        scene = withAssets(scene, copies);
        created.push(root.id);
      }
      const selected = group ? [group.id] : created;
      return {
        scene,
        ui: { selectedIds: selected, activeId: selected[selected.length - 1] || null },
        result: { id: group?.id || created[0], name: group?.name, placed: created.length, requested: count, seed, objects: created.map((id) => findSceneObject(scene, id)!.object.name) },
      };
    },
  },
  {
    id: 'build.stairs',
    label: 'Treppe bauen',
    menu: ['Hinzufügen', 'Bausteine'],
    description: `Build a straight staircase as a group of solid steps standing on the floor. It climbs along local +Y from location (centre of the front edge of the first step), so rotationZ 0 climbs north (+Y), 90 climbs west (-X). Defaults: ${STAIRS_DEFAULTS.steps} steps, width ${STAIRS_DEFAULTS.width} m, rise ${STAIRS_DEFAULTS.rise} m, run (tread depth) ${STAIRS_DEFAULTS.run} m. Total height = steps × rise.`,
    params: {
      ...PLACEMENT_PARAMS,
      name: { type: 'string', description: 'Group name (default "Stairs").' },
      location: vecParam('Centre of the front edge of the first step, on the floor (world metres, Blender convention).'),
      steps: { type: 'number', description: 'Number of steps.' },
      width: { type: 'number', description: 'Stair width in metres.' },
      rise: { type: 'number', description: 'Height of one step in metres (typical 0.15–0.19).' },
      run: { type: 'number', description: 'Depth of one step in metres (typical 0.25–0.30).' },
      color: { type: 'string', description: 'Colour (hex).' },
    },
    run: (ctx, args) => {
      const spec = {
        steps: Math.round(asNumber(args.steps) ?? STAIRS_DEFAULTS.steps),
        width: asNumber(args.width) ?? STAIRS_DEFAULTS.width,
        rise: asNumber(args.rise) ?? STAIRS_DEFAULTS.rise,
        run: asNumber(args.run) ?? STAIRS_DEFAULTS.run,
        color: asColor(args.color, 'color'),
      };
      const { scene, group, created } = buildPiece(ctx, 'Stairs', args, stairsParts(spec));
      const top = threePoint(0, spec.steps * spec.run, spec.steps * spec.rise).applyMatrix4(worldMatrix(scene, group.id));
      return {
        scene,
        ui: { selectedIds: [group.id], activeId: group.id },
        result: { ...resultOf(scene, group, created, ctx.services), steps: spec.steps, totalRise: clean(spec.steps * spec.rise), totalRun: clean(spec.steps * spec.run), topEdge: blenderPoint(v(top)) },
      };
    },
  },
  {
    id: 'build.furniture',
    label: 'Möbel-Blockout',
    menu: ['Hinzufügen', 'Bausteine'],
    description: `Simple, true-to-scale blockout furniture made of primitives, as a group standing on the floor at location (centre of its footprint), front facing -Y. Types and default size [width, depth, height] in metres: ${Object.entries(FURNITURE_SIZES).map(([type, d]) => `${type} ${d.size.join(' × ')} (${d.note})`).join('; ')}. size overrides the default. A window's location z is its bottom edge (default 0.9 m); lamp with withLight=true also adds a warm point light in the shade.`,
    params: {
      ...PLACEMENT_PARAMS,
      type: { type: 'string', description: 'Furniture type.', enum: Object.keys(FURNITURE_SIZES) },
      size: vecParam('Size [width x, depth y, height z] in metres (default: real standard size).'),
      color: { type: 'string', description: 'Main colour (hex).' },
      withLight: { type: 'boolean', description: 'lamp only: add a point light (40 W, 2900 K) in the shade.' },
    },
    required: ['type'],
    run: (ctx, args) => {
      const type = asString(args.type) as FurnitureType | undefined;
      if (!type || !FURNITURE_SIZES[type]) throw new Error(`type must be one of ${Object.keys(FURNITURE_SIZES).join(', ')}.`);
      const defaults = FURNITURE_SIZES[type].size;
      const given = asVec(args.size);
      const size: [number, number, number] = given ? [given.x || defaults[0], given.y || defaults[1], given.z || defaults[2]] : [...defaults];
      const label = type.charAt(0).toUpperCase() + type.slice(1);
      const built = buildPiece(ctx, label, args, furnitureParts(type, size, asColor(args.color, 'color')), type === 'window' ? 0.9 : 0);
      let scene = built.scene;
      const result: Record<string, unknown> = { ...resultOf(scene, built.group, built.created, ctx.services), type, size };
      if (type === 'lamp' && asBool(args.withLight)) {
        const p = threePoint(0, 0, size[2] - Math.min(0.3, size[2] / 4) / 2).applyMatrix4(worldMatrix(scene, built.group.id));
        const light = {
          id: ctx.makeId('light'), name: uniqueName(scene, `${built.group.name} Light`), type: 'point' as const, color: '#ffffff', intensity: 1,
          power: 40, temperature: 2900, useTemperature: true, position: v(p), rotation: { x: -90, y: 0, z: 0 }, castShadow: true, size: 0.1,
        };
        scene = { ...scene, lights: [...scene.lights, light] };
        result.light = light.name;
      }
      return { scene, ui: { selectedIds: [built.group.id], activeId: built.group.id }, result };
    },
  },
];
