import test from 'node:test';
import assert from 'node:assert/strict';

import {
  applyGeneratedWorldToEnvironmentReference,
  buildEnvironmentWorldPrompt,
  buildSetDesignAssetForEnvironmentWorld,
  buildSetDesignAssetForEnvironmentBlockout,
  pickEnvironmentViews,
  pickReferenceImageForYaw,
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

test('picks the base image as front and the nearest eye-level angle for each side', () => {
  const views = pickEnvironmentViews({
    imageUrl: 'base.png',
    multiAngleMeta: [
      { id: 'a', url: 'master.png', yaw: 0, pitch: 0 },
      { id: 'b', url: 'left.png', yaw: -90, pitch: 0 },
      { id: 'c', url: 'right-ish.png', yaw: 70, pitch: 5 },
      { id: 'd', url: 'right.png', yaw: 95, pitch: 0 },
      { id: 'e', url: 'reverse.png', yaw: -175, pitch: 0 },
      { id: 'f', url: 'top.png', yaw: 180, pitch: 40 },
    ],
  });

  assert.deepEqual(views, { front: 'base.png', left: 'left.png', right: 'right.png', back: 'reverse.png' });
});

test('gives a diagonal angle to one side only', () => {
  const views = pickEnvironmentViews({
    imageUrl: 'base.png',
    multiAngleMeta: [{ id: 'a', url: 'diag.png', yaw: 135, pitch: 0 }],
  });

  assert.deepEqual(views, { front: 'base.png', right: 'diag.png' });
});

test('names a blockout asset after its engine', () => {
  const asset = buildSetDesignAssetForEnvironmentBlockout(environmentRef, 'https://cdn.example/mesh.glb', 'Hunyuan3D v3');

  assert.equal(asset.name, 'Rainy rooftop market Blockout (Hunyuan3D v3)');
  assert.equal(asset.format, 'glb');
  assert.equal(asset.kind, 'model');
});

test('uses the angle nearest to the shot yaw and falls back to the base image', () => {
  const reference = {
    imageUrl: 'base.png',
    multiAngleMeta: [
      { id: 'l', url: 'left.png', yaw: -90, pitch: 0 },
      { id: 'r', url: 'right.png', yaw: 90, pitch: 0 },
      { id: 't', url: 'top.png', yaw: 170, pitch: 40 },
    ],
  };
  assert.equal(pickReferenceImageForYaw(reference, 80), 'right.png');
  assert.equal(pickReferenceImageForYaw(reference, -100), 'left.png');
  assert.equal(pickReferenceImageForYaw(reference, 180), 'base.png');
  assert.equal(pickReferenceImageForYaw(reference, 0), 'base.png');
  assert.equal(pickReferenceImageForYaw(reference, undefined), 'base.png');
});

test('a party location keeps its crowd in new views; an empty office stays empty', async () => {
  const { environmentHasCrowd, environmentPeopleClause } = await import('./environmentWorldModel.ts');
  assert.equal(environmentHasCrowd('Penthouse ballroom, champagne tower, elegant guests in evening wear'), true);
  assert.equal(environmentHasCrowd('Glass office, desk, skyline at night'), false);
  assert.match(environmentPeopleClause('engagement party'), /crowd/);
  assert.equal(environmentPeopleClause('janitor closet with shelves'), 'empty set, no people');
});

test('a view rendered again for the same yaw wins over the older one', async () => {
  const { pickReferenceImageForYaw } = await import('./environmentWorldModel.ts');
  const ref = { imageUrl: 'base', multiAngleMeta: [{ id: 'a', url: 'old-180', yaw: 180, pitch: 0 }, { id: 'b', url: 'new-180', yaw: 180, pitch: 0 }] };
  assert.equal(pickReferenceImageForYaw(ref as never, 180), 'new-180');
  assert.equal(pickReferenceImageForYaw(ref as never, 0), 'base');
});

test('the yaw picker prefers the project copy of an angle over the provider link', async () => {
  const { pickReferenceImageForYaw } = await import('./environmentWorldModel.ts');
  const ref = { imageUrl: 'base', multiAngleUrls: ['file:///p/angle_1.png'], multiAngleMeta: [{ id: 'a', url: 'https://fal.media/x.png', yaw: 180, pitch: 0 }] };
  assert.equal(pickReferenceImageForYaw(ref as never, 175), 'file:///p/angle_1.png');
});
