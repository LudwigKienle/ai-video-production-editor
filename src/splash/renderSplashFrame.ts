/**
 * Start animation, rendered as a pure function of time.
 *
 *   renderSplashFrame(ctx, tSeconds, opts)
 *
 * Same t + same opts = same picture (no clocks, no randomness), so every frame
 * can be reproduced exactly: in the app overlay (requestAnimationFrame) and in
 * the preview renderer (scripts/brand/render-splash-preview.mjs, 60 fps).
 *
 * Story: Diana, goddess of the hunt, looses the arrow. Hermes, messenger of the
 * gods, carries it on two small wings. The message he delivers is the logo:
 * the wings become the leaves, then loop, ring, antler, eyes and smile appear,
 * followed by wordmark, rule and claim.
 *
 * Layers (opts.layers, all on by default): background, diana, hermes, trail,
 * arrow, fletching, impact, leaves, loop, ring, antler, eyes, smile, shimmer,
 * wordmark, product, rule, claim.
 */
import { BRAND_PALETTES, DEFAULT_WORDMARK, type BrandPalette, type WordmarkMode } from '../brand/brandTokens.ts';
import { colorOf, drawPart, drawTextLine, path2d, setLogoPalette } from '../brand/drawLogo.ts';
import { ARROW_CENTER, ARROW_TIP, antler, arrow, eyes, fletching, leaves, lockupLayout, loop, ring, rule, segPoint, smile, type LogoPart, type Pt, type Seg, type SubPath } from '../brand/logoGeometry.ts';
import { DIANA_AIM, dianaPose } from './dianaFigure.ts';
import { hermesWings } from './hermesWings.ts';
import { add, lerp, mul, toD } from './shapeKit.ts';
import { REDUCED_TIMELINE, SPLASH_TIMELINE } from './splashTimeline.ts';

export type SplashVariant = 'A' | 'B' | 'C';
export const SPLASH_VARIANTS: Array<{ id: SplashVariant; label: string; description: string }> = [
  { id: 'A', label: 'Gold line', description: 'Diana and the Hermes wings as fine gold line drawings.' },
  { id: 'B', label: 'Green silhouette', description: 'Diana and the wings as translucent green silhouettes with a soft cast shadow.' },
  { id: 'C', label: 'Minimal', description: 'Only the arrow and the wings that become the leaves; Diana is a faint shadow at the edge.' },
];
export const DEFAULT_SPLASH_VARIANT: SplashVariant = 'A';

export type SplashLayerId =
  | 'background' | 'diana' | 'hermes' | 'trail' | 'arrow' | 'fletching' | 'impact'
  | 'leaves' | 'loop' | 'ring' | 'antler' | 'eyes' | 'smile' | 'shimmer'
  | 'wordmark' | 'product' | 'rule' | 'claim';
export const SPLASH_LAYERS: SplashLayerId[] = ['background', 'diana', 'hermes', 'trail', 'arrow', 'fletching', 'impact', 'leaves', 'loop', 'ring', 'antler', 'eyes', 'smile', 'shimmer', 'wordmark', 'product', 'rule', 'claim'];

export type SplashOptions = {
  /** Canvas size in CSS pixels (the context may be pre-scaled for DPR). */
  width: number;
  height: number;
  variant?: SplashVariant;
  wordmark?: WordmarkMode;
  layers?: Partial<Record<SplashLayerId, boolean>>;
  /** prefers-reduced-motion: a short static logo fade, no flight. */
  reducedMotion?: boolean;
  /** Clear the canvas first (default true). */
  clear?: boolean;
  /** Background: 'light' = cream (reference artwork), 'dark' = near-black like a boot logo. Default light. */
  background?: 'light' | 'dark';
};

/** Colours of the frame being drawn (set per renderSplashFrame call). */
let C: BrandPalette = BRAND_PALETTES.light;

export { SPLASH_TIMELINE, REDUCED_TIMELINE } from './splashTimeline.ts';

export const splashDuration = (opts: Pick<SplashOptions, 'reducedMotion'> = {}): number => (opts.reducedMotion ? REDUCED_TIMELINE.end : SPLASH_TIMELINE.end);

// ------------------------------------------------------------------ easing

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const prog = (t: number, range: readonly [number, number]) => clamp01((t - range[0]) / (range[1] - range[0]));
const easeOutCubic = (x: number) => 1 - (1 - x) ** 3;
const easeOutQuart = (x: number) => 1 - (1 - x) ** 4;
const easeInOutCubic = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
const easeInOutSine = (x: number) => -(Math.cos(Math.PI * x) - 1) / 2;

const mixHex = (a: string, b: string, t: number): string => {
  const pa = parseInt(a.slice(1), 16), pb = parseInt(b.slice(1), 16);
  const ch = (shift: number) => Math.round(lerp((pa >> shift) & 255, (pb >> shift) & 255, clamp01(t)));
  return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`;
};

// ------------------------------------------------------------------ composition

type Ctx = CanvasRenderingContext2D;

type Frame = {
  scale: number;
  /** logo-unit point shown at the canvas centre */
  focusY: number;
};

const frameFor = (opts: SplashOptions, mode: WordmarkMode): Frame => {
  const lock = lockupLayout(mode);
  const h = lock.bounds.y1 - lock.bounds.y0;
  const w = lock.bounds.x1 - lock.bounds.x0;
  const scale = Math.min((opts.height * 0.62) / h, (opts.width * 0.7) / w);
  return { scale, focusY: (lock.bounds.y0 + lock.bounds.y1) / 2 };
};

/** Diana placement in logo units (feet position + scale), per variant. */
const DIANA_PLACE: Record<SplashVariant, { x: number; y: number; s: number }> = {
  A: { x: -720, y: 1118, s: 1.12 },
  B: { x: -720, y: 1118, s: 1.12 },
  C: { x: -1470, y: 1190, s: 1.36 },
};

const dianaToWorld = (variant: SplashVariant, p: Pt): Pt => {
  const pl = DIANA_PLACE[variant];
  return [pl.x + p[0] * pl.s, pl.y + p[1] * pl.s];
};

// Arrow-local frame: the logo arrow with ARROW_CENTER at the origin, pointing up.
const ARROW_TAIL = 111.5;

type ArrowState = { pos: Pt; angle: number; landed: boolean; flightU: number };

const angleOf = (v: Pt) => Math.atan2(v[0], -v[1]);

/** Draw amount of Diana's bow over time. */
const drawAmount = (t: number): number => {
  const T = SPLASH_TIMELINE.diana;
  if (t >= T.release) return 0;
  return lerp(0.55, 1, easeInOutSine(prog(t, T.draw)));
};

const flightPath = (variant: SplashVariant): Seg => {
  const nock = dianaToWorld(variant, dianaPose(1).nock);
  const start = add(nock, mul(DIANA_AIM, ARROW_TAIL));
  const end: Pt = [ARROW_CENTER[0], ARROW_CENTER[1]];
  if (variant === 'C') {
    // Off-screen start at the lower left, same aim.
    return [start, add(start, mul(DIANA_AIM, 620)), [end[0], end[1] + 170], end];
  }
  return [start, add(start, mul(DIANA_AIM, 360)), [end[0], end[1] + 92], end];
};

const segTangent = (s: Seg, t: number): Pt => {
  const a = segPoint(s, Math.max(0, t - 0.002));
  const b = segPoint(s, Math.min(1, t + 0.002));
  return [b[0] - a[0], b[1] - a[1]];
};

const arrowState = (t: number, variant: SplashVariant): ArrowState => {
  const T = SPLASH_TIMELINE;
  if (t < T.flight[0]) {
    const nock = dianaToWorld(variant, dianaPose(drawAmount(t)).nock);
    return { pos: add(nock, mul(DIANA_AIM, ARROW_TAIL)), angle: angleOf(DIANA_AIM), landed: false, flightU: 0 };
  }
  const u = easeOutCubic(prog(t, T.flight));
  const path = flightPath(variant);
  if (u >= 1) {
    // Soft recoil after the impact ("thock").
    const k = prog(t, [T.flight[1], T.flight[1] + 0.16]);
    const recoil = k > 0 && k < 1 ? -3.2 * Math.sin(Math.PI * k) * (1 - k) : 0;
    return { pos: [ARROW_CENTER[0], ARROW_CENTER[1] + recoil], angle: 0, landed: true, flightU: 1 };
  }
  return { pos: segPoint(path, u), angle: angleOf(segTangent(path, u)), landed: false, flightU: u };
};

const withArrowFrame = (ctx: Ctx, st: ArrowState, fn: () => void) => {
  ctx.save();
  ctx.translate(st.pos[0], st.pos[1]);
  ctx.rotate(st.angle);
  ctx.translate(-ARROW_CENTER[0], -ARROW_CENTER[1]);
  fn();
  ctx.restore();
};

// ------------------------------------------------------------------ static part caches

let cache: null | {
  antler: LogoPart[]; ring: LogoPart[]; eyes: LogoPart[]; smile: LogoPart[]; arrow: LogoPart[];
  leaves: LogoPart[]; loop: LogoPart[]; fletching: LogoPart[];
} = null;
const parts = () => (cache ??= { antler: antler(), ring: ring(), eyes: eyes(), smile: smile(), arrow: arrow(), leaves: leaves(), loop: loop(), fletching: fletching() });

const subPathCenter = (sp: SubPath): Pt => {
  let x = 0, y = 0, n = 0;
  for (const s of sp.segs) { x += s[0][0]; y += s[0][1]; n += 1; }
  return [x / n, y / n];
};

// ------------------------------------------------------------------ layers

type LayerCtx = { ctx: Ctx; t: number; variant: SplashVariant; on: (id: SplashLayerId) => boolean; mode: WordmarkMode; unitPx: number };

/** Diana as line drawing (A), silhouette (B) or edge shadow (C). Fades by blending into the cream, so the outline knockout stays clean. */
function drawDiana(L: LayerCtx): void {
  const { ctx, t, variant } = L;
  const T = SPLASH_TIMELINE.diana;
  const vis = easeOutCubic(prog(t, T.in)) * (1 - easeInOutCubic(prog(t, T.out)));
  if (vis <= 0.002) return;
  const released = t >= T.release;
  const since = t - T.release;
  const wobble = released ? 9 * Math.exp(-since * 14) * Math.sin(since * 70) : 0;
  const follow = released ? easeOutCubic(clamp01(since / 0.2)) : 0;
  const pose = dianaPose(drawAmount(t), wobble, follow);
  const pl = DIANA_PLACE[variant];
  const cream = C.cream;

  ctx.save();
  ctx.translate(pl.x, pl.y);
  ctx.scale(pl.s, pl.s);
  const px = 1 / (L.unitPx * pl.s); // one device pixel in design units
  const masses = path2d(toD(pose.masses), false);

  if (variant === 'A') {
    const gold = mixHex(cream, C.gold, 0.78 * vis);
    const w = Math.max(1.6 * px, 2.6);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.strokeStyle = gold;
    ctx.lineWidth = w * 2;
    ctx.stroke(masses);
    ctx.fillStyle = cream;
    ctx.fill(masses);
    ctx.lineWidth = w * 0.8;
    ctx.stroke(path2d(toD(pose.details), false));
    ctx.fillStyle = gold;
    ctx.fill(path2d(toD(pose.accents), false));
    ctx.lineWidth = w * 1.2;
    ctx.stroke(path2d(toD([pose.bow]), false));
    ctx.lineWidth = Math.max(1.1 * px, w * 0.55);
    ctx.stroke(path2d(toD([pose.string]), false));
  } else if (variant === 'B') {
    const green = mixHex(cream, C.green, 0.26 * vis);
    ctx.save();
    ctx.shadowColor = `rgba(31, 59, 45, ${0.16 * vis})`;
    ctx.shadowBlur = 26 * L.unitPx * pl.s;
    ctx.shadowOffsetX = 14 * L.unitPx * pl.s;
    ctx.shadowOffsetY = 8 * L.unitPx * pl.s;
    ctx.fillStyle = green;
    ctx.fill(masses);
    ctx.restore();
    ctx.strokeStyle = green;
    ctx.lineCap = 'round';
    ctx.lineWidth = 7;
    ctx.stroke(path2d(toD([pose.bow]), false));
    ctx.lineWidth = Math.max(1.1 * px, 1.6);
    ctx.stroke(path2d(toD([pose.string]), false));
    ctx.fillStyle = mixHex(cream, C.gold, 0.5 * vis);
    ctx.fill(path2d(toD(pose.accents), false));
  } else {
    // C: a faint, soft shadow of the huntress at the left edge.
    ctx.save();
    ctx.filter = `blur(${Math.max(2, 9 * L.unitPx * pl.s).toFixed(1)}px)`;
    ctx.fillStyle = mixHex(cream, C.green, 0.13 * vis);
    ctx.fill(masses);
    ctx.strokeStyle = ctx.fillStyle;
    ctx.lineWidth = 7;
    ctx.stroke(path2d(toD([pose.bow]), false));
    ctx.restore();
  }
  ctx.restore();
}

function drawTrail(L: LayerCtx, st: ArrowState): void {
  const { ctx, t, variant } = L;
  const T = SPLASH_TIMELINE;
  if (t < T.flight[0] || t > T.trail[1]) return;
  const fade = 1 - prog(t, [T.flight[1], T.trail[1]]);
  const path = flightPath(variant);
  const u1 = st.flightU;
  const u0 = Math.max(0, u1 - 0.42);
  if (u1 - u0 < 0.01) return;
  ctx.save();
  ctx.lineCap = 'round';
  const steps = 24;
  for (let i = 0; i < steps; i += 1) {
    const a = lerp(u0, u1, i / steps), b = lerp(u0, u1, (i + 1) / steps);
    const pa = segPoint(path, a), pb = segPoint(path, b);
    // stop at the arrow's tail
    const tail = add(st.pos, mul([Math.sin(st.angle), -Math.cos(st.angle)], -ARROW_TAIL));
    const pbx = i === steps - 1 ? tail : pb;
    ctx.globalAlpha = (i / steps) * 0.55 * fade * (variant === 'B' ? 0.6 : 1);
    ctx.strokeStyle = variant === 'B' ? C.green : C.gold;
    ctx.lineWidth = lerp(0.6, 2.2, i / steps);
    ctx.beginPath();
    ctx.moveTo(pa[0], pa[1]);
    ctx.lineTo(pbx[0], pbx[1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawWingsAndLeaves(L: LayerCtx, st: ArrowState): void {
  const { ctx, t, variant } = L;
  const T = SPLASH_TIMELINE;
  const hermesOn = L.on('hermes');
  const leavesOn = L.on('leaves');
  if (!hermesOn) {
    // Leaves without Hermes: grow out of the shaft after the impact.
    if (!leavesOn) return;
    const k = easeOutCubic(prog(t, [T.flight[1], T.flight[1] + 0.34]));
    if (k <= 0) return;
    ctx.save();
    ctx.translate(ARROW_CENTER[0], 0);
    ctx.scale(k, 1);
    ctx.translate(-ARROW_CENTER[0], 0);
    drawPart(ctx, parts().leaves[0], { alpha: k });
    ctx.restore();
    return;
  }
  const unfurl = easeOutQuart(prog(t, T.hermes.unfurl));
  if (unfurl <= 0) return;
  const morph = easeInOutCubic(prog(t, T.hermes.morph));
  if (morph >= 1 && !leavesOn) return;
  const flapAmp = 0.2 * (1 - morph);
  const flapT = t - T.hermes.unfurl[0];
  const flap = flapAmp * Math.sin(flapT * Math.PI * 2 * 3.1) + 0.06 * (1 - morph);
  const wings = hermesWings(flap, lerp(0.15, 1, unfurl), morph);
  const d = toD(wings);
  const p = path2d(d, false);
  withArrowFrame(ctx, st, () => {
    const green = C.green;
    if (variant === 'B') {
      ctx.save();
      ctx.globalAlpha *= lerp(0.55, 1, morph) * unfurl;
      ctx.fillStyle = green;
      ctx.fill(p);
      ctx.restore();
      return;
    }
    // Gold line wing -> filled green leaf.
    ctx.save();
    ctx.globalAlpha *= unfurl;
    ctx.fillStyle = mixHex(C.cream, green, lerp(0.08, 1, morph));
    if (morph > 0 || variant !== 'A') ctx.fill(p);
    ctx.restore();
    const lineAlpha = (1 - morph) * unfurl;
    if (lineAlpha > 0.01) {
      ctx.save();
      ctx.globalAlpha *= lineAlpha;
      ctx.strokeStyle = C.gold;
      ctx.lineWidth = 2.4;
      ctx.lineJoin = 'round';
      ctx.stroke(p);
      ctx.restore();
    }
  });
}

function drawArrow(L: LayerCtx, st: ArrowState): void {
  const { ctx, t } = L;
  const T = SPLASH_TIMELINE;
  // The arrow appears with Diana, on her bow.
  const vis = easeOutCubic(prog(t, T.diana.in));
  if (vis <= 0.002) return;
  withArrowFrame(ctx, st, () => {
    if (L.on('arrow')) for (const part of parts().arrow) drawPart(ctx, part, { alpha: vis });
    if (L.on('fletching')) drawPart(ctx, parts().fletching[0], { alpha: vis });
  });
}

function drawImpact(L: LayerCtx): void {
  const { ctx, t } = L;
  const k = prog(t, SPLASH_TIMELINE.impact);
  if (k <= 0 || k >= 1) return;
  const e = easeOutCubic(k);
  ctx.save();
  ctx.globalAlpha = 0.45 * (1 - k) ** 1.5;
  ctx.strokeStyle = C.gold;
  ctx.lineWidth = lerp(3, 0.8, e);
  ctx.beginPath();
  ctx.arc(ARROW_TIP[0], ARROW_TIP[1], lerp(6, 46, e), 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}

function drawBuild(L: LayerCtx): void {
  const { ctx, t } = L;
  const T = SPLASH_TIMELINE;
  const P = parts();
  if (L.on('loop')) drawPart(ctx, P.loop[0], { progress: easeInOutCubic(prog(t, T.loop)) });
  if (L.on('ring')) drawPart(ctx, P.ring[0], { progress: easeInOutCubic(prog(t, T.ring)) });
  if (L.on('antler')) {
    drawPart(ctx, P.antler[0], { progress: easeInOutCubic(prog(t, T.antler.arc)) });
    drawPart(ctx, P.antler[1], { progress: easeOutCubic(prog(t, T.antler.outer)) });
    drawPart(ctx, P.antler[2], { progress: easeOutCubic(prog(t, T.antler.inner)) });
  }
  if (L.on('eyes')) {
    const k = prog(t, T.eyes);
    if (k > 0) {
      const part = P.eyes[0];
      const open = easeOutQuart(k);
      for (const sp of part.subpaths) {
        const c = subPathCenter(sp);
        ctx.save();
        ctx.translate(c[0], c[1]);
        ctx.scale(lerp(0.7, 1, open), lerp(0.08, 1, open));
        ctx.translate(-c[0], -c[1]);
        ctx.globalAlpha *= clamp01(k * 3);
        ctx.fillStyle = colorOf(part.color);
        ctx.fill(path2d(toD([sp])));
        ctx.restore();
      }
    }
  }
  if (L.on('smile')) {
    drawPart(ctx, P.smile[0], { progress: easeInOutCubic(prog(t, T.smile)) });
    if (L.on('shimmer')) drawShimmer(L);
  }
}

/** A light band sweeping along the finished smile. */
function drawShimmer(L: LayerCtx): void {
  const { ctx, t } = L;
  const k = prog(t, SPLASH_TIMELINE.shimmer);
  if (k <= 0 || k >= 1) return;
  const part = parts().smile[0];
  const x0 = -95, x1 = 95;
  const cx = lerp(x0 - 40, x1 + 40, easeInOutSine(k));
  const g = ctx.createLinearGradient(cx - 46, 0, cx + 46, 0);
  g.addColorStop(0, 'rgba(233, 201, 121, 0)');
  g.addColorStop(0.5, 'rgba(250, 230, 170, 0.85)');
  g.addColorStop(1, 'rgba(233, 201, 121, 0)');
  ctx.save();
  ctx.globalAlpha = Math.sin(Math.PI * k);
  drawPart(ctx, part, { color: g, widthScale: 0.6 });
  ctx.restore();
}

function drawType(L: LayerCtx): void {
  const { ctx, t, mode } = L;
  const T = SPLASH_TIMELINE;
  const lock = lockupLayout(mode);
  for (const line of lock.lines) {
    if (!L.on(line.id)) continue;
    const range = T[line.id];
    const k = prog(t, range);
    if (k <= 0) continue;
    const e = easeOutCubic(k);
    drawTextLine(ctx, line, { alpha: e, trackingScale: 1 + 0.22 * (1 - easeOutQuart(k)), dy: 8 * (1 - e) });
  }
  if (L.on('rule')) {
    const k = easeInOutCubic(prog(t, T.rule));
    for (const part of rule(mode)) drawPart(ctx, part, { progress: k });
  }
}

// ------------------------------------------------------------------ entry

export type SplashFrameInfo = { done: boolean; duration: number; contentAlpha: number };

/**
 * Renders one frame at time `t` (seconds since the start of the animation).
 * The caller owns DPR scaling: set the context transform to device scale and
 * pass the CSS size in opts.width/height.
 */
export function renderSplashFrame(ctx: Ctx, t: number, opts: SplashOptions): SplashFrameInfo {
  C = BRAND_PALETTES[opts.background === 'dark' ? 'dark' : 'light'];
  setLogoPalette(C);
  try {
    return renderSplashFrameWith(ctx, t, opts);
  } finally {
    setLogoPalette(null);
  }
}

function renderSplashFrameWith(ctx: Ctx, t: number, opts: SplashOptions): SplashFrameInfo {
  const variant = opts.variant ?? DEFAULT_SPLASH_VARIANT;
  const mode = opts.wordmark ?? DEFAULT_WORDMARK;
  const on = (id: SplashLayerId) => opts.layers?.[id] !== false;
  const duration = splashDuration(opts);
  const frame = frameFor(opts, mode);

  if (opts.clear !== false) ctx.clearRect(0, 0, opts.width, opts.height);

  // Hand-off into the app: background and content fade, content grows slightly.
  const handoff = opts.reducedMotion ? prog(t, REDUCED_TIMELINE.handoff) : easeInOutCubic(prog(t, SPLASH_TIMELINE.handoff));
  const alpha = 1 - handoff;
  if (alpha <= 0.001) return { done: t >= duration, duration, contentAlpha: 0 };

  ctx.save();
  if (on('background')) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = C.cream;
    ctx.fillRect(0, 0, opts.width, opts.height);
  }
  ctx.globalAlpha = alpha;
  ctx.translate(opts.width / 2, opts.height / 2);
  const grow = 1 + 0.045 * handoff;
  ctx.scale(frame.scale * grow, frame.scale * grow);
  ctx.translate(0, -frame.focusY);

  if (opts.reducedMotion) {
    const fade = easeOutCubic(prog(t, REDUCED_TIMELINE.fadeIn));
    ctx.globalAlpha = alpha * fade;
    staticLogo(ctx, mode, on);
    ctx.restore();
    return { done: t >= duration, duration, contentAlpha: alpha * fade };
  }

  const L: LayerCtx = { ctx, t, variant, on, mode, unitPx: frame.scale };
  const st = arrowState(t, variant);
  if (on('diana')) drawDiana(L);
  if (on('trail')) drawTrail(L, st);
  drawBuild(L);
  drawWingsAndLeaves(L, st);
  drawArrow(L, st);
  if (on('impact')) drawImpact(L);
  drawType(L);
  ctx.restore();
  return { done: t >= duration, duration, contentAlpha: alpha };
}

/** The finished logo, no animation (reduced motion, icons, tests). */
export function staticLogo(ctx: Ctx, mode: WordmarkMode = DEFAULT_WORDMARK, on: (id: SplashLayerId) => boolean = () => true): void {
  const P = parts();
  const order: Array<[SplashLayerId, LogoPart[]]> = [['antler', P.antler], ['ring', P.ring], ['eyes', P.eyes], ['smile', P.smile], ['leaves', P.leaves], ['loop', P.loop], ['arrow', P.arrow], ['fletching', P.fletching]];
  for (const [id, list] of order) if (on(id)) for (const part of list) drawPart(ctx, part);
  const lock = lockupLayout(mode);
  for (const line of lock.lines) if (on(line.id)) drawTextLine(ctx, line);
  if (on('rule')) for (const part of rule(mode)) drawPart(ctx, part);
}
