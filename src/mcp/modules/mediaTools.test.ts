import test from 'node:test';
import assert from 'node:assert/strict';

import './mediaTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import type { MediaItem, TimelineClip } from '../../types.ts';

const TOOLS = [
  'media_browse_places', 'media_browse_list', 'media_select', 'media_get_state', 'media_set_import_options', 'media_import',
  'media_list_project', 'media_list_bin', 'media_bin_update', 'media_favorites_add', 'media_favorites_remove', 'media_set_view',
];

/** Stand-in for the mounted Media page: records every live command it receives. */
const mountFakePage = () => {
  const calls: Array<{ command: string; args: Record<string, unknown> }> = [];
  const bins: Record<string, string[]> = {};
  let favorites: string[] = [];
  let selection: string[] = [];
  const record = (command: string, reply: (args: Record<string, unknown>) => unknown) => (args: Record<string, unknown>) => {
    calls.push({ command, args });
    return reply(args);
  };
  const dispose = registerLiveCommands({
    'media.places': record('places', () => ({ desktopBrowsing: true, places: { home: '/home/demo' }, favorites })),
    'media.browse': record('browse', (args) => ({ location: { type: args.source ?? 'fs', path: args.path }, total: 1, entries: [{ id: '/home/demo/a.mov', name: 'a.mov', kind: 'video' }] })),
    'media.select': record('select', (args) => { selection = args.mode === 'clear' ? [] : [...((args.ids as string[]) ?? [])]; return { selection, unresolved: [] }; }),
    'media.state': record('state', () => ({ selection, options: { bin: null } })),
    'media.setOptions': record('setOptions', (args) => ({ options: args })),
    'media.import': record('import', (args) => ({ mediaIds: ['m9'], bin: args.bin ?? null, sequence: args.sequence ?? null, timelineQueued: args.sequence ? 1 : 0, unresolved: [] })),
    'media.bins': record('bins', (args) => (args.bin ? { bin: args.bin, items: (bins[args.bin as string] ?? []).map((id) => ({ mediaId: id })) } : { bins: Object.keys(bins).map((name) => ({ name, count: bins[name].length })) })),
    'media.binUpdate': record('binUpdate', (args) => { bins[args.bin as string] = [...(bins[args.bin as string] ?? []), ...((args.add as string[]) ?? [])]; return { bins: Object.keys(bins) }; }),
    'media.favorite': record('favorite', (args) => { favorites = args.action === 'remove' ? favorites.filter((p) => p !== args.path) : [...favorites, args.path as string]; return { favorites }; }),
    'media.view': record('view', (args) => ({ view: args.view ?? 'grid' })),
  });
  return { calls, dispose };
};

const media = (id: string, type: MediaItem['type']): MediaItem => ({ id, name: `${id}.${type === 'audio' ? 'wav' : 'mov'}`, type, url: `blob:${id}`, source: 'upload', duration: 4 });
const clip = (id: string, mediaId: string): TimelineClip => ({ id, mediaId, trackId: 'v1', start: 0, end: 4, duration: 4, speed: 1, effect: null });

test('media tools are published with JSON schemas and write flags', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    for (const name of TOOLS) assert.ok(names.includes(name), `${name} missing`);
    const importTool = mcp.list().find((tool) => tool.name === 'media_import')!;
    assert.equal((importTool.inputSchema as { type: string }).type, 'object');
    assert.match(importTool.description, /changes the project/);
    assert.doesNotMatch(mcp.list().find((tool) => tool.name === 'media_browse_list')!.description, /changes the project/);
  } finally {
    mcp.dispose();
  }
});

test('media_list_project reads project media and timeline usage without the page', async () => {
  const { ctx } = createTestContext({ mediaItems: [media('m1', 'video'), media('m2', 'audio')], timelineClips: [clip('c1', 'm1'), clip('c2', 'm1')] });
  const mcp = await createMcpHarness(ctx);
  try {
    const all = await mcp.call('media_list_project');
    assert.equal(all.count, 2);
    assert.equal((all.items as Array<{ clipsOnTimeline: number }>)[0].clipsOnTimeline, 2);
    const audio = await mcp.call('media_list_project', { kind: 'audio' });
    assert.deepEqual((audio.items as Array<{ mediaId: string }>).map((item) => item.mediaId), ['m2']);
  } finally {
    mcp.dispose();
  }
});

test('every page tool reaches the Media page live commands', async () => {
  const { ctx } = createTestContext();
  const page = mountFakePage();
  const mcp = await createMcpHarness(ctx);
  try {
    assert.equal((await mcp.call('media_browse_places')).desktopBrowsing, true);
    const listed = await mcp.call('media_browse_list', { source: 'fs', path: '/home/demo', kind: 'video' });
    assert.equal(listed.ok, true);
    assert.equal(listed.total, 1);
    const selected = await mcp.call('media_select', { ids: ['/home/demo/a.mov'] });
    assert.deepEqual(selected.selection, ['/home/demo/a.mov']);
    assert.deepEqual((await mcp.call('media_get_state')).selection, ['/home/demo/a.mov']);
    await mcp.call('media_set_import_options', { copyToProject: true, bin: 'Dreh Tag 1', sequence: 'Rohschnitt', sequenceOrder: 'name' });
    const imported = await mcp.call('media_import', { sequence: 'Rohschnitt', bin: 'Dreh Tag 1' });
    assert.deepEqual(imported.mediaIds, ['m9']);
    assert.equal(imported.timelineQueued, 1);
    await mcp.call('media_bin_update', { bin: 'Auswahl', add: ['m9'] });
    assert.deepEqual(((await mcp.call('media_list_bin', { bin: 'Auswahl' })).items as Array<{ mediaId: string }>).map((item) => item.mediaId), ['m9']);
    assert.equal(((await mcp.call('media_list_bin')).bins as unknown[]).length, 1);
    assert.deepEqual((await mcp.call('media_favorites_add', { path: '/home/demo/Movies' })).favorites, ['/home/demo/Movies']);
    assert.deepEqual((await mcp.call('media_favorites_remove', { path: '/home/demo/Movies' })).favorites, []);
    assert.equal((await mcp.call('media_set_view', { view: 'list' })).view, 'list');

    const commands = page.calls.map((call) => call.command);
    for (const command of ['places', 'browse', 'select', 'state', 'setOptions', 'import', 'binUpdate', 'bins', 'favorite', 'view']) {
      assert.ok(commands.includes(command), `live command ${command} not reached`);
    }
    assert.equal(page.calls.find((call) => call.command === 'import')!.args.bin, 'Dreh Tag 1');
    assert.equal(page.calls.find((call) => call.command === 'setOptions')!.args.sequenceOrder, 'name');

    const missingBin = await mcp.call('media_bin_update', {});
    assert.equal(missingBin.ok, false);
    assert.match(String(missingBin.message), /bin/);
  } finally {
    page.dispose();
    mcp.dispose();
  }
});

test('page tools open the Media page when it is not mounted', async () => {
  const { ctx, state } = createTestContext();
  let page: ReturnType<typeof mountFakePage> | null = null;
  const open = ctx.actions.setActiveWorkspace;
  ctx.actions.setActiveWorkspace = (workspace) => {
    open(workspace);
    if (workspace === 'IMPORT' && !page) setTimeout(() => { page = mountFakePage(); }, 10);
  };
  const mcp = await createMcpHarness(ctx);
  try {
    const result = await mcp.call('media_get_state');
    assert.equal(result.ok, true);
    assert.equal(state.activeWorkspace, 'IMPORT');
  } finally {
    (page as ReturnType<typeof mountFakePage> | null)?.dispose();
    mcp.dispose();
  }
});
