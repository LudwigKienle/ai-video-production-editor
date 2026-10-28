import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTakeComparisonPrompt, buildVideoReviewPrompt, computeVideoReviewScore, extractDialogueLine, isPopulatedShot, mergeVideoReviews,
  normalizeTenScale, parseTakeComparison, parseVideoReview, pickBestTake, shotTakes, weightedVideoScore,
} from './videoReview.ts';
import type { ShotVideoReview, ShotVideoReviewScores } from '../types';

const allScores = (value: number | null): ShotVideoReviewScores => ({ visualQuality: value, animation: value, cameraMotion: value, backgroundMotion: value, consistency: value, lipSync: value, audio: value });
const review = (videoUrl: string, score: number, summary = ''): ShotVideoReview => ({
  videoUrl, score, verdict: score >= 8 ? 'keep' : score >= 6 ? 'usable' : 'reshoot', scores: allScores(score), frozenBackground: false, summary, issues: [], reviewedAt: '2026-10-24T10:00:00.000Z',
});

test('the review prompt carries the dialogue line, the populated-scene rule and the reference list', () => {
  const prompt = buildVideoReviewPrompt(
    { label: '1.3', description: 'Nora crosses the gala', characters: ['Nora Vale'], environment: 'Ballroom', dialogue: 'You came after all.', populated: true, cameraMove: 'slow dolly in' },
    [{ label: 'Nora Vale — character reference' }],
  );
  assert.match(prompt, /"You came after all\."/);
  assert.match(prompt, /background people must stay alive/);
  assert.match(prompt, /mannequins/);
  assert.match(prompt, /Image 1: Nora Vale — character reference/);
  assert.match(prompt, /slow dolly in/);
  assert.match(prompt, /animation — how the CHARACTERS move/);
});

test('the comparison prompt numbers the takes', () => {
  const prompt = buildTakeComparisonPrompt({ label: '2', description: 'x', characters: [] }, ['v1 (selected)', 'v2']);
  assert.match(prompt, /Video 1: v1 \(selected\)\nVideo 2: v2/);
  assert.match(prompt, /bestTake/);
});

test('scores are normalised to 0–10: 0–100 answers scale down, -1 and junk mean "not applicable"', () => {
  assert.equal(normalizeTenScale(7.46), 7.5);
  assert.equal(normalizeTenScale(82), 8.2);
  assert.equal(normalizeTenScale('6'), 6);
  assert.equal(normalizeTenScale(-1), null);
  assert.equal(normalizeTenScale(null), null);
  assert.equal(normalizeTenScale('n/a'), null);
  assert.equal(normalizeTenScale(true), null);
  assert.equal(normalizeTenScale(500), 10);
});

test('the weighted score skips dimensions that do not apply', () => {
  assert.equal(weightedVideoScore({ ...allScores(null), visualQuality: 8, animation: 6 }), 7);
  assert.equal(weightedVideoScore(allScores(null)), null);
});

test('frozen backgrounds, high issues and a very weak dimension cap an optimistic overall score', () => {
  assert.equal(computeVideoReviewScore({ modelScore: 9, scores: allScores(9), issues: [], frozenBackground: false }), 9);
  assert.equal(computeVideoReviewScore({ modelScore: 9, scores: allScores(9), issues: [], frozenBackground: true }), 6);
  assert.equal(computeVideoReviewScore({ modelScore: 9, scores: allScores(9), issues: [{ category: 'artifact', severity: 'high', message: 'extra hand' }], frozenBackground: false }), 5.5);
  assert.equal(computeVideoReviewScore({ modelScore: 9, scores: { ...allScores(9), lipSync: 2 }, issues: [], frozenBackground: false }), 4.5);
  // The model's number may not float far above its own sub-scores.
  assert.equal(computeVideoReviewScore({ modelScore: 10, scores: allScores(5), issues: [], frozenBackground: false }), 7);
  // No overall number: the weighted sub-scores stand in.
  assert.equal(computeVideoReviewScore({ modelScore: null, scores: { ...allScores(null), animation: 7 }, issues: [], frozenBackground: false }), 7);
});

test('a take review is parsed from a wrapped answer; frozen extras are detected from the sub-score', () => {
  const parsed = parseVideoReview({
    review: {
      score: 88,
      verdict: 'keep',
      scores: { visualQuality: 8, animation: 8, cameraMotion: 9, backgroundMotion: 2, consistency: 8, lipSync: -1, audio: 7 },
      summary: 'Strong lead, dead crowd.',
      issues: [
        { category: 'Background', severity: 'medium', message: 'Guests behind Nora do not move.', timestamp: '00:03' },
        { category: 'lipsync', severity: 'low', message: 'Slight lag.', timestamp: 'around 4s' },
        { category: 'artifact', message: '' },
      ],
      dialogueHeard: '  ',
      promptFix: 'Background guests keep chatting and shifting weight throughout.',
    },
  }, { videoUrl: 'file:///take1.mp4', model: 'gemini', reviewedAt: '2026-10-24T10:00:00.000Z' });
  assert.ok(parsed);
  assert.equal(parsed.frozenBackground, true);
  assert.equal(parsed.scores.lipSync, null);
  assert.equal(parsed.score, 4.5);
  assert.equal(parsed.verdict, 'reshoot');
  assert.equal(parsed.issues.length, 2);
  assert.equal(parsed.issues[0].category, 'background');
  assert.equal(parsed.issues[0].timestamp, '00:03');
  assert.equal(parsed.issues[1].category, 'lip_sync');
  assert.equal(parsed.issues[1].timestamp, undefined);
  assert.equal(parsed.dialogueHeard, undefined);
  assert.match(parsed.promptFix || '', /keep chatting/);
});

test('an empty or scoreless answer is no review, not "score 0"', () => {
  assert.equal(parseVideoReview(null, { videoUrl: 'a' }), null);
  assert.equal(parseVideoReview({ summary: 'hm' }, { videoUrl: 'a' }), null);
  assert.equal(parseVideoReview({ score: 'n/a', scores: { animation: -1 } }, { videoUrl: 'a' }), null);
});

test('comparisons keep valid, unique takes and re-rank them 1…n', () => {
  const parsed = parseTakeComparison([{ bestTake: 2, reason: 'Crowd moves.', ranking: [{ take: 2, rank: 1, reason: 'alive' }, { take: 9, rank: 2, reason: 'x' }, { take: 1, rank: 3, reason: 'frozen' }, { take: 2, rank: 4, reason: 'dup' }] }], 2);
  assert.deepEqual(parsed, { bestTake: 2, reason: 'Crowd moves.', ranking: [{ take: 2, rank: 1, reason: 'alive' }, { take: 1, rank: 2, reason: 'frozen' }] });
  assert.equal(parseTakeComparison({ bestTake: 5, ranking: [] }, 2), null);
  assert.equal(parseTakeComparison({ bestTake: 7, ranking: [{ take: 1, rank: 1, reason: 'only' }] }, 2)?.bestTake, 1);
});

test('the side-by-side pick stands unless the take scores show it clearly worse', () => {
  const takes = ['v1', 'v2', 'v3'];
  const reviews = [review('v1', 7.2), review('v2', 7.8, 'Best lip sync.'), review('v3', 6.5)];
  const kept = pickBestTake(takes, reviews, { bestTake: 1, reason: 'Most natural crowd.', ranking: [] }, { comparedAt: 't' });
  assert.equal(kept?.bestVideoUrl, 'v1');
  assert.equal(kept?.decidedBy, 'comparison');
  assert.deepEqual(kept?.ranking.map((entry) => entry.videoUrl), ['v2', 'v1', 'v3']);

  const overruled = pickBestTake(takes, [review('v1', 4), review('v2', 8.4, 'Clean.'), review('v3', 6)], { bestTake: 1, reason: 'x', ranking: [] });
  assert.equal(overruled?.bestVideoUrl, 'v2');
  assert.equal(overruled?.decidedBy, 'scores');
  assert.match(overruled?.reason || '', /8\.4\/10 against 4\/10/);
});

test('without a comparison the highest score wins, the newer take on a tie', () => {
  assert.equal(pickBestTake(['a', 'b'], [review('a', 7), review('b', 7)], null)?.bestVideoUrl, 'b');
  assert.equal(pickBestTake(['a', 'b'], [review('a', 8), review('b', 7)], null)?.bestVideoUrl, 'a');
  assert.equal(pickBestTake(['a'], [], null), null);
});

test('takes, merging and dialogue extraction', () => {
  assert.deepEqual(shotTakes({ videoUrl: 'c', videoVersions: ['a', 'b'] }), ['a', 'b', 'c']);
  assert.deepEqual(shotTakes({ videoUrl: 'a' }), ['a']);
  assert.deepEqual(shotTakes({}), []);
  const merged = mergeVideoReviews([review('a', 5), review('gone', 9)], [review('a', 7), review('b', 6)], ['a', 'b']);
  assert.deepEqual(merged.map((entry) => [entry.videoUrl, entry.score]), [['a', 7], ['b', 6]]);
  assert.equal(extractDialogueLine({ voiceoverText: ' Hello there. ', prompt: '' , description: '' }), 'Hello there.');
  assert.equal(extractDialogueLine({ motionPrompt: 'She turns and says “You came after all.” softly', prompt: '', description: '' }), 'You came after all.');
  assert.equal(extractDialogueLine({ prompt: 'A "neon" sign', description: '' }), null);
  assert.equal(isPopulatedShot({ prompt: 'Nora walks through the crowded gala', description: '', environment: null }), true);
  assert.equal(isPopulatedShot({ prompt: 'Close-up of a ring on a table', description: '', environment: null }), false);
});
