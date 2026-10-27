/**
 * MCP tools: Nodes (Create › Nodes), the AI node graph (prompt → model →
 * sampler → output, video, upscale, filters, keying, blend, pose, depth,
 * face restore, background removal, RIFE, music/SFX, LLM). Editing, templates,
 * layout and Run go through the page; the saved graph can be read without it.
 */
import { NODE_PORTS, quickTemplateOptions } from '../../data/nodeSpaceBlueprints.ts';
import { createLivePageModule } from '../livePageTools.ts';
import { getExtra } from '../projectExtras.ts';
import { registerStudioToolModule } from '../toolModules.ts';

const nodeId = { type: 'string' as const, description: 'Node id, e.g. "model-1".' };
const NODE_TYPES = Object.keys(NODE_PORTS);
const nodeFields = {
  label: { type: 'string' as const },
  value: { type: 'string' as const, description: 'Prompt text (prompt/llm/music/sfx) or image/video URL (Image In).' },
  selected: { type: 'string' as const, description: 'Chosen model/option (model, video, upscale, sampler, music …); see catalogs in nodes_get_state.' },
  params: { type: 'object' as const, description: 'Node parameters merged into the existing ones, e.g. {"aspectRatio":"16:9"}, {"scale":4}, filter sliders, {"keyColor":"#00ff00","tolerance":40}, {"mode":"screen","opacity":0.6}, {"systemPrompt":"…"}.' },
};

const pageModule = createLivePageModule({
  id: 'nodes',
  label: 'Create: Nodes',
  prefix: 'nodes_',
  ns: 'nodes',
  workspace: 'NODES',
  pageName: 'Nodes',
  settingsHelp: 'Keys: executionMode local|cloud|hybrid, safetyMode draft|review|locked (both labels only), paletteSearch, activePaletteGroup, librarySearch.',
  actions: [
    { name: 'add_node', description: `Add a node (palette "Add"). Types: ${NODE_TYPES.join(', ')}. Optional position and initial fields.`, parameters: { type: { type: 'string', enum: NODE_TYPES }, x: { type: 'number' }, y: { type: 'number' }, ...nodeFields }, required: ['type'] },
    { name: 'update_node', description: 'Change a node: label, value (prompt text / image URL), selected model/option, params, position (the inline editors).', parameters: { nodeId, ...nodeFields, x: { type: 'number' }, y: { type: 'number' } }, required: ['nodeId'] },
    { name: 'select_node', description: 'Select a node (Inspector); empty clears the selection.', parameters: { nodeId } },
    { name: 'duplicate_node', description: 'Duplicate a node (Inspector › Duplicate).', parameters: { nodeId }, required: ['nodeId'] },
    { name: 'delete_node', description: 'Delete a node and its connections (Inspector › Delete / Delete key).', parameters: { nodeId }, required: ['nodeId'], destructive: true },
    {
      name: 'connect',
      description: 'Connect an output to an input. Handles default to the source output and the first target input; ports per type are in nodes_get_state catalogs.nodeTypes[].ports.',
      parameters: { source: nodeId, target: nodeId, sourceHandle: { type: 'string' }, targetHandle: { type: 'string' } },
      required: ['source', 'target'],
    },
    { name: 'disconnect', description: 'Remove a connection (edge id from nodes_get_state).', parameters: { edgeId: { type: 'string' } }, required: ['edgeId'], destructive: true },
    { name: 'insert_template', description: `Insert a blueprint: ${quickTemplateOptions.map((option) => option.id).join(', ')}.`, parameters: { templateId: { type: 'string', enum: quickTemplateOptions.map((option) => option.id) } }, required: ['templateId'] },
    { name: 'auto_layout', description: 'Auto space: arrange the graph left to right.' },
    { name: 'use_library_asset', description: 'Put a library asset into an Image In node.', parameters: { nodeId, assetId: { type: 'string' } }, required: ['nodeId', 'assetId'] },
    { name: 'run', description: 'Run graph: evaluate every end node; model, video, upscale, pose, depth, face, background, RIFE, music, SFX and LLM nodes call paid providers (no cost preview). Media results go to the media bin; texts are in info.runTextResults.', cost: 'paid' },
  ],
});

pageModule.tools.unshift({
  name: 'nodes_get_graph',
  description: 'Read the saved node graph of the project (nodes with type, position, label, value, selected option, params; edges with handles) without opening the Nodes page.',
  parameters: { type: 'object', properties: {} },
  handler: (_args, ctx) => {
    const graph = getExtra(ctx, 'nodeGraph');
    return { graph: graph ?? null, nodeTypes: NODE_PORTS, templates: quickTemplateOptions.map(({ id, label }) => ({ id, label })) };
  },
});

export const NODES_TOOL_MODULE = pageModule;
registerStudioToolModule(NODES_TOOL_MODULE);
