import test from 'node:test';
import assert from 'node:assert/strict';

import { navigation } from './workspaceTools.ts';
import './reviewTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';

test('workspace navigation respects mode/role and lists tools', async () => {
  navigation.override({
    groups: [
      { id: 'CREATE', name: 'Create', description: '', items: [{ id: 'DESIGN', name: 'Design', description: '' }] },
      { id: 'REVIEW', name: 'Review', description: '', items: [{ id: 'REVIEW', name: 'Director', description: '' }, { id: 'REQUESTS', name: 'Requests', description: '' }] },
    ],
  });
  const { ctx, state } = createTestContext({ extras: { allowedWorkspaces: ['DESIGN', 'REQUESTS'], uiMode: 'advanced', isDirector: false } });
  const mcp = await createMcpHarness(ctx);
  try {
    const list = await mcp.call('workspace_list');
    const review = (list.groups as Array<{ pages: Array<{ id: string; available: boolean; toolCount: number }> }>)[1].pages;
    assert.equal(review[0].available, false);
    assert.ok(review[0].toolCount >= 9);

    const refused = await mcp.call('workspace_open', { workspace: 'review' });
    assert.equal(refused.ok, false);
    assert.match(String(refused.message), /director role/);
    await mcp.call('workspace_open', { workspace: 'DESIGN' });
    assert.equal(state.activeWorkspace, 'DESIGN');

    const destructive = await mcp.call('workspace_list_tools', { only: 'destructive' });
    const names = (destructive.modules as Array<{ tools: Array<{ name: string }> }>).flatMap((module) => module.tools.map((tool) => tool.name));
    assert.ok(names.includes('review_remove_change_request'));
    assert.ok(!names.includes('review_get'));
  } finally {
    navigation.override(null);
    mcp.dispose();
  }
});
