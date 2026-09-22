import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptPromptForModel, classifyChunk, promptStyleGuide, resolvePromptFamily, splitPrompt } from './promptStyle.ts';

const STORYBOARD = [
  'Ava Stone checks the monitors as the alarm starts, tense and alert',
  'Medium shot, 35mm lens, slight low angle',
  'Cold blue practical light from the screens, warm rim light from the corridor',
  'Photorealistic cinematic film still, subtle grain',
  'aspect ratio 16:9 widescreen framing',
  'Must keep consistent: scar over left eyebrow, red jacket',
  'Use the input images as references for composition, identity, wardrobe, and environment continuity',
  'no text, no watermark',
].join('. ');

test('resolves families for the app\'s model ids', () => {
  assert.equal(resolvePromptFamily('midjourney', 'image'), 'midjourney');
  assert.equal(resolvePromptFamily('nano-banana-2-fal', 'image'), 'gemini-image');
  assert.equal(resolvePromptFamily('gemini-pro', 'image'), 'gemini-image');
  assert.equal(resolvePromptFamily('flux-2-turbo', 'image'), 'flux');
  assert.equal(resolvePromptFamily('seedream-v5-pro-fal', 'image'), 'seedream');
  assert.equal(resolvePromptFamily('gpt-image-2-fal', 'image'), 'gpt-image');
  assert.equal(resolvePromptFamily('ideogram-v4-fal', 'image'), 'ideogram');
  assert.equal(resolvePromptFamily('veo-3.1-fast-generate-preview', 'video'), 'veo');
  assert.equal(resolvePromptFamily('kling-v3-pro-i2v-fal', 'video'), 'kling');
  assert.equal(resolvePromptFamily('seedance-2.5-omni-fal', 'video'), 'seedance');
  assert.equal(resolvePromptFamily('wan-2.7-i2v-fal', 'video'), 'wan-video');
  assert.equal(resolvePromptFamily('ltx-2.3-pro', 'video'), 'ltx');
  assert.equal(resolvePromptFamily('p-video', 'video'), 'generic-video');
});

test('splits sentences but keeps decimals and quoted dialogue intact', () => {
  const parts = splitPrompt('Anamorphic 2.39:1 look. Ava says: "We go. Now." Then she runs.');
  assert.deepEqual(parts, ['Anamorphic 2.39:1 look.', 'Ava says: "We go. Now."', 'Then she runs.']);
});

test('classifies the generic sentence types the editor produces', () => {
  assert.equal(classifyChunk('Medium shot, 35mm lens, slight low angle'), 'camera');
  assert.equal(classifyChunk('Cold blue practical light from the screens'), 'lighting');
  assert.equal(classifyChunk('aspect ratio 16:9 widescreen framing'), 'aspect');
  assert.equal(classifyChunk('no text, no watermark'), 'negative');
  assert.equal(classifyChunk('Use the input images as references for continuity'), 'reference');
  assert.equal(classifyChunk('Must keep consistent: scar over left eyebrow'), 'continuity');
  assert.equal(classifyChunk('Ava says: "We go now."'), 'audio');
  assert.equal(classifyChunk('Ava Stone checks the monitors as the alarm starts'), 'subject');
});

test('midjourney: comma phrases, no aspect wording, negatives become --no', () => {
  const out = adaptPromptForModel('midjourney', STORYBOARD, { kind: 'image', aspectRatio: '16:9' });
  assert.match(out, /^Ava Stone checks the monitors/);
  assert.ok(!/aspect ratio|widescreen/i.test(out), 'aspect text must go');
  assert.ok(!/\. /.test(out.split('--no')[0]), 'body is comma phrases, not sentences');
  assert.match(out, /--no text, watermark$/);
  assert.ok(!/--ar/.test(out), 'the agent adds --ar, not the adapter');
});

test('gemini image: prose, no aspect wording, negatives as an Avoid sentence', () => {
  const out = adaptPromptForModel('nano', STORYBOARD, { kind: 'image', aspectRatio: '16:9' });
  assert.ok(!/aspect ratio|16:9/.test(out));
  assert.ok(!/--/.test(out));
  assert.match(out, /Avoid: text, watermark\.$/);
  assert.ok(out.indexOf('Ava Stone') < out.indexOf('Medium shot'));
});

test('flux drops negatives entirely', () => {
  const out = adaptPromptForModel('flux', STORYBOARD, { kind: 'image', aspectRatio: '16:9' });
  assert.ok(!/watermark|Avoid/.test(out));
});

test('imagen leads with "A photo of" for photoreal prompts', () => {
  const out = adaptPromptForModel('imagen', STORYBOARD, { kind: 'image', aspectRatio: '16:9' });
  assert.match(out, /^A photo of ava Stone|^A photo of Ava Stone/);
});

test('seedream writes one directive per line with the shot first', () => {
  const out = adaptPromptForModel('seedream-v5-pro-fal', STORYBOARD, { kind: 'image', aspectRatio: '16:9' });
  const lines = out.split('\n');
  assert.match(lines[0], /Medium shot/);
  assert.ok(lines.length >= 4);
});

test('ideogram puts quoted text first', () => {
  const out = adaptPromptForModel('ideogram-v4-fal', 'A neon diner at night. The sign reads "OPEN 24H" in retro script. Soft pink glow.', { kind: 'image', aspectRatio: '1:1' });
  assert.match(out, /^The sign reads "OPEN 24H"/);
});

test('cinemascope framing hints survive because the app crops afterwards', () => {
  const out = adaptPromptForModel('nano', 'A lone rider on a ridge. cinemascope 2.39:1, anamorphic de-squeezed, widescreen framing', { kind: 'image', aspectRatio: '2.39:1' });
  assert.match(out, /cinemascope/);
});

test('veo: camera first, audio last, adds an audio note when none was given', () => {
  const out = adaptPromptForModel('veo-3.1-generate-preview', 'Ava runs down the corridor. Slow dolly push-in at eye level. Cold blue light. Cinematic.', { kind: 'video', aspectRatio: '16:9' });
  assert.match(out, /^Slow dolly push-in/);
  assert.match(out, /Audio: /);
});

test('kling keeps camera as its own sentence after the action and drops negatives', () => {
  const out = adaptPromptForModel('kling-v3-pro-t2v-fal', 'Ava runs down the corridor. Camera tracks beside her. No blur.', { kind: 'video' });
  assert.ok(out.indexOf('Ava runs') < out.indexOf('Camera tracks'));
  assert.ok(!/blur|Avoid/.test(out));
});

test('seedance wraps a single beat as Shot 1 with a sound line', () => {
  const out = adaptPromptForModel('seedance-2.5-i2v-fal', 'Ava turns to the window. Slow push-in. Rain on glass, distant thunder audio.', { kind: 'video', durationSeconds: 5 });
  assert.match(out, /^1 shot, 5s\. Shot 1: /);
  assert.match(out, /Sound: /);
});

test('hailuo puts bracketed camera commands first', () => {
  const out = adaptPromptForModel('minimax-hailuo-2.3', 'Ava turns to the window. The camera pushes in slowly and tilts up.', { kind: 'video' });
  assert.match(out, /^\[Push in, Tilt up\]/);
});

test('style guides differ per family', () => {
  assert.notEqual(promptStyleGuide('midjourney', 'image'), promptStyleGuide('nano', 'image'));
  assert.match(promptStyleGuide('veo-3.1-fast-generate-preview', 'video'), /says: "exact line"/);
  assert.match(promptStyleGuide('midjourney', 'image'), /--ar/);
});
