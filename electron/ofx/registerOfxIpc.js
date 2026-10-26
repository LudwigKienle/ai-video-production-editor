'use strict';

// IPC bridge between the renderer and the native OFX host sidecar.
// Wire from electron/main.js:
//   const { registerOfxIpc } = require('./ofx/registerOfxIpc');
//   const ofx = registerOfxIpc(ipcMain, { getFfmpegPath: () => ffmpegBinaryPath });
//   app.on('will-quit', () => ofx.dispose());

const path = require('node:path');
const { OfxHostClient } = require('./ofxHostClient');

function defaultFfmpegPath() {
  try {
    // eslint-disable-next-line global-require
    const ffmpegStatic = require('ffmpeg-static');
    if (ffmpegStatic) return ffmpegStatic.replace('app.asar', 'app.asar.unpacked');
  } catch {
    // ffmpeg-static not available
  }
  return 'ffmpeg';
}

function electronAppPaths() {
  try {
    // eslint-disable-next-line global-require
    const electron = require('electron');
    const app = electron && typeof electron === 'object' ? electron.app : null;
    if (app && typeof app.getAppPath === 'function') {
      const out = { appPath: app.getAppPath(), isPackaged: Boolean(app.isPackaged) };
      try {
        out.scanCacheFile = path.join(app.getPath('userData'), 'ofx-scan-cache.json');
      } catch {
        // userData not available yet
      }
      return out;
    }
  } catch {
    // not running inside Electron (tests)
  }
  return {};
}

function toNodeBuffer(value) {
  if (!value) return null;
  if (Buffer.isBuffer(value)) return value;
  if (ArrayBuffer.isView(value)) return Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (value instanceof ArrayBuffer) return Buffer.from(value);
  return null;
}

function errorResult(err) {
  const details = (err && err.details) || {};
  return {
    ok: false,
    error: err && err.message ? err.message : String(err),
    crashed: Boolean(err && err.crashed),
    timeout: Boolean(err && err.timeout),
    cancelled: Boolean(err && err.cancelled),
    warnings: details.warnings || undefined,
  };
}

/**
 * Registers `ofx:scan`, `ofx:render`, `ofx:bake`, `ofx:bake-cancel`, `ofx:status`,
 * `ofx:destroy-instance` and `ofx:frames-needed`.
 * Returns { client, dispose }.
 */
function registerOfxIpc(ipcMain, options = {}) {
  const { getFfmpegPath, clientOptions = {}, logger = console } = options;
  const appPaths = electronAppPaths();
  const client = options.client || new OfxHostClient({ ...appPaths, logger: null, ...clientOptions });
  const bakes = new Map(); // jobId -> AbortController
  let scanPromise = null;

  client.on('log', (text) => {
    if (process.env.AVPE_OFX_DEBUG && logger && logger.log) logger.log('[ofx-host]', String(text).trimEnd());
  });

  ipcMain.handle('ofx:status', async () => {
    try {
      return { ok: true, ...(await client.status()) };
    } catch (err) {
      return errorResult(err);
    }
  });

  ipcMain.handle('ofx:scan', async (_event, payload = {}) => {
    try {
      const { paths, force = false, refresh = false, filter } = payload || {};
      if (!force && !refresh && !paths && !filter && client.lastScan) {
        return { ok: true, cached: true, scannedAt: client.lastScanAt, ...client.lastScan };
      }
      if (!scanPromise) {
        scanPromise = client.scanPlugins(paths, { filter, refresh: Boolean(refresh) }).finally(() => {
          scanPromise = null;
        });
      }
      const result = await scanPromise;
      return { ok: true, cached: false, scannedAt: client.lastScanAt, ...result };
    } catch (err) {
      return errorResult(err);
    }
  });

  ipcMain.handle('ofx:render', async (_event, payload = {}) => {
    try {
      const pixels = toNodeBuffer(payload.pixels);
      if (!pixels) return { ok: false, error: 'ofx:render: pixels (ArrayBuffer/Uint8Array/Float32Array) are required' };
      const frames = Array.isArray(payload.frames)
        ? payload.frames.map((f) => ({ time: f.time, pixels: toNodeBuffer(f.pixels) }))
        : [];
      const result = await client.renderFrame({ ...payload, pixels, frames });
      const { pixels: out, id, ok, binarySize, ...meta } = result;
      // Uint8Array survives structured cloning; the renderer can wrap it as Float32Array
      // (new Float32Array(px.buffer, px.byteOffset, px.byteLength / 4)) for rgba32f.
      return { ok: true, ...meta, pixels: new Uint8Array(out.buffer, out.byteOffset, out.byteLength) };
    } catch (err) {
      return errorResult(err);
    }
  });

  ipcMain.handle('ofx:frames-needed', async (_event, payload = {}) => {
    try {
      const header = await client.framesNeeded(payload);
      return { ok: true, frames: header.frames, temporalClipAccess: header.temporalClipAccess, warnings: header.warnings };
    } catch (err) {
      return errorResult(err);
    }
  });

  ipcMain.handle('ofx:destroy-instance', async (_event, payload = {}) => {
    try {
      await client.destroyInstance(payload.instanceId);
      return { ok: true };
    } catch (err) {
      return errorResult(err);
    }
  });

  ipcMain.handle('ofx:bake', async (event, payload = {}) => {
    const jobId = payload.jobId || `ofx-bake-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const controller = new AbortController();
    bakes.set(jobId, controller);
    const sender = event.sender;
    const send = (data) => {
      try {
        if (sender && !sender.isDestroyed()) sender.send('ofx:bake-progress', { jobId, ...data });
      } catch {
        // window closed
      }
    };
    try {
      const ffmpegPath = payload.ffmpegPath || (typeof getFfmpegPath === 'function' ? getFfmpegPath() : null) || defaultFfmpegPath();
      const { jobId: _ignored, ...opts } = payload;
      send({ status: 'started' });
      const result = await client.bakeVideo({ ...opts, ffmpegPath }, (progress) => send({ status: 'progress', ...progress }), {
        signal: controller.signal,
      });
      const { id, ...rest } = result;
      send({ status: 'done', ...rest });
      return { jobId, ...rest, ok: true };
    } catch (err) {
      const res = errorResult(err);
      send({ status: res.cancelled ? 'cancelled' : 'error', error: res.error });
      return { jobId, ...res };
    } finally {
      bakes.delete(jobId);
    }
  });

  ipcMain.handle('ofx:bake-cancel', async (_event, payload = {}) => {
    const controller = bakes.get(payload.jobId);
    if (!controller) return { ok: false, error: 'unknown bake job' };
    controller.abort();
    return { ok: true };
  });

  const channels = ['ofx:status', 'ofx:scan', 'ofx:render', 'ofx:frames-needed', 'ofx:destroy-instance', 'ofx:bake', 'ofx:bake-cancel'];
  return {
    client,
    dispose() {
      for (const c of bakes.values()) c.abort();
      bakes.clear();
      for (const ch of channels) {
        try {
          ipcMain.removeHandler(ch);
        } catch {
          // ignore
        }
      }
      client.dispose();
    },
  };
}

module.exports = { registerOfxIpc, defaultFfmpegPath };
