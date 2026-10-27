/**
 * Small vector helpers for the splash figures (own Bézier construction).
 */
import { cubic, line, segPoint, subPathToD, type Pt, type Seg, type SubPath } from '../brand/logoGeometry.ts';

export const add = (a: Pt, b: Pt): Pt => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Pt, b: Pt): Pt => [a[0] - b[0], a[1] - b[1]];
export const mul = (a: Pt, k: number): Pt => [a[0] * k, a[1] * k];
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const lerpP = (a: Pt, b: Pt, t: number): Pt => [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
export const len = (a: Pt) => Math.hypot(a[0], a[1]);
export const norm = (a: Pt): Pt => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
/** Left normal (y down: rotates direction by -90°). */
export const perp = (a: Pt): Pt => [a[1], -a[0]];
export const rotateAround = (p: Pt, c: Pt, rad: number): Pt => {
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const dx = p[0] - c[0], dy = p[1] - c[1];
  return [c[0] + dx * cos - dy * sin, c[1] + dx * sin + dy * cos];
};

/** Circular arc as cubics from angle a0 to a1 (radians, y down). */
export function arcSegs(c: Pt, r: number, a0: number, a1: number): Seg[] {
  const total = a1 - a0;
  const n = Math.max(1, Math.ceil(Math.abs(total) / (Math.PI / 2)));
  const step = total / n;
  const k = (4 / 3) * Math.tan(step / 4);
  const segs: Seg[] = [];
  for (let i = 0; i < n; i += 1) {
    const s0 = a0 + step * i, s1 = s0 + step;
    const p0: Pt = [c[0] + r * Math.cos(s0), c[1] + r * Math.sin(s0)];
    const p3: Pt = [c[0] + r * Math.cos(s1), c[1] + r * Math.sin(s1)];
    segs.push([p0, [p0[0] - k * r * Math.sin(s0), p0[1] + k * r * Math.cos(s0)], [p3[0] + k * r * Math.sin(s1), p3[1] - k * r * Math.cos(s1)], p3]);
  }
  return segs;
}

/** Tapered capsule between two circles (convex hull), clockwise. */
export function limb(a: Pt, b: Pt, ra: number, rb: number): SubPath {
  const d = sub(b, a);
  const L = Math.max(0.001, len(d));
  const ang = Math.atan2(d[1], d[0]);
  const alpha = Math.asin(Math.max(-0.99, Math.min(0.99, (ra - rb) / L)));
  const up = ang - Math.PI / 2 - alpha; // tangent side 1
  const down = ang + Math.PI / 2 + alpha; // tangent side 2
  const pa1: Pt = [a[0] + ra * Math.cos(up), a[1] + ra * Math.sin(up)];
  const pb1: Pt = [b[0] + rb * Math.cos(up), b[1] + rb * Math.sin(up)];
  const pb2: Pt = [b[0] + rb * Math.cos(down), b[1] + rb * Math.sin(down)];
  const pa2: Pt = [a[0] + ra * Math.cos(down), a[1] + ra * Math.sin(down)];
  return orient({
    closed: true,
    segs: [line(pa1, pb1), ...arcSegs(b, rb, up, down < up ? down + Math.PI * 2 : down), line(pb2, pa2), ...arcSegs(a, ra, down, up + Math.PI * 2 > down ? up + Math.PI * 2 : up)],
  });
}

export function ellipse(c: Pt, rx: number, ry: number, deg = 0): SubPath {
  const rad = (deg * Math.PI) / 180;
  const segs = arcSegs([0, 0], 1, 0, Math.PI * 2).map((s) => s.map((p) => {
    const x = p[0] * rx, y = p[1] * ry;
    return [c[0] + x * Math.cos(rad) - y * Math.sin(rad), c[1] + x * Math.sin(rad) + y * Math.cos(rad)] as Pt;
  }) as Seg);
  return orient({ closed: true, segs });
}

export const signedArea = (sp: SubPath): number => {
  let area = 0;
  for (const s of sp.segs) {
    let prev = s[0];
    for (let i = 1; i <= 8; i += 1) {
      const p = segPoint(s, i / 8);
      area += prev[0] * p[1] - p[0] * prev[1];
      prev = p;
    }
  }
  return area / 2;
};

export const reverseSubPath = (sp: SubPath): SubPath => ({ closed: sp.closed, segs: [...sp.segs].reverse().map((s) => [s[3], s[2], s[1], s[0]] as Seg) });

/** Normalises winding so overlapping masses union under the nonzero rule. */
export const orient = (sp: SubPath): SubPath => (signedArea(sp) < 0 ? reverseSubPath(sp) : sp);

/** Closed shape from a chain of cubics. */
export const shape = (...segs: Seg[]): SubPath => orient({ closed: true, segs });
export const stroke = (...segs: Seg[]): SubPath => ({ closed: false, segs });

/** Cubic through-points helper: smooth curve a -> b with tangents ta/tb (lengths in units). */
export const curve = (a: Pt, ta: Pt, tb: Pt, b: Pt): Seg => cubic(a, add(a, ta), sub(b, tb), b);

export const toD = (paths: SubPath[]): string => paths.map(subPathToD).join('');

export const mapSubPath = (sp: SubPath, fn: (p: Pt) => Pt): SubPath => ({ closed: sp.closed, segs: sp.segs.map((s) => s.map(fn) as Seg) });

/** Linear blend of two equal-structure sub-paths (morph). */
export const blendSubPath = (a: SubPath, b: SubPath, t: number): SubPath => ({
  closed: a.closed,
  segs: a.segs.map((s, i) => s.map((p, j) => lerpP(p, b.segs[i][j], t)) as Seg),
});
