#!/usr/bin/env node
/**
 * App icons from the logo mark (mark only, on cream, macOS icon grid):
 *   build/brand-preview/icon.png      1024 × 1024 master
 *   build/brand-preview/icon.icns     macOS (iconutil)
 *   build/brand-preview/icon.ico      Windows (16–256, PNG entries)
 *   build/brand-preview/favicon.svg   vector favicon
 *   build/brand-preview/favicon.ico   16/32/48
 *
 * Renders with @napi-rs/canvas, resizes with macOS `sips`, packs the .icns with
 * `iconutil`, writes the .ico container itself and checks it with ffmpeg
 * (ffmpeg-static, the app's ffmpegBinaryPath source, or ffmpeg in PATH).
 * Nothing is replaced in build/ or public/ yet; see the report for the swap list.
 *
 *   node scripts/brand/build-icons.mjs
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PREVIEW_DIR, canvasLib, ensureDir, ffmpegPath, loadTs } from './brand-lib.mjs';

const G = await loadTs('src/brand/logoGeometry.ts');
const T = await loadTs('src/brand/brandTokens.ts');
const D = await loadTs('src/brand/drawLogo.ts');
const { ICON_GRID: GRID, BRAND_COLORS: C } = T;

ensureDir(PREVIEW_DIR);
const work = mkdtempSync(join(tmpdir(), 'avpe-icons-'));

/** Superellipse ("continuous corner") body like the macOS app icon shape. */
const squirclePath = (cx, cy, size, n = 5) => {
  const a = size / 2;
  const pts = [];
  for (let i = 0; i < 360; i += 1) {
    const t = (i / 360) * Math.PI * 2;
    const c = Math.cos(t), s = Math.sin(t);
    pts.push([cx + a * Math.sign(c) * Math.abs(c) ** (2 / n), cy + a * Math.sign(s) * Math.abs(s) ** (2 / n)]);
  }
  return `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join('L')}Z`;
};

// ---------------------------------------------------------------- master PNG
const S = GRID.canvas;
const canvas = canvasLib.createCanvas(S, S);
const ctx = canvas.getContext('2d');
const body = new Path2D(squirclePath(S / 2, S / 2, GRID.body));
ctx.save();
ctx.shadowColor = 'rgba(0, 0, 0, 0.28)';
ctx.shadowBlur = 22;
ctx.shadowOffsetY = 10;
ctx.fillStyle = C.cream;
ctx.fill(body);
ctx.restore();
// faint top light, warm bottom, so the cream body has some depth
ctx.save();
ctx.clip(body);
const grad = ctx.createLinearGradient(0, (S - GRID.body) / 2, 0, (S + GRID.body) / 2);
grad.addColorStop(0, 'rgba(255,255,255,0.22)');
grad.addColorStop(0.5, 'rgba(255,255,255,0)');
grad.addColorStop(1, 'rgba(184,137,46,0.05)');
ctx.fillStyle = grad;
ctx.fill(body);
ctx.restore();

const b = G.MARK_BOUNDS;
const markScale = GRID.markHeight / (b.y1 - b.y0);
ctx.save();
ctx.translate(S / 2, S / 2);
ctx.scale(markScale, markScale);
ctx.translate(-(b.x0 + b.x1) / 2, -(b.y0 + b.y1) / 2);
D.drawMark(ctx);
ctx.restore();
const masterPath = join(PREVIEW_DIR, 'icon.png');
writeFileSync(masterPath, canvas.toBuffer('image/png'));

// ---------------------------------------------------------------- sizes via sips
const sized = (px) => {
  const out = join(work, `icon_${px}.png`);
  execFileSync('sips', ['-z', String(px), String(px), masterPath, '--out', out], { stdio: 'ignore' });
  return out;
};
const cache = new Map();
const png = (px) => { if (!cache.has(px)) cache.set(px, sized(px)); return cache.get(px); };

// ---------------------------------------------------------------- icns via iconutil
const iconset = ensureDir(join(work, 'icon.iconset'));
for (const base of [16, 32, 128, 256, 512]) {
  writeFileSync(join(iconset, `icon_${base}x${base}.png`), readFileSync(png(base)));
  writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), readFileSync(base * 2 === 1024 ? masterPath : png(base * 2)));
}
execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(PREVIEW_DIR, 'icon.icns')]);

// ---------------------------------------------------------------- ico (PNG entries)
const writeIco = (file, sizes) => {
  const images = sizes.map((px) => readFileSync(png(px)));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((img, i) => {
    const px = sizes[i];
    const e = 6 + 16 * i;
    header.writeUInt8(px >= 256 ? 0 : px, e); header.writeUInt8(px >= 256 ? 0 : px, e + 1);
    header.writeUInt8(0, e + 2); header.writeUInt8(0, e + 3);
    header.writeUInt16LE(1, e + 4); header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(img.length, e + 8); header.writeUInt32LE(offset, e + 12);
    offset += img.length;
  });
  writeFileSync(file, Buffer.concat([header, ...images]));
};
writeIco(join(PREVIEW_DIR, 'icon.ico'), [16, 24, 32, 48, 64, 128, 256]);
writeIco(join(PREVIEW_DIR, 'favicon.ico'), [16, 32, 48]);

// ---------------------------------------------------------------- favicon.svg
{
  const pad = 70;
  const h = b.y1 - b.y0 + pad * 2;
  const cy = (b.y0 + b.y1) / 2;
  const x0 = -h / 2, y0 = cy - h / 2;
  const marks = G.markGroupsSvg();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${x0} ${y0} ${h} ${h}">\n  <rect x="${x0}" y="${y0}" width="${h}" height="${h}" rx="${(h * 0.225).toFixed(1)}" fill="${C.cream}"/>\n  ${marks}\n</svg>\n`;
  writeFileSync(join(PREVIEW_DIR, 'favicon.svg'), svg);
}

// ---------------------------------------------------------------- verify with ffmpeg
const ffmpeg = ffmpegPath();
for (const f of ['icon.ico', 'favicon.ico']) {
  try {
    execFileSync(ffmpeg, ['-hide_banner', '-v', 'error', '-i', join(PREVIEW_DIR, f), '-f', 'null', '-'], { stdio: 'pipe' });
    console.log(`checked ${f} with ffmpeg`);
  } catch (error) {
    console.warn(`ffmpeg could not read ${f}: ${String(error.stderr ?? error.message).trim()}`);
  }
}
rmSync(work, { recursive: true, force: true });
console.log('wrote build/brand-preview/icon.png, icon.icns, icon.ico, favicon.svg, favicon.ico');
