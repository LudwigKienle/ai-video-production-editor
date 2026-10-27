import test from 'node:test';
import assert from 'node:assert/strict';

import './splashTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { DEFAULT_SPLASH_SETTINGS, resetSplashSettingsForTests } from '../../splash/splashSettings.ts';

const TOOLS = ['splash_settings_get', 'splash_settings_set', 'splash_play', 'splash_sound_preview'];

test('splash tools are published', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const listed = mcp.list();
    for (const name of TOOLS) assert.ok(listed.some((tool) => tool.name === name), `${name} missing`);
  } finally {
    mcp.dispose();
  }
});

test('settings get/set validate and persist (in-memory without localStorage)', async () => {
  resetSplashSettingsForTests();
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const initial = await mcp.call('splash_settings_get');
    assert.deepEqual(initial.settings, DEFAULT_SPLASH_SETTINGS);
    assert.equal((initial.variants as unknown[]).length, 3);
    assert.ok((initial.layers as string[]).includes('diana'));
    assert.ok((initial.layers as string[]).includes('hermes'));

    const set = await mcp.call('splash_settings_set', { variant: 'C', volume: 0.25, sound: false });
    assert.equal(set.ok, true);
    assert.deepEqual(set.settings, { enabled: true, sound: false, volume: 0.25, variant: 'C', background: 'auto' });
    const again = await mcp.call('splash_settings_get');
    assert.equal((again.settings as { variant: string }).variant, 'C');

    assert.equal((await mcp.call('splash_settings_set', { volume: 2 })).ok, false);
    assert.equal((await mcp.call('splash_settings_set', { variant: 'Z' })).ok, false);
    assert.equal((await mcp.call('splash_settings_set', {})).ok, false);
    const dark = await mcp.call('splash_settings_set', { background: 'dark' });
    assert.equal((dark.settings as { background: string }).background, 'dark');
    assert.equal((await mcp.call('splash_settings_set', { background: 'blue' })).ok, false);
    assert.equal((await mcp.call('splash_settings_set', { enabled: false })).ok, true);
    assert.equal(((await mcp.call('splash_settings_get')).settings as { enabled: boolean }).enabled, false);
  } finally {
    mcp.dispose();
    resetSplashSettingsForTests();
  }
});

test('splash_play and splash_sound_preview go through the host live commands', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
  const dispose = registerLiveCommands({
    'splash.play': (args) => { calls.push({ name: 'play', args }); return { playing: true, variant: args.variant ?? 'A', durationSeconds: 3.4 }; },
    'splash.sound.preview': (args) => { calls.push({ name: 'sound', args }); return { played: true, volume: args.volume ?? 0.6 }; },
  });
  try {
    const play = await mcp.call('splash_play', { variant: 'B' });
    assert.equal(play.ok, true);
    assert.equal(play.playing, true);
    assert.equal(play.variant, 'B');
    assert.ok(play.timeline);
    assert.equal((await mcp.call('splash_play', { variant: 'X' })).ok, false);

    const sound = await mcp.call('splash_sound_preview', { volume: 0.4 });
    assert.equal(sound.ok, true);
    assert.equal(sound.played, true);
    const measured = sound.sound as { lufs: number; peakDb: number; durationSeconds: number };
    assert.ok(Math.abs(measured.lufs - -18) <= 1, `loudness ${measured.lufs}`);
    assert.ok(measured.peakDb <= -3, `peak ${measured.peakDb}`);
    assert.ok(measured.durationSeconds <= 3);
    assert.deepEqual(calls.map((c) => c.name), ['play', 'sound']);
  } finally {
    dispose();
    mcp.dispose();
  }
});

test('splash_sound_preview stays silent without a host', async () => {
  const { ctx } = createTestContext();
  const mcp = await createMcpHarness(ctx);
  try {
    const sound = await mcp.call('splash_sound_preview');
    assert.equal(sound.ok, true);
    assert.equal(sound.played, false);
    assert.equal((await mcp.call('splash_play')).ok, false);
  } finally {
    mcp.dispose();
  }
});
