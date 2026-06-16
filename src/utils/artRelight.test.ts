import test from 'node:test';
import assert from 'node:assert/strict';

import {
  getArtRelightTint,
  normalizeArtRelightSettings,
  normalizeArtRelightSurfaceMode,
  relightPixelBuffer,
  type ArtRelightSettings,
} from './artRelight.ts';

test('normalizes art relight controls into safe Resolve-style ranges', () => {
  const settings = normalizeArtRelightSettings({
    lightX: 1.8,
    lightY: -0.4,
    height: -3,
    radius: 8,
    intensity: 12,
    ambient: -1,
    surfaceStrength: 99,
    warmth: 180,
    blendMode: 'bad-mode',
  } as Partial<ArtRelightSettings>);

  assert.equal(settings.lightX, 1);
  assert.equal(settings.lightY, 0);
  assert.equal(settings.height, 0.05);
  assert.equal(settings.radius, 2);
  assert.equal(settings.intensity, 4);
  assert.equal(settings.ambient, 0);
  assert.equal(settings.surfaceStrength, 6);
  assert.equal(settings.warmth, 100);
  assert.equal(settings.blendMode, 'screen');
});

test('warm art relight tint favors red while cool tint favors blue', () => {
  const warm = getArtRelightTint(80);
  const cool = getArtRelightTint(-80);

  assert.equal(warm.r > warm.b, true);
  assert.equal(cool.b > cool.r, true);
  assert.equal(warm.g > 0.8 && cool.g > 0.8, true);
});

test('relightPixelBuffer brightens pixels near the light more than far pixels', () => {
  const source = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      80, 80, 80, 255,
      80, 80, 80, 255,
      80, 80, 80, 255,
    ]),
  };

  const result = relightPixelBuffer(source, normalizeArtRelightSettings({
    lightX: 0,
    lightY: 0,
    height: 0.2,
    radius: 0.35,
    intensity: 1.8,
    ambient: 0,
    surfaceStrength: 0,
    blendMode: 'add',
    warmth: 0,
  }));

  assert.equal(result.width, 3);
  assert.equal(result.height, 1);
  assert.equal(result.data[3], 255);
  assert.equal(result.data[0] > source.data[0], true);
  assert.equal(result.data[0] > result.data[8], true);
});

test('screen relight preserves alpha and does not darken source pixels', () => {
  const source = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([120, 80, 40, 128]),
  };

  const result = relightPixelBuffer(source, normalizeArtRelightSettings({
    lightX: 0.5,
    lightY: 0.5,
    height: 0.4,
    radius: 1,
    intensity: 1,
    ambient: 0.15,
    blendMode: 'screen',
  }));

  assert.equal(result.data[3], 128);
  assert.equal(result.data[0] >= source.data[0], true);
  assert.equal(result.data[1] >= source.data[1], true);
  assert.equal(result.data[2] >= source.data[2], true);
});

test('normalizes unknown surface guide modes back to source luminance', () => {
  assert.equal(normalizeArtRelightSurfaceMode('depth'), 'depth');
  assert.equal(normalizeArtRelightSurfaceMode('normal'), 'normal');
  assert.equal(normalizeArtRelightSurfaceMode('bad-mode'), 'source');
});

test('normal map guides can reduce light when normals face away from camera light', () => {
  const source = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([80, 80, 80, 255]),
  };
  const awayNormal = {
    width: 1,
    height: 1,
    data: new Uint8ClampedArray([128, 128, 0, 255]),
  };
  const settings = normalizeArtRelightSettings({
    lightX: 0.5,
    lightY: 0.5,
    height: 0.5,
    radius: 1,
    intensity: 2,
    ambient: 0,
    surfaceStrength: 0,
    blendMode: 'add',
    warmth: 0,
  });

  const unguided = relightPixelBuffer(source, settings);
  const guided = relightPixelBuffer(source, settings, {
    surface: awayNormal,
    surfaceMode: 'normal',
  });

  assert.equal(guided.data[3], 255);
  assert.equal(unguided.data[0] > guided.data[0], true);
  assert.equal(guided.data[0], source.data[0]);
});

test('depth guide luminance controls surface gradients independently of source luma', () => {
  const source = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      80, 80, 80, 255,
      80, 80, 80, 255,
      80, 80, 80, 255,
    ]),
  };
  const depth = {
    width: 3,
    height: 1,
    data: new Uint8ClampedArray([
      0, 0, 0, 255,
      255, 255, 255, 255,
      255, 255, 255, 255,
    ]),
  };
  const settings = normalizeArtRelightSettings({
    lightX: 0,
    lightY: 0,
    height: 0.2,
    radius: 2,
    intensity: 0.4,
    ambient: 0,
    surfaceStrength: 4,
    blendMode: 'add',
    warmth: 0,
  });

  const unGuided = relightPixelBuffer(source, settings);
  const depthGuided = relightPixelBuffer(source, settings, {
    surface: depth,
    surfaceMode: 'depth',
  });

  assert.notEqual(depthGuided.data[4], unGuided.data[4]);
});
