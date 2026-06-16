import test from 'node:test';
import assert from 'node:assert/strict';

test('buildFcpxmlFromTimeline exports active timeline clips with frame-accurate offsets', async () => {
  const { buildFcpxmlFromTimeline } = await import('./fcpxmlExport.ts');

  const xml = buildFcpxmlFromTimeline({
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
        name: 'Title <Still>.png',
        type: 'image',
        url: 'https://example.com/title.png?x=1&y=2',
        source: 'generated',
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
      { id: 'v1', type: 'video', isLocked: false, isMuted: false },
      { id: 'v2', type: 'video', isLocked: false, isMuted: true },
    ],
    timelineClips: [
      {
        id: 'c1',
        mediaId: 'm1',
        trackId: 'v1',
        start: 0,
        end: 2.5,
        duration: 2.5,
        speed: 1,
        sourceIn: 1,
        sourceOut: 3.5,
        effect: null,
      },
      {
        id: 'c2',
        mediaId: 'm2',
        trackId: 'v1',
        start: 2.5,
        end: 4,
        duration: 1.5,
        speed: 1,
        effect: null,
      },
      {
        id: 'c3',
        mediaId: 'm3',
        trackId: 'v2',
        start: 4,
        end: 7,
        duration: 3,
        speed: 1,
        effect: null,
      },
    ],
  });

  assert.match(xml, /^<\?xml version="1.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<project name="Client &amp; Cut">/);
  assert.match(xml, /frameDuration="1\/24s" width="1920" height="1080"/);
  assert.match(xml, /name="A&amp;B.mov" src="file:\/\/\/Volumes\/Camera\/A%26B.mov"/);
  assert.match(xml, /offset="0\/24s" start="24\/24s" duration="60\/24s"/);
  assert.match(xml, /name="Title &lt;Still&gt;.png" src="https:\/\/example.com\/title.png\?x=1&amp;y=2"/);
  assert.match(xml, /offset="60\/24s" start="0\/24s" duration="36\/24s"/);
  assert.doesNotMatch(xml, /Muted/);
});

test('buildFcpxmlFromTimeline rejects blob and data urls that NLEs cannot relink', async () => {
  const { buildFcpxmlFromTimeline } = await import('./fcpxmlExport.ts');

  assert.throws(() => buildFcpxmlFromTimeline({
    mediaItems: [
      { id: 'm1', name: 'Preview', type: 'video', url: 'blob:http://localhost/123', source: 'generated' },
    ],
    timelineTracks: [{ id: 'v1', type: 'video', isLocked: false, isMuted: false }],
    timelineClips: [
      { id: 'c1', mediaId: 'm1', trackId: 'v1', start: 0, end: 1, duration: 1, speed: 1, effect: null },
    ],
  }), /file:\/\/ or http\(s\) source/);
});

test('buildFcpxmlFromShotPrompts uses measured shot durations', async () => {
  const { buildFcpxmlFromShotPrompts } = await import('./fcpxmlExport.ts');

  const xml = await buildFcpxmlFromShotPrompts({
    projectName: 'Storyboard XML',
    fps: 30,
    shots: [
      { shot: 2, description: 'Wide shot', videoUrl: 'https://cdn.example.com/shot-2.mp4' },
      { shot: 3, description: 'Close shot', videoUrl: 'https://cdn.example.com/shot-3.mp4' },
    ],
    getDuration: async (url: string) => url.includes('shot-2') ? 2.2 : 3,
  });

  assert.match(xml, /<project name="Storyboard XML">/);
  assert.match(xml, /name="Shot 2: Wide shot"/);
  assert.match(xml, /offset="0\/30s" start="0\/30s" duration="66\/30s"/);
  assert.match(xml, /name="Shot 3: Close shot"/);
  assert.match(xml, /offset="66\/30s" start="0\/30s" duration="90\/30s"/);
  assert.match(xml, /<sequence duration="156\/30s"/);
});
