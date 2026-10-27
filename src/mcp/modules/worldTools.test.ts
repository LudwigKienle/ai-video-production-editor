import test from 'node:test';
import assert from 'node:assert/strict';

import { worldServices } from './worldTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import type { SetDesignState, WorldGenerationState } from '../../types.ts';

test('world generate, list, save assets and send mesh (fake World Labs)', async () => {
  const calls: string[] = [];
  const world = { id: 'w1', display_name: 'Studio', model: 'marble-1.1-plus', created_at: '2026-10-27T10:00:00Z' };
  worldServices.override({
    hasWorldLabsApiKey: () => true,
    generateWorldFromText: async (name, prompt) => { calls.push(`text:${name}:${prompt}`); return world; },
    generateWorldFromImageUrl: async (name, url) => { calls.push(`url:${url}`); return { ...world, id: 'w2' }; },
    getWorldAssetUrls: () => ({ viewUrl: 'https://view', colliderMesh: 'https://x/mesh.glb', panorama: 'https://x/pano.jpg', splatFullRes: 'https://x/full.spz' }),
  });
  const { ctx, state } = createTestContext({ extras: { worldGen: null, setDesign: null } });
  const mcp = await createMcpHarness(ctx);
  try {
    const generate = mcp.list().find((tool) => tool.name === 'world_generate')!;
    assert.match(generate.description, /KOSTET CREDITS/);
    const noPrompt = await mcp.call('world_generate', { confirm: true,  mode: 'text' });
    assert.equal(noPrompt.ok, false);
    assert.equal(calls.length, 0);

    const made = await mcp.call('world_generate', { confirm: true,  mode: 'text', name: 'Studio', prompt: 'TV studio with LED wall' });
    assert.equal((made.world as { id: string }).id, 'w1');
    await mcp.call('world_generate', { confirm: true,  mode: 'image', imageUrl: 'https://img/ref.jpg', isPano: true });
    const history = (state.extras.worldGen as WorldGenerationState).history;
    assert.deepEqual(history.map((entry) => entry.id), ['w2', 'w1']);
    assert.equal(history[0].source.isPano, true);

    const list = await mcp.call('world_list');
    assert.equal((list.worlds as unknown[]).length, 2);
    const one = await mcp.call('world_get', { worldId: 'w1' });
    assert.equal((one.world as { assets: { meshUrl: string } }).assets.meshUrl, 'https://x/mesh.glb');

    const saved = await mcp.call('world_save_assets', { worldId: 'w1' });
    assert.equal((saved.saved as unknown[]).length, 3);
    assert.deepEqual(saved.missing, ['thumbnail']);

    await mcp.call('world_send_mesh_to_set_design', { worldId: 'w1' });
    assert.equal((state.extras.setDesign as SetDesignState).assets.length, 1);
    assert.equal(state.activeWorkspace, 'SET_DESIGN');
  } finally {
    worldServices.override(null);
    mcp.dispose();
  }
});
