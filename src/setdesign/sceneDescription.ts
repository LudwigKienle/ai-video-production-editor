/**
 * setdesign_describe_scene: a compact, structured description of a set for LLM agents (hierarchy
 * with sizes, world positions and materials, lights, cameras, what the active camera sees,
 * problems) plus a short paragraph in plain language. Blender convention, metres.
 */
import type { SetDesignAsset, SetDesignState } from '../types';
import type { CommandServices } from './commands.ts';
import { describeCamera } from './cameraMath.ts';
import { toBlenderLocation, toBlenderRotation } from './coords.ts';
import { querySpatial, type QueriedObject } from './spatial.ts';
import { getActiveCamera } from './sceneModel.ts';

type Node = {
  name: string;
  type: string;
  size: [number, number, number];
  at: [number, number, number];
  material?: string;
  hidden?: true;
  estimated?: true;
  children?: Node[];
};

const fmt = (value: number) => String(Math.round(value * 100) / 100);
const sizeText = (size: [number, number, number]) => size.map(fmt).join(' × ');

const materialText = (asset: SetDesignAsset) => {
  const m = asset.material;
  if (!m || asset.kind === 'group') return undefined;
  const parts = [m.name, m.color, m.maps && Object.keys(m.maps).length ? `textured (${Object.keys(m.maps).join(', ')})` : '', m.metalness && m.metalness > 0.5 ? 'metal' : '', m.opacity !== undefined && m.opacity < 1 ? `opacity ${fmt(m.opacity)}` : '', m.emissive && m.emissive !== '#000000' ? `emits ${m.emissive}` : ''].filter(Boolean);
  return parts.join(', ') || undefined;
};

export const describeSceneForAgents = (scene: SetDesignState, services: CommandServices = {}, options: { maxObjects?: number } = {}) => {
  const query = querySpatial(scene, services, { includeHidden: true });
  const byId = new Map<string, QueriedObject>(query.objects.map((o) => [o.id, o]));
  const assets = new Map(scene.assets.map((asset) => [asset.id, asset]));
  const childrenOf = new Map<string | null, SetDesignAsset[]>();
  for (const asset of scene.assets) {
    const parent = asset.parentId && assets.has(asset.parentId) ? asset.parentId : null;
    childrenOf.set(parent, [...(childrenOf.get(parent) || []), asset]);
  }
  const limit = Math.max(10, Math.min(2000, options.maxObjects ?? 200));
  let listed = 0;
  let truncated = 0;
  const node = (asset: SetDesignAsset, depth: number): Node | null => {
    if (listed >= limit) { truncated += 1; return null; }
    listed += 1;
    const q = byId.get(asset.id)!;
    const kids = (childrenOf.get(asset.id) || []).slice().sort((a, b) => a.name.localeCompare(b.name));
    const out: Node = {
      name: asset.name,
      type: q.type,
      size: q.dimensions,
      at: asset.kind === 'group' || asset.kind === 'model' ? q.location : q.center,
      ...(materialText(asset) ? { material: materialText(asset) } : {}),
      ...(q.hidden ? { hidden: true as const } : {}),
      ...(q.boundsSource === 'estimate' ? { estimated: true as const } : {}),
    };
    // Deep part lists (rooms, furniture) are summarised after two levels.
    if (kids.length) {
      if (depth >= 2) out.children = [{ name: `${kids.length} parts`, type: 'parts', size: q.dimensions, at: q.center }];
      else out.children = kids.map((kid) => node(kid, depth + 1)).filter((n): n is Node => !!n);
    }
    return out;
  };
  const hierarchy = (childrenOf.get(null) || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((asset) => node(asset, 0)).filter((n): n is Node => !!n);

  const output = scene.output || { width: 1920, height: 1080 };
  const active = getActiveCamera(scene);
  const cameras = (scene.cameras || []).map((camera) => ({
    name: camera.name,
    active: camera.id === active?.id,
    lensMm: camera.lensMm,
    location: Object.values(toBlenderLocation(camera.position)).map((n) => Math.round(n * 100) / 100),
    setup: describeCamera(camera, output.width / output.height).en,
  }));
  const lights = scene.lights.filter((light) => light.type !== 'ambient').map((light) => ({
    name: light.name || light.type,
    type: light.type === 'directional' ? 'sun' : light.type,
    power: light.power ?? light.intensity,
    unit: light.type === 'sun' || light.type === 'directional' ? 'W/m²' : 'W',
    ...(light.useTemperature && light.temperature ? { temperatureK: light.temperature } : { color: light.color }),
    location: Object.values(toBlenderLocation(light.position || { x: 0, y: 3, z: 0 })).map((n) => Math.round(n * 100) / 100),
    rotation: Object.values(toBlenderRotation(light.rotation || { x: -90, y: 0, z: 0 }, 'light')).map((n) => Math.round(n)),
    ...(light.hidden ? { hidden: true } : {}),
  }));

  // Overall extent of visible geometry.
  const visible = query.objects.filter((o) => !o.hidden && o.type !== 'group');
  const extent = visible.length ? {
    min: [0, 1, 2].map((i) => Math.min(...visible.map((o) => o.bounds.min[i]))),
    max: [0, 1, 2].map((i) => Math.max(...visible.map((o) => o.bounds.max[i]))),
  } : null;

  const counts = {
    objects: scene.assets.length,
    groups: scene.assets.filter((a) => a.kind === 'group').length,
    primitives: scene.assets.filter((a) => a.kind === 'primitive').length,
    models: scene.assets.filter((a) => a.kind === 'model').length,
    cameras: (scene.cameras || []).length,
    lights: lights.length,
  };
  const problems = {
    floating: query.floating.filter((f) => !byId.get(scene.assets.find((a) => a.name === f.name)?.id || '')?.hidden),
    sunk: query.sunk,
    overlaps: query.overlaps.slice(0, 30),
    ...(query.overlaps.length > 30 ? { moreOverlaps: query.overlaps.length - 30 } : {}),
    estimatedBounds: query.estimated,
  };

  // Plain-language paragraph.
  const sentences: string[] = [];
  sentences.push(counts.objects
    ? `The set has ${counts.objects} objects (${counts.groups} groups, ${counts.primitives} primitives, ${counts.models} models), ${counts.lights} light${counts.lights === 1 ? '' : 's'} and ${counts.cameras} camera${counts.cameras === 1 ? '' : 's'}.`
    : `The set is empty apart from ${counts.lights} light${counts.lights === 1 ? '' : 's'} and ${counts.cameras} camera${counts.cameras === 1 ? '' : 's'}.`);
  if (extent) sentences.push(`Everything fits in ${fmt(extent.max[0] - extent.min[0])} × ${fmt(extent.max[1] - extent.min[1])} m and reaches ${fmt(extent.max[2])} m high.`);
  const groups = hierarchy.filter((n) => n.type === 'group').slice(0, 8);
  if (groups.length) sentences.push(`Top-level groups: ${groups.map((g) => `${g.name} (${sizeText(g.size)} m${g.children ? `, ${g.children.length} parts` : ''})`).join(', ')}.`);
  if (query.camera && active) {
    const seen = query.camera.visible.filter((hit) => { const asset = assets.get(hit.id); return !!asset && !(asset.parentId && assets.has(asset.parentId)); }).slice(0, 6);
    const shown = (seen.length ? seen : query.camera.visible.slice(0, 6)).map((hit) => `${hit.name} (${hit.framePercent} %, ${hit.vertical} ${hit.horizontal})`);
    sentences.push(`The active camera "${active.name}" (${fmt(active.lensMm)} mm) ${shown.length ? `sees ${shown.join(', ')}` : 'sees no objects'}.`);
  }
  const issueText = [
    problems.floating.length ? `${problems.floating.length} floating (${problems.floating.slice(0, 4).map((f) => `${f.name} ${fmt(f.gap ?? 0)} m up`).join(', ')})` : '',
    problems.sunk.length ? `${problems.sunk.length} stuck in the floor (${problems.sunk.slice(0, 4).map((f) => f.name).join(', ')})` : '',
    query.overlaps.length ? `${query.overlaps.length} overlapping pair${query.overlaps.length === 1 ? '' : 's'} (${query.overlaps.slice(0, 3).map((o) => `${o.a} ↔ ${o.b}`).join(', ')})` : '',
    problems.estimatedBounds.length ? `${problems.estimatedBounds.length} model${problems.estimatedBounds.length === 1 ? '' : 's'} with estimated size` : '',
  ].filter(Boolean);
  sentences.push(issueText.length ? `Problems: ${issueText.join('; ')}.` : 'No floating, sunk or overlapping objects.');
  if (lights.length) sentences.push(`Lights: ${lights.slice(0, 5).map((l) => `${l.name} (${l.type}, ${fmt(l.power)} ${l.unit})`).join(', ')}.`);

  return {
    summary: sentences.join(' '),
    units: 'metres, Blender convention (Z up, X right, Y into the scene); size = world bounding box [x, y, z]; at = centre (groups and models: origin)',
    counts,
    extent,
    hierarchy,
    ...(truncated ? { truncated: `${truncated} more objects not listed (raise maxObjects or use setdesign_query with objects).` } : {}),
    cameras,
    lights,
    world: scene.world,
    output,
    shading: scene.shading || 'solid',
    inActiveCamera: query.camera ? query.camera.visible.slice(0, 20) : [],
    problems,
  };
};
