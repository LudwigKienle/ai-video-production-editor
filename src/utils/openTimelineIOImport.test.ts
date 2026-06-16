import test from 'node:test';
import assert from 'node:assert/strict';

test('parseOpenTimelineIOToTimeline reconstructs tracks, media references, gaps, and source ranges', async () => {
  const { parseOpenTimelineIOToTimeline } = await import('./openTimelineIOImport.ts');

  const result = parseOpenTimelineIOToTimeline(JSON.stringify({
    OTIO_SCHEMA: 'Timeline.1',
    name: 'VFX Pull',
    metadata: {
      ai_video_editor: {
        fps: 24,
        width: 2048,
        height: 858,
      },
    },
    tracks: {
      OTIO_SCHEMA: 'Stack.1',
      children: [
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'Picture',
          kind: 'Video',
          metadata: { ai_video_editor: { track_id: 'vfx-v1' } },
          children: [
            {
              OTIO_SCHEMA: 'Gap.1',
              source_range: {
                OTIO_SCHEMA: 'TimeRange.1',
                start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                duration: { OTIO_SCHEMA: 'RationalTime.1', value: 12, rate: 24 },
              },
            },
            {
              OTIO_SCHEMA: 'Clip.2',
              name: 'Plate.mov',
              media_reference: {
                OTIO_SCHEMA: 'ExternalReference.1',
                target_url: 'file:///show/plates/Plate.mov',
                available_range: {
                  OTIO_SCHEMA: 'TimeRange.1',
                  start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                  duration: { OTIO_SCHEMA: 'RationalTime.1', value: 120, rate: 24 },
                },
                metadata: { ai_video_editor: { media_id: 'plate-src', media_type: 'video' } },
              },
              source_range: {
                OTIO_SCHEMA: 'TimeRange.1',
                start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 24, rate: 24 },
                duration: { OTIO_SCHEMA: 'RationalTime.1', value: 48, rate: 24 },
              },
              metadata: {
                ai_video_editor: {
                  clip_id: 'plate-shot',
                  speed: 1.5,
                  blend_mode: 'screen',
                },
              },
            },
          ],
        },
        {
          OTIO_SCHEMA: 'Track.1',
          name: 'Dialogue',
          kind: 'Audio',
          children: [
            {
              OTIO_SCHEMA: 'Clip.2',
              name: 'Dialogue.wav',
              media_reference: {
                OTIO_SCHEMA: 'ExternalReference.1',
                target_url: 'file:///show/audio/Dialogue.wav',
              },
              source_range: {
                OTIO_SCHEMA: 'TimeRange.1',
                start_time: { OTIO_SCHEMA: 'RationalTime.1', value: 0, rate: 24 },
                duration: { OTIO_SCHEMA: 'RationalTime.1', value: 96, rate: 24 },
              },
            },
          ],
        },
      ],
    },
  }));

  assert.equal(result.projectName, 'VFX Pull');
  assert.equal(result.fps, 24);
  assert.equal(result.width, 2048);
  assert.equal(result.height, 858);
  assert.deepEqual(result.timelineTracks.map((track) => ({
    id: track.id,
    type: track.type,
    name: track.name,
    targeted: track.isTargeted,
  })), [
    { id: 'vfx-v1', type: 'video', name: 'Picture', targeted: true },
    { id: 'audio-dialogue', type: 'audio', name: 'Dialogue', targeted: true },
  ]);

  assert.equal(result.mediaItems.length, 2);
  assert.deepEqual(result.mediaItems.map((item) => ({
    id: item.id,
    name: item.name,
    type: item.type,
    url: item.url,
    duration: item.duration,
  })), [
    {
      id: 'plate-src',
      name: 'Plate.mov',
      type: 'video',
      url: 'file:///show/plates/Plate.mov',
      duration: 5,
    },
    {
      id: 'otio-media-2',
      name: 'Dialogue.wav',
      type: 'audio',
      url: 'file:///show/audio/Dialogue.wav',
      duration: 4,
    },
  ]);

  assert.deepEqual(result.timelineClips.map((clip) => ({
    id: clip.id,
    mediaId: clip.mediaId,
    trackId: clip.trackId,
    start: clip.start,
    end: clip.end,
    sourceIn: clip.sourceIn,
    sourceOut: clip.sourceOut,
    speed: clip.speed,
    blendMode: clip.blendMode,
  })), [
    {
      id: 'plate-shot',
      mediaId: 'plate-src',
      trackId: 'vfx-v1',
      start: 0.5,
      end: 2.5,
      sourceIn: 1,
      sourceOut: 3,
      speed: 1.5,
      blendMode: 'screen',
    },
    {
      id: 'otio-clip-2',
      mediaId: 'otio-media-2',
      trackId: 'audio-dialogue',
      start: 0,
      end: 4,
      sourceIn: 0,
      sourceOut: 4,
      speed: 1,
      blendMode: undefined,
    },
  ]);
  assert.deepEqual(result.warnings, []);
});

test('parseOpenTimelineIOToTimeline roundtrips this editor OTIO export metadata', async () => {
  const { buildOpenTimelineIOFromTimeline } = await import('./openTimelineIOExport.ts');
  const { parseOpenTimelineIOToTimeline } = await import('./openTimelineIOImport.ts');

  const exported = buildOpenTimelineIOFromTimeline({
    projectName: 'Roundtrip',
    fps: 25,
    width: 1920,
    height: 1080,
    mediaItems: [
      {
        id: 'm1',
        name: 'Shot.mov',
        type: 'video',
        url: 'file:///show/Shot.mov',
        source: 'upload',
        duration: 8,
      },
    ],
    timelineTracks: [
      { id: 'video-1', type: 'video', isLocked: false, isMuted: false, name: 'V1' },
    ],
    timelineClips: [
      {
        id: 'clip-1',
        mediaId: 'm1',
        trackId: 'video-1',
        start: 1,
        end: 3,
        duration: 2,
        sourceIn: 2,
        sourceOut: 4,
        speed: 1,
        effect: null,
      },
    ],
  });

  const imported = parseOpenTimelineIOToTimeline(exported);
  assert.equal(imported.projectName, 'Roundtrip');
  assert.equal(imported.fps, 25);
  assert.equal(imported.timelineTracks[0].id, 'video-1');
  assert.equal(imported.timelineTracks[0].name, 'V1');
  assert.equal(imported.mediaItems[0].id, 'm1');
  assert.equal(imported.timelineClips[0].id, 'clip-1');
  assert.equal(imported.timelineClips[0].start, 1);
  assert.equal(imported.timelineClips[0].end, 3);
  assert.equal(imported.timelineClips[0].sourceIn, 2);
  assert.equal(imported.timelineClips[0].sourceOut, 4);
});

test('applyOpenTimelineIOImportToProject appends an imported timeline after the current edit and reuses matching media', async () => {
  const { applyOpenTimelineIOImportToProject } = await import('./openTimelineIOImport.ts');

  const result = applyOpenTimelineIOImportToProject({
    mode: 'append',
    currentMediaItems: [
      {
        id: 'existing-media',
        name: 'Shot.mov',
        type: 'video',
        url: 'file:///show/Shot.mov',
        sourceUrl: 'file:///show/Shot.mov',
        source: 'upload',
        duration: 8,
      },
    ],
    currentTimelineTracks: [
      { id: 'video-1', type: 'video', isLocked: false, isMuted: false, isTargeted: true },
    ],
    currentTimelineClips: [
      {
        id: 'clip-1',
        mediaId: 'existing-media',
        trackId: 'video-1',
        start: 0,
        end: 3,
        duration: 3,
        speed: 1,
        effect: null,
      },
    ],
    imported: {
      projectName: 'Import',
      fps: 24,
      width: 1920,
      height: 1080,
      warnings: [],
      mediaItems: [
        {
          id: 'import-media',
          name: 'Shot.mov',
          type: 'video',
          url: 'file:///show/Shot.mov',
          sourceUrl: 'file:///show/Shot.mov',
          source: 'upload',
          duration: 8,
        },
        {
          id: 'new-audio',
          name: 'Music.wav',
          type: 'audio',
          url: 'file:///show/Music.wav',
          sourceUrl: 'file:///show/Music.wav',
          source: 'upload',
          duration: 2,
        },
      ],
      timelineTracks: [
        { id: 'video-1', name: 'Import V1', type: 'video', isLocked: false, isMuted: false, isTargeted: true },
        { id: 'audio-1', name: 'Import A1', type: 'audio', isLocked: false, isMuted: false, isTargeted: true },
      ],
      timelineClips: [
        {
          id: 'clip-1',
          mediaId: 'import-media',
          trackId: 'video-1',
          start: 0.5,
          end: 1.5,
          duration: 1,
          speed: 1,
          sourceIn: 2,
          sourceOut: 3,
          effect: null,
        },
        {
          id: 'music-clip',
          mediaId: 'new-audio',
          trackId: 'audio-1',
          start: 0,
          end: 2,
          duration: 2,
          speed: 1,
          effect: null,
        },
      ],
    },
  });

  assert.deepEqual(result.mediaItems.map((item) => item.id), ['existing-media', 'new-audio']);
  assert.deepEqual(result.timelineTracks.map((track) => track.id), ['video-1', 'video-1-2', 'audio-1']);
  assert.deepEqual(result.timelineClips.map((clip) => ({
    id: clip.id,
    mediaId: clip.mediaId,
    trackId: clip.trackId,
    start: clip.start,
    end: clip.end,
  })), [
    { id: 'clip-1', mediaId: 'existing-media', trackId: 'video-1', start: 0, end: 3 },
    { id: 'clip-1-2', mediaId: 'existing-media', trackId: 'video-1-2', start: 3.5, end: 4.5 },
    { id: 'music-clip', mediaId: 'new-audio', trackId: 'audio-1', start: 3, end: 5 },
  ]);
  assert.equal(result.importedMediaCount, 1);
  assert.equal(result.reusedMediaCount, 1);
  assert.equal(result.importedClipCount, 2);
});

test('applyOpenTimelineIOImportToProject replaces only the timeline while preserving the media bin', async () => {
  const { applyOpenTimelineIOImportToProject } = await import('./openTimelineIOImport.ts');

  const result = applyOpenTimelineIOImportToProject({
    mode: 'replace',
    currentMediaItems: [
      { id: 'old-unused', name: 'Old.mov', type: 'video', url: 'file:///old.mov', source: 'upload', duration: 5 },
    ],
    currentTimelineTracks: [
      { id: 'video-1', type: 'video', isLocked: false, isMuted: false },
    ],
    currentTimelineClips: [
      { id: 'old-clip', mediaId: 'old-unused', trackId: 'video-1', start: 0, end: 5, duration: 5, speed: 1, effect: null },
    ],
    imported: {
      projectName: 'Replace',
      fps: 24,
      width: 1920,
      height: 1080,
      warnings: ['Skipped unsupported marker.'],
      mediaItems: [
        { id: 'new-media', name: 'New.mov', type: 'video', url: 'file:///new.mov', source: 'upload', duration: 2 },
      ],
      timelineTracks: [
        { id: 'video-1', name: 'New V1', type: 'video', isLocked: false, isMuted: false },
      ],
      timelineClips: [
        { id: 'new-clip', mediaId: 'new-media', trackId: 'video-1', start: 0, end: 2, duration: 2, speed: 1, effect: null },
      ],
    },
  });

  assert.deepEqual(result.mediaItems.map((item) => item.id), ['old-unused', 'new-media']);
  assert.deepEqual(result.timelineTracks.map((track) => track.id), ['video-1']);
  assert.deepEqual(result.timelineClips.map((clip) => clip.id), ['new-clip']);
  assert.equal(result.activeTrackId, 'video-1');
  assert.deepEqual(result.warnings, ['Skipped unsupported marker.']);
});
