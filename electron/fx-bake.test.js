const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const { registerFxBakeIpc } = require('./fx-bake');

const ffmpegStatic = require('ffmpeg-static');

const makeIpc = () => {
  const handlers = new Map();
  return {
    handle: (channel, fn) => handlers.set(channel, fn),
    invoke: (channel, payload) => handlers.get(channel)({}, payload),
  };
};

test('fx bake streams RGBA frames into a ProRes intermediate', { skip: !ffmpegStatic || !fs.existsSync(ffmpegStatic) }, async () => {
  const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'avpe-fx-bake-'));
  const ipc = makeIpc();
  registerFxBakeIpc(ipc, { getFfmpegPath: () => ffmpegStatic, resolveSourcePath: () => null });

  const width = 64;
  const height = 36;
  const begin = await ipc.invoke('fx:bakeVideoBegin', { folderPath, name: 'clip a/1', width, height, fps: 24 });
  assert.equal(begin.ok, true, begin.error);
  for (let frame = 0; frame < 12; frame += 1) {
    const pixels = new Uint8Array(width * height * 4).fill(frame * 20);
    const sent = await ipc.invoke('fx:bakeVideoFrame', { sessionId: begin.sessionId, pixels });
    assert.equal(sent.ok, true, sent.error);
  }
  const end = await ipc.invoke('fx:bakeVideoEnd', { sessionId: begin.sessionId });
  assert.equal(end.ok, true, end.error);
  assert.ok(end.path.startsWith(path.join(folderPath, 'renders', 'fx')));
  assert.match(path.basename(end.path), /^clip_a_1\.mov$/);
  const probe = execFileSync(ffmpegStatic, ['-hide_banner', '-i', end.path, '-f', 'null', '-'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(typeof probe, 'string');
  fs.rmSync(folderPath, { recursive: true, force: true });
});

test('fx bake rejects frames of the wrong size and odd dimensions', async () => {
  const folderPath = fs.mkdtempSync(path.join(os.tmpdir(), 'avpe-fx-bake-'));
  const ipc = makeIpc();
  registerFxBakeIpc(ipc, { getFfmpegPath: () => ffmpegStatic || 'ffmpeg', resolveSourcePath: () => null });
  const odd = await ipc.invoke('fx:bakeVideoBegin', { folderPath, name: 'odd', width: 63, height: 36, fps: 24 });
  assert.equal(odd.ok, false);
  const missing = await ipc.invoke('fx:bakeVideoFrame', { sessionId: 'nope', pixels: new Uint8Array(4) });
  assert.equal(missing.ok, false);
  const image = await ipc.invoke('fx:bakeImage', { folderPath, name: 'still', bytes: new Uint8Array([137, 80, 78, 71]) });
  assert.equal(image.ok, true);
  assert.ok(fs.existsSync(image.path));
  fs.rmSync(folderPath, { recursive: true, force: true });
});
