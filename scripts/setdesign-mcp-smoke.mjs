#!/usr/bin/env node
/**
 * End-to-end check of the set design MCP tools against a running editor, exactly as an agent
 * talks to it: JSON-RPC over the local MCP endpoint (Streamable HTTP, bearer token from the
 * discovery file). Builds a small set, aims a camera, renders reference frames and saves them.
 *
 *   node scripts/setdesign-mcp-smoke.mjs [outputDir]
 *
 * Uses ~/.ai-video-production-editor/studio-connect.json (respects $HOME, so an isolated test
 * instance started with its own HOME is used instead of the everyday one).
 * It starts a new, empty project (project_new) so the open project is not changed.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const discovery = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.ai-video-production-editor', 'studio-connect.json'), 'utf8'));
const url = discovery.mcpUrl || discovery.url || `http://127.0.0.1:${discovery.port}/mcp`;
const outDir = path.resolve(process.argv[2] || path.join(os.tmpdir(), 'avpe-setdesign-smoke'));
fs.mkdirSync(outDir, { recursive: true });

let id = 0;
let session = '';
const rpc = async (method, params = {}) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${discovery.token}`, ...(session ? { 'Mcp-Session-Id': session } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
  });
  session = response.headers.get('mcp-session-id') || session;
  const body = await response.json();
  if (body.error) throw new Error(`${method}: ${body.error.message}`);
  return body.result;
};

const call = async (name, args = {}) => {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result.content.find((c) => c.type === 'text')?.text || '';
  if (result.isError) throw new Error(`${name}: ${text}`);
  let parsed = null;
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  if (parsed && typeof parsed === 'object' && parsed.ok === false) throw new Error(`${name}: ${parsed.message}`);
  return { data: parsed, images: result.content.filter((c) => c.type === 'image') };
};

const steps = [];
const step = async (label, fn) => {
  const started = Date.now();
  try {
    const value = await fn();
    steps.push({ label, ok: true, ms: Date.now() - started });
    console.log(`ok   ${label}`);
    return value;
  } catch (error) {
    steps.push({ label, ok: false, error: error.message });
    console.log(`FAIL ${label}: ${error.message}`);
    return null;
  }
};

await rpc('initialize', { protocolVersion: '2025-06-18', clientInfo: { name: 'setdesign-smoke', version: '1' }, capabilities: {} });
const { tools } = await rpc('tools/list');
const setdesignTools = tools.filter((tool) => tool.name.startsWith('setdesign_')).map((tool) => tool.name);
console.log(`${setdesignTools.length} setdesign tools published`);

await step('project_new (keeps the user project untouched)', () => call('project_new', {}));
await step('setdesign_open_workspace', () => call('setdesign_open_workspace', { tab: 'layout' }));
await step('setdesign_get_scene', () => call('setdesign_get_scene'));
await step('floor', () => call('setdesign_add_primitive', { primitive: 'plane', name: 'Boden', scale: [6, 5, 1], color: '#8d8a84' }));
await step('back wall', () => call('setdesign_add_primitive', { primitive: 'wall', name: 'Rückwand', location: [0, 4, 1.3], scale: [2, 1, 1], color: '#b9b2a6' }));
await step('side wall', () => call('setdesign_add_primitive', { primitive: 'wall', name: 'Seitenwand', location: [-5, 1, 1.3], rotation: [0, 0, 90], color: '#a9a296' }));
await step('counter', () => call('setdesign_add_primitive', { primitive: 'box', name: 'Tresen', location: [0.8, 2, 0.55], scale: [2.4, 0.7, 1.1], color: '#5e4634' }));
await step('stand-in', () => call('setdesign_add_primitive', { primitive: 'person', name: 'Moderatorin', location: [0.6, 1.2, 0.875], rotation: [0, 0, 195] }));
await step('duplicate stand-in', () => call('setdesign_duplicate_objects', { objects: ['Moderatorin'], offset: [1.4, 0.3, 0] }));
await step('window light', () => call('setdesign_add_light', { lightType: 'area', name: 'Fenster', location: [4, -1, 2.2], lookAt: 'Moderatorin', temperature: 6200, power: 180, size: 2, sizeY: 1.5 }));
await step('key light', () => call('setdesign_add_light', { lightType: 'spot', name: 'Stufenlinse', location: [-2.5, -2.5, 3.2], lookAt: 'Moderatorin', temperature: 3200, power: 700, spotSize: 32, spotBlend: 0.3 }));
await step('camera', () => call('setdesign_add_camera', { name: 'Halbtotale', location: [2.8, -3.6, 1.55], lookAtPoint: [0.8, 1.4, 1.2], lensMm: 32, sensorPreset: 'super35' }));
await step('transform (relative)', () => call('setdesign_transform_object', { object: 'Halbtotale', location: [0, 0, 0.05], relative: true }));
await step('update lens', () => call('setdesign_update_object', { object: 'Halbtotale', lensMm: 35, focusDistance: 4.2, fStop: 2.8 }));
await step('aim camera', () => call('setdesign_aim_object', { object: 'Halbtotale', lookAt: 'Moderatorin' }));
await step('active camera', () => call('setdesign_set_active_camera', { object: 'Halbtotale' }));
await step('output 2.39:1', () => call('setdesign_set_output', { width: 2048, height: 858 }));
await step('world', () => call('setdesign_set_world', { strength: 0.8 }));
await step('shading rendered', () => call('setdesign_set_shading', { mode: 'rendered' }));
await step('overlays', () => call('setdesign_set_overlays', { thirds: true }));
await step('select + hide + unhide', async () => {
  await call('setdesign_select_objects', { objects: ['Moderatorin.001'] });
  await call('setdesign_hide_objects', {});
  return call('setdesign_hide_objects', { unhideAll: true });
});
await step('view through camera', () => call('setdesign_set_view', { camera: true }));
await step('list + run command', async () => {
  await call('setdesign_list_commands');
  return call('setdesign_run_command', { command: 'tool.set', args: { tool: 'move' } });
});
await step('history', async () => {
  await call('setdesign_add_primitive', { primitive: 'sphere', name: 'Wegwerf' });
  await call('setdesign_history', { action: 'undo' });
  return call('setdesign_history', { action: 'list' });
});
await step('delete', async () => {
  await call('setdesign_add_primitive', { primitive: 'cone', name: 'Pylon' });
  return call('setdesign_delete_objects', { objects: ['Pylon'] });
});
await step('align camera to view (on a copy)', async () => {
  await call('setdesign_add_camera', { name: 'Ansicht', makeActive: true });
  await call('setdesign_set_view', { location: [6, -7, 3], target: [0, 1, 1] });
  await call('setdesign_align_camera_to_view');
  return call('setdesign_set_active_camera', { object: 'Halbtotale' });
});

for (const pass of ['beauty', 'clay', 'depth']) {
  await step(`capture ${pass}`, async () => {
    const { data, images } = await call('setdesign_capture_frame', { pass, addToMedia: pass === 'beauty' });
    if (!images.length) throw new Error('no image returned');
    fs.writeFileSync(path.join(outDir, `setdesign-${pass}.png`), Buffer.from(images[0].data, 'base64'));
    return data;
  });
}
const scene = await step('final scene', () => call('setdesign_get_scene'));
if (scene) fs.writeFileSync(path.join(outDir, 'setdesign-scene.json'), JSON.stringify(scene.data, null, 2));

const failed = steps.filter((s) => !s.ok);
fs.writeFileSync(path.join(outDir, 'setdesign-smoke.json'), JSON.stringify({ url, tools: setdesignTools, steps }, null, 2));
console.log(`\n${steps.length - failed.length}/${steps.length} steps ok · output in ${outDir}`);
process.exit(failed.length || setdesignTools.length === 0 ? 1 : 0);
