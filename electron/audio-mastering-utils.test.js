const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildAutoMasterPresetRequest,
  buildMasteredOutputName,
  buildProcessingPayload,
  buildUiPresetRequest,
  clampMasteringRequest,
} = require('./audio-mastering-utils');

test('clampMasteringRequest normalizes user macro ranges', () => {
  const request = clampMasteringRequest({
    compressionStrength: 99,
    stereoWidthPercent: -20,
    targetLufs: -40,
  });

  assert.equal(request.compressionStrength, 10);
  assert.equal(request.stereoWidthPercent, 0);
  assert.equal(request.targetLufs, -16);
});

test('buildMasteredOutputName creates mastered_24bit names', () => {
  assert.equal(
    buildMasteredOutputName('My Song.wav', 1700000000000),
    'My_Song_wav_mastered_24bit_1700000000000.wav'
  );
});

test('buildProcessingPayload keeps limiter ceiling and target LUFS in bounds', () => {
  const payload = buildProcessingPayload({
    compressionStrength: 0,
    stereoWidthPercent: 140,
    targetLufs: -7,
    advanced: {
      eqMatchAmount: 200,
      limiterCeilingDbtp: 0,
      lowMidCrossoverHz: 10,
      midHighCrossoverHz: 50000,
    },
  });

  assert.equal(payload.compressionStrength, 1);
  assert.equal(payload.stereoWidthPercent, 100);
  assert.equal(payload.targetLufs, -9);
  assert.equal(payload.advanced.eqMatchAmount, 100);
  assert.equal(payload.advanced.limiterCeilingDbtp, -0.1);
  assert.equal(payload.advanced.lowMidCrossoverHz, 40);
  assert.equal(payload.advanced.midHighCrossoverHz, 12000);
});

test('buildUiPresetRequest uses the documented defaults', () => {
  const request = buildUiPresetRequest();
  assert.equal(request.provider, 'local');
  assert.equal(request.compressionStrength, 5);
  assert.equal(request.stereoWidthPercent, 100);
  assert.equal(request.targetLufs, -14);
  assert.equal(request.advanced.eqMatchAmount, 100);
  assert.equal(request.advanced.limiterCeilingDbtp, -1);
});

test('buildAutoMasterPresetRequest defaults to spotify-safe settings', () => {
  const request = buildAutoMasterPresetRequest();
  assert.equal(request.mode, 'spotify_auto');
  assert.equal(request.provider, 'local');
  assert.equal(request.targetLufs, -14);
  assert.equal(request.advanced.limiterCeilingDbtp, -1);
});
