import test from 'node:test';
import assert from 'node:assert/strict';

import { colorLib } from './colorAiTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { overrideProjectFileWriter } from '../projectFiles.ts';
import type { ClipFilters, TimelineClip } from '../../types.ts';

const neutral = { brightness: 100, contrast: 100, saturate: 100, hueRotate: 0, grain: 0, halation: 0, bloom: 0, vignette: 0, lut: 'none', lutIntensity: 100 } as unknown as ClipFilters;
const clip = { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 0, end: 4, duration: 4, speed: 1, effect: null } as unknown as TimelineClip;

test('color_ai: look, LUTs, .cube export and paid AI colorist with confirm', async () => {
  const calls: string[] = [];
  colorLib.override({
    normalizeFilters: (f) => ({ ...neutral, ...(f ?? {}) }) as ClipFilters,
    FILM_LUTS: [{ id: 'kodak-2383', name: 'Kodak 2383' }],
    LOOK_PRESETS: [{ id: 'teal', name: 'Teal & Orange', filters: { saturate: 120, lut: 'kodak-2383' as ClipFilters['lut'] } }],
    parseCubeLut: (text) => ({ size: 2, data: text.length } as unknown as ClipFilters['customLut']),
    getInstalledPluginLuts: () => [{ id: 'p1', name: 'Pack LUT', lut: { size: 2 } as unknown as ClipFilters['customLut'] }],
    suggestColorGrade: async () => { calls.push('suggest'); return { analysis: 'flat', suggestions: [{ name: 'Warm', filters: { contrast: 115 } }] }; },
    gradeImageFromPrompt: async (_b, _m, prompt) => { calls.push(`prompt:${prompt}`); return { filters: { brightness: 90 } }; },
    matchReferenceGrade: async () => ({ filters: { hueRotate: 5 } }),
    analyzeAudioRequirements: async (_s, desc) => { calls.push(`audio:${desc.split('\n').length}`); return [{ prompt: 'drums' }]; },
    extractFrameFromVideo: async () => 'data:image/jpeg;base64,AA==',
  });
  const written: string[] = [];
  overrideProjectFileWriter(async (_folder, rel) => { written.push(rel); return true; });
  const { ctx, state } = createTestContext({
    timelineClips: [clip], selectedClipId: 'c1', projectPath: '/proj',
    mediaItems: [{ id: 'm1', name: 'a.mp4', type: 'video', url: 'blob:a', source: 'upload' }],
    extras: { storyBible: { script: 'Opener' } },
  });
  const mcp = await createMcpHarness(ctx);
  const look = () => state.timelineClips[0].filters as ClipFilters;
  try {
    const byName = new Map(mcp.list().map((tool) => [tool.name, tool]));
    for (const paid of ['color_ai_analyze', 'color_ai_match_reference', 'color_ai_prompt_grade', 'color_ai_audio_cues']) assert.match(byName.get(paid)!.description, /KOSTET CREDITS/);
    for (const del of ['color_ai_look_reset', 'color_ai_lut_remove']) assert.match(byName.get(del)!.description, /LÖSCHT/);

    await mcp.call('color_ai_look_set', { lut: 'kodak-2383', grain: 20 });
    assert.equal(look().grain, 20);
    assert.equal((await mcp.call('color_ai_look_set', { lut: 'nope' })).ok, false);
    await mcp.call('color_ai_look_preset', { presetId: 'teal' });
    assert.equal(look().saturate, 120);
    await mcp.call('color_ai_lut_import', { cubeText: 'LUT_3D_SIZE 2\n0 0 0', name: 'show.cube' });
    assert.equal(look().customLutName, 'show.cube');
    await mcp.call('color_ai_lut_plugin', { lutId: 'p1' });
    assert.equal(look().customLutName, 'Pack LUT');
    await mcp.call('color_ai_lut_remove');
    assert.equal(look().lut, 'none');

    const cube = await mcp.call('color_ai_export_cube', { name: 'grade' });
    assert.equal(cube.path, '/proj/exports/luts/grade.cube');
    assert.deepEqual(written, ['exports/luts/grade.cube']);

    assert.equal((await mcp.call('color_ai_analyze', {})).ok, false, 'needs confirm');
    assert.equal(calls.length, 0);
    const analysed = await mcp.call('color_ai_analyze', { confirm: true, apply: 0 });
    assert.equal(analysed.applied, 'Warm');
    assert.equal(look().contrast, 115);
    await mcp.call('color_ai_prompt_grade', { confirm: true, prompt: 'bleach bypass' });
    assert.equal(look().brightness, 90);
    const cues = await mcp.call('color_ai_audio_cues', { confirm: true });
    assert.equal((cues.cues as unknown[]).length, 1);
    assert.deepEqual(calls, ['suggest', 'prompt:bleach bypass', 'audio:1']);
    await mcp.call('color_ai_look_reset');
    assert.equal(look().contrast, 100);
  } finally {
    colorLib.override(null);
    overrideProjectFileWriter(null);
    mcp.dispose();
  }
});
