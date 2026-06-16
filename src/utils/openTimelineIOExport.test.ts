import test from 'node:test';
import assert from 'node:assert/strict';

test('buildOpenTimelineIOFromTimeline exports active tracks as OTIO JSON with gaps and clip ranges', async () => {
  const { buildOpenTimelineIOFromTimeline } = await import('./openTimelineIOExport.ts');

  const otioText = buildOpenTimelineIOFromTimeline({
    projectName: 'Client & Cut',
    fps: 24,
    width: 1920,
    height: 1080,
    mediaItems: [
      {
        id: 'm1',
        name: 'A&B.mov',
        type: 'video',
        url: 'file:///Volumes/Edit/A%26B.mov',
        sourceUrl: 'file:///Volumes/Camera/A%26B.mov',
        source: 'upload',
        duration: 10,
      },
      {
        id: 'm2',
        name: 'VO.wav',
        type: 'audio',
        url: 'https://example.com/vo.wav',
        source: 'upload',
        duration: 4,
      },
      {
        id: 'm3',
        name: 'Muted.mov',
        type: 'video',
        url: 'file:///Volumes/Edit/Muted.mov',
        source: 'upload',
        duration: 3,
      },
    ],
    timelineTracks: [
      { id: 'v1', type: 'video', isLocked: false, isMuted: false, name: 'V1' },
      { id: 'a1', type: 'audio', isLocked: false, isMuted: false, name: 'A1' },
      { id: 'v2', type: 'video', isLocked: false, isMuted: true, name: 'Muted' },
    ],
    timelineClips: [
      {
        id: 'c1',
        mediaId: 'm1',
        trackId: 'v1',
        start: 1,
        end: 3.5,
        duration: 2.5,
        speed: 1,
        sourceIn: 2,
        sourceOut: 4.5,
        effect: null,
      },
      {
        id: 'c2',
        mediaId: 'm2',
        trackId: 'a1',
        start: 0,
        end: 4,
        duration: 4,
        speed: 1,
        effect: null,
      },
      {
        id: 'c3',
        mediaId: 'm3',
        trackId: 'v2',
        start: 0,
        end: 3,
        duration: 3,
        speed: 1,
        effect: null,
      },
    ],
  });

  const otio = JSON.parse(otioText);
  assert.equal(otio.OTIO_SCHEMA, 'Timeline.1');
  assert.equal(otio.name, 'Client & Cut');
  assert.equal(otio.metadata.ai_video_editor.width, 1920);
  assert.equal(otio.tracks.children.length, 2);

  const videoTrack = otio.tracks.children[0];
  assert.equal(videoTrack.name, 'V1');
  assert.equal(videoTrack.kind, 'Video');
  assert.equal(videoTrack.children[0].OTIO_SCHEMA, 'Gap.1');
  assert.equal(videoTrack.children[0].source_range.duration.value, 24);
  assert.equal(videoTrack.children[1].OTIO_SCHEMA, 'Clip.2');
  assert.equal(videoTrack.children[1].name, 'A&B.mov');
  assert.equal(videoTrack.children[1].media_reference.target_url, 'file:///Volumes/Camera/A%26B.mov');
  assert.equal(videoTrack.children[1].source_range.start_time.value, 48);
  assert.equal(videoTrack.children[1].source_range.duration.value, 60);
  assert.equal(videoTrack.children[1].metadata.ai_video_editor.timeline_start, 1);

  const audioTrack = otio.tracks.children[1];
  assert.equal(audioTrack.kind, 'Audio');
  assert.equal(audioTrack.children[0].media_reference.target_url, 'https://example.com/vo.wav');
  assert.equal(JSON.stringify(otio), otioText);
  assert.doesNotMatch(otioText, /Muted/);
});

test('buildOpenTimelineIOFromTimeline rejects preview urls that interchange tools cannot relink', async () => {
  const { buildOpenTimelineIOFromTimeline } = await import('./openTimelineIOExport.ts');

  assert.throws(() => buildOpenTimelineIOFromTimeline({
    mediaItems: [
      { id: 'm1', name: 'Preview', type: 'video', url: 'data:video/mp4;base64,AAAA', source: 'generated' },
    ],
    timelineTracks: [{ id: 'v1', type: 'video', isLocked: false, isMuted: false }],
    timelineClips: [
      { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 0, end: 1, duration: 1, speed: 1, effect: null },
    ],
  }), /file:\/\/ or http\(s\) source/);
});
