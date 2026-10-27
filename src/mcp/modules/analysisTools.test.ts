import test from 'node:test';
import assert from 'node:assert/strict';

import { analysisServices } from './analysisTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';

const RESULT = { analysisProcess: 'p', overallFeedback: {}, scenes: [{ id: 's1', timestamp: '0:01' }] } as never;

test('analysis quick/deep/audio/audience (fake Gemini)', async () => {
  const calls: string[] = [];
  analysisServices.override({
    getVideoDuration: async () => 30,
    sampleQuickScanFrames: async (_url, start, end, count) => { calls.push(`sample:${start}-${end}x${count}`); return [{ base64: 'AA', mimeType: 'image/jpeg', timestamp: '0:05' }]; },
    analyzeFramesWithNeurocinematics: async (_frames, script, model) => { calls.push(`quick:${model}:${script}`); return RESULT; },
    analyzeVideoWithNeurocinematics: async (url, _script, range, model) => { calls.push(`deep:${url}:${range}:${model}`); return RESULT; },
    analyzeAudioPsychoacoustics: async (audio) => { calls.push(`audio:${audio.mimeType}`); return { overall: 'ok' } as never; },
    analyzeTargetAudience: async (script, audience) => { calls.push(`aud:${audience}`); return `fit for ${audience}`; },
  });
  const { ctx, state } = createTestContext({
    mediaItems: [{ id: 'm1', name: 'cut.mp4', type: 'video', url: 'blob:cut' } as never],
    extras: { analysis: { videoUrl: null, scriptText: '', result: null }, storyBible: { title: 'X' } },
  });
  const mcp = await createMcpHarness(ctx);
  try {
    assert.match(mcp.list().find((tool) => tool.name === 'analysis_run_deep')!.description, /KOSTET CREDITS/);
    const none = await mcp.call('analysis_run_deep', { confirm: true });
    assert.equal(none.ok, false);

    await mcp.call('analysis_set_source', { videoMediaId: 'm1', scriptText: 'Opener' });
    const quick = await mcp.call('analysis_run_quick', { confirm: true,  frameCount: 8 });
    assert.equal(quick.mode, 'quick');
    assert.deepEqual(calls.slice(0, 2), ['sample:0-30x8', 'quick:gemini-3.1-flash-preview:Opener']);

    const deep = await mcp.call('analysis_run_deep', { confirm: true,  rangeStart: 5, rangeEnd: 75 });
    assert.equal(deep.focusRange, '0:05 - 1:15');
    assert.ok(calls.includes('deep:blob:cut:0:05 - 1:15:gemini-3.1-pro-preview'));
    assert.equal((state.extras.analysis as { result: unknown }).result, RESULT);

    const audio = await mcp.call('analysis_run_audio', { confirm: true,  audioUrl: 'data:audio/wav;base64,AA==' });
    assert.equal((audio.result as { overall: string }).overall, 'ok');

    const fit = await mcp.call('analysis_run_audience_fit', { confirm: true,  targetAudience: 'Teens 14-19' });
    assert.equal(fit.audienceAnalysis, 'fit for Teens 14-19');
    assert.equal((state.extras.storyBible as { audienceAnalysis: string }).audienceAnalysis, 'fit for Teens 14-19');

    await mcp.call('analysis_clear_video');
    assert.equal((state.extras.analysis as { videoUrl: unknown }).videoUrl, null);
    const got = await mcp.call('analysis_get');
    assert.equal(got.targetAudience, 'Teens 14-19');
  } finally {
    analysisServices.override(null);
    mcp.dispose();
  }
});
