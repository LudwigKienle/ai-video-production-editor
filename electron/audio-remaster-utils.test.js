const test = require('node:test');
const assert = require('node:assert/strict');

const {
  buildRemasterFileNames,
  getMatcheringPythonPath,
  mimeTypeToExtension,
  sanitizeAudioBaseName,
} = require('./audio-remaster-utils');

test('mimeTypeToExtension maps common audio formats', () => {
  assert.equal(mimeTypeToExtension('audio/mpeg'), 'mp3');
  assert.equal(mimeTypeToExtension('audio/wav'), 'wav');
  assert.equal(mimeTypeToExtension('audio/x-wav'), 'wav');
  assert.equal(mimeTypeToExtension('audio/flac'), 'flac');
});

test('sanitizeAudioBaseName keeps filenames stable and filesystem-safe', () => {
  assert.equal(sanitizeAudioBaseName('Lead Vox V1!.wav'), 'Lead_Vox_V1_wav');
  assert.equal(sanitizeAudioBaseName('   '), 'audio');
});

test('buildRemasterFileNames derives master and preview names from a base title', () => {
  assert.deepEqual(buildRemasterFileNames('Lead Vox.wav', 1700000000000), {
    outputName: 'Lead_Vox_wav_matchering_1700000000000.wav',
    previewName: 'Lead_Vox_wav_matchering_preview_1700000000000.wav',
  });
});

test('getMatcheringPythonPath resolves inside the venv layout for the current platform', () => {
  const resolved = getMatcheringPythonPath('/tmp/matchering-env');
  const expectedTail = process.platform === 'win32' ? 'Scripts\\python.exe' : 'bin/python';
  assert.equal(resolved.endsWith(expectedTail), true);
});
