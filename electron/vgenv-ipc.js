const fs = require('fs/promises');
const path = require('path');
const { pathToFileURL } = require('url');

// This adapter is deliberately reachable only from the studio's main frame and
// the currently selected local project. Keep the checks at each registered IPC
// handler, not only in the renderer or its preload facade.
function isTrustedStudioUrl(url, packagedStudioPath) {
  if (url === pathToFileURL(path.resolve(packagedStudioPath)).href) return true;
  try {
    const target = new URL(url);
    return target.protocol === 'http:' &&
      !target.username && !target.password &&
      ['localhost', '127.0.0.1'].includes(target.hostname) &&
      ['5173', '5174'].includes(target.port) &&
      target.pathname === '/studio.html' && !target.search && !target.hash;
  } catch { return false; }
}

function createVgenvIpcSecurity(packagedStudioPath) {
  const windows = new Map();
  const roots = new Map();

  const assertSender = (event) => {
    const sender = event?.sender;
    const frame = event?.senderFrame;
    const expected = windows.get(sender?.id);
    if (!sender || !frame || frame !== sender.mainFrame || !expected ||
        frame.url !== expected || sender.getURL() !== expected) {
      throw new Error('vgenv is available only from the active studio main frame.');
    }
  };

  return {
    registerWindow: (webContents) => {
      windows.set(webContents.id, null);
      webContents.once('destroyed', () => { windows.delete(webContents.id); roots.delete(webContents.id); });
    },
    setStudioUrl: (webContents, studioUrl) => {
      if (!windows.has(webContents.id) || !isTrustedStudioUrl(studioUrl, packagedStudioPath)) {
        throw new Error('Untrusted studio URL.');
      }
      windows.set(webContents.id, studioUrl);
    },
    isStudioNavigation: (webContents, url) => windows.get(webContents.id) === url,
    assertSender,
    selectProject: async (event, projectPath) => {
      assertSender(event);
      if (typeof projectPath !== 'string') throw new Error('Invalid project folder.');
      const root = await fs.realpath(projectPath);
      assertSender(event);
      roots.set(event.sender.id, root);
      return root;
    },
    noteProjectLoaded: async (event, projectPath) => {
      assertSender(event);
      const root = await fs.realpath(projectPath);
      assertSender(event);
      if (roots.get(event.sender.id) !== root) roots.delete(event.sender.id);
    },
    assertProject: async (event, projectPath) => {
      assertSender(event);
      if (typeof projectPath !== 'string' || !roots.has(event.sender.id)) {
        throw new Error('Select a local project before using vgenv.');
      }
      const root = await fs.realpath(projectPath);
      assertSender(event);
      if (root !== roots.get(event.sender.id)) throw new Error('vgenv project does not match the active local project.');
      return root;
    },
  };
}

function registerVgenvIpc(ipcMain, video, security, attachDownload, selectFolder) {
  ipcMain.handle('vgenv:configure', (event, key) => { security.assertSender(event); return video.configure(key); });
  ipcMain.handle('vgenv:ready', (event) => { security.assertSender(event); return video.ready(); });
  ipcMain.handle('vgenv:projectReady', async (event, projectPath) => {
    security.assertSender(event);
    try { await security.assertProject(event, projectPath); return true; }
    catch { return false; }
  });
  ipcMain.handle('vgenv:selectProject', async (event, projectPath) => {
    security.assertSender(event);
    const selected = await selectFolder();
    if (!selected) return false;
    if (await fs.realpath(selected) !== await fs.realpath(projectPath)) {
      throw new Error('Select the currently open project folder for vgenv.');
    }
    await security.selectProject(event, selected);
    return true;
  });
  ipcMain.handle('vgenv:list', async (event, projectPath) => video.list(await security.assertProject(event, projectPath)));
  for (const method of ['create', 'get', 'cancel', 'download']) {
    ipcMain.handle(`vgenv:${method}`, async (event, payload) => {
      const projectPath = await security.assertProject(event, payload?.projectPath);
      const safePayload = { ...payload, projectPath };
      if (method === 'download') return attachDownload(safePayload);
      return video[method](safePayload);
    });
  }
}

function protectStudioNavigation(webContents, security, openExternal) {
  webContents.on('will-navigate', (event, url) => {
    if (!security.isStudioNavigation(webContents, url)) event.preventDefault();
  });
  webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https:')) openExternal(url);
    return { action: 'deny' };
  });
}

module.exports = { createVgenvIpcSecurity, registerVgenvIpc, isTrustedStudioUrl, protectStudioNavigation };
