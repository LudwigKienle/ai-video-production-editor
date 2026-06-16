import test from 'node:test';
import assert from 'node:assert/strict';

import { createLtxVideoToVideoHdrClient, LTX_VIDEO_TO_VIDEO_HDR_MODEL } from './ltxService.ts';

test('submits LTX video-to-video HDR jobs and returns an ACES HDR EXR archive item', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const usageEntries: unknown[] = [];

  const client = createLtxVideoToVideoHdrClient({
    apiKey: 'ltx_test_key',
    now: () => 1700000000000,
    sleep: async () => undefined,
    recordUsage: (entry) => {
      usageEntries.push(entry);
      return entry as never;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });

      if (String(url).endsWith('/video-to-video-hdr')) {
        return Response.json(
          { id: 'job-123', created_at: '2026-01-15T10:00:00.000Z' },
          { status: 202 },
        );
      }

      return Response.json({
        id: 'job-123',
        status: calls.length < 3 ? 'processing' : 'completed',
        result: {
          exr_frames_url: 'https://cdn.ltx.video/jobs/job-123/aces_hdr_exr_frames.zip',
        },
      });
    },
  });

  const item = await client.upscaleVideoToAcesHdr({
    videoUri: 'https://example.com/source.mp4',
    sourceName: 'source.mp4',
  });

  assert.equal(calls[0].url, 'https://api.ltx.video/v2/video-to-video-hdr');
  assert.equal(calls[0].init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), {
    video_uri: 'https://example.com/source.mp4',
  });
  assert.equal((calls[0].init?.headers as Record<string, string>).Authorization, 'Bearer ltx_test_key');

  assert.equal(calls[1].url, 'https://api.ltx.video/v2/video-to-video-hdr/job-123');
  assert.equal(calls[2].url, 'https://api.ltx.video/v2/video-to-video-hdr/job-123');

  assert.equal(item.id, 'ltx-aces-hdr-1700000000000');
  assert.equal(item.name, 'source_aces_hdr_exr_frames.zip');
  assert.equal(item.type, 'video');
  assert.equal(item.url, 'https://cdn.ltx.video/jobs/job-123/aces_hdr_exr_frames.zip');
  assert.equal(item.generatedBy, 'LTX Color Science Upscale - ACES HDR EXR');
  assert.equal(item.analysisNotes?.some((note) => note.includes('ACES HDR')), true);

  assert.deepEqual(usageEntries, [{
    provider: 'ltx',
    model: LTX_VIDEO_TO_VIDEO_HDR_MODEL,
    kind: 'edit',
    units: 1,
    unitLabel: 'clip',
    note: 'LTX ACES HDR video-to-video upscale',
  }]);
});

test('fails completed LTX HDR jobs that do not include exr_frames_url', async () => {
  const client = createLtxVideoToVideoHdrClient({
    apiKey: 'ltx_test_key',
    sleep: async () => undefined,
    fetchImpl: async (url) => {
      if (String(url).endsWith('/video-to-video-hdr')) {
        return Response.json({ id: 'job-missing-result', created_at: '2026-01-15T10:00:00.000Z' }, { status: 202 });
      }
      return Response.json({ id: 'job-missing-result', status: 'completed', result: {} });
    },
  });

  await assert.rejects(
    () => client.upscaleVideoToAcesHdr({ videoUri: 'https://example.com/source.mp4' }),
    /exr_frames_url/i,
  );
});

test('formats structured LTX API errors without leaking [object Object]', async () => {
  const client = createLtxVideoToVideoHdrClient({
    apiKey: 'ltx_test_key',
    fetchImpl: async () => Response.json({
      error: {
        code: 'invalid_video_uri',
        message: 'video_uri must be an HTTPS URL or data URI',
      },
    }, { status: 422 }),
  });

  await assert.rejects(
    () => client.upscaleVideoToAcesHdr({ videoUri: 'https://example.com/source.mp4' }),
    (error) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /invalid_video_uri/);
      assert.match(error.message, /video_uri must be an HTTPS URL or data URI/);
      assert.doesNotMatch(error.message, /\[object Object\]/);
      return true;
    },
  );
});
