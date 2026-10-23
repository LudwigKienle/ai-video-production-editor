import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAgentExecutor, describeMediaUrl, mergeWorld, upsertReference, upsertShots, withImageVersion, type ProjectAgentState } from './projectAgentTools.ts';

const ids = () => { let n = 0; return () => `ref-${++n}`; };

test('upsertReference creates a new character and requires name and type', () => {
  const result = upsertReference([], { type: 'character', name: 'Elena', description: 'Detective, 40s' }, ids());
  assert.equal(result.created, true);
  assert.equal(result.reference.id, 'ref-1');
  assert.equal(result.reference.prompt, 'Detective, 40s');
  assert.throws(() => upsertReference([], { type: 'character' }, ids()), /needs a name/);
  assert.throws(() => upsertReference([], { name: 'X' }, ids()), /needs a type/);
  assert.throws(() => upsertReference([], { name: 'X', type: 'monster' }, ids()), /type must be one of/);
});

test('upsertReference matches by type + name and appends an image version', () => {
  const first = upsertReference([], { type: 'environment', name: 'Rooftop', imageUrl: 'https://a/1.png' }, ids());
  const second = upsertReference(first.references, { type: 'environment', name: 'rooftop ', description: 'Night, rain', imageUrl: 'https://a/2.png' }, ids());
  assert.equal(second.created, false);
  assert.equal(second.references.length, 1);
  assert.equal(second.reference.description, 'Night, rain');
  assert.deepEqual(second.reference.imageVersions, ['https://a/1.png', 'https://a/2.png']);
  assert.equal(second.reference.imageUrl, 'https://a/2.png');
  assert.equal(second.reference.selectedVersionIndex, 1);
});

test('upsertShots merges by number, adds new shots in order, and fills prompt/description', () => {
  const base = [{ shot: 1, prompt: 'Wide city', description: 'Wide city', characters: [], environment: 'City' }];
  const { shots, touched } = upsertShots(base, [
    { shot: 1, cameraAngle: 'low_angle' },
    { description: 'Elena enters', characters: ['Elena'] },
    { shot: 5, prompt: 'Close on the badge', imagePath: 'file:///tmp/s5.png' },
  ]);
  assert.deepEqual(touched, [1, 2, 5]);
  assert.deepEqual(shots.map((shot) => shot.shot), [1, 2, 5]);
  assert.equal(shots[0].prompt, 'Wide city');
  assert.equal(shots[0].cameraAngle, 'low_angle');
  assert.equal(shots[1].prompt, 'Elena enters');
  assert.deepEqual(shots[1].characters, ['Elena']);
  assert.equal(shots[2].description, 'Close on the badge');
  assert.equal(shots[2].imageUrl, 'file:///tmp/s5.png');
});

test('upsertShots replace swaps the whole list', () => {
  const base = [{ shot: 1, prompt: 'a', description: 'a', characters: [], environment: null }];
  const { shots } = upsertShots(base, [{ shot: 3, prompt: 'b' }], true);
  assert.deepEqual(shots.map((shot) => shot.shot), [3]);
});

test('withImageVersion keeps the legacy single image as the first version', () => {
  const next = withImageVersion<{ imageUrl?: string | null; imageVersions?: string[]; selectedVersionIndex?: number }>({ imageUrl: 'https://old.png' }, 'https://new.png');
  assert.deepEqual(next.imageVersions, ['https://old.png', 'https://new.png']);
  assert.equal(next.selectedVersionIndex, 1);
});

test('describeMediaUrl hides inline data URLs', () => {
  assert.match(describeMediaUrl('data:image/png;base64,AAAA') || '', /embedded/);
  assert.equal(describeMediaUrl('https://x/y.png'), 'https://x/y.png');
  assert.equal(describeMediaUrl(null), null);
});

test('executor writes through the setters and reads its own writes before React re-renders', async () => {
  const state: ProjectAgentState = {
    storyBible: { logline: '', characters: [], plotBeats: '', script: 'Old draft', productionGuidelines: '' },
    references: [],
    shotPrompts: [],
    projectPath: null,
    projectName: 'Test',
    activePhase: 'script',
    activeWorkspace: 'PROJECT',
  };
  const opened: string[] = [];
  const executor = createProjectAgentExecutor({
    getState: () => state,
    setStoryBible: (update) => { state.storyBible = update(state.storyBible); },
    setReferences: () => undefined, // simulate a render that has not happened yet
    setShotPrompts: () => undefined,
    openPhase: async (phase) => { opened.push(phase); },
    automation: async () => { throw new Error('not used'); },
    settle: async () => undefined,
    saveProject: async () => ({ folderPath: '/tmp/x', savedAt: 'now', name: 'Test' }),
    saveProjectAs: async () => ({ folderPath: '/tmp/y', savedAt: 'now', name: 'Test' }),
    newProject: async () => undefined,
    openProject: async () => undefined,
    loadImage: async () => ({ base64: '', mimeType: 'image/jpeg' }),
  });
  await executor.project_update_story({ script: 'New draft', title: 'Night Shift' });
  assert.equal(state.storyBible.script, 'New draft');
  assert.equal(state.storyBible.scriptRevisions?.[0].script, 'Old draft');
  await executor.project_upsert_reference({ type: 'character', name: 'Elena' });
  await executor.project_upsert_shots({ shots: [{ prompt: 'Opening' }, { prompt: 'Second' }] });
  const overview = await executor.project_get_overview({}) as any;
  assert.equal(overview.references.length, 1);
  assert.equal(overview.shots.length, 2);
  await executor.project_open_phase({ phase: 'storyboard' });
  assert.deepEqual(opened, ['storyboard']);
  await assert.rejects(() => executor.project_open_phase({ phase: 'timeline' }), /phase must be one of/);
  await assert.rejects(() => executor.project_update_story({}), /at least one/);
});

test('mergeWorld fills fields and merges factions, places and glossary by name', () => {
  let n = 0;
  const id = (prefix: string) => `${prefix}-${++n}`;
  const first = mergeWorld(undefined, { universeName: 'OWNED', factions: [{ name: 'House Ashcroft', leader: 'Victor' }], glossary: [{ term: 'The Trust', meaning: '51%' }] }, id);
  assert.equal(first.universeName, 'OWNED');
  assert.equal(first.factions[0].leader, 'Victor');
  const second = mergeWorld(first, { tone: 'Glossy revenge', factions: [{ name: 'house ashcroft', agenda: 'Keep the shares' }, { name: 'The Vales' }], environments: [{ name: 'Ashcroft Tower', containerType: 'city' }], glossary: [{ term: 'the trust', meaning: '51% of Ashcroft Global' }] }, id);
  assert.equal(second.universeName, 'OWNED');
  assert.equal(second.tone, 'Glossy revenge');
  assert.equal(second.factions.length, 2);
  assert.equal(second.factions[0].leader, 'Victor');
  assert.equal(second.factions[0].agenda, 'Keep the shares');
  assert.equal(second.environments[0].containerType, 'city');
  assert.equal(second.glossary.length, 1);
  assert.equal(second.glossary[0].meaning, '51% of Ashcroft Global');
});
