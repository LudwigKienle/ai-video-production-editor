const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { createVgenvIpcSecurity, registerVgenvIpc, isTrustedStudioUrl, protectStudioNavigation } = require('./vgenv-ipc');

const studio = '/app/dist/studio.html';
const studioUrl = 'file:///app/dist/studio.html';

test('vgenv IPC rejects unknown frames, navigation and unselected project roots', async () => {
  const handlers = new Map();
  const ipc = { handle: (name, fn) => handlers.set(name, fn) };
  const calls = [];
  const video = {
    configure: () => ({ ready: true }), ready: () => true,
    list: async (projectPath) => { calls.push(['list', projectPath]); return []; },
    create: async (payload) => { calls.push(['create', payload.projectPath]); return { id: 'job_one' }; },
    get: async (payload) => { calls.push(['get', payload.projectPath]); return { id: payload.id }; },
    cancel: async (payload) => { calls.push(['cancel', payload.projectPath]); return { id: payload.id }; },
  };
  const security = createVgenvIpcSecurity(studio);
  let selectedByDialog;
  registerVgenvIpc(ipc, video, security, async (payload) => { calls.push(['download', payload.projectPath]); return {}; }, async () => selectedByDialog);
  const sender = Object.assign(new EventEmitter(), { id: 7, mainFrame: { url: studioUrl }, getURL: () => studioUrl });
  const event = { sender, senderFrame: sender.mainFrame };
  security.registerWindow(sender);
  security.setStudioUrl(sender, studioUrl);
  const selected = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-ipc-selected-'));
  const other = await fs.mkdtemp(path.join(os.tmpdir(), 'vgenv-ipc-other-'));
  await assert.rejects(handlers.get('vgenv:create')(event, { projectPath: selected, input: {} }), /Select a local project/);
  assert.equal(await handlers.get('vgenv:projectReady')(event, selected), false);
  selectedByDialog = other;
  await assert.rejects(handlers.get('vgenv:selectProject')(event, selected), /currently open project/);
  selectedByDialog = selected;
  assert.equal(await handlers.get('vgenv:selectProject')(event, selected), true);
  assert.equal(await handlers.get('vgenv:projectReady')(event, selected), true);
  for (const method of ['create', 'get', 'cancel', 'download']) {
    await assert.rejects(handlers.get(`vgenv:${method}`)(event, { projectPath: other, id: 'job_one' }), /does not match/);
    const result = await handlers.get(`vgenv:${method}`)(event, { projectPath: selected, id: 'job_one' });
    assert.ok(result);
  }
  await security.noteProjectLoaded(event, other);
  assert.equal(await handlers.get('vgenv:projectReady')(event, selected), false);
  assert.equal(await handlers.get('vgenv:projectReady')(event, other), false);
  await assert.rejects(handlers.get('vgenv:list')({ sender, senderFrame: { url: studioUrl } }, selected), /main frame/);
  sender.getURL = () => 'https://evil.example/';
  await assert.rejects(handlers.get('vgenv:cancel')(event, { projectPath: selected, id: 'job_one' }), /main frame/);
  assert.equal(calls.length, 4);
  assert.equal(security.isStudioNavigation(sender, 'https://evil.example/'), false);
});

test('only the packaged studio or fixed local development URLs can be trusted', () => {
  assert.equal(isTrustedStudioUrl(studioUrl, studio), true);
  assert.equal(isTrustedStudioUrl('http://localhost:5173/studio.html', studio), true);
  assert.equal(isTrustedStudioUrl('http://127.0.0.1:5174/studio.html', studio), true);
  assert.equal(isTrustedStudioUrl('http://evil.example:5173/studio.html', studio), false);
  assert.equal(isTrustedStudioUrl('file:///tmp/studio.html', studio), false);
  assert.equal(isTrustedStudioUrl('http://localhost:5173/other.html', studio), false);
});

test('installed window navigation guard blocks unknown main-frame destinations and new windows', () => {
  const security = createVgenvIpcSecurity(studio);
  const contents = Object.assign(new EventEmitter(), {
    id: 8,
    setWindowOpenHandler(handler) { this.openHandler = handler; },
  });
  security.registerWindow(contents);
  security.setStudioUrl(contents, studioUrl);
  const opened = [];
  protectStudioNavigation(contents, security, (url) => opened.push(url));
  let blocked = false;
  contents.emit('will-navigate', { preventDefault: () => { blocked = true; } }, 'https://evil.example/');
  assert.equal(blocked, true);
  blocked = false;
  contents.emit('will-navigate', { preventDefault: () => { blocked = true; } }, studioUrl);
  assert.equal(blocked, false);
  assert.deepEqual(contents.openHandler({ url: 'https://example.org/' }), { action: 'deny' });
  assert.deepEqual(opened, ['https://example.org/']);
  assert.deepEqual(contents.openHandler({ url: 'file:///tmp/other.html' }), { action: 'deny' });
});
