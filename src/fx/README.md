# Buckswood Post Plugins FX engine

One WebGL2 effect engine shared by the Photo editor, the timeline preview and
export, so preview and final render look the same.

```
src/fx/
  types.ts        FxDefinition / FxParamDef / FxInstance (stored in projects)
  registry.ts     registerFx, createFxInstance, resolveParams
  renderer.ts     FxRenderer (WebGL2, float targets, multi-pass)
  glsl.ts         shared GLSL header: bw_sample (exact bilinear), luma, hash …
  effects/<id>/   one folder per effect
  dev/fxLab.ts    dev page /fx-lab.html: GPU-vs-CPU parity + preset grid
```

## Conventions

- Pixel centres on integer coordinates, origin **bottom-left, y up** (OFX).
  The renderer uploads sources with `UNPACK_FLIP_Y`, so shaders can use the
  Buckswood Post Plugins C++ math unchanged. `bw_pixel()` returns the current pixel.
- `bw_sample(u_src, p)` is the clamped bilinear sampler of the Buckswood Post Plugins
  `FloatSampler` (manual texelFetch — hardware filtering is not precise
  enough next to HDR values). Values are unclamped floats (RGBA16F targets).
- Uniforms are set by name; types are discovered from the program, so a pass
  can return numbers, booleans and number arrays from `uniforms()`.
- Extra luminance textures (procedural assets, LUT slices) come from
  `pass.textures()`; they are cached by `key`. Sample them with
  `bw_asset(tex, uv)` (nearest, clamped — like Buckswood Post Plugins `TextureView`).
- Multi-pass effects: list passes in order; `inputs: ['blurH']` exposes an
  earlier pass as `u_pass_blurH`. `u_orig` is always the effect's input.

## Adding a Buckswood Post Plugins effect

1. `effects/<name>/model.ts` – port of the C++ `prepare()` and preset tables
   (keep field order and constants; cite the source file).
2. `effects/<name>/shader.ts` – GLSL port of `processPixel`.
3. `effects/<name>/cpu.ts` – TypeScript reference with the same math.
4. `effects/<name>/index.ts` – `FxDefinition` (params/defaults identical to
   the OFX descriptor, `ofxIdentifier`, groups, presets).
5. `effects/<name>/__fixtures__/` – golden frames generated from the
   original C++ core (probe source in `scripts/fx-probes/`), plus
   `<name>.test.ts` comparing the CPU reference against them.
6. Register in `registry.ts` and add the cases to `dev/fxLab.ts` to check
   the GPU path against the CPU reference.
