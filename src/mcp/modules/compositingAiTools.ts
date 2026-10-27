/**
 * MCP tools: Compositing page tools mode (compositing_ai_*, compositing_relight_*,
 * compositing_nodes_*). Complements the fusion_, ae_ and nuke_ tools (the comp editor):
 * Merge, CorridorKey keyer, OpenPose, Wan Animate Replace, Luma Ray2 Reframe,
 * Kling O3 Bridge, Relight with depth/normal guides and the legacy Node Studio.
 * Runs through useCompositingAiLiveCommands / useRelightLiveCommands /
 * useNodeStudioLiveCommands.
 */
import { invokeLiveCommand } from '../liveCommands.ts';
import { createLivePageModule } from '../livePageTools.ts';
import { registerStudioToolModule, type StudioToolContext } from '../toolModules.ts';

const TOOLS = ['nodes', 'layer', 'key', 'relight', 'pose', 'reframe', 'kling'];
const ROLES = ['background', 'overlay', 'key_source', 'key_alpha', 'reframe', 'motion', 'openpose', 'character'];

/** Open the Compositing page in tools mode with the given tool (mounts Relight / Node Studio). */
const openTool = (tool: string) => (ctx: StudioToolContext) => {
  ctx.actions.setActiveWorkspace('COMPOSITING');
  // Next tick: the caller registers its wait for the sub-tool's commands first.
  setTimeout(() => {
    void invokeLiveCommand('compositing_ai.action', { action: 'open_tool', args: { tool } }, { workspace: 'COMPOSITING', timeoutMs: 10000 }).catch(() => undefined);
  }, 0);
};

export const COMPOSITING_AI_TOOL_MODULE = createLivePageModule({
  id: 'compositing_ai',
  label: 'Edit: Compositing tools (AI & keyer)',
  prefix: 'compositing_ai_',
  ns: 'compositing_ai',
  workspace: 'COMPOSITING',
  pageName: 'Compositing',
  settingsHelp:
    'Keys: blendMode, overlayOpacity 0-100 (Merge); corridorKeyRepoPath, corridorKeyOptions {device auto|mps|cuda|cpu, backend auto|torch|mlx, inputColorSpace srgb|linear, imageSize 512|1024|2048, despill 0-10, refiner 0-4, despeckleSize, autoDespeckle, generateComp, gpuPost, tiledInference}, corridorKeyMaxFrames; openPoseOptions {includeFace, includeHands, useOpenpose}; animateSettings {resolution 480|720, fps, refertNum 1|5, mergeAudio, goFast}; reframePrompt, reframeAspect, reframeGuideFrame none|background|overlay, reframeUseManualWindow, reframeWindow {gridPositionX, gridPositionY, xStart, xEnd, yStart, yEnd}; klingBridgePrompt, klingBridgeDuration 3-15, klingBridgeAspect.',
  actions: [
    { name: 'open_tool', description: `Switch the Compositing page to tools mode and open a tool: ${TOOLS.join(', ')} (nodes = Node Studio).`, parameters: { tool: { type: 'string', enum: TOOLS } }, required: ['tool'] },
    {
      name: 'set_input',
      description: 'Set a tool input from a media bin item (mediaId), a URL/local file, or a timeline clip (clipId, or fromSelectedClip). Roles: background/overlay (Merge, Kling start/end frame), key_source/key_alpha (CorridorKey), reframe, motion (Animate Replace video, Kling reference), openpose (image), character (Animate Replace image). No source clears the input.',
      parameters: {
        role: { type: 'string', enum: ROLES },
        mediaId: { type: 'string' }, url: { type: 'string' }, imagePath: { type: 'string' }, videoPath: { type: 'string' },
        clipId: { type: 'string' }, fromSelectedClip: { type: 'boolean' },
      },
      required: ['role'],
    },
    { name: 'composite', description: 'Merge: blend overlay over background (images, local canvas) into a PNG in the media bin.', producesMedia: true },
    { name: 'corridorkey_prepare', description: 'Keyer: prepare the CorridorKey checkout (corridorKeyRepoPath) — installs its Python environment with uv (desktop app, local).' },
    { name: 'corridorkey_run', description: 'Keyer: run CorridorKey on key_source (+ optional key_alpha) with corridorKeyOptions; writes keyed media/EXRs into the project and adds them to the media bin (local, no credits).' },
    { name: 'openpose', description: 'Pose: extract an OpenPose skeleton image from the openpose input (Replicate).', cost: 'paid', producesMedia: true },
    { name: 'animate_replace', description: 'Pose & Replace: Wan 2.2 Animate Replace puts the character image into the motion video (Replicate, per second).', cost: 'paid', producesMedia: true },
    { name: 'reframe', description: 'Reframe: Luma Ray2 reframes the reframe video to reframeAspect, optional prompt, guide frame and manual window (FAL).', cost: 'paid', producesMedia: true },
    { name: 'kling_bridge', description: 'Kling Bridge: Kling O3 Pro video from start frame (background) to end frame (overlay), optional reference video (motion), klingBridgePrompt/Duration/Aspect (FAL, per second).', cost: 'paid', producesMedia: true },
    { name: 'add_result_to_timeline', description: 'Put a tool result on the timeline at the playhead ("Add to timeline").', parameters: { result: { type: 'string', enum: ['layer', 'pose', 'animate', 'reframe', 'kling'] } }, required: ['result'] },
  ],
});

export const COMPOSITING_RELIGHT_TOOL_MODULE = createLivePageModule({
  id: 'compositing_relight',
  label: 'Edit: Compositing relight',
  prefix: 'compositing_relight_',
  ns: 'compositing_relight',
  workspace: 'COMPOSITING',
  pageName: 'Compositing › Relight',
  open: openTool('relight'),
  settingsHelp:
    'Keys: lighting {lightX 0-1, lightY 0-1, height, radius, intensity, ambient, surfaceStrength, warmth, blendMode screen|add|normal|soft-light} (merged), surfaceMode source|depth|normal, surfaceMapRepoPath, surfaceMapEncoder vits|vitb|vitl, surfaceMapInputSize, surfaceMapNormalStrength.',
  actions: [
    { name: 'set_source', description: 'Use a media bin image as the picture to relight.', parameters: { mediaId: { type: 'string' } }, required: ['mediaId'] },
    { name: 'set_surface_guide', description: 'Use a media bin image as depth or normal guide.', parameters: { mediaId: { type: 'string' }, mode: { type: 'string', enum: ['depth', 'normal'] } }, required: ['mediaId'] },
    { name: 'apply_preset', description: 'Apply a light preset (Key Left, Rim, … see get_state).', parameters: { presetId: { type: 'string' } }, required: ['presetId'] },
    { name: 'reset', description: 'Reset the light settings.' },
    { name: 'prepare_surface_maps', description: 'Prepare the local Depth Anything V2 checkout for guides (desktop app).' },
    { name: 'generate_depth_guide', description: 'Generate a depth guide from the source locally (adds it to the media bin).' },
    { name: 'generate_normal_guide', description: 'Generate a normal guide from the depth guide locally (adds it to the media bin).' },
    { name: 'export', description: 'Render the relit image to the media bin (local).', producesMedia: true },
  ],
});

export const COMPOSITING_NODES_TOOL_MODULE = createLivePageModule({
  id: 'compositing_nodes',
  label: 'Edit: Compositing Node Studio',
  prefix: 'compositing_nodes_',
  ns: 'compositing_nodes',
  workspace: 'COMPOSITING',
  pageName: 'Compositing › Node Studio',
  open: openTool('nodes'),
  settingsHelp: 'Keys: playhead (frame), selectedNodeId.',
  actions: [
    { name: 'add_effect', description: 'Add an effect node from the Node Studio catalog (get_state catalog).', parameters: { effectId: { type: 'string' } }, required: ['effectId'] },
    { name: 'remove_effect', description: 'Remove an added effect node.', parameters: { instanceId: { type: 'string' } }, required: ['instanceId'], destructive: true },
    { name: 'set_node_params', description: 'Set parameters (and label) of a graph node (Read, Merge, Grade, Viewer …).', parameters: { nodeId: { type: 'string' }, params: { type: 'object' }, label: { type: 'string' } }, required: ['nodeId'] },
    { name: 'set_ai_node', description: 'Set prompt, model, strength or mask mode of an AI effect node.', parameters: { instanceId: { type: 'string' }, prompt: { type: 'string' }, model: { type: 'string' }, strength: { type: 'number' }, maskMode: { type: 'string' } }, required: ['instanceId'] },
    { name: 'stage_ai_node', description: 'Stage an AI node ("queued"; nothing is generated or billed).', parameters: { instanceId: { type: 'string' } }, required: ['instanceId'] },
    { name: 'render_still', description: 'Render the viewer still to a PNG in the media bin (local).', producesMedia: true },
  ],
});

registerStudioToolModule(COMPOSITING_AI_TOOL_MODULE);
registerStudioToolModule(COMPOSITING_RELIGHT_TOOL_MODULE);
registerStudioToolModule(COMPOSITING_NODES_TOOL_MODULE);
