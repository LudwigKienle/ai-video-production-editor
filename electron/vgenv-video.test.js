const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { fileURLToPath } = require('node:url');
const { createVgenvVideo, defaultDownloadRequest } = require('./vgenv-video');
const { assertSafeSavedVideo } = require('./vgenv-video-path');

const input = { prompt: 'A dog runs across a field', duration: 5, resolution: '480p', aspectRatio: '16:9', promptMode: 'raw' };
const job = (status, extra = {}) => ({ id: 'job_test', status, price: { currency: 'CNY', amount_micros: 123456 }, ...extra });
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const setup = async (fetchImpl, transport = {}) => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-test-'));
  const api = createVgenvVideo({ fetchImpl, ...transport });
  api.configure('test-secret');
  return { projectPath, api };
};

test('create maps v2 request, frames, prompt mode and keeps key out of job file', async () => {
  const calls = [];
  const { api, projectPath } = await setup(async (url, options) => {
    calls.push({ url, options });
    return json(job('queued'), 202);
  });
  const firstFrame = 'data:image/png;base64,AAAA';
  const lastFrame = 'data:image/webp;base64,BBBB';
  await api.create({ projectPath, input: { ...input, firstFrame, lastFrame } });
  assert.equal(calls[0].url, 'https://api.vgenv.com/v2/videos');
  assert.equal(calls[0].options.headers['X-API-Key'], 'test-secret');
  assert.ok(calls[0].options.headers['Idempotency-Key']);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'minimax/h3');
  assert.equal(body.tier, 'fast');
  assert.deepEqual(body.prompt_optimization, { mode: 'raw' });
  assert.deepEqual(body.frame_images.map((frame) => frame.frame_type), ['first_frame', 'last_frame']);
  assert.equal(body.frame_images[0].image_url.url, firstFrame);
  const persisted = await fs.readFile(path.join(projectPath, '.vgenv-jobs.json'), 'utf8');
  assert.ok(!persisted.includes('test-secret'));
  assert.deepEqual((await api.list(projectPath))[0].price, { currency: 'CNY', amount_micros: 123456 });
});

test('concurrent duplicate create shares one POST; ambiguous timeout reuses idempotency key', async () => {
  let count = 0;
  const keys = [];
  const { api, projectPath } = await setup(async (_url, options) => {
    count++;
    keys.push(options.headers['Idempotency-Key']);
    if (count === 1) throw new Error('network timeout');
    return json(job('preparing'), 202);
  });
  await assert.rejects(api.create({ projectPath, input }));
  const [a, b] = await Promise.all([api.create({ projectPath, input }), api.create({ projectPath, input })]);
  assert.equal(count, 2);
  assert.equal(a.id, b.id);
  assert.equal(keys[0], keys[1]);
});

test('cancel confirms remote state and never reports cancellation for running job', async () => {
  const methods = [];
  const { api, projectPath } = await setup(async (_url, options) => {
    methods.push(options.method);
    return json(job('running'));
  });
  const result = await api.cancel({ projectPath, id: 'job_test' });
  assert.equal(result.status, 'running');
  assert.deepEqual(methods, ['GET']);
});

test('queued cancellation uses DELETE then GET; status transition wins race', async () => {
  const states = [job('queued'), job('running'), job('running')];
  const methods = [];
  const { api, projectPath } = await setup(async (_url, options) => {
    methods.push(options.method);
    return json(states.shift());
  });
  assert.equal((await api.cancel({ projectPath, id: 'job_test' })).status, 'running');
  assert.deepEqual(methods, ['GET', 'DELETE', 'GET']);
});

test('all provider states are retained and cancellation only succeeds after GET confirms it', async () => {
  const states = ['preparing', 'queued', 'running', 'succeeded', 'failed', 'cancelled'];
  const { api, projectPath } = await setup(async () => json(job(states.shift())));
  for (const status of ['preparing', 'queued', 'running', 'succeeded', 'failed', 'cancelled']) {
    assert.equal((await api.get({ projectPath, id: 'job_test' })).status, status);
    assert.equal((await api.list(projectPath))[0].status, status);
  }
  const methods = [];
  const cancellation = createVgenvVideo({ fetchImpl: async (_url, options) => {
    methods.push(options.method);
    return json(job(methods.length === 1 ? 'queued' : 'cancelled'));
  } });
  cancellation.configure('test-secret');
  assert.equal((await cancellation.cancel({ projectPath, id: 'job_test' })).status, 'cancelled');
  assert.deepEqual(methods, ['GET', 'DELETE', 'GET']);
});

test('expired signed URL refreshes; retry download does not POST or send API key to CDN', async () => {
  let downloads = 0;
  const calls = [];
  const destinations = [];
  const { api, projectPath } = await setup(async (url, options) => {
    calls.push({ url, options });
    return json(job('succeeded', { output: { url: 'https://cdn.example/video.mp4', expires_at: '2000-01-01T00:00:00Z' } }));
  }, {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    downloadRequestImpl: async (url, address) => {
      destinations.push([url.href, address]);
    downloads++;
      if (downloads === 1) return { status: 503 };
      return { status: 200, bytes: Buffer.from([1, 2, 3]) };
    },
  });
  await assert.rejects(api.download({ projectPath, id: 'job_test' }), /retry download/);
  const saved = await api.download({ projectPath, id: 'job_test' });
  assert.ok(saved.url.startsWith('file://'));
  assert.equal(await assertSafeSavedVideo(projectPath, 'job_test', fileURLToPath(saved.url)), fileURLToPath(saved.url));
  assert.equal(saved.price.currency, 'CNY');
  assert.ok(calls.every((call) => call.options.method !== 'POST'));
  assert.equal(destinations.length, 2);
  assert.ok(destinations.every(([url, address]) => url.startsWith('https://cdn.') && address === '8.8.8.8'));
  assert.ok(calls.every((call) => call.url.startsWith('https://api.vgenv.com/')));
});

test('initial, expiry-refresh, and 403-refresh URLs reject private targets before download', async () => {
  for (const caseName of ['initial', 'expired', 'forbidden']) {
    let gets = 0;
    let downloads = 0;
    const { api, projectPath } = await setup(async () => {
      gets++;
      const unsafe = caseName === 'initial' || (caseName !== 'initial' && gets > 1);
      return json(job('succeeded', { output: {
        url: unsafe ? 'http://127.0.0.1:12345/private' : 'https://cdn.example/video.mp4',
        expires_at: caseName === 'expired' ? '2000-01-01T00:00:00Z' : '2999-01-01T00:00:00Z',
      } }));
    }, {
      lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
      downloadRequestImpl: async () => { downloads++; return { status: 403 }; },
    });
    await assert.rejects(api.download({ projectPath, id: 'job_test' }), /unsafe download URL/);
    assert.equal(downloads, caseName === 'forbidden' ? 1 : 0);
  }
});

test('redirects are validated and DNS resolution is pinned to a public address', async () => {
  const destinations = [];
  const { api, projectPath } = await setup(async () => json(job('succeeded', {
    output: { url: 'https://cdn.example/video.mp4', expires_at: '2999-01-01T00:00:00Z' },
  })), {
    lookupImpl: async (host) => [{ address: host === 'cdn.example' ? '8.8.8.8' : '1.1.1.1', family: 4 }],
    downloadRequestImpl: async (url, address) => {
      destinations.push([url.href, address]);
      return { status: 302, location: 'http://127.0.0.1:12345/private' };
    },
  });
  await assert.rejects(api.download({ projectPath, id: 'job_test' }), /unsafe download URL/);
  assert.deepEqual(destinations, [['https://cdn.example/video.mp4', '8.8.8.8']]);

  let requested = false;
  const unsafeDns = await setup(async () => json(job('succeeded', {
    output: { url: 'https://cdn.example/video.mp4', expires_at: '2999-01-01T00:00:00Z' },
  })), {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }, { address: '10.0.0.5', family: 4 }],
    downloadRequestImpl: async () => { requested = true; return { status: 200, bytes: Buffer.from([1]) }; },
  });
  await assert.rejects(unsafeDns.api.download({ projectPath: unsafeDns.projectPath, id: 'job_test' }), /public addresses/);
  assert.equal(requested, false);
});

test('rejects invalid input before paid create', async () => {
  let calls = 0;
  const { api, projectPath } = await setup(async () => { calls++; return json(job('queued')); });
  await assert.rejects(api.create({ projectPath, input: { ...input, duration: 16 } }), /4–15/);
  await assert.rejects(api.create({ projectPath, input: { ...input, lastFrame: 'data:image/png;base64,AAAA' } }), /requires a first frame/);
  assert.equal(calls, 0);
});

test('provider errors retain status and never enter the successful job registry', async () => {
  const { api, projectPath } = await setup(async () => json({ error: { message: 'insufficient balance' } }, 402));
  await assert.rejects(api.create({ projectPath, input }), /vgenv 402: insufficient balance/);
  assert.ok((await api.list(projectPath)).every((entry) => !entry.id || entry.id.startsWith('pending:')));
});

test('parallel status, cancellation and create updates retain every project job', async () => {
  const fetchImpl = async (url, options) => {
    await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 4)));
    if (options.method === 'POST') return json({ id: 'job_created', status: 'queued' }, 202);
    const id = decodeURIComponent(url.split('/').pop());
    return json({ id, status: options.method === 'DELETE' ? 'cancelled' : id === 'job_cancel' ? 'queued' : 'running' });
  };
  const { api, projectPath } = await setup(fetchImpl);
  const operations = Array.from({ length: 10 }, (_, index) => api.get({ projectPath, id: `job_${index}` }));
  operations.push(api.cancel({ projectPath, id: 'job_cancel' }));
  operations.push(api.create({ projectPath, input }));
  await Promise.all(operations);
  const saved = await api.list(projectPath);
  assert.equal(saved.length, 12);
  assert.ok(Array.from({ length: 10 }, (_, index) => saved.some((item) => item.id === `job_${index}`)).every(Boolean));
  assert.equal(saved.find((item) => item.id === 'job_cancel').status, 'queued');
  assert.equal(saved.find((item) => item.id === 'job_created').status, 'queued');
  const restarted = createVgenvVideo({ fetchImpl });
  assert.equal((await restarted.list(projectPath)).length, 12);
});

test('pending idempotency recovers after restart and project indexes stay isolated', async () => {
  const keys = [];
  let posts = 0;
  const fetchImpl = async (_url, options) => {
    if (options.method === 'POST') {
      keys.push(options.headers['Idempotency-Key']);
      posts++;
      if (posts === 1) throw new Error('uncertain timeout');
      return json({ id: 'job_recovered', status: 'queued' }, 202);
    }
    return json({ id: 'job_other', status: 'running' });
  };
  const { api, projectPath } = await setup(fetchImpl);
  const otherPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-other-project-'));
  await assert.rejects(api.create({ projectPath, input }), /uncertain timeout/);
  await api.get({ projectPath: otherPath, id: 'job_other' });
  const restarted = createVgenvVideo({ fetchImpl });
  restarted.configure('test-secret');
  await restarted.create({ projectPath, input });
  assert.equal(keys[0], keys[1]);
  assert.deepEqual((await restarted.list(projectPath)).map((job) => job.id), ['job_recovered']);
  assert.deepEqual((await restarted.list(otherPath)).map((job) => job.id), ['job_other']);
});

test('concurrent retries for one completed job share one signed download', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let downloads = 0;
  const { api, projectPath } = await setup(async () => json(job('succeeded', {
    output: { url: 'https://cdn.example/video.mp4', expires_at: '2999-01-01T00:00:00Z' },
  })), {
    lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
    downloadRequestImpl: async () => { downloads++; await gate; return { status: 200, bytes: Buffer.from([1]) }; },
  });
  const first = api.download({ projectPath, id: 'job_test' });
  const second = api.download({ projectPath, id: 'job_test' });
  release();
  const results = await Promise.all([first, second]);
  assert.equal(downloads, 1);
  assert.equal(results[0].url, results[1].url);
});

test('production HTTPS transport reaches a local controlled socket with pinned lookup', async () => {
  let accepted = 0;
  const server = net.createServer((socket) => { accepted++; socket.destroy(); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    await assert.rejects(
      defaultDownloadRequest(new URL(`https://cdn.example:${port}/video.mp4`), '127.0.0.1', 4),
      (error) => { assert.notEqual(error.code, 'ERR_INVALID_IP_ADDRESS'); return true; },
    );
    assert.equal(accepted, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('video output refuses symlinked project folders and final files', async () => {
  for (const location of ['media', 'videos', 'file']) {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-outside-'));
    const { api, projectPath } = await setup(async () => json(job('succeeded', {
      output: { url: 'https://cdn.example/video.mp4', expires_at: '2999-01-01T00:00:00Z' },
    })), {
      lookupImpl: async () => [{ address: '8.8.8.8', family: 4 }],
      downloadRequestImpl: async () => ({ status: 200, bytes: Buffer.from('video bytes') }),
    });
    const media = path.join(projectPath, 'media');
    const videos = path.join(media, 'videos');
    const dest = path.join(videos, 'vgenv-job_test.mp4');
    if (location === 'media') await fs.symlink(outside, media, 'dir');
    if (location === 'videos') {
      await fs.mkdir(media);
      await fs.symlink(outside, videos, 'dir');
    }
    let externalFile;
    if (location === 'file') {
      await fs.mkdir(videos, { recursive: true });
      externalFile = path.join(outside, 'private.mp4');
      await fs.writeFile(externalFile, 'original');
      await fs.symlink(externalFile, dest);
    }
    await assert.rejects(api.download({ projectPath, id: 'job_test' }), /escapes the selected project/);
    await assert.rejects(assertSafeSavedVideo(projectPath, 'job_test', dest), /escapes the selected project/);
    if (externalFile) assert.equal(await fs.readFile(externalFile, 'utf8'), 'original');
    else assert.deepEqual(await fs.readdir(outside), []);
  }
});
