import test from 'node:test';
import assert from 'node:assert/strict';

import {
  batchDirectorChunks,
  isSceneHeading,
  mergeShotsIntoScenes,
  orderDirectorShots,
  shotsReplacedByMerge,
  splitScenesForDirector,
  splitScriptIntoScenes,
  targetShotCount,
} from './directorScenes.ts';
import type { DirectorShot, ShotPrompt } from '../types.ts';

test('recognises English, German and numbered scene headings', () => {
  for (const heading of [
    'INT. KITCHEN - DAY',
    '12 EXT. ROOFTOP - NIGHT',
    'INT./EXT. CAR - MOVING',
    'I/E VAN',
    'EST. CITY SKYLINE',
    'INNEN. KÜCHE – TAG',
    '3 AUSSEN/INNEN AUTO',
    'Innen. Wohnung – Nacht',
    'Scene 3',
    'Szene 4: Hafen',
    '## Scene 5 — Harbour',
    'Bild 7',
  ]) {
    assert.equal(isSceneHeading(heading), true, heading);
  }
});

test('keeps prose that only starts like a heading', () => {
  for (const line of [
    'Intro music swells.',
    'Extra people walk by.',
    'Establishing shot of the city at dawn.',
    'Internet cafe noise fills the room.',
    'Innen ist es dunkel und still.',
    'Außen regnet es.',
    'Scenery changes slowly.',
  ]) {
    assert.equal(isSceneHeading(line), false, line);
  }
});

test('numbers scenes from the first heading and ignores a title preamble', () => {
  const scenes = splitScriptIntoScenes([
    'THE LAST HARBOUR',
    'A fisherman refuses to leave.',
    '',
    'INT. KITCHEN - DAY',
    'Anna pours coffee.',
    '',
    'EXT. HARBOUR - NIGHT',
    'Waves hit the pier.',
  ].join('\n'));

  assert.deepEqual(scenes.map((scene) => [scene.sceneNumber, scene.slugline]), [
    [1, 'INT. KITCHEN - DAY'],
    [2, 'EXT. HARBOUR - NIGHT'],
  ]);
  assert.match(scenes[0].text, /Anna pours coffee/);
  assert.doesNotMatch(scenes[0].text, /fisherman/);
});

test('treats a script without headings as one scene', () => {
  const scenes = splitScriptIntoScenes('Anna wakes up.\n\nShe walks to the window.\n\nIt is raining.');
  assert.equal(scenes.length, 1);
  assert.equal(scenes[0].sceneNumber, 1);
});

test('splits a long scene into ordered parts with the same scene number', () => {
  const paragraph = 'A'.repeat(1000);
  const chunks = splitScenesForDirector([
    { sceneNumber: 1, slugline: 'INT. A', text: 'short scene' },
    { sceneNumber: 2, slugline: 'INT. B', text: [paragraph, paragraph, paragraph].join('\n\n') },
  ], 2600);

  assert.deepEqual(chunks.map((chunk) => [chunk.sceneNumber, chunk.part, chunk.partCount]), [
    [1, 1, 1],
    [2, 1, 2],
    [2, 2, 2],
  ]);
});

test('targets more shots for longer scenes within bounds', () => {
  assert.equal(targetShotCount('short'), 3);
  assert.equal(targetShotCount('x'.repeat(2100)), 6);
  assert.equal(targetShotCount('x'.repeat(20000)), 14);
});

test('batches chunks in order by size and count', () => {
  const chunk = (sceneNumber: number, size: number) => ({ sceneNumber, slugline: '', text: 'x'.repeat(size), part: 1, partCount: 1 });
  const batches = batchDirectorChunks([chunk(1, 4000), chunk(2, 4000), chunk(3, 4000), chunk(4, 10)], 8600, 5);
  assert.deepEqual(batches.map((batch) => batch.map((item) => item.sceneNumber)), [[1, 2], [3, 4]]);
});

test('orders shots by scene and keeps the written order of long-scene parts', () => {
  const shot = (sceneNumber: number, sceneShotNumber: number, description: string): DirectorShot => ({
    shotNumber: 0,
    sceneNumber,
    sceneShotNumber,
    description,
    rationale: '',
    shotTypePresetId: 'wide',
    lightingPresetId: 'natural',
    prompt: description,
    cameraAngle: '',
    visualTriggers: [],
    characters: [],
  });
  const ordered = orderDirectorShots([
    shot(2, 1, 'part one a'),
    shot(2, 2, 'part one b'),
    shot(1, 1, 'scene one'),
    shot(2, 1, 'part two a'),
  ], [1, 2]);

  assert.deepEqual(ordered.map((item) => [item.shotLabel, item.description]), [
    ['1.1', 'scene one'],
    ['2.1', 'part one a'],
    ['2.2', 'part one b'],
    ['2.3', 'part two a'],
  ]);
  assert.deepEqual(ordered.map((item) => item.shotNumber), [1, 2, 3, 4]);
});

const storyboardShot = (shot: number, sceneNumber?: number, imageUrl?: string): ShotPrompt => ({
  shot,
  sceneNumber,
  sceneShotNumber: shot,
  prompt: `shot ${shot}`,
  imageUrl,
  isGenerating: false,
} as ShotPrompt);

test('replaces only the treated scenes and keeps unnumbered shots unless asked', () => {
  const existing = [storyboardShot(1, 1, 'a.png'), storyboardShot(2, 2), storyboardShot(3, undefined, 'loose.png')];
  const incoming = [storyboardShot(10, 2)];

  const scoped = mergeShotsIntoScenes(existing, incoming, [2]);
  assert.deepEqual(scoped.map((item) => [item.sceneNumber, item.imageUrl]), [[1, 'a.png'], [2, undefined], [undefined, 'loose.png']]);

  const whole = mergeShotsIntoScenes(existing, incoming, [2], { replaceUnnumbered: true });
  assert.deepEqual(whole.map((item) => item.sceneNumber), [1, 2]);

  assert.deepEqual(shotsReplacedByMerge(existing, [2], { replaceUnnumbered: true }).map((item) => item.shot), [2, 3]);
});
