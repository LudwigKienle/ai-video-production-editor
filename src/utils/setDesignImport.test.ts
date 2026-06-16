import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MODEL_IMPORT_ACCEPT,
  isSupportedModelExtension,
} from './setDesignImport.ts';

test('MODEL_IMPORT_ACCEPT includes all supported 3D model formats', () => {
  assert.equal(MODEL_IMPORT_ACCEPT, '.glb,.gltf,.fbx,.obj');
});

test('isSupportedModelExtension accepts file extensions case-insensitively', () => {
  assert.equal(isSupportedModelExtension('Chair.GLB'), true);
  assert.equal(isSupportedModelExtension('set.obj'), true);
  assert.equal(isSupportedModelExtension('preview.png'), false);
});
