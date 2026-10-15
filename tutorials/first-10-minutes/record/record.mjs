#!/usr/bin/env node
// Records the screen scenes of the tutorial from the real Electron app.
//
//   npm run dev                                      # app root, keep running
//   xvfb-run -a -s "-screen 0 4000x2400x24" node record/record.mjs            # all, 4K
//   SCALE=1 xvfb-run ... node record/record.mjs s05_folder                    # quick draft
//
// Needs build/timings/<scene>.json (script/voiceover.py). Writes build/screen/<scene>.mp4
// and <scene>.marks.json (UI rectangles over time, for zooms and highlights in Remotion).
import { mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { APP_ROOT, launchStudio } from './browser.mjs';
import { Recorder } from './recorder.mjs';
import { screenScenes } from './scenes.mjs';

const order = Object.keys(screenScenes);
const wanted = process.argv.slice(2);
const scale = Number(process.env.SCALE || 2.5);
const quality = Number(process.env.QUALITY || 92);

// Rainline, without the markdown title block, as a user would paste it.
const demoScript = readFileSync(resolve(APP_ROOT, 'examples/demo-project/script.md'), 'utf8')
  .replace(/^# Rainline[\s\S]*?## Scene 1\n\n/, '')
  .replace(/^## (Scene \d+)\n\n/gm, '');

// A fresh, empty project folder for every take.
const projectFolder = '/tmp/tutorial-projects/Rainline';
rmSync(projectFolder, { recursive: true, force: true });
mkdirSync(projectFolder, { recursive: true });

// Scenes depend on each other's end state, so a partial run replays the earlier scenes
// without writing them (fast: no frames are captured).
const last = wanted.length ? Math.max(...wanted.map((id) => order.indexOf(id))) : order.length - 1;
if (wanted.some((id) => !order.includes(id))) throw new Error(`unknown scene; known: ${order.join(', ')}`);

const { page, app, close } = await launchStudio({
  theme: 'dark',
  scale,
  prefs: { studio_onboarding_completed_v1: null, ui_mode_v1: 'beginner', studio_sidebar_collapsed_v1: 'false' },
});
const chooseFolder = () => app.evaluate(({ dialog }, folder) => {
  // The native folder picker cannot be filmed; answer it with the take's project folder.
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
}, projectFolder);
await page.waitForTimeout(1500);

try {
  for (const id of order.slice(0, last + 1)) {
    const record = !wanted.length || wanted.includes(id);
    const r = new Recorder(page, id, { quality });
    if (!record) {
      // Dry replay: run the directions with capture disabled.
      r.capture = async () => { r.frame += 1; }; r.write = async () => { r.frame += 1; };
      r.start = async () => { await r.installCursor(); }; r.finish = async () => ({});
    }
    const started = Date.now();
    await r.start();
    await screenScenes[id](r, { page, app, chooseFolder, demoScript });
    const result = await r.finish();
    if (record) console.log(`${id}: ${result.frames} frames, ${result.duration.toFixed(2)} s, ${((Date.now() - started) / 1000).toFixed(0)} s wall → ${result.file}`);
  }
} catch (error) {
  // Leave a picture of where a direction failed.
  await page.screenshot({ path: resolve(APP_ROOT, 'tutorials/first-10-minutes/build/failed.png') }).catch(() => {});
  throw error;
} finally {
  await close();
}
