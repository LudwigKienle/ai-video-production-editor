import test from 'node:test';
import assert from 'node:assert/strict';

import { formatSmartModelEta, routeSmartModel } from './smartModelRouter.ts';

const candidates = [
  {
    id: 'quality-product',
    label: 'Quality Product',
    provider: 'fal',
    quality: 9,
    speed: 5,
    costEfficiency: 4,
    strengths: ['photoreal', 'product', 'commercial'],
  },
  {
    id: 'fast-preview',
    label: 'Fast Preview',
    provider: 'replicate',
    quality: 5,
    speed: 10,
    costEfficiency: 8,
    strengths: ['preview', 'draft'],
  },
  {
    id: 'balanced-good',
    label: 'Balanced Good',
    provider: 'replicate',
    quality: 7,
    speed: 7,
    costEfficiency: 7,
    strengths: ['balanced', 'product'],
  },
  {
    id: 'cheap-variation',
    label: 'Cheap Variation',
    provider: 'replicate',
    quality: 4,
    speed: 8,
    costEfficiency: 10,
    strengths: ['variation', 'cheap'],
    supportsReferences: true,
  },
];

test('routes photoreal product goals toward quality and commercial realism', () => {
  const route = routeSmartModel({
    goal: 'realistischer Produktshot',
    candidates,
    availableProviders: ['fal', 'replicate'],
    hasReferences: false,
  });

  assert.equal(route.selected.id, 'quality-product');
  assert.equal(route.intent, 'quality');
  assert.match(route.reason, /quality/i);
});

test('routes preview goals toward fastest viable model', () => {
  const route = routeSmartModel({
    goal: 'schnelle Vorschau',
    candidates,
    availableProviders: ['fal', 'replicate'],
    hasReferences: false,
  });

  assert.equal(route.selected.id, 'fast-preview');
  assert.equal(route.intent, 'speed');
});

test('routes cheap variation goals toward low cost reference-friendly models', () => {
  const route = routeSmartModel({
    goal: 'billige Variation',
    candidates,
    availableProviders: ['fal', 'replicate'],
    hasReferences: true,
  });

  assert.equal(route.selected.id, 'cheap-variation');
  assert.equal(route.intent, 'cost');
  assert.equal(route.scoreBreakdown.referenceBonus > 0, true);
});

test('falls back to the best available provider when the top match is unavailable', () => {
  const route = routeSmartModel({
    goal: 'realistischer Produktshot',
    candidates,
    availableProviders: ['replicate'],
    hasReferences: false,
  });

  assert.notEqual(route.selected.id, 'quality-product');
  assert.equal(route.selected.provider, 'replicate');
});

test('skips reference-only candidates when no references are present', () => {
  const route = routeSmartModel({
    goal: 'billige Variation',
    candidates: [
      {
        id: 'reference-only-cheap',
        label: 'Reference Only Cheap',
        provider: 'replicate',
        quality: 5,
        speed: 9,
        costEfficiency: 10,
        strengths: ['variation', 'cheap'],
        supportsReferences: true,
        requiresReferences: true,
      },
      ...candidates,
    ],
    availableProviders: ['replicate'],
    hasReferences: false,
  });

  assert.notEqual(route.selected.id, 'reference-only-cheap');
});

test('formats model ETA as compact seconds and minute ranges', () => {
  assert.equal(formatSmartModelEta({ minSeconds: 18, maxSeconds: 24 }), '~20s');
  assert.equal(formatSmartModelEta({ minSeconds: 80, maxSeconds: 100 }), '~90s');
  assert.equal(formatSmartModelEta({ minSeconds: 180, maxSeconds: 300 }), '3-5 min');
});
