# avpe-ofx-host

A small, CPU-only **OpenFX image-effect host** that runs as a sidecar process of the
AI Video Production Editor. It loads real `*.ofx.bundle` plugins (e.g. the Buckswood Post Plugins
plugins in `/Library/OFX/Plugins`) and lets the app

- bake clips through the original plugins (ffmpeg decode → plugin chain → ffmpeg encode),
- render proxy-resolution preview stills,
- use the plugins as a pixel oracle for the app's WebGL ports.

The Electron side lives in `electron/ofx/` (`ofxHostClient.js`, `registerOfxIpc.js`).

## Build

Requirements: macOS 11+, Xcode command line tools (`xcrun clang++`, C++17). No other dependencies.

```sh
make -C native/ofx-host            # -> native/ofx-host/build/avpe-ofx-host (arm64)
make -C native/ofx-host universal  # arm64 + x86_64 via lipo
make -C native/ofx-host smoke      # build + scripts/smoke.sh
```

The OpenFX 1.5.1 API headers are vendored in `third_party/openfx/include`
(`OFX_INCLUDE=…` overrides).

## Quick check

```sh
native/ofx-host/build/avpe-ofx-host --scan                       # JSON of all installed plugins
native/ofx-host/build/avpe-ofx-host --scan /Library/OFX/Plugins/BuckswoodOpticsLab.ofx.bundle
native/ofx-host/scripts/smoke.sh [--all] [--no-bake] [--out DIR]  # scan + renders + 1 s bake
node --test electron/ofx/ofxHostClient.test.js
```

The smoke script renders a float gradient (with a > 1.0 hot spot) through Optics Lab
(`preset` = 6 and 3), Film Emulation, Lens Physics and Deband (`--all`: every Buckswood Post Plugins
plugin), checks that the output differs from the input and contains no NaN/Inf, writes
PNG + PPM previews to `$TMPDIR/avpe-ofx-smoke`, and bakes a generated 1 s clip through
Optics Lab → Film Emulation to ProRes 422 HQ.

## Protocol (summary)

JSON header line + optional binary payload (`binarySize` bytes) over stdin/stdout; one
response per request id; progress events carry `event`. Commands: `status`, `scan`,
`describe`, `render`, `framesNeeded`, `getParams`, `destroyInstance`, `destroyAll`, `bake`,
`cancel`, `shutdown`. Pixels are top-down RGBA in `rgba32f` (default), `rgba16` or `rgba8`.
Full specification, descriptor JSON shapes and accepted parameter values: [PROTOCOL.md](PROTOCOL.md).

## What the host implements

| Suite / feature | Notes |
|---|---|
| Property suite V1 | full; lenient int↔double conversion, arrays grow on set |
| Image effect suite V1 | clips, `clipGetImage`/`clipReleaseImage` (leaks are released after render), `clipGetRegionOfDefinition`, `abort`, image memory |
| Parameter suite V1 | double/int/bool/choice/strchoice/string/custom/rgb/rgba/2D/3D/group/page/pushbutton; `paramGetValue(AtTime)`, `paramSetValue(AtTime)`, derivative/integral, key functions (no keys), `paramCopy`, edit begin/end |
| Multithread suite V1 | real pthreads (8 MB stacks), `multiThread` blocks until done, nested calls return `kOfxStatErrExists`, recursive mutexes |
| Memory suite V1, Message suite V1/V2, Progress suite V1/V2, Timeline suite V1 | messages are logged to stderr; errors are reported in the render error |
| Actions | load, describe, describeInContext (filter, general), createInstance, getClipPreferences (depth honoured), beginSequenceRender/endSequenceRender, render, getFramesNeeded, begin/instanceChanged/end, destroyInstance |
| Contexts | **Filter**; **General** when every mandatory input is the `Source` clip |
| Pixel depths | float (preferred), short, byte; RGBA only |
| Temporal access | yes: `clipGetImage` at other times returns supplied neighbour frames (nearest frame fallback); bake keeps a ±2 frame ring buffer per temporal stage |
| GPU | never advertised (`Metal/OpenCL/CUDA/OpenGL RenderSupported = "false"`, `…Enabled = 0` in render args) so plugins take their CPU path |
| Host identity | `kOfxPropName = "org.avpe.ofxhost"`, label "AVPE OFX Host" (override: `--host-name/--host-label` or `AVPE_OFX_HOST_NAME/LABEL`) |

Host properties: `IsBackground = 1`, `SupportsOverlays = 0`, `SupportsTiles = 0`,
`TemporalClipAccess = 1`, `SupportsMultiResolution = 1`, native origin bottom-left.

## Robustness

- The parent never crashes: the host is a separate process. Fatal signals inside a plugin are
  turned into a JSON error for the current request (`crashed: true`) before the process exits;
  the Node client restarts it lazily (max 5 restarts/min) and re-sends instance parameters.
- `scan` describes every bundle in its own child process (`--describe-bundle`), with a timeout,
  so crashing or hanging plugins only fail their own entry. Results are cached per bundle
  (`cacheFile`, keyed by binary/Info.plist size+mtime).
- Inputs are validated (sizes, formats, payload length); plugin C++ exceptions are caught; plugin
  stdout output is redirected to stderr so it cannot corrupt the protocol.
- The Node client serializes requests, applies per-request timeouts (kills a hung host), and runs
  each bake in a dedicated host process (cancel via `AbortSignal` → `cancel` command → kill after 8 s).

## Installed plugins (tested on this Mac, 2026-10-26)

All 13 Buckswood Post Plugins plugin ids from 12 bundles (Relight Studio is installed twice: v1.0 in `/Library`,
v1.1 in `~/Library`; the higher version wins) load, describe and render on this host: AI Photorealizer, Art Director, Cinematic
Tools (Frame Director, Radiance Recover, Temporal Integrity), DeJitter, Deband, Fake Diagnostic,
Film Emulation, Lens Physics, Look DNA, Optics Lab, Relight Studio. None of them checks the host
name, so no Resolve impersonation is needed. Third-party bundles (Dehancer Pro 7, Genesis, Higgsfield
Color Match, Topaz Video) also describe successfully; Topaz is general-context, temporal, and needs
its own app/licence, Dehancer/Genesis are float-only. Third-party rendering is not part of the tests.

Buckswood Post Plugins notes:
- Optics Lab / Lens Physics / AI Photorealizer would use Metal when the host enables it; this host
  does not, so they render on the CPU path (identical to Resolve's CPU fallback).
- Look DNA's `browseReference*` buttons open a native file dialog: the host never presses buttons
  on its own; set `referencePath*` strings instead (`refreshReference` may be pressed via `pressButtons`).
- DeJitter's on-viewer tracking overlay is not available (no interact suite); set `trackPoint` etc. as values.
- Temporal plugins (Cinematic Tools, DeJitter, Look DNA, Fake Diagnostic) ask for ±1–2 frames; supply
  them via `frames` (see `framesNeeded`) or they get the nearest supplied frame.

## Limitations

- No keyframes/animation curves (constant values per call); no interacts/overlays, no draw suite,
  no parametric params, no OpenGL/Metal/CUDA/OpenCL rendering, no tiles, no multiple clip depths,
  RGBA only (no Alpha-only/RGB clips), no fielded/interlaced rendering, pixel aspect ratio 1.
- Generators, transitions and general-context plugins that need extra mandatory inputs are listed
  but marked `supported: false`.
- `kOfxActionIsIdentity` and region-of-interest/definition actions are not called; the full frame
  is always rendered.
- Colour: the bake hands plugins the decoded video code values (display-referred, e.g. Rec.709
  gamma), like a Rec.709 Resolve timeline; no colour management/OCIO is applied.
- Bake memory: each frame is stored as float RGBA (4K ≈ 133 MB); temporal stages keep 2·radius+1 frames.
- The packaged app must ship the binary signed with the app's entitlements
  (`com.apple.security.cs.disable-library-validation`) so it can `dlopen` third-party plugins under
  the hardened runtime.

## Packaging

Add to `package.json → build`:

```json
"extraResources": [{ "from": "native/ofx-host/build/avpe-ofx-host", "to": "ofx-host/avpe-ofx-host" }]
```

The client looks for the binary at `$AVPE_OFX_HOST_PATH`, then
`process.resourcesPath/ofx-host/avpe-ofx-host` (packaged), then
`<appPath|cwd>/native/ofx-host/build/avpe-ofx-host` (dev). Build the universal binary for the
universal app (`make universal`). Make sure electron-builder signs it with the app entitlements
(e.g. list it under `mac.binaries`), otherwise notarization fails and the hardened runtime blocks
loading plugins that are signed by other teams.

## License notes

- This host (all files in `native/ofx-host/src`, `scripts`, and `electron/ofx`) is part of the app and
  licensed **GPL-3.0-or-later**. It was written from scratch against the public OpenFX API headers;
  no code from Natron, Blender, or any other GPL/LGPL OFX host was used or consulted.
- `third_party/openfx/include` and `third_party/openfx/LICENSE.md`: OpenFX API headers,
  **BSD-3-Clause** © OpenFX and contributors (compatible with GPL-3.0; keep the licence file).
- ffmpeg is never linked; it is executed as an external process.
- Plugins are loaded at run time and keep their own licences (Buckswood Post Plugins plugins: MIT).
