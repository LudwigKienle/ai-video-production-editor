#!/usr/bin/env node
/**
 * Writes the logo SVGs from the vector geometry (src/brand/logoGeometry.ts):
 *   src/brand/logoMark.svg      mark only, square viewBox
 *   src/brand/logoLockup.svg    mark + wordmark (default mode) + rule + claim
 * and previews of every wordmark mode into build/brand-preview/ (SVG + PNG).
 *
 *   node scripts/brand/build-svgs.mjs
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_DIR, ROOT, canvasLib, ensureDir, loadTs } from './brand-lib.mjs';

const G = await loadTs('src/brand/logoGeometry.ts');
const T = await loadTs('src/brand/brandTokens.ts');
const D = await loadTs('src/brand/drawLogo.ts');

writeFileSync(join(ROOT, 'src/brand/logoMark.svg'), G.logoMarkSvg());
writeFileSync(join(ROOT, 'src/brand/logoLockup.svg'), G.logoLockupSvg(T.DEFAULT_WORDMARK));
console.log('wrote src/brand/logoMark.svg, src/brand/logoLockup.svg');

ensureDir(PREVIEW_DIR);
const fileFor = { buckswood: 'lockup-brand', 'buckswood+product': 'lockup-brand-product', product: 'lockup-product' };
for (const mode of T.WORDMARK_MODES) {
  const name = fileFor[mode];
  writeFileSync(join(PREVIEW_DIR, `${name}.svg`), G.logoLockupSvg(mode, { background: true }));
  const lock = G.lockupLayout(mode);
  const pad = 90;
  const w = lock.bounds.x1 - lock.bounds.x0 + pad * 2, h = lock.bounds.y1 - lock.bounds.y0 + pad * 2;
  const scale = 1600 / w;
  const canvas = canvasLib.createCanvas(Math.round(w * scale), Math.round(h * scale));
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = T.BRAND_COLORS.cream;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.scale(scale, scale);
  ctx.translate(-lock.bounds.x0 + pad, -lock.bounds.y0 + pad);
  D.drawLockup(ctx, mode);
  writeFileSync(join(PREVIEW_DIR, `${name}.png`), canvas.toBuffer('image/png'));
  console.log(`wrote build/brand-preview/${name}.svg/.png`);
}
