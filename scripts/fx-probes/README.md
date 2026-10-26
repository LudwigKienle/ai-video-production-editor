# FX probes

Small C++ programs that run the original Buckswood Post Plugins cores (MIT, © Ludwig Kienle)
on a synthetic frame and write golden float32 RGBA frames for the TypeScript
reference tests in `src/fx/effects/*/__fixtures__/`.

## Optics Lab (v1.3.1)

```bash
B=~/Projekte/03_Code/Bucks-post-plugins+/buckswood-post-plugins
REF=origin/codex/optics-lab-v1.3.1-edge-mix
T=$(mktemp -d)
for f in include/OpticsLabCore.h include/OpticsAssetLibrary.h src/OpticsLabCore.cpp src/OpticsAssetLibrary.cpp third_party/stb_image.h; do
  git -C "$B" show "$REF:Buckswood_Optics_Lab/$f" > "$T/$(basename $f)"
done
clang++ -std=c++17 -O2 -I"$T" scripts/fx-probes/optics-lab-probe.cpp "$T/OpticsLabCore.cpp" "$T/OpticsAssetLibrary.cpp" -o "$T/probe"
"$T/probe" src/fx/effects/opticsLab/__fixtures__/cases.txt src/fx/effects/opticsLab/__fixtures__
```

## Deband (v1.0)

Sampler = OFX `ImageSampler` (integer, clamp-to-edge). Also writes `input.f32`
(the synthetic banded gradient) so the test can check the TS image bit-exactly.

```bash
B=~/Projekte/03_Code/Bucks-post-plugins+/buckswood-post-plugins/Buckswood_Deband
T=$(mktemp -d)
clang++ -std=c++17 -O2 -I"$B/include" scripts/fx-probes/deband-probe.cpp "$B/src/DebandCore.cpp" -o "$T/deband-probe"
"$T/deband-probe" src/fx/effects/deband/__fixtures__/cases.txt src/fx/effects/deband/__fixtures__
```

## Fake Diagnostic (v2.2)

Single-frame path (no temporal context). Sampler = OFX `FloatSampler`
(nearest, transparent black outside); the adjustment-layer guard is copied
from `BuckswoodFakeDiagnosticOFX.cpp`. Cases with `image=1` use the near-black
"adjustment layer" frame. Also writes `input.f32` / `input-blank.f32`.

```bash
B=~/Projekte/03_Code/Bucks-post-plugins+/buckswood-post-plugins/Buckswood_Fake_Diagnostic
T=$(mktemp -d)
clang++ -std=c++17 -O2 -I"$B/include" scripts/fx-probes/fake-diagnostic-probe.cpp "$B/src/FakeDiagnosticCore.cpp" -o "$T/fake-probe"
"$T/fake-probe" src/fx/effects/fakeDiagnostic/__fixtures__/cases.txt src/fx/effects/fakeDiagnostic/__fixtures__
```

## Lens Physics (v0.5)

The probe samples like the OFX `FloatSampler` (transparent black outside the
frame, no clamping), which is what Resolve renders.

```bash
B=~/Projekte/03_Code/Bucks-post-plugins+/buckswood-post-plugins
REF=2b898e7
T=$(mktemp -d)
for f in include/LensPhysicsCore.h src/LensPhysicsCore.cpp; do
  git -C "$B" show "$REF:Buckswood_Lens_Physics/$f" > "$T/$(basename $f)"
done
clang++ -std=c++17 -O2 -I"$T" scripts/fx-probes/lens-physics-probe.cpp "$T/LensPhysicsCore.cpp" -o "$T/probe"
"$T/probe" src/fx/effects/lensPhysics/__fixtures__/cases.txt src/fx/effects/lensPhysics/__fixtures__
```

## AI Photorealizer (v0.3)

```bash
B=~/Projekte/03_Code/Bucks-post-plugins+/buckswood-post-plugins
REF=2b898e7
T=$(mktemp -d)
for f in include/PhotorealizerCore.h src/PhotorealizerCore.cpp; do
  git -C "$B" show "$REF:Buckswood_AI_Photorealizer/$f" > "$T/$(basename $f)"
done
clang++ -std=c++17 -O2 -I"$T" scripts/fx-probes/photorealizer-probe.cpp "$T/PhotorealizerCore.cpp" -o "$T/probe"
"$T/probe" src/fx/effects/photorealizer/__fixtures__/cases.txt src/fx/effects/photorealizer/__fixtures__
```

Keep `cases.txt` and the `cases` array in each effect's `parity.ts` in sync
(the tests check this).

## Film Emulation (v2.1)

Single-frame path (no temporal context). Sampler = OFX `FloatSampler`
(bilinear, transparent black outside the frame). The adjustment-layer guard is copied from
`BuckswoodFilmEmulationOFX.cpp`. Two flags keep the goldens host independent:
`-ffp-contract=off` (no FMA fusion) and the probe's own correctly rounded
`sinf()` (Apple's libm `sinf` is only faithfully rounded, which flips the
core's `fract(sin(x) * 43758.5453)` grain/dust hash; add
`-DFX_PROBE_NATIVE_SINF` to see the libm variant).

```bash
B=~/Projekte/03_Code/Bucks-post-plugins+/buckswood-post-plugins/Buckswood_Film_Emulation
T=$(mktemp -d)
clang++ -std=c++17 -O2 -ffp-contract=off -I"$B/include" scripts/fx-probes/film-emulation-probe.cpp "$B/src/FilmEmulationCore.cpp" -o "$T/film-probe"
"$T/film-probe" src/fx/effects/filmEmulation/__fixtures__/cases.txt src/fx/effects/filmEmulation/__fixtures__
```
