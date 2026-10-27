import test from 'node:test';
import assert from 'node:assert/strict';

import './nodesTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';

test('nodes tools: offline graph read, page actions, run marked paid', async () => {
  const graph = { nodes: [{ id: 'prompt-1', type: 'prompt', position: { x: 0, y: 0 }, data: { label: 'Prompt', value: 'neon' } }], edges: [] };
  const { ctx } = createTestContext({ extras: { nodeGraph: graph } });
  const actions: Array<{ action: string; args: unknown }> = [];
  const dispose = registerLiveCommands({
    'nodes.get': () => ({ settings: {}, info: { nodes: graph.nodes } }),
    'nodes.set': () => ({ settings: {} }),
    'nodes.action': (args) => { actions.push({ action: String(args.action), args: args.args }); return { result: { nodeId: 'model-2' }, info: {} }; },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['nodes_get_graph', 'nodes_get_state', 'nodes_set', 'nodes_add_node', 'nodes_update_node', 'nodes_select_node', 'nodes_duplicate_node', 'nodes_delete_node', 'nodes_connect', 'nodes_disconnect', 'nodes_insert_template', 'nodes_auto_layout', 'nodes_use_library_asset', 'nodes_run']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    assert.match(byName.get('nodes_run')!.description, /KOSTET CREDITS/);
    assert.match(byName.get('nodes_delete_node')!.description, /LÖSCHT/);

    const read = await mcp.call('nodes_get_graph');
    assert.equal(((read.graph as typeof graph).nodes[0]).id, 'prompt-1');
    assert.deepEqual((read.nodeTypes as Record<string, { inputs: string[] }>).blend.inputs, ['base', 'overlay']);

    await mcp.call('nodes_add_node', { type: 'model', selected: 'Flux', params: { aspectRatio: '16:9' } });
    await mcp.call('nodes_connect', { source: 'prompt-1', target: 'model-2' });
    await mcp.call('nodes_run', { confirm: true });
    assert.deepEqual(actions.map((entry) => entry.action), ['add_node', 'connect', 'run']);
    assert.deepEqual(actions[0].args, { type: 'model', selected: 'Flux', params: { aspectRatio: '16:9' } });
  } finally {
    dispose();
    mcp.dispose();
  }
});
