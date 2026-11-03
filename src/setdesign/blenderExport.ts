/**
 * Exports a set design as a self-contained Blender Python script (Blender 4.2+ / 5.x). Running it
 * (Scripting → Run Script, or an agent through the Blender MCP) builds the set in its own scene
 * "AVPE Set": primitives at their real sizes, imported models, groups as empties with their
 * children parented (transforms are parent-relative in both programs), PBR materials as Principled
 * BSDF with image textures, cameras with lens/sensor/shift/clip/focus, lights with Blender power and
 * colour, world, output size and the active camera. Other scenes in the .blend stay untouched.
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

const pyDict = (entries: Array<[string, string]>) => `{${entries.map(([key, value]) => `${str(key)}: ${value}`).join(', ')}}`;

/** Python call that builds the asset's material (Principled BSDF, with textures when it has maps). */
export const materialCall = (asset: SetDesignAsset) => {
  const mat = asset.material || {};
  const name = mat.name || `${asset.name} Material`;
  const base = `${str(name)}, ${rgba(mat.color || (mat.maps?.baseColor ? '#ffffff' : '#b4b4b8'), mat.opacity ?? 1)}, ${num(mat.roughness ?? (mat.maps?.roughness ? 1 : 0.8))}, ${num(mat.metalness ?? (mat.maps?.metalness ? 1 : 0))}`;
  const maps = Object.entries(mat.maps || {}).filter(([, url]) => !!url && !url.startsWith('blob:')) as Array<[string, string]>;
  if (!maps.length && !mat.emissive) return `material(${base})`;
  const emission = mat.emissive || (mat.maps?.emissive ? '#ffffff' : '');
  return `pbr_material(${base}, ${pyDict(maps.map(([key, url]) => [key, str(url)]))}, (${num(mat.repeat?.[0] ?? 1)}, ${num(mat.repeat?.[1] ?? 1)}), ${emission ? rgba(emission) : 'None'}, ${num(mat.emissiveIntensity ?? 1)}, ${num(mat.displacementScale ?? 0.02)})`;
};

const assetLines = (asset: SetDesignAsset, index: number): string[] => {
  const v = `o${index}`;
  const lines: string[] = [`# ${asset.name}`];
  const scale = toBlenderScale(asset.scale);
  const mat = asset.material || {};
  if (mat.attribution) lines.push(`# Material ${mat.name || ''}: ${mat.attribution.author}, ${mat.attribution.license}${mat.attribution.url ? `, ${mat.attribution.url}` : ''}`.replace(/\n/g, ' '));
  if (asset.kind === 'group') {
    lines.push(`${v} = link(bpy.data.objects.new(${str(asset.name)}, None))`, `${v}.empty_display_type = 'PLAIN_AXES'`, `${v}.empty_display_size = 0.25`);
  } else if (asset.kind === 'model') {
    if (!asset.url || asset.url.startsWith('data:') || asset.url.startsWith('blob:')) {
      lines.push(`print('Skipped ${asset.name.replace(/'/g, '')}: embedded model, export it as a file first.')`);
      lines.push(`${v} = link(bpy.data.objects.new(${str(asset.name)}, None))`);
    } else lines.push(`${v} = import_model(${str(asset.url)}, ${str(asset.format || 'glb')}, ${str(asset.name)})`);
    if (mat.replaceModelMaterials) lines.push(`assign_material(${v}, ${materialCall(asset)})`);
  } else {
    const def = PRIMITIVES.find((p) => p.id === asset.primitive) || PRIMITIVES[0];
    // Base dimensions in Blender axes (three.js x, z, y).
    const dims = { x: def.size.x, y: def.size.z, z: def.size.y || 1 };
    lines.push(`${v} = primitive(${str(def.id)}, ${str(asset.name)}, ${vec(dims)})`);
    lines.push(`assign_material(${v}, ${materialCall(asset)})`);
  }
  lines.push(...transformLines(v, asset.position, asset.rotation, 'mesh'));
  lines.push(`${v}.scale = ${vec(scale)}`);
  if (asset.hidden) lines.push(`${v}.hide_viewport = True`, `${v}.hide_render = True`);
  lines.push(`objs[${str(asset.id)}] = ${v}`);
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
objs = {}

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

def load_image(source):
    try:
        if source.startswith('data:'):
            import base64
            header, data = source.split(',', 1)
            ext = '.png' if 'png' in header else '.jpg' if ('jpeg' in header or 'jpg' in header) else '.exr' if 'exr' in header else '.img'
            fd, path = tempfile.mkstemp(suffix=ext)
            os.close(fd)
            with open(path, 'wb') as handle:
                handle.write(base64.b64decode(data))
            img = bpy.data.images.load(path)
            img.pack()
            return img
        if source.startswith('http://') or source.startswith('https://'):
            suffix = os.path.splitext(urllib.parse.urlparse(source).path)[1] or '.png'
            fd, path = tempfile.mkstemp(suffix=suffix)
            os.close(fd)
            urllib.request.urlretrieve(source, path)
            img = bpy.data.images.load(path)
            img.pack()
            return img
        path = urllib.parse.unquote(source[7:]) if source.startswith('file://') else source
        return bpy.data.images.load(path, check_existing=True)
    except Exception as error:
        print('Texture skipped:', source[:80], error)
        return None

def pbr_material(name, rgba, roughness, metallic, maps, repeat, emission, emission_strength, displacement_scale):
    mat = material(name, rgba, roughness, metallic)
    nt = mat.node_tree
    bsdf = nt.nodes.get('Principled BSDF') if nt else None
    if not bsdf:
        return mat
    def set_input(names, value):
        for key in names:
            if key in bsdf.inputs:
                bsdf.inputs[key].default_value = value
                return bsdf.inputs[key]
        return None
    if emission:
        set_input(('Emission Color', 'Emission'), emission)
        set_input(('Emission Strength',), emission_strength)
    if not maps:
        return mat
    try:
        links = nt.links
        coord = nt.nodes.new('ShaderNodeTexCoord')
        mapping = nt.nodes.new('ShaderNodeMapping')
        mapping.inputs['Scale'].default_value = (repeat[0], repeat[1], 1)
        links.new(coord.outputs['UV'], mapping.inputs['Vector'])
        def tex(key, color):
            if key not in maps:
                return None
            img = load_image(maps[key])
            if not img:
                return None
            if not color:
                img.colorspace_settings.name = 'Non-Color'
            node = nt.nodes.new('ShaderNodeTexImage')
            node.image = img
            links.new(mapping.outputs['Vector'], node.inputs['Vector'])
            return node
        def multiply(a, b_color=None, b_socket=None):
            mix = nt.nodes.new('ShaderNodeMix')
            mix.data_type = 'RGBA'
            mix.blend_type = 'MULTIPLY'
            mix.inputs[0].default_value = 1.0
            links.new(a, mix.inputs[6])
            if b_socket is not None:
                links.new(b_socket, mix.inputs[7])
            else:
                mix.inputs[7].default_value = b_color
            return mix.outputs[2]
        base = tex('baseColor', True)
        if base:
            out = base.outputs['Color']
            if tuple(rgba[:3]) != (1.0, 1.0, 1.0):
                out = multiply(out, b_color=rgba)
            ao = tex('ao', False)
            if ao:
                out = multiply(out, b_socket=ao.outputs['Color'])
            links.new(out, bsdf.inputs['Base Color'])
        for key, names in (('roughness', ('Roughness',)), ('metalness', ('Metallic',))):
            node = tex(key, False)
            if node:
                links.new(node.outputs['Color'], bsdf.inputs[names[0]])
        normal = tex('normal', False)
        if normal:
            nmap = nt.nodes.new('ShaderNodeNormalMap')
            links.new(normal.outputs['Color'], nmap.inputs['Color'])
            links.new(nmap.outputs['Normal'], bsdf.inputs['Normal'])
        glow = tex('emissive', True)
        if glow:
            for key in ('Emission Color', 'Emission'):
                if key in bsdf.inputs:
                    links.new(glow.outputs['Color'], bsdf.inputs[key])
                    break
        height = tex('displacement', False)
        output = nt.nodes.get('Material Output')
        if height and output:
            disp = nt.nodes.new('ShaderNodeDisplacement')
            disp.inputs['Scale'].default_value = displacement_scale
            links.new(height.outputs['Color'], disp.inputs['Height'])
            links.new(disp.outputs['Displacement'], output.inputs['Displacement'])
    except Exception as error:
        print('Material', name, 'textures incomplete:', error)
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
        parts = [('Kopf', 'sphere', (0, 0, 1.64 - 0.875), (0.22, 0.22, 0.22)),
                 ('Koerper', 'capsule', (0, 0, 1.2 - 0.875), (0.3, 0.3, 0.72)),
                 ('Bein L', 'capsule', (-0.1, 0, 0.415 - 0.875), (0.15, 0.15, 0.83)),
                 ('Bein R', 'capsule', (0.1, 0, 0.415 - 0.875), (0.15, 0.15, 0.83)),
                 ('Arm L', 'capsule', (-0.2, 0, 1.15 - 0.875), (0.1, 0.1, 0.62)),
                 ('Arm R', 'capsule', (0.2, 0, 1.15 - 0.875), (0.1, 0.1, 0.62)),
                 ('Nase', 'nose', (0, -0.12, 1.64 - 0.875), (0.05, 0.06, 0.05))]
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
  // Hierarchy: Blender keeps the child's location/rotation/scale relative to the parent, like the set.
  const ids = new Set(state.assets.map((asset) => asset.id));
  const parented = state.assets.filter((asset) => asset.parentId && ids.has(asset.parentId));
  if (parented.length) {
    lines.push('# Hierarchy (groups are empties)');
    for (const asset of parented) lines.push(`objs[${str(asset.id)}].parent = objs[${str(asset.parentId!)}]`);
    lines.push('');
  }
  (state.cameras || []).forEach((camera, index) => { lines.push(...cameraLines(camera, index, camera.id === state.activeCameraId), ''); });
  state.lights.forEach((light, index) => { const block = lightLines(light, index); if (block.length) lines.push(...block, ''); });
  lines.push(`print('AVPE Set: ${state.assets.length} objects, ${(state.cameras || []).length} cameras, ${state.lights.filter((l) => l.type !== 'ambient').length} lights.')`);
  return `${lines.join('\n')}\n`;
};
