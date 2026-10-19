import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMachgenVideoInput, machgenReferenceLimit } from './machgenModels.ts';

test('MiniMax H3 Turbo text-to-video snaps duration and keeps audio on', () => {
  const { input, duration } = buildMachgenVideoInput('MiniMax-H3-Turbo', 'a fox runs', { duration: 7, aspectRatio: '9:16' });
  assert.equal(duration, 6);
  assert.equal(input.task_type, 'T2V');
  assert.deepEqual(input.video_config, { duration_secs: 6, height: 768, aspect_ratio: '9:16', fps: 24, audio: true });
  assert.equal(input.src_image_urls, undefined);
});

test('image-to-video sends start and end frames', () => {
  const { input } = buildMachgenVideoInput('MiniMax-H3-Turbo', 'p', { duration: 10 }, { startUrls: ['@input/a.png', '@input/b.png'] });
  assert.equal(input.task_type, 'I2V');
  assert.deepEqual(input.src_image_urls, ['@input/a.png', '@input/b.png']);
});

test('unsupported options fall back to what the model accepts', () => {
  const { input } = buildMachgenVideoInput('Wan2.2-A14B', 'p', { aspectRatio: '9:16', duration: 12 }, { startUrls: ['@input/a.png', '@input/b.png'] });
  assert.deepEqual(input.video_config, { duration_secs: 5, height: 720, aspect_ratio: '16:9', fps: 16 });
  assert.deepEqual(input.src_image_urls, ['@input/a.png']);
});

test('reference-to-video maps subjects and names them in the prompt', () => {
  const { input } = buildMachgenVideoInput('MiniMax-H3', 'two friends talk', {}, { referenceUrls: ['@input/x.png', '@input/y.png'] });
  assert.equal(input.task_type, 'R2V');
  assert.deepEqual(input.subject_to_image_ids, { ref1: [0], ref2: [1] });
  assert.match(String(input.prompt), /@ref1, @ref2/);
  const named = buildMachgenVideoInput('MiniMax-H3', '@ref1 waves', {}, { referenceUrls: ['@input/x.png'] }).input;
  assert.equal(named.prompt, '@ref1 waves');
  assert.equal(machgenReferenceLimit('Vidu-Q3-Turbo'), 7);
});
