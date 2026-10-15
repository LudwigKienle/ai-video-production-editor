// Renders check stills from one bundle: node scripts/stills.mjs [composition] [frame,frame,...]
// Without arguments: a few frames from every scene of the full tutorial.
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = resolve(root, '../build/stills-check');
mkdirSync(out, { recursive: true });
const serveUrl = await bundle({ entryPoint: resolve(root, 'src/index.ts'), publicDir: resolve(root, '../build') });
const id = process.argv[2] || 'Tutorial';
const browserExecutable = process.env.REMOTION_BROWSER || null;
const composition = await selectComposition({ serveUrl, id, browserExecutable });
const frames = process.argv[3]
  ? process.argv[3].split(',').map(Number)
  : Array.from({ length: 24 }, (_, i) => Math.round((i + 0.5) * composition.durationInFrames / 24));
for (const frame of frames) {
  const output = resolve(out, `${id}-${String(frame).padStart(5, '0')}.jpg`);
  await renderStill({ composition, serveUrl, output, frame, imageFormat: 'jpeg', jpegQuality: 85, browserExecutable });
  console.log(output);
}
