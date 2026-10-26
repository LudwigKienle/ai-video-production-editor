# avpe-ofx-host protocol (version 1)

The host is a long-running child process. It talks over **stdin/stdout** using
*framed JSON lines*. stderr is free-form logging (plugin messages, ffmpeg errors) and
must never be parsed.

## Framing

Every message (both directions) is:

```
<one line of UTF-8 JSON>\n
<optional binary payload of exactly header.binarySize bytes>
```

- `binarySize` (number, bytes) is present only when a payload follows.
- Requests carry a client-chosen `id` (number or string) and a `cmd`.
- Every request gets exactly one **response** with the same `id` and `ok: true|false`.
  Failures have `error` (string) and may carry `warnings` (string[]).
- **Events** carry `event` (string) and the `id` of the request they belong to. They
  never complete a request.
- Requests are processed strictly in order, one at a time. While a `bake` is running,
  the process only accepts `{"cmd":"cancel"}`; other requests get `ok:false, error:"busy: …"`.
- Empty lines are ignored. A malformed JSON line is answered with `ok:false` (the stream
  stays usable). A malformed `binarySize` or a truncated payload is fatal: the host
  answers `{"id":null,"ok":false,"fatal":true}` and exits.

On start the host emits `{"event":"ready","id":null,"version":"0.1.0","protocol":1,"pid":…,"hostName":…}`.

If a plugin crashes the process (SIGSEGV/SIGBUS/SIGILL/SIGFPE/SIGABRT), the host writes
`{"id":<current request id>,"ok":false,"fatal":true,"crashed":true,"signal":11,"error":"OFX host crashed (signal 11) in <plugin id> <action>"}`
and exits with code 70. The client then restarts it (instances are lost; the Node client
re-sends accumulated parameter values automatically).

## Pixel formats

| `format`  | bytes/pixel | layout                                   |
|-----------|-------------|------------------------------------------|
| `rgba32f` | 16          | float32 little-endian R,G,B,A (default)  |
| `rgba16`  | 8           | uint16 little-endian R,G,B,A (0…65535)   |
| `rgba8`   | 4           | uint8 R,G,B,A                            |

Rows are **top-down** (row 0 = top of the picture, like canvas/ffmpeg `rawvideo`).
The host flips to OFX bottom-up order internally. Alpha is treated as premultiplied
(video: alpha = 1). Non-finite input floats are replaced by 0.

## Commands

### `status` (aliases `hello`, `ping`)
→ `{ok, version, protocol, hostName, hostLabel, pid, threads, instances:[id…], knownPlugins:{id: bundlePath}}`

### `scan`
Request fields (all optional):

| field       | default                                              | meaning |
|-------------|------------------------------------------------------|---------|
| `paths`     | `$OFX_PLUGIN_PATH`, `/Library/OFX/Plugins`, `~/Library/OFX/Plugins` | folders (searched 3 levels deep) or `*.ofx.bundle` paths |
| `filter`    | –                                                    | case-insensitive substring of the bundle path |
| `isolate`   | `true`                                               | describe every bundle in a separate child process (a crashing/hanging plugin cannot kill the host) |
| `timeoutMs` | `60000`                                              | per bundle (isolated mode) |
| `parallel`  | `4`                                                  | concurrent describe processes |
| `cacheFile` | `--scan-cache` / `$AVPE_OFX_SCAN_CACHE`              | JSON cache; unchanged bundles (same binary + Info.plist size/mtime, same host version) are not loaded again |
| `refresh`   | `false`                                              | ignore the cache |

Response: `{ok, plugins:[PluginDescriptor…], bundles:[{path, ok, error?, pluginCount, ms, cached}], searchPaths, isolated}`

### `describe`
`{pluginId, bundlePath?}` → `{ok, plugin: PluginDescriptor}` (loads in-process).

### `render`
Request fields:

| field              | default        | meaning |
|--------------------|----------------|---------|
| `pluginId`         | required       | OFX plugin identifier |
| `instanceId`       | `pluginId`     | instance cache key; reused across calls (created once, then only params change). Max 16 live instances (LRU). |
| `bundlePath`       | from last scan | where to load the plugin from |
| `width`,`height`   | required       | frame size in pixels |
| `format`           | `rgba32f`      | input pixel format |
| `outputFormat`     | = `format`     | output pixel format |
| `time`             | `0`            | OFX frame time of the main frame |
| `frames`           | `[]`           | times of extra source frames that follow the main frame in the payload (for temporal plugins), e.g. `[8,9,11,12]` |
| `params`           | `{}`           | parameter values by name (see *Parameter values*) |
| `resetParams`      | `false`        | reset every param not listed in `params` to its default |
| `notifyChanges`    | `true`         | send `kOfxActionInstanceChanged` for changed params (never for push buttons) |
| `pressButtons`     | `[]`           | push-button names to "press" (explicit only; some plugins open dialogs) |
| `renderScale`      | `1`            | proxy scale: pass the proxy-sized frame with e.g. `0.25`; the project size becomes `width/renderScale` |
| `fps`              | `25`           | reported frame rate |
| `temporalFallback` | `"nearest"`    | when the plugin asks for a time that was not supplied: `"nearest"` returns the closest supplied frame, `"none"` fails the fetch (plugin sees "no image") |

Payload: `(1 + frames.length) × width × height × bpp(format)` bytes, main frame first.

Response header: `{ok, width, height, format, instanceId, created, pixelDepth, renderMs, totalMs,
nonFinite, changedParams, warnings, framesNeeded, framesRequested, missingFrameRequests, pluginMessage?}`
+ payload `width × height × bpp(outputFormat)`.

- `framesNeeded`: times returned by the plugin's `GetFramesNeeded` action (for temporal plugins); send
  those as `frames` next time.
- `framesRequested`: times the plugin actually fetched during render.
- `nonFinite`: number of NaN/Inf float components in the plugin output (written as 0).

### `framesNeeded`
`{pluginId, instanceId?, time, params?, width?, height?, fps?}` → `{ok, frames:[t…], temporalClipAccess}`.

### `getParams`
`{instanceId}` → `{ok, pluginId, params:{name: value}}` (current values).

### `destroyInstance` / `destroyAll`
`{instanceId}` → `{ok}`.

### `bake`
Decodes a video with an **external** ffmpeg process, renders every frame through a plugin chain
and encodes with a second ffmpeg process.

| field              | default         | meaning |
|--------------------|-----------------|---------|
| `input`, `output`  | required        | file paths (output folder must exist) |
| `ffmpegPath`       | `ffmpeg` (PATH) | ffmpeg binary |
| `chain`            | required        | `[{pluginId, params?, bundlePath?}]`, applied in order (fresh instances, `resetParams` semantics) |
| `width`,`height`   | probed          | output size (input is scaled) |
| `fps`              | probed          | forces CFR when given |
| `startTime`,`duration` | whole file  | seconds |
| `codec`            | `prores_hq`     | `prores_hq`, `prores_422`, `prores_lt`, `prores_proxy`, `prores_4444`, `h264`, `hevc` |
| `crf`, `preset`    | 18/20, medium   | x264/x265 only |
| `audio`            | `true`          | copy audio from input (PCM in .mov ProRes, AAC for h264/hevc) |
| `bitDepth`         | `16`            | pipe precision (`16` = rgba64le, `8` = rgba) |
| `temporalRadius`   | `2`             | ring buffer ±N frames for plugins with temporal clip access |
| `colorMatrix`      | probed / bt709 (≥720p) / smpte170m | YUV↔RGB matrix used for both decode and encode, and written as tags |
| `frameOffset`      | `0`             | OFX time of the first frame |
| `overwrite`        | `true`          | |
| `keepPartial`      | `false`         | keep the output file on failure/cancel |
| `encoderArgs`      | `[]`            | extra ffmpeg args inserted before the output path |
| `progressIntervalMs` | `250`         | |

Events while running: `{id, event:"progress", frame, decoded, totalFrames|null, percent?, fps, elapsedSec, etaSec?}`.

Response: `{ok, output, frames, width, height, fps, codec, audio, colorMatrix, elapsedSec, avgFps}` or
`{ok:false, error, decoderLog, encoderLog, frames}`; cancelled → `{ok:false, cancelled:true, error:"cancelled"}`.

### `cancel`
Only meaningful while a `bake` runs: answered `{ok:true, cancelled:true}`, then the bake
answers `cancelled`. The partial output is deleted unless `keepPartial`.

### `shutdown` (alias `quit`)
Destroys instances and exits.

## PluginDescriptor (scan / describe)

```jsonc
{
  "id": "com.buckswood.optics.lab",
  "version": [1, 3], "versionString": "1.3", "versionLabel": "",
  "label": "Buckswood Post Plugins Optics Lab v1.3.1", "shortLabel": "", "longLabel": "",
  "grouping": "Buckswood Post Plugins", "description": "",
  "bundlePath": "/Library/OFX/Plugins/BuckswoodOpticsLab.ofx.bundle",
  "binaryPath": ".../Contents/MacOS/BuckswoodOpticsLab.ofx", "pluginIndex": 0, "apiVersion": 1,
  "loaded": true,
  "supported": true,                       // renderable by this host
  "context": "OfxImageEffectContextFilter", // context used for instances (filter preferred, else general)
  "unsupportedReason": "...",              // only when supported = false
  "contexts": ["OfxImageEffectContextFilter"],
  "pixelDepths": ["OfxBitDepthFloat", "OfxBitDepthByte"],
  "temporalClipAccess": false, "supportsTiles": true, "supportsMultiResolution": true,
  "renderThreadSafety": "OfxImageEffectRenderInstanceSafe", "hostFrameThreading": false, "singleInstance": false,
  "gpuDeclared": {"metal": "true", "opencl": "false", "cuda": "false", "opengl": "false"}, // informational; host renders CPU only
  "hasOverlay": false,
  "clips": [{"name": "Source", "label": "Source", "optional": false, "isMask": false,
             "temporalClipAccess": false, "components": ["OfxImageComponentRGBA"]}, ...],
  "pages": [{"name": "Main", "label": "Optics Lab v1.2", "children": ["preset", "effectStrength", ...]}],
  "params": [ParamDescriptor, ...],        // definition order
  "error": "..."                            // only when loaded = false
}
```

## ParamDescriptor

Common fields:

```jsonc
{
  "name": "effectStrength",         // key for render/bake params
  "type": "double",                 // double | int | bool | choice | strchoice | string | rgb | rgba |
                                    // double2d | int2d | double3d | int3d | custom | bytes |
                                    // group | page | pushbutton | parametric
  "ofxType": "OfxParamTypeDouble",
  "label": "Lens Strength", "shortLabel"?: "...", "hint": "", "scriptName": "effectStrength",
  "parent": "lensGroup",            // group name or ""
  "page": "Main", "pageIndex": 1,   // position in the page's child list, null if not on a page
  "order": 11,                      // definition order (use for layout when no page info)
  "secret": false,                  // hidden in the plugin's own UI
  "enabled": true,
  "dimension": 1,                   // 0 for group/page/pushbutton
  "animates": true, "evaluateOnChange": true,   // value params only
  "default": 0.65                   // scalar for dimension 1, array for >1, bool for bool,
                                    // index for choice, string for string/strchoice
}
```

Type-specific fields:

- `double`, `double2d`, `double3d`, `rgb`, `rgba`: `min`, `max`, `displayMin`, `displayMax`
  (scalar or array; `null` = unbounded), `digits`, `increment`; non-colour doubles also
  `doubleType` (`OfxParamDoubleTypePlain`, `…Angle`, `…Scale`, `…X`, `…XY`, …) and
  `coordinateSystem` (`OfxParamCoordinatesCanonical` | `OfxParamCoordinatesNormalised`).
  For normalised spatial defaults the host converts the default to canonical pixels at instance
  creation; values you send are canonical.
- `int`, `int2d`, `int3d`: `min`, `max`, `displayMin`, `displayMax`.
- `choice`: `options` (labels; value = index), `optionEnums?`, `optionOrder?`.
- `strchoice`: `options` (labels), `optionEnums` (values).
- `string`: `stringMode` (`OfxParamStringIsSingleLine` | `…MultiLine` | `…FilePath` |
  `…DirectoryPath` | `…Label` | `…RichTextFormat`), `filePathExists`.
- `group`: `groupOpen`, `groupIsTab?`, `children` (param names whose `parent` is this group).
- `page`: `children`.
- multi-dimensional: `dimensionLabels` (`["x","y"]`, `["r","g","b","a"]`, …).

## Parameter values (render/bake `params`)

| type                         | accepted JSON                                                     |
|------------------------------|-------------------------------------------------------------------|
| double, int                  | number (also numeric string, bool); clamped to min/max            |
| double2d/3d, int2d/3d        | `[x, y(, z)]` or `{x, y, z}`                                       |
| rgb, rgba                    | `[r, g, b(, a)]`, `{r, g, b, a}` or `"#rrggbb"` / `"#rrggbbaa"` (0…1 floats) |
| bool                         | `true/false`, `0/1`, `"true"/"on"/"yes"`                         |
| choice                       | index, or option label / enum string (case-insensitive)          |
| strchoice                    | enum string, option label, or index into `optionEnums`           |
| string, custom               | string                                                            |
| group, page, pushbutton      | ignored with a warning (use `pressButtons`)                       |

Unknown names produce a warning, not an error. Values are constant over time
(`paramGetValueAtTime` returns the same value for every time; no keyframes yet).
