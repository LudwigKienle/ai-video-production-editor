import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSceneShots, charactersInScene, hasDialogue, locationsForScene, propsInScene, reviewScene, reviewStoryboard, sceneTargetShots, shotSize, summarizeDirectorScenes } from './directorAgent.ts';
import { splitScriptIntoScenes } from './directorScenes.ts';
import type { ReferenceItem, ShotPrompt } from '../types';

const ref = (type: ReferenceItem['type'], name: string): ReferenceItem => ({ id: name, type, name, description: '', prompt: '', imageUrl: null, isGenerating: false });
const references = [
  ref('character', 'Nora Vale'), ref('character', 'Damien Ashcroft'), ref('character', 'Celeste Ashcroft'),
  ref('environment', 'Penthouse Ballroom'), ref('environment', "Damien's Office"), ref('prop', 'Vale Emerald Ring'),
];

const script = `OWNED

EPISODE 1

INT. ASHCROFT TOWER — PENTHOUSE BALLROOM — NIGHT

[0:00] Champagne pours over NORA's face. CELESTE holds the glass.

CELESTE
Oops. You missed a spot.

[0:28] An emerald ring spins and stops against DAMIEN's shoe.

INT. ASHCROFT TOWER — DAMIEN'S OFFICE — NIGHT

[0:00] Damien signs a contract. Nora reads it.

DAMIEN
Seven days until your birthday.`;

const shot = (sceneNumber: number, prompt: string, extra: Partial<ShotPrompt> = {}): ShotPrompt => ({ shot: 0, sceneNumber, prompt, description: prompt, characters: [], environment: 'Penthouse Ballroom', ...extra });

test('scenes come from the shared splitter with cast, location and dialogue detected', () => {
  const scenes = summarizeDirectorScenes(script, references, []);
  assert.equal(scenes.length, 2);
  assert.equal(scenes[0].slugline, 'INT. ASHCROFT TOWER — PENTHOUSE BALLROOM — NIGHT');
  assert.deepEqual(scenes[0].cast.sort(), ['Celeste Ashcroft', 'Damien Ashcroft', 'Nora Vale']);
  assert.deepEqual(scenes[0].locations, ['Penthouse Ballroom']);
  assert.deepEqual(scenes[0].props, ['Vale Emerald Ring']);
  assert.equal(scenes[0].dialogue, true);
  assert.deepEqual(scenes[1].locations, ["Damien's Office"]);
});

test('character and location detection ignore unrelated words', () => {
  const [, office] = splitScriptIntoScenes(script);
  assert.deepEqual(charactersInScene(office, references).sort(), ['Damien Ashcroft', 'Nora Vale']);
  assert.deepEqual(locationsForScene(office, references), ["Damien's Office"]);
  assert.equal(hasDialogue('Nora looks at the city.'), false);
});

test('shot sizes are read from presets, angles and prompt wording', () => {
  assert.equal(shotSize({ shotTypePresetId: 'wide', prompt: '' }), 'wide');
  assert.equal(shotSize({ prompt: 'Extreme close-up: champagne pours over her face' }), 'insert');
  assert.equal(shotSize({ cameraAngle: 'over_the_shoulder', prompt: 'Nora takes the ring' }), 'ots');
  assert.equal(shotSize({ prompt: 'Close-up: Victor at the top of the stairs' }), 'close');
});

test('buildSceneShots numbers by scene, snaps names and warns about unknown ones', () => {
  const [ballroom] = splitScriptIntoScenes(script);
  const { shots, warnings } = buildSceneShots(ballroom, [
    { prompt: 'Wide: party', shotType: 'wide', characters: ['nora vale'], environment: 'penthouse ballroom', cameraMovement: 'dolly in', rationale: 'Sets the stakes' },
    { prompt: 'Close-up: Celeste smirks', shotType: 'closeup', characters: ['Celeste', 'The Butler'], props: ['vale emerald ring'] },
  ], references);
  assert.deepEqual(shots.map((s) => s.shotLabel), ['1.1', '1.2']);
  assert.equal(shots[0].characters[0], 'Nora Vale');
  assert.equal(shots[0].environment, 'Penthouse Ballroom');
  assert.equal(shots[0].motionPrompt, 'Camera: dolly in');
  assert.deepEqual(shots[0].analysisNotes, ['Director: Sets the stakes']);
  assert.equal(shots[1].characters[0], 'Celeste Ashcroft');
  assert.deepEqual(shots[1].products, ['Vale Emerald Ring']);
  assert.equal(shots[0].sceneSlugline, ballroom.slugline);
  assert.ok(warnings.some((w) => w.includes('The Butler')));
});

test('review flags thin coverage and passes a well-covered scene', () => {
  const [ballroom] = splitScriptIntoScenes(script);
  const thin = reviewScene(ballroom, [shot(1, 'Medium: guests laugh')], references);
  assert.equal(thin.ok, false);
  assert.ok(thin.issues.some((i) => i.includes('establishing')));
  assert.ok(thin.issues.some((i) => i.includes('close-up')));
  assert.ok(thin.issues.some((i) => i.includes('In the script but in no shot')));
  const covered = reviewScene(ballroom, [
    shot(1, 'Wide establishing: gold ballroom', { shotTypePresetId: 'wide', characters: ['Nora Vale', 'Celeste Ashcroft'] }),
    shot(1, 'Over-the-shoulder: Celeste to Nora', { shotTypePresetId: 'ots', characters: ['Celeste Ashcroft', 'Nora Vale'] }),
    shot(1, 'Close-up: Nora', { shotTypePresetId: 'closeup', characters: ['Nora Vale'] }),
    shot(1, 'Extreme close-up: the ring stops at a shoe', { shotTypePresetId: 'extreme_closeup', characters: ['Damien Ashcroft'] }),
  ], references);
  assert.deepEqual(covered.issues, []);
});

test('microdrama rules: hook first, establishing within three, freeze last', () => {
  const [ballroom] = splitScriptIntoScenes(script);
  const shots = Array.from({ length: 12 }, (_, i) => shot(1, i <= 1 ? 'Wide: ballroom' : 'Medium: reaction', { characters: ['Nora Vale', 'Celeste Ashcroft', 'Damien Ashcroft'], shotTypePresetId: i <= 1 ? 'wide' : 'closeup' }));
  const review = reviewScene(ballroom, shots, references, 'microdrama');
  assert.ok(review.issues.some((i) => i.includes('hook')));
  assert.ok(!review.issues.some((i) => i.startsWith('No establishing')));
});

test('reviewStoryboard lists shots outside any scene', () => {
  const result = reviewStoryboard(script, [shot(1, 'Wide'), shot(7, 'Stray', { shot: 9 })], references);
  assert.deepEqual(result.orphanShots, [9]);
  assert.equal(result.scenes[1].issues[0], 'No shots yet.');
});

test('character-name words do not pick places or props; mentions are not entrances', () => {
  const refs = [...references, ref('environment', 'Ashcroft Boardroom'), ref('environment', "Victor's Penthouse Residence"), ref('character', 'Victor Ashcroft')];
  const scene = { sceneNumber: 2, slugline: "INT. ASHCROFT TOWER — DAMIEN'S OFFICE — NIGHT", text: "INT. ASHCROFT TOWER — DAMIEN'S OFFICE — NIGHT\n\nDAMIEN signs. NORA reads.\n\nNORA\nCeleste doesn't know." };
  assert.deepEqual(locationsForScene(scene, refs), ["Damien's Office"]);
  assert.deepEqual(charactersInScene(scene, refs).sort(), ['Damien Ashcroft', 'Nora Vale']);
  assert.deepEqual(propsInScene({ ...scene, text: 'Nora Vale walks in.' }, refs), []);
});

test('microdrama target shots come from the timestamps', () => {
  assert.equal(sceneTargetShots('[0:00] hook [0:40] jolt [1:26] freeze', 'microdrama'), 15);
  assert.equal(sceneTargetShots('no timestamps here', 'microdrama'), 14);
  assert.ok(sceneTargetShots('short', 'feature') >= 3);
});

test('sluglines and possessives are not entrances', () => {
  const refs = [...references, ref('character', 'Victor Ashcroft')];
  const scene = { sceneNumber: 8, slugline: "INT. VICTOR'S PENTHOUSE RESIDENCE — NIGHT", text: "INT. VICTOR'S PENTHOUSE RESIDENCE — NIGHT\n\nCeleste watches the fire. Through the glass: Victor's men.\n\nCELESTE\nNo will." };
  assert.deepEqual(charactersInScene(scene, refs), ['Celeste Ashcroft']);
});

test('per-shot outfits become outfitSelections', () => {
  const [ballroom] = splitScriptIntoScenes(script);
  const nora = { ...ref('character', 'Nora Vale'), outfits: [{ id: 'o1', name: 'Night-shift uniform', prompt: '' }, { id: 'o2', name: 'Boardroom black dress', prompt: '' }] };
  const { shots, warnings } = buildSceneShots(ballroom, [{ prompt: 'Nora', characters: ['Nora Vale'], outfits: { Nora: 'boardroom black dress', 'Nora Vale': 'Ballgown' } }], [nora]);
  assert.deepEqual(shots[0].outfitSelections, { 'Nora Vale': 'o2' });
  assert.ok(warnings.some((w) => w.includes('Ballgown')));
});

test('voice-over cues are not on screen', () => {
  const refs = [...references, ref('character', 'Harriet Lane')];
  const scene = { sceneNumber: 7, slugline: 'INT. LOBBY — NIGHT', text: 'INT. LOBBY — NIGHT\n\nNora at the microphones.\n\nHARRIET (V.O.)\nThe will is gone.' };
  assert.deepEqual(charactersInScene(scene, refs), ['Nora Vale']);
});
