import test from 'node:test';
import assert from 'node:assert/strict';

import { createSoniloVideoToMusicClient, SONILO_VIDEO_TO_MUSIC_MODEL } from './soniloService.ts';

const encodeChunk = (text: string) => Buffer.from(text).toString('base64');

const buildNdjson = (lines: Array<Record<string, unknown> | string>) =>
  lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') + '\n';

test('streams a Sonilo video-to-music generation from a video URL into an audio item', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const usageEntries: unknown[] = [];
  const capturedBlobs: Blob[] = [];
  const statuses: string[] = [];

  const ndjson = buildNdjson([
    { type: 'stage_start', stage: 'analysis' },
    'not json — must be ignored',
    { type: 'title', title: 'Neon Skyline' },
    { type: 'audio_chunk', stream_index: 0, num_streams: 1, data: encodeChunk('AUDIO-PART-1;') },
    { type: 'audio_chunk', stream_index: 0, num_streams: 1, data: encodeChunk('AUDIO-PART-2') },
    { type: 'complete' },
  ]);

  const client = createSoniloVideoToMusicClient({
    apiKey: 'sonilo_test_key',
    now: () => 1700000000000,
    recordUsage: (entry) => {
      usageEntries.push(entry);
      return entry as never;
    },
    createObjectUrl: (blob) => {
      capturedBlobs.push(blob);
      return 'blob:sonilo-audio';
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(ndjson, { status: 200 });
    },
  });

  const item = await client.generateMusicFromVideo({
    videoUrl: 'https://example.com/final_cut.mp4',
    prompt: 'warm analog synths',
    onStatus: (message) => statuses.push(message),
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://api.sonilo.com/v1/video-to-music');
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer sonilo_test_key');

  const body = calls[0].init?.body as FormData;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('video_url'), 'https://example.com/final_cut.mp4');
  assert.equal(body.get('prompt'), 'warm analog synths');
  assert.equal(body.get('video'), null);

  assert.equal(capturedBlobs.length, 1);
  assert.equal(capturedBlobs[0].type, 'audio/mp4');
  const audioText = Buffer.from(await capturedBlobs[0].arrayBuffer()).toString();
  assert.equal(audioText, 'AUDIO-PART-1;AUDIO-PART-2');

  assert.equal(item.id, 'sonilo-1700000000000');
  assert.equal(item.name, 'sonilo_neon_skyline.m4a');
  assert.equal(item.type, 'audio');
  assert.equal(item.url, 'blob:sonilo-audio');
  assert.equal(item.source, 'generated');
  assert.equal(item.generatedBy, 'Sonilo Video-to-Music');
  assert.equal(item.prompt, 'warm analog synths');

  assert.deepEqual(usageEntries, [{
    provider: 'sonilo',
    model: SONILO_VIDEO_TO_MUSIC_MODEL,
    kind: 'audio',
    units: 1,
    unitLabel: 'clip',
    note: 'Sonilo video-to-music track',
  }]);

  assert.ok(statuses.length > 0);
});

test('uploads local blob/data videos as multipart file input', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const ndjson = buildNdjson([
    { type: 'audio_chunk', stream_index: 0, num_streams: 1, data: encodeChunk('LOCAL-AUDIO') },
    { type: 'complete' },
  ]);

  const client = createSoniloVideoToMusicClient({
    apiKey: 'sonilo_test_key',
    recordUsage: () => null,
    createObjectUrl: () => 'blob:sonilo-audio',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith('blob:')) {
        return new Response(new Blob(['VIDEO-BYTES'], { type: 'video/mp4' }), { status: 200 });
      }
      return new Response(ndjson, { status: 200 });
    },
  });

  const item = await client.generateMusicFromVideo({
    videoUrl: 'blob:local-render',
    videoName: 'rendered_cut.mp4',
  });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, 'blob:local-render');
  assert.equal(calls[1].url, 'https://api.sonilo.com/v1/video-to-music');

  const body = calls[1].init?.body as FormData;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('video_url'), null);
  assert.equal(body.get('prompt'), null);
  const file = body.get('video') as File;
  assert.ok(file instanceof File);
  assert.equal(file.name, 'rendered_cut.mp4');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'VIDEO-BYTES');

  assert.equal(item.type, 'audio');
  assert.equal(item.name, 'sonilo_rendered_cut.m4a');
});

test('fails without an API key before any request is made', async () => {
  let fetchCalls = 0;
  const client = createSoniloVideoToMusicClient({
    apiKey: null,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('', { status: 200 });
    },
  });

  await assert.rejects(
    client.generateMusicFromVideo({ videoUrl: 'https://example.com/final_cut.mp4' }),
    /Sonilo API key is missing/,
  );
  assert.equal(fetchCalls, 0);
});

test('maps HTTP errors to clear messages', async () => {
  const buildClient = (status: number, body: string) =>
    createSoniloVideoToMusicClient({
      apiKey: 'sonilo_test_key',
      fetchImpl: async () => new Response(body, { status }),
    });

  await assert.rejects(
    buildClient(401, JSON.stringify({ detail: 'bad key' }))
      .generateMusicFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo API key was rejected/,
  );

  await assert.rejects(
    buildClient(422, JSON.stringify({ detail: 'Video too long' }))
      .generateMusicFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo API Error \(422\): Video too long/,
  );

  await assert.rejects(
    buildClient(429, JSON.stringify({ detail: 'slow down' }))
      .generateMusicFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo rate limit exceeded: slow down/,
  );
});

test('surfaces stream error events and incomplete streams', async () => {
  const buildClient = (ndjson: string) =>
    createSoniloVideoToMusicClient({
      apiKey: 'sonilo_test_key',
      recordUsage: () => null,
      createObjectUrl: () => 'blob:sonilo-audio',
      fetchImpl: async () => new Response(ndjson, { status: 200 }),
    });

  await assert.rejects(
    buildClient(buildNdjson([
      { type: 'audio_chunk', stream_index: 0, num_streams: 1, data: encodeChunk('X') },
      { type: 'error', message: 'generation failed upstream' },
    ])).generateMusicFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /generation failed upstream/,
  );

  await assert.rejects(
    buildClient(buildNdjson([
      { type: 'audio_chunk', stream_index: 0, num_streams: 1, data: encodeChunk('X') },
    ])).generateMusicFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /ended before completing/,
  );

  await assert.rejects(
    buildClient(buildNdjson([
      { type: 'complete' },
    ])).generateMusicFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /without returning audio data/,
  );
});
