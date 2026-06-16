import test from 'node:test';
import assert from 'node:assert/strict';

import {
  appendConceptReferenceToShotContext,
  buildShotContextReferenceFromConcept,
} from './shotContextComposer.ts';
import type { ReferenceItem, ShotPrompt } from '../types.ts';

const character: ReferenceItem = {
  id: 'char-ada',
  type: 'character',
  name: 'Ada',
  description: 'Lead actor',
  prompt: '',
  imageUrl: 'data:image/png;base64,char',
  isGenerating: false,
};

const worldEnvironment: ReferenceItem = {
  id: 'env-market',
  type: 'environment',
  name: 'Night Market',
  description: '',
  prompt: '',
  imageUrl: 'data:image/png;base64,env',
  worldThumbnailUrl: 'data:image/png;base64,worldthumb',
  worldPanoramaUrl: 'data:image/png;base64,worldpano',
  isGenerating: false,
};

const shot: ShotPrompt = {
  shot: 4,
  prompt: 'Ada enters the market',
  description: 'Ada enters the market',
  characters: [],
  environment: null,
};

test('builds typed shot context from a character reference', () => {
  const ctx = buildShotContextReferenceFromConcept(character, 4);

  assert.equal(ctx.id, 'ctx-4-char-ada-wardrobe');
  assert.equal(ctx.name, 'Ada');
  assert.equal(ctx.tag, 'wardrobe');
  assert.equal(ctx.purpose, 'Integrate this character identity, face, wardrobe, and performance continuity.');
  assert.equal(ctx.imageUrl, character.imageUrl);
});

test('prefers world imagery for environment context', () => {
  const ctx = buildShotContextReferenceFromConcept(worldEnvironment, 4, 'world');

  assert.equal(ctx.id, 'ctx-4-env-market-world');
  assert.equal(ctx.tag, 'lighting');
  assert.equal(ctx.imageUrl, worldEnvironment.worldThumbnailUrl);
  assert.match(ctx.purpose, /World camera/);
});

test('appends context references without duplicating existing concept anchors', () => {
  const once = appendConceptReferenceToShotContext(shot, character);
  const twice = appendConceptReferenceToShotContext(once, character);

  assert.equal(twice.contextReferences?.length, 1);
  assert.equal(twice.contextReferences?.[0].name, 'Ada');
});
