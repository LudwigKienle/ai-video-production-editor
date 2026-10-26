'use strict';

// Client for the native OpenFX host sidecar (native/ofx-host, binary `avpe-ofx-host`).
// Protocol: JSON header line + optional binary payload, see native/ofx-host/PROTOCOL.md.
// CommonJS, Node >= 20, used from the Electron main process (no Electron APIs needed).

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');

const BINARY_NAME = 'avpe-ofx-host';

const DEFAULT_TIMEOUTS = {
  startup: 15000,
  request: 60000,
  render: 120000,
  scan: 240000,
  bakeIdle: 180000,
  cancelGrace: 8000,
};

const WIRE_FORMATS = {
  rgba32f: 16,
  rgba16: 8,
  rgba8: 4,
};

function normalizeFormat(format) {
  if (!format) return 'rgba32f';
  const f = String(format).toLowerCase();
  if (f === 'float' || f === 'f32' || f === 'rgba32f' || f === 'rgbaf32') return 'rgba32f';
  if (f === 'rgba16' || f === 'u16' || f === 'rgba64le') return 'rgba16';
  if (f === 'rgba8' || f === 'u8' || f === 'rgba') return 'rgba8';
  throw new Error(`Unsupported pixel format "${format}" (use rgba32f, rgba16 or rgba8)`);
}

function bytesPerPixel(format) {
  return WIRE_FORMATS[normalizeFormat(format)];
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

/**
 * Returns the candidate binary locations in priority order.
 * - AVPE_OFX_HOST_PATH env override
 * - explicit option
 * - packaged app: <resources>/ofx-host/avpe-ofx-host
 * - dev checkout: <appPath|cwd>/native/ofx-host/build/avpe-ofx-host
 */
function ofxHostBinaryCandidates(options = {}) {
  const candidates = [];
  if (process.env.AVPE_OFX_HOST_PATH) candidates.push(process.env.AVPE_OFX_HOST_PATH);
  if (options.binaryPath) candidates.push(options.binaryPath);
  const resourcesPath = options.resourcesPath || process.resourcesPath;
  if (resourcesPath) candidates.push(path.join(resourcesPath, 'ofx-host', BINARY_NAME));
  const roots = [options.appPath, process.cwd(), path.resolve(__dirname, '..', '..'), path.resolve(__dirname, '..')];
  for (const root of roots) {
    if (root) candidates.push(path.join(root, 'native', 'ofx-host', 'build', BINARY_NAME));
  }
  return [...new Set(candidates)];
}

function resolveOfxHostBinary(options = {}) {
  for (const candidate of ofxHostBinaryCandidates(options)) {
    if (isExecutable(candidate)) return candidate;
  }
  return null;
}

function toBuffer(pixels) {
  if (!pixels) return null;
  if (Buffer.isBuffer(pixels)) return pixels;
  if (ArrayBuffer.isView(pixels)) return Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  if (pixels instanceof ArrayBuffer) return Buffer.from(pixels);
  throw new TypeError('pixels must be a Buffer, TypedArray or ArrayBuffer');
}

class OfxHostError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'OfxHostError';
    this.details = details;
    if (details.crashed) this.crashed = true;
    if (details.timeout) this.timeout = true;
    if (details.cancelled) this.cancelled = true;
  }
}

/**
 * One sidecar process. Requests are serialized (the host is single-threaded per
 * process); a crash or timeout kills the process and it is restarted lazily on
 * the next request.
 */
class OfxHostClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = { ...options };
    this.timeouts = { ...DEFAULT_TIMEOUTS, ...(options.timeouts || {}) };
    this.maxRestarts = options.maxRestarts ?? 5;
    this.restartWindowMs = options.restartWindowMs ?? 60000;
    this.logger = options.logger || null;
    this.child = null;
    this.ready = null;
    this.generation = 0;
    this.nextId = 1;
    this.queue = [];
    this.inflight = null;
    this.restartTimes = [];
    this.lastError = null;
    this.hostInfo = null;
    this.disposed = false;
    this.lastScan = null;
    this.lastScanAt = 0;
    this.bundleByPlugin = new Map();
    this.instanceState = new Map(); // instanceId -> { generation, params }
    this._buf = Buffer.alloc(0);
    this._expect = null; // { header, size, chunks, got }
  }

  get binaryPath() {
    if (!this._binaryPath) this._binaryPath = resolveOfxHostBinary(this.options);
    return this._binaryPath;
  }

  isAvailable() {
    return Boolean(this.binaryPath);
  }

  isRunning() {
    return Boolean(this.child && this.child.exitCode === null && !this.child.killed);
  }

  _log(level, ...args) {
    if (this.logger && typeof this.logger[level] === 'function') this.logger[level]('[ofx-host]', ...args);
  }

  async start() {
    if (this.disposed) throw new OfxHostError('OFX host client disposed');
    if (this.ready) return this.ready;
    const bin = this.binaryPath;
    if (!bin) {
      throw new OfxHostError(
        `OFX host binary not found (looked in: ${ofxHostBinaryCandidates(this.options).join(', ')}). ` +
          'Build it with `make -C native/ofx-host`.',
        { code: 'ENOENT' },
      );
    }
    const now = Date.now();
    this.restartTimes = this.restartTimes.filter((t) => now - t < this.restartWindowMs);
    if (this.generation > 0 && this.restartTimes.length >= this.maxRestarts) {
      throw new OfxHostError(`OFX host restarted ${this.restartTimes.length} times within ${this.restartWindowMs} ms; giving up`, {
        lastError: this.lastError,
      });
    }
    if (this.generation > 0) this.restartTimes.push(now);
    this.generation += 1;
    const generation = this.generation;

    const args = [...(this.options.args || [])];
    if (this.options.hostName) args.push('--host-name', this.options.hostName);
    if (this.options.hostLabel) args.push('--host-label', this.options.hostLabel);
    if (this.options.threads) args.push('--threads', String(this.options.threads));
    if (this.options.scanCacheFile) args.push('--scan-cache', this.options.scanCacheFile);

    const child = spawn(bin, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, ...(this.options.env || {}) },
      windowsHide: true,
    });
    this.child = child;
    this._buf = Buffer.alloc(0);
    this._expect = null;

    this.ready = new Promise((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        this._kill(child);
        reject(new OfxHostError('OFX host did not become ready in time', { timeout: true }));
      }, this.timeouts.startup);
      this._onReady = (info) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.hostInfo = info;
        resolve(info);
      };
      this._onStartFail = (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(err);
      };
    });
    // Avoid unhandled rejections if nobody awaits a failed start.
    this.ready.catch(() => {});

    child.stdout.on('data', (chunk) => this._onData(chunk, generation));
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (text) => {
      this.emit('log', text);
      this._log('debug', text.trimEnd());
    });
    child.stdin.on('error', (err) => this._log('warn', 'stdin error', err.message));
    child.on('error', (err) => {
      this.lastError = err.message;
      this._handleExit(generation, null, null, err);
    });
    child.on('exit', (code, signal) => this._handleExit(generation, code, signal));
    return this.ready;
  }

  _kill(child = this.child) {
    if (child && child.exitCode === null) {
      try {
        child.kill('SIGKILL');
      } catch {
        // ignore
      }
    }
  }

  _handleExit(generation, code, signal, spawnError) {
    if (generation !== this.generation) return;
    const crashed = code !== 0 || signal;
    const message = spawnError
      ? `OFX host failed to start: ${spawnError.message}`
      : `OFX host exited (code ${code}${signal ? `, signal ${signal}` : ''})`;
    if (crashed) this.lastError = this.lastError || message;
    this.child = null;
    this.ready = null;
    if (this._onStartFail) this._onStartFail(new OfxHostError(message, { crashed: Boolean(crashed) }));
    const inflight = this.inflight;
    this.inflight = null;
    if (inflight) {
      clearTimeout(inflight.timer);
      inflight.reject(new OfxHostError(inflight.crashMessage || message, { crashed: true, ...(inflight.crashDetails || {}) }));
    }
    this.emit('exit', { code, signal });
    // Queued requests are retried on a fresh process.
    if (this.queue.length && !this.disposed) setImmediate(() => this._pump());
  }

  _onData(chunk, generation) {
    if (generation !== this.generation) return;
    this._buf = this._buf.length ? Buffer.concat([this._buf, chunk]) : chunk;
    while (this._buf.length) {
      if (this._expect) {
        const need = this._expect.size - this._expect.got;
        const take = Math.min(need, this._buf.length);
        this._expect.chunks.push(this._buf.subarray(0, take));
        this._expect.got += take;
        this._buf = this._buf.subarray(take);
        if (this._expect.got === this._expect.size) {
          const { header, chunks, size } = this._expect;
          this._expect = null;
          // Fresh, 16-byte aligned buffer so callers can wrap it as Float32Array.
          const payload = Buffer.allocUnsafeSlow(size);
          let offset = 0;
          for (const c of chunks) {
            c.copy(payload, offset);
            offset += c.length;
          }
          this._dispatch(header, payload);
        }
        continue;
      }
      const nl = this._buf.indexOf(0x0a);
      if (nl < 0) break;
      const line = this._buf.subarray(0, nl).toString('utf8');
      this._buf = this._buf.subarray(nl + 1);
      if (!line.trim()) continue;
      let header;
      try {
        header = JSON.parse(line);
      } catch (err) {
        this._log('warn', 'invalid header from OFX host', line.slice(0, 200));
        continue;
      }
      const size = Number(header.binarySize || 0);
      if (size > 0) {
        this._expect = { header, size, chunks: [], got: 0 };
      } else {
        this._dispatch(header, null);
      }
    }
  }

  _dispatch(header, payload) {
    if (header.event === 'ready') {
      if (this._onReady) this._onReady(header);
      return;
    }
    const inflight = this.inflight;
    if (header.crashed) {
      // The process is about to exit; remember the attribution for the pending request.
      this.lastError = header.error;
      if (inflight) {
        inflight.crashMessage = header.error;
        inflight.crashDetails = header;
      }
      return;
    }
    if (header.event) {
      if (inflight && header.id === inflight.id) {
        inflight.touch();
        if (inflight.onEvent) {
          try {
            inflight.onEvent(header);
          } catch (err) {
            this._log('warn', 'event handler failed', err.message);
          }
        }
      }
      this.emit('event', header);
      return;
    }
    if (inflight && header.id === inflight.id) {
      this.inflight = null;
      clearTimeout(inflight.timer);
      if (header.ok) inflight.resolve({ header, payload });
      else inflight.reject(new OfxHostError(header.error || 'OFX host request failed', header));
      setImmediate(() => this._pump());
      return;
    }
    if (inflight && inflight.cancelId === header.id) return; // cancel acknowledgement
    this._log('debug', 'unmatched OFX host message', header);
  }

  /**
   * Low-level request. `payload` may be a Buffer or an array of Buffers (concatenated on the wire).
   * Options: timeoutMs (0 = none), idleTimeoutMs (reset by events), onEvent, signal (AbortSignal).
   */
  request(cmd, fields = {}, payload = null, options = {}) {
    if (this.disposed) return Promise.reject(new OfxHostError('OFX host client disposed'));
    return new Promise((resolve, reject) => {
      const parts = payload ? (Array.isArray(payload) ? payload : [payload]).map(toBuffer) : [];
      const entry = {
        id: this.nextId++,
        cmd,
        fields,
        parts,
        options,
        resolve,
        reject,
        timer: null,
      };
      if (options.signal) {
        if (options.signal.aborted) {
          reject(new OfxHostError('aborted', { cancelled: true }));
          return;
        }
        options.signal.addEventListener('abort', () => this._abort(entry), { once: true });
      }
      this.queue.push(entry);
      this._pump();
    });
  }

  _abort(entry) {
    const idx = this.queue.indexOf(entry);
    if (idx >= 0) {
      this.queue.splice(idx, 1);
      entry.reject(new OfxHostError('aborted', { cancelled: true }));
      return;
    }
    if (this.inflight !== entry || !this.child) return;
    // Ask the host to cancel (bake polls stdin); kill if it does not comply.
    entry.cancelId = this.nextId++;
    try {
      this.child.stdin.write(`${JSON.stringify({ id: entry.cancelId, cmd: 'cancel' })}\n`);
    } catch {
      // ignore
    }
    entry.cancelTimer = setTimeout(() => {
      if (this.inflight === entry) {
        entry.crashMessage = 'cancelled';
        entry.crashDetails = { cancelled: true };
        this._kill();
      }
    }, this.timeouts.cancelGrace);
  }

  async _pump() {
    if (this.inflight || !this.queue.length || this.disposed) return;
    const entry = this.queue[0];
    try {
      await this.start();
    } catch (err) {
      this.queue.shift();
      entry.reject(err);
      setImmediate(() => this._pump());
      return;
    }
    if (this.inflight || this.queue[0] !== entry) return;
    this.queue.shift();
    const child = this.child;
    if (!child) {
      this.queue.unshift(entry);
      setImmediate(() => this._pump());
      return;
    }
    this.inflight = entry;
    const timeoutMs = entry.options.timeoutMs ?? this.timeouts.request;
    const idleMs = entry.options.idleTimeoutMs || 0;
    const onTimeout = () => {
      if (this.inflight !== entry) return;
      entry.crashMessage = `OFX host request "${entry.cmd}" timed out`;
      entry.crashDetails = { timeout: true };
      this.lastError = entry.crashMessage;
      this._kill(child);
    };
    entry.touch = () => {
      if (idleMs > 0) {
        clearTimeout(entry.timer);
        entry.timer = setTimeout(onTimeout, idleMs);
      }
    };
    if (timeoutMs > 0) entry.timer = setTimeout(onTimeout, timeoutMs);
    else entry.touch();
    entry.onEvent = entry.options.onEvent;
    const wrappedResolve = entry.resolve;
    const wrappedReject = entry.reject;
    entry.resolve = (v) => {
      clearTimeout(entry.cancelTimer);
      wrappedResolve(v);
    };
    entry.reject = (e) => {
      clearTimeout(entry.cancelTimer);
      wrappedReject(e);
    };

    const size = entry.parts.reduce((n, b) => n + b.length, 0);
    entry.generation = this.generation;
    let fields = entry.fields;
    if (typeof fields === 'function') {
      try {
        fields = fields(this.generation);
      } catch (err) {
        this.inflight = null;
        clearTimeout(entry.timer);
        entry.reject(err);
        setImmediate(() => this._pump());
        return;
      }
    }
    const header = { ...fields, id: entry.id, cmd: entry.cmd };
    if (size > 0) header.binarySize = size;
    else delete header.binarySize;
    try {
      await this._write(child, Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'));
      for (const part of entry.parts) await this._write(child, part);
    } catch (err) {
      if (this.inflight === entry) {
        entry.crashMessage = `failed to write to OFX host: ${err.message}`;
        this._kill(child);
      }
    }
  }

  _write(child, buffer) {
    return new Promise((resolve, reject) => {
      if (!child.stdin.writable) {
        reject(new Error('stdin closed'));
        return;
      }
      const ok = child.stdin.write(buffer, (err) => {
        if (err) reject(err);
      });
      if (ok) resolve();
      else child.stdin.once('drain', resolve);
    });
  }

  // ---- High-level API ------------------------------------------------------

  async status() {
    const base = {
      available: this.isAvailable(),
      binaryPath: this.binaryPath,
      running: this.isRunning(),
      pid: this.child ? this.child.pid : null,
      restarts: Math.max(0, this.generation - 1),
      lastError: this.lastError,
      lastScanAt: this.lastScanAt || null,
      pluginCount: this.lastScan ? this.lastScan.plugins.length : null,
    };
    if (!base.running) return base;
    try {
      const { header } = await this.request('status', {}, null, { timeoutMs: 5000 });
      return { ...base, version: header.version, protocol: header.protocol, hostName: header.hostName, threads: header.threads, instances: header.instances };
    } catch (err) {
      return { ...base, statusError: err.message };
    }
  }

  /**
   * Scans OFX bundles. Default paths: /Library/OFX/Plugins, ~/Library/OFX/Plugins (+ OFX_PLUGIN_PATH).
   * Each bundle is described in an isolated child process, so a crashing plugin cannot take the host down.
   * options: { filter, isolate, cacheFile (per-bundle cache keyed on binary mtime/size), refresh, timeoutMs,
   *            perBundleTimeoutMs }
   */
  async scanPlugins(paths, options = {}) {
    const fields = { isolate: options.isolate ?? true };
    if (Array.isArray(paths) && paths.length) fields.paths = paths;
    if (options.filter) fields.filter = options.filter;
    if (options.perBundleTimeoutMs) fields.timeoutMs = options.perBundleTimeoutMs;
    const cacheFile = options.cacheFile === undefined ? this.options.scanCacheFile : options.cacheFile;
    if (cacheFile) fields.cacheFile = cacheFile;
    if (options.refresh) fields.refresh = true;
    const { header } = await this.request('scan', fields, null, { timeoutMs: options.timeoutMs ?? this.timeouts.scan });
    const result = {
      plugins: header.plugins || [],
      bundles: header.bundles || [],
      searchPaths: header.searchPaths || [],
    };
    for (const plugin of result.plugins) {
      if (plugin && plugin.id && plugin.loaded && plugin.bundlePath) {
        const prev = this.bundleByPlugin.get(plugin.id);
        if (!prev || compareVersions(plugin.version, prev.version) > 0) {
          this.bundleByPlugin.set(plugin.id, { bundlePath: plugin.bundlePath, version: plugin.version });
        }
      }
    }
    this.lastScan = result;
    this.lastScanAt = Date.now();
    return result;
  }

  /**
   * Renders one frame. `pixels` is top-down RGBA in `format` (rgba32f | rgba16 | rgba8).
   * `frames` optionally provides neighbouring frames for temporal plugins: [{ time, pixels }].
   * Resolves to { width, height, format, pixels: Buffer, renderMs, framesNeeded, warnings, ... }.
   */
  async renderFrame(opts) {
    const {
      pluginId,
      params = {},
      time = 0,
      width,
      height,
      pixels,
      frames = [],
      renderScale = 1,
      fps = 25,
      resetParams = false,
      temporalFallback = 'nearest',
      notifyChanges = true,
      pressButtons,
      timeoutMs,
    } = opts || {};
    if (!pluginId || typeof pluginId !== 'string') throw new TypeError('renderFrame: pluginId is required');
    const w = Number(width);
    const h = Number(height);
    if (!Number.isInteger(w) || !Number.isInteger(h) || w <= 0 || h <= 0 || w > 32768 || h > 32768) {
      throw new TypeError('renderFrame: width/height must be positive integers');
    }
    const format = normalizeFormat(opts.format);
    const outputFormat = normalizeFormat(opts.outputFormat || format);
    const expected = w * h * bytesPerPixel(format);
    const main = toBuffer(pixels);
    if (!main || main.length !== expected) {
      throw new TypeError(`renderFrame: pixels must be ${expected} bytes (${w}x${h} ${format}), got ${main ? main.length : 0}`);
    }
    const parts = [main];
    const frameTimes = [];
    for (const f of frames) {
      const buf = toBuffer(f && f.pixels);
      if (!buf || buf.length !== expected) throw new TypeError('renderFrame: neighbour frame has wrong size');
      if (!Number.isFinite(Number(f.time))) throw new TypeError('renderFrame: neighbour frame needs a numeric time');
      parts.push(buf);
      frameTimes.push(Number(f.time));
    }
    const instanceId = opts.instanceId || pluginId;

    // After a host restart the instance is recreated: resend the accumulated params.
    // Evaluated right before sending, when the target process generation is known.
    const state = this.instanceState.get(instanceId);
    const paramsFor = (generation) => {
      if (state && state.pluginId === pluginId && !resetParams && state.generation !== generation) {
        return { ...state.params, ...params };
      }
      return params;
    };

    const fields = {
      pluginId,
      instanceId,
      time: Number(time) || 0,
      width: w,
      height: h,
      format,
      outputFormat,
      frames: frameTimes,
      renderScale,
      fps,
      resetParams,
      temporalFallback,
      notifyChanges,
    };
    if (Array.isArray(pressButtons) && pressButtons.length) fields.pressButtons = pressButtons;
    const bundle = opts.bundlePath || (this.bundleByPlugin.get(pluginId) || {}).bundlePath;
    if (bundle) fields.bundlePath = bundle;

    let sentGeneration = 0;
    const { header, payload } = await this.request(
      'render',
      (generation) => {
        sentGeneration = generation;
        return { ...fields, params: paramsFor(generation) };
      },
      parts,
      { timeoutMs: timeoutMs ?? this.timeouts.render },
    );
    const merged = resetParams || !state || state.pluginId !== pluginId ? { ...params } : { ...state.params, ...params };
    this.instanceState.set(instanceId, { pluginId, params: merged, generation: sentGeneration });
    return { ...header, pixels: payload || Buffer.alloc(0) };
  }

  async framesNeeded({ pluginId, instanceId, time = 0, params = {}, width = 1920, height = 1080, fps = 25 }) {
    const fields = { pluginId, instanceId: instanceId || pluginId, time, params, width, height, fps };
    const bundle = (this.bundleByPlugin.get(pluginId) || {}).bundlePath;
    if (bundle) fields.bundlePath = bundle;
    const { header } = await this.request('framesNeeded', fields);
    return header;
  }

  async destroyInstance(instanceId) {
    this.instanceState.delete(instanceId);
    if (!this.isRunning()) return;
    await this.request('destroyInstance', { instanceId });
  }

  /**
   * Bakes a video through a plugin chain using a dedicated host process.
   * opts: { input, output, ffmpegPath, chain: [{ pluginId, params }], width?, height?, fps?,
   *         startTime?, duration?, codec? ('prores_hq' | 'prores_422' | 'prores_lt' | 'prores_proxy' |
   *         'prores_4444' | 'h264' | 'hevc'), crf?, audio?, bitDepth? (16|8), temporalRadius? }
   * onProgress receives { frame, totalFrames, percent, fps, etaSec, elapsedSec }.
   * Pass { signal } (AbortSignal) to cancel.
   */
  async bakeVideo(opts, onProgress, { signal } = {}) {
    if (!opts || !opts.input || !opts.output) throw new TypeError('bakeVideo: input and output are required');
    if (!Array.isArray(opts.chain)) throw new TypeError('bakeVideo: chain must be an array');
    const worker = new OfxHostClient({ ...this.options, maxRestarts: 0 });
    worker.bundleByPlugin = new Map(this.bundleByPlugin);
    worker.on('log', (t) => this.emit('log', t));
    const chain = opts.chain.map((item) => {
      const pluginId = item.pluginId || item.id;
      const bundle = item.bundlePath || (this.bundleByPlugin.get(pluginId) || {}).bundlePath;
      return { pluginId, params: item.params || {}, ...(bundle ? { bundlePath: bundle } : {}) };
    });
    try {
      const { header } = await worker.request(
        'bake',
        { ...opts, chain },
        null,
        {
          timeoutMs: 0,
          idleTimeoutMs: opts.idleTimeoutMs || this.timeouts.bakeIdle,
          signal,
          onEvent: (ev) => {
            if (ev.event === 'progress' && typeof onProgress === 'function') {
              const { id, event, ...rest } = ev;
              onProgress(rest);
            }
          },
        },
      );
      return header;
    } finally {
      worker.dispose();
    }
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    const pending = [...this.queue];
    this.queue = [];
    for (const entry of pending) entry.reject(new OfxHostError('OFX host client disposed'));
    const child = this.child;
    if (child) {
      try {
        child.stdin.write(`${JSON.stringify({ id: this.nextId++, cmd: 'shutdown' })}\n`);
        child.stdin.end();
      } catch {
        // ignore
      }
      const t = setTimeout(() => this._kill(child), 2000);
      if (typeof t.unref === 'function') t.unref();
    }
  }
}

function compareVersions(a = [], b = []) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (Number(a[i]) || 0) - (Number(b[i]) || 0);
    if (d) return d;
  }
  return 0;
}

module.exports = {
  OfxHostClient,
  OfxHostError,
  resolveOfxHostBinary,
  ofxHostBinaryCandidates,
  normalizeFormat,
  bytesPerPixel,
  BINARY_NAME,
};
