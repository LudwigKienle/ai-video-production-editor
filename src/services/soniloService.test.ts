import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createSoniloVideoToMusicClient,
  createSoniloVideoToSfxClient,
  SONILO_VIDEO_TO_MUSIC_MODEL,
  SONILO_VIDEO_TO_SFX_MODEL,
} from './soniloService.ts';

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

const SFX_SUBMIT_URL = 'https://api.sonilo.com/v1/video-to-sfx';
const SFX_TASK_URL = 'https://api.sonilo.com/v1/tasks/task_abc12345';
const SFX_ARTIFACT_URL = 'https://storage.sonilo.example/results/task_abc12345.m4a';

const jsonResponse = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });

test('runs the SFX task pipeline from a video URL into an audio item', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const usageEntries: unknown[] = [];
  const capturedBlobs: Blob[] = [];
  const statuses: string[] = [];
  const sleeps: number[] = [];
  let pollCount = 0;

  const client = createSoniloVideoToSfxClient({
    apiKey: 'sonilo_test_key',
    now: () => 1700000000000,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    getDurationSeconds: async () => 42,
    recordUsage: (entry) => {
      usageEntries.push(entry);
      return entry as never;
    },
    createObjectUrl: (blob) => {
      capturedBlobs.push(blob);
      return 'blob:sonilo-sfx-audio';
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === SFX_SUBMIT_URL) {
        return jsonResponse({ task_id: 'task_abc12345' }, 202);
      }
      if (String(url) === SFX_TASK_URL) {
        pollCount += 1;
        if (pollCount === 1) {
          return jsonResponse({ status: 'processing' });
        }
        return jsonResponse({
          status: 'succeeded',
          audio: { url: SFX_ARTIFACT_URL, content_type: 'audio/mp4', file_size: 12 },
          video: { url: 'https://storage.sonilo.example/results/task_abc12345.mp4' },
        });
      }
      if (String(url) === SFX_ARTIFACT_URL) {
        return new Response(new Blob(['SFX-AUDIO'], { type: 'audio/mp4' }), { status: 200 });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  });

  const item = await client.generateSfxFromVideo({
    videoUrl: 'https://example.com/final_cut.mp4',
    videoName: 'final_cut.mp4',
    prompt: 'footsteps on gravel, distant traffic',
    onStatus: (message) => statuses.push(message),
  });

  assert.deepEqual(calls.map((call) => call.url), [
    SFX_SUBMIT_URL,
    SFX_TASK_URL,
    SFX_TASK_URL,
    SFX_ARTIFACT_URL,
  ]);
  assert.equal(calls[0].init?.method, 'POST');
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer sonilo_test_key');
  assert.equal((calls[1].init?.headers as Record<string, string>).Authorization, 'Bearer sonilo_test_key');

  // The artifact URL is presigned: the API key must never reach the storage domain.
  const artifactCall = calls[3];
  const artifactHeaders = (artifactCall.init?.headers || {}) as Record<string, string>;
  assert.equal(artifactHeaders.Authorization, undefined);

  const body = calls[0].init?.body as FormData;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('video_url'), 'https://example.com/final_cut.mp4');
  assert.equal(body.get('prompt'), 'footsteps on gravel, distant traffic');
  assert.equal(body.get('video'), null);

  assert.deepEqual(sleeps, [5000]);

  assert.equal(capturedBlobs.length, 1);
  assert.equal(capturedBlobs[0].type, 'audio/mp4');
  assert.equal(Buffer.from(await capturedBlobs[0].arrayBuffer()).toString(), 'SFX-AUDIO');

  assert.equal(item.id, 'sonilo-sfx-1700000000000');
  assert.equal(item.name, 'sonilo_sfx_final_cut.m4a');
  assert.equal(item.type, 'audio');
  assert.equal(item.url, 'blob:sonilo-sfx-audio');
  assert.equal(item.source, 'generated');
  assert.equal(item.generatedBy, 'Sonilo Video-to-SFX');
  assert.equal(item.prompt, 'footsteps on gravel, distant traffic');

  assert.deepEqual(usageEntries, [{
    provider: 'sonilo',
    model: SONILO_VIDEO_TO_SFX_MODEL,
    kind: 'audio',
    units: 1,
    unitLabel: 'clip',
    note: 'Sonilo video-to-sfx audio',
  }]);

  assert.ok(statuses.length > 0);
});

test('uploads local blob/data videos to the SFX endpoint as multipart file input', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];

  const client = createSoniloVideoToSfxClient({
    apiKey: 'sonilo_test_key',
    sleep: async () => {},
    getDurationSeconds: async () => {
      throw new Error('duration probe unavailable');
    },
    recordUsage: () => null,
    createObjectUrl: () => 'blob:sonilo-sfx-audio',
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url).startsWith('blob:')) {
        return new Response(new Blob(['VIDEO-BYTES'], { type: 'video/mp4' }), { status: 200 });
      }
      if (String(url) === SFX_SUBMIT_URL) {
        return jsonResponse({ task_id: 'task_abc12345' }, 202);
      }
      if (String(url) === SFX_TASK_URL) {
        return jsonResponse({
          status: 'succeeded',
          audio: { url: SFX_ARTIFACT_URL, content_type: 'audio/wav' },
        });
      }
      return new Response(new Blob(['WAV-AUDIO'], { type: 'audio/wav' }), { status: 200 });
    },
  });

  const item = await client.generateSfxFromVideo({
    videoUrl: 'blob:local-render',
    videoName: 'rendered_cut.mp4',
  });

  assert.equal(calls[0].url, 'blob:local-render');
  assert.equal(calls[1].url, SFX_SUBMIT_URL);

  const body = calls[1].init?.body as FormData;
  assert.ok(body instanceof FormData);
  assert.equal(body.get('video_url'), null);
  assert.equal(body.get('prompt'), null);
  const file = body.get('video') as File;
  assert.ok(file instanceof File);
  assert.equal(file.name, 'rendered_cut.mp4');
  assert.equal(Buffer.from(await file.arrayBuffer()).toString(), 'VIDEO-BYTES');

  assert.equal(item.type, 'audio');
  assert.equal(item.name, 'sonilo_sfx_rendered_cut.wav');
});

test('SFX fails without an API key before any request is made', async () => {
  let fetchCalls = 0;
  const client = createSoniloVideoToSfxClient({
    apiKey: null,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('', { status: 200 });
    },
  });

  await assert.rejects(
    client.generateSfxFromVideo({ videoUrl: 'https://example.com/final_cut.mp4' }),
    /Sonilo API key is missing/,
  );
  assert.equal(fetchCalls, 0);
});

test('SFX pre-checks the 3-minute video limit before submitting', async () => {
  let fetchCalls = 0;
  const client = createSoniloVideoToSfxClient({
    apiKey: 'sonilo_test_key',
    getDurationSeconds: async () => 200,
    fetchImpl: async () => {
      fetchCalls += 1;
      return new Response('', { status: 200 });
    },
  });

  await assert.rejects(
    client.generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /up to 180 seconds/,
  );
  assert.equal(fetchCalls, 0);
});

test('SFX lets the backend decide when the duration probe fails', async () => {
  let submitCalls = 0;
  const client = createSoniloVideoToSfxClient({
    apiKey: 'sonilo_test_key',
    getDurationSeconds: async () => {
      throw new Error('no metadata');
    },
    fetchImpl: async () => {
      submitCalls += 1;
      return jsonResponse({ detail: 'Video too long' }, 422);
    },
  });

  await assert.rejects(
    client.generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo API Error \(422\): Video too long/,
  );
  assert.equal(submitCalls, 1);
});

test('maps SFX submit errors and missing task ids to clear messages', async () => {
  const buildClient = (respond: () => Response) =>
    createSoniloVideoToSfxClient({
      apiKey: 'sonilo_test_key',
      getDurationSeconds: async () => 30,
      fetchImpl: async () => respond(),
    });

  await assert.rejects(
    buildClient(() => jsonResponse({ detail: 'bad key' }, 401))
      .generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo API key was rejected/,
  );

  await assert.rejects(
    buildClient(() => jsonResponse({ detail: 'slow down' }, 429))
      .generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo rate limit exceeded: slow down/,
  );

  await assert.rejects(
    buildClient(() => jsonResponse({ ok: true }, 202))
      .generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /returned no task id/,
  );
});

test('maps SFX task polling outcomes to clear messages', async () => {
  const buildClient = (pollRespond: (pollCount: number) => Response) => {
    let pollCount = 0;
    return createSoniloVideoToSfxClient({
      apiKey: 'sonilo_test_key',
      sleep: async () => {},
      getDurationSeconds: async () => 30,
      recordUsage: () => null,
      createObjectUrl: () => 'blob:sonilo-sfx-audio',
      fetchImpl: async (url) => {
        if (String(url) === SFX_SUBMIT_URL) {
          return jsonResponse({ task_id: 'task_abc12345' }, 202);
        }
        pollCount += 1;
        return pollRespond(pollCount);
      },
    });
  };

  // 404 means the task id itself is unknown to /v1/tasks (bad id, or a music
  // generation id) — retrying the same id can never help.
  await assert.rejects(
    buildClient(() => jsonResponse({ detail: 'not found' }, 404))
      .generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /task task_abc12345 was not found/,
  );

  // Any other polling error keeps the task id in the message: the task was
  // already accepted and may still finish on the backend.
  await assert.rejects(
    buildClient(() => jsonResponse({ detail: 'backend hiccup' }, 500))
      .generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /Sonilo API Error \(500\): backend hiccup.*task_abc12345/,
  );

  await assert.rejects(
    buildClient(() => jsonResponse({
      status: 'failed',
      error: { code: 'GEN_FAILED', message: 'model rejected the input' },
      refunded: true,
    })).generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /failed \(GEN_FAILED\): model rejected the input\. The charge was reversed\./,
  );

  await assert.rejects(
    buildClient(() => jsonResponse({
      status: 'succeeded',
      audio: {},
    })).generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /succeeded but returned no audio artifact/,
  );
});

test('SFX polling timeout keeps the task id in the message', async () => {
  const sleeps: number[] = [];
  const client = createSoniloVideoToSfxClient({
    apiKey: 'sonilo_test_key',
    pollTimeoutMs: 0,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    getDurationSeconds: async () => 30,
    fetchImpl: async (url) => {
      if (String(url) === SFX_SUBMIT_URL) {
        return jsonResponse({ task_id: 'task_abc12345' }, 202);
      }
      return jsonResponse({ status: 'processing' });
    },
  });

  await assert.rejects(
    client.generateSfxFromVideo({ videoUrl: 'https://example.com/a.mp4' }),
    /timed out waiting for SFX task task_abc12345.*may still complete/,
  );
  assert.equal(sleeps.length, 0);
});
