const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createVgenvVideo } = require('./vgenv-video');

const input = { prompt: 'A dog runs across a field', duration: 5, resolution: '480p', aspectRatio: '16:9', promptMode: 'raw' };
const job = (status, extra = {}) => ({ id: 'job_test', status, price: { currency: 'CNY', amount_micros: 123456 }, ...extra });
const json = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
const setup = async (fetchImpl) => {
  const projectPath = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-test-'));
  const api = createVgenvVideo({ fetchImpl });
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
  const { api, projectPath } = await setup(async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('https://api.vgenv.com/')) return json(job('succeeded', { output: { url: 'https://cdn.example/video.mp4', expires_at: '2000-01-01T00:00:00Z' } }));
    downloads++;
    if (downloads === 1) return { ok: false, status: 503 };
    return { ok: true, status: 200, arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer };
  });
  await assert.rejects(api.download({ projectPath, id: 'job_test' }), /retry download/);
  const saved = await api.download({ projectPath, id: 'job_test' });
  assert.ok(saved.url.startsWith('file://'));
  assert.equal(saved.price.currency, 'CNY');
  assert.ok(calls.every((call) => call.options.method !== 'POST'));
  assert.ok(calls.filter((call) => call.url.startsWith('https://cdn.')).every((call) => !call.options.headers));
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
