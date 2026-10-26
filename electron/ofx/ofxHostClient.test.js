'use strict';

// Tests for the OFX host client. Unit tests use a fake sidecar (a Node script that
// speaks the same framed protocol); integration tests use the native binary and the
// installed plugins and skip gracefully when either is missing.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const {
  OfxHostClient,
  OfxHostError,
  resolveOfxHostBinary,
  ofxHostBinaryCandidates,
  normalizeFormat,
  bytesPerPixel,
} = require('./ofxHostClient');

delete process.env.AVPE_OFX_HOST_PATH;

const repoRoot = path.resolve(__dirname, '..', '..');
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'avpe-ofx-test-'));
process.on('exit', () => {
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

// ---- fake sidecar ---------------------------------------------------------------

const FAKE_HOST = `#!/usr/bin/env node
'use strict';
let buf = Buffer.alloc(0);
let expect = null;
const send = (h, payload) => {
  if (payload) h.binarySize = payload.length;
  process.stdout.write(JSON.stringify(h) + '\\n');
  if (payload) process.stdout.write(payload);
};
send({ event: 'ready', id: null, version: 'fake', protocol: 1 });
const handle = (h, payload) => {
  if (h.cmd === 'status') return send({ id: h.id, ok: true, version: 'fake', protocol: 1, instances: [] });
  if (h.cmd === 'render') {
    const out = Buffer.from(payload.subarray(0, h.width * h.height * 4));
    for (let i = 0; i < out.length; i++) if (i % 4 !== 3) out[i] = 255 - out[i];
    return send({ id: h.id, ok: true, width: h.width, height: h.height, format: 'rgba8', echoParams: h.params, frames: h.frames, renderMs: 1 }, out);
  }
  if (h.cmd === 'bake') {
    for (let f = 1; f <= 3; f++) send({ id: h.id, event: 'progress', frame: f, totalFrames: 3, percent: f * 33.3 });
    return send({ id: h.id, ok: true, frames: 3, output: h.output });
  }
  if (h.cmd === 'hang') return; // never answers
  if (h.cmd === 'crash') {
    send({ id: h.id, ok: false, fatal: true, crashed: true, error: 'OFX host crashed (signal 11) in fake' });
    process.exit(70);
  }
  if (h.cmd === 'fail') return send({ id: h.id, ok: false, error: 'plugin said no', warnings: ['w1'] });
  if (h.cmd === 'shutdown') { send({ id: h.id, ok: true }); process.exit(0); }
  send({ id: h.id, ok: false, error: 'unknown command: ' + h.cmd });
};
process.stdin.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  while (true) {
    if (expect) {
      if (buf.length < expect.size) return;
      const payload = buf.subarray(0, expect.size);
      buf = buf.subarray(expect.size);
      const h = expect.h;
      expect = null;
      handle(h, payload);
      continue;
    }
    const nl = buf.indexOf(10);
    if (nl < 0) return;
    const h = JSON.parse(buf.subarray(0, nl).toString());
    buf = buf.subarray(nl + 1);
    if (h.binarySize > 0) expect = { h, size: h.binarySize };
    else handle(h, null);
  }
});
`;

const fakeHostPath = path.join(tmpRoot, 'fake-ofx-host');
fs.writeFileSync(fakeHostPath, FAKE_HOST, { mode: 0o755 });

function fakeClient(extra = {}) {
  return new OfxHostClient({ binaryPath: fakeHostPath, ...extra });
}

// ---- unit tests ------------------------------------------------------------------

test('normalizeFormat and bytesPerPixel', () => {
  assert.equal(normalizeFormat(), 'rgba32f');
  assert.equal(normalizeFormat('float'), 'rgba32f');
  assert.equal(normalizeFormat('RGBA8'), 'rgba8');
  assert.equal(normalizeFormat('rgba64le'), 'rgba16');
  assert.equal(bytesPerPixel('rgba32f'), 16);
  assert.equal(bytesPerPixel('rgba16'), 8);
  assert.equal(bytesPerPixel('rgba8'), 4);
  assert.throws(() => normalizeFormat('yuv420p'), /Unsupported pixel format/);
});

test('binary candidates include packaged and dev locations', () => {
  const candidates = ofxHostBinaryCandidates({ resourcesPath: '/Res', appPath: '/App' });
  assert.ok(candidates.includes(path.join('/Res', 'ofx-host', 'avpe-ofx-host')));
  assert.ok(candidates.includes(path.join('/App', 'native', 'ofx-host', 'build', 'avpe-ofx-host')));
  assert.equal(resolveOfxHostBinary({ binaryPath: fakeHostPath }), fakeHostPath);
});

test('missing binary rejects with a helpful error', async () => {
  const client = new OfxHostClient({ binaryPath: path.join(tmpRoot, 'nope') });
  client._binaryPath = null;
  Object.defineProperty(client, 'binaryPath', { get: () => null });
  await assert.rejects(client.request('status'), /binary not found/);
  client.dispose();
});

test('renderFrame validates arguments before talking to the host', async () => {
  const client = fakeClient();
  await assert.rejects(client.renderFrame({ width: 2, height: 2, pixels: Buffer.alloc(64) }), /pluginId/);
  await assert.rejects(client.renderFrame({ pluginId: 'x', width: 0, height: 2, pixels: Buffer.alloc(64) }), /width/);
  await assert.rejects(
    client.renderFrame({ pluginId: 'x', width: 2, height: 2, pixels: Buffer.alloc(10), format: 'rgba8' }),
    /must be 16 bytes/,
  );
  assert.equal(client.isRunning(), false, 'no process should be spawned for invalid input');
  client.dispose();
});

test('framed protocol round trip with binary payload (fake host)', async () => {
  const client = fakeClient();
  try {
    const pixels = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 255, 255, 255, 255, 255, 1, 2, 3, 4]);
    const res = await client.renderFrame({
      pluginId: 'com.test.invert',
      params: { amount: 0.5 },
      width: 2,
      height: 2,
      format: 'rgba8',
      pixels,
      frames: [{ time: -1, pixels: new Uint8Array(16) }],
    });
    assert.equal(res.ok, true);
    assert.deepEqual([...res.pixels.subarray(0, 4)], [245, 235, 225, 255]);
    assert.deepEqual(res.echoParams, { amount: 0.5 });
    assert.deepEqual(res.frames, [-1]);
    const status = await client.status();
    assert.equal(status.running, true);
    assert.equal(status.version, 'fake');
  } finally {
    client.dispose();
  }
});

test('host errors reject with OfxHostError and keep the process alive', async () => {
  const client = fakeClient();
  try {
    await assert.rejects(client.request('fail'), (err) => {
      assert.ok(err instanceof OfxHostError);
      assert.equal(err.message, 'plugin said no');
      assert.deepEqual(err.details.warnings, ['w1']);
      return true;
    });
    const pid = client.child.pid;
    await client.request('status');
    assert.equal(client.child.pid, pid);
  } finally {
    client.dispose();
  }
});

test('crash is reported and the sidecar restarts on the next request', async () => {
  const client = fakeClient();
  try {
    await client.request('status');
    const firstPid = client.child.pid;
    await assert.rejects(client.request('crash'), (err) => {
      assert.match(err.message, /crashed/);
      assert.equal(err.crashed, true);
      return true;
    });
    const res = await client.request('status');
    assert.equal(res.header.ok, true);
    assert.notEqual(client.child.pid, firstPid);
    const status = await client.status();
    assert.equal(status.restarts, 1);
  } finally {
    client.dispose();
  }
});

test('timeouts kill a hung sidecar; queued requests still complete', async () => {
  const client = fakeClient();
  try {
    const hung = client.request('hang', {}, null, { timeoutMs: 300 });
    const next = client.request('status');
    await assert.rejects(hung, (err) => err.timeout === true);
    const res = await next;
    assert.equal(res.header.ok, true);
  } finally {
    client.dispose();
  }
});

test('params are resent after a restart for the same instance', async () => {
  const client = fakeClient();
  try {
    const px = new Uint8Array(4);
    await client.renderFrame({ pluginId: 'p', instanceId: 'i1', params: { a: 1, b: 2 }, width: 1, height: 1, format: 'rgba8', pixels: px });
    await assert.rejects(client.request('crash'));
    const res = await client.renderFrame({ pluginId: 'p', instanceId: 'i1', params: { b: 3 }, width: 1, height: 1, format: 'rgba8', pixels: px });
    assert.deepEqual(res.echoParams, { a: 1, b: 3 });
    const res2 = await client.renderFrame({ pluginId: 'p', instanceId: 'i1', params: { c: 4 }, width: 1, height: 1, format: 'rgba8', pixels: px });
    assert.deepEqual(res2.echoParams, { c: 4 }, 'only deltas are sent while the process lives');
  } finally {
    client.dispose();
  }
});

test('bakeVideo forwards progress events (fake host)', async () => {
  const client = fakeClient();
  try {
    const progress = [];
    const res = await client.bakeVideo({ input: '/in.mov', output: '/out.mov', chain: [] }, (p) => progress.push(p));
    assert.equal(res.ok, true);
    assert.equal(res.frames, 3);
    assert.equal(progress.length, 3);
    assert.equal(progress[2].frame, 3);
    assert.equal(progress[0].id, undefined);
  } finally {
    client.dispose();
  }
});

// ---- integration tests (native binary + installed plugins) ---------------------

const nativeBinary = resolveOfxHostBinary({ appPath: repoRoot });
const OPTICS_LAB = 'com.buckswood.optics.lab';

function gradient(width, height) {
  const px = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      px[i] = x / (width - 1);
      px[i + 1] = y / (height - 1);
      px[i + 2] = 0.25;
      px[i + 3] = 1;
    }
  }
  return px;
}

test('native host integration', { skip: nativeBinary ? false : 'avpe-ofx-host not built (make -C native/ofx-host)', timeout: 300000 }, async (t) => {
  const client = new OfxHostClient({
    binaryPath: nativeBinary,
    scanCacheFile: path.join(tmpRoot, 'scan-cache.json'),
  });
  try {
    const status = await client.request('status');
    assert.equal(status.header.ok, true);
    assert.equal(status.header.protocol, 1);
    assert.equal(status.header.hostName, 'org.avpe.ofxhost');

    // Error handling: malformed payload size is rejected without killing the host.
    const pid = client.child.pid;
    await assert.rejects(
      client.request('render', { pluginId: OPTICS_LAB, width: 4, height: 4, format: 'rgba8' }, Buffer.alloc(3)),
      /binary payload/,
    );
    await assert.rejects(client.request('nonsense'), /unknown command/);
    assert.equal(client.child.pid, pid);

    const scan = await client.scanPlugins(undefined, { filter: 'com.buckswood.' });
    assert.ok(Array.isArray(scan.plugins));
    for (const p of scan.plugins.filter((q) => q.loaded)) {
      assert.equal(typeof p.id, 'string');
      assert.ok(Array.isArray(p.params));
      for (const param of p.params) {
        assert.equal(typeof param.name, 'string');
        assert.equal(typeof param.type, 'string');
      }
    }
    const optics = scan.plugins.find((p) => p.id === OPTICS_LAB);
    if (!optics) {
      t.diagnostic('Buckswood Post Plugins Optics Lab not installed; skipping render checks');
      return;
    }
    assert.equal(optics.supported, true);
    const preset = optics.params.find((p) => p.name === 'preset');
    assert.ok(preset && preset.type === 'choice' && preset.options.length > 6);

    const W = 64;
    const H = 36;
    const src = gradient(W, H);
    const res = await client.renderFrame({
      pluginId: OPTICS_LAB,
      instanceId: 'test:optics',
      params: { preset: 6 },
      width: W,
      height: H,
      format: 'rgba32f',
      pixels: src,
    });
    assert.equal(res.width, W);
    assert.equal(res.pixels.length, W * H * 16);
    const out = new Float32Array(res.pixels.buffer, res.pixels.byteOffset, res.pixels.byteLength / 4);
    let diff = 0;
    for (let i = 0; i < out.length; i += 1) {
      assert.ok(Number.isFinite(out[i]), 'output must not contain NaN/Inf');
      diff += Math.abs(out[i] - src[i]);
    }
    assert.ok(diff > 0, 'Optics Lab should change the image');
    assert.equal(res.nonFinite, 0);

    // Same instance, changed parameter, 8-bit in / 8-bit out.
    const bytes = Buffer.alloc(W * H * 4);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.round(Math.min(1, src[i]) * 255);
    const res8 = await client.renderFrame({
      pluginId: OPTICS_LAB,
      instanceId: 'test:optics',
      params: { preset: 'Fast Vintage' },
      width: W,
      height: H,
      format: 'rgba8',
      pixels: bytes,
    });
    assert.equal(res8.created, false, 'instance should be reused');
    assert.deepEqual(res8.changedParams, ['preset']);
    assert.equal(res8.pixels.length, W * H * 4);

    const unknown = await client.renderFrame({
      pluginId: OPTICS_LAB,
      instanceId: 'test:optics',
      params: { notAParam: 1 },
      width: W,
      height: H,
      format: 'rgba8',
      pixels: bytes,
    });
    assert.ok(unknown.warnings.some((w) => w.includes('notAParam')));
    await client.destroyInstance('test:optics');

    // Bake a tiny clip when ffmpeg is available.
    const ffmpeg = process.env.FFMPEG || 'ffmpeg';
    const probe = spawnSync(ffmpeg, ['-version']);
    if (probe.status !== 0) {
      t.diagnostic('ffmpeg not found; skipping bake');
      return;
    }
    const input = path.join(tmpRoot, 'in.mp4');
    const output = path.join(tmpRoot, 'out.mov');
    const gen = spawnSync(ffmpeg, ['-y', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=96x54:rate=12:duration=1', '-pix_fmt', 'yuv420p', input]);
    if (gen.status !== 0) {
      t.diagnostic('could not create test clip; skipping bake');
      return;
    }
    const progress = [];
    const baked = await client.bakeVideo(
      { input, output, ffmpegPath: ffmpeg, chain: [{ pluginId: OPTICS_LAB, params: { preset: 6 } }], codec: 'prores_hq' },
      (p) => progress.push(p),
    );
    assert.equal(baked.ok, true);
    assert.equal(baked.frames, 12);
    assert.ok(fs.statSync(output).size > 0);
    assert.ok(progress.length >= 1);
  } finally {
    client.dispose();
  }
});
