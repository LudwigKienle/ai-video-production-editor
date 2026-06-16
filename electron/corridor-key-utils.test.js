const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildCorridorKeyJobNames,
  buildCorridorKeyProcessingPayload,
  mimeTypeToExtension,
} = require('./corridor-key-utils');

test('mimeTypeToExtension maps common CorridorKey video inputs', () => {
  assert.equal(mimeTypeToExtension('video/mp4'), 'mp4');
  assert.equal(mimeTypeToExtension('video/quicktime'), 'mov');
  assert.equal(mimeTypeToExtension('application/octet-stream'), 'mp4');
});

test('buildCorridorKeyJobNames creates stable safe names', () => {
  assert.deepEqual(buildCorridorKeyJobNames('Green Screen Take 03.mov', 1700000000000), {
    clipName: 'Green_Screen_Take_03_corridorkey_1700000000000',
    sourceName: 'Input.mov',
    alphaName: 'AlphaHint.mp4',
  });
});

test('buildCorridorKeyProcessingPayload clamps inference options', () => {
  const payload = buildCorridorKeyProcessingPayload({
    source: { name: 'Plate.mov', mimeType: 'video/quicktime', base64: 'abc' },
    alpha: { name: 'Mask.mp4', mimeType: 'video/mp4', base64: 'def' },
    options: {
      device: 'cuda',
      backend: 'mlx',
      inputColorSpace: 'linear',
      despill: 99,
      autoDespeckle: false,
      despeckleSize: -50,
      refiner: 9,
      imageSize: 999,
      maxFrames: -5,
      generateComp: false,
    },
  });

  assert.equal(payload.options.device, 'cuda');
  assert.equal(payload.options.backend, 'mlx');
  assert.equal(payload.options.inputColorSpace, 'linear');
  assert.equal(payload.options.despill, 10);
  assert.equal(payload.options.autoDespeckle, false);
  assert.equal(payload.options.despeckleSize, 0);
  assert.equal(payload.options.refiner, 4);
  assert.equal(payload.options.imageSize, 2048);
  assert.equal(payload.options.maxFrames, null);
  assert.equal(payload.options.generateComp, false);
});
