import test from 'node:test';
import assert from 'node:assert/strict';

import { isModerationError, softenPromptForModeration, splitPromptParams } from './promptModeration.ts';

test('splitPromptParams keeps Midjourney parameters apart from the description', () => {
  const split = splitPromptParams('a knight at dawn --ar 16:9 --v 8.2 --style raw');
  assert.equal(split.body, 'a knight at dawn');
  assert.equal(split.params, '--ar 16:9 --v 8.2 --style raw');
});

test('level 1 swaps risky words but keeps the parameters', () => {
  const out = softenPromptForModeration('A bloody battlefield, corpses in the mud, a soldier bleeding --ar 21:9 --v 8.2', 1);
  assert.doesNotMatch(out, /bloody|corpses|bleeding/i);
  assert.match(out, /--ar 21:9 --v 8.2$/);
});

test('young characters never keep undressed base-sheet wording', () => {
  const out = softenPromptForModeration('character sheet of a 9 year old girl, T-pose in plain underwear, neutral grey background --ar 3:4', 1);
  assert.doesNotMatch(out, /underwear/i);
  assert.match(out, /t-shirt and shorts/i);
});

test('level 2 drops sentences that still carry risky words and adds a --no list', () => {
  const out = softenPromptForModeration('A quiet village street at dusk. A brutal murder scene with a gun. Soft lantern light. --ar 16:9 --no people', 2);
  assert.doesNotMatch(out, /murder|gun/i);
  assert.match(out, /village street/i);
  assert.match(out, /--no people, blood, gore, nudity, text, watermark/);
});

test('isModerationError recognises Jeff and Midjourney wording', () => {
  assert.equal(isModerationError(new Error('[moderated] Midjourney blocked the prompt: Banned prompt detected')), true);
  assert.equal(isModerationError(new Error('Midjourney did not finish within 10 minutes')), false);
});
