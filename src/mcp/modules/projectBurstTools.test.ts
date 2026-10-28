import test from 'node:test';
import assert from 'node:assert/strict';

import './projectBurstTools.ts';
import { PROJECT_BURST_LIVE } from './projectBurstTools.ts';
import { createMcpHarness, createTestContext } from '../mcpHarness.ts';
import { registerLiveCommands } from '../liveCommands.ts';
import { burstPromptFromArgs, checkBurstFramePrompt } from '../../services/burstFrame.ts';

test('burst prompt from args: finished prompt wins, else built and checked', () => {
    assert.equal(burstPromptFromArgs({ prompt: '  ready  ' }).prompt, 'ready');
    const built = burstPromptFromArgs({ continuity: 'a red vintage camera on a wooden desk', style: 'Soft daylight from the left.', subjectKind: 'object', aspectRatio: '9:16' });
    assert.equal(checkBurstFramePrompt(built.prompt).ok, true);
    assert.match(built.prompt, /\[20\]/);
    assert.equal(built.aspectRatio, '9:16');
    assert.equal(burstPromptFromArgs({ prompt: 'x', aspectRatio: '5:4' }).aspectRatio, undefined);
});

test('project burst tools go through the Project Space live commands', async () => {
    const { ctx, state } = createTestContext({ activeWorkspace: 'EDIT' });
    const mcp = await createMcpHarness(ctx);
    const shots = new Map<number, { prompt: string; aspectRatio?: string } | null>([[1, null], [2, null]]);
    const dispose = registerLiveCommands({
        [PROJECT_BURST_LIVE.get]: () => ({ shots: [...shots].map(([shot, burst]) => ({ shot, burst })) }),
        [PROJECT_BURST_LIVE.set]: (args) => {
            if (!shots.has(Number(args.shot))) throw new Error(`Shot ${String(args.shot)} not found.`);
            const burst = args.clear === true ? null : burstPromptFromArgs(args);
            shots.set(Number(args.shot), burst);
            return { shot: args.shot, promptChars: burst?.prompt.length ?? 0 };
        },
        [PROJECT_BURST_LIVE.dialog]: (args) => ({ open: true, shot: args.shot ?? null }),
    });
    try {
        const names = mcp.list().map((tool) => tool.name);
        for (const name of ['project_burst_frame_list', 'project_burst_frame_set', 'project_burst_frame_clear', 'project_burst_frame_open']) assert.ok(names.includes(name), `${name} missing`);

        const set = await mcp.call('project_burst_frame_set', { shot: 2, continuity: 'an old lighthouse keeper at a wooden table', style: 'Warm lamp light, film grain.', subjectKind: 'person' });
        assert.equal(set.ok, true);
        assert.ok((shots.get(2)?.prompt.length ?? 0) > 500);
        assert.equal(checkBurstFramePrompt(shots.get(2)!.prompt).ok, true);

        assert.equal((await mcp.call('project_burst_frame_set', { shot: 2 })).ok, false, 'needs prompt or continuity');
        assert.equal((await mcp.call('project_burst_frame_set', { shot: 2, prompt: 'x', shots: ['only one'] })).ok, false, 'needs 20 shots');
        assert.equal((await mcp.call('project_burst_frame_set', { shot: 9, prompt: 'x' })).ok, false, 'unknown shot');

        const list = await mcp.call('project_burst_frame_list');
        assert.equal((list.shots as unknown[]).length, 2);

        await mcp.call('project_burst_frame_clear', { shot: 2 });
        assert.equal(shots.get(2), null);

        const open = await mcp.call('project_burst_frame_open', { shot: 1 });
        assert.equal(open.open, true);
        assert.equal(state.activeWorkspace, 'PROJECT');
    } finally {
        dispose();
        mcp.dispose();
    }
});
