# OFX host wiring

## 1. `electron/main.js`

```js
const { registerOfxIpc } = require('./ofx/registerOfxIpc');
// ffmpeg-handler.js computes the unpacked ffmpeg-static path but does not export it;
// either export `ffmpegBinaryPath` from there or omit getFfmpegPath (registerOfxIpc then
// resolves ffmpeg-static itself, with the same app.asar -> app.asar.unpacked fix).
const ofxIpc = registerOfxIpc(ipcMain, {
  // getFfmpegPath: () => ffmpegBinaryPath,
});
app.on('will-quit', () => ofxIpc.dispose());
```

Call it once, next to the other `ipcMain.handle(...)` registrations (after `app` is ready
is not required; the sidecar starts lazily on the first request). The scan cache goes to
`<userData>/ofx-scan-cache.json`.

## 2. `electron/preload.js` — add inside `contextBridge.exposeInMainWorld('electron', { ... })`

The preload exposes `window.electron` (not `window.electronAPI`), so the API is `window.electron.ofx`.

```js
  ofx: {
    status: () => ipcRenderer.invoke('ofx:status'),
    scan: (payload) => ipcRenderer.invoke('ofx:scan', payload),
    render: (payload) => ipcRenderer.invoke('ofx:render', payload),
    framesNeeded: (payload) => ipcRenderer.invoke('ofx:frames-needed', payload),
    destroyInstance: (payload) => ipcRenderer.invoke('ofx:destroy-instance', payload),
    bake: (payload) => ipcRenderer.invoke('ofx:bake', payload),
    cancelBake: (payload) => ipcRenderer.invoke('ofx:bake-cancel', payload),
    onBakeProgress: (callback) => {
      const handler = (_event, value) => callback(value);
      ipcRenderer.on('ofx:bake-progress', handler);
      return () => ipcRenderer.removeListener('ofx:bake-progress', handler);
    },
  },
```

## 3. Packaging (`package.json` → `build`)

```json
"extraResources": [{ "from": "native/ofx-host/build/avpe-ofx-host", "to": "ofx-host/avpe-ofx-host" }]
```

Build with `make -C native/ofx-host universal` for the universal app. The binary needs the
same hardened-runtime entitlements as the app (`disable-library-validation`) to load plugins.

## Renderer usage

All handlers resolve to `{ ok: true, ... }` or `{ ok: false, error, crashed?, timeout?, cancelled? }`; they do not throw.

```ts
const scan = await window.electron.ofx.scan();            // cached after the first call
// { ok, cached, scannedAt, plugins: PluginDescriptor[], bundles, searchPaths }
// scan({ force: true })   -> re-query the host (uses the per-bundle cache)
// scan({ refresh: true }) -> reload every bundle

const width = 960, height = 540;
const pixels = new Float32Array(width * height * 4);      // top-down RGBA, linear/scene values as you use them
const res = await window.electron.ofx.render({
  pluginId: 'com.buckswood.optics.lab',
  instanceId: 'clip-42:optics',                            // keep one per clip/effect: instance is reused
  params: { preset: 6, effectStrength: 0.8 },              // only changed values are needed after the first call
  time: 120,                                               // frame number
  width, height,
  format: 'rgba32f',                                       // or 'rgba8' (Uint8Array/Uint8ClampedArray) / 'rgba16'
  pixels,                                                  // ArrayBuffer | TypedArray
  renderScale: 0.5,                                        // proxy preview of a 1920x1080 project
  // frames: [{ time: 119, pixels: prev }, { time: 121, pixels: next }],  // for temporal plugins
});
if (res.ok) {
  const out = new Float32Array(res.pixels.buffer, res.pixels.byteOffset, res.pixels.byteLength / 4);
  // res.renderMs, res.framesNeeded (send those neighbours next time), res.warnings
}

const jobId = crypto.randomUUID();
const off = window.electron.ofx.onBakeProgress((p) => {
  if (p.jobId !== jobId) return;
  // p.status: 'started' | 'progress' | 'done' | 'error' | 'cancelled'; p.frame, p.totalFrames, p.percent, p.etaSec
});
const baked = await window.electron.ofx.bake({
  jobId,
  input: '/path/in.mp4',
  output: '/path/out.mov',
  chain: [
    { pluginId: 'com.buckswood.optics.lab', params: { preset: 6 } },
    { pluginId: 'com.buckswood.film.emulation', params: {} },
  ],
  codec: 'prores_hq',                                      // prores_422 | prores_lt | prores_proxy | prores_4444 | h264 | hevc
  // width, height, fps, startTime, duration, audio: true, bitDepth: 16, temporalRadius: 2
});
off();
// window.electron.ofx.cancelBake({ jobId }) cancels a running bake.
```
