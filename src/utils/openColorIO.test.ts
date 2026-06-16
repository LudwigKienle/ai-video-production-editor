import test from 'node:test';
import assert from 'node:assert/strict';

test('buildOpenColorIOManifest maps export color tags to a portable ACES handoff manifest', async () => {
  const { buildOpenColorIOManifest } = await import('./openColorIO.ts');

  const manifestText = buildOpenColorIOManifest({
    projectName: 'Client & Cut',
    filename: 'Final Master.mov',
    width: 3840,
    height: 2160,
    fps: 24,
    colorProfile: 'rec2020-pq',
    bitDepth: 10,
    videoCodec: 'prores',
    container: 'mov',
  });

  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.schema, 'ai-video-production-editor.open-color-io-manifest.v1');
  assert.equal(manifest.project.name, 'Client & Cut');
  assert.equal(manifest.delivery.colorProfile, 'rec2020-pq');
  assert.equal(manifest.openColorIO.configFamily, 'ACES');
  assert.equal(manifest.openColorIO.view, 'ACES 1.0 - HDR Video');
  assert.equal(manifest.openColorIO.display, 'Rec.2100-PQ');
  assert.equal(manifest.openColorIO.outputColorSpace, 'Output - Rec.2100-PQ');
  assert.equal(manifest.ffmpegTags.colorPrimaries, 'bt2020');
  assert.equal(manifest.ffmpegTags.colorTransfer, 'smpte2084');
  assert.equal(JSON.stringify(manifest, null, 2), manifestText);
});

test('resolveOpenColorIOProfile keeps source handoff conservative', async () => {
  const { resolveOpenColorIOProfile } = await import('./openColorIO.ts');

  const profile = resolveOpenColorIOProfile('source');

  assert.equal(profile.inputColorSpace, 'Utility - Raw');
  assert.equal(profile.outputColorSpace, 'Source tagged by media metadata');
  assert.equal(profile.ffmpegTags.colorspace, undefined);
});

test('buildOpenColorIOManifest records the selected OCIO config for downstream tools', async () => {
  const { OPEN_COLOR_IO_CONFIG_OPTIONS, buildOpenColorIOManifest, resolveOpenColorIOConfig } = await import('./openColorIO.ts');

  assert.ok(OPEN_COLOR_IO_CONFIG_OPTIONS.some((option) => option.id === 'aces-2.0-studio'));
  assert.ok(OPEN_COLOR_IO_CONFIG_OPTIONS.some((option) => option.id === 'custom'));

  const config = resolveOpenColorIOConfig('custom', '/show/config/shot.ocio');
  assert.equal(config.id, 'custom');
  assert.equal(config.path, '/show/config/shot.ocio');

  const manifest = JSON.parse(buildOpenColorIOManifest({
    projectName: 'Shot 020',
    filename: 'shot020_vfx.mov',
    width: 2048,
    height: 858,
    fps: 24,
    colorProfile: 'rec709',
    bitDepth: 10,
    videoCodec: 'prores',
    container: 'mov',
    ocioConfigId: 'custom',
    ocioConfigPath: '/show/config/shot.ocio',
  }));

  assert.equal(manifest.openColorIO.configId, 'custom');
  assert.equal(manifest.openColorIO.configName, 'Custom project OCIO config');
  assert.equal(manifest.openColorIO.configPath, '/show/config/shot.ocio');
  assert.equal(manifest.openColorIO.recommendedConfig, '/show/config/shot.ocio');
});
