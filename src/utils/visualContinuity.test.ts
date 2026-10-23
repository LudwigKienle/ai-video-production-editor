import test from 'node:test';
import assert from 'node:assert/strict';
import { buildVisualContinuityPrompt, parseVisualContinuityVerdict, toShotContinuityReview, extractVerdictObject } from './visualContinuity.ts';

test('the prompt lists the images and the screen-direction rule with the previous shot', () => {
  const prompt = buildVisualContinuityPrompt({
    shot: { label: '1.7', description: 'Reverse OTS onto Julian', prompt: '…', shotType: 'ots', characters: ['Julian Reed', 'Nora Vale'], environment: 'Penthouse Ballroom', wardrobe: ['Nora Vale: Night-shift uniform'] },
    previous: { label: '1.6', description: 'OTS from Julian onto Nora', sameScene: true, shotType: 'ots' },
    images: [{ role: 'current', label: 'current frame' }, { role: 'previous', label: 'previous shot 1.6' }, { role: 'character', label: 'Julian Reed reference' }],
  });
  assert.match(prompt, /Image 2: previous shot 1\.6/);
  assert.match(prompt, /OPPOSITE screen directions/);
  assert.match(prompt, /same scene/);
  assert.match(prompt, /Night-shift uniform/);
});

test('verdicts are normalised: high-severity issues cap the score, reverse angle defaults to 180°', () => {
  const verdict = parseVisualContinuityVerdict({
    score: 88, status: 'aligned', summary: 'Axis crossed',
    issues: [{ category: 'screen_direction', severity: 'high', message: 'Julian looks screen-left like Nora did in 1.6.' }, { category: 'nonsense', message: 'x' }],
    promptFix: 'Julian on the left of frame looking right, Nora\'s head on the right edge.', needsReverseAngle: true,
  });
  assert.equal(verdict.score, 69);
  assert.equal(verdict.status, 'drift');
  assert.equal(verdict.issues[1].category, 'staging');
  assert.equal(verdict.reverseYaw, 180);
  const review = toShotContinuityReview(verdict, { comparedShot: 154, model: 'gemini' });
  assert.equal(review.issues[0].kind, 'previous_shot');
  assert.equal(review.issues[0].comparedShot, 154);
  assert.equal(review.reverseAngle?.yaw, 180);
  assert.match(review.promptFix || '', /left of frame/);
});

test('an aligned verdict carries no prompt fix', () => {
  const verdict = parseVisualContinuityVerdict({ score: 95, summary: 'Clean', issues: [], promptFix: 'ignored', needsReverseAngle: false });
  assert.equal(verdict.status, 'aligned');
  assert.equal(verdict.promptFix, '');
  assert.equal(verdict.reverseYaw, null);
});

test('an empty or wrapped answer is not a score-0 verdict', () => {
  assert.equal(extractVerdictObject({}), null);
  assert.equal(extractVerdictObject(null), null);
  assert.equal(extractVerdictObject([{ score: 88, issues: [] }])?.score, 88);
  assert.equal(extractVerdictObject({ review: { score: 72 } })?.score, 72);
});
