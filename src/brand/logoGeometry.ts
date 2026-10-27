/**
 * Vector geometry of the logo, rebuilt from the reference artwork with own
 * paths and strokes (no traced bitmap, no embedded image).
 *
 * Everything is expressed as cubic Bézier segments in logo units (reference
 * artboard pixels, origin = ring centre). The same data feeds the SVG files,
 * the canvas splash (Path2D from the `d` strings, dash-based draw-on via the
 * measured lengths) and the icon renderer.
 *
 * Each logo element is its own export so the animation can drive it alone:
 * antler, ring, eyes, smile, arrow, leaves, loop, fletching, wordmark, rule, claim
 * (+ product, the optional product line under the wordmark).
 */
import { ARTBOARD, BRAND_COLORS, BRAND_MEASURES as M, BRAND_NAME, CLAIM, DEFAULT_WORDMARK, PRODUCT_NAME, type BrandColor, type WordmarkMode } from './brandTokens.ts';
import { BRAND_GLYPHS, type BrandGlyphSet } from './brandGlyphs.generated.ts';

// ------------------------------------------------------------------ primitives

export type Pt = [number, number];
/** One cubic segment: start, control 1, control 2, end. */
export type Seg = [Pt, Pt, Pt, Pt];
export type SubPath = { segs: Seg[]; closed: boolean };

export type LogoPart = {
  id: string;
  mode: 'stroke' | 'fill';
  color: BrandColor;
  width?: number;
  cap?: 'round' | 'butt';
  subpaths: SubPath[];
};

/** Reference artboard px -> logo units (origin at the ring centre). */
const P = (x: number, y: number): Pt => [x - ARTBOARD.originX, y - ARTBOARD.originY];
const mirror = (p: Pt): Pt => [-p[0], p[1]];
const mirrorSeg = (s: Seg): Seg => [mirror(s[0]), mirror(s[1]), mirror(s[2]), mirror(s[3])];
const lerpPt = (a: Pt, b: Pt, t: number): Pt => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];

export const line = (a: Pt, b: Pt): Seg => [a, lerpPt(a, b, 1 / 3), lerpPt(a, b, 2 / 3), b];
export const quad = (a: Pt, q: Pt, b: Pt): Seg => [a, lerpPt(a, q, 2 / 3), lerpPt(b, q, 2 / 3), b];
export const cubic = (a: Pt, c1: Pt, c2: Pt, b: Pt): Seg => [a, c1, c2, b];

const open = (...segs: Seg[]): SubPath => ({ segs, closed: false });
const closed = (...segs: Seg[]): SubPath => ({ segs, closed: true });

/** Point on a cubic segment. */
export const segPoint = (s: Seg, t: number): Pt => {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [a * s[0][0] + b * s[1][0] + c * s[2][0] + d * s[3][0], a * s[0][1] + b * s[1][1] + c * s[2][1] + d * s[3][1]];
};

/** Split a cubic at t (de Casteljau). */
export const splitSeg = (s: Seg, t: number): [Seg, Seg] => {
  const p01 = lerpPt(s[0], s[1], t), p12 = lerpPt(s[1], s[2], t), p23 = lerpPt(s[2], s[3], t);
  const p012 = lerpPt(p01, p12, t), p123 = lerpPt(p12, p23, t);
  const m = lerpPt(p012, p123, t);
  return [[s[0], p01, p012, m], [m, p123, p23, s[3]]];
};

export const segLength = (s: Seg, steps = 24): number => {
  let len = 0;
  let prev = s[0];
  for (let i = 1; i <= steps; i += 1) {
    const p = segPoint(s, i / steps);
    len += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
  }
  return len;
};

export const subPathLength = (sp: SubPath): number => sp.segs.reduce((sum, s) => sum + segLength(s), 0);

const f = (n: number) => String(Math.round(n * 100) / 100);

export const subPathToD = (sp: SubPath): string => {
  if (!sp.segs.length) return '';
  const [x0, y0] = sp.segs[0][0];
  let d = `M${f(x0)} ${f(y0)}`;
  for (const s of sp.segs) d += `C${f(s[1][0])} ${f(s[1][1])} ${f(s[2][0])} ${f(s[2][1])} ${f(s[3][0])} ${f(s[3][1])}`;
  return sp.closed ? `${d}Z` : d;
};

export const partToD = (part: LogoPart): string => part.subpaths.map(subPathToD).join('');

/** Circle as four cubics, starting at angle `start` (radians, 0 = +x, y down), clockwise. */
export const circleSegs = (cx: number, cy: number, r: number, start = Math.PI / 2, dir: 1 | -1 = 1): Seg[] => {
  const k = (4 / 3) * Math.tan(Math.PI / 8);
  const segs: Seg[] = [];
  for (let i = 0; i < 4; i += 1) {
    const a0 = start + dir * i * (Math.PI / 2);
    const a1 = a0 + dir * (Math.PI / 2);
    const p0: Pt = [cx + r * Math.cos(a0), cy + r * Math.sin(a0)];
    const p3: Pt = [cx + r * Math.cos(a1), cy + r * Math.sin(a1)];
    const t0: Pt = [-Math.sin(a0) * dir, Math.cos(a0) * dir];
    const t1: Pt = [-Math.sin(a1) * dir, Math.cos(a1) * dir];
    segs.push([p0, [p0[0] + t0[0] * k * r, p0[1] + t0[1] * k * r], [p3[0] - t1[0] * k * r, p3[1] - t1[1] * k * r], p3]);
  }
  return segs;
};

/** Ellipse centred at c, radii rx/ry, rotated by `deg` (clockwise, y down). */
export const ellipseSegs = (c: Pt, rx: number, ry: number, deg: number): Seg[] => {
  const rad = (deg * Math.PI) / 180;
  const cos = Math.cos(rad), sin = Math.sin(rad);
  const tf = (p: Pt): Pt => [c[0] + p[0] * rx * cos - p[1] * ry * sin, c[1] + p[0] * rx * sin + p[1] * ry * cos];
  return circleSegs(0, 0, 1, -Math.PI / 2).map((s) => s.map(tf) as Seg);
};

// ------------------------------------------------------------------ mark elements

/** Antler: one arc with two tines left and right, round stroke ends. */
export function antler(): LogoPart[] {
  const arcL = cubic(P(650, 510), P(705, 580), P(745, 612), P(800, 612));
  const arcR: Seg = [arcL[3], mirror(arcL[2]), mirror(arcL[1]), mirror(arcL[0])];
  const outerL = line(P(678, 506), P(716, 578));
  const innerL = line(P(739, 547), P(754, 601));
  return [
    // Arc drawn from the centre outwards (left half reversed) so a draw-on grows symmetric.
    { id: 'antler.arc', mode: 'stroke', color: 'green', width: M.antlerStroke, cap: 'round', subpaths: [open(reverseSeg(arcL)), open(arcR)] },
    { id: 'antler.tines.outer', mode: 'stroke', color: 'green', width: M.antlerTineOuterStroke, cap: 'round', subpaths: [open(reverseSeg(outerL)), open(mirrorSeg(reverseSeg(outerL)))] },
    { id: 'antler.tines.inner', mode: 'stroke', color: 'green', width: M.antlerTineInnerStroke, cap: 'round', subpaths: [open(reverseSeg(innerL)), open(mirrorSeg(reverseSeg(innerL)))] },
  ];
}

export const reverseSeg = (s: Seg): Seg => [s[3], s[2], s[1], s[0]];

/** Smiley ring. Two halves from the bottom (where the arrow tip touches) up to the top. */
export function ring(): LogoPart[] {
  const r = M.ringRadius;
  const right = circleSegs(0, 0, r, Math.PI / 2, -1).slice(0, 2); // bottom -> right -> top
  const left = circleSegs(0, 0, r, Math.PI / 2, 1).slice(0, 2); // bottom -> left -> top
  return [{ id: 'ring', mode: 'stroke', color: 'green', width: M.ringStroke, cap: 'butt', subpaths: [open(...left), open(...right)] }];
}

/** Two oval eyes, slightly slanted (tops lean towards the outside). */
export function eyes(): LogoPart[] {
  return [{
    id: 'eyes', mode: 'fill', color: 'green',
    subpaths: [closed(...ellipseSegs(P(746, 774), 13.5, 21, -18)), closed(...ellipseSegs(P(854, 774), 13.5, 21, 18))],
  }];
}

/** Golden smile, round ends. Parabola, drawn left to right. */
export function smile(): LogoPart[] {
  return [{ id: 'smile', mode: 'stroke', color: 'gold', width: M.smileStroke, cap: 'round', subpaths: [open(quad(P(715, 853.7), P(800, 938.3), P(885, 853.7)))] }];
}

/** Arrow head (fill) and shaft (stroke). The tip touches the ring from below. */
export function arrow(): LogoPart[] {
  return [
    { id: 'arrow.head', mode: 'fill', color: 'gold', subpaths: [closed(line(P(800, 979), P(822.5, 1022.5)), line(P(822.5, 1022.5), P(777.5, 1022.5)), line(P(777.5, 1022.5), P(800, 979)))] },
    { id: 'arrow.shaft', mode: 'stroke', color: 'gold', width: M.shaftStroke, cap: 'round', subpaths: [open(line(P(800, 1018), P(800, 1194)))] },
  ];
}

/** Golden fletching: two chevrons at the end of the shaft. */
export function fletching(): LogoPart[] {
  const chevron = (apexY: number, endY: number): SubPath => open(line(P(776, endY), P(800, apexY)), line(P(800, apexY), P(824, endY)));
  return [{ id: 'fletching', mode: 'stroke', color: 'gold', width: M.fletchStroke, cap: 'round', subpaths: [chevron(1161, 1185), chevron(1176, 1199.5)] }];
}

/** Left leaf/wing as 6 cubic segments (the last edge split in two, so it morphs 1:1 with the Hermes wing). */
export function leafSegs(): Seg[] {
  const A = P(670, 1009), B = P(789, 1043), B2 = P(789, 1057), C = P(681, 1065), N = P(724, 1035);
  const last = cubic(N, P(712, 1028), P(690, 1017), A);
  const [l1, l2] = splitSeg(last, 0.5);
  return [
    cubic(A, P(705, 1000), P(755, 1012), B), // upper edge, tip -> root
    line(B, B2), // root (next to the shaft)
    cubic(B2, P(755, 1060), P(715, 1063), C), // lower edge, root -> lower tip
    cubic(C, P(690, 1052), P(708, 1041), N), // lower tip -> notch
    l1, l2, // notch -> upper tip
  ];
}

/** Dark green leaf/wing shapes left and right of the arrow. */
export function leaves(): LogoPart[] {
  const left = leafSegs();
  return [{ id: 'leaves', mode: 'fill', color: 'green', subpaths: [closed(...left), closed(...left.map(mirrorSeg))] }];
}

/** Figure-eight loop around the shaft: two lens shapes, stroked. */
export function loop(): LogoPart[] {
  const lens = (top: number, bottom: number): SubPath => {
    const mid = (top + bottom) / 2;
    const w = 32;
    const h = bottom - top;
    return closed(
      cubic(P(800, top), P(800 + w * 0.5, top + h * 0.1), P(800 + w, mid - h * 0.32), P(800 + w, mid)),
      cubic(P(800 + w, mid), P(800 + w, mid + h * 0.32), P(800 + w * 0.5, bottom - h * 0.1), P(800, bottom)),
      cubic(P(800, bottom), P(800 - w * 0.5, bottom - h * 0.1), P(800 - w, mid + h * 0.32), P(800 - w, mid)),
      cubic(P(800 - w, mid), P(800 - w, mid - h * 0.32), P(800 - w * 0.5, top + h * 0.1), P(800, top)),
    );
  };
  return [{ id: 'loop', mode: 'stroke', color: 'green', width: M.loopStroke, cap: 'round', subpaths: [lens(1068.5, 1110), lens(1110, 1151)] }];
}

/** Arrow pivot in logo units (centre of the logo arrow, used for flight transforms). */
export const ARROW_CENTER: Pt = P(800, 1088);
export const ARROW_TIP: Pt = P(800, 979);

export type MarkElementId = 'antler' | 'ring' | 'eyes' | 'smile' | 'arrow' | 'leaves' | 'loop' | 'fletching';
export const MARK_ELEMENTS: Record<MarkElementId, () => LogoPart[]> = { antler, ring, eyes, smile, arrow, leaves, loop, fletching };
/** Paint order of the mark (back to front). */
export const MARK_ORDER: MarkElementId[] = ['antler', 'ring', 'eyes', 'smile', 'leaves', 'loop', 'arrow', 'fletching'];

/** Mark bounds in logo units. */
export const MARK_BOUNDS = { x0: -169.5, y0: -320, x1: 169.5, y1: 387.5 } as const;

// ------------------------------------------------------------------ type

export type TextLineId = 'wordmark' | 'product' | 'claim';
export type LaidGlyph = { ch: string; d: string; x: number; scale: number };
export type TextLine = {
  id: TextLineId;
  color: BrandColor;
  font: 'serif' | 'sans';
  text: string;
  cap: number;
  baseline: number;
  /** Letter spacing in logo units (added after every character but the last). */
  tracking: number;
  scale: number;
  glyphs: Array<{ ch: string; d: string; adv: number }>;
};

const glyphSet = (font: 'serif' | 'sans'): BrandGlyphSet => BRAND_GLYPHS[font];

const makeLine = (id: TextLineId, font: 'serif' | 'sans', text: string, cap: number, baseline: number, color: BrandColor, spacing: { width?: number; trackingEm?: number }): TextLine => {
  const set = glyphSet(font);
  const scale = cap / set.capHeight;
  const glyphs = [...text].map((ch) => (ch === ' ' ? { ch, d: '', adv: set.space } : { ch, d: set.glyphs[ch]?.d ?? '', adv: set.glyphs[ch]?.adv ?? set.space }));
  const natural = glyphs.reduce((sum, g) => sum + g.adv * scale, 0);
  const gaps = Math.max(1, glyphs.length - 1);
  const tracking = spacing.width !== undefined ? (spacing.width - natural) / gaps : (spacing.trackingEm ?? 0) * cap / 0.7;
  return { id, color, font, text, cap, baseline, tracking, scale, glyphs };
};

/** Glyph positions of a line, centred on x = 0. `trackingScale` > 1 spreads the letters (tracking settle). */
export function layoutTextLine(lineDef: TextLine, trackingScale = 1): LaidGlyph[] {
  const tracking = lineDef.tracking * trackingScale;
  const total = lineDef.glyphs.reduce((sum, g) => sum + g.adv * lineDef.scale, 0) + tracking * (lineDef.glyphs.length - 1);
  let x = -total / 2;
  const laid: LaidGlyph[] = [];
  for (const g of lineDef.glyphs) {
    if (g.d) laid.push({ ch: g.ch, d: g.d, x, scale: lineDef.scale });
    x += g.adv * lineDef.scale + tracking;
  }
  return laid;
}

export type Lockup = { mode: WordmarkMode; lines: TextLine[]; rule: { y: number; width: number; stroke: number }; bounds: { x0: number; y0: number; x1: number; y1: number } };

/** Text lines and rule for a wordmark mode (reference positions for 'buckswood'). */
export function lockupLayout(mode: WordmarkMode = DEFAULT_WORDMARK): Lockup {
  const wordBase = 1432 - ARTBOARD.originY; // 615
  const lines: TextLine[] = [];
  let ruleY = 1501.5 - ARTBOARD.originY; // 684.5
  if (mode === 'product') {
    lines.push(makeLine('wordmark', 'serif', PRODUCT_NAME, M.productOnlyCap, wordBase, 'green', { width: M.wordmarkWidth }));
  } else {
    lines.push(makeLine('wordmark', 'serif', BRAND_NAME, M.wordmarkCap, wordBase, 'green', { width: M.wordmarkWidth }));
  }
  if (mode === 'buckswood+product') {
    const productBase = wordBase + 64;
    lines.push(makeLine('product', 'sans', PRODUCT_NAME, M.productCap, productBase, 'green', { width: 780 }));
    ruleY = productBase + 46;
  }
  const claimBase = ruleY + (1579 - 1501.5);
  lines.push(makeLine('claim', 'sans', CLAIM, M.claimCap, claimBase, 'goldDeep', { width: M.claimWidth }));
  return {
    mode,
    lines,
    rule: { y: ruleY, width: M.ruleWidth, stroke: M.ruleStroke },
    bounds: { x0: -M.wordmarkWidth / 2 - 10, y0: MARK_BOUNDS.y0, x1: M.wordmarkWidth / 2 + 10, y1: claimBase + 4 },
  };
}

export function wordmark(mode: WordmarkMode = DEFAULT_WORDMARK): TextLine { return lockupLayout(mode).lines.find((l) => l.id === 'wordmark')!; }
export function product(mode: WordmarkMode = DEFAULT_WORDMARK): TextLine | null { return lockupLayout(mode).lines.find((l) => l.id === 'product') ?? null; }
export function claim(mode: WordmarkMode = DEFAULT_WORDMARK): TextLine { return lockupLayout(mode).lines.find((l) => l.id === 'claim')!; }
/** Short golden rule between wordmark and claim. */
export function rule(mode: WordmarkMode = DEFAULT_WORDMARK): LogoPart[] {
  const r = lockupLayout(mode).rule;
  return [{ id: 'rule', mode: 'stroke', color: 'gold', width: r.stroke, cap: 'butt', subpaths: [open(line([0, r.y], [-r.width / 2, r.y])), open(line([0, r.y], [r.width / 2, r.y]))] }];
}

// ------------------------------------------------------------------ SVG

const svgPart = (part: LogoPart): string => {
  const d = partToD(part);
  const color = BRAND_COLORS[part.color];
  if (part.mode === 'fill') return `<path d="${d}" fill="${color}"/>`;
  return `<path d="${d}" fill="none" stroke="${color}" stroke-width="${part.width}" stroke-linecap="${part.cap ?? 'round'}" stroke-linejoin="round"/>`;
};

const svgTextLine = (lineDef: TextLine): string => {
  const glyphs = layoutTextLine(lineDef).map((g) => `<path transform="translate(${f(g.x)} ${f(lineDef.baseline)}) scale(${+g.scale.toFixed(5)})" d="${g.d}"/>`).join('');
  return `<g id="${lineDef.id}" fill="${BRAND_COLORS[lineDef.color]}">${glyphs}</g>`;
};

export function markGroupsSvg(): string {
  return MARK_ORDER.map((id) => `<g id="${id}">${MARK_ELEMENTS[id]().map(svgPart).join('')}</g>`).join('\n  ');
}

/** Standalone SVG of the mark only. Square viewBox, mark centred. */
export function logoMarkSvg(options: { background?: boolean; padding?: number } = {}): string {
  const pad = options.padding ?? 26;
  const h = MARK_BOUNDS.y1 - MARK_BOUNDS.y0 + pad * 2;
  const cy = (MARK_BOUNDS.y0 + MARK_BOUNDS.y1) / 2;
  const vb = `${f(-h / 2)} ${f(cy - h / 2)} ${f(h)} ${f(h)}`;
  const bg = options.background ? `<rect x="${f(-h / 2)}" y="${f(cy - h / 2)}" width="${f(h)}" height="${f(h)}" fill="${BRAND_COLORS.cream}"/>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Logo">\n  ${bg}${markGroupsSvg()}\n</svg>\n`;
}

/** Mark + wordmark (+ product line) + rule + claim. */
export function logoLockupSvg(mode: WordmarkMode = DEFAULT_WORDMARK, options: { background?: boolean; padding?: number } = {}): string {
  const lock = lockupLayout(mode);
  const pad = options.padding ?? 60;
  const x0 = lock.bounds.x0 - pad, y0 = lock.bounds.y0 - pad;
  const w = lock.bounds.x1 - lock.bounds.x0 + pad * 2, h = lock.bounds.y1 - lock.bounds.y0 + pad * 2;
  const bg = options.background ? `<rect x="${f(x0)}" y="${f(y0)}" width="${f(w)}" height="${f(h)}" fill="${BRAND_COLORS.cream}"/>` : '';
  const text = lock.lines.map(svgTextLine);
  const ruleSvg = `<g id="rule">${rule(mode).map(svgPart).join('')}</g>`;
  const wordmarkLines = text.filter((_, i) => lock.lines[i].id !== 'claim');
  const claimLine = text.find((_, i) => lock.lines[i].id === 'claim');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(w)} ${f(h)}" role="img" aria-label="Logo" data-wordmark="${mode}">\n  ${bg}${markGroupsSvg()}\n  ${wordmarkLines.join('\n  ')}\n  ${ruleSvg}\n  ${claimLine}\n</svg>\n`;
}
