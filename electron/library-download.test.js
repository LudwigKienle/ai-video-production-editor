const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerLibrary3dIpc, checkUrl } = require('./library-download');

const makeIpc = () => {
  const handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  };
};

test('library3d: only public https URLs', () => {
  assert.equal(checkUrl('https://api.polyhaven.com/assets').host, 'api.polyhaven.com');
  for (const bad of ['http://api.polyhaven.com', 'https://localhost/x', 'https://127.0.0.1/x', 'https://192.168.1.2/x', 'https://10.0.0.1/x', 'https://user:pw@example.com/x', 'file:///etc/passwd', 'https://[::1]/x']) {
    assert.throws(() => checkUrl(bad), undefined, bad);
  }
});

test('library3d: requests carry the app User-Agent and only allowed headers', async () => {
  const ipc = makeIpc();
  const seen = [];
  const fetchImpl = async (url, init) => {
    seen.push({ url, init });
    return { ok: true, status: 200, url, headers: { get: () => '3' }, json: async () => ({ hello: 1 }), arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer };
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'library3d-'));
  registerLibrary3dIpc(ipc, { getPath: () => dir, version: '9.9.9', fetchImpl });
  const json = await ipc.invoke('library3d:fetchJson', { url: 'https://api.polyhaven.com/types', headers: { Authorization: 'Token x', Cookie: 'no' } });
  assert.deepEqual(json, { ok: true, status: 200, data: { hello: 1 } });
  assert.match(seen[0].init.headers['User-Agent'], /^AI-Video-Production-Editor\/9\.9\.9/);
  assert.equal(seen[0].init.headers.Authorization, 'Token x');
  assert.equal(seen[0].init.headers.Cookie, undefined);
  const bytes = await ipc.invoke('library3d:fetchBytes', { url: 'https://dl.polyhaven.org/a.hdr' });
  assert.deepEqual([...bytes.data], [1, 2, 3]);
  const local = await ipc.invoke('library3d:fetchBytes', { url: 'https://localhost/a.hdr' });
  assert.equal(local.ok, false);
  const cache = await ipc.invoke('library3d:cacheDir');
  assert.equal(cache.path, path.join(dir, 'library3d-cache'));
  assert.ok(fs.existsSync(cache.path));
});
