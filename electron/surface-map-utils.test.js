const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildSurfaceMapJobNames,
  buildSurfaceMapProcessingPayload,
  mimeTypeToExtension,
  normalizeSurfaceMapOptions,
  sanitizeSurfaceMapBaseName,
} = require('./surface-map-utils');

test('surface map image extensions stay image-safe', () => {
  assert.equal(mimeTypeToExtension('image/png'), 'png');
  assert.equal(mimeTypeToExtension('image/jpeg'), 'jpg');
  assert.equal(mimeTypeToExtension('application/octet-stream', 'plate.webp'), 'webp');
  assert.equal(mimeTypeToExtension('application/octet-stream', 'plate.mov'), 'png');
});

test('surface map job names are stable and filesystem-safe', () => {
  assert.deepEqual(buildSurfaceMapJobNames('Hero Plate 01!.jpg', 1700000000000, 'depth'), {
    jobName: 'Hero_Plate_01_depth_1700000000000',
    inputName: 'Input.jpg',
    outputName: 'Hero_Plate_01_depth_1700000000000.png',
  });
  assert.equal(sanitizeSurfaceMapBaseName('   '), 'surface');
});

test('surface map options normalize engine and model settings', () => {
  const options = normalizeSurfaceMapOptions({
    kind: 'bad',
    engine: 'bad-engine',
    encoder: 'giant',
    inputSize: 99999,
    normalStrength: 12,
  });

  assert.equal(options.kind, 'depth');
  assert.equal(options.engine, 'depth-anything-v2');
  assert.equal(options.encoder, 'vits');
  assert.equal(options.inputSize, 2048);
  assert.equal(options.normalStrength, 8);
});

test('surface map processing payload keeps project and repository paths explicit', () => {
  const payload = buildSurfaceMapProcessingPayload({
    repoPath: '/models/Depth-Anything-V2',
    projectPath: '/project',
    source: { name: 'Plate.png', mimeType: 'image/png', base64: 'abc' },
    options: {
      kind: 'normal',
      engine: 'depth-gradient',
      normalStrength: 2.5,
    },
  });

  assert.equal(payload.repoPath, '/models/Depth-Anything-V2');
  assert.equal(payload.projectPath, '/project');
  assert.equal(payload.options.kind, 'normal');
  assert.equal(payload.options.engine, 'depth-gradient');
  assert.equal(payload.options.normalStrength, 2.5);
});
