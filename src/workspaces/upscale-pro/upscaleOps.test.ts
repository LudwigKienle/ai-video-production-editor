import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_SETTINGS,
  clampPan,
  clampRange,
  computeTargetSize,
  easedProgress,
  estimateFps,
  estimateOutputBytes,
  fillCrop,
  formatBytes,
  formatTimecode,
  jobsReducer,
  nextRunnableJob,
  parseSettings,
  pipelineProgress,
  planPipeline,
  presetBox,
  previewRange,
  resolutionLabel,
  sanitizeSettings,
  sideBySidePanes,
  sumPipelineCost,
  toEven,
  toServiceOptions,
  unsharpMask,
  viewTransform,
  wipeFromPointer,
  wipeGeometry,
  zoomAt,
  type OutputSettings,
  type UpscaleJob,
  type UpscaleSettings,
} from './upscaleOps.ts';
import { ENHANCE_MODELS, getEnhanceModel, modelsForKind, UPSCALE_FALLBACK_RATES } from './upscaleModels.ts';

const out = (patch: Partial<OutputSettings>): OutputSettings => ({ ...DEFAULT_SETTINGS.output, ...patch });
const settings = (patch: Partial<UpscaleSettings> = {}): UpscaleSettings => ({ ...structuredClone(DEFAULT_SETTINGS), ...patch });

test('toEven rounds to even numbers and never below 2', () => {
  assert.equal(toEven(1081), 1080);
  assert.equal(toEven(1082.6), 1082);
  assert.equal(toEven(0), 2);
  assert.equal(toEven(Number.NaN), 2);
});

test('scale mode doubles and keeps even dimensions', () => {
  const t = computeTargetSize({ width: 1279, height: 721 }, out({ mode: 'scale', scale: 2 }));
  assert.equal(t.width % 2, 0);
  assert.equal(t.height % 2, 0);
  assert.deepEqual([t.width, t.height], [2558, 1442]);
  assert.equal(t.limited, false);
});

test('preset fits inside the box and respects portrait orientation', () => {
  const landscape = computeTargetSize({ width: 1280, height: 720 }, out({ mode: 'preset', preset: '4k' }));
  assert.deepEqual([landscape.width, landscape.height], [3840, 2160]);
  const portrait = presetBox('1080p', { width: 1080, height: 1920 });
  assert.deepEqual(portrait, { width: 1080, height: 1920 });
  const square = computeTargetSize({ width: 1000, height: 1000 }, out({ mode: 'preset', preset: '1080p' }));
  assert.deepEqual([square.width, square.height], [1080, 1080]);
});

test('crop to fill fills the box exactly with a centred crop', () => {
  const t = computeTargetSize({ width: 1000, height: 1000 }, out({ mode: 'preset', preset: '1080p', cropToFill: true }));
  assert.deepEqual([t.width, t.height], [1920, 1080]);
  assert.equal(t.crop.width, 1000);
  assert.equal(Math.round(t.crop.height), 563);
  assert.equal(Math.round(t.crop.y), 219);
  const same = fillCrop({ width: 1920, height: 1080 }, { width: 3840, height: 2160 });
  assert.deepEqual(same, { x: 0, y: 0, width: 1920, height: 1080 });
});

test('model limits clamp long edge and scale (video 8K → 4K)', () => {
  const video = getEnhanceModel('topaz-video')!;
  const t = computeTargetSize({ width: 1920, height: 1080 }, out({ mode: 'preset', preset: '8k' }), video.limits);
  assert.ok(t.limited);
  assert.deepEqual([t.width, t.height], [3840, 2160]);
  assert.ok(t.notes.some((n) => n.includes('3840')));
  const esrgan = getEnhanceModel('real-esrgan')!;
  const s = computeTargetSize({ width: 500, height: 300 }, out({ mode: 'scale', scale: 8 }), esrgan.limits);
  assert.deepEqual([s.width, s.height], [2000, 1200]);
  assert.ok(s.notes.some((n) => n.includes('4×')));
});

test('custom size and downscale note', () => {
  const t = computeTargetSize({ width: 4000, height: 3000 }, out({ mode: 'custom', customWidth: 1001, customHeight: 999 }));
  assert.equal(t.width % 2, 0);
  assert.ok(t.scale < 1);
  assert.ok(t.notes.some((n) => n.includes('Verkleinerung')));
});

test('resolution label and service options', () => {
  assert.equal(resolutionLabel({ width: 3840, height: 2160 }), '4k');
  assert.equal(resolutionLabel({ width: 1080, height: 1920 }), '1080p');
  const t = computeTargetSize({ width: 960, height: 540 }, out({ mode: 'scale', scale: 4 }));
  assert.deepEqual(toServiceOptions(t, 'video'), { scale: 4, resolution: '4k' });
  assert.deepEqual(toServiceOptions(t, 'image'), { scale: 4, resolution: '3840x2160' });
});

test('model catalogue: every kind has models and fallback rates cover them', () => {
  assert.ok(modelsForKind('image').length >= 3);
  assert.ok(modelsForKind('video').length >= 2);
  for (const model of ENHANCE_MODELS) {
    assert.ok(UPSCALE_FALLBACK_RATES.some((rate) => rate.model === model.providerModel), model.id);
    assert.ok(model.description.length > 10);
  }
});

test('sanitizeSettings rejects garbage and keeps valid values', () => {
  const s = sanitizeSettings({ output: { mode: 'nope', scale: 99, preset: '8k' }, enhance: { imageModel: 'topaz-video' }, post: { grain: 5 } });
  assert.equal(s.output.mode, 'scale');
  assert.equal(s.output.scale, 8);
  assert.equal(s.output.preset, '8k');
  assert.equal(s.enhance.imageModel, DEFAULT_SETTINGS.enhance.imageModel);
  assert.equal(s.post.grain, 1);
  assert.deepEqual(parseSettings('{broken'), sanitizeSettings(null));
  assert.deepEqual(parseSettings(JSON.stringify(DEFAULT_SETTINGS)), DEFAULT_SETTINGS);
});

test('planPipeline: image gets enhance + local post, no capture', () => {
  const plan = planPipeline(settings(), { kind: 'image', source: { width: 1024, height: 1024 }, fps: 0, rangeSeconds: 0, partialRange: false });
  assert.deepEqual(plan.steps.map((s) => s.id), ['enhance', 'post']);
  assert.equal(plan.errors.length, 0);
  assert.equal(plan.steps[0].unitLabel, 'image');
});

test('planPipeline: video with range, interpolation, HDR limits', () => {
  const s = settings();
  s.interpolation.enabled = true;
  s.hdr.enabled = true;
  s.output = out({ mode: 'preset', preset: '4k' });
  const plan = planPipeline(s, { kind: 'video', source: { width: 1920, height: 1080 }, fps: 24, rangeSeconds: 5, partialRange: true });
  assert.deepEqual(plan.steps.map((x) => x.id), ['capture', 'enhance', 'interpolate', 'hdr']);
  assert.equal(plan.outputFps, 48);
  assert.equal(plan.steps[1].units, 5);
  // LTX at 4K allows only ~2 s.
  assert.ok(plan.errors.some((e) => e.includes('2 s')));
  s.hdr.engine = 'runway-ruby';
  const ruby = planPipeline(s, { kind: 'video', source: { width: 1920, height: 1080 }, fps: 24, rangeSeconds: 5, partialRange: false });
  assert.equal(ruby.errors.length, 0);
});

test('planPipeline: nothing enabled is an error, HDR on image is an error', () => {
  const s = settings();
  s.enhance.enabled = false;
  const plan = planPipeline(s, { kind: 'image', source: { width: 10, height: 10 }, fps: 0, rangeSeconds: 0, partialRange: false });
  assert.ok(plan.errors.some((e) => e.includes('Kein KI-Modell')));
  s.hdr.enabled = true;
  const hdr = planPipeline(s, { kind: 'image', source: { width: 10, height: 10 }, fps: 0, rangeSeconds: 0, partialRange: false });
  assert.ok(hdr.errors.some((e) => e.includes('nur für Videos')));
});

test('sumPipelineCost uses the injected lookup and lists unknown rates', () => {
  const s = settings();
  s.interpolation.enabled = true;
  const plan = planPipeline(s, { kind: 'video', source: { width: 1280, height: 720 }, fps: 25, rangeSeconds: 4.2, partialRange: false });
  const cost = sumPipelineCost(plan.steps, (step) => {
    const rate = UPSCALE_FALLBACK_RATES.find((r) => r.model === step.providerModel);
    return rate ? rate.unitCost * (step.units ?? 1) : null;
  });
  // topaz-video 5 s × 0.0816 + rife clip 0.0408
  assert.equal(cost.usd, Math.round((5 * 0.0816 + 0.0408) * 100000) / 100000);
  assert.deepEqual(sumPipelineCost(plan.steps, () => null).unknown.length, 2);
});

test('estimateOutputBytes scales with codec, quality and audio', () => {
  const base = { kind: 'video' as const, width: 1920, height: 1080, fps: 30, seconds: 10 };
  const h264 = estimateOutputBytes({ ...base, codec: 'h264', quality: 'high' });
  const h265 = estimateOutputBytes({ ...base, codec: 'h265', quality: 'high' });
  const prores = estimateOutputBytes({ ...base, codec: 'prores', quality: 'high' });
  assert.ok(h265 < h264 && h264 < prores);
  // ProRes 422 HQ ≈ 220 Mbit/s → ~275 MB for 10 s.
  assert.ok(Math.abs(prores / 1e6 - 275) < 10);
  assert.ok(estimateOutputBytes({ ...base, codec: 'h264', quality: 'high', audio: true }) > h264);
  assert.ok(estimateOutputBytes({ kind: 'image', width: 4000, height: 4000, imageFormat: 'jpeg' }) < estimateOutputBytes({ kind: 'image', width: 4000, height: 4000, imageFormat: 'png' }));
  assert.equal(formatBytes(275_400_000), '275 MB');
  assert.equal(formatBytes(1_520_000), '1.5 MB');
  assert.equal(formatBytes(-1), '0 B');
});

test('viewTransform fit, 100 % and pan clamping', () => {
  const vp = { width: 800, height: 450 };
  const content = { width: 3840, height: 2160 };
  const fit = viewTransform(vp, content, 'fit', { x: 500, y: 0 });
  assert.equal(fit.width, 800);
  assert.equal(fit.x, 0);
  const full = viewTransform(vp, content, 1, { x: 99999, y: -99999 });
  assert.equal(full.width, 3840);
  assert.equal(full.x, 0); // left edge pinned at max pan
  assert.equal(full.y, 450 - 2160);
  assert.deepEqual(clampPan(vp, { width: 400, height: 200 }, { x: 50, y: 50 }), { x: 0, y: 0 });
});

test('zoomAt keeps the pixel under the cursor fixed', () => {
  const vp = { width: 1000, height: 500 };
  const content = { width: 2000, height: 1000 };
  const point = { x: 750, y: 250 };
  const before = viewTransform(vp, content, 'fit', { x: 0, y: 0 });
  const u = (point.x - before.x) / before.width;
  const next = zoomAt(vp, content, { zoom: 'fit', pan: { x: 0, y: 0 } }, 2, point);
  const after = viewTransform(vp, content, next.zoom, next.pan);
  assert.ok(Math.abs(after.x + u * after.width - point.x) < 1e-6);
});

test('wipe geometry and pointer mapping', () => {
  const g = wipeGeometry({ width: 1000, height: 400 }, 0.3);
  assert.equal(g.dividerX, 300);
  assert.equal(g.before.width + g.after.width, 1000);
  assert.equal(wipeGeometry({ width: 100, height: 10 }, 7).position, 1);
  assert.equal(wipeFromPointer(-20, 500), 0);
  assert.equal(wipeFromPointer(250, 500), 0.5);
  assert.equal(wipeFromPointer(10, 0), 0.5);
  const [a, b] = sideBySidePanes({ width: 1002, height: 300 }, 2);
  assert.equal(a.width, 500);
  assert.equal(b.x, 502);
});

test('fps estimation snaps to common rates', () => {
  assert.equal(estimateFps(Array(10).fill(1 / 23.976)), 23.976);
  assert.equal(estimateFps([0.04, 0.04, 0.04, 0.08, 0.04]), 25);
  assert.equal(estimateFps([0.04]), null);
});

test('timecode, ranges and preview range', () => {
  assert.equal(formatTimecode(61.5, 24), '00:01:01:12');
  assert.deepEqual(clampRange({ start: -2, end: 50 }, 10, 25), { start: 0, end: 10 });
  const inverted = clampRange({ start: 8, end: 2 }, 10, 25);
  assert.ok(inverted.end > inverted.start);
  const pr = previewRange(9.5, 2, { start: 1, end: 10 }, 25);
  assert.deepEqual(pr, { start: 8, end: 10 });
  const frame = previewRange(3, 0, { start: 0, end: 10 }, 25);
  assert.ok(Math.abs(frame.end - frame.start - 0.04) < 1e-9);
});

const job = (id: string, status: UpscaleJob['status'] = 'queued'): UpscaleJob => ({
  id, inputId: 'in', name: id, kind: 'image', purpose: 'export', range: null, status, progress: 0, stepLabel: '', createdAt: 0,
});

test('job reducer: lifecycle, cancel, clear', () => {
  let jobs = jobsReducer([], { type: 'add', job: job('a') });
  jobs = jobsReducer(jobs, { type: 'add', job: job('b') });
  assert.equal(nextRunnableJob(jobs)?.id, 'a');
  jobs = jobsReducer(jobs, { type: 'start', id: 'a' });
  assert.equal(nextRunnableJob(jobs), null);
  jobs = jobsReducer(jobs, { type: 'progress', id: 'a', progress: 0.5, stepLabel: 'Upscaling' });
  jobs = jobsReducer(jobs, { type: 'progress', id: 'a', progress: 0.2 });
  assert.equal(jobs[0].progress, 0.5); // never goes backwards
  jobs = jobsReducer(jobs, { type: 'cancel', id: 'a', at: 1 });
  assert.equal(jobs[0].status, 'cancelled');
  // A late result for a cancelled job is ignored.
  jobs = jobsReducer(jobs, { type: 'done', id: 'a', resultUrl: 'x', at: 2 });
  assert.equal(jobs[0].status, 'cancelled');
  jobs = jobsReducer(jobs, { type: 'remove', id: 'b' });
  assert.equal(jobs.length, 2); // queued jobs are not removed
  jobs = jobsReducer(jobs, { type: 'clearFinished' });
  assert.deepEqual(jobs.map((j) => j.id), ['b']);
  assert.doesNotThrow(() => JSON.stringify(jobs));
});

test('progress helpers', () => {
  assert.equal(easedProgress(0, 1000), 0);
  assert.ok(easedProgress(100000, 1000) <= 0.95);
  assert.equal(pipelineProgress(1, 2, 0.5), 0.75);
  assert.equal(pipelineProgress(5, 2, 1), 0.99);
});

test('unsharpMask increases local contrast and leaves flat areas', () => {
  const w = 4;
  const h = 3;
  const flat = new Uint8ClampedArray(w * h * 4).fill(100);
  unsharpMask(flat, w, h, 1);
  assert.ok(flat.every((v) => v === 100));
  const edge = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = (y * w + x) * 4;
    const v = x < 2 ? 50 : 200;
    edge[i] = v; edge[i + 1] = v; edge[i + 2] = v; edge[i + 3] = 255;
  }
  unsharpMask(edge, w, h, 1);
  assert.ok(edge[(1 * w + 1) * 4] < 50);
  assert.ok(edge[(1 * w + 2) * 4] > 200);
  assert.equal(edge[3], 255);
});
