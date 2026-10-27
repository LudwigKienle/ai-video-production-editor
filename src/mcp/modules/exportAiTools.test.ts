import test from 'node:test';
import assert from 'node:assert/strict';

import { exportLib, STYLE_TRANSFER_PRESETS } from './exportAiTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { overrideProjectFileWriter } from '../projectFiles.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { getExportState, resetExportStoreForTests } from '../../workspaces/export-pro/exportStore.ts';
import type { TimelineClip } from '../../types.ts';

const clip = { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 0, end: 4, duration: 4, speed: 1, effect: null } as unknown as TimelineClip;

test('export_ai: options, interchange to project, preflight, retry, seek', async () => {
  resetExportStoreForTests();
  const opened: string[] = [];
  exportLib.override({
    buildInterchangeFile: (format) => ({ fileName: `Sequenz.${format === 'fcpxml' ? 'fcpxml' : 'otio'}`, mimeType: 'application/xml', text: `<${format}/>`, note: 'n' }),
    ffmpegPreflight: () => [{ clipId: 'c1', message: 'unsupported effect' }],
    ocioConfigs: [{ id: 'aces-2.0-studio', label: 'ACES 2.0 Studio' }],
    openFolder: async (path) => { opened.push(path); },
  });
  const written: Array<[string, string]> = [];
  overrideProjectFileWriter(async (_f, rel, data) => { written.push([rel, data]); return true; });
  const seeks: number[] = [];
  const dispose = registerLiveCommands({ 'export.preview.seek': (args) => { seeks.push(Number(args.seconds)); return { seconds: args.seconds }; } });
  const { ctx } = createTestContext({ timelineClips: [clip], projectPath: '/proj', activeWorkspace: 'EXPORT' });
  const mcp = await createMcpHarness(ctx);
  try {
    const names = mcp.list().map((tool) => tool.name);
    for (const name of ['export_ai_options', 'export_ai_interchange', 'export_ai_open_folder', 'export_ai_queue_retry', 'export_ai_export_now', 'export_ai_davinci_view', 'export_ai_preflight', 'export_ai_preview_seek']) assert.ok(names.includes(name), name);

    const options = await mcp.call('export_ai_options');
    assert.deepEqual(options.styleTransferPresets, STYLE_TRANSFER_PRESETS);

    const fcp = await mcp.call('export_ai_interchange', { format: 'fcpxml' });
    assert.equal(fcp.path, '/proj/exports/Sequenz.fcpxml');
    assert.equal(fcp.text, undefined);
    assert.deepEqual(written[0], ['exports/Sequenz.fcpxml', '<fcpxml/>']);
    const preview = await mcp.call('export_ai_interchange', { format: 'otio', write: false });
    assert.equal(preview.text, '<otio/>');
    assert.equal((await mcp.call('export_ai_interchange', { format: 'pdf' })).ok, false);

    const pre = await mcp.call('export_ai_preflight');
    assert.equal(pre.ready, false);
    assert.equal((pre.issues as unknown[]).length, 1);

    await mcp.call('export_ai_open_folder');
    assert.deepEqual(opened, ['/proj/exports']);

    await mcp.call('export_ai_davinci_view', { kind: 'still', tab: 'file' });
    const s = getExportState() as unknown as { davinciKind: string; davinciTab: string };
    assert.equal(s.davinciKind, 'still');
    assert.equal(s.davinciTab, 'file');

    assert.equal((await mcp.call('export_ai_queue_retry', { jobId: 'nope' })).ok, false);
    await mcp.call('export_ai_preview_seek', { seconds: 2.5 });
    assert.deepEqual(seeks, [2.5]);
  } finally {
    dispose();
    exportLib.override(null);
    overrideProjectFileWriter(null);
    mcp.dispose();
  }
});
