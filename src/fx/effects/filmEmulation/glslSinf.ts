/**
 * Float32 hash of the Film Emulation core on the GPU.
 *
 * `FilmEmulationCore::hash` is fract(sinf(arg) * 43758.5453f) — chaotic in
 * the last bit of both `arg` and `sinf(arg)`. GPU `sin()` is far too
 * imprecise for that (and differs per vendor), so the shader carries its own
 * nearly correctly rounded sinf:
 *
 * - exact Cody–Waite reduction by π/2 (six 10-bit pieces, k split into
 *   11+14 bits so every k·P product is exact) accumulated with TwoSum,
 * - sin/cos polynomials evaluated in double-float (Dekker TwoProd),
 * - every IEEE-critical op goes through `fe_opq()` (XOR with the uniform
 *   `fe_zeroBits`, always 0): this blocks FMA contraction and the fast-math
 *   reassociation that WebGL-on-Metal applies (without it TwoSum collapses).
 *
 * Valid for |arg| < ~6e7 (≈ frame 700 000 at 4K); beyond that results stay
 * deterministic but stop matching the CPU bit for bit. `sinfGpuMirror()` is
 * the same algorithm op by op in float32 TypeScript — the test checks it
 * against a correctly rounded sinf.
 */

const F = Math.fround;

/** GLSL float literal of a float32 value (exact round trip). */
export const glslFloat = (value: number): string => {
  const text = String(F(value));
  return /[.e]/.test(text) ? text : `${text}.0`;
};

const P = [1.5703125, 0.0004825592041015625, 0.0000012665987014770508, 9.913492249324918e-10, 7.442935157087049e-13, 6.071532165918825e-17].map(F);
const PT = F(5.170182817331536e-19);
const TWO_OVER_PI = F(2 / Math.PI);
const S1H = F(-1 / 6);
const S1L = F(-1 / 6 - S1H);
const S2 = F(1 / 120);
const S2L = F(1 / 120 - S2);
const S3 = F(-1 / 5040);
const S4 = F(1 / 362880);
const S5 = F(-1 / 39916800);
const C2 = F(1 / 24);
const C2L = F(1 / 24 - C2);
const C3 = F(-1 / 720);
const C4 = F(1 / 40320);
const C5 = F(-1 / 3628800);
const C6 = F(1 / 479001600);
const SIXTH = F(1 / 6);

export const K_HASH = { x: F(12.9898), y: F(78.233), seed: F(37.719), scale: F(43758.5453) };

const g = glslFloat;

export const FE_SINF_GLSL = /* glsl */ `
uniform int fe_zeroBits;

// Optimisation barrier: an XOR with an unknown (always 0) uniform. The
// compiler can neither fuse across it (no FMA contraction) nor reassociate
// through it (WebGL on Metal compiles with fast-math).
float fe_opq(float x) { return intBitsToFloat(floatBitsToInt(x) ^ fe_zeroBits); }
float fe_mul(float a, float b) { return fe_opq(a * b); }
float fe_add(float a, float b) { return fe_opq(a + b); }
float fe_sub(float a, float b) { return fe_opq(a - b); }

void fe_twoSum(float a, float b, out float s, out float e) {
  s = fe_add(a, b);
  float bb = fe_sub(s, a);
  e = fe_add(fe_sub(a, fe_sub(s, bb)), fe_sub(b, bb));
}

void fe_split(float a, out float hi, out float lo) {
  float t = fe_mul(4097.0, a);
  hi = fe_sub(t, fe_sub(t, a));
  lo = fe_sub(a, hi);
}

void fe_twoProd(float a, float b, out float p, out float e) {
  p = fe_mul(a, b);
  float ah; float al; float bh; float bl;
  fe_split(a, ah, al);
  fe_split(b, bh, bl);
  e = fe_add(fe_add(fe_add(fe_sub(fe_mul(ah, bh), p), fe_mul(ah, bl)), fe_mul(al, bh)), fe_mul(al, bl));
}

const float FE_P[6] = float[6](${P.map(g).join(', ')});

void fe_reduce(inout float s, inout float e, float k) {
  float khi = floor(fe_mul(k, ${g(1 / 2048)}));
  float klo = fe_sub(k, fe_mul(khi, 2048.0));
  float t; float err;
  for (int i = 0; i < 6; ++i) {
    fe_twoSum(s, -fe_mul(fe_mul(khi, FE_P[i]), 2048.0), t, err);
    s = t; e = fe_add(e, err);
    fe_twoSum(s, -fe_mul(klo, FE_P[i]), t, err);
    s = t; e = fe_add(e, err);
  }
  e = fe_sub(e, fe_mul(k, ${g(PT)}));
  fe_twoSum(s, e, t, err);
  s = t; e = err;
}

float fe_sinf(float x) {
  float a = fe_opq(x);
  float k = floor(fe_add(fe_mul(a, ${g(TWO_OVER_PI)}), 0.5));
  float rh = a;
  float rl = 0.0;
  fe_reduce(rh, rl, k);
  float k2 = floor(fe_add(fe_mul(rh, ${g(TWO_OVER_PI)}), 0.5));
  int q = int(k);
  if (k2 != 0.0) {
    fe_reduce(rh, rl, k2);
    q += int(k2);
  }
  q = q & 3;
  float zh; float zl;
  fe_twoProd(rh, rh, zh, zl);
  float s; float e; float u; float ue; float th; float tl;
  if (q == 0 || q == 2) {
    float c3h; float c3l;
    fe_twoProd(rh, zh, c3h, c3l);
    c3l = fe_add(c3l, fe_mul(rh, zl));
    fe_twoProd(c3h, ${g(S1H)}, th, tl);
    tl = fe_add(tl, fe_add(fe_mul(c3h, ${g(S1L)}), fe_mul(c3l, ${g(S1H)})));
    float r5h; float r5l;
    fe_twoProd(c3h, zh, r5h, r5l);
    r5l = fe_add(r5l, fe_add(fe_mul(c3l, zh), fe_mul(c3h, zl)));
    float t5h; float t5l;
    fe_twoProd(r5h, ${g(S2)}, t5h, t5l);
    t5l = fe_add(t5l, fe_add(fe_mul(r5l, ${g(S2)}), fe_mul(r5h, ${g(S2L)})));
    float tail = fe_mul(fe_mul(r5h, zh), ${g(S3)} + zh * (${g(S4)} + zh * ${g(S5)}));
    fe_twoSum(rh, th, s, e);
    fe_twoSum(s, t5h, u, ue);
    s = u; e = fe_add(e, ue);
    e = fe_add(e, fe_add(fe_add(fe_add(tl, t5l), tail), fe_mul(rl, 1.0 - fe_mul(zh, 0.5 - fe_mul(zh, ${g(C2)})))));
  } else {
    fe_twoSum(1.0, -fe_mul(zh, 0.5), s, e);
    float z2h; float z2l;
    fe_twoProd(zh, zh, z2h, z2l);
    fe_twoProd(z2h, ${g(C2)}, th, tl);
    tl = fe_add(tl, fe_add(fe_mul(fe_add(z2l, fe_mul(2.0 * zh, zl)), ${g(C2)}), fe_mul(z2h, ${g(C2L)})));
    float tail = fe_mul(fe_mul(z2h, zh), ${g(C3)} + zh * (${g(C4)} + zh * (${g(C5)} + zh * ${g(C6)})));
    fe_twoSum(s, th, u, ue);
    s = u; e = fe_add(e, ue);
    e = fe_add(e, fe_sub(fe_add(fe_sub(tl, fe_mul(zl, 0.5)), tail), fe_mul(fe_mul(rl, rh), 1.0 - fe_mul(zh, ${g(SIXTH)}))));
  }
  float r = fe_add(s, e);
  return q >= 2 ? -r : r;
}

/** FilmEmulationCore::hash (float32 exact on IEEE GPUs). */
float fe_hash(float x, float y, float seed) {
  float arg = fe_add(fe_add(fe_mul(x, ${g(K_HASH.x)}), fe_mul(y, ${g(K_HASH.y)})), fe_mul(seed, ${g(K_HASH.seed)}));
  float v = fe_mul(fe_sinf(arg), ${g(K_HASH.scale)});
  return fe_sub(v, floor(v));
}
`;

// --- TypeScript mirror (float32, op by op) ---------------------------------

const add = (a: number, b: number) => F(a + b);
const sub = (a: number, b: number) => F(a - b);
const mul = (a: number, b: number) => F(a * b);

function twoSum(a: number, b: number): [number, number] {
  const s = add(a, b);
  const bb = sub(s, a);
  return [s, add(sub(a, sub(s, bb)), sub(b, bb))];
}

function split(a: number): [number, number] {
  const t = mul(4097, a);
  const hi = sub(t, sub(t, a));
  return [hi, sub(a, hi)];
}

function twoProd(a: number, b: number): [number, number] {
  const p = mul(a, b);
  const [ah, al] = split(a);
  const [bh, bl] = split(b);
  return [p, add(add(add(sub(mul(ah, bh), p), mul(ah, bl)), mul(al, bh)), mul(al, bl))];
}

function reduce(s: number, e: number, k: number): [number, number] {
  const khi = Math.floor(mul(k, F(1 / 2048)));
  const klo = sub(k, mul(khi, 2048));
  for (let i = 0; i < 6; i += 1) {
    let r = twoSum(s, -mul(mul(khi, P[i]), 2048));
    s = r[0];
    e = add(e, r[1]);
    r = twoSum(s, -mul(klo, P[i]));
    s = r[0];
    e = add(e, r[1]);
  }
  e = sub(e, mul(k, PT));
  return twoSum(s, e);
}

/** Float32 TypeScript mirror of `fe_sinf` (for tests). */
export function sinfGpuMirror(a: number): number {
  const k = Math.floor(add(mul(a, TWO_OVER_PI), 0.5));
  let [rh, rl] = reduce(F(a), 0, k);
  const k2 = Math.floor(add(mul(rh, TWO_OVER_PI), 0.5));
  let q = k | 0;
  if (k2 !== 0) {
    [rh, rl] = reduce(rh, rl, k2);
    q += k2;
  }
  q &= 3;
  const [zh, zl] = twoProd(rh, rh);
  let s: number;
  let e: number;
  if (q === 0 || q === 2) {
    let [c3h, c3l] = twoProd(rh, zh);
    c3l = add(c3l, mul(rh, zl));
    let [th, tl] = twoProd(c3h, S1H);
    tl = add(tl, add(mul(c3h, S1L), mul(c3l, S1H)));
    let [r5h, r5l] = twoProd(c3h, zh);
    r5l = add(r5l, add(mul(c3l, zh), mul(c3h, zl)));
    let [t5h, t5l] = twoProd(r5h, S2);
    t5l = add(t5l, add(mul(r5l, S2), mul(r5h, S2L)));
    const tail = mul(mul(r5h, zh), add(S3, mul(zh, add(S4, mul(zh, S5)))));
    [s, e] = twoSum(rh, th);
    const u = twoSum(s, t5h);
    s = u[0];
    e = add(e, u[1]);
    e = add(e, add(add(add(tl, t5l), tail), mul(rl, sub(1, mul(zh, sub(0.5, mul(zh, C2)))))));
  } else {
    [s, e] = twoSum(1, -mul(zh, 0.5));
    const [z2h, z2l] = twoProd(zh, zh);
    let [th, tl] = twoProd(z2h, C2);
    tl = add(tl, add(mul(add(z2l, mul(mul(2, zh), zl)), C2), mul(z2h, C2L)));
    const tail = mul(mul(z2h, zh), add(C3, mul(zh, add(C4, mul(zh, add(C5, mul(zh, C6)))))));
    const u = twoSum(s, th);
    s = u[0];
    e = add(e, u[1]);
    e = add(e, sub(add(sub(tl, mul(zl, 0.5)), tail), mul(mul(rl, rh), sub(1, mul(zh, SIXTH)))));
  }
  const r = add(s, e);
  return q >= 2 ? -r : r;
}
