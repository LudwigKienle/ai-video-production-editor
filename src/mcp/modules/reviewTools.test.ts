import test from 'node:test';
import assert from 'node:assert/strict';

import './reviewTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import type { ShotPrompt } from '../../types.ts';

const shot = (n: number, extra: Partial<ShotPrompt> = {}) =>
  ({ shot: n, description: `Shot ${n}`, characters: [], environment: null, prompt: '', ...extra }) as unknown as ShotPrompt;

const context = () =>
  createTestContext({
    mediaItems: [{ id: 'v1', name: 'take1.mp4', type: 'video', url: 'blob:v1', duration: 4 } as never],
    extras: {
      storyBible: { title: 'Opener' },
      references: [],
      shotPrompts: [shot(1, { characters: ['Mia'], imageUrl: 'x' }), shot(2, { environment: 'Rooftop' }), shot(3, { characters: ['Mia'] })],
      namingTemplates: [],
      isDirector: true,
    },
  });

test('review and requests tools are published with schemas and safety markers', async () => {
  const { ctx } = context();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list();
    const names = listed.map((tool) => tool.name);
    for (const name of ['review_get', 'review_set_feedback', 'review_add_change_request', 'review_remove_change_request', 'review_set_annotation', 'review_remove_annotation', 'review_get_annotation_image', 'review_set_naming_template', 'review_preview_naming', 'requests_list', 'requests_set_task_status', 'requests_export']) {
      assert.ok(names.includes(name), `${name} missing`);
    }
    assert.match(listed.find((tool) => tool.name === 'review_remove_change_request')!.description, /LÖSCHT/);
  } finally {
    mcp.dispose();
  }
});

test('director feedback, change requests, tasks and annotations round-trip', async () => {
  const { ctx, state } = context();
  const mcp = await createMcpHarness(ctx);
  try {
    const noteOnly = await mcp.call('review_set_feedback', { scope: 'shot', targetId: 1, note: 'Tighter' });
    assert.equal((noteOnly.feedback as { score: number }).score, 7, 'note-only entry keeps the page default 7');
    await mcp.call('review_set_feedback', { scope: 'concept', score: 12 });
    await mcp.call('review_set_feedback', { scope: 'video', targetId: 'v1', score: 4, note: 'Too dark' });
    const missingShot = await mcp.call('review_set_feedback', { scope: 'shot', targetId: 99, score: 3 });
    assert.equal(missingShot.ok, false);

    const added = await mcp.call('review_add_change_request', { type: 'character', targetName: 'mia', action: 'redo', note: 'New wardrobe' });
    assert.deepEqual(added.affectedShots, [1, 3]);
    const tasks = added.tasks as Array<{ id: string }>;

    const annotated = await mcp.call('review_set_annotation', { shotNumber: 1, assetType: 'image', imageUrl: 'data:image/png;base64,iVBORw0KGgo=' });
    assert.equal((annotated.annotation as { hasImage: boolean }).hasImage, true);

    const overview = await mcp.call('review_get');
    assert.equal((overview.concept as { score: number }).score, 10);
    assert.equal((overview.videos as Array<{ feedback: { note: string } }>)[0].feedback.note, 'Too dark');
    const shot1 = (overview.shots as Array<{ shot: number; missing: string[]; annotations: unknown[] }>)[0];
    assert.deepEqual(shot1.missing, ['sketch', 'video']);
    assert.equal(shot1.annotations.length, 1);
    assert.ok((overview.suggestions as { character: string[] }).character.includes('Mia'));

    await mcp.call('requests_set_task_status', { taskId: tasks[0].id, status: 'done' });
    const open = await mcp.call('requests_list', { status: 'open' });
    assert.equal((open.requests as Array<{ tasks: unknown[] }>)[0].tasks.length, 1);

    const html = await mcp.call('requests_export', { format: 'html' });
    assert.match(String(html.html), /New wardrobe/);
    const json = await mcp.call('requests_export', { format: 'json' });
    assert.equal(((json.export as { project: { title: string } }).project.title), 'Opener');

    await mcp.call('review_remove_annotation', { shotNumber: 1, assetType: 'image' });
    const removed = await mcp.call('review_remove_change_request', { requestId: (added.request as { id: string }).id });
    assert.equal(removed.removedTasks, 2);
    const data = state.extras.reviewData as { changeRequests: unknown[]; shotTasks: unknown[]; shotAnnotations: unknown[] };
    assert.equal(data.changeRequests.length, 0);
    assert.equal(data.shotTasks.length, 0);
    assert.equal(data.shotAnnotations.length, 0);
  } finally {
    mcp.dispose();
  }
});

test('naming template set, preview and clear', async () => {
  const { ctx, state } = context();
  const mcp = await createMcpHarness(ctx);
  try {
    const set = await mcp.call('review_set_naming_template', { template: '{project}_sh{shot}_v{version}' });
    assert.equal(set.preview, 'opener_sh1_v1');
    const preview = await mcp.call('review_preview_naming', { shot: 12, version: 3 });
    assert.equal(preview.fileName, 'opener_sh12_v3');
    await mcp.call('review_set_naming_template', { template: '' });
    assert.equal((state.extras.namingTemplates as unknown[]).length, 0);
  } finally {
    mcp.dispose();
  }
});

test('requests HTML escapes user text', async () => {
  const { ctx } = context();
  const mcp = await createMcpHarness(ctx);
  try {
    await mcp.call('review_add_change_request', { type: 'brand', targetName: '<b>X</b>', action: 'remove', note: '<script>alert(1)</script>' });
    const html = String((await mcp.call('requests_export', { format: 'html' })).html);
    assert.ok(!html.includes('<script>'));
    assert.match(html, /&lt;script&gt;/);
  } finally {
    mcp.dispose();
  }
});
