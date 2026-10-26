import test from 'node:test';
import assert from 'node:assert/strict';

import {
    DEFAULT_DELIVERY_SETTINGS,
    DELIVERY_PRESETS,
    applyPreset,
    buildRenderPayload,
    constrainVideo,
    estimateOutputBytes,
    formatBytes,
    formatTimecode,
    outputFileName,
    parseTimecode,
    resolveRange,
    type DeliverySettings,
} from './deliveryModel.ts';
import {
    createDefaultExportState,
    deserializeExportState,
    nextRunnableJob,
    queueSummary,
    serializeExportState,
    updateJob,
} from './exportState.ts';
import { EXPORT_COMMANDS, listExportCommands, runExportCommand } from './commands.ts';

const clone = (): DeliverySettings => JSON.parse(JSON.stringify(DEFAULT_DELIVERY_SETTINGS));
let seq = 0;
const ctx = { timelineDuration: 10, stillTime: 2, timelineName: 'Sequenz 01', now: 1, makeId: () => `j${++seq}` };

test('presets map onto codec settings', () => {
    const ids = DELIVERY_PRESETS.map((preset) => preset.id);
    for (const id of ['hq-1080-h264', 'match-source-high', 'prores-422-hq', 'prores-4444', 'h265-10bit', 'youtube-1080', 'youtube-4k', 'instagram-916', 'draft-720', 'quick-browser']) {
        assert.ok(ids.includes(id), id);
    }
    const yt4k = applyPreset(clone(), 'youtube-4k');
    assert.equal(yt4k.video.width, 3840);
    assert.equal(yt4k.video.bitrateKbps, 45000);
    const match = applyPreset(clone(), 'match-source-high', { width: 2048, height: 857, fps: 24 });
    assert.deepEqual([match.video.width, match.video.height, match.video.fps], [2048, 858, 24]);
    const p4444 = applyPreset(clone(), 'prores-4444');
    assert.equal(p4444.video.codec, 'prores');
    assert.equal(p4444.video.proresProfile, '4444');
    assert.equal(p4444.audio.codec, 'pcm_s24le');
    const insta = applyPreset(clone(), 'instagram-916');
    assert.equal(insta.video.scaleMode, 'fill');
    assert.equal(applyPreset(clone(), 'quick-browser').engine, 'browser');
    assert.equal(applyPreset(clone(), 'audio-only').audioOnly.codec, 'pcm_s24le');
    assert.equal(applyPreset(clone(), 'nope').presetId, 'custom');
});

test('constrainVideo enforces codec rules', () => {
    const v = constrainVideo({ ...DEFAULT_DELIVERY_SETTINGS.video, codec: 'prores', container: 'mp4', bitDepth: 8 });
    assert.equal(v.container, 'mov');
    assert.equal(v.bitDepth, 10);
    const h = constrainVideo({ ...DEFAULT_DELIVERY_SETTINGS.video, codec: 'hevc', bitDepth: 10, width: 1919 });
    assert.equal(h.profile, 'main10');
    assert.equal(h.width, 1920);
    assert.equal(constrainVideo({ ...DEFAULT_DELIVERY_SETTINGS.video, codec: 'h264', bitDepth: 10 }).profile, 'high10');
});

test('file size estimate uses bitrate × duration', () => {
    const s = clone();
    // 20 Mbit/s video + 320 kbit/s audio for 60 s, +1 % container overhead
    assert.equal(estimateOutputBytes('media', s, 60), Math.round(((20_000_000 + 320_000) * 60 / 8) * 1.01));
    const prores = applyPreset(clone(), 'prores-422-hq', { width: 1920, height: 1080, fps: 30 });
    const bytes = estimateOutputBytes('media', prores, 10) || 0;
    assert.ok(bytes > 270e6 && bytes < 290e6, String(bytes));
    assert.equal(estimateOutputBytes('audio', s, 10), 48000 * 2 * 24 * 10 / 8);
    assert.equal(estimateOutputBytes('interchange', s, 10), null);
    assert.equal(estimateOutputBytes('sequence', { ...s, sequence: { format: 'exr' } }, 1), 1920 * 1080 * 12 * 30);
    assert.equal(formatBytes(151_500_000), '152 MB');
    assert.equal(formatBytes(1_234_000), '1,2 MB');
    assert.equal(formatBytes(null), '< 1 MB');
});

test('range and timecode helpers', () => {
    assert.deepEqual(resolveRange({ mode: 'full', inPoint: 2, outPoint: 3 }, 10), { start: 0, end: 10, duration: 10 });
    assert.deepEqual(resolveRange({ mode: 'inout', inPoint: 2, outPoint: 5 }, 10), { start: 2, end: 5, duration: 3 });
    assert.deepEqual(resolveRange({ mode: 'custom', inPoint: 4, outPoint: 40 }, 10), { start: 4, end: 10, duration: 6 });
    assert.equal(resolveRange({ mode: 'workarea', inPoint: 1, outPoint: 2 }, 10).duration, 10);
    assert.equal(formatTimecode(61.5, 24), '00:01:01:12');
    assert.equal(parseTimecode('00:01:01:12', 24), 61.5);
    assert.equal(parseTimecode('2,5', 25), 2.5);
    assert.equal(parseTimecode('1:30', 25), 90);
    assert.equal(parseTimecode('x', 25), null);
});

test('render payload carries classic fields and the delivery block', () => {
    const s = applyPreset(clone(), 'prores-4444');
    s.filename = 'Opener v3';
    s.effects.timecode.enabled = true;
    const payload = buildRenderPayload('media', s, { start: 1, end: 4, duration: 3 }, 'job1');
    assert.equal(payload.videoCodec, 'prores');
    assert.equal(payload.container, 'mov');
    assert.equal(payload.filename, 'Opener v3.mov');
    assert.equal(payload.delivery.outputKind, 'video');
    assert.deepEqual(payload.delivery.range, { start: 1, end: 4 });
    assert.equal(payload.delivery.proresProfile, '4444');
    assert.equal(payload.delivery.profile, null);
    assert.equal(payload.delivery.overlays.timecode.enabled, true);
    const still = buildRenderPayload('still', s, { start: 0, end: 10, duration: 10 }, 'job2', 2.5);
    assert.deepEqual(still.delivery.range, { start: 2.5, end: null });
    const audio = buildRenderPayload('audio', s, { start: 0, end: 10, duration: 10 }, 'job3');
    assert.equal(audio.delivery.audio.enabled, true);
    assert.equal(audio.delivery.audio.codec, 'pcm_s24le');
    assert.equal(outputFileName('sequence', s), 'Opener v3/Opener v3_00000.png');
    assert.equal(outputFileName('interchange', s, 'nuke'), 'Opener v3.nk');
});

test('commands: queue add / export / render scope / cancel', () => {
    let state = createDefaultExportState();
    state = runExportCommand(state, 'export.destination.toggle', { kind: 'audio', enabled: true }, ctx);
    state = runExportCommand(state, 'export.destination.toggle', { kind: 'interchange' }, ctx);
    state = runExportCommand(state, 'export.queue.add', {}, ctx);
    // media + audio + 2 interchange formats (fcpxml, otio)
    assert.deepEqual(state.queue.map((job) => job.kind), ['media', 'audio', 'interchange', 'interchange']);
    assert.equal(state.queue[0].timelineName, 'Sequenz 01');
    assert.equal(state.runner.active, false);

    state = runExportCommand(state, 'export.export', {}, { ...ctx });
    assert.equal(state.queue.length, 8);
    assert.deepEqual(state.runner.jobIds, state.queue.slice(4).map((job) => job.id));
    assert.equal(nextRunnableJob(state)?.id, state.queue[4].id, 'only the newly exported jobs run');

    state = updateJob(state, state.queue[4].id, { status: 'running', progress: 50 });
    assert.equal(nextRunnableJob(state), null, 'one job at a time');
    state = runExportCommand(state, 'export.queue.cancel', {});
    assert.equal(state.runner.cancelRequested, true);
    assert.equal(state.runner.active, false);

    state = updateJob(state, state.queue[4].id, { status: 'done', progress: 100 });
    state = runExportCommand(state, 'export.queue.renderJob', { jobId: state.queue[4].id });
    assert.equal(state.queue[4].status, 'pending', 'finished job is reset when rendered again');
    state = runExportCommand(state, 'export.queue.renderAll', {});
    assert.equal(state.runner.jobIds, null);
    assert.equal(queueSummary(state.queue).pending, 8);

    state = runExportCommand(state, 'export.queue.remove', { jobId: state.queue[0].id });
    assert.equal(state.queue.length, 7);
    const still = runExportCommand(createDefaultExportState(), 'export.queue.add', { kinds: ['still'] }, ctx);
    assert.equal(still.queue[0].stillTime, 2);
});

test('commands: settings patch detaches from preset; view + davinci', () => {
    let state = createDefaultExportState();
    state = runExportCommand(state, 'export.preset.apply', { presetId: 'youtube-1080' });
    assert.equal(state.settings.presetId, 'youtube-1080');
    state = runExportCommand(state, 'export.settings.patch', { section: 'video', patch: { bitrateKbps: 12000 } });
    assert.equal(state.settings.presetId, 'custom');
    assert.equal(state.settings.video.bitrateKbps, 12000);
    state = runExportCommand(state, 'export.settings.patch', { section: 'root', patch: { filename: 'final', presetId: 'hack' } });
    assert.equal(state.settings.filename, 'final');
    assert.equal(state.settings.presetId, 'custom');
    state = runExportCommand(state, 'export.view.set', { view: 'davinci' });
    state = runExportCommand(state, 'export.davinci.kind', { kind: 'audio' });
    state = runExportCommand(state, 'export.davinci.tab', { tab: 'file' });
    assert.deepEqual([state.view, state.davinciKind, state.davinciTab], ['davinci', 'audio', 'file']);
    state = runExportCommand(state, 'export.range.set', { mode: 'inout', inPoint: 1, outPoint: 2 });
    assert.deepEqual(state.settings.range, { mode: 'inout', inPoint: 1, outPoint: 2 });
    const ids = listExportCommands().map((entry) => entry.id);
    assert.ok(ids.includes('export.queue.renderAll'));
    assert.equal(ids.length, Object.keys(EXPORT_COMMANDS).length);
});

test('persistence round-trips and survives garbage', () => {
    let state = createDefaultExportState();
    state = runExportCommand(state, 'export.view.set', { view: 'davinci' });
    state = runExportCommand(state, 'export.queue.add', { kinds: ['media'] }, ctx);
    state = updateJob(state, state.queue[0].id, { status: 'running' });
    const restored = deserializeExportState(serializeExportState(state));
    assert.equal(restored.view, 'davinci');
    assert.equal(restored.queue[0].status, 'error');
    assert.equal(restored.runner.active, false);
    assert.equal(deserializeExportState('{oops').view, 'premiere');
    const partial = deserializeExportState(JSON.stringify({ version: 1, settings: { video: { width: 1280 } } }));
    assert.equal(partial.settings.video.width, 1280);
    assert.equal(partial.settings.video.codec, 'h264');
    assert.equal(partial.settings.audio.sampleRate, 48000);
});

test('ffmpeg preflight mirrors the renderer checks', async () => {
    const { ffmpegPreflight } = await import('./preflight.ts');
    const media = [{ id: 'm1', name: 'Shot', type: 'video' as const, url: '', source: 'upload' as const }];
    const base = { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 0, end: 2, duration: 2, speed: 1, effect: null };
    assert.deepEqual(ffmpegPreflight([base], media, []), []);
    const issues = ffmpegPreflight([{ ...base, blendMode: 'screen' }, { ...base, id: 'c2', textConfig: { content: 'x', font: 'a', size: 1, color: '#fff', position: 'center' } }], media, []);
    assert.equal(issues.length, 2);
    assert.match(issues[0].message, /Mischmodus/);
    assert.equal(ffmpegPreflight([{ ...base, blendMode: 'screen' }], media, [{ id: 'v1', name: 'V1', type: 'video', isLocked: false, isMuted: true }]).length, 0);
});
