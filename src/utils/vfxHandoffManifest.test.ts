import test from 'node:test';
import assert from 'node:assert/strict';

test('buildVfxHandoffManifest exports relinkable shot handles with OCIO and interchange references', async () => {
  const { buildVfxHandoffManifest } = await import('./vfxHandoffManifest.ts');

  const manifestText = buildVfxHandoffManifest({
    projectName: 'Film Cut',
    filename: 'film_cut_v003.mov',
    fps: 24,
    width: 2048,
    height: 858,
    colorProfile: 'rec2020-pq',
    bitDepth: 12,
    videoCodec: 'prores',
    container: 'mov',
    ocioConfigId: 'custom',
    ocioConfigPath: '/show/config/aces/shot.ocio',
    handleFrames: 12,
    mediaItems: [
      {
        id: 'plate',
        name: 'Plate.mov',
        type: 'video',
        url: 'blob:http://local/preview',
        sourceUrl: 'file:///show/plates/Plate.mov',
        source: 'upload',
        duration: 10,
      },
      {
        id: 'music',
        name: 'Music.wav',
        type: 'audio',
        url: 'https://cdn.example.com/Music.wav',
        source: 'upload',
        duration: 4,
      },
      {
        id: 'preview-only',
        name: 'Preview.mov',
        type: 'video',
        url: 'blob:http://local/preview-only',
        source: 'generated',
        duration: 1,
      },
    ],
    timelineTracks: [
      { id: 'v1', name: 'VFX Pull V1', type: 'video', isLocked: false, isMuted: false },
      { id: 'a1', name: 'Mix A1', type: 'audio', isLocked: false, isMuted: false },
      { id: 'v2', name: 'Muted V2', type: 'video', isLocked: false, isMuted: true },
    ],
    timelineClips: [
      {
        id: 'shot-010',
        mediaId: 'plate',
        trackId: 'v1',
        start: 0.5,
        end: 2.5,
        duration: 2,
        sourceIn: 1,
        sourceOut: 3,
        speed: 1,
        blendMode: 'screen',
        effect: null,
      },
      {
        id: 'music-clip',
        mediaId: 'music',
        trackId: 'a1',
        start: 0,
        end: 4,
        duration: 4,
        speed: 1,
        effect: null,
      },
      {
        id: 'muted-preview',
        mediaId: 'preview-only',
        trackId: 'v2',
        start: 0,
        end: 1,
        duration: 1,
        speed: 1,
        effect: null,
      },
    ],
  });

  const manifest = JSON.parse(manifestText);
  assert.equal(manifest.schema, 'ai-video-production-editor.vfx-handoff.v1');
  assert.equal(manifest.project.name, 'Film Cut');
  assert.equal(manifest.project.fps, 24);
  assert.equal(manifest.project.timelineDurationFrames, 96);
  assert.deepEqual(manifest.interchange, {
    openTimelineIO: 'film_cut_v003.otio',
    finalCutProXml: 'film_cut_v003.fcpxml',
    openColorIOManifest: 'film_cut_v003.ocio.json',
  });

  assert.equal(manifest.color.openColorIO.configId, 'custom');
  assert.equal(manifest.color.openColorIO.configPath, '/show/config/aces/shot.ocio');
  assert.equal(manifest.color.openColorIO.display, 'Rec.2100-PQ');
  assert.equal(manifest.color.ffmpegTags.colorTransfer, 'smpte2084');

  assert.deepEqual(manifest.media.map((item) => ({
    id: item.id,
    sourceUrl: item.sourceUrl,
    clipIds: item.clipIds,
    relinkStatus: item.relinkStatus,
  })), [
    {
      id: 'plate',
      sourceUrl: 'file:///show/plates/Plate.mov',
      clipIds: ['shot-010'],
      relinkStatus: 'ready',
    },
    {
      id: 'music',
      sourceUrl: 'https://cdn.example.com/Music.wav',
      clipIds: ['music-clip'],
      relinkStatus: 'ready',
    },
  ]);

  assert.deepEqual(manifest.shots.map((shot) => ({
    clipId: shot.clipId,
    trackName: shot.trackName,
    sourceUrl: shot.sourceUrl,
    timelineStartFrame: shot.timeline.startFrame,
    timelineEndFrame: shot.timeline.endFrame,
    sourceHandleInFrame: shot.source.handleInFrame,
    sourceHandleOutFrame: shot.source.handleOutFrame,
    blendMode: shot.blendMode,
  })), [
    {
      clipId: 'music-clip',
      trackName: 'Mix A1',
      sourceUrl: 'https://cdn.example.com/Music.wav',
      timelineStartFrame: 0,
      timelineEndFrame: 96,
      sourceHandleInFrame: 0,
      sourceHandleOutFrame: 96,
      blendMode: 'normal',
    },
    {
      clipId: 'shot-010',
      trackName: 'VFX Pull V1',
      sourceUrl: 'file:///show/plates/Plate.mov',
      timelineStartFrame: 12,
      timelineEndFrame: 60,
      sourceHandleInFrame: 12,
      sourceHandleOutFrame: 84,
      blendMode: 'screen',
    },
  ]);

  assert.equal(manifest.warnings.length, 0);
  assert.equal(JSON.stringify(manifest, null, 2), manifestText);
});

test('buildVfxHandoffManifest reports clips with preview-only media as relink warnings', async () => {
  const { buildVfxHandoffManifest } = await import('./vfxHandoffManifest.ts');

  const manifest = JSON.parse(buildVfxHandoffManifest({
    filename: 'handoff.mov',
    fps: 25,
    width: 1920,
    height: 1080,
    colorProfile: 'source',
    bitDepth: 8,
    videoCodec: 'h264',
    container: 'mp4',
    mediaItems: [
      { id: 'preview', name: 'Preview.mov', type: 'video', url: 'blob:http://local/preview', source: 'generated', duration: 2 },
    ],
    timelineTracks: [
      { id: 'v1', name: 'V1', type: 'video', isLocked: false, isMuted: false },
    ],
    timelineClips: [
      { id: 'c1', mediaId: 'preview', trackId: 'v1', start: 0, end: 2, duration: 2, speed: 1, effect: null },
    ],
  }));

  assert.equal(manifest.media[0].relinkStatus, 'missing-source');
  assert.equal(manifest.shots[0].relinkStatus, 'missing-source');
  assert.match(manifest.warnings[0], /Preview.mov/);
});
