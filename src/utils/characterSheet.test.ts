import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCharacterSheetPrompt,
  buildClaySculptPrompt,
  buildCreatureCombinePrompt,
  buildMaterialSwatchPrompt,
  isCreatureReference,
} from './characterSheet.ts';

test('character sheet: three views, face only in the close-up', () => {
  const prompt = buildCharacterSheetPrompt({ name: 'Mara', identity: 'woman, 30s, long brown hair', outfit: 'turquoise cardigan, plaid skirt' });
  assert.match(prompt, /Left third: full-body front view/);
  assert.match(prompt, /face in this view is hidden/);
  assert.match(prompt, /Middle third: full-body back view/);
  assert.match(prompt, /Right third: front close-up portrait/);
  assert.match(prompt, /mid-grey/);
  assert.match(prompt, /turquoise cardigan, plaid skirt\./);
});

test('character sheet: a base image becomes the identity source', () => {
  const prompt = buildCharacterSheetPrompt({ name: 'Mara', identity: 'ignored', hasBaseImage: true });
  assert.match(prompt, /exact person in the reference image \(Mara\)/);
  assert.doesNotMatch(prompt, /ignored/);
});

test('creature detection uses tags and wording', () => {
  assert.equal(isCreatureReference({ tags: ['Creature'] }), true);
  assert.equal(isCreatureReference({ description: 'A cave troll with a club' }), true);
  assert.equal(isCreatureReference({ description: 'Ein Dämon aus Rauch' }), true);
  assert.equal(isCreatureReference({ description: 'A retired fisherman in his 60s' }), false);
});

test('clay sculpt keeps colour out', () => {
  const prompt = buildClaySculptPrompt('a bear-wolf warlord', 'boar tusks, topknot');
  assert.match(prompt, /grey plasteline clay/);
  assert.match(prompt, /Sculpted features: boar tusks, topknot\./);
  assert.match(prompt, /No colour/);
});

test('material swatch fills the frame', () => {
  assert.match(buildMaterialSwatchPrompt('weathered cattle skull bone'), /^Extreme macro photograph of weathered cattle skull bone, the material filling the whole frame/);
});

test('combine prompt numbers images: clay, face, then materials in order', () => {
  const prompt = buildCreatureCombinePrompt({
    concept: 'a demon king, half bear half wolf',
    shapeDetails: 'heavy brow, boar tusks',
    hasFace: true,
    faceSource: 'American black bear',
    bodyCovering: 'grey-brown grizzly fur',
    materials: [{ part: 'shoulder skulls', material: 'weathered skull bone' }, { part: 'chest plate', material: 'carved antler' }],
    extraParts: 'a cloak of trophy pelts',
  });
  assert.match(prompt, /Image 1 is the shape/);
  assert.match(prompt, /Image 2 is the face: the real American black bear/);
  assert.match(prompt, /Image 3 is the real material for the shoulder skulls/);
  assert.match(prompt, /chest plate is made of real carved antler copied from image 4/);
  assert.match(prompt, /Part 4 — pieces that were never sculpted: a cloak of trophy pelts\./);
  assert.match(prompt, /makeup test/);
});

test('combine prompt without a face starts materials at image 2', () => {
  const prompt = buildCreatureCombinePrompt({ concept: 'a sea-urchin fairy', hasFace: false, materials: [{ part: 'armour', material: 'sea urchin shell' }], photoStyle: 'phone-flash' });
  assert.match(prompt, /Image 2 is the real material for the armour/);
  assert.doesNotMatch(prompt, /is the face/);
  assert.match(prompt, /phone snapshot/);
});
