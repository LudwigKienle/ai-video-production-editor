/**
 * Exports a set design as a self-contained Blender Python script (Blender 4.2+ / 5.x). Running it
 * (Scripting → Run Script, or an agent through the Blender MCP) builds the set in its own scene
 * "AVPE Set": primitives at their real sizes, imported models, cameras with lens/sensor/shift/
 * clip/focus, lights with Blender power and colour, world, output size and the active camera.
 * Other scenes in the .blend stay untouched.
 */
import type { SetDesignAsset, SetDesignCameraObject, SetDesignLight, SetDesignState } from '../types';
import { toBlenderLocation, toBlenderRotation, toBlenderScale, type RotationKind } from './coords.ts';
import { PRIMITIVES } from './sceneModel.ts';
import { lightColor } from './lightColor.ts';

const num = (value: number) => (Number.isFinite(value) ? Number(value.toFixed(5)) : 0);
const vec = (v: { x: number; y: number; z: number }) => `(${num(v.x)}, ${num(v.y)}, ${num(v.z)})`;
const rad = (v: { x: number; y: number; z: number }) => `(${num((v.x * Math.PI) / 180)}, ${num((v.y * Math.PI) / 180)}, ${num((v.z * Math.PI) / 180)})`;
const str = (value: string) => `'${value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\n/g, ' ')}'`;

/** sRGB hex → Blender scene-linear RGB tuple. */
export const hexToLinear = (hex: string) => {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean.padEnd(6, '0').slice(0, 6);
  const channel = (i: number) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return [channel(0), channel(2), channel(4)].map((c) => num(c));
};
const color = (hex: string) => `(${hexToLinear(hex).join(', ')})`;
const rgba = (hex: string, alpha = 1) => `(${hexToLinear(hex).join(', ')}, ${num(alpha)})`;

const transformLines = (name: string, position: { x: number; y: number; z: number }, rotation: { x: number; y: number; z: number }, kind: RotationKind) => [
  `${name}.location = ${vec(toBlenderLocation(position))}`,
  `${name}.rotation_mode = 'XYZ'`,
  `${name}.rotation_euler = ${rad(toBlenderRotation(rotation, kind))}`,
];

const assetLines = (asset: SetDesignAsset, index: number): string[] => {
  const v = `o${index}`;
  const lines: string[] = [`# ${asset.name}`];
  const scale = toBlenderScale(asset.scale);
  const mat = asset.material || {};
  const materialCall = `material(${str(`${asset.name} Material`)}, ${rgba(mat.color || '#b4b4b8', mat.opacity ?? 1)}, ${num(mat.roughness ?? 0.8)}, ${num(mat.metalness ?? 0)})`;
  if (asset.kind === 'model') {
    if (!asset.url || asset.url.startsWith('data:') || asset.url.startsWith('blob:')) {
      lines.push(`print('Skipped ${asset.name.replace(/'/g, '')}: embedded model, export it as a file first.')`);
      return lines;
    }
    lines.push(`${v} = import_model(${str(asset.url)}, ${str(asset.format || 'glb')}, ${str(asset.name)})`);
  } else {
    const def = PRIMITIVES.find((p) => p.id === asset.primitive) || PRIMITIVES[0];
    // Base dimensions in Blender axes (three.js x, z, y).
    const dims = { x: def.size.x, y: def.size.z, z: def.size.y || 1 };
    lines.push(`${v} = primitive(${str(def.id)}, ${str(asset.name)}, ${vec(dims)})`);
    lines.push(`assign_material(${v}, ${materialCall})`);
  }
  lines.push(...transformLines(v, asset.position, asset.rotation, 'mesh'));
  lines.push(`${v}.scale = ${vec(scale)}`);
  if (asset.hidden) lines.push(`${v}.hide_viewport = True`, `${v}.hide_render = True`);
  return lines;
};

const cameraLines = (camera: SetDesignCameraObject, index: number, active: boolean): string[] => {
  const v = `c${index}`;
  const lines = [
    `# Kamera ${camera.name}`,
    `cd = bpy.data.cameras.new(${str(camera.name)})`,
    `cd.lens = ${num(camera.lensMm)}`,
    `cd.sensor_width = ${num(camera.sensorWidthMm)}`,
    `cd.sensor_height = ${num(camera.sensorHeightMm ?? camera.sensorWidthMm * (2 / 3))}`,
    `cd.sensor_fit = ${str((camera.sensorFit || 'auto').toUpperCase())}`,
    `cd.shift_x = ${num(camera.shiftX || 0)}`,
    `cd.shift_y = ${num(camera.shiftY || 0)}`,
    `cd.clip_start = ${num(camera.clipStart ?? 0.1)}`,
    `cd.clip_end = ${num(camera.clipEnd ?? 1000)}`,
    `cd.passepartout_alpha = 0.85`,
  ];
  if (camera.focusDistance && camera.focusDistance > 0) {
    lines.push('cd.dof.use_dof = True', `cd.dof.focus_distance = ${num(camera.focusDistance)}`, `cd.dof.aperture_fstop = ${num(camera.fStop ?? 2.8)}`);
  }
  lines.push(`${v} = link(bpy.data.objects.new(${str(camera.name)}, cd))`);
  lines.push(...transformLines(v, camera.position, camera.rotation, 'camera'));
  if (camera.hidden) lines.push(`${v}.hide_viewport = True`);
  if (active) lines.push(`scene.camera = ${v}`);
  return lines;
};

const LIGHT_TYPE: Record<string, string> = { point: 'POINT', sun: 'SUN', directional: 'SUN', spot: 'SPOT', area: 'AREA' };

const lightLines = (light: SetDesignLight, index: number): string[] => {
  if (light.type === 'ambient') return [];
  const v = `l${index}`;
  const type = LIGHT_TYPE[light.type];
  // Without a stored power, derive it from the three.js intensity (inverse of sceneBuilder).
  const power = light.power ?? (type === 'SUN' ? light.intensity : light.intensity * 4 * Math.PI);
  const lines = [
    `# Licht ${light.name || type}`,
    `ld = bpy.data.lights.new(${str(light.name || type)}, ${str(type)})`,
    `ld.color = ${color(lightColor(light))}`,
    type === 'SUN' ? `ld.energy = ${num(power)}` : `ld.energy = ${num(power)}`,
    `ld.use_shadow = ${light.castShadow === false ? 'False' : 'True'}`,
  ];
  if (type === 'SPOT') lines.push(`ld.spot_size = ${num(((light.spotSize ?? 45) * Math.PI) / 180)}`, `ld.spot_blend = ${num(light.spotBlend ?? 0.15)}`);
  if (type === 'AREA') {
    lines.push(`ld.shape = 'RECTANGLE'`, `ld.size = ${num(light.size ?? 1)}`, `ld.size_y = ${num(light.sizeY ?? light.size ?? 1)}`);
  }
  lines.push(`${v} = link(bpy.data.objects.new(${str(light.name || type)}, ld))`);
  lines.push(...transformLines(v, light.position || { x: 0, y: 3, z: 0 }, light.rotation || { x: -90, y: 0, z: 0 }, 'light'));
  if (light.hidden) lines.push(`${v}.hide_viewport = True`, `${v}.hide_render = True`);
  return lines;
};

const HEADER = `# Set Design export from AI Video Production Editor.
# Run in Blender (Scripting > Run Script). Builds the set in a new scene "AVPE Set".
import bpy, math, os, tempfile, urllib.parse, urllib.request

scene = bpy.data.scenes.new('AVPE Set')
bpy.context.window.scene = scene
collection = scene.collection

def link(obj):
    collection.objects.link(obj)
    return obj

def material(name, rgba, roughness, metallic):
    mat = bpy.data.materials.new(name)
    try:
        mat.use_nodes = True
    except Exception:
        pass
    bsdf = mat.node_tree.nodes.get('Principled BSDF') if mat.node_tree else None
    if bsdf:
        bsdf.inputs['Base Color'].default_value = rgba
        bsdf.inputs['Roughness'].default_value = roughness
        bsdf.inputs['Metallic'].default_value = metallic
        if rgba[3] < 1:
            bsdf.inputs['Alpha'].default_value = rgba[3]
    mat.diffuse_color = rgba
    return mat

def assign_material(obj, mat):
    for child in [obj] + list(obj.children_recursive):
        if child.type == 'MESH':
            child.data.materials.clear()
            child.data.materials.append(mat)

def mesh_object(name, build):
    import bmesh
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    build(bm)
    bm.to_mesh(me)
    bm.free()
    for poly in me.polygons:
        poly.use_smooth = True
    return link(bpy.data.objects.new(name, me))

def primitive(kind, name, dims):
    import bmesh
    from mathutils import Matrix
    sx, sy, sz = dims
    if kind == 'person':
        root = link(bpy.data.objects.new(name, None))
        root.empty_display_size = 0.3
        parts = [('Kopf', 'sphere', (0, 0, 1.62 - 0.875), (0.22, 0.22, 0.22)),
                 ('Koerper', 'capsule', (0, 0, 1.2 - 0.875), (0.34, 0.34, 0.76)),
                 ('Bein L', 'capsule', (-0.1, 0, 0.45 - 0.875), (0.15, 0.15, 0.83)),
                 ('Bein R', 'capsule', (0.1, 0, 0.45 - 0.875), (0.15, 0.15, 0.83)),
                 ('Arm L', 'capsule', (-0.25, 0, 1.15 - 0.875), (0.1, 0.1, 0.62)),
                 ('Arm R', 'capsule', (0.25, 0, 1.15 - 0.875), (0.1, 0.1, 0.62)),
                 ('Nase', 'nose', (0, -0.12, 1.62 - 0.875), (0.05, 0.06, 0.05))]
        for label, shape, loc, size in parts:
            if shape == 'sphere':
                part = mesh_object(name + ' ' + label, lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=12, radius=0.5))
            elif shape == 'nose':
                part = mesh_object(name + ' ' + label, lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.5, radius2=0.0, depth=1.0, matrix=Matrix.Rotation(math.radians(90), 4, 'X')))
            else:
                part = mesh_object(name + ' ' + label, lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.5, radius2=0.5, depth=1.0))
            part.location = loc
            part.scale = size
            part.parent = root
        return root
    if kind == 'plane':
        obj = mesh_object(name, lambda bm: bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5))
    elif kind == 'sphere':
        obj = mesh_object(name, lambda bm: bmesh.ops.create_uvsphere(bm, u_segments=48, v_segments=24, radius=0.5))
    elif kind == 'cylinder':
        obj = mesh_object(name, lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.5, radius2=0.5, depth=1.0))
    elif kind == 'cone':
        obj = mesh_object(name, lambda bm: bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=0.5, radius2=0.0, depth=1.0))
    elif kind == 'torus':
        bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.15)
        obj = bpy.context.active_object
        for c in list(obj.users_collection):
            c.objects.unlink(obj)
        collection.objects.link(obj)
        obj.name = name
        sx, sy, sz = 1, 1, 1
    else:
        obj = mesh_object(name, lambda bm: bmesh.ops.create_cube(bm, size=1.0))
    obj.data.transform(Matrix.Diagonal((sx, sy, sz if sz else 1, 1)))
    return obj

def import_model(source, fmt, name):
    path, cleanup = source, False
    if source.startswith('file://'):
        path = urllib.parse.unquote(source[7:])
    elif source.startswith('http://') or source.startswith('https://'):
        fd, path = tempfile.mkstemp(suffix='.' + fmt)
        os.close(fd)
        urllib.request.urlretrieve(source, path)
        cleanup = True
    before = set(bpy.data.objects)
    if fmt in ('glb', 'gltf'):
        bpy.ops.import_scene.gltf(filepath=path)
    elif fmt == 'obj':
        bpy.ops.wm.obj_import(filepath=path)
    elif fmt == 'fbx':
        bpy.ops.import_scene.fbx(filepath=path)
    if cleanup and os.path.exists(path):
        os.remove(path)
    root = link(bpy.data.objects.new(name, None))
    for obj in set(bpy.data.objects) - before:
        if obj.parent is None:
            obj.parent = root
        for c in list(obj.users_collection):
            if c != collection:
                c.objects.unlink(obj)
        if obj.name not in collection.objects:
            collection.objects.link(obj)
    return root
`;

/** The whole set as a Blender script. */
export const buildBlenderScript = (state: SetDesignState): string => {
  const output = state.output || { width: 1920, height: 1080 };
  const world = state.world || { color: '#3d3d40', strength: 1 };
  const lines: string[] = [HEADER, ''];
  lines.push(`scene.render.resolution_x = ${Math.round(output.width)}`, `scene.render.resolution_y = ${Math.round(output.height)}`, 'scene.render.resolution_percentage = 100', 'scene.unit_settings.system = \'METRIC\'');
  lines.push(
    "world = bpy.data.worlds.new('AVPE World')",
    'scene.world = world',
    `world.color = ${color(world.color)}`,
    "if world.node_tree and world.node_tree.nodes.get('Background'):",
    `    world.node_tree.nodes['Background'].inputs['Color'].default_value = (${hexToLinear(world.color).join(', ')}, 1)`,
    `    world.node_tree.nodes['Background'].inputs['Strength'].default_value = ${num(world.strength)}`,
    '',
  );
  state.assets.forEach((asset, index) => { lines.push(...assetLines(asset, index), ''); });
  (state.cameras || []).forEach((camera, index) => { lines.push(...cameraLines(camera, index, camera.id === state.activeCameraId), ''); });
  state.lights.forEach((light, index) => { const block = lightLines(light, index); if (block.length) lines.push(...block, ''); });
  lines.push(`print('AVPE Set: ${state.assets.length} objects, ${(state.cameras || []).length} cameras, ${state.lights.filter((l) => l.type !== 'ambient').length} lights.')`);
  return `${lines.join('\n')}\n`;
};
