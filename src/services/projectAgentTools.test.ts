import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectAgentExecutor, describeMediaUrl, mergeWorld, upsertOutfits, upsertReference, upsertShots, withImageVersion, type ProjectAgentState } from './projectAgentTools.ts';

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

test('upsertOutfits adds by name, updates in place and can replace the wardrobe', () => {
  let n = 0;
  const id = () => `o-${++n}`;
  const nora = { id: 'n', type: 'character' as const, name: 'Nora Vale', description: '', prompt: '', imageUrl: 'x', isGenerating: false };
  const first = upsertOutfits(nora, [{ name: 'Night uniform', prompt: 'grey uniform' }, { name: 'Black dress' }], id);
  assert.deepEqual(first.outfits.map((o) => o.name), ['Night uniform', 'Black dress']);
  assert.equal(first.outfits[1].prompt, 'Black dress');
  const second = upsertOutfits({ ...nora, outfits: first.outfits }, [{ name: 'night UNIFORM', description: 'E1–E9' }], id);
  assert.equal(second.outfits.length, 2);
  assert.equal(second.outfits[0].prompt, 'grey uniform');
  assert.equal(second.outfits[0].description, 'E1–E9');
  assert.deepEqual(second.touched, ['o-1']);
  const replaced = upsertOutfits({ ...nora, outfits: second.outfits }, [{ name: 'Red dress', prompt: 'blood-red gown' }], id, true);
  assert.deepEqual(replaced.outfits.map((o) => o.name), ['Red dress']);
});

test('long batches run as background jobs with live shot progress', async () => {
  const { withBackgroundJobs } = await import('./projectAgentTools.ts');
  let shots = [1, 2, 3].map((shot) => ({ shot, prompt: '', description: '', characters: [], environment: null } as any));
  let finish: () => void = () => undefined;
  const tools = withBackgroundJobs({
    project_generate_shot_images: () => new Promise((resolve) => { finish = () => resolve({ results: 'done' }); }),
  }, () => shots);
  const small = tools.project_generate_shot_images({ shots: [1], wait: true });
  finish();
  assert.deepEqual(await small, { results: 'done' });
  const started = await tools.project_generate_shot_images({ shots: [1, 2, 3] }) as any;
  assert.equal(started.status, 'running');
  shots = shots.map((shot) => (shot.shot === 1 ? { ...shot, imageUrl: 'https://x/1.png' } : shot.shot === 2 ? { ...shot, isGenerating: true } : shot));
  let status = (await tools.project_job_status({ jobId: started.jobId }) as any).jobs[0];
  assert.deepEqual(status.progress, { total: 3, done: 1, rendering: [2] });
  finish();
  await new Promise((resolve) => setTimeout(resolve, 0));
  status = (await tools.project_job_status({ jobId: started.jobId }) as any).jobs[0];
  assert.equal(status.status, 'done');
  assert.deepEqual(status.result, { results: 'done' });
});

test('upsertShots drops a stale continuity-refined prompt when the shot changes', () => {
  const base = [{ shot: 1, prompt: 'old', description: 'd', characters: [], environment: null, continuityRefinedPrompt: 'refined old', continuityRefinementPasses: 2 }];
  const edited = upsertShots(base, [{ shot: 1, prompt: 'new prompt' }]).shots[0];
  assert.equal(edited.prompt, 'new prompt');
  assert.equal(edited.continuityRefinedPrompt, undefined);
  const untouched = upsertShots(base, [{ shot: 1, characters: ['Nora'] }]).shots[0];
  assert.equal(untouched.continuityRefinedPrompt, 'refined old');
  const reversed = upsertShots(base, [{ shot: 1, cameraYaw: 180 }]).shots[0];
  assert.equal(reversed.continuityRefinedPrompt, undefined);
  assert.equal(upsertShots(base, [{ shot: 1, resetContinuity: true }]).shots[0].continuityRefinedPrompt, undefined);
});

test('a cancelled background job stops between shots and keeps finished work', async () => {
  const { withBackgroundJobs } = await import('./projectAgentTools.ts');
  const rendered: number[] = [];
  const tools = withBackgroundJobs({
    project_generate_shot_images: async (args: any) => {
      for (const shot of args.shots) {
        if (args.__isCancelled?.()) break;
        await new Promise((resolve) => setTimeout(resolve, 5));
        rendered.push(shot);
      }
      return { rendered };
    },
  }, () => []);
  const { jobId } = await tools.project_generate_shot_images({ shots: [1, 2, 3, 4, 5, 6] }) as { jobId: string };
  await new Promise((resolve) => setTimeout(resolve, 12));
  await tools.project_cancel_job({ jobId });
  await new Promise((resolve) => setTimeout(resolve, 30));
  const status = await tools.project_job_status({ jobId }) as { jobs: Array<{ status: string }> };
  assert.equal(status.jobs[0].status, 'cancelled');
  assert.ok(rendered.length > 0 && rendered.length < 6);
});

test('project_review_videos reports takes as 1-based versions and the best take with its reason', async () => {
  const state: ProjectAgentState = {
    storyBible: { logline: '', characters: [], plotBeats: '', script: '', productionGuidelines: '' },
    references: [],
    shotPrompts: [{ shot: 4, prompt: 'Gala', description: 'Nora crosses the gala', characters: ['Nora'], environment: null, videoUrl: 'v1.mp4', videoVersions: ['v1.mp4', 'v2.mp4'] }],
    projectPath: null, projectName: 'Test', activePhase: 'filming', activeWorkspace: 'PROJECT',
  };
  const calls: unknown[] = [];
  const takeReview = (videoUrl: string, score: number) => ({
    videoUrl, score, verdict: score >= 8 ? 'keep' as const : 'reshoot' as const, frozenBackground: score < 6, summary: `take ${videoUrl}`,
    scores: { visualQuality: score, animation: score, cameraMotion: null, backgroundMotion: score, consistency: score, lipSync: null, audio: null },
    issues: score < 6 ? [{ category: 'background' as const, severity: 'high' as const, message: 'Guests frozen.', timestamp: '00:02' }] : [],
    reviewedAt: 'now',
  });
  const executor = createProjectAgentExecutor({
    getState: () => state,
    setStoryBible: () => undefined, setReferences: () => undefined, setShotPrompts: () => undefined,
    openPhase: async () => undefined,
    automation: async (phase) => {
      assert.equal(phase, 'filming');
      return { reviewVideos: async (payload: unknown) => {
        calls.push(payload);
        return [{
          shot: 4, takes: ['v1.mp4', 'v2.mp4'], reviews: [takeReview('v1.mp4', 4.5), takeReview('v2.mp4', 8.6)], selectedVideoUrl: 'v1.mp4',
          comparison: { bestVideoUrl: 'v2.mp4', reason: 'The crowd moves.', decidedBy: 'comparison' as const, comparedAt: 'now', ranking: [{ videoUrl: 'v2.mp4', rank: 1, reason: 'alive' }, { videoUrl: 'v1.mp4', rank: 2, reason: 'frozen' }] },
        }, { shot: 9, error: 'No shot 9.' }];
      } } as any;
    },
    settle: async () => undefined,
    saveProject: async () => ({ folderPath: '/tmp/x', savedAt: 'now', name: 'Test' }),
    saveProjectAs: async () => ({ folderPath: '/tmp/y', savedAt: 'now', name: 'Test' }),
    newProject: async () => undefined, openProject: async () => undefined,
    loadImage: async () => ({ base64: '', mimeType: 'image/jpeg' }),
  });
  const result = await executor.project_review_videos({ shots: [4, 9], compareVersions: true, wait: true }) as any;
  assert.equal((calls[0] as any).compareVersions, true);
  assert.equal((calls[0] as any).selectBest, false);
  const [shot4, shot9] = result.reviews;
  assert.equal(shot4.selectedTake, 1);
  assert.deepEqual(shot4.takes.map((take: any) => [take.take, take.score]), [[1, 4.5], [2, 8.6]]);
  assert.equal(shot4.takes[0].frozenBackground, true);
  assert.deepEqual(shot4.takes[0].issues, ['[high] 00:02 background: Guests frozen.']);
  assert.equal(shot4.takes[1].scores.lipSync, null);
  assert.deepEqual(shot4.best, { take: 2, reason: 'The crowd moves.', decidedBy: 'comparison', ranking: ['v2: alive', 'v1: frozen'] });
  assert.deepEqual(shot9, { shot: 9, error: 'No shot 9.' });
});
