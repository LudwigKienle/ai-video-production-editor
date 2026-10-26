import test from 'node:test';
import assert from 'node:assert/strict';

import {
  BURST_SHOT_LIBRARY,
  buildBurstFramePrompt,
  burstShots,
  checkBurstFramePrompt,
  nearestAspectRatio,
  parseBurstAnalysis,
} from './burstFrame.ts';

const input = {
  continuity: 'woman in a red wool coat seated on a grey sofa, hands folded, brass lamp to her left',
  style: 'Soft window light from camera left, muted palette, shallow depth of field, photorealistic.',
};

test('every library has exactly 20 shots', () => {
  for (const shots of Object.values(BURST_SHOT_LIBRARY)) assert.equal(shots.length, 20);
});

test('full prompt passes the specification check', () => {
  const prompt = buildBurstFramePrompt(input);
  const check = checkBurstFramePrompt(prompt);
  assert.deepEqual(check.problems, []);
  assert.match(prompt, /^\[01\] Wide establishing view/m);
  assert.match(prompt, /^\[20\] .*still, locked frame\.$/m);
  assert.ok(prompt.indexOf('CONTINUITY LOCK') < prompt.indexOf('SHOT SEQUENCE'));
});

test('compact prompt is shorter and still valid', () => {
  const full = buildBurstFramePrompt(input);
  const compact = buildBurstFramePrompt({ ...input, compact: true });
  assert.ok(compact.length < full.length);
  assert.deepEqual(checkBurstFramePrompt(compact).problems, []);
});

test('custom shot lists are renumbered and locked', () => {
  const shots = Array.from({ length: 20 }, (_, i) => `[${String(i + 1).padStart(2, '0')}] Custom angle ${i + 1}, still, locked frame.`);
  const prompt = buildBurstFramePrompt({ ...input, shots });
  assert.match(prompt, /^\[07\] Custom angle 7, still, locked frame\.$/m);
  assert.equal(checkBurstFramePrompt(prompt).ok, true);
});

test('time-of-day lighting replaces shots 18-20 only', () => {
  const shots = burstShots({ lighting: 'time-of-day' });
  assert.equal(shots.length, 20);
  assert.match(shots[17], /nighttime/);
  assert.match(shots[18], /sunset/);
  assert.equal(shots[16], BURST_SHOT_LIBRARY.person[16]);
});

test('object and place subjects use adapted libraries', () => {
  assert.match(burstShots({ subjectKind: 'object' })[3], /front face/);
  assert.match(burstShots({ subjectKind: 'architecture' })[3], /structural/);
});

test('checker flags broken prompts', () => {
  const broken = buildBurstFramePrompt(input).replace('[20]', '[2O]').replace(/still, locked frame\.$/m, '.');
  const check = checkBurstFramePrompt(broken);
  assert.equal(check.ok, false);
  assert.ok(check.problems.length >= 1);
  assert.equal(checkBurstFramePrompt(buildBurstFramePrompt(input).replace('[05] Extreme', '[05] She turns and smiles, extreme')).ok, false);
});

test('analysis JSON is parsed defensively', () => {
  const parsed = parseBurstAnalysis('```json\n{"subjectKind":"object","continuity":"a red camera","style":"Hard sun.","aspectRatio":"4:3","shots":["a"]}\n```');
  assert.equal(parsed?.subjectKind, 'object');
  assert.equal(parsed?.shots, undefined);
  assert.equal(parseBurstAnalysis('no json here'), null);
});

test('nearest aspect ratio', () => {
  assert.equal(nearestAspectRatio(1920, 1080), '16:9');
  assert.equal(nearestAspectRatio(1080, 1920), '9:16');
  assert.equal(nearestAspectRatio(2560, 1080), '21:9');
  assert.equal(nearestAspectRatio(1360, 768), '16:9');
});
