import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_WORLD_MODEL_ID,
  getWorldModelLabel,
  getWorldModelOptionsForProvider,
  isWorldModelSupportedInput,
  normalizeWorldModelId,
} from './worldModelProviderRegistry.ts';

test('normalizes legacy Marble labels to current World API model ids', () => {
  assert.equal(DEFAULT_WORLD_MODEL_ID, 'marble-1.1-plus');
  assert.equal(normalizeWorldModelId('Marble 0.1-plus'), 'marble-1.0');
  assert.equal(normalizeWorldModelId('Marble 0.1-mini'), 'marble-1.0-draft');
  assert.equal(normalizeWorldModelId('Marble 1.1 Plus'), 'marble-1.1-plus');
  assert.equal(normalizeWorldModelId('unknown-model'), DEFAULT_WORLD_MODEL_ID);
});

test('exposes current World Labs Marble models for environment generation', () => {
  const options = getWorldModelOptionsForProvider('worldlabs');

  assert.deepEqual(options.map((option) => option.id), [
    'marble-1.1-plus',
    'marble-1.1',
    'marble-1.0',
    'marble-1.0-draft',
  ]);
  assert.equal(getWorldModelLabel('marble-1.1-plus'), 'Marble 1.1 Plus');
  assert.equal(isWorldModelSupportedInput('marble-1.1', 'text'), true);
  assert.equal(isWorldModelSupportedInput('marble-1.1', 'image'), true);
  assert.equal(isWorldModelSupportedInput('marble-1.1', 'video'), true);
});
