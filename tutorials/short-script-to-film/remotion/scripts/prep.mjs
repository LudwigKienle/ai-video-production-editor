// Cuts the chosen library clips, stills and sounds into ../build (git-ignored).
// Run from tutorials/short-script-to-film/remotion: node scripts/prep.mjs
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const here = path.dirname(new URL(import.meta.url).pathname);
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'media.json'), 'utf8'));
const library = manifest.library.replace(/^~/, os.homedir());
const repo = path.resolve(here, '../../../..');
const out = path.resolve(here, '../../build');
for (const dir of ['clips', 'stills', 'audio']) fs.mkdirSync(path.join(out, dir), { recursive: true });

const ffmpeg = (args) => execFileSync('ffmpeg', ['-v', 'error', '-y', ...args], { stdio: 'inherit' });

for (const clip of manifest.clips) {
  const src = path.join(library, clip.src);
  const dest = path.join(out, 'clips', `${clip.id}.mp4`);
  // Full-bleed clips fill 1080×1920; the others fill the 1080×1150 band in the middle of the frame.
  const [w, h] = clip.full ? [1080, 1920] : [1080, 1150];
  ffmpeg([
    '-ss', String(clip.in), '-t', String(clip.dur + 0.4), '-i', src,
    '-vf', `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},fps=30,format=yuv420p`,
    '-an', '-c:v', 'libx264', '-preset', 'medium', '-crf', '16', dest,
  ]);
  console.log('clip', clip.id);
}

for (const [id, rel] of Object.entries(manifest.stills)) {
  fs.copyFileSync(path.join(repo, rel), path.join(out, 'stills', `${id}.png`));
}

for (const [id, frame] of Object.entries(manifest.frames || {})) {
  ffmpeg(['-ss', String(frame.at), '-i', frame.src.replace(/^~/, os.homedir()), '-frames:v', '1', '-vf', `crop=${frame.crop}`, path.join(out, 'stills', `${id}.png`)]);
}

for (const [id, sound] of Object.entries(manifest.audio)) {
  const args = [];
  if (sound.in !== undefined) args.push('-ss', String(sound.in));
  if (sound.dur !== undefined) args.push('-t', String(sound.dur));
  ffmpeg([...args, '-i', path.join(library, sound.src), '-ar', '48000', '-ac', '2', path.join(out, 'audio', `${id}.wav`)]);
}

fs.writeFileSync(path.join(out, 'credits.json'), JSON.stringify({
  clips: manifest.clips.map(({ id, credit }) => ({ id, credit })),
  audio: Object.fromEntries(Object.entries(manifest.audio).map(([id, a]) => [id, a.license])),
}, null, 2));
console.log('done →', out);
