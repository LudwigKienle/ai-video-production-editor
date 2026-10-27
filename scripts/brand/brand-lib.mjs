/**
 * Shared helpers for the brand scripts: @napi-rs/canvas as the Canvas 2D
 * backend, loading the TypeScript sources (Node type stripping), ffmpeg lookup.
 * Nothing here touches the user profile or HOME.
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const PREVIEW_DIR = join(ROOT, 'build', 'brand-preview');

export const canvasLib = require('@napi-rs/canvas');
// The shared drawing code uses the global Path2D, as in the browser.
globalThis.Path2D = canvasLib.Path2D;

export const loadTs = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

export const ensureDir = (dir) => { mkdirSync(dir, { recursive: true }); return dir; };

/** ffmpeg: ffmpeg-static (the app's ffmpegBinaryPath source) first, then PATH. */
export function ffmpegPath() {
  try {
    const p = require('ffmpeg-static');
    if (p && existsSync(p)) return p;
  } catch { /* not installed */ }
  try {
    return execFileSync('/usr/bin/which', ['ffmpeg']).toString().trim() || 'ffmpeg';
  } catch {
    return 'ffmpeg';
  }
}

/** Draws text with an OFL font outline (labels on contact sheets). */
export function drawLabel(ctx, text, x, y, size, color, weight = 500) {
  const opentype = require('opentype.js');
  const font = opentype.loadSync(require.resolve(`@fontsource/jost/files/jost-latin-${weight}-normal.woff`));
  const path = font.getPath(text, x, y, size);
  path.fill = color;
  path.draw(ctx);
}
