import test from 'node:test';
import assert from 'node:assert/strict';

import './designTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import type { DesignCanvasState } from '../../types.ts';

const context = () =>
  createTestContext({ mediaItems: [{ id: 'img1', name: 'still.png', type: 'image', url: 'data:image/png;base64,AA==' } as never] });

test('design tools are published; paid and destructive tools are marked', async () => {
  const { ctx } = context();
  const mcp = await createMcpHarness(ctx);
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const name of ['design_get', 'design_set_canvas', 'design_add_layer', 'design_update_layer', 'design_select_layer', 'design_duplicate_layer', 'design_arrange_layer', 'design_delete_layer', 'design_apply_template', 'design_export_png', 'design_generate_layer']) {
      assert.ok(byName.has(name), `${name} missing`);
    }
    assert.match(byName.get('design_generate_layer')!.description, /KOSTET CREDITS/);
    assert.match(byName.get('design_delete_layer')!.description, /LÖSCHT/);
    assert.match(byName.get('design_apply_template')!.description, /LÖSCHT/);
  } finally {
    mcp.dispose();
  }
});

test('layers: add, update, duplicate, arrange, select, delete, resize canvas', async () => {
  const { ctx, state } = context();
  const mcp = await createMcpHarness(ctx);
  const design = () => state.extras.designCanvas as DesignCanvasState;
  try {
    const text = await mcp.call('design_add_layer', { type: 'text', text: 'DSDS', fontSize: 120 });
    const textId = (text.layer as { id: string }).id;
    await mcp.call('design_add_layer', { type: 'shape', shape: 'ellipse', fill: '#ff0000' });
    const image = await mcp.call('design_add_layer', { type: 'image', mediaId: 'img1' });
    assert.equal((image.layer as { mediaId: string }).mediaId, 'img1');
    assert.equal(design().elements.length, 3);

    await mcp.call('design_update_layer', { elementId: textId, x: 10, opacity: 4, color: '#fff' });
    const updated = design().elements.find((element) => element.id === textId)!;
    assert.equal(updated.x, 10);
    assert.equal(updated.opacity, 1);

    await mcp.call('design_duplicate_layer', { elementId: textId });
    assert.equal(design().elements.length, 4);
    const arranged = await mcp.call('design_arrange_layer', { elementId: textId, direction: 'front' });
    const order = arranged.layers as Array<{ id: string }>;
    assert.equal(order[0].id, textId);

    await mcp.call('design_select_layer', { elementId: '' });
    assert.equal(design().selectedElementId, null);
    const noSelection = await mcp.call('design_delete_layer', {});
    assert.equal(noSelection.ok, false);
    await mcp.call('design_delete_layer', { elementId: textId });
    assert.equal(design().elements.length, 3);

    const resized = await mcp.call('design_set_canvas', { preset: '9:16', background: '#000000' });
    assert.equal(resized.width, 1080);
    assert.equal(resized.height, 1920);
    const bad = await mcp.call('design_add_layer', { type: 'image', mediaId: 'nope' });
    assert.equal(bad.ok, false);
  } finally {
    mcp.dispose();
  }
});

test('template, export and AI layer go through the open Design page', async () => {
  const { ctx, state } = context();
  const calls: string[] = [];
  const dispose = registerLiveCommands({
    'design.action': (input) => {
      const args = input.args as Record<string, unknown>;
      if (input.action === 'apply_template') calls.push(`template:${args.kind}`);
      if (input.action === 'export_png') calls.push(`export:${args.sendToTimeline}`);
      if (input.action === 'generate_layer') { calls.push(`gen:${args.prompt}`); return { result: { mediaItem: { id: 'g1' } }, info: {} }; }
      return { result: {}, info: {} };
    },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    await mcp.call('design_apply_template', { kind: 'thumbnail' });
    await mcp.call('design_export_png', { sendToTimeline: true });
    const gen = await mcp.call('design_generate_layer', { confirm: true,  prompt: 'neon stage' });
    assert.equal((gen.mediaItem as { id: string }).id, 'g1');
    assert.deepEqual(calls, ['template:thumbnail', 'export:true', 'gen:neon stage']);
    assert.equal(state.activeWorkspace, 'EDIT', 'page already open: no navigation');
  } finally {
    dispose();
    mcp.dispose();
  }
});
