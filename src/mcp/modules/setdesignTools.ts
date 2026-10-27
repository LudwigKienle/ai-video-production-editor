/**
 * MCP tool module "setdesign": the Blender-style set design workspace for agents.
 *
 * The tools run the same commands as the workspace UI (src/setdesign/commands.ts through the
 * shared bus), so an agent and the user work on one set together. Scene data is App state
 * (project field `setDesign`); useSetDesignAppBridge attaches it to the bus and provides the
 * app-level actions used here: `renderFrame` (WebGL capture), `applyToShot`, `applyToReference`.
 *
 * Generators (3D blockout, World Labs) call the provider services directly. State that only
 * lives in the "Klassisch" page (camera move playback/recording, its render settings, the AI
 * Director chat) is reached through live commands that page registers while it is open.
 */
import { registerStudioToolModule, type StudioTool, type StudioToolContext } from '../toolModules.ts';
import { invokeLiveCommand } from '../liveCommands.ts';
import { setDesignBus } from '../../setdesign/bus.ts';
import {
  SET_DESIGN_TOOL_DECLARATIONS,
  createSetDesignAgentExecutor,
  type CaptureRequest,
  type CaptureResult,
} from '../../setdesign/agentTools.ts';

/** Tools that only read or change the view (not the saved set). */
const READ_ONLY = new Set([
  'setdesign_get_scene', 'setdesign_list_commands', 'setdesign_open_workspace', 'setdesign_set_view', 'setdesign_select_objects', 'setdesign_set_overlays',
  'setdesign_get_camera_path', 'setdesign_seek_camera_path', 'setdesign_list_presets', 'setdesign_get_pack_manifest', 'setdesign_export_blender_script',
  'setdesign_search_sketchfab', 'setdesign_list_library_assets', 'setdesign_play_camera_path',
]);

const PREFIX = 'Set Design (3D set/location blocking, Blender-style; coordinates Z up, metres, degrees): ';

/** Live command names registered by the classic page and the workspace. */
export const SETDESIGN_LIVE = {
  playback: 'setdesign.classic.playback',
  record: 'setdesign.classic.record',
  renderPreset: 'setdesign.classic.renderPreset',
  renderSettings: 'setdesign.classic.renderSettings',
  aiDirector: 'setdesign.classic.aiDirector',
  libraryModels: 'setdesign.libraryModels',
} as const;

let currentContext: StudioToolContext | null = null;

const executor = createSetDesignAgentExecutor({
  bus: setDesignBus,
  capture: (request: CaptureRequest, scene) => setDesignBus.callAction('renderFrame', { request, scene }) as Promise<CaptureResult>,
  addMedia: (payload) => {
    const item = {
      id: `setdesign-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`,
      name: `${payload.name}.png`,
      type: 'image' as const,
      url: payload.dataUrl,
      source: 'generated' as const,
      generatedBy: 'Set Design',
      prompt: payload.prompt,
    };
    if (!currentContext) throw new Error('No editor context.');
    currentContext.actions.addMediaItem(item);
    return { id: item.id, url: item.url };
  },
  applyToShot: async (payload) => { await setDesignBus.callAction('applyToShot', payload); },
  applyToReference: async (payload) => String(await setDesignBus.callAction('applyToReference', payload)),
  openWorkspace: () => currentContext?.actions.setActiveWorkspace('SET_DESIGN'),
});

const asString = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

/** Paid tools refuse to run unless the agent passes confirm: true. */
const requireConfirm = (args: Record<string, unknown>, what: string) => {
  if (args.confirm !== true) throw new Error(`${what} spends provider credits. Tell the user what you are about to generate, then call again with confirm: true.`);
};

const openClassic = (ctx: StudioToolContext) => () => {
  ctx.actions.setActiveWorkspace('SET_DESIGN');
  setDesignBus.run('workspace.tab', { tab: 'classic' });
};
const live = (ctx: StudioToolContext, name: string, args: Record<string, unknown>, classic = true) =>
  invokeLiveCommand(name, args, { openWorkspace: classic ? openClassic(ctx) : () => ctx.actions.setActiveWorkspace('SET_DESIGN'), workspace: 'SET_DESIGN', timeoutMs: 8000 });

const readSketchfabToken = () => {
  try { return localStorage.getItem('sketchfab_token') || ''; } catch { return ''; }
};

/** Image as base64 for the 3D generators (data: URLs are used as they are). */
const imageBase64 = async (url: string) => {
  if (url.startsWith('data:')) return { base64: url.split(',')[1] || '', mimeType: url.slice(5, url.indexOf(';')) || 'image/png' };
  const { getBase64FromUrl } = await import('../../utils/helpers');
  return getBase64FromUrl(url);
};

const addGeneratedModel = (ctx: StudioToolContext, media: { id: string; name: string; url: string; [key: string]: unknown }, modelUrl: string, name: string) => {
  ctx.actions.addMediaItem(media as never);
  return setDesignBus.run('object.add_model', { url: modelUrl, mediaId: media.id, format: 'glb', name }) as { id: string; name: string };
};

const EXTRA_TOOLS: StudioTool[] = [
  {
    name: 'setdesign_generate_blockout',
    description: `${PREFIX}build a 3D mesh from a reference image (location, prop) and place it in the set. engine: hunyuan3d-v3 (fast, clean, default), trellis-2 (hard-surface props), rodin-v2.5 (highest fidelity, PBR) via fal.ai, or rodin-replicate. Takes one to a few minutes. Requires confirm: true.`,
    cost: 'paid',
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        imageUrl: { type: 'string', description: 'https:// or data: URL of the reference image.' },
        imagePath: { type: 'string', description: 'Local image path.' },
        engine: { type: 'string', description: 'Generator.', enum: ['hunyuan3d-v3', 'trellis-2', 'rodin-v2.5', 'rodin-replicate'] },
        name: { type: 'string', description: 'Name for the mesh.' },
        prompt: { type: 'string', description: 'Optional text hint (Rodin).' },
        lowPoly: { type: 'boolean', description: 'Low-poly blockout (Hunyuan3D, default true).' },
        confirm: { type: 'boolean', description: 'Must be true: this spends credits.' },
      },
      required: ['confirm'],
    },
    handler: async (args, ctx) => {
      requireConfirm(args, '3D blockout');
      const image = asString(args.imageUrl) || asString(args.imagePath);
      if (!image) throw new Error('Pass imageUrl or imagePath.');
      const engine = asString(args.engine) || 'hunyuan3d-v3';
      const name = asString(args.name) || 'Blockout';
      const base = await imageBase64(image);
      if (engine === 'rodin-replicate') {
        const { generateModelWithRodin } = await import('../../services/replicateService');
        const item = await generateModelWithRodin(asString(args.prompt) || '3D prop asset for set design', base);
        return { engine, mediaId: item.id, object: addGeneratedModel(ctx, item as never, item.url, name) };
      }
      const fal = await import('../../services/falAiService');
      const result = engine === 'hunyuan3d-v3'
        ? await fal.generate3dWithFalHunyuan3dV3(base, { name, lowPoly: args.lowPoly !== false })
        : engine === 'trellis-2'
          ? await fal.generate3dWithFalTrellis2(base, { name })
          : engine === 'rodin-v2.5'
            ? await fal.generate3dWithFalRodinV25([base], { name, prompt: asString(args.prompt) })
            : null;
      if (!result) throw new Error('engine must be hunyuan3d-v3, trellis-2, rodin-v2.5 or rodin-replicate.');
      return { engine, mediaId: result.id, object: addGeneratedModel(ctx, result as never, result.meshUrl, name) };
    },
  },
  {
    name: 'setdesign_generate_world',
    description: `${PREFIX}generate a walkable 3D world with World Labs Marble from a text prompt or an image (optionally a 360° panorama) and place its mesh in the set; the panorama goes to the media. Takes several minutes. Requires a World Labs key and confirm: true.`,
    cost: 'paid',
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: 'Text description of the world.' },
        imageUrl: { type: 'string', description: 'Image URL to build the world from.' },
        isPano: { type: 'boolean', description: 'The image is an equirectangular panorama.' },
        model: { type: 'string', description: 'Marble model.', enum: ['marble-1.1-plus', 'marble-1.1', 'marble-1.0', 'marble-1.0-draft'] },
        name: { type: 'string', description: 'World name.' },
        confirm: { type: 'boolean', description: 'Must be true: this spends credits.' },
      },
      required: ['confirm'],
    },
    handler: async (args, ctx) => {
      requireConfirm(args, 'World generation');
      const prompt = asString(args.prompt);
      const imageUrl = asString(args.imageUrl);
      if (!prompt && !imageUrl) throw new Error('Pass prompt or imageUrl.');
      const labs = await import('../../services/worldLabsService');
      if (!labs.hasWorldLabsApiKey()) throw new Error('Add a World Labs API key in Settings first.');
      const { getWorldModelGeneratedBy } = await import('../../services/worldModelProviderRegistry');
      const name = asString(args.name) || 'Set Design World';
      const model = (asString(args.model) || labs.MARBLE_MODELS.PLUS) as never;
      const world = imageUrl
        ? await labs.generateWorldFromImageUrl(name, imageUrl, prompt, args.isPano === true, model)
        : await labs.generateWorldFromText(name, prompt!, model);
      const assets = labs.getWorldAssetUrls(world);
      if (!assets.colliderMesh) throw new Error('World Labs returned no mesh.');
      const generatedBy = getWorldModelGeneratedBy((world as { model?: string }).model || model);
      const meshItem = { id: `world-${Date.now()}`, name: `world_${world.id}_mesh.glb`, type: 'image', url: assets.colliderMesh, source: 'generated', generatedBy };
      const object = addGeneratedModel(ctx, meshItem, assets.colliderMesh, (world as { display_name?: string }).display_name || name);
      if (assets.panorama) ctx.actions.addMediaItem({ id: `world-pano-${Date.now()}`, name: `world_${world.id}_pano.jpg`, type: 'image', url: assets.panorama, source: 'generated', generatedBy } as never);
      return { worldId: world.id, object, viewUrl: assets.viewUrl, panorama: assets.panorama };
    },
  },
  {
    name: 'setdesign_search_sketchfab',
    description: `${PREFIX}search downloadable 3D models on Sketchfab (popular first). Returns uid, name, author, licence and a preview. Import with setdesign_import_sketchfab.`,
    parameters: { type: 'object', properties: { query: { type: 'string', description: 'Search words, e.g. "bar stool".' } }, required: ['query'] },
    handler: async (args) => {
      const query = asString(args.query);
      if (!query) throw new Error('Pass query.');
      const { searchSketchfabModels } = await import('../../services/sketchfabService.ts');
      const models = await searchSketchfabModels(query, readSketchfabToken() || undefined);
      return {
        results: models.slice(0, 20).map((m) => ({
          uid: m.uid,
          name: m.name,
          author: m.user?.displayName || m.user?.username,
          license: m.license?.label,
          faces: m.faceCount,
          likes: m.likeCount,
          thumbnail: m.thumbnails?.images?.sort((a, b) => a.width - b.width).find((img) => img.width >= 200)?.url,
          page: `https://sketchfab.com/3d-models/${m.uid}`,
        })),
      };
    },
  },
  {
    name: 'setdesign_import_sketchfab',
    description: `${PREFIX}download a Sketchfab model (uid from setdesign_search_sketchfab) as GLB and place it in the set with author and licence credit. Needs a Sketchfab API token in Settings.`,
    writes: true,
    parameters: {
      type: 'object',
      properties: {
        uid: { type: 'string', description: 'Sketchfab model uid.' },
        name: { type: 'string', description: 'Object name.' },
        author: { type: 'string', description: 'Author for the credit.' },
        license: { type: 'string', description: 'Licence for the credit.' },
        location: { type: 'array', description: 'Location [x, y, z] (Blender convention).', items: { type: 'number' } },
      },
      required: ['uid'],
    },
    handler: async (args) => {
      const uid = asString(args.uid);
      if (!uid) throw new Error('Pass uid.');
      const token = readSketchfabToken();
      if (!token) throw new Error('Add a Sketchfab API token in Settings (Set Design › Klassisch) to download models.');
      const { getSketchfabDownloadUrl } = await import('../../services/sketchfabService.ts');
      const url = await getSketchfabDownloadUrl(uid, token);
      if (!url) throw new Error('Sketchfab offers no GLB/glTF for this model.');
      const result = setDesignBus.run('object.add_model', {
        url,
        format: 'glb',
        name: asString(args.name) || 'Sketchfab-Modell',
        location: args.location,
        attribution: { author: asString(args.author) || 'Sketchfab', license: asString(args.license) || 'see Sketchfab', url: `https://sketchfab.com/3d-models/${uid}` },
      });
      return { object: result };
    },
  },
  {
    name: 'setdesign_ai_director',
    description: `${PREFIX}ask the classic page's AI Director (Gemini/Replicate) to change the set in plain language, e.g. "add a bar counter and two stools" (it can also search Sketchfab). Opens the "Klassisch" tab. Requires confirm: true.`,
    cost: 'paid',
    writes: true,
    parameters: { type: 'object', properties: { prompt: { type: 'string', description: 'Instruction.' }, confirm: { type: 'boolean', description: 'Must be true: this spends credits.' } }, required: ['prompt', 'confirm'] },
    handler: async (args, ctx) => {
      requireConfirm(args, 'AI Director');
      const prompt = asString(args.prompt);
      if (!prompt) throw new Error('Pass prompt.');
      return { reply: await live(ctx, SETDESIGN_LIVE.aiDirector, { prompt }) };
    },
  },
  {
    name: 'setdesign_play_camera_path',
    description: `${PREFIX}play, pause or stop the camera move in the classic page's viewport (opens the "Klassisch" tab).`,
    parameters: { type: 'object', properties: { action: { type: 'string', description: 'Playback action.', enum: ['play', 'pause', 'stop'] } }, required: ['action'] },
    handler: async (args, ctx) => ({ playback: await live(ctx, SETDESIGN_LIVE.playback, { action: asString(args.action) }) }),
  },
  {
    name: 'setdesign_record_camera_move',
    description: `${PREFIX}render the camera move as a video (WebM, real time) into the project media, as motion reference for video models. Needs two or more keyframes. Opens the "Klassisch" tab and waits until the recording is done.`,
    writes: true,
    parameters: { type: 'object', properties: {} },
    handler: async (_args, ctx) => ({ recording: await live(ctx, SETDESIGN_LIVE.record, {}) }),
  },
  {
    name: 'setdesign_apply_render_preset',
    description: `${PREFIX}apply a render preset (see setdesign_list_presets: renderPresets) to the classic page's viewport: quality, exposure, sky and sun.`,
    parameters: { type: 'object', properties: { preset: { type: 'string', description: 'Render preset id.' } }, required: ['preset'] },
    handler: async (args, ctx) => ({ settings: await live(ctx, SETDESIGN_LIVE.renderPreset, { preset: asString(args.preset) }) }),
  },
  {
    name: 'setdesign_set_classic_render',
    description: `${PREFIX}the classic page's render settings: quality (realtime, cinematic, final), exposure, sky, sun (azimuth, elevation, intensity), HDRI as background. Pass nothing to read them.`,
    parameters: {
      type: 'object',
      properties: {
        quality: { type: 'string', description: 'Render quality.', enum: ['realtime', 'cinematic', 'final'] },
        exposure: { type: 'number', description: 'Exposure 0.1–3.' },
        sky: { type: 'boolean', description: 'Procedural sky.' },
        sun: { type: 'boolean', description: 'Sun light.' },
        sunAzimuth: { type: 'number', description: 'Sun azimuth in degrees.' },
        sunElevation: { type: 'number', description: 'Sun elevation in degrees.' },
        sunIntensity: { type: 'number', description: 'Sun intensity.' },
        hdriBackground: { type: 'boolean', description: 'Show the HDRI as background.' },
      },
    },
    handler: async (args, ctx) => ({ settings: await live(ctx, SETDESIGN_LIVE.renderSettings, args) }),
  },
  {
    name: 'setdesign_list_library_assets',
    description: `${PREFIX}3D models (GLB/glTF/OBJ/FBX) in the library of this and recent projects. Add one with setdesign_import_model (url).`,
    parameters: { type: 'object', properties: {} },
    handler: async (_args, ctx) => ({ models: await live(ctx, SETDESIGN_LIVE.libraryModels, {}, false) }),
  },
];

export const SETDESIGN_TOOLS: StudioTool[] = [
  ...SET_DESIGN_TOOL_DECLARATIONS.map((declaration) => ({
    name: declaration.name,
    description: declaration.description,
    parameters: declaration.parameters as StudioTool['parameters'],
    writes: !READ_ONLY.has(declaration.name),
    handler: async (args: Record<string, unknown>, ctx: StudioToolContext) => {
      currentContext = ctx;
      if (!setDesignBus.hasHost()) throw new Error('The set design is not connected to the open project yet.');
      const result = await executor[declaration.name](args);
      return (result && typeof result === 'object' && !Array.isArray(result) ? result : { result }) as Record<string, unknown>;
    },
  })),
  ...EXTRA_TOOLS.map((tool) => ({
    ...tool,
    writes: tool.writes ?? !READ_ONLY.has(tool.name),
    handler: async (args: Record<string, unknown>, ctx: StudioToolContext) => {
      currentContext = ctx;
      if (!setDesignBus.hasHost()) throw new Error('The set design is not connected to the open project yet.');
      return tool.handler(args, ctx);
    },
  })),
];

registerStudioToolModule({ id: 'setdesign', label: 'Set Design (3D)', tools: SETDESIGN_TOOLS });
