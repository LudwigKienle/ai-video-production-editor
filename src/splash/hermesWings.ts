/**
 * Hermes, messenger of the gods: a pair of small feathered wings that carry
 * the arrow in flight and turn into the two leaves of the logo on landing.
 *
 * The wing outline has the same six cubic segments as the leaf outline
 * (logoGeometry.leafSegs), so the morph is a plain point blend:
 *   leaf:  upper edge | root | lower edge | lower tip->notch | notch->tip (2 parts)
 *   wing:  leading edge | root | trailing edge to 1st feather | feather | feather | feather to tip
 * Coordinates: logo units, same frame as the logo arrow (the wings ride on it).
 */
import { ARTBOARD } from '../brand/brandTokens.ts';
import { cubic, leafSegs, line, type Pt, type Seg, type SubPath } from '../brand/logoGeometry.ts';
import { add, blendSubPath, mapSubPath, mul, norm, rotateAround, sub } from './shapeKit.ts';

const P = (x: number, y: number): Pt => [x - ARTBOARD.originX, y - ARTBOARD.originY];

/** Direction the feather tips of the trailing edge point to (down and out). */
const FEATHER_DIR: Pt = norm([-0.36, 0.93]);

/** One feather: from notch a out to a rounded tip and back in to notch b. */
const feather = (a: Pt, b: Pt, length: number): Seg => cubic(a, add(a, mul(FEATHER_DIR, length)), add(b, mul(FEATHER_DIR, length * 0.92)), b);

/** Left wing, open: long leading edge, four feathers growing towards the tip. */
export function wingSegs(): Seg[] {
  const W = P(616, 944), B = P(789, 1043), B2 = P(789, 1057);
  const along = (k: number): Pt => [B2[0] + (W[0] - B2[0]) * k, B2[1] + (W[1] - B2[1]) * k];
  const n1 = along(0.3), n2 = along(0.56), n3 = along(0.8);
  return [
    cubic(W, P(664, 924), P(752, 966), B), // leading edge, tip -> root
    line(B, B2), // root at the shaft
    feather(B2, n1, 22), // trailing edge: covert feathers ...
    feather(n1, n2, 30),
    feather(n2, n3, 36),
    feather(n3, W, 30), // ... to the primary at the tip
  ];
}

/** Root point the wing flaps around. */
export const WING_ROOT: Pt = P(789, 1050);

const mirrorPt = (p: Pt): Pt => [-p[0], p[1]];

/**
 * Both wings (left + mirrored right) as closed sub-paths.
 * @param flap rotation of the wings around their roots (radians, + = up)
 * @param unfurl 0..1 scale from the root (wing opening)
 * @param morph 0 = wing, 1 = logo leaf
 */
export function hermesWings(flap: number, unfurl: number, morph: number): SubPath[] {
  const wing: SubPath = { closed: true, segs: wingSegs() };
  const leaf: SubPath = { closed: true, segs: leafSegs() };
  const shaped = blendSubPath(wing, leaf, Math.max(0, Math.min(1, morph)));
  const s = Math.max(0.001, unfurl);
  const left = mapSubPath(shaped, (p) => rotateAround(add(WING_ROOT, mul(sub(p, WING_ROOT), s)), WING_ROOT, flap));
  const right = mapSubPath(left, mirrorPt);
  // Keep the mirrored copy clockwise as well.
  return [left, { closed: true, segs: [...right.segs].reverse().map((sg) => [sg[3], sg[2], sg[1], sg[0]] as Seg) }];
}
