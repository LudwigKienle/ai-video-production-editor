/**
 * Shared parity fixture for Film Emulation: the synthetic frame of
 * `scripts/fx-probes/film-emulation-probe.cpp`, the golden cases and the CPU
 * reference. Used by filmEmulation.test.ts (CPU vs C++ goldens) and by the
 * dev page (GPU vs CPU). Keep CASES in sync with __fixtures__/cases.txt (the
 * test enforces it).
 */
import { renderFilmEmulationCpu, type FloatImage } from './cpu.ts';
import { controlsFromParams, prepareFilm } from './model.ts';

const W = 40;
const H = 24;
const F = Math.fround;

/** Bit-identical to the probe image (row 0 = bottom, HDR spots, alpha ramp). */
function image(): FloatImage {
  const data = new Float32Array(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      const arg = F(F(x * F(0.7)) + F(y * F(0.3)));
      data[i] = F(x / (W - 1));
      data[i + 1] = F(y / (H - 1));
      data[i + 2] = F(0.5 + F(0.5 * F(Math.sin(arg))));
      data[i + 3] = F(x / (W - 1));
      if ((x - 10) ** 2 + (y - 8) ** 2 < 6) data.fill(3, i, i + 3);
      if ((x - 30) ** 2 + (y - 16) ** 2 < 4) data.set([1.6, 1.4, 1.2], i);
    }
  }
  return { width: W, height: H, data };
}

export const FILM_EMULATION_CASES_TEXT = `defaults-ai
kodak-2383 inputSpace=0 stockPreset=3 printPreset=1 outputMix=1 frameIndex=3
night-500t inputSpace=0 stockPreset=2 printPreset=7 grainProfile=3 grain=0.35 halationProfile=3 frameIndex=5
eterna-soft inputSpace=0 stockPreset=4 printPreset=2 grainProfile=4 grainMode=0 frameIndex=1
doc-16mm stockPreset=5 printPreset=3 grainProfile=2 grainMode=2 grain=0.6 grainSize=2 gateWeave=0.5 halationProfile=2 bloomProfile=2 frameIndex=11
bleach-silver stockPreset=6 printPreset=5 bleachBypass=0.5 outputMix=1
bw-mono stockPreset=7 printPreset=8 grainMode=3 grain=0.5 grainProfile=4 frameIndex=6
grain-classic-8mm grainMode=0 grain=1 grainSize=0 grainChroma=1 grainProfile=1 grainShadows=1 grainMidtones=1 grainHighlights=1 filmResolution=0 frameIndex=2
grain-fine-65mm grainMode=1 grain=0.8 grainSize=3 grainProfile=5 frameIndex=9
halation-extreme halationProfile=5 halation=1 halationLocal=1 halationGlobal=1 halationRedShift=1 bloomProfile=1 bloom=1 bloomThreshold=0.2 bloomSpread=1
damage dust=1 scratches=1 flicker=1 filmBreath=1 gateWeave=1 frameIndex=17
linear-hdr inputSpace=2 stockPreset=13 printPreset=7 exposure=1 pushPull=1 outputMix=1 frameIndex=4
slog3-printer inputSpace=3 stockPreset=14 printPreset=4 printerCyan=0.5 printerMagenta=-0.4 printerYellow=0.3 temperature=0.6 tint=-0.5
logc4-skin inputSpace=5 stockPreset=9 printPreset=6 skinProtect=1 colorSeparation=1 temperature=-1 tint=1
extremes exposure=-2 pushPull=2 density=1.5 contrast=1.8 developerContrast=1 developerGamma=-1 colorSeparation=1 colorBoost=1 saturation=1.6 interlayer=1 neutralizeCurves=1 filmCompression=1 compressionWhitePoint=0.35 compressionRange=1 compressionColorDensity=1 expandBlackPoint=1 expandWhitePoint=-1 blackLift=1 highlightRolloff=1 outputMix=1
extremes-low exposure=2 density=-0.5 contrast=0.4 developerContrast=-1 developerGamma=1 colorBoost=-1 saturation=0 subtractiveColor=1 expandBlackPoint=-1 expandWhitePoint=1 blackLift=-1 highlightRolloff=0 compressionWhitePoint=4 compressionRange=0.05
color-only processMode=1 stockPreset=11 printPreset=6 inputSpace=4
texture-only processMode=2 stockPreset=10 inputSpace=6 frameIndex=8
view-grain viewMode=1 grainMode=2 grainSize=1.5 frameIndex=4
view-halation viewMode=2 halation=0.6 bloom=0.4 inputSpace=7
view-density viewMode=3 stockPreset=15 printPreset=7
view-temporal viewMode=4 exposure=0.5 flicker=1 filmBreath=1 frameIndex=7
`;

export type FilmParityCase = { name: string; params: Record<string, number>; frameIndex: number };

export function parseFilmCases(text: string): FilmParityCase[] {
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
    .map((line) => {
      const [name, ...pairs] = line.split(/\s+/);
      const params: Record<string, number> = {};
      let frameIndex = 0;
      for (const pair of pairs) {
        const [key, value] = pair.split('=');
        if (key === 'frameIndex') frameIndex = Number(value);
        else params[key] = Number(value);
      }
      return { name, params, frameIndex };
    });
}

export const FILM_EMULATION_PARITY = {
  effectId: 'buckswood-post-plugins.film-emulation',
  width: W,
  height: H,
  image,
  cases: parseFilmCases(FILM_EMULATION_CASES_TEXT),
  cpu(source: FloatImage, params: Record<string, unknown>, frameIndex: number): FloatImage {
    const state = prepareFilm({ width: source.width, height: source.height, frameIndex }, controlsFromParams(params));
    return renderFilmEmulationCpu(source, state);
  },
};
