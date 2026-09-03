#!/usr/bin/env node
/**
 * Captures README screenshots from the running dev server (http://localhost:5173).
 *
 *   npm run dev            # in one terminal
 *   node scripts/capture-screenshots.mjs [--light]
 *
 * Uses the locally installed Google Chrome through playwright-core, so no
 * browser download is needed. Output goes to docs/assets/screenshots/.
 */
import { chromium } from 'playwright-core';
import { mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE_URL = process.env.STUDIO_URL || 'http://localhost:5173/studio.html';
const OUT_DIR = resolve(process.cwd(), 'docs/assets/screenshots');
const THEME = process.argv.includes('--light') ? 'light' : 'dark';
const SUFFIX = THEME === 'light' ? '-light' : '';
const ONLY = (process.env.ONLY || '').split(',').filter(Boolean);
const wants = (name) => ONLY.length === 0 || ONLY.includes(name);
mkdirSync(OUT_DIR, { recursive: true });

const SAMPLE_SCRIPT = `INT. LIGHTHOUSE KITCHEN - DAWN

Salt-stained windows. A kettle ticks on a cold stove. MARA (40s, weathered, precise) unrolls a tide chart across the table and pins it with a chipped mug.

MARA
(to herself)
Three hours before the water turns.

The radio crackles. A voice, half static.

RADIO VOICE (V.O.)
Harbour to Point Ness. Do you copy?

Mara does not answer. She pulls on her coat.

EXT. CLIFF PATH - CONTINUOUS

Wind flattens the grass. Mara climbs toward the lamp room, a canvas bag over her shoulder. Far below, a small boat fights the swell.

MARA
Hold on. I see you.

INT. LAMP ROOM - MOMENTS LATER

She throws the breaker. The great lens begins to turn, throwing a blade of light across the black water.
`;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const context = await browser.newContext({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 1.5,
  colorScheme: THEME,
});
const page = await context.newPage();

await page.addInitScript((theme) => {
  window.localStorage.setItem('ui_theme_v1', theme);
  window.localStorage.setItem('studio_onboarding_completed_v1', 'true');
  window.localStorage.setItem('ui_mode_v1', 'pro');
  window.localStorage.setItem('studio_sidebar_collapsed_v1', 'false');
}, THEME);

await page.goto(BASE_URL, { waitUntil: 'networkidle' });
await sleep(1500);

const closeModals = async () => {
  const close = page.locator('button', { hasText: '×' }).first();
  if (await close.count()) {
    await close.click({ timeout: 2000 }).catch(() => undefined);
    await sleep(400);
  }
};
await closeModals();

const go = async (workspace) => {
  await page.locator(`[data-studio-action="workspace:${workspace}"]`).first().click();
  await sleep(1200);
  await closeModals();
};

const shoot = async (name) => {
  const file = resolve(OUT_DIR, `${name}${SUFFIX}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log('saved', file);
};

// 1. Project hub: script page with a sample script
if (wants('project')) {
await go('project');
await page.locator('[data-studio-action="project-phase:script"]').first().click();
await sleep(800);
const editor = page.locator('.script-page__editor textarea').first();
if (await editor.count()) {
  await editor.fill(SAMPLE_SCRIPT);
  await sleep(600);
}
await shoot('studio-script');

await page.locator('[data-studio-action="project-phase:storyboard"]').first().click();
await sleep(1000);
await shoot('studio-storyboard');
}

// 2. Moodboard with sample images
if (wants('moodboard')) {
await go('moodboard');
const moodInput = page.locator('input[type="file"][multiple]').first();
if (await moodInput.count()) {
  const samples = [
    'public/assets/features/set_design_v2.png',
    'public/assets/features/scene_map_v2.png',
    'public/assets/features/concept_casting.png',
    'public/assets/features/avatar_studio_v2.png',
    'public/assets/features/sound_design_v2.png',
    'public/assets/visuals/hero_visual_v2.png',
  ].filter((file) => existsSync(resolve(process.cwd(), file)));
  await moodInput.setInputFiles(samples.map((file) => resolve(process.cwd(), file)));
  await sleep(1800);
  // tidy + fit
  const tidy = page.locator('button', { hasText: 'Tidy' }).first();
  if (await tidy.count()) await tidy.click();
  await sleep(400);
  await page.keyboard.press('Meta+0');
  await sleep(600);
}
await shoot('studio-moodboard');
}

// 3. Set design (3D)
if (wants('set_design')) {
await go('set_design');
await sleep(2500);
await shoot('studio-set-design');
}

// 4. Scene map: seed a small set in 2D, then show the 3D blockout
if (wants('scene_map')) {
  await go('scene_map');
  const seeds = [
    ['environment', 260, 200], ['environment', 720, 180], ['character', 480, 360], ['character', 560, 420],
    ['camera', 380, 560], ['light', 660, 300], ['light', 240, 420], ['prop', 620, 520], ['area', 420, 240],
  ];
  for (const [type, x, y] of seeds) {
    await page.evaluate(([kind, px, py]) => {
      const canvas = document.querySelector('.scene-canvas');
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const dt = new DataTransfer();
      dt.setData('application/json', JSON.stringify({ type: kind }));
      const event = new DragEvent('drop', { bubbles: true, cancelable: true, clientX: rect.left + px, clientY: rect.top + py, dataTransfer: dt });
      canvas.dispatchEvent(event);
    }, [type, x, y]);
    await sleep(120);
  }
  await sleep(400);
  const threeD = page.locator('button', { hasText: '3D blockout' }).first();
  if (await threeD.count()) {
    await threeD.click();
    await sleep(2200);
  }
  await shoot('studio-scene-map-3d');
}

// 5. Image + video generation
if (wants('generation')) {
await go('image_gen');
await shoot('studio-image-gen');
await go('video_gen');
await shoot('studio-video-gen');
}

// 6. Library, plugins, team, research graph
if (wants('spaces')) {
await go('asset_library');
await sleep(600);
const packs = page.locator('.lib-sidebar__item', { hasText: 'Asset packs' }).first();
if (await packs.count()) await packs.click();
await sleep(1200);
await shoot('studio-library');
await go('plugins');
await shoot('studio-plugins');
await go('team');
await shoot('studio-team');
await go('notebooklm');
const graphTab = page.locator('button', { hasText: 'Knowledge Graph' }).first();
if (await graphTab.count()) {
  await graphTab.click();
  await sleep(800);
  const sources = [
    ['https://www.arri.com/en/camera-systems/cameras/alexa-35', 'ARRI Alexa 35 colour science', 'camera, alexa, skin tones'],
    ['https://fal.ai/models/bytedance/seedance-2.5/image-to-video', 'Seedance 2.5 image-to-video', 'video model, seedance, motion'],
    ['https://fal.ai/models/bytedance/seedream/v5/pro/text-to-image', 'Seedream 5.0 Pro', 'image model, seedream, realism'],
    ['https://www.pureref.com/', 'PureRef reference boards', 'moodboard, references'],
    ['https://www.blackmagicdesign.com/products/davinciresolve', 'DaVinci Resolve colour page', 'color, grading, resolve'],
    ['https://www.scenedetect.com/', 'PySceneDetect adaptive detector', 'auto cut, scene detection, motion'],
    ['https://auto-editor.com/', 'auto-editor silence removal', 'auto cut, silence, dialogue'],
    ['https://developers.google.com/veo', 'Veo 3.1 dialogue and audio', 'video model, dialogue, audio'],
    ['https://klingai.com/', 'Kling v3 human performance', 'video model, performance, motion'],
  ];
  for (const [url, title, tags] of sources) {
    await page.locator('.kgraph__section input').nth(0).fill(url);
    await page.locator('.kgraph__section input').nth(1).fill(title);
    await page.locator('.kgraph__section input').nth(2).fill(tags);
    await page.locator('button', { hasText: 'Add to graph' }).first().click();
    await sleep(150);
  }
  await sleep(3500);
  const node = page.locator('[data-node]').first();
  if (await node.count()) await node.dispatchEvent('pointerdown').catch(() => undefined);
  await sleep(500);
}
await shoot('studio-research-graph');
}

// 7. Color page (only meaningful with clips on the timeline)
if (wants('color')) {
await go('post');
await shoot('studio-color');
}

await browser.close();
console.log('done');
