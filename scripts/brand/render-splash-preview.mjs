#!/usr/bin/env node
/**
 * Preview of the start animation with sound, rendered frame by frame from
 * renderSplashFrame (deterministic) on @napi-rs/canvas - no Electron, no
 * browser profile, HOME untouched.
 *
 * Outputs (build/brand-preview/):
 *   splash-preview.mp4        default variant, 1920×1080, 60 fps, H.264 + AAC
 *   splash-preview.wav        synthStartSound(48000), 24-bit stereo
 *   splash-variant-<A|B|C>.mp4  each variant, 1280×720, 60 fps, with sound
 *   splash-reduced-motion.mp4 the prefers-reduced-motion fade
 *   storyboard-<A|B|C>.png    contact sheet, 4 key frames per variant
 *
 *   node scripts/brand/render-splash-preview.mjs [--only storyboard|video] [--variants A,B,C]
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { PREVIEW_DIR, canvasLib, drawLabel, ensureDir, ffmpegPath, loadTs } from './brand-lib.mjs';

const R = await loadTs('src/splash/renderSplashFrame.ts');
const S = await loadTs('src/splash/startSound.ts');

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const only = opt('only', 'all');
const variants = opt('variants', 'A,B,C').split(',');
const FPS = 60;
const TAIL = 0.6; // seconds of "app" after the hand-off
ensureDir(PREVIEW_DIR);

/** Neutral stand-in for the editor UI that appears under the fading splash. */
function drawAppBackdrop(ctx, w, h) {
  ctx.fillStyle = '#16181b'; ctx.fillRect(0, 0, w, h);
  const u = h / 1080;
  ctx.fillStyle = '#1f2226'; ctx.fillRect(0, 0, w, 46 * u);
  ctx.fillStyle = '#1b1e22'; ctx.fillRect(0, 46 * u, 300 * u, h - 46 * u);
  ctx.fillRect(w - 340 * u, 46 * u, 340 * u, h - 46 * u);
  ctx.fillStyle = '#0f1113'; ctx.fillRect(320 * u, 70 * u, w - 680 * u, 520 * u);
  ctx.fillStyle = '#1b1e22'; ctx.fillRect(320 * u, 620 * u, w - 680 * u, h - 640 * u);
  ctx.fillStyle = '#2a2e33';
  for (let i = 0; i < 6; i += 1) ctx.fillRect(340 * u, (650 + i * 62) * u, (380 + ((i * 137) % 520)) * u, 40 * u);
}

function frameCanvas(w, h, t, variant, extra = {}) {
  const canvas = canvasLib.createCanvas(w, h);
  const ctx = canvas.getContext('2d');
  drawAppBackdrop(ctx, w, h);
  R.renderSplashFrame(ctx, t, { width: w, height: h, variant, clear: false, ...extra });
  return canvas;
}

// ---------------------------------------------------------------- sound
const SR = 48000;
const samples = S.synthStartSound(SR);
const wavPath = join(PREVIEW_DIR, 'splash-preview.wav');
writeFileSync(wavPath, S.encodeWav(samples, SR, 24));
const loud = S.measureLoudness(samples, SR);
console.log(`wav: ${(samples.length / 2 / SR).toFixed(2)} s, ${loud.lufs.toFixed(2)} LUFS, peak ${loud.peakDb.toFixed(2)} dBFS`);

// ---------------------------------------------------------------- storyboards
const KEYFRAMES = [
  { t: 0.36, label: '0.36 s  Diana draws the bow' },
  { t: 0.82, label: '0.82 s  Hermes carries the arrow' },
  { t: 1.62, label: '1.62 s  The message unfolds' },
  { t: 2.95, label: '2.95 s  The logo' },
];
if (only === 'all' || only === 'storyboard') {
  for (const variant of variants) {
    const info = R.SPLASH_VARIANTS.find((v) => v.id === variant);
    const tw = 960, th = 540, gap = 28, head = 96, foot = 52;
    const sheet = canvasLib.createCanvas(tw * 2 + gap * 3, head + (th + foot) * 2 + gap);
    const ctx = sheet.getContext('2d');
    ctx.fillStyle = '#e9e3d4'; ctx.fillRect(0, 0, sheet.width, sheet.height);
    drawLabel(ctx, `Variant ${variant}  ·  ${info.label}`, gap, 52, 34, '#1F3B2D', 500);
    drawLabel(ctx, info.description, gap, 82, 20, '#5b5a52', 400);
    KEYFRAMES.forEach((k, i) => {
      const x = gap + (i % 2) * (tw + gap), y = head + Math.floor(i / 2) * (th + foot);
      const tile = frameCanvas(tw * 2, th * 2, k.t, variant);
      ctx.drawImage(tile, x, y, tw, th);
      drawLabel(ctx, k.label, x, y + th + 32, 20, '#1F3B2D', 500);
    });
    writeFileSync(join(PREVIEW_DIR, `storyboard-${variant}.png`), sheet.toBuffer('image/png'));
    console.log(`storyboard-${variant}.png`);
  }
}

// ---------------------------------------------------------------- videos
async function renderVideo(file, w, h, variant, extra = {}) {
  const duration = R.splashDuration(extra) + TAIL;
  const frames = Math.round(duration * FPS);
  const ff = spawn(ffmpegPath(), [
    '-hide_banner', '-loglevel', 'error', '-y',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${w}x${h}`, '-r', String(FPS), '-i', '-',
    '-i', wavPath,
    '-map', '0:v', '-map', '1:a',
    '-c:v', 'libx264', '-preset', 'slow', '-crf', '15', '-pix_fmt', 'yuv420p', '-tune', 'animation',
    '-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709',
    '-c:a', 'aac', '-b:a', '256k', '-ar', '48000',
    '-movflags', '+faststart',
    join(PREVIEW_DIR, file),
  ], { stdio: ['pipe', 'inherit', 'inherit'] });
  const done = new Promise((resolve, reject) => ff.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg exited ${code}`)))));
  for (let i = 0; i < frames; i += 1) {
    const canvas = frameCanvas(w, h, i / FPS, variant, extra);
    const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
    if (!ff.stdin.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength))) await new Promise((r) => ff.stdin.once('drain', r));
  }
  ff.stdin.end();
  await done;
  console.log(`${file}: ${frames} frames @ ${FPS} fps, ${w}×${h}`);
}

if (only === 'all' || only === 'video') {
  await renderVideo('splash-preview.mp4', 1920, 1080, R.DEFAULT_SPLASH_VARIANT);
  for (const variant of variants) await renderVideo(`splash-variant-${variant}.mp4`, 1280, 720, variant);
  await renderVideo('splash-reduced-motion.mp4', 1280, 720, R.DEFAULT_SPLASH_VARIANT, { reducedMotion: true });
}
