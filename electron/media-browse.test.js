const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { registerMediaBrowseIpc, kindFromName } = require('./media-browse');

const makeIpc = () => {
  const handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  };
};

test('media:listDir lists files and folders read-only, skipping hidden entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'media-browse-'));
  fs.writeFileSync(path.join(dir, 'clip.MOV'), 'x');
  fs.writeFileSync(path.join(dir, 'still.png'), 'xy');
  fs.writeFileSync(path.join(dir, '.hidden'), '');
  fs.mkdirSync(path.join(dir, 'Sub'));
  const ipc = makeIpc();
  registerMediaBrowseIpc(ipc);
  const result = await ipc.invoke('media:listDir', { dirPath: dir });
  assert.equal(result.ok, true);
  const byName = Object.fromEntries(result.entries.map((entry) => [entry.name, entry]));
  assert.deepEqual(Object.keys(byName).sort(), ['Sub', 'clip.MOV', 'still.png']);
  assert.equal(byName['clip.MOV'].kind, 'video');
  assert.equal(byName['still.png'].size, 2);
  assert.ok(byName['still.png'].url.startsWith('file://'));
  assert.equal(byName.Sub.isDir, true);
  assert.equal(byName.Sub.kind, 'folder');
  assert.equal(result.parent, path.dirname(path.resolve(dir)));
  const hidden = await ipc.invoke('media:listDir', { dirPath: dir, showHidden: true });
  assert.ok(hidden.entries.some((entry) => entry.name === '.hidden'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('media:listDir reports errors instead of throwing', async () => {
  const ipc = makeIpc();
  registerMediaBrowseIpc(ipc);
  const result = await ipc.invoke('media:listDir', { dirPath: path.join(os.tmpdir(), 'does-not-exist-' + Date.now()) });
  assert.equal(result.ok, false);
  assert.ok(result.error);
});

test('media:places falls back to home-relative folders', async () => {
  const ipc = makeIpc();
  registerMediaBrowseIpc(ipc);
  const result = await ipc.invoke('media:places');
  assert.equal(result.ok, true);
  assert.equal(result.home, os.homedir());
  assert.equal(result.downloads, path.join(os.homedir(), 'Downloads'));
  assert.equal(kindFromName('a.WAV'), 'audio');
  assert.equal(kindFromName('readme'), 'other');
});
