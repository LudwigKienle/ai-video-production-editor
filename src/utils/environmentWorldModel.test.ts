import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGeneratedWorldToEnvironmentReference,
  buildEnvironmentWorldPrompt,
  buildSetDesignAssetForEnvironmentWorld,
} from './environmentWorldModel.ts';
import type { ReferenceItem } from '../types.ts';

const environmentRef: ReferenceItem = {
  id: 'env-1',
  type: 'environment',
  name: 'Rainy rooftop market',
  description: 'Dense neon food stalls on a high-rise roof.',
  prompt: 'cinematic cyberpunk rooftop bazaar',
  imageUrl: null,
  isGenerating: false,
  environmentTimeOfDay: 'night',
  environmentCoverageZones: ['main food aisle', 'edge overlook'],
};

test('builds a world-model prompt from an environment reference', () => {
  const prompt = buildEnvironmentWorldPrompt(environmentRef, 'photoreal, anamorphic');

  assert.match(prompt, /persistent explorable 3D environment/i);
  assert.match(prompt, /Rainy rooftop market/);
  assert.match(prompt, /night/i);
  assert.match(prompt, /main food aisle/);
  assert.match(prompt, /photoreal, anamorphic/);
});

test('stores generated world asset urls on the environment reference', () => {
  const next = applyGeneratedWorldToEnvironmentReference(environmentRef, {
    worldId: 'world-123',
    modelId: 'marble-1.1-plus',
    assets: {
      viewUrl: 'https://viewer.example/world',
      meshUrl: 'https://cdn.example/world.glb',
      panoramaUrl: 'https://cdn.example/world.jpg',
      thumbnailUrl: 'https://cdn.example/thumb.jpg',
    },
  });

  assert.equal(next.worldProvider, 'worldlabs');
  assert.equal(next.worldModelId, 'marble-1.1-plus');
  assert.equal(next.worldViewUrl, 'https://viewer.example/world');
  assert.equal(next.worldMeshUrl, 'https://cdn.example/world.glb');
  assert.equal(next.worldPanoramaUrl, 'https://cdn.example/world.jpg');
  assert.equal(next.worldThumbnailUrl, 'https://cdn.example/thumb.jpg');
  assert.equal(next.imageUrl, 'https://cdn.example/thumb.jpg');
  assert.equal(next.isGeneratingWorld, false);
  assert.equal(next.analysisNotes?.some((note) => note.startsWith('World Model:')), true);
});

test('builds a set design asset from a generated world mesh', () => {
  const asset = buildSetDesignAssetForEnvironmentWorld(environmentRef, 'https://cdn.example/world.glb');

  assert.equal(asset.kind, 'model');
  assert.equal(asset.format, 'glb');
  assert.equal(asset.url, 'https://cdn.example/world.glb');
  assert.equal(asset.name, 'Rainy rooftop market World Mesh');
});
