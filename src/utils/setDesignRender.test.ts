import test from 'node:test';
import assert from 'node:assert/strict';

import {
  HDRI_IMPORT_ACCEPT,
  getRenderQualitySettings,
  buildSunPosition,
  clampRenderExposure,
  isSupportedHdriFile,
  mergeRenderPresetSettings,
  normalizeHdrUrl,
  resolveRenderSize,
} from './setDesignRender.ts';

test('buildSunPosition maps azimuth and elevation into a Three.js sun vector', () => {
  assert.deepEqual(buildSunPosition(90, 0, 10), { x: 10, y: 0, z: 0 });
  assert.deepEqual(buildSunPosition(0, 90, 10), { x: 0, y: 10, z: 0 });
});

test('clampRenderExposure keeps exposure inside a usable preview range', () => {
  assert.equal(clampRenderExposure(-1), 0.1);
  assert.equal(clampRenderExposure(9), 3);
  assert.equal(clampRenderExposure(1.35), 1.35);
});

test('normalizeHdrUrl only accepts common HDR environment formats', () => {
  assert.equal(normalizeHdrUrl(' https://example.com/studio.hdr?token=1 '), 'https://example.com/studio.hdr?token=1');
  assert.equal(normalizeHdrUrl('https://example.com/image.png'), '');
});

test('HDRI import accepts local HDR and EXR files', () => {
  assert.equal(HDRI_IMPORT_ACCEPT, '.hdr,.exr');
  assert.equal(isSupportedHdriFile('studio.HDR'), true);
  assert.equal(isSupportedHdriFile('lookdev.exr'), true);
  assert.equal(isSupportedHdriFile('preview.jpg'), false);
});

test('getRenderQualitySettings returns progressively heavier render settings', () => {
  const realtime = getRenderQualitySettings('realtime');
  const cinematic = getRenderQualitySettings('cinematic');
  const final = getRenderQualitySettings('final');

  assert.equal(realtime.ambientOcclusion, false);
  assert.equal(cinematic.ambientOcclusion, true);
  assert.equal(final.maxPixelRatio >= cinematic.maxPixelRatio, true);
  assert.equal(final.bloomStrength > realtime.bloomStrength, true);
});

test('resolveRenderSize prevents zero-sized framebuffers', () => {
  assert.deepEqual(resolveRenderSize(0, -5), { width: 1, height: 1 });
  assert.deepEqual(resolveRenderSize(1280.8, 720.2), { width: 1281, height: 720 });
});

test('mergeRenderPresetSettings applies partial render presets safely', () => {
  const merged = mergeRenderPresetSettings(
    {
      renderQuality: 'realtime',
      exposure: 0.8,
      skyEnabled: true,
      sunEnabled: false,
      sunAzimuth: 20,
      sunElevation: 12,
      sunIntensity: 0.5,
      useHdriBackground: false,
    },
    {
      renderQuality: 'final',
      exposure: 9,
      skyEnabled: false,
      sunEnabled: true,
      sunAzimuth: 145,
      sunElevation: 32,
      sunIntensity: 1.2,
      useHdriBackground: true,
    }
  );

  assert.equal(merged.renderQuality, 'final');
  assert.equal(merged.exposure, 3);
  assert.equal(merged.skyEnabled, false);
  assert.equal(merged.sunEnabled, true);
  assert.equal(merged.sunAzimuth, 145);
  assert.equal(merged.sunElevation, 32);
  assert.equal(merged.sunIntensity, 1.2);
  assert.equal(merged.useHdriBackground, true);
});
