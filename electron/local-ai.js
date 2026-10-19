const { BrowserWindow, dialog, shell } = require('electron');
const http = require('http');
const https = require('https');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const {
  isAllowedLocalUrl,
  isAllowedDownloadUrl,
  shouldSendHfToken,
  resolveInsideRoot,
  parseNdjsonChunk,
  totalFromHeaders,
} = require('./local-ai-utils');

/**
 * Local AI bridge for the renderer:
 * - requests to local model servers (Ollama, LM Studio, ComfyUI, Draw Things) from the
 *   main process, so servers without CORS headers work;
 * - streamed requests (Ollama model pulls) with progress events;
 * - resumable model downloads from Hugging Face into a models folder (ComfyUI layout).
 */

const broadcast = (channel, payload) => {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send(channel, payload);
  }
};

const clientFor = (url) => (url.protocol === 'https:' ? https : http);

const request = ({ url, method = 'GET', headers = {}, body, timeoutMs = 120000 } = {}) => new Promise((resolve) => {
  if (!isAllowedLocalUrl(url)) {
    resolve({ ok: false, status: 0, error: 'Only local or LAN addresses are allowed.' });
    return;
  }
  const target = new URL(url);
  const payload = body === undefined || body === null ? null : (typeof body === 'string' ? body : JSON.stringify(body));
  const req = clientFor(target).request(target, {
    method,
    headers: {
      ...(payload !== null ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {}),
      ...headers,
    },
    timeout: timeoutMs,
  }, (res) => {
    const chunks = [];
    res.on('data', (chunk) => chunks.push(chunk));
    res.on('end', () => {
      const status = res.statusCode || 0;
      const contentType = String(res.headers['content-type'] || '');
      const buffer = Buffer.concat(chunks);
      const binary = /^image\/|octet-stream/.test(contentType);
      resolve({
        ok: status >= 200 && status < 300,
        status,
        contentType,
        body: binary ? undefined : buffer.toString('utf8'),
        base64: binary ? buffer.toString('base64') : undefined,
      });
    });
  });
  req.on('timeout', () => req.destroy(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)} s`)));
  req.on('error', (error) => resolve({ ok: false, status: 0, error: error.message }));
  if (payload !== null) req.write(payload);
  req.end();
});

const streams = new Map();

/** POST and forward each NDJSON line as a `localAi:streamEvent` ({ id, data } / { id, done } / { id, error }). */
const stream = ({ id, url, method = 'POST', body } = {}) => new Promise((resolve) => {
  if (!id) {
    resolve({ ok: false, error: 'Missing stream id.' });
    return;
  }
  if (!isAllowedLocalUrl(url)) {
    resolve({ ok: false, error: 'Only local or LAN addresses are allowed.' });
    return;
  }
  const target = new URL(url);
  const payload = body === undefined ? '' : JSON.stringify(body);
  const req = clientFor(target).request(target, {
    method,
    headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
  }, (res) => {
    if ((res.statusCode || 0) >= 400) {
      let text = '';
      res.on('data', (chunk) => { text += chunk; });
      res.on('end', () => {
        streams.delete(id);
        broadcast('localAi:streamEvent', { id, error: text || `HTTP ${res.statusCode}` });
      });
      return;
    }
    let buffer = '';
    res.setEncoding('utf8');
    res.on('data', (chunk) => {
      const parsed = parseNdjsonChunk(buffer + chunk);
      buffer = parsed.rest;
      for (const data of parsed.items) broadcast('localAi:streamEvent', { id, data });
    });
    res.on('end', () => {
      streams.delete(id);
      const parsed = parseNdjsonChunk(`${buffer}\n`);
      for (const data of parsed.items) broadcast('localAi:streamEvent', { id, data });
      broadcast('localAi:streamEvent', { id, done: true });
    });
  });
  req.on('error', (error) => {
    streams.delete(id);
    broadcast('localAi:streamEvent', { id, error: error.message });
  });
  streams.set(id, req);
  req.write(payload);
  req.end();
  resolve({ ok: true });
});

const cancelStream = ({ id } = {}) => {
  const req = streams.get(id);
  if (req) {
    req.destroy();
    streams.delete(id);
  }
  return { ok: true };
};

// ---------------------------------------------------------------------------
// Model downloads
// ---------------------------------------------------------------------------

const downloads = new Map();

const emitProgress = (payload) => broadcast('localModels:progress', payload);

/** GET following redirects (the hub sends LFS files to a CDN); resolves with the final response. */
const openDownload = (url, headers, token, redirects = 0) => new Promise((resolve, reject) => {
  const target = new URL(url);
  const req = https.get(target, {
    headers: {
      'User-Agent': 'AI-Video-Production-Editor',
      ...headers,
      ...(token && shouldSendHfToken(url) ? { Authorization: `Bearer ${token}` } : {}),
    },
  }, (res) => {
    const status = res.statusCode || 0;
    if (status >= 300 && status < 400 && res.headers.location) {
      res.resume();
      if (redirects > 8) {
        reject(new Error('Too many redirects.'));
        return;
      }
      const next = new URL(res.headers.location, target).toString();
      if (!next.startsWith('https:')) {
        reject(new Error('Refusing a non-https redirect.'));
        return;
      }
      openDownload(next, headers, token, redirects + 1).then(resolve, reject);
      return;
    }
    resolve({ req, res });
  });
  req.on('error', reject);
});

/**
 * Download one file to <root>/<relativePath>. Writes to "<file>.part" and resumes it on
 * the next try; the file only gets its final name once it is complete.
 */
const download = async ({ id, url, root, relativePath, token, expectedSize } = {}) => {
  if (!id) return { ok: false, error: 'Missing download id.' };
  if (!isAllowedDownloadUrl(url)) return { ok: false, error: 'Downloads are limited to Hugging Face, ModelScope, Civitai and GitHub over https.' };
  let finalPath;
  try {
    finalPath = resolveInsideRoot(root, relativePath);
  } catch (error) {
    return { ok: false, error: error.message };
  }
  if (downloads.has(id)) return { ok: true, alreadyRunning: true };

  const partPath = `${finalPath}.part`;
  await fsp.mkdir(path.dirname(finalPath), { recursive: true });
  const existing = await fsp.stat(finalPath).catch(() => null);
  if (existing && (!expectedSize || existing.size === expectedSize)) {
    emitProgress({ id, state: 'done', received: existing.size, total: existing.size, path: finalPath });
    return { ok: true, path: finalPath };
  }

  const state = { cancelled: false, req: null, file: null };
  downloads.set(id, state);
  try {
    const partial = await fsp.stat(partPath).catch(() => null);
    const have = partial ? partial.size : 0;
    const { req, res } = await openDownload(url, have > 0 ? { Range: `bytes=${have}-` } : {}, token);
    state.req = req;
    const status = res.statusCode || 0;
    if (status === 401 || status === 403) {
      res.resume();
      throw new Error(status === 401
        ? 'This model needs a Hugging Face login: accept its license on huggingface.co and add a token in Local AI settings.'
        : 'Access denied by the model hub (gated model or invalid token).');
    }
    if (status !== 200 && status !== 206) {
      res.resume();
      throw new Error(`Download failed: HTTP ${status}`);
    }
    const resuming = status === 206 && have > 0;
    const total = totalFromHeaders(res.headers, resuming ? have : 0) || expectedSize || 0;
    let received = resuming ? have : 0;
    const file = fs.createWriteStream(partPath, { flags: resuming ? 'a' : 'w' });
    state.file = file;
    let lastEmit = 0;
    let lastBytes = received;
    let lastTime = Date.now();
    await new Promise((resolve, reject) => {
      res.on('data', (chunk) => {
        received += chunk.length;
        const now = Date.now();
        if (now - lastEmit > 300) {
          const bytesPerSecond = ((received - lastBytes) * 1000) / Math.max(1, now - lastTime);
          lastBytes = received;
          lastTime = now;
          lastEmit = now;
          emitProgress({ id, state: 'downloading', received, total, bytesPerSecond });
        }
      });
      res.on('error', reject);
      file.on('error', reject);
      file.on('finish', resolve);
      res.pipe(file);
    });
    if (state.cancelled) throw new Error('cancelled');
    if (total && received < total) throw new Error('The connection dropped before the file finished; try again to resume.');
    await fsp.rename(partPath, finalPath);
    emitProgress({ id, state: 'done', received, total: total || received, path: finalPath });
    return { ok: true, path: finalPath };
  } catch (error) {
    const cancelled = state.cancelled || error.message === 'cancelled';
    emitProgress({ id, state: cancelled ? 'cancelled' : 'error', error: cancelled ? undefined : error.message });
    return { ok: false, cancelled, error: cancelled ? undefined : error.message };
  } finally {
    downloads.delete(id);
  }
};

const cancelDownload = ({ id } = {}) => {
  const state = downloads.get(id);
  if (state) {
    state.cancelled = true;
    if (state.req) state.req.destroy();
    if (state.file) state.file.destroy();
  }
  return { ok: true };
};

/** Which of the given files already exist under root (and their sizes). */
const checkFiles = async ({ root, files } = {}) => {
  const result = {};
  for (const relativePath of Array.isArray(files) ? files : []) {
    try {
      const target = resolveInsideRoot(root, relativePath);
      const stat = await fsp.stat(target).catch(() => null);
      const part = stat ? null : await fsp.stat(`${target}.part`).catch(() => null);
      result[relativePath] = stat ? { exists: true, size: stat.size } : { exists: false, partialSize: part ? part.size : 0 };
    } catch {
      result[relativePath] = { exists: false };
    }
  }
  return result;
};

const deleteFiles = async ({ root, files } = {}) => {
  for (const relativePath of Array.isArray(files) ? files : []) {
    const target = resolveInsideRoot(root, relativePath);
    await fsp.rm(target, { force: true });
    await fsp.rm(`${target}.part`, { force: true });
  }
  return { ok: true };
};

const pickFolder = async ({ title } = {}) => {
  const result = await dialog.showOpenDialog({
    title: title || 'Choose the models folder',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return { canceled: true };
  return { canceled: false, path: result.filePaths[0] };
};

const openFolder = async ({ path: folder } = {}) => {
  if (!folder) return { ok: false };
  await fsp.mkdir(folder, { recursive: true }).catch(() => {});
  const error = await shell.openPath(folder);
  return { ok: !error, error: error || undefined };
};

const register = (ipcMain) => {
  ipcMain.handle('localAi:request', (_event, payload) => request(payload));
  ipcMain.handle('localAi:stream', (_event, payload) => stream(payload));
  ipcMain.handle('localAi:cancelStream', (_event, payload) => cancelStream(payload));
  ipcMain.handle('localModels:download', (_event, payload) => download(payload));
  ipcMain.handle('localModels:cancel', (_event, payload) => cancelDownload(payload));
  ipcMain.handle('localModels:check', (_event, payload) => checkFiles(payload));
  ipcMain.handle('localModels:delete', (_event, payload) => deleteFiles(payload));
  ipcMain.handle('localModels:pickFolder', (_event, payload) => pickFolder(payload));
  ipcMain.handle('localModels:openFolder', (_event, payload) => openFolder(payload));
};

const dispose = () => {
  for (const req of streams.values()) req.destroy();
  streams.clear();
  for (const id of Array.from(downloads.keys())) cancelDownload({ id });
};

module.exports = { register, dispose };
