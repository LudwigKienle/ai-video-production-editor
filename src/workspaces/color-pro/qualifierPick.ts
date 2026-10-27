import type { FxParamValues } from '../../fx/types.ts';

/** Qualifier params centred on a picked colour (0..1 RGB). */
export function qualifierFromPick(rgb: [number, number, number]): FxParamValues {
  const [r, g, b] = rgb.map((v) => Math.min(1, Math.max(0, v)));
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  const d = mx - mn;
  const s = d > 1e-6 ? d / Math.max(1e-6, 1 - Math.abs(2 * l - 1)) : 0;
  let h = 0;
  if (d > 1e-6) {
    if (mx === r) h = (g - b) / d;
    else if (mx === g) h = 2 + (b - r) / d;
    else h = 4 + (r - g) / d;
    h *= 60;
    if (h < 0) h += 360;
  }
  const round = (v: number, k = 1000) => Math.round(v * k) / k;
  return {
    qualEnabled: true,
    qualHueOn: s > 0.08,
    qualHue: round(h, 10),
    qualHueWidth: 18,
    qualHueSoft: 12,
    qualSatOn: true,
    qualSatLow: round(Math.max(0, s - 0.25)),
    qualSatHigh: round(Math.min(1, s + 0.25)),
    qualSatSoft: 0.08,
    qualLumOn: true,
    qualLumLow: round(Math.max(0, l - 0.25)),
    qualLumHigh: round(Math.min(1, l + 0.25)),
    qualLumSoft: 0.08,
    qualInvert: false,
  };
}
