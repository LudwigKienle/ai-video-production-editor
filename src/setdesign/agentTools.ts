/**
 * Set design tools for external agents (MCP server "ai-video-studio", REST /api/tools).
 * Each tool runs the same command the workspace UI runs (commands.ts via bus.ts), so an agent
 * and the user can work on one set together and see each other's changes at once.
 *
 * Coordinates: Blender convention (Z up, metres, Euler XYZ degrees).
 */
import type { SetDesignState } from '../types';
import type { SetDesignBus } from './bus.ts';
import { describeCamera } from './cameraMath.ts';
import { SET_DESIGN_COMMANDS, describeObject, listCommands, type ParamSpec } from './commands.ts';
import { findSceneObject, getActiveCamera, outlinerItems } from './sceneModel.ts';
import { CAMERA_MOVE_PRESETS, DEFAULT_CAMERA_PATH, exportCameraPath, sortKeyframes } from './cameraPath.ts';
import { buildBlenderScript } from './blenderExport.ts';
import { toBlenderLocation } from './coords.ts';
import { BUILTIN_ASSET_PACKS, buildAssetPackManifest, getAssetPackItemsByType, getDownloadableAssetPacks } from '../data/assetPacks.ts';

export type CapturePass = 'beauty' | 'clay' | 'depth';

export type CaptureRequest = {
  cameraId: string;
  width: number;
  height: number;
  pass: CapturePass;
  shading?: SetDesignState['shading'];
};

export type CaptureResult = { dataUrl: string; width: number; height: number };

export type SetDesignAgentDeps = {
  bus: SetDesignBus;
  /** Render a camera without overlays (sceneBuilder/renderFrame.ts in the app). */
  capture?: (request: CaptureRequest, scene: SetDesignState) => Promise<CaptureResult>;
  /** Add an image to the project media; returns its media id. */
  addMedia?: (payload: { dataUrl: string; name: string; prompt: string; width: number; height: number }) => Promise<{ id: string; url: string }> | { id: string; url: string };
  /** Put the frame on a storyboard shot (as a new image version). */
  applyToShot?: (payload: { shotNumber: number; imageUrl: string; prompt: string }) => void | Promise<void>;
  /** Add the frame as an image version to a reference (location, prop …), by id or name. */
  applyToReference?: (payload: { reference: string; imageUrl: string; prompt: string }) => string | Promise<string>;
  /** Show the set design workspace to the user. */
  openWorkspace?: () => void | Promise<void>;
};

const toSchema = (params: Record<string, ParamSpec> | undefined, required?: string[]) => ({
  type: 'object',
  properties: Object.fromEntries(Object.entries(params || {}).map(([key, spec]) => [key, {
    type: spec.type,
    description: spec.description,
    ...(spec.enum ? { enum: spec.enum } : {}),
    ...(spec.items ? { items: spec.items } : {}),
  }])),
  ...(required && required.length ? { required } : {}),
});

const commandSchema = (id: string, extra: Record<string, ParamSpec> = {}) => {
  const command = SET_DESIGN_COMMANDS.find((entry) => entry.id === id);
  if (!command) throw new Error(`Missing command ${id}`);
  return toSchema({ ...(command.params || {}), ...extra }, command.required);
};

/** Tool name → command id for tools that are a thin wrapper around one command. */
export const SET_DESIGN_TOOL_COMMANDS: Record<string, string> = {
  setdesign_add_primitive: 'object.add_primitive',
  setdesign_import_model: 'object.add_model',
  setdesign_add_camera: 'object.add_camera',
  setdesign_add_light: 'object.add_light',
  setdesign_transform_object: 'object.transform',
  setdesign_update_object: 'object.update',
  setdesign_duplicate_objects: 'object.duplicate',
  setdesign_delete_objects: 'object.delete',
  setdesign_select_objects: 'select.set',
  setdesign_hide_objects: 'object.hide',
  setdesign_aim_object: 'object.aim',
  setdesign_set_active_camera: 'camera.set_active',
  setdesign_align_camera_to_view: 'camera.from_view',
  setdesign_set_shading: 'view.shading',
  setdesign_set_overlays: 'view.overlays',
  setdesign_set_output: 'scene.output',
  setdesign_set_world: 'scene.world',
  setdesign_set_hdri: 'scene.hdri',
  setdesign_add_camera_keyframe: 'cameraPath.add_keyframe',
  setdesign_update_camera_keyframe: 'cameraPath.update_keyframe',
  setdesign_remove_camera_keyframes: 'cameraPath.remove_keyframes',
  setdesign_set_camera_path: 'cameraPath.settings',
  setdesign_seek_camera_path: 'cameraPath.seek',
  setdesign_camera_from_shot: 'camera.from_shot',
  setdesign_apply_material_preset: 'material.preset',
};

const PREFIX = 'Set Design (3D set/location blocking, Blender-style; coordinates Z up, metres, degrees): ';

export const SET_DESIGN_TOOL_DECLARATIONS = [
  {
    name: 'setdesign_get_scene',
    description: `${PREFIX}read the whole set: objects (meshes, models, cameras, lights) with ids, names, location/rotation/scale, camera lens and sensor, light power, the active camera with a plain-language set-up line for prompts, output size, shading, selection and undo history. Call this first.`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'setdesign_list_commands',
    description: `${PREFIX}every command the workspace UI offers (id, German label, menu, shortcut, parameters). Run any of them with setdesign_run_command.`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'setdesign_run_command',
    description: `${PREFIX}run any workspace command by id (see setdesign_list_commands), e.g. view.preset, view.frame, tool.set, workspace.tab, edit.undo.`,
    parameters: { type: 'object', properties: { command: { type: 'string', description: 'Command id.' }, args: { type: 'object', description: 'Command arguments.' } }, required: ['command'] },
  },
  {
    name: 'setdesign_open_workspace',
    description: `${PREFIX}show the set design workspace to the user, optionally on a tab (layout, camera, lighting, assets, classic).`,
    parameters: { type: 'object', properties: { tab: { type: 'string', description: 'Tab.', enum: ['layout', 'camera', 'lighting', 'assets', 'classic'] } } },
  },
  { name: 'setdesign_add_primitive', description: `${PREFIX}add a primitive (box, plane, sphere, cylinder, cone, torus, wall, person stand-in). Returns its id.`, parameters: commandSchema('object.add_primitive') },
  { name: 'setdesign_import_model', description: `${PREFIX}import a GLB/glTF/OBJ/FBX model from a URL or local file path.`, parameters: commandSchema('object.add_model') },
  { name: 'setdesign_add_camera', description: `${PREFIX}add a real camera (focal length in mm, sensor preset/size), aimed at a point or object; it becomes the active camera.`, parameters: commandSchema('object.add_camera') },
  { name: 'setdesign_add_light', description: `${PREFIX}add a point, sun, spot or area light with power in watts, colour or colour temperature.`, parameters: commandSchema('object.add_light') },
  { name: 'setdesign_transform_object', description: `${PREFIX}move, rotate or scale an object (absolute, or relative=true).`, parameters: commandSchema('object.transform') },
  { name: 'setdesign_update_object', description: `${PREFIX}change properties (Properties editor): name, visibility, lock, material; camera lens/sensor/shift/clip/focus; light type/power/colour/temperature/spot/size/shadows.`, parameters: commandSchema('object.update') },
  { name: 'setdesign_duplicate_objects', description: `${PREFIX}duplicate objects (Shift+D).`, parameters: commandSchema('object.duplicate') },
  { name: 'setdesign_delete_objects', description: `${PREFIX}delete objects (X).`, parameters: commandSchema('object.delete') },
  { name: 'setdesign_select_objects', description: `${PREFIX}select objects in the outliner/viewport (replace, add, remove, toggle).`, parameters: commandSchema('select.set') },
  { name: 'setdesign_hide_objects', description: `${PREFIX}hide objects (outliner eye) or show all hidden ones again.`, parameters: commandSchema('object.hide') },
  { name: 'setdesign_aim_object', description: `${PREFIX}point a camera or light at a point or another object.`, parameters: commandSchema('object.aim') },
  { name: 'setdesign_set_active_camera', description: `${PREFIX}choose the active scene camera.`, parameters: commandSchema('camera.set_active') },
  { name: 'setdesign_align_camera_to_view', description: `${PREFIX}move the active camera to the current viewport view (Ctrl+Alt+Numpad 0) and look through it.`, parameters: commandSchema('camera.from_view') },
  {
    name: 'setdesign_set_view',
    description: `${PREFIX}control the viewport: look through a camera (camera=true, optional object), a numpad view (front, back, right, left, top, bottom), frame all/selected, or place the free view (location/target/fov).`,
    parameters: toSchema({
      camera: { type: 'boolean', description: 'true = look through the active camera, false = free view.' },
      object: { type: 'string', description: 'Camera to look through (makes it active).' },
      view: { type: 'string', description: 'Numpad view.', enum: ['front', 'back', 'right', 'left', 'top', 'bottom'] },
      ortho: { type: 'boolean', description: 'Orthographic projection.' },
      frame: { type: 'string', description: 'Frame all objects or the selection.', enum: ['all', 'selected'] },
      location: { type: 'array', description: 'Free view eye location [x, y, z].', items: { type: 'number' } },
      target: { type: 'array', description: 'Free view target [x, y, z].', items: { type: 'number' } },
      fov: { type: 'number', description: 'Free view vertical field of view in degrees.' },
    }),
  },
  { name: 'setdesign_set_shading', description: `${PREFIX}viewport shading: wireframe, solid, material or rendered.`, parameters: commandSchema('view.shading') },
  { name: 'setdesign_set_overlays', description: `${PREFIX}overlays: grid, thirds, safe areas, passepartout, camera frustums.`, parameters: commandSchema('view.overlays') },
  { name: 'setdesign_set_output', description: `${PREFIX}reference frame size in pixels (sets the camera frame aspect ratio).`, parameters: commandSchema('scene.output') },
  { name: 'setdesign_set_world', description: `${PREFIX}world background colour and ambient strength.`, parameters: commandSchema('scene.world') },
  { name: 'setdesign_set_hdri', description: `${PREFIX}environment map (.hdr/.exr URL or local file) for lighting and optionally as background; clear=true removes it.`, parameters: commandSchema('scene.hdri') },
  {
    name: 'setdesign_get_camera_path',
    description: `${PREFIX}the camera move (keyframes of the viewport camera with ids, times, location/target/fov), its settings, and the exported JSON a motion-control or video tool can read (what "copy camera path" copies).`,
    parameters: { type: 'object', properties: {} },
  },
  { name: 'setdesign_add_camera_keyframe', description: `${PREFIX}add a camera move keyframe from the free view, the active camera or an explicit pose.`, parameters: commandSchema('cameraPath.add_keyframe') },
  { name: 'setdesign_update_camera_keyframe', description: `${PREFIX}change a camera move keyframe (time, label, pose).`, parameters: commandSchema('cameraPath.update_keyframe') },
  { name: 'setdesign_remove_camera_keyframes', description: `${PREFIX}remove camera move keyframes (ids or all).`, parameters: commandSchema('cameraPath.remove_keyframes') },
  { name: 'setdesign_set_camera_path', description: `${PREFIX}camera move settings (duration, fps, loop, easing) or replace it with a preset move (push-in, orbit, crane-up, dolly-left).`, parameters: commandSchema('cameraPath.settings') },
  { name: 'setdesign_seek_camera_path', description: `${PREFIX}jump the free view to the camera move pose at a time.`, parameters: commandSchema('cameraPath.seek') },
  { name: 'setdesign_camera_from_shot', description: `${PREFIX}set the view (or the active camera) from a storyboard shot's lens, yaw and pitch.`, parameters: commandSchema('camera.from_shot') },
  { name: 'setdesign_apply_material_preset', description: `${PREFIX}apply a built-in material preset to meshes.`, parameters: commandSchema('material.preset') },
  {
    name: 'setdesign_list_presets',
    description: `${PREFIX}built-in presets and packs: HDRI environments, render presets (classic page), material presets, camera move presets and downloadable asset packs (with licence and source).`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'setdesign_get_pack_manifest',
    description: `${PREFIX}the JSON manifest of an asset pack (what the classic page downloads as file), default the starter HDRI pack.`,
    parameters: { type: 'object', properties: { packId: { type: 'string', description: 'Pack id (see setdesign_list_presets).' } } },
  },
  {
    name: 'setdesign_export_blender_script',
    description: `${PREFIX}the whole set as a Blender Python script (Blender 4.2+/5.x): primitives at real size, models, cameras with lens/sensor/shift/clip/focus, lights with power and colour, world, output size and active camera, built in a new scene "AVPE Set". Run it in Blender (Scripting > Run Script) or through a Blender MCP.`,
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'setdesign_history',
    description: `${PREFIX}undo or redo the last change, or list the history.`,
    parameters: toSchema({ action: { type: 'string', description: 'undo, redo or list.', enum: ['undo', 'redo', 'list'] } }, ['action']),
  },
  {
    name: 'setdesign_capture_frame',
    description: `${PREFIX}render a reference frame through a camera (default: the active one) without overlays and return it as an image. pass: beauty (current shading), clay (neutral grey, good for edit models) or depth (white = near). Optionally add it to the project media, to a storyboard shot (as a new frame version) and/or to a reference such as a location (Concept). The reply includes a sober camera set-up line for prompts.`,
    parameters: toSchema({
      camera: { type: 'string', description: 'Camera id or name (default: active camera).' },
      pass: { type: 'string', description: 'Render pass.', enum: ['beauty', 'clay', 'depth'] },
      width: { type: 'number', description: 'Width in px (default: scene output size).' },
      height: { type: 'number', description: 'Height in px (default: scene output size).' },
      addToMedia: { type: 'boolean', description: 'Add the image to the project media (default true).' },
      shotNumber: { type: 'number', description: 'Storyboard shot number to put the frame on.' },
      reference: { type: 'string', description: 'Reference id or name (e.g. a location) to add the frame to.' },
      returnImage: { type: 'boolean', description: 'Include the image in the reply (default true).' },
    }),
  },
];

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Everything an agent needs to understand the set. */
export const sceneOverview = (bus: SetDesignBus) => {
  const scene = bus.getScene();
  const ui = bus.getUi();
  const output = scene.output || { width: 1920, height: 1080 };
  const active = getActiveCamera(scene);
  const objects = outlinerItems(scene).map((item) => describeObject(scene, findSceneObject(scene, item.id)!));
  return {
    coordinates: 'Blender convention: Z up, metres, rotation Euler XYZ in degrees. A camera with rotation [90, 0, 0] looks level along +Y.',
    output,
    shading: scene.shading || 'solid',
    world: scene.world,
    activeCamera: active ? {
      id: active.id,
      name: active.name,
      setup: describeCamera(active, output.width / output.height),
    } : null,
    objects,
    selection: ui.selectedIds,
    activeObject: ui.activeId,
    view: { lookThroughCamera: ui.lookThroughCamera, preset: ui.viewPreset, ortho: ui.ortho, tab: ui.workspaceTab },
    history: bus.history(),
  };
};

export const createSetDesignAgentExecutor = (deps: SetDesignAgentDeps): Record<string, (args: Record<string, unknown>) => Promise<unknown>> => {
  const { bus } = deps;
  const tools: Record<string, (args: Record<string, unknown>) => Promise<unknown>> = {
    setdesign_get_scene: async () => sceneOverview(bus),
    setdesign_list_commands: async () => ({ commands: [...listCommands(), { id: 'edit.undo', label: 'Rückgängig', shortcut: 'Strg+Z' }, { id: 'edit.redo', label: 'Wiederholen', shortcut: 'Strg+Shift+Z' }] }),
    setdesign_run_command: async (args) => {
      const id = asString(args.command);
      if (!id) throw new Error('Pass command (see setdesign_list_commands).');
      const commandArgs = args.args && typeof args.args === 'object' ? args.args as Record<string, unknown> : {};
      return { command: id, result: bus.run(id, commandArgs) };
    },
    setdesign_open_workspace: async (args) => {
      await deps.openWorkspace?.();
      const tab = asString(args.tab);
      if (tab) bus.run('workspace.tab', { tab });
      return { open: true, tab: bus.getUi().workspaceTab };
    },
    setdesign_set_view: async (args) => {
      const done: unknown[] = [];
      if (asString(args.view)) done.push(bus.run('view.preset', { view: args.view, ortho: args.ortho }));
      else if (typeof args.ortho === 'boolean') done.push(bus.run('view.toggle_ortho', { ortho: args.ortho }));
      if (args.location !== undefined || args.target !== undefined || args.fov !== undefined) done.push(bus.run('view.set', { location: args.location, target: args.target, fov: args.fov }));
      if (asString(args.frame)) done.push(bus.run('view.frame', { what: args.frame }));
      if (typeof args.camera === 'boolean' || asString(args.object)) done.push(bus.run('view.camera', { on: typeof args.camera === 'boolean' ? args.camera : true, object: args.object }));
      if (!done.length) throw new Error('Pass camera, view, frame, ortho or location/target/fov.');
      const ui = bus.getUi();
      return { lookThroughCamera: ui.lookThroughCamera, view: ui.viewPreset, ortho: ui.ortho, camera: getActiveCamera(bus.getScene())?.name };
    },
    setdesign_get_camera_path: async () => {
      const path = bus.getScene().cameraPath || DEFAULT_CAMERA_PATH;
      return {
        durationSeconds: path.durationSeconds,
        fps: path.fps,
        loop: !!path.loop,
        easing: path.easing || 'smooth',
        keyframes: sortKeyframes(path.keyframes).map((kf) => ({ id: kf.id, time: kf.time, label: kf.label, location: toBlenderLocation(kf.camera.position), target: toBlenderLocation(kf.camera.target), fov: Number(kf.camera.fov.toFixed(2)) })),
        presets: CAMERA_MOVE_PRESETS.map((p) => ({ id: p.id, label: p.label })),
        export: exportCameraPath(path),
      };
    },
    setdesign_list_presets: async () => {
      const short = (items: ReturnType<typeof getAssetPackItemsByType>) => items.map((item) => ({ id: item.id, label: item.label, pack: item.packLabel, license: item.packLicense, ...(item.url ? { url: item.url } : {}), ...(item.renderPreset ? { settings: item.renderPreset } : {}), ...(item.metadata ? { values: item.metadata } : {}) }));
      return {
        hdri: short(getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'hdri')),
        renderPresets: short(getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'render-preset').filter((item) => item.renderPreset)),
        materialPresets: short(getAssetPackItemsByType(BUILTIN_ASSET_PACKS, 'material').filter((item) => item.metadata)),
        cameraMoves: CAMERA_MOVE_PRESETS.map((p) => ({ id: p.id, label: p.label })),
        downloadablePacks: getDownloadableAssetPacks().map((pack) => ({ id: pack.id, label: pack.label, license: pack.license, source: pack.sourceUrl, items: pack.items.length })),
      };
    },
    setdesign_get_pack_manifest: async (args) => {
      const packId = asString(args.packId);
      const pack = packId ? BUILTIN_ASSET_PACKS.find((entry) => entry.id === packId) : BUILTIN_ASSET_PACKS.find((entry) => entry.id === 'polyhaven-starter-hdris') || BUILTIN_ASSET_PACKS[0];
      if (!pack) throw new Error(`No pack ${packId}. Packs: ${BUILTIN_ASSET_PACKS.map((entry) => entry.id).join(', ')}.`);
      return { manifest: buildAssetPackManifest(pack) };
    },
    setdesign_export_blender_script: async () => {
      const script = buildBlenderScript(bus.getScene());
      return { fileName: 'avpe_set.py', lines: script.split('\n').length, script };
    },
    setdesign_history: async (args) => {
      const action = asString(args.action);
      if (action === 'undo') return bus.undo();
      if (action === 'redo') return bus.redo();
      if (action === 'list') return bus.history();
      throw new Error('action must be undo, redo or list.');
    },
    setdesign_capture_frame: async (args) => {
      if (!deps.capture) throw new Error('Frame capture needs the editor window (WebGL).');
      const scene = bus.getScene();
      const cameraKey = asString(args.camera);
      const camera = cameraKey ? findSceneObject(scene, cameraKey) : null;
      if (cameraKey && (!camera || camera.kind !== 'camera')) throw new Error(`No camera "${cameraKey}" in the set.`);
      const active = camera?.kind === 'camera' ? camera.object : getActiveCamera(scene);
      if (!active) throw new Error('The set has no camera. Add one with setdesign_add_camera.');
      const pass = (asString(args.pass) || 'beauty') as CapturePass;
      if (!['beauty', 'clay', 'depth'].includes(pass)) throw new Error('pass must be beauty, clay or depth.');
      const output = scene.output || { width: 1920, height: 1080 };
      const width = Math.round(Math.min(8192, Math.max(16, Number(args.width) || output.width)));
      const height = Math.round(Math.min(8192, Math.max(16, Number(args.height) || (args.width ? (Number(args.width) * output.height) / output.width : output.height))));
      const frame = await deps.capture({ cameraId: active.id, width, height, pass }, scene);
      const setup = describeCamera(active, width / height);
      const name = `${active.name} – ${pass === 'beauty' ? 'Referenzframe' : pass === 'clay' ? 'Clay' : 'Tiefe'}`;
      const prompt = `Set reference frame (${pass}). ${setup.en}.`;
      const notes: string[] = [];
      let imageUrl = frame.dataUrl;
      let mediaId: string | undefined;
      if (args.addToMedia !== false && deps.addMedia) {
        const media = await deps.addMedia({ dataUrl: frame.dataUrl, name, prompt, width: frame.width, height: frame.height });
        mediaId = media.id;
        imageUrl = media.url || imageUrl;
        notes.push('added to media');
      }
      const shotNumber = typeof args.shotNumber === 'number' ? args.shotNumber : undefined;
      if (shotNumber !== undefined) {
        if (!deps.applyToShot) throw new Error('Storyboard shots are not available here.');
        await deps.applyToShot({ shotNumber, imageUrl, prompt });
        notes.push(`set on shot ${shotNumber}`);
      }
      const reference = asString(args.reference);
      if (reference) {
        if (!deps.applyToReference) throw new Error('References are not available here.');
        notes.push(`added to reference ${await deps.applyToReference({ reference, imageUrl, prompt })}`);
      }
      const summary = {
        camera: active.name,
        pass,
        width: frame.width,
        height: frame.height,
        mediaId,
        setup,
        done: notes,
      };
      if (args.returnImage === false) return summary;
      const match = /^data:(image\/[a-z]+);base64,(.*)$/.exec(frame.dataUrl);
      return {
        ...summary,
        __mcpContent: [
          ...(match ? [{ type: 'image', mimeType: match[1], data: match[2] }] : []),
          { type: 'text', text: JSON.stringify(summary, null, 2) },
        ],
      };
    },
  };
  for (const [tool, commandId] of Object.entries(SET_DESIGN_TOOL_COMMANDS)) {
    tools[tool] = async (args) => bus.run(commandId, args || {});
  }
  return tools;
};
