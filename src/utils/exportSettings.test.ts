import test from 'node:test';
import assert from 'node:assert/strict';

test('quick export normalizes output to a supported WebM file', async () => {
  const { getQuickExportFormat, normalizeExportSettings } = await import('./exportSettings.ts');

  const format = getQuickExportFormat((mime: string) => mime === 'video/webm;codecs=vp8');

  assert.deepEqual(format, {
    mimeType: 'video/webm;codecs=vp8',
    extension: 'webm',
    videoCodec: 'vp8',
  });

  const settings = normalizeExportSettings({
    filename: 'Client Review.mp4',
    width: 1920,
    height: 1080,
    fps: 30,
    bitrateKbps: 12000,
    useFfmpeg: false,
    container: 'mp4',
    videoCodec: 'h264',
    bitDepth: 8,
    colorProfile: 'source',
  }, { quickFormat: format });

  assert.equal(settings.filename, 'Client Review.webm');
  assert.equal(settings.container, 'webm');
  assert.equal(settings.videoCodec, 'vp8');
  assert.equal(settings.mimeType, 'video/webm;codecs=vp8');
});

test('hq export applies codec container and bit depth constraints', async () => {
  const { normalizeExportSettings } = await import('./exportSettings.ts');

  const settings = normalizeExportSettings({
    filename: 'Final Master.mp4',
    width: 3840,
    height: 2160,
    fps: 24,
    bitrateKbps: 64000,
    useFfmpeg: true,
    container: 'mp4',
    videoCodec: 'prores',
    bitDepth: 8,
    colorProfile: 'rec709',
  });

  assert.equal(settings.filename, 'Final Master.mov');
  assert.equal(settings.container, 'mov');
  assert.equal(settings.videoCodec, 'prores');
  assert.equal(settings.bitDepth, 10);
  assert.equal(settings.mimeType, undefined);
});

test('export filenames are sanitized before download or desktop render', async () => {
  const { normalizeExportSettings } = await import('./exportSettings.ts');

  const settings = normalizeExportSettings({
    filename: '../bad/name?.mp4',
    width: 10,
    height: 10,
    fps: 0,
    bitrateKbps: 100,
    useFfmpeg: true,
    container: 'mp4',
    videoCodec: 'h264',
    bitDepth: 12,
    colorProfile: 'source',
  });

  assert.equal(settings.filename, 'bad-name.mp4');
  assert.equal(settings.width, 16);
  assert.equal(settings.height, 16);
  assert.equal(settings.fps, 1);
  assert.equal(settings.bitrateKbps, 500);
  assert.equal(settings.bitDepth, 10);
});
