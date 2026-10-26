import test from 'node:test';
import assert from 'node:assert/strict';

import './photoTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { PHOTO_LIVE, describeDoc, describeLayer, describeLayers, layerPatchFromArgs, resolveLayer } from '../../workspaces/photo-pro/mcpModel.ts';
import { createDoc, docReducer, makeAdjustmentLayer, makeRasterLayer, makeTextLayer } from '../../workspaces/photo-pro/layers.ts';
import type { PhotoDoc } from '../../workspaces/photo-pro/layers.ts';
import { commit, createHistory, currentState, jumpTo, redo, undo } from '../../workspaces/photo-pro/history.ts';
import type { History } from '../../workspaces/photo-pro/history.ts';

const PHOTO_TOOLS = [
  'photo_state', 'photo_open', 'photo_new_document', 'photo_layers_list', 'photo_layer_add', 'photo_layer_remove',
  'photo_layer_reorder', 'photo_layer_set', 'photo_adjustment_add', 'photo_smart_filter_add', 'photo_smart_filter_remove',
  'photo_smart_filter_apply', 'photo_selection_set', 'photo_generative_fill', 'photo_crop', 'photo_merge_down',
  'photo_flatten', 'photo_history_undo', 'photo_history_redo', 'photo_history_jump', 'photo_export_to_media',
];

/** Stand-in for the PhotoWorkspace: same reducer/history/mcpModel logic, no canvases. */
function fakePhotoPage() {
  let h: History<PhotoDoc> | null = null;
  const calls: Array<{ name: string; args: Record<string, any> }> = [];
  let n = 0;
  const doc = () => { if (!h) throw new Error('Kein Dokument geöffnet'); return currentState(h); };
  const apply = (action: Parameters<typeof docReducer>[1], label: string) => { h = commit(h!, docReducer(doc(), action), label, { now: (n += 10000) }); };
  const listed = () => ({ document: describeDoc(doc()), layers: describeLayers(doc()) });
  const log = (name: string, args: Record<string, any>) => calls.push({ name, args });
  const dispose = registerLiveCommands({
    [PHOTO_LIVE.state]: () => ({ active: h ? describeDoc(doc()) : null, history: h ? { index: h.index, entries: h.entries.map((e) => e.label) } : null }),
    [PHOTO_LIVE.open]: (args) => { log('open', args); h = createHistory(createDoc(String(args.name), 64, 32, [makeRasterLayer('L1', 'Hintergrund', 'px-1', 64, 32)])); return listed(); },
    [PHOTO_LIVE.newDocument]: (args) => { h = createHistory(createDoc(String(args.name), Number(args.width), Number(args.height), [makeRasterLayer('L1', 'Hintergrund', 'px-1', Number(args.width), Number(args.height))])); return listed(); },
    [PHOTO_LIVE.layersList]: () => listed(),
    [PHOTO_LIVE.layerAdd]: (args: Record<string, any>) => {
      const id = `X${(n += 1)}`;
      const layer = args.kind === 'text' ? makeTextLayer(id, 0, 0, { text: args.text })
        : args.kind === 'adjustment' ? makeAdjustmentLayer(id, 'Korrektur', args.adjustment)
          : makeRasterLayer(id, 'Ebene', `px-${id}`, 64, 32);
      apply({ type: 'add', layer: { ...layer, ...(args.opacity !== undefined ? { opacity: args.opacity } : {}) } }, 'Neue Ebene');
      return { layerId: id, ...listed() };
    },
    [PHOTO_LIVE.layerRemove]: (args) => { const l = resolveLayer(doc(), args.layerId); apply({ type: 'remove', id: l.id }, 'Ebene löschen'); return listed(); },
    [PHOTO_LIVE.layerReorder]: (args: Record<string, any>) => {
      const l = resolveLayer(doc(), args.layerId);
      apply(args.index !== undefined ? { type: 'reorder', id: l.id, toIndex: args.index } : { type: 'step', id: l.id, delta: args.delta }, 'Anordnen');
      return listed();
    },
    [PHOTO_LIVE.layerSet]: (args) => {
      const l = resolveLayer(doc(), args.layerId);
      apply({ type: 'update', id: l.id, patch: layerPatchFromArgs(l, args) }, 'Ebeneneigenschaften');
      const next = resolveLayer(doc(), l.id);
      return { layer: describeLayer(next, doc().layers.indexOf(next)) };
    },
    [PHOTO_LIVE.adjustmentAdd]: (args: Record<string, any>) => {
      const layer = { ...makeAdjustmentLayer(`A${(n += 1)}`, args.name ?? 'Korrektur', args.adjustment), opacity: args.opacity ?? 1 };
      apply({ type: 'add', layer }, 'Neue Einstellungsebene');
      return { layerId: layer.id, ...listed() };
    },
    [PHOTO_LIVE.smartFilterAdd]: (args: Record<string, any>) => {
      const l = resolveLayer(doc(), args.layerId);
      if (l.kind !== 'raster') throw new Error('keine Pixelebene');
      apply({ type: 'update', id: l.id, patch: { fx: [...l.fx, args.instance] } }, 'Smartfilter');
      return { layerId: l.id, instanceId: args.instance.id };
    },
    [PHOTO_LIVE.smartFilterRemove]: (args) => {
      const l = resolveLayer(doc(), args.layerId);
      if (l.kind !== 'raster') throw new Error('keine Pixelebene');
      apply({ type: 'update', id: l.id, patch: { fx: l.fx.filter((fx) => fx.id !== args.instanceId) } }, 'Smartfilter entfernen');
      return { removed: args.instanceId };
    },
    [PHOTO_LIVE.smartFilterApply]: (args) => { log('apply', args); return listed(); },
    [PHOTO_LIVE.selectionSet]: (args) => { log('selection', args); apply({ type: 'selection', selection: args.mode === 'none' ? null : { pixelKey: 'sel', bounds: args.rect ?? { x: 0, y: 0, width: 64, height: 32 } } }, 'Auswahl'); return { selection: describeDoc(doc()).selection }; },
    [PHOTO_LIVE.generativeFill]: (args) => { log('fill', args); return listed(); },
    [PHOTO_LIVE.crop]: (args: Record<string, any>) => { apply({ type: 'crop', rect: args.rect }, 'Freistellen'); return { document: describeDoc(doc()) }; },
    [PHOTO_LIVE.mergeDown]: (args) => { log('merge', args); const d = doc(); const top = resolveLayer(d, args.layerId); const i = d.layers.indexOf(top); apply({ type: 'replace', ids: [d.layers[i - 1].id, top.id], layer: makeRasterLayer('M', 'Merged', 'px-m', 64, 32) }, 'Auf eine Ebene reduzieren'); return listed(); },
    [PHOTO_LIVE.flatten]: () => { apply({ type: 'replace', ids: doc().layers.map((l) => l.id), layer: makeRasterLayer('F', 'Hintergrund', 'px-f', 64, 32) }, 'Auf Hintergrundebene reduzieren'); return listed(); },
    [PHOTO_LIVE.historyUndo]: (args) => { for (let i = 0; i < Number(args.steps ?? 1); i += 1) h = undo(h!); return { index: h!.index }; },
    [PHOTO_LIVE.historyRedo]: (args) => { for (let i = 0; i < Number(args.steps ?? 1); i += 1) h = redo(h!); return { index: h!.index }; },
    [PHOTO_LIVE.historyJump]: (args) => { h = jumpTo(h!, Number(args.index)); return { index: h!.index }; },
    [PHOTO_LIVE.exportToMedia]: (args) => { log('export', args); return { mediaId: 'photo-1', name: `${args.name ?? 'x'}.png` }; },
  });
  return { calls, dispose, doc };
}

test('photo tools are published with schemas and write markers', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list();
    for (const name of PHOTO_TOOLS) assert.ok(listed.some((tool) => tool.name === name), `${name} missing`);
    assert.match(listed.find((tool) => tool.name === 'photo_layer_set')!.description, /changes the project/);
    assert.doesNotMatch(listed.find((tool) => tool.name === 'photo_layers_list')!.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('open, layers, adjustments, smart filters, history and export over MCP', async () => {
  const media = { id: 'm1', name: 'still.png', type: 'image' as const, url: 'data:image/png;base64,AAA', source: 'upload' as const };
  const { ctx, state } = createTestContext({ mediaItems: [media] });
  const page = fakePhotoPage();
  const mcp = await createMcpHarness(ctx);
  try {
    const opened = await mcp.call('photo_open', { mediaId: 'm1' });
    assert.equal((opened.document as any).name, 'still.png');
    assert.equal(page.calls[0].args.url, media.url);
    assert.equal((await mcp.call('photo_open', { mediaId: 'nope' })).ok, false);

    const text = await mcp.call('photo_layer_add', { kind: 'text', text: 'Titel', opacity: 80 });
    assert.equal((text.layers as any[])[0].opacity, 0.8);
    const raster = await mcp.call('photo_layer_add', { kind: 'raster' });
    const adj = await mcp.call('photo_adjustment_add', { type: 'hueSaturation', values: { saturation: -40 }, opacity: 0.5 });
    const adjLayer = page.doc().layers.find((l) => l.id === adj.layerId)!;
    assert.equal(adjLayer.kind === 'adjustment' && (adjLayer.adjustment as any).saturation, -40);
    assert.equal((await mcp.call('photo_adjustment_add', { type: 'bogus' })).ok, false);

    const set = await mcp.call('photo_layer_set', { layerId: raster.layerId, blendMode: 'multiply', opacity: 0.25, visible: false });
    assert.deepEqual([(set.layer as any).blendMode, (set.layer as any).opacity, (set.layer as any).visible], ['multiply', 0.25, false]);
    assert.equal((await mcp.call('photo_layer_set', { layerId: raster.layerId, blendMode: 'wrong' })).ok, false);

    const reordered = await mcp.call('photo_layer_reorder', { layerId: raster.layerId, index: 0 });
    assert.equal((reordered.layers as any[]).at(-1).id, raster.layerId);
    await mcp.call('photo_layer_reorder', { layerId: raster.layerId, delta: 1 });

    const fx = await mcp.call('photo_smart_filter_add', { layerId: 'L1', effectId: 'buckswood-post-plugins.optics-lab', preset: 'ai-natural', mix: 0.6 });
    assert.equal(fx.ok, true);
    const l1 = page.doc().layers.find((l) => l.id === 'L1')!;
    assert.equal(l1.kind === 'raster' && l1.fx[0].mix, 0.6);
    assert.equal((await mcp.call('photo_smart_filter_add', { layerId: 'L1', effectId: 'nope' })).ok, false);
    await mcp.call('photo_smart_filter_apply', { layerId: 'L1' });
    await mcp.call('photo_smart_filter_remove', { layerId: 'L1', instanceId: fx.instanceId });
    assert.equal((page.doc().layers.find((l) => l.id === 'L1') as any).fx.length, 0);

    const sel = await mcp.call('photo_selection_set', { mode: 'rect', rect: { x: 1, y: 2, width: 10, height: 5 }, combine: 'add' });
    assert.deepEqual((sel.selection as any).bounds, { x: 1, y: 2, width: 10, height: 5 });
    assert.equal((await mcp.call('photo_selection_set', { mode: 'rect' })).ok, false, 'rect required');
    await mcp.call('photo_generative_fill', { prompt: 'Himmel', model: 'flux-2-pro' });
    assert.equal(page.calls.find((c) => c.name === 'fill')!.args.prompt, 'Himmel');

    const listed = await mcp.call('photo_layers_list');
    assert.equal((listed.layers as unknown[]).length, 4);
    await mcp.call('photo_layer_remove', { layerId: text.layerId });
    await mcp.call('photo_merge_down', { layerId: raster.layerId });
    const cropped = await mcp.call('photo_crop', { rect: { x: 0, y: 0, width: 32, height: 16 } });
    assert.equal((cropped.document as any).width, 32);
    assert.equal((await mcp.call('photo_crop', {})).ok, false);

    const before = (await mcp.call('photo_state')).history as any;
    const undone = await mcp.call('photo_history_undo', { steps: 2 });
    assert.equal(undone.index, before.index - 2);
    const redone = await mcp.call('photo_history_redo');
    assert.equal(redone.index, before.index - 1);
    const jumped = await mcp.call('photo_history_jump', { index: 0 });
    assert.equal(jumped.index, 0);

    await mcp.call('photo_new_document', { width: 300, height: 200 });
    assert.equal((page.doc()).width, 300);
    await mcp.call('photo_layer_add', { kind: 'raster' });
    const flat = await mcp.call('photo_flatten');
    assert.equal((flat.layers as unknown[]).length, 1);
    const exported = await mcp.call('photo_export_to_media', { name: 'final' });
    assert.equal(exported.mediaId, 'photo-1');
    assert.equal(state.activeWorkspace, 'EDIT', 'page was already open, no navigation needed');
  } finally {
    mcp.dispose();
    page.dispose();
  }
});

test('photo tools open the PHOTO page when it is not mounted', async () => {
  const { ctx, state } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  let page: ReturnType<typeof fakePhotoPage> | null = null;
  try {
    const pending = mcp.call('photo_layers_list');
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(state.activeWorkspace, 'PHOTO');
    page = fakePhotoPage();
    const result = await pending;
    assert.equal(result.ok, false);
    assert.match(String(result.message), /Kein Dokument/);
  } finally {
    mcp.dispose();
    page?.dispose();
  }
});
