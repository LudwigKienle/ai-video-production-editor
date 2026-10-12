import test from 'node:test';
import assert from 'node:assert/strict';
import { waitForVgenvJob, formatVgenvPrice } from './vgenvVideoService.ts';
import { getTasks } from './taskCenter.ts';

test('status fetch result is ignored after abort; confirmed cancellation is shown in Task Center', async () => {
  let release!: (value: unknown) => void;
  const response = new Promise((resolve) => { release = resolve; });
  (globalThis as any).window = { electron: { vgenv: { get: () => response } } };
  const controller = new AbortController();
  let updates = 0;
  const waiting = waitForVgenvJob('/tmp/project', 'job_test', () => { updates++; }, controller.signal);
  controller.abort('remote-cancelled');
  release({ id: 'job_test', status: 'succeeded' });
  await assert.rejects(waiting, /stopped/);
  assert.equal(updates, 0);
  assert.equal(getTasks().find((task) => task.provider === 'vgenv')?.status, 'cancelled');
});

test('server price formatting preserves the returned currency', () => {
  assert.equal(formatVgenvPrice({ currency: 'CNY', amount_micros: 123456 }), 'CNY 0.1235');
  assert.equal(formatVgenvPrice({ currency: 'USD', amount_micros: 1500 }), 'USD 0.0015');
});
