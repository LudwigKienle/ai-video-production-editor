import test from 'node:test';
import assert from 'node:assert/strict';
import { advanceVgenvProjectEpoch, isCurrentVgenvProject, jobForVgenvProject } from './vgenvProjectScope.ts';

test('switching to a new empty project invalidates late lists, polls and old cancellation targets', async () => {
  let current = { path: '/projects/old', value: 0 };
  const oldEpoch = current.value;
  const oldJob = { path: '/projects/old', job: { id: 'job_old' } };
  let release!: (jobs: Array<{ id: string }>) => void;
  const lateList = new Promise<Array<{ id: string }>>((resolve) => { release = resolve; });
  current = advanceVgenvProjectEpoch(current, '/projects/new-empty');
  let newJobs: Array<{ id: string }> = [];
  release([{ id: 'job_old' }]);
  const stale = await lateList;
  if (isCurrentVgenvProject(current, '/projects/old', oldEpoch)) newJobs = stale;
  assert.deepEqual(newJobs, []);
  assert.equal(jobForVgenvProject(oldJob, current.path), null);
  assert.equal(isCurrentVgenvProject(current, '/projects/new-empty', current.value), true);
  current = advanceVgenvProjectEpoch(current, '/projects/old');
  assert.equal(isCurrentVgenvProject(current, '/projects/old', oldEpoch), false);
});
