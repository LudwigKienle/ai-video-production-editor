/**
 * 3D library downloads (Set Design › 3D libraries) in the main process: JSON and file requests
 * with the app's own User-Agent (Poly Haven's API terms ask for one that names the software),
 * https only, no private/loopback hosts, size limit, plus a cache folder for imports while no
 * project folder is open. The renderer falls back to its own fetch when this is not wired.
 *
 * Wiring (main.js):   const { registerLibrary3dIpc } = require('./library-download');
 *                     registerLibrary3dIpc(ipcMain, { getPath: (name) => app.getPath(name), version: app.getVersion() });
 * Wiring (preload.js): library3d: {
 *                        fetchJson: (payload) => ipcRenderer.invoke('library3d:fetchJson', payload),
 *                        fetchBytes: (payload) => ipcRenderer.invoke('library3d:fetchBytes', payload),
 *                        cacheDir: () => ipcRenderer.invoke('library3d:cacheDir'),
 *                      },
 */
const path = require('path');
const fs = require('fs/promises');

const MAX_BYTES = 700 * 1024 * 1024;
const TIMEOUT_MS = 10 * 60 * 1000;

const userAgent = (version) => `AI-Video-Production-Editor/${version || 'dev'} (Set Design 3D libraries; +https://github.com/LudwigKienle/ai-video-production-editor)`;

/** Only public https URLs (no localhost, private ranges or credentials in the URL). */
function checkUrl(value) {
  let url;
  try { url = new URL(String(value || '')); } catch { throw new Error('Invalid URL.'); }
  if (url.protocol !== 'https:') throw new Error('Only https:// downloads are allowed.');
  if (url.username || url.password) throw new Error('URLs with credentials are not allowed.');
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (
    host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')
    || /^127\./.test(host) || /^10\./.test(host) || /^192\.168\./.test(host) || /^169\.254\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host) || /^0\./.test(host)
    || host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')
  ) throw new Error('Downloads from local or private addresses are not allowed.');
  return url;
}

/** Headers the renderer may pass on (auth for Sketchfab, accept). */
const passHeaders = (headers) => {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (/^(authorization|accept|x-api-key)$/i.test(key) && typeof value === 'string') out[key] = value;
  }
  return out;
};

async function request(fetchImpl, rawUrl, headers, version) {
  const url = checkUrl(rawUrl);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(url.toString(), { headers: { 'User-Agent': userAgent(version), ...passHeaders(headers) }, redirect: 'follow', signal: controller.signal });
    if (response.url) checkUrl(response.url); // redirects must stay public https too
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response) {
  const declared = Number(response.headers?.get?.('content-length')) || 0;
  if (declared > MAX_BYTES) throw new Error(`File is ${Math.round(declared / 1024 / 1024)} MB (limit ${MAX_BYTES / 1024 / 1024} MB).`);
  const buffer = new Uint8Array(await response.arrayBuffer());
  if (buffer.byteLength > MAX_BYTES) throw new Error('File too large.');
  return buffer;
}

function registerLibrary3dIpc(ipcMain, { getPath, version, fetchImpl } = {}) {
  const doFetch = fetchImpl || ((...args) => globalThis.fetch(...args));
  const fail = (error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) });

  ipcMain.handle('library3d:fetchJson', async (_event, { url, headers } = {}) => {
    try {
      const response = await request(doFetch, url, headers, version);
      if (!response.ok) return { ok: false, status: response.status, error: `${new URL(url).host} answered ${response.status}` };
      return { ok: true, status: response.status, data: await response.json() };
    } catch (error) { return fail(error); }
  });

  ipcMain.handle('library3d:fetchBytes', async (_event, { url, headers } = {}) => {
    try {
      const response = await request(doFetch, url, headers, version);
      if (!response.ok) return { ok: false, status: response.status, error: `${new URL(url).host} answered ${response.status}` };
      return { ok: true, status: response.status, data: await readLimited(response) };
    } catch (error) { return fail(error); }
  });

  ipcMain.handle('library3d:cacheDir', async () => {
    try {
      if (!getPath) return { ok: false };
      const dir = path.join(getPath('userData'), 'library3d-cache');
      await fs.mkdir(dir, { recursive: true });
      return { ok: true, path: dir };
    } catch (error) { return fail(error); }
  });
}

module.exports = { registerLibrary3dIpc, checkUrl, userAgent };
