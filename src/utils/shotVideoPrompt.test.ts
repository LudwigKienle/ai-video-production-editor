import test from 'node:test';
import assert from 'node:assert/strict';

import { SHOT_VIDEO_PROMPT_GUIDE, lintShotVideoPrompt } from './shotVideoPrompt.ts';

const CLEAN = `Mara and Jonas sit across a kitchen table at night; Mara left third, Jonas right third.
Image 1 is Mara's identity: woman, 30s, wet dark hair, grey wool coat. 100% matches the reference.
One continuous shot; the camera does not cut on its own.
MCU, 47°, eye level, very slow dolly-in toward Mara.
Mara slides the key across the table and keeps her hand on it.
ACTING TASK — MARA (fully invested in the tactic; the work happens in the eyes):
SCENE DIRECTION: part without a scene.
TACTIC: offers the key like a small thing, checking both of his eyes for a spark of trust.
— "Take it." — pushes the key, eyes on his hands.
(Safety: gaze always engaged in the task — never frozen or glassy; natural blink cadence.)
Mara says quietly at 3s: "Take it."
Single pendant lamp above the table, warm 2700K, haze 10%.
Audio: fridge hum, the key scraping on wood at 2s, no music.
Final frame: her hand still on the key, holding for one second.`;

test('guide carries the acting ladder and block order', () => {
  assert.match(SHOT_VIDEO_PROMPT_GUIDE, /ACTING TASK — \[NAME\]/);
  assert.match(SHOT_VIDEO_PROMPT_GUIDE, /SCENE CONTEXT/);
  assert.match(SHOT_VIDEO_PROMPT_GUIDE, /Final frame/);
});

test('a well-formed shot prompt is clean', () => {
  assert.deepEqual(lintShotVideoPrompt(CLEAN, { hasDialogue: true, characters: 2, durationSeconds: 8 }), []);
});

test('flags mood words, brands, millimetres and context leaks', () => {
  const issues = lintShotVideoPrompt('Epic cinematic masterpiece, shot on ARRI Alexa with a 35mm lens, continues from the previous shot.');
  const rules = issues.map((issue) => issue.rule);
  assert.ok(rules.includes('wording'));
  assert.ok(rules.includes('names'));
  assert.ok(rules.includes('optics'));
  assert.ok(rules.includes('sealed'));
  assert.ok(rules.includes('final-frame'));
});

test('dialogue without an acting task, and played emotion, are flagged', () => {
  const issues = lintShotVideoPrompt('She looks at him sadly, her brows lift. Final frame: her face.', { hasDialogue: true });
  assert.ok(issues.some((issue) => issue.rule === 'acting' && /ACTING TASK/.test(issue.message)));
  assert.ok(issues.some((issue) => /sadly/.test(issue.message)));
  assert.ok(issues.some((issue) => /brows lift/.test(issue.message)));
});

test('timed segments must run forward and fit the clip', () => {
  const issues = lintShotVideoPrompt('0.0s to 4.0s — wide. 3.0s to 9.0s — close. Final frame: door.', { durationSeconds: 8 });
  assert.ok(issues.some((issue) => issue.rule === 'timing'));
});

test('fight shots need the style lock', () => {
  const issues = lintShotVideoPrompt('He throws a roundhouse. Final frame: both still.', { isFight: true });
  assert.ok(issues.some((issue) => issue.rule === 'fight' && /style lock/.test(issue.message)));
  assert.ok(issues.some((issue) => /martial-arts/.test(issue.message)));
});

test('structured prompts are recognised so the app sends them unchanged', async () => {
  const { isStructuredShotPrompt } = await import('./shotVideoPrompt.ts');
  assert.equal(isStructuredShotPrompt(CLEAN), true);
  assert.equal(isStructuredShotPrompt('Slow push in on Mara as she slides the key.'), false);
});

test('request lists references as Image N and keeps settings out of prose', async () => {
  const { buildShotVideoPromptRequest } = await import('./shotVideoPrompt.ts');
  const text = buildShotVideoPromptRequest({
    shotNumber: 4, description: 'Mara slides the key across.', durationSeconds: 8, aspectRatio: '16:9',
    references: ['Mara (character)', 'Kitchen (location)'],
    characters: [{ name: 'Mara', personality: 'guarded', goals: 'make him stay' }],
    dialogue: [{ speaker: 'Mara', line: 'Take it.' }],
  });
  assert.match(text, /Image 1: Mara \(character\)\nImage 2: Kitchen \(location\)/);
  assert.match(text, /8 s, aspect 16:9/);
  assert.match(text, /Mara: "Take it\."/);
  assert.match(text, /wants: make him stay/);
});
